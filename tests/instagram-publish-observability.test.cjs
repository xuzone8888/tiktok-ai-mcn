const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, context = {}, moduleMap = {}) {
  const filename = path.join(process.cwd(), relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const loadedModule = { exports: {} }
  const localRequire = (request) => {
    if (request === '@/lib/instagram/graph-auth') {
      return {
        instagramGraphHeaders: (accessToken, headers = {}) => ({
          ...headers,
          Authorization: `Bearer ${accessToken}`,
        }),
      }
    }
    return moduleMap[request] || require(request)
  }
  vm.runInNewContext(output, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    URL,
    URLSearchParams,
    Response,
    AbortController,
    process,
    setTimeout,
    clearTimeout,
    ...context,
  }, { filename })
  return loadedModule.exports
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createStatefulItemSupabase(initialRow) {
  const row = { ...initialRow }
  return {
    row,
    from() {
      const filters = []
      let update = null
      const query = {
        update(value) {
          update = value
          return query
        },
        eq(column, value) {
          filters.push((candidate) => candidate[column] === value)
          return query
        },
        select() { return query },
        async maybeSingle() {
          if (!filters.every((filter) => filter(row))) return { data: null, error: null }
          Object.assign(row, update)
          return { data: { id: row.id }, error: null }
        },
      }
      return query
    },
  }
}

test('persists a new container before the first status poll', async () => {
  const events = []
  const requests = []
  const fetch = async (url, init = {}) => {
    const parsedUrl = new URL(String(url))
    const body = init.body instanceof URLSearchParams ? init.body : new URLSearchParams()
    requests.push({
      authorizationPresent: new Headers(init.headers || {}).get('Authorization')?.startsWith('Bearer ') === true,
      bodyHasAccessToken: body.has('access_token'),
      urlHasAccessToken: parsedUrl.searchParams.has('access_token'),
    })
    if (init.method === 'POST' && String(url).includes('/media_publish')) {
      events.push('publish')
      return jsonResponse({ id: 'media-final' })
    }
    if (init.method === 'POST') {
      events.push('create')
      return jsonResponse({ id: 'container-new' })
    }
    if (String(url).includes('container-new')) {
      events.push('status')
      return jsonResponse({ status_code: 'FINISHED', status: 'ready' })
    }
    events.push('permalink')
    return jsonResponse({ permalink: 'https://example.test/reel' })
  }
  const publish = loadTypeScriptModule('src/lib/instagram/publish.ts', { fetch })

  const result = await publish.uploadInstagramVideoFromUrl('token', 'https://example.test/video.mp4', {
    accountId: 'account',
    title: '',
    onContainerCreated: async () => events.push('container-persist'),
    onMediaPublished: async () => events.push('media-persist'),
  })

  assert.deepEqual(events, ['create', 'container-persist', 'status', 'publish', 'media-persist', 'permalink'])
  assert.equal(result.containerId, 'container-new')
  assert.equal(result.videoId, 'media-final')
  assert.equal(result.watchUrl, 'https://example.test/reel')
  assert.equal(requests.length, 4)
  assert.equal(requests.every((request) => request.authorizationPresent), true)
  assert.equal(requests.some((request) => request.urlHasAccessToken), false)
  assert.equal(requests.some((request) => request.bodyHasAccessToken), false)
})

test('create-container unknown outcomes are stable, single-attempt errors', async () => {
  const cases = [
    {
      name: 'network',
      fetch: async () => { throw new Error('network') },
    },
    {
      name: 'server',
      fetch: async () => new Response('{}', { status: 503 }),
    },
    {
      name: 'missing id',
      fetch: async () => jsonResponse({ success: true }),
    },
  ]

  for (const scenario of cases) {
    let calls = 0
    const publish = loadTypeScriptModule('src/lib/instagram/publish.ts', {
      fetch: async (...args) => {
        calls++
        return scenario.fetch(...args)
      },
    })
    await assert.rejects(
      publish.uploadInstagramVideoFromUrl('token', 'https://example.test/video.mp4', {
        accountId: 'account',
        title: '',
      }),
      (error) => error.name === 'InstagramMediaContainerOutcomeUnknownError'
    )
    assert.equal(calls, 1, scenario.name)
  }

  const rejected = loadTypeScriptModule('src/lib/instagram/publish.ts', {
    fetch: async () => new Response('{}', { status: 400 }),
  })
  await assert.rejects(
    rejected.uploadInstagramVideoFromUrl('token', 'https://example.test/video.mp4', {
      accountId: 'account',
      title: '',
    }),
    (error) => error.name === 'InstagramMediaContainerRejectedError'
  )
})

test('a lost lease fences the create-container write', async () => {
  let externalCalls = 0
  const publish = loadTypeScriptModule('src/lib/instagram/publish.ts', {
    fetch: async () => {
      externalCalls++
      return jsonResponse({ id: 'unexpected' })
    },
  })

  await assert.rejects(
    publish.uploadInstagramVideoFromUrl('token', 'https://example.test/video.mp4', {
      accountId: 'account',
      title: '',
      beforeContainerCreate: async () => {
        throw new Error('lease lost')
      },
    }),
    /lease lost/
  )
  assert.equal(externalCalls, 0)
})

test('a lost lease fences media_publish after container readiness', async () => {
  const calls = []
  const publish = loadTypeScriptModule('src/lib/instagram/publish.ts', {
    fetch: async (_url, init = {}) => {
      calls.push(init.method || 'GET')
      return jsonResponse({ status_code: 'FINISHED', status: 'ready' })
    },
  })

  await assert.rejects(
    publish.publishInstagramExistingContainer('token', {
      accountId: 'account',
      creationId: 'container-existing',
      onBeforeMediaPublish: async () => {
        throw new Error('lease lost')
      },
    }),
    /lease lost/
  )
  assert.deepEqual(Array.from(calls), ['GET'])
})

test('terminal container errors retain the container id and safe status', async () => {
  let call = 0
  const fetch = async () => {
    call++
    return call === 1
      ? jsonResponse({ id: 'container-terminal' })
      : jsonResponse({ status_code: 'ERROR', status: 'failed https://secret.example/path?token=value' })
  }
  const publish = loadTypeScriptModule('src/lib/instagram/publish.ts', { fetch })

  await assert.rejects(
    publish.uploadInstagramVideoFromUrl('token', 'https://example.test/video.mp4', {
      accountId: 'account',
      title: '',
      onContainerCreated: () => undefined,
    }),
    (error) => {
      assert.equal(error.name, 'InstagramContainerTerminalError')
      assert.equal(error.containerId, 'container-terminal')
      assert.equal(error.statusCode, 'ERROR')
      assert.equal(error.statusDetail.includes('https://'), false)
      assert.equal(error.statusDetail.includes('token=value'), false)
      return true
    }
  )
})

test('keeps the existing-container path and returns the final media id', async () => {
  const events = []
  const fetch = async (url, init = {}) => {
    if (!init.method) {
      if (String(url).includes('container-existing')) {
        events.push('status')
        return jsonResponse({ status_code: 'FINISHED' })
      }
      events.push('permalink')
      return jsonResponse({ permalink: 'https://example.test/reel' })
    }
    events.push('publish')
    return jsonResponse({ id: 'media-final' })
  }
  const publish = loadTypeScriptModule('src/lib/instagram/publish.ts', { fetch })
  const result = await publish.publishInstagramExistingContainer('token', {
    accountId: 'account',
    creationId: 'container-existing',
  })
  assert.deepEqual(events, ['status', 'publish', 'permalink'])
  assert.equal(result.containerId, 'container-existing')
  assert.equal(result.videoId, 'media-final')
})

test('permalink failure preserves the published result and does not republish', async () => {
  let publishCalls = 0
  const events = []
  const fetch = async (url, init = {}) => {
    if (init.method === 'POST' && String(url).includes('/media_publish')) {
      publishCalls++
      events.push('publish')
      return jsonResponse({ id: 'media-final' })
    }
    if (init.method === 'POST') return jsonResponse({ id: 'container' })
    if (String(url).includes('container')) return jsonResponse({ status_code: 'FINISHED' })
    events.push('permalink')
    return new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 500 })
  }
  const publish = loadTypeScriptModule('src/lib/instagram/publish.ts', { fetch })
  const result = await publish.uploadInstagramVideoFromUrl('token', 'https://example.test/video.mp4', {
    accountId: 'account',
    title: '',
    onMediaPublished: async () => events.push('media-persist'),
  })
  assert.equal(result.published, true)
  assert.equal(result.videoId, 'media-final')
  assert.equal(result.watchUrl, null)
  assert.equal(result.warningCode, 'INSTAGRAM_PERMALINK_UNAVAILABLE')
  assert.equal(publishCalls, 1)
  assert.deepEqual(events, ['publish', 'media-persist', 'permalink'])
})

test('final media persistence failure stops before permalink and never republishes', async () => {
  let publishCalls = 0
  let permalinkCalls = 0
  const fetch = async (url, init = {}) => {
    if (init.method === 'POST' && String(url).includes('/media_publish')) {
      publishCalls++
      return jsonResponse({ id: 'media-final' })
    }
    if (init.method === 'POST') return jsonResponse({ id: 'container' })
    if (String(url).includes('container')) return jsonResponse({ status_code: 'FINISHED' })
    permalinkCalls++
    return jsonResponse({ permalink: 'https://example.test/reel' })
  }
  const publish = loadTypeScriptModule('src/lib/instagram/publish.ts', { fetch })
  await assert.rejects(
    publish.uploadInstagramVideoFromUrl('token', 'https://example.test/video.mp4', {
      accountId: 'account',
      title: '',
      onMediaPublished: async () => {
        throw new Error('db unavailable')
      },
    }),
    (error) => error.name === 'InstagramPostPublishPersistenceError'
  )
  assert.equal(publishCalls, 1)
  assert.equal(permalinkCalls, 0)
})

test('a recovered already-published container never calls media_publish again', async () => {
  let publishCalls = 0
  const fetch = async (_url, init = {}) => {
    if (init.method === 'POST') {
      publishCalls++
      return jsonResponse({ id: 'unexpected' })
    }
    return jsonResponse({ status_code: 'PUBLISHED' })
  }
  const publish = loadTypeScriptModule('src/lib/instagram/publish.ts', { fetch })
  await assert.rejects(
    publish.publishInstagramExistingContainer('token', {
      accountId: 'account',
      creationId: 'container-existing',
    }),
    (error) => error.name === 'InstagramContainerAlreadyPublishedError'
  )
  assert.equal(publishCalls, 0)
})

test('state updates preserve container ids and published media ids correctly', () => {
  const state = loadTypeScriptModule('src/lib/instagram/publish-state.ts')
  const failed = state.buildInstagramFailedItemUpdate('failed', 'TERMINAL', 'now', 'container-id')
  const processing = state.buildInstagramContainerProcessingUpdate('container-id', 'processing', 'now')
  const published = state.buildInstagramPublishedItemUpdate({
    videoId: 'media-final',
    containerId: 'container-id',
    watchUrl: 'https://example.test/reel',
    published: true,
  }, 'now')
  assert.equal(failed.instagram_video_id, 'container-id')
  assert.equal(processing.instagram_video_id, 'container-id')
  assert.equal(published.instagram_video_id, 'media-final')
  assert.equal(published.status, 'published')
  const publishedWithWarning = state.buildInstagramPublishedItemUpdate({
    videoId: 'media-final',
    containerId: 'container-id',
    watchUrl: null,
    published: true,
    warningCode: 'INSTAGRAM_PERMALINK_UNAVAILABLE',
    warningMessage: 'warning',
  }, 'now')
  assert.equal(publishedWithWarning.status, 'published')
  assert.equal(publishedWithWarning.instagram_video_id, 'media-final')
  assert.equal(publishedWithWarning.error_code, 'INSTAGRAM_PERMALINK_UNAVAILABLE')

  const reconciliation = state.buildInstagramReconciliationUpdate('known-id', 'now')
  assert.equal(reconciliation.status, 'container_created')
  assert.equal(reconciliation.instagram_video_id, 'known-id')
  assert.equal(reconciliation.instagram_watch_url, null)
  assert.equal(reconciliation.error_code, 'INSTAGRAM_PUBLISHED_STATE_RECONCILIATION_REQUIRED')
  assert.equal(Object.hasOwn(reconciliation, 'published_at'), false)

  const lease = loadTypeScriptModule('src/lib/instagram/publish-lease.ts')
  assert.equal(lease.isInstagramPublishItemEligible({
    id: 'reconciliation-item',
    status: reconciliation.status,
    updated_at: '2026-07-10T12:00:00.000Z',
  }), false)
})

test('reconciliation display is platform-specific and localized', () => {
  const state = loadTypeScriptModule('src/lib/instagram/publish-state.ts')
  const display = loadTypeScriptModule(
    'src/lib/instagram/publish-display.ts',
    {},
    { '@/lib/instagram/publish-state': state }
  )
  const zh = display.getInstagramPublishReconciliationDisplay(
    'instagram',
    state.INSTAGRAM_RECONCILIATION_REQUIRED_CODE,
    false
  )
  const en = display.getInstagramPublishReconciliationDisplay(
    'instagram',
    state.INSTAGRAM_RECONCILIATION_REQUIRED_CODE,
    true
  )
  assert.equal(zh.label, '已发布，需人工核对')
  assert.equal(en.label, 'Published, verification required')
  assert.equal(display.getInstagramPublishReconciliationDisplay(
    'facebook',
    state.INSTAGRAM_RECONCILIATION_REQUIRED_CODE,
    true
  ), null)
  assert.equal(display.getInstagramPublishReconciliationDisplay(
    'instagram',
    'OTHER',
    true
  ), null)
})

test('reconciliation persistence retries with UPDATE RETURNING and reports durable failure', async () => {
  const state = loadTypeScriptModule('src/lib/instagram/publish-state.ts')
  const reconciliation = loadTypeScriptModule(
    'src/lib/instagram/publish-reconciliation.ts',
    {},
    { '@/lib/instagram/publish-state': state }
  )
  const updates = []
  let attempts = 0
  const supabase = {
    from() {
      const query = {
        update(value) {
          updates.push(value)
          return query
        },
        eq() {
          return query
        },
        select() {
          return query
        },
        async maybeSingle() {
          attempts++
          return attempts === 1
            ? { data: null, error: { message: 'temporary' } }
            : { data: { id: 'item' }, error: null }
        },
      }
      return query
    },
  }
  assert.equal(await reconciliation.persistInstagramReconciliationState(
    supabase,
    'item',
    'lease-token',
    'uploading',
    'known-id',
    'now'
  ), true)
  assert.equal(attempts, 2)
  assert.equal(updates[1].status, 'container_created')
  assert.equal(updates[1].instagram_video_id, 'known-id')

  const failingSupabase = {
    from() {
      const query = {
        update() { return query },
        eq() { return query },
        select() { return query },
        async maybeSingle() {
          return { data: null, error: { message: 'unavailable' } }
        },
      }
      return query
    },
  }
  assert.equal(await reconciliation.persistInstagramReconciliationState(
    failingSupabase,
    'item',
    'lease-token',
    'uploading',
    'known-id',
    'now'
  ), false)
})

test('item persistence enforces status and lease token across barrier transitions', async () => {
  const state = loadTypeScriptModule('src/lib/instagram/publish-state.ts')
  const persistence = loadTypeScriptModule(
    'src/lib/instagram/publish-item-persistence.ts',
    {},
    { '@/lib/instagram/publish-state': state }
  )
  const supabase = createStatefulItemSupabase({
    id: 'item',
    status: 'container_created',
    processing_started_at: 'lease-token',
    instagram_video_id: 'container-id',
  })

  assert.equal(await persistence.updateInstagramItemWithRetry(
    supabase,
    'item',
    'lease-token',
    state.buildInstagramPublishedIdentityUpdate('media-id', 'now'),
    'container_created'
  ), true)
  assert.equal(supabase.row.status, 'published')
  assert.equal(supabase.row.instagram_video_id, 'media-id')

  assert.equal(await persistence.updateInstagramItemWithRetry(
    supabase,
    'item',
    'lease-token',
    { error_message: 'enrichment' },
    'published'
  ), true)
  assert.equal(await persistence.updateInstagramItemWithRetry(
    supabase,
    'item',
    'old-lease-token',
    { error_message: 'stale' },
    'published'
  ), false)

  supabase.row.status = 'container_created'
  assert.equal(await persistence.persistInstagramFailedItem(
    supabase,
    'item',
    'lease-token',
    'explicit 4xx',
    'INSTAGRAM_MEDIA_PUBLISH_REJECTED',
    'container-id',
    'container_created'
  ), true)
  assert.equal(supabase.row.status, 'failed')

  supabase.row.status = 'uploading'
  assert.equal(await persistence.persistInstagramFailedItem(
    supabase,
    'item',
    'lease-token',
    'wrong state',
    'WRONG_STATE',
    undefined,
    'container_created'
  ), false)
})

test('barrier state can be followed by token-scoped reconciliation and unknown-outcome isolation', async () => {
  const state = loadTypeScriptModule('src/lib/instagram/publish-state.ts')
  const barrier = loadTypeScriptModule(
    'src/lib/instagram/publish-barrier.ts',
    {},
    { '@/lib/instagram/publish-state': state }
  )
  const reconciliation = loadTypeScriptModule(
    'src/lib/instagram/publish-reconciliation.ts',
    {},
    { '@/lib/instagram/publish-state': state }
  )
  const seen = []
  const supabase = {
    from() {
      const query = {
        update(value) {
          seen.push({ type: 'update', value })
          return query
        },
        eq(column, value) {
          seen.push({ type: 'eq', column, value })
          return query
        },
        select() { return query },
        async maybeSingle() { return { data: { id: 'item' }, error: null } },
      }
      return query
    },
  }

  assert.equal(await barrier.enterInstagramMediaPublishBarrier(
    supabase,
    'item',
    'lease-token',
    'container-id',
    'now'
  ), true)
  assert.equal(await reconciliation.persistInstagramReconciliationState(
    supabase,
    'item',
    'lease-token',
    'container_created',
    'media-id',
    'now'
  ), true)
  assert.equal(await barrier.persistInstagramMediaPublishOutcomeUnknown(
    supabase,
    'item',
    'lease-token',
    'container-id',
    'now'
  ), true)

  const statusFilters = seen
    .filter((entry) => entry.type === 'eq' && entry.column === 'status')
    .map((entry) => entry.value)
  const tokenFilters = seen
    .filter((entry) => entry.type === 'eq' && entry.column === 'processing_started_at')
    .map((entry) => entry.value)
  assert.deepEqual(Array.from(statusFilters), ['uploading', 'container_created', 'container_created'])
  assert.deepEqual(Array.from(tokenFilters), ['lease-token', 'lease-token', 'lease-token'])

  const lostLeaseSupabase = {
    from() {
      const query = {
        update() { return query },
        eq() { return query },
        select() { return query },
        async maybeSingle() { return { data: null, error: null } },
      }
      return query
    },
  }
  assert.equal(await barrier.enterInstagramMediaPublishBarrier(
    lostLeaseSupabase,
    'item',
    'old-lease-token',
    'container-id',
    'now'
  ), false)
})

test('processor wires terminal container ids into the failed item update', () => {
  const processor = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/instagram/processor.ts'),
    'utf8'
  )
  assert.ok(processor.includes('error instanceof InstagramContainerTerminalError'))
  assert.ok(processor.includes("'INSTAGRAM_CONTAINER_TERMINAL_ERROR'"))
  assert.ok(processor.includes('error.containerId'))
  assert.ok(processor.includes('onContainerCreated: async (containerId)'))
  const postPublishCatch = processor.indexOf('error instanceof InstagramPostPublishPersistenceError')
  const genericMarkFailed = processor.indexOf("'INSTAGRAM_UPLOAD_FAILED'")
  assert.ok(postPublishCatch >= 0 && postPublishCatch < genericMarkFailed)
  assert.ok(processor.includes('persistInstagramReconciliationState('))
  assert.ok(processor.includes('error.mediaId'))
  assert.ok(processor.includes('error.containerId'))
  assert.ok(processor.includes("if (reconciled) return 'published'"))
  assert.equal(processor.includes(".in('status', ['pending', 'processing', 'uploading'])"), false)
  assert.equal(processor.includes("status: 'container_created'"), false)
})

test('reconciliation failures do not enter generic failed handling or republish', () => {
  const processor = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/instagram/processor.ts'),
    'utf8'
  )
  const postPublishCatch = processor.indexOf('error instanceof InstagramPostPublishPersistenceError')
  const alreadyPublishedCatch = processor.indexOf('error instanceof InstagramContainerAlreadyPublishedError')
  const createUnknownCatch = processor.indexOf('error instanceof InstagramMediaContainerOutcomeUnknownError')
  const rejectedCatch = processor.indexOf('error instanceof InstagramMediaPublishRejectedError')
  const terminalCatch = processor.indexOf('error instanceof InstagramContainerTerminalError')
  const genericCatch = processor.indexOf("'INSTAGRAM_UPLOAD_FAILED'")
  assert.ok(postPublishCatch >= 0)
  assert.ok(alreadyPublishedCatch > postPublishCatch)
  assert.ok(createUnknownCatch > alreadyPublishedCatch)
  assert.ok(rejectedCatch > alreadyPublishedCatch)
  assert.ok(terminalCatch > alreadyPublishedCatch)
  assert.ok(genericCatch > terminalCatch)

  const postPublishBranch = processor.slice(postPublishCatch, alreadyPublishedCatch)
  const alreadyPublishedBranch = processor.slice(alreadyPublishedCatch, createUnknownCatch)
  assert.equal(postPublishBranch.includes('markItemFailed'), false)
  assert.equal(alreadyPublishedBranch.includes('markItemFailed'), false)
  assert.equal(postPublishBranch.includes('publishInstagram'), false)
  assert.equal(alreadyPublishedBranch.includes('publishInstagram'), false)
  assert.match(processor, /'container_created',\r?\n\s+error\.mediaId/)
  assert.ok(processor.includes('persistInstagramMediaPublishOutcomeUnknown'))
  assert.ok(processor.includes('onBeforeMediaPublish: prepareMediaPublish'))
  assert.ok(processor.includes("'INSTAGRAM_MEDIA_PUBLISH_REJECTED'"))
  assert.ok(processor.includes(".eq('processing_started_at', leaseToken)"))
})

test('task UI renders the reconciliation code with a dedicated localized state', () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), 'src/components/publish/platform/PlatformPublishPage.tsx'),
    'utf8'
  )
  assert.ok(page.includes('error_code?: string | null'))
  assert.ok(page.includes('getInstagramPublishReconciliationDisplay('))
  assert.ok(page.includes('reconciliationDisplay?.label'))
  assert.ok(page.includes('reconciliationDisplay.message'))
  const display = loadTypeScriptModule(
    'src/lib/instagram/publish-display.ts',
    {},
    { '@/lib/instagram/publish-state': loadTypeScriptModule('src/lib/instagram/publish-state.ts') }
  )
  const createUnknown = display.getInstagramPublishReconciliationDisplay(
    'instagram',
    'INSTAGRAM_MEDIA_CREATE_OUTCOME_UNKNOWN',
    true
  )
  assert.equal(createUnknown.label, 'Publish result unknown, verification required')
})
