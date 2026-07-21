import { createAdminClient } from '@/lib/supabase/admin'

interface InstagramWebhookCommentEvent {
  accountExternalId: string
  mediaExternalId: string
  commentExternalId: string
  authorId: string | null
  authorName: string | null
  message: string
  createdAt: string | null
  parentExternalCommentId: string | null
}

interface OwnedInstagramAccount {
  id: string
  userId: string
  externalId: string
}

interface OwnedInstagramMedia {
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
  findActiveAccount(accountExternalId: string): Promise<OwnedInstagramAccount | null>
  findPublishedMedia(userId: string, accountId: string, mediaExternalId: string): Promise<OwnedInstagramMedia | null>
  upsertComment(row: InstagramWebhookCommentRow): Promise<'saved' | 'duplicate'>
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

export class InstagramWebhookPayloadError extends Error {
  code = 'invalid_webhook_payload'

  constructor() {
    super('Invalid Instagram webhook payload.')
    this.name = 'InstagramWebhookPayloadError'
  }
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function timestampValue(value: unknown): string | null {
  const text = textValue(value)
  if (text) return text
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const milliseconds = value >= 1_000_000_000_000 ? value : value * 1000
  const parsed = new Date(milliseconds)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseInstagramCommentEvents(body: unknown): {
  receivedCount: number
  ignoredCount: number
  duplicateCount: number
  events: InstagramWebhookCommentEvent[]
} {
  if (!body || typeof body !== 'object') throw new InstagramWebhookPayloadError()
  if ((body as any).object !== 'instagram') {
    return { receivedCount: 0, ignoredCount: 0, duplicateCount: 0, events: [] }
  }
  if (!Array.isArray((body as any).entry)) throw new InstagramWebhookPayloadError()

  let receivedCount = 0
  let ignoredCount = 0
  let duplicateCount = 0
  const events: InstagramWebhookCommentEvent[] = []
  const seen = new Set<string>()

  for (const entry of Array.isArray((body as any).entry) ? (body as any).entry : []) {
    const accountExternalId = textValue(entry?.id)
    const candidates: any[] = []
    if (entry && typeof entry === 'object' && ('field' in entry || 'value' in entry)) {
      candidates.push({ field: entry.field, value: entry.value })
    }
    if (Array.isArray(entry?.changes)) candidates.push(...entry.changes)

    for (const change of candidates) {
      if (change?.field !== 'comments') continue
      receivedCount += 1

      const value = change?.value
      const commentExternalId = textValue(value?.id)
      const mediaExternalId = textValue(value?.media?.id)
      const message = textValue(value?.text)
      if (!accountExternalId || !commentExternalId || !mediaExternalId || !message) {
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
        authorId: textValue(value?.from?.id) || null,
        authorName: textValue(value?.from?.username) || null,
        message,
        createdAt: timestampValue(value?.timestamp ?? value?.created_time),
        parentExternalCommentId: textValue(value?.parent_id || value?.parent?.id) || null,
      })
    }
  }

  return { receivedCount, ignoredCount, duplicateCount, events }
}

export async function processInstagramCommentWebhook(
  body: unknown,
  store: InstagramWebhookCommentStore
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

    const media = await store.findPublishedMedia(account.userId, account.id, event.mediaExternalId)
    if (!media) {
      ignoredCount += 1
      continue
    }

    const isFromAccount = Boolean(event.authorId && event.authorId === account.externalId)
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

export function createInstagramWebhookCommentStore(): InstagramWebhookCommentStore {
  const admin = createAdminClient() as any

  return {
    async findActiveAccount(accountExternalId) {
      const { data, error } = await admin
        .from('instagram_accounts')
        .select('id,user_id,channel_id')
        .eq('channel_id', accountExternalId)
        .eq('status', 'active')
        .limit(2)

      if (error) throw new Error('instagram_webhook_account_lookup_failed')
      if (!Array.isArray(data) || data.length !== 1) return null
      return {
        id: data[0].id,
        userId: data[0].user_id,
        externalId: data[0].channel_id,
      }
    },

    async findPublishedMedia(userId, accountId, mediaExternalId) {
      const { data, error } = await admin
        .from('instagram_publish_task_items')
        .select('id,task_id,instagram_video_id')
        .eq('account_id', accountId)
        .eq('instagram_video_id', mediaExternalId)
        .eq('status', 'published')
        .limit(2)

      if (error) throw new Error('instagram_webhook_media_lookup_failed')
      if (!Array.isArray(data) || data.length !== 1) return null
      const { data: tasks, error: taskError } = await admin
        .from('instagram_publish_tasks')
        .select('id')
        .eq('id', data[0].task_id)
        .eq('user_id', userId)
        .limit(2)

      if (taskError) throw new Error('instagram_webhook_task_lookup_failed')
      if (!Array.isArray(tasks) || tasks.length !== 1) return null
      return {
        id: data[0].id,
        externalId: data[0].instagram_video_id,
      }
    },

    async upsertComment(row) {
      const now = new Date().toISOString()
      const { data, error } = await admin
        .from('social_comments')
        .upsert({
          user_id: row.userId,
          platform: 'instagram',
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
          metadata: { source: 'webhook', event_type: 'comments' },
          remote_created_at: row.createdAt,
          last_synced_at: now,
          reply_to_comment_id: null,
          local_error_code: null,
          local_error_message: null,
          updated_at: now,
        }, {
          onConflict: 'user_id,platform,account_id,external_comment_id',
          ignoreDuplicates: true,
        })
        .select('id')

      if (error) throw new Error('instagram_webhook_comment_upsert_failed')
      return Array.isArray(data) && data.length > 0 ? 'saved' : 'duplicate'
    },
  }
}
