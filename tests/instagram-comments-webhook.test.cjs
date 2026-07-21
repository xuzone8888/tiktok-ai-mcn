const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, stubs = {}, context = {}) {
  const filename = path.join(process.cwd(), relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const loadedModule = { exports: {} }
  const localRequire = (id) => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id)
  vm.runInNewContext(output, {
    Buffer,
    Headers,
    Response,
    TextDecoder,
    URL,
    URLSearchParams,
    console: context.console || console,
    exports: loadedModule.exports,
    module: loadedModule,
    process: { env: context.env || {} },
    require: localRequire,
  }, { filename })
  return loadedModule.exports
}

function loadWebhookService() {
  return loadTypeScriptModule('src/lib/instagram/webhook-comments.ts', {
    '@/lib/supabase/admin': {
      createAdminClient: () => {
        throw new Error('The behavior tests must use the in-memory store.')
      },
    },
  })
}

function createMemoryStore(options = {}) {
  const account = {
    id: 'account-row',
    userId: 'owner-user',
    externalId: 'account-external',
  }
  const media = {
    id: 'published-item',
    externalId: 'published-media',
  }
  const rows = new Map()
  const writes = []

  return {
    rows,
    writes,
    async findActiveAccount(externalId) {
      if (options.ambiguousAccount || options.inactiveAccount) return null
      return externalId === account.externalId ? account : null
    },
    async findPublishedMedia(userId, accountId, externalId) {
      if (options.unknownMedia) return null
      return userId === account.userId && accountId === account.id && externalId === media.externalId ? media : null
    },
    async upsertComment(row) {
      const key = `${row.userId}:instagram:${row.accountId}:${row.externalCommentId}`
      const duplicate = rows.has(key)
      rows.set(key, { ...row })
      writes.push({ ...row })
      return duplicate ? 'duplicate' : 'saved'
    },
  }
}

function commentPayload(overrides = {}) {
  const value = {
    id: 'comment-external',
    from: { id: 'commenter-external', username: 'commenter-name' },
    text: 'synthetic comment body',
    media: { id: 'published-media' },
    created_time: '2026-07-13T02:00:00.000Z',
    ...overrides.value,
  }
  return {
    object: 'instagram',
    entry: [{
      id: 'account-external',
      changes: [{ field: 'comments', value }],
      ...overrides.entry,
    }],
    ...overrides.body,
  }
}

function directCommentPayload(overrides = {}) {
  const payload = commentPayload(overrides)
  const change = payload.entry[0].changes[0]
  delete payload.entry[0].changes
  payload.entry[0].field = change.field
  payload.entry[0].value = change.value
  return payload
}

test('official direct entry field/value shape stores an inbound comment without from.id', async () => {
  const { processInstagramCommentWebhook } = loadWebhookService()
  const store = createMemoryStore()
  const result = await processInstagramCommentWebhook(directCommentPayload({
    value: { from: { username: 'commenter-name' } },
  }), store)

  assert.equal(result.received_count, 1)
  assert.equal(result.mapped_count, 1)
  assert.equal(result.saved_count, 1)
  assert.equal(store.rows.size, 1)
  assert.equal(store.writes[0].authorId, null)
  assert.equal(store.writes[0].authorName, 'commenter-name')
  assert.equal(store.writes[0].direction, 'inbound')
  assert.equal(store.writes[0].isFromAccount, false)
})

test('direct and changes shapes in one entry share the same delivery dedupe set', async () => {
  const { processInstagramCommentWebhook } = loadWebhookService()
  const store = createMemoryStore()
  const payload = directCommentPayload()
  payload.entry[0].changes = [{ field: 'comments', value: { ...payload.entry[0].value } }]
  const result = await processInstagramCommentWebhook(payload, store)

  assert.equal(result.received_count, 2)
  assert.equal(result.mapped_count, 1)
  assert.equal(result.saved_count, 1)
  assert.equal(result.duplicate_count, 1)
  assert.equal(store.rows.size, 1)
})

test('owned published Instagram comment is mapped and stored as inbound', async () => {
  const { processInstagramCommentWebhook } = loadWebhookService()
  const store = createMemoryStore()
  const result = await processInstagramCommentWebhook(commentPayload(), store)

  assert.equal(result.received_count, 1)
  assert.equal(result.mapped_count, 1)
  assert.equal(result.saved_count, 1)
  assert.equal(result.ignored_count, 0)
  assert.equal(result.duplicate_count, 0)
  assert.equal(store.rows.size, 1)
  assert.equal(store.writes[0].userId, 'owner-user')
  assert.equal(store.writes[0].accountId, 'account-row')
  assert.equal(store.writes[0].taskItemId, 'published-item')
  assert.equal(store.writes[0].direction, 'inbound')
  assert.equal(store.writes[0].isFromAccount, false)
})

test('duplicate delivery is idempotent and remains one cached row', async () => {
  const { processInstagramCommentWebhook } = loadWebhookService()
  const store = createMemoryStore()
  const first = await processInstagramCommentWebhook(commentPayload(), store)
  const second = await processInstagramCommentWebhook(commentPayload(), store)

  assert.equal(first.saved_count, 1)
  assert.equal(second.saved_count, 0)
  assert.equal(second.duplicate_count, 1)
  assert.equal(store.rows.size, 1)
})

test('inactive, ambiguous, or unknown ownership is ignored without a write', async () => {
  const { processInstagramCommentWebhook } = loadWebhookService()
  for (const options of [{ inactiveAccount: true }, { ambiguousAccount: true }, { unknownMedia: true }]) {
    const store = createMemoryStore(options)
    const result = await processInstagramCommentWebhook(commentPayload(), store)
    assert.equal(result.saved_count, 0)
    assert.equal(result.ignored_count, 1)
    assert.equal(store.writes.length, 0)
  }
})

test('account and media ownership must resolve in the same store context', async () => {
  const { processInstagramCommentWebhook } = loadWebhookService()
  const store = createMemoryStore()
  store.findPublishedMedia = async (userId, accountId) => userId === 'different-tenant-user' && accountId === 'different-tenant-account'
    ? { id: 'other-item', externalId: 'published-media' }
    : null

  const result = await processInstagramCommentWebhook(commentPayload(), store)
  assert.equal(result.ignored_count, 1)
  assert.equal(store.rows.size, 0)
})

test('self comments and parent replies preserve direction and thread mapping inputs', async () => {
  const { processInstagramCommentWebhook } = loadWebhookService()
  const store = createMemoryStore()
  const payload = commentPayload({
    value: {
      from: { id: 'account-external', username: 'account-name' },
      parent_id: 'parent-comment',
    },
  })
  const result = await processInstagramCommentWebhook(payload, store)

  assert.equal(result.saved_count, 1)
  assert.equal(store.writes[0].direction, 'outbound')
  assert.equal(store.writes[0].isFromAccount, true)
  assert.equal(store.writes[0].parentExternalCommentId, 'parent-comment')
})

test('missing username remains a valid nullable author and numeric timestamps are parsed', async () => {
  const { processInstagramCommentWebhook } = loadWebhookService()
  const store = createMemoryStore()
  const result = await processInstagramCommentWebhook(commentPayload({
    value: {
      from: { id: 'commenter-external' },
      created_time: undefined,
      timestamp: 1783908000,
    },
  }), store)

  assert.equal(result.saved_count, 1)
  assert.equal(store.writes[0].authorName, null)
  assert.match(store.writes[0].createdAt, /^2026-/)
})

test('missing comment id or text and non-comment events never write', async () => {
  const { processInstagramCommentWebhook } = loadWebhookService()
  for (const value of [{ id: '' }, { text: '   ' }]) {
    const store = createMemoryStore()
    const result = await processInstagramCommentWebhook(commentPayload({ value }), store)
    assert.equal(result.saved_count, 0)
    assert.equal(result.ignored_count, 1)
    assert.equal(store.rows.size, 0)
  }

  const store = createMemoryStore()
  const payload = commentPayload()
  payload.entry[0].changes[0].field = 'messages'
  const result = await processInstagramCommentWebhook(payload, store)
  assert.equal(result.received_count, 0)
  assert.equal(store.rows.size, 0)
})

class FakeNextResponse extends Response {
  static json(value, init = {}) {
    return new FakeNextResponse(JSON.stringify(value), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
  }
}

function createRouteHarness(options = {}) {
  const calls = { process: 0, info: [], error: [] }
  class StubPayloadError extends Error {
    constructor() {
      super('Invalid Instagram webhook payload.')
      this.code = 'invalid_webhook_payload'
    }
  }
  const route = loadTypeScriptModule('src/app/api/instagram/webhook/route.ts', {
    'next/server': { NextResponse: FakeNextResponse },
    '@/lib/instagram/webhook-comments': {
      InstagramWebhookPayloadError: StubPayloadError,
      createInstagramWebhookCommentStore: () => ({}),
      processInstagramCommentWebhook: async (body) => {
        calls.process += 1
        if (options.processError === 'shape') throw new StubPayloadError()
        if (options.processError === 'database') throw new Error('synthetic database failure')
        return {
          source: 'webhook',
          received_count: Array.isArray(body.entry) ? 1 : 0,
          mapped_count: 1,
          saved_count: 1,
          ignored_count: 0,
          duplicate_count: 0,
          error_count: 0,
        }
      },
    },
  }, {
    env: {
      INSTAGRAM_AUTH_MODE: 'instagram',
      INSTAGRAM_NATIVE_CLIENT_SECRET: 'synthetic-app-secret',
      INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'synthetic-verify-token',
    },
    console: {
      info: (...args) => calls.info.push(args),
      error: (...args) => calls.error.push(args),
    },
  })
  return { calls, route }
}

function chunkedRequest(rawChunks, options = {}) {
  const chunks = rawChunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'))
  const requestBytes = Buffer.concat(chunks)
  const signedBytes = options.signedBody === undefined
    ? requestBytes
    : Buffer.isBuffer(options.signedBody)
      ? options.signedBody
      : Buffer.from(options.signedBody, 'utf8')
  const signature = crypto
    .createHmac('sha256', 'synthetic-app-secret')
    .update(signedBytes)
    .digest('hex')
  const headers = new Headers(options.headers || {})
  if (!options.omitSignature) headers.set('x-hub-signature-256', `sha256=${signature}`)

  const stats = { readCount: 0, cancelCount: 0 }
  const reader = {
    async read() {
      if (stats.readCount >= chunks.length) return { done: true, value: undefined }
      const chunk = chunks[stats.readCount]
      stats.readCount += 1
      return {
        done: false,
        value: new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      }
    },
    async cancel() {
      stats.cancelCount += 1
    },
    releaseLock() {},
  }
  return {
    request: {
      headers,
      body: { getReader: () => reader },
    },
    stats,
  }
}

function signedRequest(rawBody, options = {}) {
  return chunkedRequest([rawBody], options).request
}

test('GET challenge requires subscribe mode and the server-only verify token', async () => {
  const { route } = createRouteHarness()
  const success = await route.GET({
    nextUrl: new URL('https://local.invalid/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=challenge-value'),
  })
  assert.equal(success.status, 200)
  assert.equal(await success.text(), 'challenge-value')

  const rejected = await route.GET({
    nextUrl: new URL('https://local.invalid/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-value'),
  })
  assert.equal(rejected.status, 403)
})

test('POST verifies exact raw bytes before parsing and accepts a valid signature', async () => {
  const { calls, route } = createRouteHarness()
  const rawBody = '{"object":"instagram","entry":[] }'
  const success = await route.POST(signedRequest(rawBody))
  assert.equal(success.status, 200)
  assert.equal(calls.process, 1)

  const normalizedSignature = await route.POST(signedRequest(rawBody, {
    signedBody: JSON.stringify(JSON.parse(rawBody)),
  }))
  assert.equal(normalizedSignature.status, 401)
  assert.equal(calls.process, 1)
})

test('POST HMAC uses original bytes before strict UTF-8 decoding', async () => {
  const { calls, route } = createRouteHarness()
  const invalidUtf8 = Buffer.from([0x7b, 0xff, 0x7d])
  const response = await route.POST(signedRequest(invalidUtf8))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'invalid_webhook_encoding')
  assert.equal(calls.process, 0)
})

test('POST rejects missing or invalid signatures before processing', async () => {
  const { calls, route } = createRouteHarness()
  const rawBody = JSON.stringify({ object: 'instagram', entry: [] })
  assert.equal((await route.POST(signedRequest(rawBody, { omitSignature: true }))).status, 401)
  assert.equal((await route.POST(signedRequest(rawBody, { signedBody: 'different body' }))).status, 401)
  assert.equal(calls.process, 0)
})

test('POST enforces body limits and rejects invalid JSON with stable statuses', async () => {
  const { calls, route } = createRouteHarness()
  let bodyAccesses = 0
  const oversizedByHeader = {
    headers: new Headers({ 'content-length': String((1024 * 1024) + 1) }),
    get body() {
      bodyAccesses += 1
      return null
    },
  }
  assert.equal((await route.POST(oversizedByHeader)).status, 413)
  assert.equal(bodyAccesses, 0)

  const oversized = chunkedRequest([
    Buffer.alloc(600 * 1024, 1),
    Buffer.alloc(600 * 1024, 2),
    Buffer.alloc(64, 3),
  ])
  assert.equal((await route.POST(oversized.request)).status, 413)
  assert.equal(oversized.stats.readCount, 2)
  assert.equal(oversized.stats.cancelCount, 1)
  assert.equal(calls.process, 0)

  assert.equal((await route.POST(signedRequest('{invalid-json'))).status, 400)
  assert.equal(calls.process, 0)
})

test('POST maps a parsed but invalid webhook shape to a stable 400', async () => {
  const { calls, route } = createRouteHarness({ processError: 'shape' })
  const response = await route.POST(signedRequest(JSON.stringify({ object: 'instagram' })))
  assert.equal(response.status, 400)
  assert.equal(calls.process, 1)
  const body = await response.json()
  assert.equal(body.code, 'invalid_webhook_payload')
})

test('route logs only safe count metadata and stable persistence errors', async () => {
  const secretText = 'sensitive-comment-text'
  const rawBody = JSON.stringify({
    object: 'instagram',
    entry: [{ id: 'sensitive-account-id', changes: [{ field: 'comments', value: { text: secretText } }] }],
  })
  const successHarness = createRouteHarness()
  assert.equal((await successHarness.route.POST(signedRequest(rawBody))).status, 200)
  const successLog = JSON.stringify(successHarness.calls.info)
  assert.equal(successLog.includes(secretText), false)
  assert.equal(successLog.includes('sensitive-account-id'), false)
  assert.equal(successLog.includes('synthetic-app-secret'), false)

  const failureHarness = createRouteHarness({ processError: 'database' })
  assert.equal((await failureHarness.route.POST(signedRequest(rawBody))).status, 500)
  const errorLog = JSON.stringify(failureHarness.calls.error)
  assert.equal(errorLog.includes(secretText), false)
  assert.equal(errorLog.includes('sensitive-account-id'), false)
  assert.equal(errorLog.includes('synthetic-app-secret'), false)
})

test('webhook source has no Graph, token, reply, or manual sync side effects', () => {
  const routeSource = fs.readFileSync('src/app/api/instagram/webhook/route.ts', 'utf8')
  const serviceSource = fs.readFileSync('src/lib/instagram/webhook-comments.ts', 'utf8')
  const combined = `${routeSource}\n${serviceSource}`

  assert.equal(/\bfetch\s*\(/.test(combined), false)
  assert.equal(/graph\.instagram\.com/i.test(combined), false)
  assert.equal(/access_token|refresh_token/i.test(combined), false)
  assert.equal(/replyTo|social_comment_action_logs|social_comment_sync_runs/.test(combined), false)
  assert.equal(routeSource.indexOf('verifyMetaSignature') < routeSource.indexOf('JSON.parse(rawText)'), true)
  assert.match(routeSource, /request\.body\.getReader\(\)/)
  assert.match(routeSource, /await reader\.cancel\(\)/)
  assert.match(serviceSource, /onConflict:\s*'user_id,platform,account_id,external_comment_id'/)
  assert.match(serviceSource, /ignoreDuplicates:\s*true/)
  assert.match(serviceSource, /\.eq\('status', 'active'\)/)
  assert.match(serviceSource, /\.eq\('status', 'published'\)/)
  assert.match(serviceSource, /\.from\('instagram_publish_tasks'\)/)
  assert.match(serviceSource, /\.eq\('user_id', userId\)/)
})
