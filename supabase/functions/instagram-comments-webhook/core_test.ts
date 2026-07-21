import {
  createInstagramWebhookCommentStore,
  createInstagramWebhookHandler,
  type InstagramWebhookCommentRow,
  type InstagramWebhookCommentStore,
  InstagramWebhookConfigurationError,
  type InstagramWebhookDatabase,
  InstagramWebhookDatabaseError,
  MAX_INSTAGRAM_WEBHOOK_BODY_BYTES,
  processInstagramCommentWebhook,
  readRawBodyWithinLimit,
  resolveSupabaseAdminConfiguration,
  type SafeLogger,
} from './core.js'
import { handler as productionHandler } from './index.js'

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void
  readTextFile(path: string | URL): Promise<string>
}

function assert(
  condition: unknown,
  message = 'Assertion failed',
): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  message = 'Values differ',
): void {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(
      `${message}: expected ${expectedJson}, received ${actualJson}`,
    )
  }
}

async function assertRejects(
  operation: () => Promise<unknown> | unknown,
  verify: (error: unknown) => boolean,
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    assert(
      verify(error),
      'Rejected with an unexpected safe error classification',
    )
    return
  }
  throw new Error('Expected operation to reject')
}

const FIXTURE = {
  accountExternalId: 'synthetic-account-external',
  accountId: 'synthetic-account-row',
  userId: 'synthetic-user-row',
  mediaExternalId: 'synthetic-media-external',
  mediaRowId: 'synthetic-media-row',
  taskId: 'synthetic-task-row',
  commentExternalId: 'synthetic-comment-external',
  parentExternalId: 'synthetic-parent-external',
  authorId: 'synthetic-author-external',
  authorName: 'synthetic-author-name',
  message: 'synthetic-comment-text',
} as const

const APP_SECRET = 'synthetic-native-app-secret'
const VERIFY_TOKEN = 'synthetic-webhook-verify-token'
const SERVICE_ROLE = 'synthetic-service-role-secret'

function directPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    object: 'instagram',
    entry: [
      {
        id: FIXTURE.accountExternalId,
        field: 'comments',
        value: {
          id: FIXTURE.commentExternalId,
          from: { username: FIXTURE.authorName },
          text: FIXTURE.message,
          media: { id: FIXTURE.mediaExternalId },
          timestamp: 1_720_000_000,
          ...overrides,
        },
      },
    ],
  }
}

function changesPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    object: 'instagram',
    entry: [
      {
        id: FIXTURE.accountExternalId,
        changes: [
          {
            field: 'comments',
            value: {
              id: FIXTURE.commentExternalId,
              from: {
                id: FIXTURE.accountExternalId,
                username: 'synthetic-owner-name',
              },
              text: FIXTURE.message,
              media: { id: FIXTURE.mediaExternalId },
              parent_id: FIXTURE.parentExternalId,
              timestamp: '2026-07-13T01:02:03.000Z',
              ...overrides,
            },
          },
        ],
      },
    ],
  }
}

function createDatabase(
  overrides: Partial<InstagramWebhookDatabase> = {},
): {
  database: InstagramWebhookDatabase
  insertedRows: Array<Record<string, unknown>>
} {
  const insertedRows: Array<Record<string, unknown>> = []
  const database: InstagramWebhookDatabase = {
    findActiveAccounts() {
      return Promise.resolve({
        data: [{
          id: FIXTURE.accountId,
          user_id: FIXTURE.userId,
          channel_id: FIXTURE.accountExternalId,
        }],
        error: null,
      })
    },
    findPublishedMedia() {
      return Promise.resolve({
        data: [{
          id: FIXTURE.mediaRowId,
          task_id: FIXTURE.taskId,
          instagram_video_id: FIXTURE.mediaExternalId,
        }],
        error: null,
      })
    },
    findOwnedTasks() {
      return Promise.resolve({ data: [{ id: FIXTURE.taskId }], error: null })
    },
    upsertSocialComment(row) {
      insertedRows.push(row)
      return Promise.resolve({ data: [{ id: 'synthetic-saved-row' }], error: null })
    },
    ...overrides,
  }
  return { database, insertedRows }
}

function envReader(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://synthetic-project.supabase.co',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: SERVICE_ROLE }),
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    INSTAGRAM_NATIVE_CLIENT_SECRET: APP_SECRET,
    ...overrides,
  }
  return (name: string) => values[name]
}

function copyToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

async function signatureFor(rawBody: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    copyToArrayBuffer(new TextEncoder().encode(APP_SECRET)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, copyToArrayBuffer(rawBody)),
  )
  return `sha256=${Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

async function signedRequest(
  rawBody: Uint8Array,
  signature?: string,
): Promise<Request> {
  return new Request(
    'https://webhook.invalid/instagram-comments-webhook',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature ?? await signatureFor(rawBody),
      },
      body: copyToArrayBuffer(rawBody),
    },
  )
}

function encodedPayload(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload))
}

function createLogCapture(): {
  logger: SafeLogger
  entries: Array<
    { level: string; message: string; metadata: Record<string, unknown> }
  >
} {
  const entries: Array<
    { level: string; message: string; metadata: Record<string, unknown> }
  > = []
  return {
    entries,
    logger: {
      info(message, metadata) {
        entries.push({ level: 'info', message, metadata })
      },
      error(message, metadata) {
        entries.push({ level: 'error', message, metadata })
      },
    },
  }
}

function createHandler(
  store: InstagramWebhookCommentStore,
  options: {
    env?: Record<string, string | undefined>
    logger?: SafeLogger
  } = {},
) {
  return createInstagramWebhookHandler({
    getEnv: envReader(options.env),
    createStore: () => store,
    logger: options.logger,
  })
}

Deno.test('resolves SUPABASE_SECRET_KEYS default without consulting legacy fallback', () => {
  let legacyReads = 0
  const config = resolveSupabaseAdminConfiguration((name) => {
    if (name === 'SUPABASE_URL') return 'https://synthetic-project.supabase.co'
    if (name === 'SUPABASE_SECRET_KEYS') {
      return JSON.stringify({ default: SERVICE_ROLE })
    }
    if (name === 'SUPABASE_SERVICE_ROLE_KEY') {
      legacyReads += 1
      return 'unused-legacy-secret'
    }
    return undefined
  })
  assertEquals(config.serviceRoleKey === SERVICE_ROLE, true)
  assertEquals(legacyReads, 0)
})

Deno.test('uses legacy service role only when SUPABASE_SECRET_KEYS is absent', () => {
  const config = resolveSupabaseAdminConfiguration(envReader({
    SUPABASE_SECRET_KEYS: undefined,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
  }))
  assertEquals(config.serviceRoleKey === SERVICE_ROLE, true)
})

Deno.test('malformed or incomplete SUPABASE_SECRET_KEYS fails closed without fallback', async () => {
  for (const secretKeys of ['{', '{}', '{"default":""}', '[]']) {
    let legacyReads = 0
    await assertRejects(
      () =>
        resolveSupabaseAdminConfiguration((name) => {
          if (
            name === 'SUPABASE_URL'
          ) return 'https://synthetic-project.supabase.co'
          if (name === 'SUPABASE_SECRET_KEYS') return secretKeys
          if (name === 'SUPABASE_SERVICE_ROLE_KEY') {
            legacyReads += 1
            return SERVICE_ROLE
          }
          return undefined
        }),
      (error) =>
        error instanceof InstagramWebhookConfigurationError &&
        error.code === 'invalid_supabase_secret_keys' &&
        !error.message.includes(SERVICE_ROLE),
    )
    assertEquals(legacyReads, 0)
  }
})

Deno.test('missing or invalid Supabase configuration has stable safe classifications', async () => {
  await assertRejects(
    () => resolveSupabaseAdminConfiguration(envReader({ SUPABASE_URL: undefined })),
    (error) =>
      error instanceof InstagramWebhookConfigurationError &&
      error.code === 'missing_supabase_url',
  )
  await assertRejects(
    () =>
      resolveSupabaseAdminConfiguration(
        envReader({ SUPABASE_URL: 'file:///tmp/data' }),
      ),
    (error) =>
      error instanceof InstagramWebhookConfigurationError &&
      error.code === 'invalid_supabase_url',
  )
  await assertRejects(
    () =>
      resolveSupabaseAdminConfiguration(envReader({
        SUPABASE_SECRET_KEYS: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
      })),
    (error) =>
      error instanceof InstagramWebhookConfigurationError &&
      error.code === 'missing_supabase_service_role_key',
  )
})

Deno.test('official direct comment shape maps username-only author as inbound', async () => {
  const { database, insertedRows } = createDatabase()
  const result = await processInstagramCommentWebhook(
    directPayload(),
    createInstagramWebhookCommentStore(database),
  )
  assertEquals(result, {
    source: 'webhook',
    received_count: 1,
    mapped_count: 1,
    saved_count: 1,
    ignored_count: 0,
    duplicate_count: 0,
    error_count: 0,
  })
  assertEquals(insertedRows.length, 1)
  assertEquals(insertedRows[0].author_id, null)
  assertEquals(insertedRows[0].author_name, FIXTURE.authorName)
  assertEquals(insertedRows[0].direction, 'inbound')
  assertEquals(insertedRows[0].is_from_account, false)
  assertEquals(insertedRows[0].metadata, {
    source: 'webhook',
    event_type: 'comments',
  })
})

Deno.test('changes self-comment maps outbound and preserves parent relationship', async () => {
  const { database, insertedRows } = createDatabase()
  const result = await processInstagramCommentWebhook(
    changesPayload(),
    createInstagramWebhookCommentStore(database),
  )
  assertEquals(result.saved_count, 1)
  assertEquals(insertedRows[0].direction, 'outbound')
  assertEquals(insertedRows[0].is_from_account, true)
  assertEquals(
    insertedRows[0].parent_external_comment_id,
    FIXTURE.parentExternalId,
  )
  assertEquals(insertedRows[0].thread_external_id, FIXTURE.parentExternalId)
})

Deno.test('direct and changes copies of the same comment dedupe before persistence', async () => {
  const value = {
    id: FIXTURE.commentExternalId,
    from: { id: FIXTURE.authorId, username: FIXTURE.authorName },
    text: FIXTURE.message,
    media: { id: FIXTURE.mediaExternalId },
  }
  const payload = {
    object: 'instagram',
    entry: [{
      id: FIXTURE.accountExternalId,
      field: 'comments',
      value,
      changes: [{ field: 'comments', value }],
    }],
  }
  const { database, insertedRows } = createDatabase()
  const result = await processInstagramCommentWebhook(
    payload,
    createInstagramWebhookCommentStore(database),
  )
  assertEquals(result.received_count, 2)
  assertEquals(result.mapped_count, 1)
  assertEquals(result.saved_count, 1)
  assertEquals(result.duplicate_count, 1)
  assertEquals(insertedRows.length, 1)
})

Deno.test('unsupported fields and incomplete comment events are trusted ignores', async () => {
  const { database, insertedRows } = createDatabase()
  const result = await processInstagramCommentWebhook({
    object: 'instagram',
    entry: [{
      id: FIXTURE.accountExternalId,
      field: 'messages',
      value: {},
      changes: [
        {
          field: 'comments',
          value: { id: FIXTURE.commentExternalId, text: 'missing media' },
        },
      ],
    }],
  }, createInstagramWebhookCommentStore(database))
  assertEquals(result.received_count, 1)
  assertEquals(result.mapped_count, 0)
  assertEquals(result.ignored_count, 1)
  assertEquals(insertedRows.length, 0)
})

Deno.test('unknown, inactive, and ambiguous accounts are ignored without writes', async () => {
  for (
    const rows of [
      [],
      [
        {
          id: 'first',
          user_id: 'first-user',
          channel_id: FIXTURE.accountExternalId,
        },
        {
          id: 'second',
          user_id: 'second-user',
          channel_id: FIXTURE.accountExternalId,
        },
      ],
    ]
  ) {
    const { database, insertedRows } = createDatabase({
      findActiveAccounts() {
        return Promise.resolve({ data: rows, error: null })
      },
    })
    const result = await processInstagramCommentWebhook(
      directPayload(),
      createInstagramWebhookCommentStore(database),
    )
    assertEquals(result.ignored_count, 1)
    assertEquals(result.saved_count, 0)
    assertEquals(insertedRows.length, 0)
  }
})

Deno.test('unknown or ambiguous media and cross-tenant task ownership are ignored', async () => {
  const mediaRows = [
    [],
    [
      {
        id: 'first-media',
        task_id: FIXTURE.taskId,
        instagram_video_id: FIXTURE.mediaExternalId,
      },
      {
        id: 'second-media',
        task_id: 'second-task',
        instagram_video_id: FIXTURE.mediaExternalId,
      },
    ],
  ]
  for (const rows of mediaRows) {
    const { database, insertedRows } = createDatabase({
      findPublishedMedia() {
        return Promise.resolve({ data: rows, error: null })
      },
    })
    const result = await processInstagramCommentWebhook(
      directPayload(),
      createInstagramWebhookCommentStore(database),
    )
    assertEquals(result.ignored_count, 1)
    assertEquals(insertedRows.length, 0)
  }

  const { database, insertedRows } = createDatabase({
    findOwnedTasks() {
      return Promise.resolve({ data: [], error: null })
    },
  })
  const crossTenantResult = await processInstagramCommentWebhook(
    directPayload(),
    createInstagramWebhookCommentStore(database),
  )
  assertEquals(crossTenantResult.ignored_count, 1)
  assertEquals(insertedRows.length, 0)
})

Deno.test('database lookup and upsert errors fail closed with stable classifications', async () => {
  const cases: Array<{
    override: Partial<InstagramWebhookDatabase>
    code: string
  }> = [
    {
      override: {
        findActiveAccounts() {
          return Promise.resolve({ data: null, error: new Error() })
        },
      },
      code: 'account_lookup_failed',
    },
    {
      override: {
        findPublishedMedia() {
          return Promise.resolve({ data: null, error: new Error() })
        },
      },
      code: 'media_lookup_failed',
    },
    {
      override: {
        findOwnedTasks() {
          return Promise.resolve({ data: null, error: new Error() })
        },
      },
      code: 'task_lookup_failed',
    },
    {
      override: {
        upsertSocialComment() {
          return Promise.resolve({ data: null, error: new Error() })
        },
      },
      code: 'comment_upsert_failed',
    },
  ]
  for (const testCase of cases) {
    const { database } = createDatabase(testCase.override)
    await assertRejects(
      () =>
        processInstagramCommentWebhook(
          directPayload(),
          createInstagramWebhookCommentStore(database),
        ),
      (error) =>
        error instanceof InstagramWebhookDatabaseError &&
        error.code === testCase.code,
    )
  }
})

Deno.test('empty INSERT RETURNING result is classified as an idempotent duplicate', async () => {
  const { database, insertedRows } = createDatabase({
    upsertSocialComment(row) {
      insertedRows.push(row)
      return Promise.resolve({ data: [], error: null })
    },
  })
  const result = await processInstagramCommentWebhook(
    directPayload(),
    createInstagramWebhookCommentStore(database),
  )
  assertEquals(result.saved_count, 0)
  assertEquals(result.duplicate_count, 1)
  assertEquals(insertedRows.length, 1)
})

Deno.test('GET challenge is exact and wrong verification token is forbidden', async () => {
  const { database } = createDatabase()
  const handler = createHandler(createInstagramWebhookCommentStore(database))
  const challenge = 'fixed-safe-challenge'
  const correct = await handler(
    new Request(
      `https://webhook.invalid/instagram-comments-webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challenge}`,
    ),
  )
  assertEquals(correct.status, 200)
  assertEquals(await correct.text(), challenge)

  const wrong = await handler(
    new Request(
      'https://webhook.invalid/instagram-comments-webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=fixed-safe-challenge',
    ),
  )
  assertEquals(wrong.status, 403)
})

Deno.test('non-exact webhook paths return 404 before all side effects', async () => {
  let envReads = 0
  let storeCreations = 0
  let bodyPulls = 0
  const capture = createLogCapture()
  const handler = createInstagramWebhookHandler({
    getEnv() {
      envReads += 1
      throw new Error('environment must not be read')
    },
    createStore() {
      storeCreations += 1
      throw new Error('store must not be created')
    },
    logger: capture.logger,
  })
  const invalidPaths = [
    '/instagram-comments-webhook/',
    '/prefix-instagram-comments-webhook',
    '/instagram-comments-webhook-suffix',
    '/instagram-comments-webhook/child',
    '/extra/instagram-comments-webhook',
    '/functions/v1/instagram-comments-webhook',
  ]

  for (const pathname of invalidPaths) {
    const getResponse = await handler(
      new Request(`https://webhook.invalid${pathname}?hub.mode=subscribe`),
    )
    assertEquals(getResponse.status, 404)
    assertEquals(getResponse.headers.get('location'), null)

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        bodyPulls += 1
        controller.enqueue(new Uint8Array([1]))
        controller.close()
      },
    }, { highWaterMark: 0 })
    const postResponse = await handler(
      new Request(`https://webhook.invalid${pathname}`, {
        method: 'POST',
        headers: {
          'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
        },
        body: stream,
      }),
    )
    assertEquals(postResponse.status, 404)
    assertEquals(postResponse.headers.get('location'), null)
  }

  assertEquals(envReads, 0)
  assertEquals(storeCreations, 0)
  assertEquals(bodyPulls, 0)
  assertEquals(capture.entries.length, 0)
})

Deno.test('unsupported methods return 405 without creating a store', async () => {
  let storeCreations = 0
  const handler = createInstagramWebhookHandler({
    getEnv: envReader(),
    createStore() {
      storeCreations += 1
      throw new Error('store must not be created')
    },
  })
  const response = await handler(
    new Request(
      'https://webhook.invalid/instagram-comments-webhook',
      { method: 'PUT' },
    ),
  )
  assertEquals(response.status, 405)
  assertEquals(response.headers.get('allow'), 'GET, POST')
  assertEquals(storeCreations, 0)
})

Deno.test('POST verifies the exact raw bytes before decoding JSON', async () => {
  const { database, insertedRows } = createDatabase()
  const handler = createHandler(createInstagramWebhookCommentStore(database))
  const raw = encodedPayload(directPayload())
  const success = await handler(await signedRequest(raw))
  assertEquals(success.status, 200)
  assertEquals(insertedRows.length, 1)

  const differentlyFormatted = new TextEncoder().encode(
    ` ${new TextDecoder().decode(raw)} `,
  )
  const rejected = await handler(
    await signedRequest(differentlyFormatted, await signatureFor(raw)),
  )
  assertEquals(rejected.status, 401)
  assertEquals(insertedRows.length, 1)
})

Deno.test('missing and malformed signatures are rejected before store creation', async () => {
  let storeCreations = 0
  const handler = createInstagramWebhookHandler({
    getEnv: envReader(),
    createStore() {
      storeCreations += 1
      throw new Error('store must not be created')
    },
  })
  const raw = encodedPayload(directPayload())
  const missing = new Request(
    'https://webhook.invalid/instagram-comments-webhook',
    {
      method: 'POST',
      body: copyToArrayBuffer(raw),
    },
  )
  assertEquals((await handler(missing)).status, 401)
  assertEquals(
    (await handler(await signedRequest(raw, 'sha256=not-hex'))).status,
    401,
  )
  assertEquals(storeCreations, 0)
})

Deno.test('Content-Length rejects oversized payload before stream reads', async () => {
  let pulls = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      controller.enqueue(new Uint8Array(1))
    },
  }, { highWaterMark: 0 })
  const request = new Request(
    'https://webhook.invalid/instagram-comments-webhook',
    {
      method: 'POST',
      headers: {
        'content-length': String(MAX_INSTAGRAM_WEBHOOK_BODY_BYTES + 1),
      },
      body: stream,
    },
  )
  assertEquals(await readRawBodyWithinLimit(request), null)
  assertEquals(pulls, 0)
})

Deno.test('chunked payload is cancelled immediately after crossing one MiB', async () => {
  let pulls = 0
  let cancelled = false
  const chunkSize = 400 * 1024
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      controller.enqueue(new Uint8Array(chunkSize))
    },
    cancel() {
      cancelled = true
    },
  }, { highWaterMark: 0 })
  const request = new Request(
    'https://webhook.invalid/instagram-comments-webhook',
    {
      method: 'POST',
      body: stream,
    },
  )
  assertEquals(await readRawBodyWithinLimit(request), null)
  assertEquals(pulls, 3)
  assertEquals(cancelled, true)
})

Deno.test('signed invalid UTF-8 and invalid JSON return stable 400 responses', async () => {
  const { database } = createDatabase()
  const handler = createHandler(createInstagramWebhookCommentStore(database))
  const invalidUtf8 = new Uint8Array([0xff, 0xfe])
  const encodingResponse = await handler(await signedRequest(invalidUtf8))
  assertEquals(encodingResponse.status, 400)
  assertEquals(
    (await encodingResponse.json()).code,
    'invalid_webhook_encoding',
  )

  const invalidJson = new TextEncoder().encode('{')
  const jsonResponse = await handler(await signedRequest(invalidJson))
  assertEquals(jsonResponse.status, 400)
  assertEquals((await jsonResponse.json()).code, 'invalid_webhook_json')
})

Deno.test('trusted unknown ownership returns 200 while database failures return 500', async () => {
  const unknownDatabase = createDatabase({
    findActiveAccounts() {
      return Promise.resolve({ data: [], error: null })
    },
  }).database
  const unknownHandler = createHandler(
    createInstagramWebhookCommentStore(unknownDatabase),
  )
  const unknownResponse = await unknownHandler(
    await signedRequest(encodedPayload(directPayload())),
  )
  assertEquals(unknownResponse.status, 200)
  const unknownBody = await unknownResponse.json()
  assertEquals(unknownBody.metadata.ignored_count, 1)

  const failingDatabase = createDatabase({
    findActiveAccounts() {
      return Promise.resolve({ data: null, error: new Error('synthetic database failure') })
    },
  }).database
  const failingHandler = createHandler(
    createInstagramWebhookCommentStore(failingDatabase),
  )
  const failureResponse = await failingHandler(
    await signedRequest(encodedPayload(directPayload())),
  )
  assertEquals(failureResponse.status, 500)
  assertEquals(
    (await failureResponse.json()).code,
    'webhook_persistence_failed',
  )
})

Deno.test('successful and failed logs and responses contain counts and stable codes only', async () => {
  const capture = createLogCapture()
  const { database } = createDatabase()
  const handler = createHandler(createInstagramWebhookCommentStore(database), {
    logger: capture.logger,
  })
  const response = await handler(
    await signedRequest(encodedPayload(directPayload())),
  )
  const serialized = JSON.stringify({
    logs: capture.entries,
    body: await response.json(),
  })
  for (
    const sensitiveValue of [
      APP_SECRET,
      VERIFY_TOKEN,
      SERVICE_ROLE,
      FIXTURE.accountExternalId,
      FIXTURE.mediaExternalId,
      FIXTURE.commentExternalId,
      FIXTURE.authorName,
      FIXTURE.message,
    ]
  ) {
    assert(
      !serialized.includes(sensitiveValue),
      'Safe output included a sensitive fixture value',
    )
  }
  assert(serialized.includes('saved_count'))
})

Deno.test('production module is importable without starting a server', () => {
  assertEquals(typeof productionHandler, 'function')
})

Deno.test('Edge Function source fixes tables and has no Graph, token, reply, or sync side effects', async () => {
  const moduleUrl = new URL('./index.ts', import.meta.url)
  const coreUrl = new URL('./core.ts', import.meta.url)
  const source = `${await Deno.readTextFile(moduleUrl)}\n${await Deno
    .readTextFile(coreUrl)}`
  for (
    const table of [
      'instagram_accounts',
      'instagram_publish_task_items',
      'instagram_publish_tasks',
      'social_comments',
    ]
  ) {
    assert(
      source.includes(`.from('${table}')`),
      `Missing fixed table ${table}`,
    )
  }
  for (
    const forbidden of [
      'fetch(',
      'graph.instagram.com',
      'graph.facebook.com',
      'access_token',
      'refresh_token',
      "from('instagram_access_tokens')",
      "from('social_comment_action_logs')",
      "from('social_comment_sync_runs')",
    ]
  ) {
    assert(
      !source.includes(forbidden),
      `Forbidden external side effect marker: ${forbidden}`,
    )
  }
})

Deno.test('stored comment row carries explicit tenant, content, direction, and webhook metadata', async () => {
  const storedRows: InstagramWebhookCommentRow[] = []
  const store: InstagramWebhookCommentStore = {
    findActiveAccount() {
      return Promise.resolve({
        id: FIXTURE.accountId,
        userId: FIXTURE.userId,
        externalId: FIXTURE.accountExternalId,
      })
    },
    findPublishedMedia() {
      return Promise.resolve({ id: FIXTURE.mediaRowId, externalId: FIXTURE.mediaExternalId })
    },
    upsertComment(row) {
      storedRows.push(row)
      return Promise.resolve('saved')
    },
  }
  await processInstagramCommentWebhook(
    directPayload({
      from: { id: FIXTURE.authorId, username: FIXTURE.authorName },
    }),
    store,
  )
  assertEquals(storedRows.length, 1)
  const storedRow = storedRows[0]
  assertEquals(storedRow.userId, FIXTURE.userId)
  assertEquals(storedRow.accountId, FIXTURE.accountId)
  assertEquals(storedRow.taskItemId, FIXTURE.mediaRowId)
  assertEquals(storedRow.externalContentId, FIXTURE.mediaExternalId)
  assertEquals(storedRow.direction, 'inbound')
  assertEquals(storedRow.isFromAccount, false)
})
