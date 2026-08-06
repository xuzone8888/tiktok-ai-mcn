import {
  type DatabaseResult,
  readRawBodyWithinLimit,
  resolveSupabaseAdminConfiguration,
  type SafeLogger,
  type SupabaseAdminConfiguration,
  verifyMetaSignature,
} from '../instagram-comments-webhook/core.js'

export const FACEBOOK_WEBHOOK_PATHNAME = '/facebook-comments-webhook'

export interface FacebookWebhookCommentEvent {
  accountExternalId: string
  postExternalId: string
  contentCandidates: string[]
  commentExternalId: string
  authorId: string | null
  authorName: string | null
  message: string
  createdAt: string | null
  parentExternalCommentId: string | null
}

export interface FacebookWebhookCommentRow {
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

export interface OwnedFacebookAccount {
  id: string
  userId: string
  externalId: string
}

export interface OwnedFacebookContent {
  id: string
  externalId: string
}

export interface FacebookWebhookCommentStore {
  findActiveAccount(accountExternalId: string): Promise<OwnedFacebookAccount | null>
  findPublishedContent(
    userId: string,
    accountId: string,
    contentCandidates: string[],
  ): Promise<OwnedFacebookContent | null>
  upsertComment(row: FacebookWebhookCommentRow): Promise<'saved' | 'duplicate'>
}

export interface FacebookAccountRecord {
  id: string
  user_id: string
  channel_id: string
}

export interface FacebookContentRecord {
  id: string
  task_id: string
  facebook_video_id: string
  facebook_post_id: string | null
}

export interface FacebookTaskRecord {
  id: string
}

export interface FacebookWebhookDatabase {
  findActiveAccounts(accountExternalId: string): Promise<DatabaseResult<FacebookAccountRecord[]>>
  findPublishedContent(
    accountId: string,
    contentCandidates: string[],
  ): Promise<DatabaseResult<FacebookContentRecord[]>>
  findOwnedTasks(taskId: string, userId: string): Promise<DatabaseResult<FacebookTaskRecord[]>>
  upsertSocialComment(
    row: Record<string, unknown>,
  ): Promise<DatabaseResult<Array<{ id: string }>>>
}

export interface FacebookWebhookProcessResult {
  source: 'webhook'
  received_count: number
  mapped_count: number
  saved_count: number
  ignored_count: number
  duplicate_count: number
  error_count: number
}

export interface FacebookWebhookReceipt {
  provider: 'facebook'
  status: 'rejected' | 'failed' | 'processed'
  step: 'body' | 'configuration' | 'signature' | 'encoding' | 'json' | 'processing' | 'completed'
  signatureValid: boolean | null
  bodyLength: number | null
  httpStatus: number
  errorCode: string | null
  metadata?: Record<string, number>
}

export interface FacebookWebhookHandlerDependencies {
  getEnv(name: string): string | undefined
  createStore(config: SupabaseAdminConfiguration): FacebookWebhookCommentStore
  recordReceipt?(receipt: FacebookWebhookReceipt): Promise<void>
  logger?: SafeLogger
}

export class FacebookWebhookPayloadError extends Error {
  readonly code = 'invalid_webhook_payload'

  constructor() {
    super('Invalid Facebook webhook payload.')
    this.name = 'FacebookWebhookPayloadError'
  }
}

export class FacebookWebhookDatabaseError extends Error {
  constructor(readonly code: string) {
    super('Facebook webhook persistence failed.')
    this.name = 'FacebookWebhookDatabaseError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function timestampValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const milliseconds = value >= 1_000_000_000_000 ? value : value * 1000
  const parsed = new Date(milliseconds)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function contentCandidates(pageId: string, postId: string): string[] {
  const candidates = new Set<string>([postId])
  const prefix = `${pageId}_`
  if (postId.startsWith(prefix) && postId.length > prefix.length) {
    candidates.add(postId.slice(prefix.length))
  }
  return [...candidates]
}

export function parseFacebookCommentEvents(body: unknown): {
  receivedCount: number
  ignoredCount: number
  duplicateCount: number
  events: FacebookWebhookCommentEvent[]
} {
  if (!isRecord(body)) throw new FacebookWebhookPayloadError()
  if (body.object !== 'page') {
    return { receivedCount: 0, ignoredCount: 0, duplicateCount: 0, events: [] }
  }
  if (!Array.isArray(body.entry)) throw new FacebookWebhookPayloadError()

  let receivedCount = 0
  let ignoredCount = 0
  let duplicateCount = 0
  const events: FacebookWebhookCommentEvent[] = []
  const seen = new Set<string>()

  for (const rawEntry of body.entry) {
    if (!isRecord(rawEntry)) continue
    const accountExternalId = textValue(rawEntry.id)
    if (!Array.isArray(rawEntry.changes)) continue

    for (const rawChange of rawEntry.changes) {
      if (!isRecord(rawChange) || rawChange.field !== 'feed') continue
      receivedCount += 1
      const value = isRecord(rawChange.value) ? rawChange.value : null
      if (!value || value.item !== 'comment' || value.verb !== 'add') {
        ignoredCount += 1
        continue
      }

      const postExternalId = textValue(value.post_id)
      const commentExternalId = textValue(value.comment_id)
      if (!accountExternalId || !postExternalId || !commentExternalId) {
        ignoredCount += 1
        continue
      }

      const dedupeKey = `${accountExternalId}:${postExternalId}:${commentExternalId}`
      if (seen.has(dedupeKey)) {
        duplicateCount += 1
        continue
      }
      seen.add(dedupeKey)

      const rawParent = textValue(value.parent_id)
      events.push({
        accountExternalId,
        postExternalId,
        contentCandidates: contentCandidates(accountExternalId, postExternalId),
        commentExternalId,
        authorId: textValue(value.sender_id) || null,
        authorName: textValue(value.sender_name) || null,
        message: textValue(value.message),
        createdAt: timestampValue(value.created_time),
        parentExternalCommentId: rawParent && rawParent !== postExternalId ? rawParent : null,
      })
    }
  }

  return { receivedCount, ignoredCount, duplicateCount, events }
}

export function createFacebookWebhookCommentStore(
  database: FacebookWebhookDatabase,
): FacebookWebhookCommentStore {
  return {
    async findActiveAccount(accountExternalId) {
      const result = await database.findActiveAccounts(accountExternalId)
      if (result.error) throw new FacebookWebhookDatabaseError('account_lookup_failed')
      if (!Array.isArray(result.data)) {
        throw new FacebookWebhookDatabaseError('account_lookup_invalid_result')
      }
      if (result.data.length !== 1) return null
      const row = result.data[0]
      return { id: row.id, userId: row.user_id, externalId: row.channel_id }
    },

    async findPublishedContent(userId, accountId, candidates) {
      const contentResult = await database.findPublishedContent(accountId, candidates)
      if (contentResult.error) throw new FacebookWebhookDatabaseError('content_lookup_failed')
      if (!Array.isArray(contentResult.data)) {
        throw new FacebookWebhookDatabaseError('content_lookup_invalid_result')
      }
      if (contentResult.data.length !== 1) return null

      const content = contentResult.data[0]
      const taskResult = await database.findOwnedTasks(content.task_id, userId)
      if (taskResult.error) throw new FacebookWebhookDatabaseError('task_lookup_failed')
      if (!Array.isArray(taskResult.data)) {
        throw new FacebookWebhookDatabaseError('task_lookup_invalid_result')
      }
      if (taskResult.data.length !== 1) return null
      return { id: content.id, externalId: content.facebook_video_id }
    },

    async upsertComment(row) {
      const now = new Date().toISOString()
      const result = await database.upsertSocialComment({
        user_id: row.userId,
        platform: 'facebook',
        account_id: row.accountId,
        task_item_id: row.taskItemId,
        external_content_id: row.externalContentId,
        external_comment_id: row.externalCommentId,
        parent_external_comment_id: row.parentExternalCommentId,
        thread_external_id: row.parentExternalCommentId || row.externalCommentId,
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
        metadata: { source: 'webhook', event_type: 'feed.comment.add' },
        remote_created_at: row.createdAt,
        last_synced_at: now,
        reply_to_comment_id: null,
        local_error_code: null,
        local_error_message: null,
        updated_at: now,
      })
      if (result.error) throw new FacebookWebhookDatabaseError('comment_upsert_failed')
      if (!Array.isArray(result.data)) {
        throw new FacebookWebhookDatabaseError('comment_upsert_invalid_result')
      }
      return result.data.length > 0 ? 'saved' : 'duplicate'
    },
  }
}

export async function processFacebookCommentWebhook(
  body: unknown,
  store: FacebookWebhookCommentStore,
): Promise<FacebookWebhookProcessResult> {
  const parsed = parseFacebookCommentEvents(body)
  let savedCount = 0
  let ignoredCount = parsed.ignoredCount
  let duplicateCount = parsed.duplicateCount

  for (const event of parsed.events) {
    const account = await store.findActiveAccount(event.accountExternalId)
    if (!account) {
      ignoredCount += 1
      continue
    }
    const content = await store.findPublishedContent(
      account.userId,
      account.id,
      event.contentCandidates,
    )
    if (!content) {
      ignoredCount += 1
      continue
    }
    const isFromAccount = Boolean(event.authorId && event.authorId === account.externalId)
    const persistence = await store.upsertComment({
      userId: account.userId,
      accountId: account.id,
      taskItemId: content.id,
      accountExternalId: account.externalId,
      externalContentId: content.externalId,
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

function jsonResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status })
}

export function createFacebookWebhookHandler(
  dependencies: FacebookWebhookHandlerDependencies,
): (request: Request) => Promise<Response> {
  const logger = dependencies.logger ?? console

  async function recordReceipt(receipt: FacebookWebhookReceipt) {
    if (!dependencies.recordReceipt) return
    try {
      await dependencies.recordReceipt(receipt)
    } catch {
      logger.error('Facebook webhook receipt persistence failed', {
        code: 'webhook_receipt_persistence_failed',
        error_count: 1,
      })
    }
  }

  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname
    if (pathname !== FACEBOOK_WEBHOOK_PATHNAME) return new Response(null, { status: 404 })

    if (request.method === 'GET') {
      const verifyToken = textValue(dependencies.getEnv('FACEBOOK_WEBHOOK_VERIFY_TOKEN'))
      if (!verifyToken) {
        return jsonResponse(500, 'webhook_configuration_unavailable', 'Webhook unavailable')
      }
      const url = new URL(request.url)
      const mode = url.searchParams.get('hub.mode')
      const token = url.searchParams.get('hub.verify_token') ?? ''
      const challenge = url.searchParams.get('hub.challenge')
      if (mode === 'subscribe' && challenge && token && constantTimeTextEqual(token, verifyToken)) {
        return new Response(challenge, {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }
      return jsonResponse(403, 'webhook_verification_failed', 'Webhook verification failed')
    }

    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
    }

    let rawBody: Uint8Array | null
    try {
      rawBody = await readRawBodyWithinLimit(request)
    } catch {
      await recordReceipt({
        provider: 'facebook',
        status: 'rejected',
        step: 'body',
        signatureValid: null,
        bodyLength: null,
        httpStatus: 400,
        errorCode: 'invalid_webhook_body',
      })
      return jsonResponse(400, 'invalid_webhook_body', 'Invalid webhook payload')
    }
    if (!rawBody) {
      await recordReceipt({
        provider: 'facebook',
        status: 'rejected',
        step: 'body',
        signatureValid: null,
        bodyLength: null,
        httpStatus: 413,
        errorCode: 'payload_too_large',
      })
      return jsonResponse(413, 'payload_too_large', 'Webhook payload too large')
    }

    const appSecret = textValue(dependencies.getEnv('FACEBOOK_CLIENT_SECRET'))
    if (!appSecret) {
      await recordReceipt({
        provider: 'facebook',
        status: 'failed',
        step: 'configuration',
        signatureValid: null,
        bodyLength: rawBody.byteLength,
        httpStatus: 500,
        errorCode: 'webhook_configuration_unavailable',
      })
      return jsonResponse(500, 'webhook_configuration_unavailable', 'Webhook unavailable')
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
        provider: 'facebook',
        status: 'rejected',
        step: 'signature',
        signatureValid: false,
        bodyLength: rawBody.byteLength,
        httpStatus: 401,
        errorCode: 'invalid_signature',
      })
      return jsonResponse(401, 'invalid_signature', 'Invalid signature')
    }

    let rawText: string
    try {
      rawText = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    } catch {
      await recordReceipt({
        provider: 'facebook',
        status: 'rejected',
        step: 'encoding',
        signatureValid: true,
        bodyLength: rawBody.byteLength,
        httpStatus: 400,
        errorCode: 'invalid_webhook_encoding',
      })
      return jsonResponse(400, 'invalid_webhook_encoding', 'Invalid webhook payload')
    }

    let body: unknown
    try {
      body = JSON.parse(rawText)
    } catch {
      await recordReceipt({
        provider: 'facebook',
        status: 'rejected',
        step: 'json',
        signatureValid: true,
        bodyLength: rawBody.byteLength,
        httpStatus: 400,
        errorCode: 'invalid_webhook_json',
      })
      return jsonResponse(400, 'invalid_webhook_json', 'Invalid webhook payload')
    }

    try {
      const config = resolveSupabaseAdminConfiguration(dependencies.getEnv)
      const result = await processFacebookCommentWebhook(body, dependencies.createStore(config))
      logger.info('Facebook webhook processed', { ...result })
      await recordReceipt({
        provider: 'facebook',
        status: 'processed',
        step: 'completed',
        signatureValid: true,
        bodyLength: rawBody.byteLength,
        httpStatus: 200,
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
      if (error instanceof FacebookWebhookPayloadError) {
        await recordReceipt({
          provider: 'facebook',
          status: 'rejected',
          step: 'processing',
          signatureValid: true,
          bodyLength: rawBody.byteLength,
          httpStatus: 400,
          errorCode: error.code,
        })
        return jsonResponse(400, error.code, 'Invalid webhook payload')
      }
      const isDatabaseError = error instanceof FacebookWebhookDatabaseError
      const code = isDatabaseError ? 'webhook_persistence_failed' : 'webhook_processing_failed'
      logger.error('Facebook webhook processing failed', { code, error_count: 1 })
      await recordReceipt({
        provider: 'facebook',
        status: 'failed',
        step: isDatabaseError ? 'processing' : 'configuration',
        signatureValid: true,
        bodyLength: rawBody.byteLength,
        httpStatus: 500,
        errorCode: code,
      })
      return jsonResponse(500, code, 'Webhook processing failed')
    }
  }
}
