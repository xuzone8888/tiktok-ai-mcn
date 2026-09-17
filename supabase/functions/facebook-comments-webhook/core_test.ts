import {
  createFacebookWebhookHandler,
  createFacebookWebhookCommentStore,
  type FacebookWebhookReceipt,
  type FacebookWebhookCommentRow,
  type FacebookWebhookCommentStore,
  parseFacebookCommentEvents,
  processFacebookCommentWebhook,
  resolveFacebookSupabaseConfiguration,
} from './core.js'

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void
}

Deno.test('Facebook accepts absent or empty managed keys with a legacy key', () => {
  for (const raw of [undefined, '{}', ' { } ']) {
    const result = resolveFacebookSupabaseConfiguration((name) => ({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEYS: raw,
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-fixture',
    })[name])
    assertEquals(result.serviceRoleKey, 'legacy-fixture')
  }
})

Deno.test('Facebook prefers default key and rejects malformed or incomplete nonempty maps', () => {
  for (const raw of ['{', '[]', 'null', '"secret"', '', '{"default":""}', '{"named":"key"}']) {
    let failed = false
    try {
      resolveFacebookSupabaseConfiguration((name) => ({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEYS: raw,
        SUPABASE_SERVICE_ROLE_KEY: 'legacy-fixture',
      })[name])
    } catch { failed = true }
    assert(failed)
  }
  const result = resolveFacebookSupabaseConfiguration((name) => {
    if (name === 'SUPABASE_URL') return 'https://example.supabase.co'
    if (name === 'SUPABASE_SECRET_KEYS') return '{"default":"new-fixture"}'
    throw new Error('must not read legacy key')
  })
  assertEquals(result.serviceRoleKey, 'new-fixture')
  let failed = false
  try {
    resolveFacebookSupabaseConfiguration((name) => ({
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEYS: '{}',
    })[name])
  } catch { failed = true }
  assert(failed)
})

Deno.test('signed Facebook POST handles empty keys and safely classifies failures', async () => {
  for (const mode of ['success', 'configuration', 'unexpected']) {
    const logs: unknown[] = []
    const receipts: unknown[] = []
    let writes = 0
    const secret = 'fixture-signing-secret'
    const handler = createFacebookWebhookHandler({
      getEnv: (name) => ({
        FACEBOOK_CLIENT_SECRET: secret,
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEYS: mode === 'configuration' ? '{' : '{}',
        SUPABASE_SERVICE_ROLE_KEY: 'private-fixture-key',
      })[name],
      createStore(config) {
        assertEquals(config.serviceRoleKey, 'private-fixture-key')
        if (mode === 'unexpected') throw new Error('private-fixture-key')
        return {
          async findActiveAccounts() {
            return [{ id: FIXTURE.accountId, userId: FIXTURE.userId, externalId: FIXTURE.pageId }]
          },
          async findPublishedContent() { return { id: FIXTURE.taskItemId, externalId: FIXTURE.videoId } },
          async upsertComment() { writes++; return 'saved' as const },
        }
      },
      async recordReceipt(receipt) { receipts.push(receipt) },
      logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    })
    const body = JSON.stringify(payload())
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key,
      new TextEncoder().encode(body)))).map((b) => b.toString(16).padStart(2, '0')).join('')
    const response = await handler(new Request('https://example.test/facebook-comments-webhook', {
      method: 'POST', body, headers: { 'x-hub-signature-256': `sha256=${signature}` },
    }))
    assertEquals(response.status, mode === 'success' ? 200 : 500)
    assertEquals(writes, mode === 'success' ? 1 : 0)
    const output = JSON.stringify({ logs, receipts, response: await response.json() })
    assert(!output.includes(secret) && !output.includes('private-fixture-key'))
    if (mode !== 'success') {
      assert(output.includes(mode === 'configuration'
        ? 'invalid_supabase_secret_keys' : 'unclassified_processing_error'))
    }
  }
})

for (const reason of ['task_lookup_failed', 'task_lookup_invalid_result']) {
  Deno.test(`signed Facebook POST safely reports ${reason}`, async () => {
    const logs: unknown[] = []
    const receipts: FacebookWebhookReceipt[] = []
    let writes = 0
    let lookups = 0
    const secret = 'task-test-signing-secret'
    const privateError = 'private-database-details-fixture'
    const handler = createFacebookWebhookHandler({
      getEnv: (name) => ({
        FACEBOOK_CLIENT_SECRET: secret,
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEYS: '{}',
        SUPABASE_SERVICE_ROLE_KEY: 'task-test-service-secret',
      })[name],
      createStore: () => createFacebookWebhookCommentStore({
        async findActiveAccounts() {
          return { data: [{ id: FIXTURE.accountId, user_id: FIXTURE.userId,
            channel_id: FIXTURE.pageId }], error: null }
        },
        async findPublishedContent() {
          return { data: [{ id: FIXTURE.taskItemId, task_id: 'task-fixture',
            facebook_video_id: FIXTURE.videoId, facebook_post_id: FIXTURE.postId }], error: null }
        },
        async findOwnedTasks(taskId, userId) {
          lookups++
          assertEquals(taskId, 'task-fixture')
          assertEquals(userId, FIXTURE.userId)
          return { data: null,
            error: reason === 'task_lookup_failed' ? new Error(privateError) : null }
        },
        async upsertSocialComment() { writes++; return { data: [], error: null } },
      }),
      async recordReceipt(receipt) { receipts.push(receipt) },
      logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    })
    const body = JSON.stringify(payload({ message: 'private-comment-fixture' }))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key,
      new TextEncoder().encode(body)))).map((b) => b.toString(16).padStart(2, '0')).join('')
    const response = await handler(new Request('https://example.test/facebook-comments-webhook', {
      method: 'POST', body, headers: { 'x-hub-signature-256': `sha256=${signature}` },
    }))
    assertEquals(response.status, 500)
    assertEquals(lookups, 1)
    assertEquals(writes, 0)
    assertEquals(receipts.length, 1)
    assertEquals(receipts[0].status, 'failed')
    assertEquals(receipts[0].signatureValid, true)
    assertEquals(receipts[0].step, 'processing')
    assertEquals(receipts[0].errorCode, 'webhook_persistence_failed')
    assertEquals(receipts[0].metadata, { reason })
    assertEquals(logs, [['Facebook webhook processing failed', {
      code: 'webhook_persistence_failed', reason, error_count: 1,
    }]])
    const responseBody = await response.json()
    assertEquals(responseBody, { error: 'Webhook processing failed', code: 'webhook_persistence_failed' })
    const output = JSON.stringify({ logs, receipts, responseBody })
    for (const sensitive of [secret, signature, privateError, 'task-test-service-secret',
      'private-comment-fixture']) assert(!output.includes(sensitive))
  })
}

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message = 'Values differ') {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) throw new Error(`${message}: expected ${right}, received ${left}`)
}

const FIXTURE = {
  pageId: '1234567890',
  accountId: 'account-row',
  userId: 'user-row',
  videoId: '5555555555',
  postId: '1234567890_9999999999',
  taskItemId: 'item-row',
  commentId: '7777777777',
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    object: 'page',
    entry: [{
      id: FIXTURE.pageId,
      time: 1_720_000_000,
      changes: [{
        field: 'feed',
        value: {
          item: 'comment',
          verb: 'add',
          post_id: FIXTURE.postId,
          comment_id: FIXTURE.commentId,
          parent_id: FIXTURE.postId,
          sender_id: 'author-1',
          sender_name: 'Example Author',
          message: 'Example comment',
          created_time: 1_720_000_000,
          ...overrides,
        },
      }],
    }],
  }
}

Deno.test('parses Page feed top-level comment and preserves Page Post identity', () => {
  const parsed = parseFacebookCommentEvents(payload())
  assertEquals(parsed.receivedCount, 1)
  assertEquals(parsed.ignoredCount, 0)
  assertEquals(parsed.events.length, 1)
  assertEquals(parsed.events[0].contentCandidates, [
    FIXTURE.postId,
    '9999999999',
  ])
  assertEquals(parsed.events[0].parentExternalCommentId, null)
})

Deno.test('ignores non-add and non-comment feed changes', () => {
  const edited = parseFacebookCommentEvents(payload({ verb: 'edited' }))
  const post = parseFacebookCommentEvents(payload({ item: 'post' }))
  assertEquals(edited.ignoredCount, 1)
  assertEquals(post.ignoredCount, 1)
  assertEquals(edited.events.length + post.events.length, 0)
})

Deno.test('recovered post mapping saves to only the owned binding for bare and compound IDs', async () => {
  for (const postId of ['9999999999', FIXTURE.postId]) {
    for (const mode of ['missing', 'recovered', 'foreign-task', 'ambiguous']) {
      let saved = 0
      const store = createFacebookWebhookCommentStore({
        async findActiveAccounts() {
          return { data: ['old-a', 'old-b', FIXTURE.accountId].map(id => ({
            id, user_id: FIXTURE.userId, channel_id: FIXTURE.pageId,
          })), error: null }
        },
        async findPublishedContent(accountId, candidates) {
          const found = accountId === FIXTURE.accountId && mode !== 'missing'
            && candidates.includes(FIXTURE.postId)
          const row = { id: FIXTURE.taskItemId, task_id: 'owned-task',
            facebook_video_id: FIXTURE.videoId, facebook_post_id: FIXTURE.postId }
          return { data: found ? (mode === 'ambiguous' ? [row, row] : [row]) : [], error: null }
        },
        async findOwnedTasks(_taskId, userId) {
          assertEquals(userId, FIXTURE.userId)
          return { data: mode === 'foreign-task' ? [] : [{ id: 'owned-task' }], error: null }
        },
        async upsertSocialComment(row) {
          saved++
          assertEquals(row.external_content_id, FIXTURE.videoId)
          assertEquals(row.account_id, FIXTURE.accountId)
          assertEquals(row.metadata, { source: 'webhook', event_type: 'feed.comment.add' })
          return { data: [{ id: 'saved-comment' }], error: null }
        },
      })
      const result = await processFacebookCommentWebhook(payload({ post_id: postId, parent_id: postId }), store)
      assertEquals(saved, mode === 'recovered' ? 1 : 0)
      assertEquals(result.saved_count, saved)
      assertEquals(result.ignored_count, 3 - saved)
    }
  }
})

Deno.test('maps an owned published Facebook comment into shared cache shape', async () => {
  let saved: FacebookWebhookCommentRow | null = null
  const store: FacebookWebhookCommentStore = {
    async findActiveAccounts() {
      return [{ id: FIXTURE.accountId, userId: FIXTURE.userId, externalId: FIXTURE.pageId }]
    },
    async findPublishedContent(_userId, _accountId, candidates) {
      assert(candidates.includes(FIXTURE.postId))
      return { id: FIXTURE.taskItemId, externalId: FIXTURE.videoId }
    },
    async upsertComment(row) {
      saved = row
      return 'saved'
    },
  }
  const result = await processFacebookCommentWebhook(payload(), store)
  assertEquals(result, {
    source: 'webhook',
    received_count: 1,
    mapped_count: 1,
    saved_count: 1,
    ignored_count: 0,
    duplicate_count: 0,
    error_count: 0,
  })
  const savedRow = saved as FacebookWebhookCommentRow | null
  assert(savedRow)
  assertEquals(savedRow.externalContentId, FIXTURE.videoId)
  assertEquals(savedRow.direction, 'inbound')
  assertEquals(savedRow.parentExternalCommentId, null)
})

Deno.test('maps one Page webhook event to every active local Page binding', async () => {
  const saved: FacebookWebhookCommentRow[] = []
  const store: FacebookWebhookCommentStore = {
    async findActiveAccounts() {
      return [
        { id: 'account-a', userId: 'user-a', externalId: FIXTURE.pageId },
        { id: 'account-b', userId: 'user-b', externalId: FIXTURE.pageId },
      ]
    },
    async findPublishedContent(userId, accountId) {
      return {
        id: `${accountId}-item`,
        externalId: `${userId}-video`,
      }
    },
    async upsertComment(row) {
      saved.push(row)
      return 'saved'
    },
  }

  const result = await processFacebookCommentWebhook(payload(), store)
  assertEquals(result.saved_count, 2)
  assertEquals(result.ignored_count, 0)
  assertEquals(saved.map((row) => row.userId), ['user-a', 'user-b'])
  assertEquals(saved.map((row) => row.accountId), ['account-a', 'account-b'])
})

Deno.test('verifies GET challenge and rejects unsigned POST', async () => {
  const handler = createFacebookWebhookHandler({
    getEnv(name) {
      if (name === 'FACEBOOK_WEBHOOK_VERIFY_TOKEN') return 'verify-example'
      if (name === 'FACEBOOK_CLIENT_SECRET') return 'secret-example'
      return undefined
    },
    createStore() {
      throw new Error('not reached')
    },
  })
  const challenge = await handler(
    new Request(
      'https://example.test/facebook-comments-webhook?hub.mode=subscribe&hub.verify_token=verify-example&hub.challenge=12345',
    ),
  )
  assertEquals(challenge.status, 200)
  assertEquals(await challenge.text(), '12345')

  const unsigned = await handler(
    new Request(
      'https://example.test/facebook-comments-webhook',
      { method: 'POST', body: JSON.stringify(payload()) },
    ),
  )
  assertEquals(unsigned.status, 401)
})
