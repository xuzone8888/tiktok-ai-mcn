import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  createInstagramWebhookCommentStore,
  createInstagramWebhookHandler,
  type InstagramAccountRecord,
  type InstagramMediaRecord,
  type InstagramTaskRecord,
  type InstagramWebhookDatabase,
  type InstagramWebhookReceipt,
} from './core.js'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Promise<Response>): unknown
}

function normalizeRows<T>(
  data: unknown,
  normalize: (row: Record<string, unknown>) => T | null,
): T[] | null {
  if (!Array.isArray(data)) return null
  const output: T[] = []
  for (const rawRow of data) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      return null
    }
    const row = normalize(rawRow as Record<string, unknown>)
    if (!row) return null
    output.push(row)
  }
  return output
}

function requiredText(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key]
  return typeof value === 'string' && value ? value : null
}

export function createPostgrestInstagramWebhookDatabase(
  admin: SupabaseClient,
): InstagramWebhookDatabase {
  return {
    async findActiveAccounts(accountExternalId) {
      const { data, error } = await admin
        .from('instagram_accounts')
        .select('id,user_id,channel_id')
        .eq('channel_id', accountExternalId)
        .eq('status', 'active')
        .limit(2)
      const rows = normalizeRows<InstagramAccountRecord>(data, (row) => {
        const id = requiredText(row, 'id')
        const userId = requiredText(row, 'user_id')
        const channelId = requiredText(row, 'channel_id')
        return id && userId && channelId ? { id, user_id: userId, channel_id: channelId } : null
      })
      return {
        data: rows,
        error: error ?? (rows ? null : new Error('invalid_result')),
      }
    },

    async findPublishedMedia(accountId, mediaExternalId) {
      const { data, error } = await admin
        .from('instagram_publish_task_items')
        .select('id,task_id,instagram_video_id')
        .eq('account_id', accountId)
        .eq('instagram_video_id', mediaExternalId)
        .eq('status', 'published')
        .limit(2)
      const rows = normalizeRows<InstagramMediaRecord>(data, (row) => {
        const id = requiredText(row, 'id')
        const taskId = requiredText(row, 'task_id')
        const mediaId = requiredText(row, 'instagram_video_id')
        return id && taskId && mediaId ? { id, task_id: taskId, instagram_video_id: mediaId } : null
      })
      return {
        data: rows,
        error: error ?? (rows ? null : new Error('invalid_result')),
      }
    },

    async findOwnedTasks(taskId, userId) {
      const { data, error } = await admin
        .from('instagram_publish_tasks')
        .select('id')
        .eq('id', taskId)
        .eq('user_id', userId)
        .limit(2)
      const rows = normalizeRows<InstagramTaskRecord>(data, (row) => {
        const id = requiredText(row, 'id')
        return id ? { id } : null
      })
      return {
        data: rows,
        error: error ?? (rows ? null : new Error('invalid_result')),
      }
    },

    async upsertSocialComment(row) {
      const { data, error } = await admin
        .from('social_comments')
        .upsert(row, {
          onConflict: 'user_id,platform,account_id,external_comment_id',
          ignoreDuplicates: true,
        })
        .select('id')
      const rows = normalizeRows<{ id: string }>(data, (saved) => {
        const id = requiredText(saved, 'id')
        return id ? { id } : null
      })
      return {
        data: rows,
        error: error ?? (rows ? null : new Error('invalid_result')),
      }
    },
  } satisfies InstagramWebhookDatabase
}

function createAdminClient(
  config: { supabaseUrl: string; serviceRoleKey: string },
) {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

export const handler = createInstagramWebhookHandler({
  getEnv: (name) => Deno.env.get(name),
  createStore: (config) => {
    const database = createPostgrestInstagramWebhookDatabase(
      createAdminClient(config),
    )
    return createInstagramWebhookCommentStore(database)
  },
  recordReceipt: async (receipt: InstagramWebhookReceipt) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('receipt_configuration_unavailable')
    }
    const admin = createAdminClient({ supabaseUrl, serviceRoleKey })
    const { error } = await admin.from('webhook_receipts').insert({
      provider: receipt.provider,
      status: receipt.status,
      step: receipt.step,
      signature_valid: receipt.signatureValid,
      body_length: receipt.bodyLength,
      http_status: receipt.httpStatus,
      error_code: receipt.errorCode,
      metadata: receipt.metadata ?? {},
    })
    if (error) throw error
  },
  logger: {
    info: (message, metadata) => console.info(message, metadata),
    error: (message, metadata) => console.error(message, metadata),
  },
})

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  Deno.serve(handler)
}
