const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, dependencies, globals = {}) {
  const filename = path.join(process.cwd(), 'src/lib/facebook', file)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module, exports: module.exports, URL, AbortSignal, process, Date,
    require(name) { if (name in dependencies) return dependencies[name]; throw Error(`Unexpected import: ${name}`) },
    ...globals,
  }, { filename })
  return module.exports
}

const pageId = '1163745913492790'
const videoId = '1776412969940583'
const postId = '122132653785359531'
const fullPostId = `${pageId}_${postId}`
const verifiedPost = { id: fullPostId, object_id: videoId, from: { id: pageId }, status_type: 'added_video', is_published: true }

function resolver(fetch, broker = {}) {
  return load('post-identity.ts', {
    '@/lib/facebook/oauth': { getFacebookAppSecretProof: () => 'proof' },
    '@/lib/oauth-broker/client': { isBrokerEnabled: () => false, ...broker },
  }, { fetch }).resolveFacebookVideoPostIdentity
}

test('video post identity normalizes bare post ID without losing precision', async () => {
  const result = await resolver(async () => Response.json({ id: videoId, post_id: postId }))('token', pageId, videoId)
  assert.equal(result.postId, fullPostId)
})

test('missing video post_id resolves only the exact video in the Page published posts', async () => {
  const urls = []
  const resolve = resolver(async (input, options) => {
    const url = new URL(input); urls.push(url)
    assert.equal(options.headers.Authorization, 'Bearer token')
    assert.ok(options.signal)
    assert.equal(url.searchParams.has('access_token'), false)
    if (url.pathname.endsWith(`/${fullPostId}`)) return Response.json(verifiedPost)
    if (!url.pathname.endsWith('/published_posts')) return Response.json({ id: videoId })
    return Response.json({ data: [
      { id: `${pageId}_999`, object_id: 'unrelated' },
      { id: fullPostId, attachments: { data: [{ target: { id: videoId } }] } },
    ] })
  })
  assert.equal((await resolve('token', pageId, videoId)).postId, fullPostId)
  assert.equal(urls.length, 3)
  assert.match(urls[1].pathname, new RegExp(`/${pageId}/published_posts$`))
})

test('fallback pagination rebuilds trusted URL and uses object_id on later page', async () => {
  const urls = []
  const resolve = resolver(async input => {
    const url = new URL(input); urls.push(url)
    if (url.pathname.endsWith(`/${fullPostId}`)) return Response.json(verifiedPost)
    if (!url.pathname.endsWith('/published_posts')) return Response.json({ id: videoId })
    if (!url.searchParams.has('after')) return Response.json({ data: [], paging: { next: 'https://evil.test/?access_token=secret', cursors: { after: 'cursor-1' } } })
    assert.equal(url.searchParams.get('after'), 'cursor-1')
    return Response.json({ data: [{ id: fullPostId, object_id: videoId }] })
  })
  assert.equal((await resolve('token', pageId, videoId)).postId, fullPostId)
  assert.ok(urls.every(url => url.hostname === 'graph.facebook.com'))
})

test('optional field rejection retries minimal identity fields', async () => {
  const fields = []
  const resolve = resolver(async input => {
    const value = new URL(input).searchParams.get('fields'); fields.push(value)
    return fields.length === 1 ? new Response('{}', { status: 400 }) : Response.json({ id: videoId, post_id: fullPostId })
  })
  assert.equal((await resolve('token', pageId, videoId)).postId, fullPostId)
  assert.deepEqual(fields, ['id,post_id,permalink_url', 'id,post_id'])
})

test('unverified posts, foreign Page, wrong video, and numeric precision loss never produce mapping', async () => {
  for (const posts of [
    [{ id: fullPostId, object_id: videoId }, { id: `${pageId}_9`, object_id: videoId }],
    [{ id: `999_${postId}`, object_id: videoId }],
    [{ id: fullPostId, object_id: '999', message: videoId }],
    [{ id: Number(postId), object_id: videoId }],
  ]) {
    const resolve = resolver(async input => Response.json(new URL(input).pathname.endsWith('/published_posts')
      ? { data: posts } : { id: 'wrong-video', post_id: fullPostId }))
    assert.equal(await resolve('token', pageId, videoId), null)
  }
})

test('bounded/incomplete and repeated-cursor scans refuse even an apparent single match', async () => {
  for (const repeated of [false, true]) {
    let reads = 0
    const resolve = resolver(async input => {
      if (!new URL(input).pathname.endsWith('/published_posts')) return Response.json({ id: videoId })
      reads += 1
      return Response.json({ data: [{ id: fullPostId, object_id: videoId }], paging: { next: 'https://graph.facebook.com/next', cursors: { after: repeated ? 'same' : String(reads) } } })
    })
    assert.equal(await resolve('token', pageId, videoId), null)
    assert.equal(reads, repeated ? 2 : 3)
  }
})

test('an exact, independently verified original post is accepted on page one even with more than three pages', async () => {
  let scans = 0
  let verifications = 0
  const resolve = resolver(async input => {
    const url = new URL(input)
    if (url.pathname.endsWith(`/${fullPostId}`)) { verifications++; return Response.json(verifiedPost) }
    if (!url.pathname.endsWith('/published_posts')) return Response.json({ id: videoId })
    scans++
    return Response.json({ data: [{ id: fullPostId, object_id: videoId }], paging: { next: 'https://graph.facebook.com/more', cursors: { after: 'more' } } })
  })
  assert.equal((await resolve('token', pageId, videoId)).postId, fullPostId)
  assert.equal(scans, 1)
  assert.equal(verifications, 1)
})

test('candidate verification rejects re-shares, unpublished posts and mismatching owner/video/id', async () => {
  for (const override of [{ status_type: 'shared_story' }, { is_published: false }, { from: { id: '999' } }, { object_id: '999' }, { id: `${pageId}_999` }]) {
    const resolve = resolver(async input => {
      const url = new URL(input)
      if (url.pathname.endsWith(`/${fullPostId}`)) return Response.json({ ...verifiedPost, ...override })
      if (url.pathname.endsWith('/published_posts')) return Response.json({ data: [{ id: fullPostId, object_id: videoId }] })
      return Response.json({ id: videoId })
    })
    assert.equal(await resolve('token', pageId, videoId), null)
  }
})

test('client recovery returns immediately while request is pending and ignores other platforms', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const requests = []
  const { scheduleFacebookPostIdentityRecovery: schedule } = load('post-identity-client.ts', {}, {
    fetch: async (url, options) => { requests.push({ url, options }); await pending; return Response.json({ status: 'recovered' }) },
  })
  const data = { facebookIdentityRecoveryLogId: 'log-1' }
  for (const platform of ['youtube', 'instagram', 'tiktok']) schedule(platform, data, {})
  assert.equal(requests.length, 0)
  assert.equal(schedule('facebook', data, {}), undefined)
  assert.equal(requests.length, 1)
  schedule('facebook', data, {})
  assert.equal(requests.length, 1)
  assert.equal(JSON.parse(requests[0].options.body).logId, 'log-1')
  release()
  await pending
})

test('comment sync has no awaited identity lookup and schedules recovery only after displaying comments', () => {
  const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/social-comments/service.ts'), 'utf8')
  const sync = service.slice(service.indexOf('export async function syncSocialComments('), service.indexOf('async function findComment'))
  assert.doesNotMatch(sync, /await recoverFacebookPostIdentity|await resolveFacebookVideoPostIdentity/)
  const client = fs.readFileSync(path.join(process.cwd(), 'src/components/social-comments/SocialCommentsClient.tsx'), 'utf8')
  assert.match(client, /await loadComments\([^\n]+\)\s+scheduleFacebookPostIdentityRecovery\(syncPlatform, data, requestHeaders\)/)
})

test('invalid inputs never issue requests; network errors are nonfatal; links stay on Facebook', async () => {
  let calls = 0
  const resolve = resolver(async () => { calls += 1; throw Error('network failure with token') })
  assert.equal(await resolve('token', '../page', videoId), null)
  assert.equal(calls, 0)
  assert.equal(await resolve('token', pageId, videoId), null)
  for (const unsafe of ['https://evil.test', 'https://secret@www.facebook.com/', 'https://www.facebook.com/?access_token=secret']) {
    const result = await resolver(async () => Response.json({ id: videoId, post_id: fullPostId, permalink_url: unsafe }))('token', pageId, videoId)
    assert.equal(result.permalinkUrl, null)
  }
})

test('broker-enabled production delegates read-only resolution rather than direct Graph calls', async () => {
  const calls = []
  const resolve = resolver(() => { throw Error('must not fetch directly') }, {
    isBrokerEnabled: () => true,
    callBroker: async (...args) => { calls.push(args); return { postId: fullPostId, permalinkUrl: null } },
  })
  assert.equal((await resolve('token', pageId, videoId, false)).postId, fullPostId)
  assert.equal(calls[0][0], 'facebook')
  assert.equal(calls[0][1], 'resolveFacebookVideoPostIdentity')
  assert.equal(calls[0][2].scanPosts, false)
})

const input = { userId: 'owner', accountId: 'binding', pageId, videoId, taskItemId: 'item', accessToken: 'token' }

function recoveryHarness(options = {}) {
  const queries = []
  let resolutions = 0
  const admin = {
    from(table) {
      const query = { table, filters: [], update: null }; queries.push(query)
      const builder = {
        select() { return builder },
        eq(...args) { query.filters.push(['eq', ...args]); return builder },
        is(...args) { query.filters.push(['is', ...args]); return builder },
        update(values) { query.update = values; return builder },
        maybeSingle() { return builder },
        then(resolve, reject) {
          if (query.update) return Promise.resolve({ data: options.concurrent ? [] : [{ id: 'item' }], error: options.writeError ? {} : null }).then(resolve, reject)
          const data = table === 'facebook_accounts' ? (options.foreignAccount ? null : { id: 'binding' })
            : table === 'facebook_publish_tasks' ? (options.foreignTask ? null : { id: 'task' })
            : { task_id: 'task', facebook_post_id: options.existing ?? null }
          return Promise.resolve({ data, error: options.readError ? {} : null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
  const { recoverFacebookPostIdentity } = load('post-identity-recovery.ts', {
    '@/lib/facebook/post-identity': {
      resolveFacebookVideoPostIdentity: async () => {
        resolutions += 1
        if (options.resolveError) throw Error('token must not escape')
        return options.unresolved ? null : { postId: options.returnedPostId || fullPostId }
      },
    },
  })
  return { queries, run: () => recoverFacebookPostIdentity(admin, input), resolutions: () => resolutions }
}

test('old video recovery verifies ownership and compare-and-sets only its missing post ID', async () => {
  const h = recoveryHarness()
  assert.equal(await h.run(), 'recovered')
  assert.equal(h.resolutions(), 1)
  assert.ok(h.queries[0].filters.some(f => f[1] === 'user_id' && f[2] === 'owner'))
  assert.ok(h.queries[2].filters.some(f => f[1] === 'user_id' && f[2] === 'owner'))
  const update = h.queries.find(q => q.update)
  assert.equal(update.table, 'facebook_publish_task_items')
  assert.equal(update.update.facebook_post_id, fullPostId)
  for (const [field, value] of [['id','item'],['account_id','binding'],['task_id','task'],['facebook_video_id',videoId],['status','published']]) {
    assert.ok(update.filters.some(f => f[0] === 'eq' && f[1] === field && f[2] === value))
  }
  assert.ok(update.filters.some(f => f[0] === 'is' && f[1] === 'facebook_post_id' && f[2] === null))
})

test('foreign ownership, existing mapping, unresolved identity and failures never write guessed mapping', async () => {
  for (const [options, status] of [
    [{ foreignAccount: true }, 'not_owned'], [{ foreignTask: true }, 'not_owned'],
    [{ existing: fullPostId }, 'present'], [{ unresolved: true }, 'unresolved'],
    [{ readError: true }, 'failed'], [{ resolveError: true }, 'failed'],
    [{ returnedPostId: '999_123' }, 'unresolved'],
  ]) {
    const h = recoveryHarness(options)
    assert.equal(await h.run(), status)
    assert.equal(h.queries.some(q => q.update), false)
  }
})

test('write failures and concurrent changes are reported without breaking normal comment sync', async () => {
  assert.equal(await recoveryHarness({ writeError: true }).run(), 'failed')
  assert.equal(await recoveryHarness({ concurrent: true }).run(), 'concurrent_change')
})

test('separate recovery consumes only an owned completed Facebook sync once and retains diagnostics', async () => {
  const { recoverFacebookIdentityForSync: run } = load('post-identity-recovery.ts', {
    '@/lib/facebook/post-identity': {},
  })
  const row = { id: 'log', user_id: 'owner', platform: 'facebook', action_type: 'sync', status: 'completed',
    account_id: 'binding', external_content_id: videoId,
    metadata: { synced_count: 5, facebook_post_identity_status: 'pending' } }
  const admin = { from(table) {
    assert.equal(table, 'social_comment_action_logs')
    const filters = []; let update; let single = false
    const query = {
      select() { return query }, eq(key, value) { filters.push([key, value]); return query },
      maybeSingle() { single = true; return query }, update(value) { update = value; return query },
      then(resolve, reject) {
        const matches = filters.every(([key, value]) => (key === 'metadata->>facebook_post_identity_status'
          ? row.metadata.facebook_post_identity_status : row[key]) === value)
        if (matches && update) Object.assign(row, update)
        return Promise.resolve({ data: matches ? (single ? { ...row, metadata: { ...row.metadata } } : [{ id: row.id }]) : (single ? null : []), error: null }).then(resolve, reject)
      },
    }
    return query
  } }
  let calls = 0
  const recover = async (accountId, contentId) => {
    calls++; assert.equal(accountId, 'binding'); assert.equal(contentId, videoId); return 'recovered'
  }
  assert.equal(await run(admin, 'stranger', 'log', recover), 'not_owned')
  row.platform = 'youtube'
  assert.equal(await run(admin, 'owner', 'log', recover), 'not_owned')
  row.platform = 'facebook'; row.status = 'running'
  assert.equal(await run(admin, 'owner', 'log', recover), 'not_owned')
  row.status = 'completed'
  const results = await Promise.all([run(admin, 'owner', 'log', recover), run(admin, 'owner', 'log', recover)])
  assert.ok(results.includes('recovered'))
  assert.ok(results.includes('not_pending'))
  assert.equal(calls, 1)
  assert.equal(row.metadata.synced_count, 5)
  assert.equal(row.metadata.facebook_post_identity_status, 'recovered')
  row.metadata.facebook_post_identity_status = 'pending'
  assert.equal(await run(admin, 'owner', 'log', async () => { throw Error('private token') }), 'failed')
  assert.equal(row.metadata.facebook_post_identity_status, 'failed')
  assert.equal(JSON.stringify(row).includes('private token'), false)
})

test('recovery endpoint enforces Facebook flag, login, valid log ID and safe failure responses', async () => {
  let enabled = true, user = { id: 'owner' }, status = 'recovered', calls = 0
  const { POST } = load('../../app/api/facebook/post-identity/recover/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) },
    '@/lib/social-comments/feature-flag': { isSocialCommentsApiEnabled: () => true, isSocialCommentPlatformEnabled: p => enabled && p === 'facebook' },
    '@/lib/social-comments/service': { recoverFacebookIdentityAfterSync: async (uid) => { calls++; assert.equal(uid, 'owner'); return status } },
  })
  const request = (logId = '12345678-1234-1234-1234-123456789abc') => new Request('https://example.test/api/facebook/post-identity/recover', {
    method: 'POST', body: JSON.stringify({ logId }),
  })
  enabled = false; assert.equal((await POST(request())).status, 404)
  enabled = true; user = null; assert.equal((await POST(request())).status, 401)
  user = { id: 'owner' }; assert.equal((await POST(request('bad'))).status, 400)
  assert.equal(calls, 0)
  assert.equal((await POST(request())).status, 200)
  status = 'not_owned'; assert.equal((await POST(request())).status, 404)
  status = 'failed'; assert.equal((await POST(request())).status, 503)
})

test('broker dispatches only the authenticated Facebook identity operation and fixed argument list', async () => {
  const filename = path.join(process.cwd(), 'src/app/api/oauth-broker/call/route.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  })
  const module = { exports: {} }
  const calls = []
  const env = { BROKER_SECRET: 'broker-fixture' }
  vm.runInNewContext(outputText, {
    module, exports: module.exports, process: { env }, console,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } }
      if (name === '@/lib/facebook/post-identity') return { resolveFacebookVideoPostIdentity: async (...args) => {
        calls.push(args); return { postId: fullPostId, permalinkUrl: null }
      } }
      if (['@/lib/facebook/oauth', '@/lib/instagram/oauth', '@/lib/youtube/oauth', '@/lib/social-comments/platform-api'].includes(name)) return {}
      throw Error(`Unexpected import ${name}`)
    },
  }, { filename })
  function request(secret = 'broker-fixture', platform = 'facebook') {
    return new Request('https://broker.example.test/api/oauth-broker/call', { method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ platform, op: 'resolveFacebookVideoPostIdentity', args: {
        accessToken: 'token', pageId, videoId, scanPosts: true, url: 'https://evil.test',
      } }),
    })
  }
  assert.equal((await module.exports.POST(request('wrong'))).status, 401)
  assert.equal((await module.exports.POST(request('broker-fixture', 'youtube'))).status, 400)
  assert.equal(calls.length, 0)
  const response = await module.exports.POST(request())
  assert.equal((await response.json()).result.postId, fullPostId)
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['token', pageId, videoId, true]))
  env.OAUTH_BROKER_URL = 'https://broker.example.test'
  assert.equal((await module.exports.POST(request())).status, 500)
  assert.equal(calls.length, 1)
})
