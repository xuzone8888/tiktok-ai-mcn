import {
  createFacebookWebhookHandler,
  type FacebookWebhookCommentRow,
  type FacebookWebhookCommentStore,
  parseFacebookCommentEvents,
  processFacebookCommentWebhook,
} from './core.js'

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void
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
