const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTsModule(filename, stubs = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(output, {
    exports: loadedModule.exports,
    module: loadedModule,
    require(request) {
      if (request in stubs) return stubs[request]
      return require(request)
    },
    AbortSignal,
    DOMException,
    Error,
    Map,
    Number,
    Promise,
    Set,
    URLSearchParams,
    console,
    process,
    ...globals,
  }, { filename })
  return loadedModule.exports
}

function loadVideoApi(fetchImpl) {
  return loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/video-api.ts'),
    {},
    { fetch: fetchImpl }
  )
}

test('TikTok OAuth Web, QR, and mock refresh share the gated video.list scope', async () => {
  const qrOauth = fs.readFileSync('src/lib/tiktok/qr-oauth.ts', 'utf8')
  const oauth = loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/oauth.ts'),
    {
      './test-mock': {
        isTikTokMockCredential() {
          return true
        },
        isTikTokTestMockEnabled() {
          return true
        },
      },
      './video-list-rollout': loadTsModule(
        path.join(process.cwd(), 'src/lib/tiktok/video-list-rollout.ts')
      ),
    }
  )
  const previous = {
    key: process.env.TIKTOK_CLIENT_KEY,
    secret: process.env.TIKTOK_CLIENT_SECRET,
    redirect: process.env.TIKTOK_REDIRECT_URI,
    scopeFlag: process.env.TIKTOK_VIDEO_LIST_SCOPE_ENABLED,
  }
  try {
    process.env.TIKTOK_CLIENT_KEY = 'test-client'
    process.env.TIKTOK_CLIENT_SECRET = 'test-secret'
    process.env.TIKTOK_REDIRECT_URI = 'https://app.example.test/api/tiktok/auth/callback'

    delete process.env.TIKTOK_VIDEO_LIST_SCOPE_ENABLED
    assert.deepEqual(Array.from(oauth.getTikTokOAuthConfig().scopes), [
      'user.info.basic',
      'video.publish',
      'video.upload',
      'user.info.stats',
    ])
    const disabledMock = await oauth.refreshAccessToken('mock-refresh-disabled')
    assert.equal(disabledMock.scope.includes('video.list'), false)

    process.env.TIKTOK_VIDEO_LIST_SCOPE_ENABLED = 'true'
    const enabledScopes = Array.from(oauth.getTikTokOAuthConfig().scopes)
    assert.equal(enabledScopes.filter((scope) => scope === 'video.list').length, 1)
    const enabledMock = await oauth.refreshAccessToken('mock-refresh-enabled')
    assert.equal(enabledMock.scope.split(',').filter((scope) => scope === 'video.list').length, 1)

    process.env.TIKTOK_VIDEO_LIST_SCOPE_ENABLED = 'TRUE'
    assert.equal(oauth.getTikTokOAuthConfig().scopes.includes('video.list'), false)
    assert.match(qrOauth, /scope: config\.scopes\.join\(','\)/)
  } finally {
    for (const [name, value] of [
      ['TIKTOK_CLIENT_KEY', previous.key],
      ['TIKTOK_CLIENT_SECRET', previous.secret],
      ['TIKTOK_REDIRECT_URI', previous.redirect],
      ['TIKTOK_VIDEO_LIST_SCOPE_ENABLED', previous.scopeFlag],
    ]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('video query chunks unique IDs into TikTok batches of at most 20', () => {
  const api = loadVideoApi(async () => {
    throw new Error('fetch should not run')
  })
  const ids = Array.from({ length: 45 }, (_, index) => `video-${index}`)
  ids.push('video-1')

  const batches = api.chunkTikTokVideoIds(ids)

  assert.deepEqual(Array.from(batches, (batch) => batch.length), [20, 20, 5])
  assert.equal(new Set(batches.flat()).size, 45)
})

test('video list sends a bearer request, caps pages at 20, and keeps pagination', async () => {
  const calls = []
  const api = loadVideoApi(async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: {
            videos: [{
              id: 'video-1',
              title: 'One',
              view_count: 101,
              like_count: 11,
              comment_count: 3,
              share_count: 2,
            }],
            cursor: 1700000000000,
            has_more: true,
          },
          error: { code: 'ok', message: '', log_id: 'safe-log-id' },
        }
      },
    }
  })

  const page = await api.listTikTokVideos('secret-access-token', {
    cursor: 1710000000000,
    maxCount: 99,
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /^https:\/\/open\.tiktokapis\.com\/v2\/video\/list\/\?fields=/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-access-token')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    max_count: 20,
    cursor: 1710000000000,
  })
  assert.equal(page.videos[0].view_count, 101)
  assert.equal(page.cursor, 1700000000000)
  assert.equal(page.hasMore, true)
})

test('continuation cursors must move strictly toward older timestamps', async () => {
  const responseCursors = [1000, 3000, 3000, -1]
  const api = loadVideoApi(async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        data: {
          videos: [],
          cursor: responseCursors.shift(),
          has_more: true,
        },
        error: { code: 'ok', message: '', log_id: 'cursor-log' },
      }
    },
  }))

  assert.equal((await api.listTikTokVideos('token', { cursor: 2000 })).hasMore, true)
  assert.equal((await api.listTikTokVideos('token', { cursor: 1000 })).hasMore, false)
  assert.equal((await api.listTikTokVideos('token', { cursor: 3000 })).hasMore, false)
  assert.equal((await api.listTikTokVideos('token')).hasMore, false)
})

test('max_count normalizes zero and non-finite values without sending null', async () => {
  const bodies = []
  const api = loadVideoApi(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: { videos: [], cursor: 1000, has_more: false },
          error: { code: 'ok', message: '', log_id: 'max-log' },
        }
      },
    }
  })

  await api.listTikTokVideos('token', { maxCount: 0 })
  await api.listTikTokVideos('token', { maxCount: Number.NaN })

  assert.equal(bodies[0].max_count, 1)
  assert.equal(bodies[1].max_count, 20)
})

test('HTTP 200 TikTok business errors fail closed', async () => {
  const api = loadVideoApi(async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        data: {},
        error: {
          code: 'scope_not_authorized',
          message: 'The requested scope was not granted',
          log_id: 'log-1',
        },
      }
    },
  }))

  await assert.rejects(
    api.listTikTokVideos('access-token'),
    (error) => error.code === 'scope_not_authorized' && error.logId === 'log-1'
  )
})

test('malformed video rows never turn missing statistics into zeroes', async () => {
  const api = loadVideoApi(async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        data: {
          videos: [{
            id: 'partial-video',
            view_count: 100,
            like_count: 10,
            comment_count: 2,
          }],
          cursor: 1700000000000,
          has_more: false,
        },
        error: { code: 'ok', message: '', log_id: 'log-partial' },
      }
    },
  }))

  const page = await api.listTikTokVideos('access-token')

  assert.deepEqual(Array.from(page.videos), [])
})

test('video query rejects more than 20 IDs before calling TikTok', async () => {
  let fetchCalls = 0
  const api = loadVideoApi(async () => {
    fetchCalls += 1
    throw new Error('unexpected fetch')
  })

  await assert.rejects(
    api.queryTikTokVideoBatch(
      'access-token',
      Array.from({ length: 21 }, (_, index) => `video-${index}`)
    ),
    (error) => error.code === 'invalid_video_batch'
  )
  assert.equal(fetchCalls, 0)
})

function createSyncRouteHarness(items, queryTikTokVideoBatch) {
  const task = { id: 'task-1', user_id: 'user-1', items }
  const state = new Map(items.map((item) => [item.id, {
    view_count: item.view_count,
    like_count: item.like_count,
  }]))
  const rpcCalls = []
  let taskTotals = { total_views: 0, total_likes: 0 }
  let rpcQueue = Promise.resolve()
  const admin = {
    rpc(_name, args) {
      const result = rpcQueue.then(() => {
        rpcCalls.push(args)
        for (const update of args.p_updates) {
          state.set(update.item_id, {
            view_count: update.view_count,
            like_count: update.like_count,
          })
        }
        taskTotals = [...state.values()].reduce(
          (totals, stats) => ({
            total_views: totals.total_views + stats.view_count,
            total_likes: totals.total_likes + stats.like_count,
          }),
          { total_views: 0, total_likes: 0 }
        )
        return {
          data: {
            updated_count: args.p_updates.length,
            ...taskTotals,
          },
          error: null,
        }
      })
      rpcQueue = result.then(() => undefined, () => undefined)
      return result
    },
  }
  class Query {
    select() {
      return this
    }
    eq() {
      return this
    }
    async single() {
      return { data: task, error: null }
    }
  }
  const userDb = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1' } }, error: null }
      },
    },
    from() {
      return new Query()
    },
  }
  const route = loadTsModule(
    path.join(process.cwd(), 'src/app/api/publish/tasks/[id]/sync-stats/route.ts'),
    {
      'next/server': {
        NextResponse: {
          json(body, init = {}) {
            return { body, status: init.status || 200 }
          },
        },
      },
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/supabase/server': { createClient: async () => userDb },
      '@/lib/tiktok/token-manager': {
        async getTikTokAccountTokens() {
          return new Map([['account-1', { access_token: 'stored-token' }]])
        },
        async getValidTikTokAccessToken() {
          return 'valid-access-token'
        },
      },
      '@/lib/tiktok/video-api': {
        chunkTikTokVideoIds(ids) {
          return [ids]
        },
        hasTikTokVideoListScope(scopes) {
          return scopes.includes('video.list')
        },
        queryTikTokVideoBatch,
        TikTokVideoApiError: class TikTokVideoApiError extends Error {},
      },
    }
  )
  return {
    route,
    rpcCalls,
    state,
    getTaskTotals: () => taskTotals,
  }
}

function publishedItem(id, videoId, views, likes) {
  return {
    id,
    status: 'published',
    tiktok_video_id: videoId,
    view_count: views,
    like_count: likes,
    account: {
      id: 'account-1',
      open_id: 'open-account-1',
      user_id: 'user-1',
      account_type: 'normal',
      scopes: ['video.list'],
    },
  }
}

test('stats sync atomically applies only provider-returned videos and aggregates current rows', async () => {
  const harness = createSyncRouteHarness([
    publishedItem('item-1', 'video-1', 10, 1),
    publishedItem('item-2', 'video-2', 20, 2),
    publishedItem('item-3', 'video-3', 30, 3),
  ], async () => [{
    id: 'video-1',
    view_count: 100,
    like_count: 10,
    comment_count: 5,
    share_count: 4,
  }])

  const response = await harness.route.POST({}, {
    params: Promise.resolve({ id: 'task-1' }),
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.synced, 1)
  assert.equal(harness.getTaskTotals().total_views, 150)
  assert.equal(harness.getTaskTotals().total_likes, 15)
  assert.equal(harness.rpcCalls[0].p_updates.length, 1)
  assert.equal(response.body.errors.some((error) => error.includes('video-2')), true)
  assert.equal(response.body.errors.some((error) => error.includes('video-3')), true)
})

test('concurrent partial syncs cannot overwrite totals with an initial stale snapshot', async () => {
  let queryCall = 0
  let releaseFirstQuery
  const firstQueryBlocked = new Promise((resolve) => {
    releaseFirstQuery = resolve
  })
  const harness = createSyncRouteHarness([
    publishedItem('item-1', 'video-1', 10, 1),
    publishedItem('item-2', 'video-2', 20, 2),
  ], async () => {
    const call = queryCall
    queryCall += 1
    if (call === 0) {
      await firstQueryBlocked
      return [{
        id: 'video-2',
        view_count: 200,
        like_count: 20,
        comment_count: 6,
        share_count: 5,
      }]
    }
    return [{
      id: 'video-1',
      view_count: 110,
      like_count: 11,
      comment_count: 5,
      share_count: 4,
    }]
  })

  const first = harness.route.POST({}, { params: Promise.resolve({ id: 'task-1' }) })
  await new Promise((resolve) => setTimeout(resolve, 5))
  const second = harness.route.POST({}, { params: Promise.resolve({ id: 'task-1' }) })
  await second
  releaseFirstQuery()
  await first

  assert.equal(harness.state.get('item-1').view_count, 110)
  assert.equal(harness.state.get('item-2').view_count, 200)
  assert.equal(harness.getTaskTotals().total_views, 310)
  assert.equal(harness.getTaskTotals().total_likes, 31)
  assert.equal(harness.rpcCalls.length, 2)
})

test('video list server gate stops before auth, admin, token, or provider access', async () => {
  const calls = { auth: 0, admin: 0, token: 0, provider: 0 }
  const route = loadTsModule(
    path.join(process.cwd(), 'src/app/api/tiktok/videos/route.ts'),
    {
      'next/server': {
        NextResponse: {
          json(body, init = {}) {
            return { body, status: init.status || 200 }
          },
        },
      },
      '@/lib/supabase/admin': {
        createAdminClient() {
          calls.admin += 1
          return {}
        },
      },
      '@/lib/supabase/server': {
        async createClient() {
          calls.auth += 1
          return {}
        },
      },
      '@/lib/tiktok/token-manager': {
        async getValidTikTokAccessToken() {
          calls.token += 1
          return 'should-not-be-read'
        },
      },
      '@/lib/tiktok/video-api': {
        hasTikTokVideoListScope() {
          return true
        },
        async listTikTokVideos() {
          calls.provider += 1
          return {}
        },
        TikTokVideoApiError: class TikTokVideoApiError extends Error {},
      },
      '@/lib/tiktok/video-list-rollout': {
        isTikTokVideoListScopeEnabled() {
          return false
        },
      },
    }
  )
  const response = await route.GET({})
  assert.equal(response.status, 404)
  assert.equal(response.body.code, 'tiktok_video_list_disabled')
  assert.deepEqual(calls, { auth: 0, admin: 0, token: 0, provider: 0 })
})

test('video list UI gate hides reauthorization prompts while preserving TaskManager', () => {
  const rollout = loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/video-list-rollout.ts')
  )
  const previous = process.env.NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED
  try {
    delete process.env.NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED
    assert.equal(rollout.shouldPromptTikTokVideoListReauthorization([]), false)
    process.env.NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED = 'true'
    assert.equal(rollout.shouldPromptTikTokVideoListReauthorization([]), true)
    assert.equal(
      rollout.shouldPromptTikTokVideoListReauthorization(['video.list']),
      false
    )
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED
    else process.env.NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED = previous
  }

  const manager = fs.readFileSync('src/components/publish/tiktok/TikTokVideoManager.tsx', 'utf8')
  const accounts = fs.readFileSync('src/app/(main)/publish/accounts/page.tsx', 'utf8')
  assert.match(manager, /TIKTOK_VIDEO_LIST_UI_ENABLED \?/)
  assert.match(manager, /当前环境暂未开放/)
  assert.match(manager, /<TaskManager \/>/)
  assert.match(accounts, /shouldPromptTikTokVideoListReauthorization\(account\.scopes\)/)
})

test('video list route validates ownership, normal type, status, and scope before token access', () => {
  const route = fs.readFileSync('src/app/api/tiktok/videos/route.ts', 'utf8')
  const manager = fs.readFileSync('src/components/publish/tiktok/TikTokVideoManager.tsx', 'utf8')
  const sync = fs.readFileSync('src/app/api/publish/tasks/[id]/sync-stats/route.ts', 'utf8')
  const atomicMigration = fs.readFileSync(
    'supabase/migrations/20260724_tiktok_video_stats_atomic.sql',
    'utf8'
  )

  assert.match(route, /\.eq\('user_id', user\.id\)/)
  assert.match(route, /\.eq\('account_type', 'normal'\)/)
  assert.match(route, /account\.status !== 'active'/)
  assert.match(route, /!hasTikTokVideoListScope\(account\.scopes\)/)
  assert.ok(
    route.indexOf('!hasTikTokVideoListScope(account.scopes)')
      < route.indexOf('getValidTikTokAccessToken(admin, account.id)')
  )
  assert.match(manager, /TikTok 公开视频/)
  assert.match(manager, /video\.view_count/)
  assert.match(manager, /video\.comment_count/)
  assert.doesNotMatch(sync, /fetch\(\s*['"`]https:\/\/open\.tiktokapis\.com/)
  assert.match(sync, /queryTikTokVideoBatch/)
  assert.match(sync, /apply_tiktok_task_video_stats/)
  assert.doesNotMatch(sync, /currentStats/)
  assert.match(atomicMigration, /FROM public\.publish_tasks[\s\S]*FOR UPDATE/)
  assert.match(atomicMigration, /UPDATE public\.publish_task_items/)
  assert.match(atomicMigration, /SUM\(item\.view_count\)/)
  assert.match(atomicMigration, /REVOKE ALL ON FUNCTION[\s\S]*FROM authenticated/)
})
