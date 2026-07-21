export const MAX_INSTAGRAM_WEBHOOK_BODY_BYTES = 1024 * 1024
export const INSTAGRAM_WEBHOOK_PATHNAME = '/instagram-comments-webhook'

export interface SupabaseAdminConfiguration {
  supabaseUrl: string
  serviceRoleKey: string
}

export interface InstagramWebhookCommentEvent {
  accountExternalId: string
  mediaExternalId: string
  commentExternalId: string
  authorId: string | null
  authorName: string | null
  message: string
  createdAt: string | null
  parentExternalCommentId: string | null
}

export interface OwnedInstagramAccount {
  id: string
  userId: string
  externalId: string
}

export interface OwnedInstagramMedia {
  id: string
  externalId: string
}

export interface InstagramWebhookCommentRow {
  userId: string
  accountId: string
  taskItemId: string
  accountExternalId: string
  externalContentId: string
  externalCommentId: string
  authorId: string | null
  authorName: string | null
  message: string
  direction: 'inbound' | 'outbound'
  isFromAccount: boolean
  createdAt: string | null
  parentExternalCommentId: string | null
}

export interface InstagramWebhookCommentStore {
  findActiveAccount(
    accountExternalId: string,
  ): Promise<OwnedInstagramAccount | null>
  findPublishedMedia(
    userId: string,
    accountId: string,
    mediaExternalId: string,
  ): Promise<OwnedInstagramMedia | null>
  upsertComment(
    row: InstagramWebhookCommentRow,
  ): Promise<'saved' | 'duplicate'>
}

export interface InstagramWebhookProcessResult {
  source: 'webhook'
  received_count: number
  mapped_count: number
  saved_count: number
  ignored_count: number
  duplicate_count: number
  error_count: number
}

export interface InstagramAccountRecord {
  id: string
  user_id: string
  channel_id: string
}

export interface InstagramMediaRecord {
  id: string
  task_id: string
  instagram_video_id: string
}

export interface InstagramTaskRecord {
  id: string
}

export interface DatabaseResult<T> {
  data: T | null
  error: unknown
}

export interface InstagramWebhookDatabase {
  findActiveAccounts(
    accountExternalId: string,
  ): Promise<DatabaseResult<InstagramAccountRecord[]>>
  findPublishedMedia(
    accountId: string,
    mediaExternalId: string,
  ): Promise<DatabaseResult<InstagramMediaRecord[]>>
  findOwnedTasks(
    taskId: string,
    userId: string,
  ): Promise<DatabaseResult<InstagramTaskRecord[]>>
  upsertSocialComment(
    row: Record<string, unknown>,
  ): Promise<DatabaseResult<Array<{ id: string }>>>
}

export interface SafeLogger {
  info(message: string, metadata: Record<string, unknown>): void
  error(message: string, metadata: Record<string, unknown>): void
}

export interface InstagramWebhookReceipt {
  provider: 'instagram'
  status: 'rejected' | 'failed' | 'processed'
  step: 'body' | 'configuration' | 'signature' | 'encoding' | 'json' | 'processing' | 'completed'
  signatureValid: boolean | null
  bodyLength: number | null
  httpStatus: number
  errorCode: string | null
  metadata?: Record<string, number>
}

export interface InstagramWebhookHandlerDependencies {
  getEnv(name: string): string | undefined
  createStore(config: SupabaseAdminConfiguration): InstagramWebhookCommentStore
  recordReceipt?(receipt: InstagramWebhookReceipt): Promise<void>
  logger?: SafeLogger
}

export class InstagramWebhookPayloadError extends Error {
  readonly code = 'invalid_webhook_payload'

  constructor() {
    super('Invalid Instagram webhook payload.')
    this.name = 'InstagramWebhookPayloadError'
  }
}

export class InstagramWebhookConfigurationError extends Error {
  constructor(readonly code: string) {
    super('Instagram webhook configuration is unavailable.')
    this.name = 'InstagramWebhookConfigurationError'
  }
}

export class InstagramWebhookDatabaseError extends Error {
  constructor(readonly code: string) {
    super('Instagram webhook persistence failed.')
    this.name = 'InstagramWebhookDatabaseError'
  }
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function timestampValue(value: unknown): string | null {
  const text = textValue(value)
  if (text) return text
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  const milliseconds = value >= 1_000_000_000_000 ? value : value * 1000
  const parsed = new Date(milliseconds)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseInstagramCommentEvents(body: unknown): {
  receivedCount: number
  ignoredCount: number
  duplicateCount: number
  events: InstagramWebhookCommentEvent[]
} {
  if (!isRecord(body)) throw new InstagramWebhookPayloadError()
  if (body.object !== 'instagram') {
    return { receivedCount: 0, ignoredCount: 0, duplicateCount: 0, events: [] }
  }
  if (!Array.isArray(body.entry)) throw new InstagramWebhookPayloadError()

  let receivedCount = 0
  let ignoredCount = 0
  let duplicateCount = 0
  const events: InstagramWebhookCommentEvent[] = []
  const seen = new Set<string>()

  for (const rawEntry of body.entry) {
    if (!isRecord(rawEntry)) continue
    const accountExternalId = textValue(rawEntry.id)
    const candidates: unknown[] = []
    if (Object.hasOwn(rawEntry, 'field') || Object.hasOwn(rawEntry, 'value')) {
      candidates.push({ field: rawEntry.field, value: rawEntry.value })
    }
    if (Array.isArray(rawEntry.changes)) candidates.push(...rawEntry.changes)

    for (const rawChange of candidates) {
      if (!isRecord(rawChange) || rawChange.field !== 'comments') continue
      receivedCount += 1

      const value = isRecord(rawChange.value) ? rawChange.value : null
      const media = value && isRecord(value.media) ? value.media : null
      const from = value && isRecord(value.from) ? value.from : null
      const parent = value && isRecord(value.parent) ? value.parent : null
      const commentExternalId = textValue(value?.id)
      const mediaExternalId = textValue(media?.id)
      const message = textValue(value?.text)
      if (
        !accountExternalId || !commentExternalId || !mediaExternalId || !message
      ) {
        ignoredCount += 1
        continue
      }

      const dedupeKey = `${accountExternalId}:${mediaExternalId}:${commentExternalId}`
      if (seen.has(dedupeKey)) {
        duplicateCount += 1
        continue
      }
      seen.add(dedupeKey)

      events.push({
        accountExternalId,
        mediaExternalId,
        commentExternalId,
        authorId: textValue(from?.id) || null,
        authorName: textValue(from?.username) || null,
        message,
        createdAt: timestampValue(value?.timestamp ?? value?.created_time),
        parentExternalCommentId: textValue(value?.parent_id ?? parent?.id) ||
          null,
      })
    }
  }

  return { receivedCount, ignoredCount, duplicateCount, events }
}

export function resolveSupabaseAdminConfiguration(
  getEnv: (name: string) => string | undefined,
): SupabaseAdminConfiguration {
  const supabaseUrl = textValue(getEnv('SUPABASE_URL'))
  if (!supabaseUrl) {
    throw new InstagramWebhookConfigurationError('missing_supabase_url')
  }
  try {
    const parsed = new URL(supabaseUrl)
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      !parsed.hostname
    ) {
      throw new Error('invalid')
    }
  } catch {
    throw new InstagramWebhookConfigurationError('invalid_supabase_url')
  }

  const secretKeysJson = getEnv('SUPABASE_SECRET_KEYS')
  let serviceRoleKey = ''
  if (secretKeysJson !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(secretKeysJson)
    } catch {
      throw new InstagramWebhookConfigurationError(
        'invalid_supabase_secret_keys',
      )
    }
    if (!isRecord(parsed) || !Object.hasOwn(parsed, 'default')) {
      throw new InstagramWebhookConfigurationError(
        'invalid_supabase_secret_keys',
      )
    }
    serviceRoleKey = textValue(parsed.default)
    if (!serviceRoleKey) {
      throw new InstagramWebhookConfigurationError(
        'invalid_supabase_secret_keys',
      )
    }
  } else {
    serviceRoleKey = textValue(getEnv('SUPABASE_SERVICE_ROLE_KEY'))
    if (!serviceRoleKey) {
      throw new InstagramWebhookConfigurationError(
        'missing_supabase_service_role_key',
      )
    }
  }

  return { supabaseUrl, serviceRoleKey }
}

export function createInstagramWebhookCommentStore(
  database: InstagramWebhookDatabase,
): InstagramWebhookCommentStore {
  return {
    async findActiveAccount(accountExternalId) {
      const result = await database.findActiveAccounts(accountExternalId)
      if (result.error) {
        throw new InstagramWebhookDatabaseError('account_lookup_failed')
      }
      if (!Array.isArray(result.data)) {
        throw new InstagramWebhookDatabaseError(
          'account_lookup_invalid_result',
        )
      }
      if (result.data.length !== 1) return null
      const row = result.data[0]
      return { id: row.id, userId: row.user_id, externalId: row.channel_id }
    },

    async findPublishedMedia(userId, accountId, mediaExternalId) {
      const mediaResult = await database.findPublishedMedia(
        accountId,
        mediaExternalId,
      )
      if (mediaResult.error) {
        throw new InstagramWebhookDatabaseError('media_lookup_failed')
      }
      if (!Array.isArray(mediaResult.data)) {
        throw new InstagramWebhookDatabaseError('media_lookup_invalid_result')
      }
      if (mediaResult.data.length !== 1) return null

      const media = mediaResult.data[0]
      const taskResult = await database.findOwnedTasks(media.task_id, userId)
      if (taskResult.error) {
        throw new InstagramWebhookDatabaseError('task_lookup_failed')
      }
      if (!Array.isArray(taskResult.data)) {
        throw new InstagramWebhookDatabaseError('task_lookup_invalid_result')
      }
      if (taskResult.data.length !== 1) return null

      return { id: media.id, externalId: media.instagram_video_id }
    },

    async upsertComment(row) {
      const now = new Date().toISOString()
      const result = await database.upsertSocialComment({
        user_id: row.userId,
        platform: 'instagram',
        account_id: row.accountId,
        task_item_id: row.taskItemId,
        external_content_id: row.externalContentId,
        external_comment_id: row.externalCommentId,
        parent_external_comment_id: row.parentExternalCommentId,
        thread_external_id: row.parentExternalCommentId ||
          row.externalCommentId,
        direction: row.direction,
        author_id: row.authorId,
        author_name: row.authorName,
        author_avatar_url: null,
        message: row.message,
        like_count: 0,
        reply_count: 0,
        can_reply: !row.isFromAccount,
        is_from_account: row.isFromAccount,
        permalink: null,
        status: row.isFromAccount ? 'sent' : 'synced',
        metadata: { source: 'webhook', event_type: 'comments' },
        remote_created_at: row.createdAt,
        last_synced_at: now,
        reply_to_comment_id: null,
        local_error_code: null,
        local_error_message: null,
        updated_at: now,
      })
      if (result.error) {
        throw new InstagramWebhookDatabaseError('comment_upsert_failed')
      }
      if (!Array.isArray(result.data)) {
        throw new InstagramWebhookDatabaseError(
          'comment_upsert_invalid_result',
        )
      }
      return result.data.length > 0 ? 'saved' : 'duplicate'
    },
  }
}

export async function processInstagramCommentWebhook(
  body: unknown,
  store: InstagramWebhookCommentStore,
): Promise<InstagramWebhookProcessResult> {
  const parsed = parseInstagramCommentEvents(body)
  let savedCount = 0
  let ignoredCount = parsed.ignoredCount
  let duplicateCount = parsed.duplicateCount

  for (const event of parsed.events) {
    const account = await store.findActiveAccount(event.accountExternalId)
    if (!account) {
      ignoredCount += 1
      continue
    }

    const media = await store.findPublishedMedia(
      account.userId,
      account.id,
      event.mediaExternalId,
    )
    if (!media) {
      ignoredCount += 1
      continue
    }

    const isFromAccount = Boolean(
      event.authorId && event.authorId === account.externalId,
    )
    const persistence = await store.upsertComment({
      userId: account.userId,
      accountId: account.id,
      taskItemId: media.id,
      accountExternalId: account.externalId,
      externalContentId: media.externalId,
      externalCommentId: event.commentExternalId,
      authorId: event.authorId,
      authorName: event.authorName,
      message: event.message,
      direction: isFromAccount ? 'outbound' : 'inbound',
      isFromAccount,
      createdAt: event.createdAt,
      parentExternalCommentId: event.parentExternalCommentId,
    })
    if (persistence === 'duplicate') duplicateCount += 1
    else savedCount += 1
  }

  return {
    source: 'webhook',
    received_count: parsed.receivedCount,
    mapped_count: parsed.events.length,
    saved_count: savedCount,
    ignored_count: ignoredCount,
    duplicate_count: duplicateCount,
    error_count: 0,
  }
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}

function decodeHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null
  const output = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2) {
    output[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  }
  return output
}

function copyToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

export async function verifyMetaSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (
    !signatureHeader || !appSecret || !signatureHeader.startsWith('sha256=')
  ) return false
  const provided = decodeHex(signatureHeader.slice('sha256='.length))
  if (!provided) return false
  const key = await crypto.subtle.importKey(
    'raw',
    copyToArrayBuffer(new TextEncoder().encode(appSecret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    'HMAC',
    key,
    copyToArrayBuffer(provided),
    copyToArrayBuffer(rawBody),
  )
}

export async function readRawBodyWithinLimit(
  request: Request,
): Promise<Uint8Array | null> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (
      !Number.isInteger(parsedLength) || parsedLength < 0 ||
      parsedLength > MAX_INSTAGRAM_WEBHOOK_BODY_BYTES
    ) {
      return null
    }
  }
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      totalBytes += value.byteLength
      if (totalBytes > MAX_INSTAGRAM_WEBHOOK_BODY_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // The request is already rejected as oversized.
        }
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function jsonResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status })
}

function configErrorCode(error: InstagramWebhookConfigurationError): string {
  return error.code === 'invalid_supabase_secret_keys'
    ? 'webhook_secret_configuration_invalid'
    : 'webhook_configuration_unavailable'
}

export function createInstagramWebhookHandler(
  dependencies: InstagramWebhookHandlerDependencies,
): (request: Request) => Promise<Response> {
  const logger = dependencies.logger ?? console

  async function recordReceipt(receipt: InstagramWebhookReceipt) {
    if (!dependencies.recordReceipt) return
    try {
      await dependencies.recordReceipt(receipt)
    } catch {
      logger.error('Instagram webhook receipt persistence failed', {
        code: 'webhook_receipt_persistence_failed',
        error_count: 1,
      })
    }
  }

  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname
    if (pathname !== INSTAGRAM_WEBHOOK_PATHNAME) {
      return new Response(null, { status: 404 })
    }

    if (request.method === 'GET') {
      const verifyToken = textValue(
        dependencies.getEnv('INSTAGRAM_WEBHOOK_VERIFY_TOKEN'),
      )
      if (!verifyToken) {
        logger.error('Instagram webhook configuration failed', {
          code: 'missing_webhook_verify_token',
          error_count: 1,
        })
        return jsonResponse(
          500,
          'webhook_configuration_unavailable',
          'Webhook unavailable',
        )
      }
      const url = new URL(request.url)
      const mode = url.searchParams.get('hub.mode')
      const token = url.searchParams.get('hub.verify_token') ?? ''
      const challenge = url.searchParams.get('hub.challenge')
      if (
        mode === 'subscribe' && challenge && token &&
        constantTimeTextEqual(token, verifyToken)
      ) {
        return new Response(challenge, {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }
      return jsonResponse(
        403,
        'webhook_verification_failed',
        'Webhook verification failed',
      )
    }

    if (request.method !== 'POST') {
      return new Response(null, {
        status: 405,
        headers: { allow: 'GET, POST' },
      })
    }

    let rawBody: Uint8Array | null
    try {
      rawBody = await readRawBodyWithinLimit(request)
    } catch {
      await recordReceipt({
        provider: 'instagram', status: 'rejected', step: 'body',
        signatureValid: null, bodyLength: null, httpStatus: 400,
        errorCode: 'invalid_webhook_body',
      })
      return jsonResponse(
        400,
        'invalid_webhook_body',
        'Invalid webhook payload',
      )
    }
    if (!rawBody) {
      await recordReceipt({
        provider: 'instagram', status: 'rejected', step: 'body',
        signatureValid: null, bodyLength: null, httpStatus: 413,
        errorCode: 'payload_too_large',
      })
      return jsonResponse(
        413,
        'payload_too_large',
        'Webhook payload too large',
      )
    }

    const appSecret = textValue(
      dependencies.getEnv('INSTAGRAM_NATIVE_CLIENT_SECRET'),
    )
    if (!appSecret) {
      logger.error('Instagram webhook configuration failed', {
        code: 'missing_native_app_secret',
        error_count: 1,
      })
      await recordReceipt({
        provider: 'instagram', status: 'failed', step: 'configuration',
        signatureValid: null, bodyLength: rawBody.byteLength, httpStatus: 500,
        errorCode: 'webhook_configuration_unavailable',
      })
      return jsonResponse(
        500,
        'webhook_configuration_unavailable',
        'Webhook unavailable',
      )
    }

    let signatureValid = false
    try {
      signatureValid = await verifyMetaSignature(
        rawBody,
        request.headers.get('x-hub-signature-256'),
        appSecret,
      )
    } catch {
      signatureValid = false
    }
    if (!signatureValid) {
      await recordReceipt({
        provider: 'instagram', status: 'rejected', step: 'signature',
        signatureValid: false, bodyLength: rawBody.byteLength, httpStatus: 401,
        errorCode: 'invalid_signature',
      })
      return jsonResponse(401, 'invalid_signature', 'Invalid signature')
    }

    let rawText: string
    try {
      rawText = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    } catch {
      await recordReceipt({
        provider: 'instagram', status: 'rejected', step: 'encoding',
        signatureValid: true, bodyLength: rawBody.byteLength, httpStatus: 400,
        errorCode: 'invalid_webhook_encoding',
      })
      return jsonResponse(
        400,
        'invalid_webhook_encoding',
        'Invalid webhook payload',
      )
    }

    let body: unknown
    try {
      body = JSON.parse(rawText)
    } catch {
      await recordReceipt({
        provider: 'instagram', status: 'rejected', step: 'json',
        signatureValid: true, bodyLength: rawBody.byteLength, httpStatus: 400,
        errorCode: 'invalid_webhook_json',
      })
      return jsonResponse(
        400,
        'invalid_webhook_json',
        'Invalid webhook payload',
      )
    }

    try {
      const config = resolveSupabaseAdminConfiguration(dependencies.getEnv)
      const result = await processInstagramCommentWebhook(
        body,
        dependencies.createStore(config),
      )
      logger.info('Instagram webhook processed', { ...result })
      await recordReceipt({
        provider: 'instagram', status: 'processed', step: 'completed',
        signatureValid: true, bodyLength: rawBody.byteLength, httpStatus: 200,
        errorCode: null,
        metadata: {
          received_count: result.received_count,
          mapped_count: result.mapped_count,
          saved_count: result.saved_count,
          ignored_count: result.ignored_count,
          duplicate_count: result.duplicate_count,
          error_count: result.error_count,
        },
      })
      return Response.json({ received: true, metadata: result })
    } catch (error) {
      if (error instanceof InstagramWebhookPayloadError) {
        await recordReceipt({
          provider: 'instagram', status: 'rejected', step: 'processing',
          signatureValid: true, bodyLength: rawBody.byteLength, httpStatus: 400,
          errorCode: error.code,
        })
        return jsonResponse(400, error.code, 'Invalid webhook payload')
      }
      if (error instanceof InstagramWebhookConfigurationError) {
        const code = configErrorCode(error)
        logger.error('Instagram webhook configuration failed', {
          code,
          error_count: 1,
        })
        await recordReceipt({
          provider: 'instagram', status: 'failed', step: 'configuration',
          signatureValid: true, bodyLength: rawBody.byteLength, httpStatus: 500,
          errorCode: code,
        })
        return jsonResponse(500, code, 'Webhook unavailable')
      }
      const code = error instanceof InstagramWebhookDatabaseError
        ? 'webhook_persistence_failed'
        : 'webhook_processing_failed'
      logger.error('Instagram webhook processing failed', {
        code,
        error_count: 1,
      })
      await recordReceipt({
        provider: 'instagram', status: 'failed', step: 'processing',
        signatureValid: true, bodyLength: rawBody.byteLength, httpStatus: 500,
        errorCode: code,
      })
      return jsonResponse(500, code, 'Webhook processing failed')
    }
  }
}
