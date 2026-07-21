import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  createFacebookWebhookCommentStore,
  createFacebookWebhookHandler,
  type FacebookAccountRecord,
  type FacebookContentRecord,
  type FacebookTaskRecord,
  type FacebookWebhookDatabase,
  type FacebookWebhookReceipt,
} from './core.js'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Promise<Response>): unknown
}

function requiredText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value ? value : null
}

function normalizeRows<T>(
  data: unknown,
  normalize: (row: Record<string, unknown>) => T | null,
): T[] | null {
  if (!Array.isArray(data)) return null
  const output: T[] = []
  for (const rawRow of data) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) return null
    const row = normalize(rawRow as Record<string, unknown>)
    if (!row) return null
    output.push(row)
  }
  return output
}

export function createPostgrestFacebookWebhookDatabase(
  admin: SupabaseClient,
): FacebookWebhookDatabase {
  return {
    async findActiveAccounts(accountExternalId) {
      const { data, error } = await admin
        .from('facebook_accounts')
        .select('id,user_id,channel_id')
        .eq('channel_id', accountExternalId)
        .eq('status', 'active')
        .limit(2)
      const rows = normalizeRows<FacebookAccountRecord>(data, (row) => {
        const id = requiredText(row, 'id')
        const userId = requiredText(row, 'user_id')
        const channelId = requiredText(row, 'channel_id')
        return id && userId && channelId ? { id, user_id: userId, channel_id: channelId } : null
      })
      return { data: rows, error: error ?? (rows ? null : new Error('invalid_result')) }
    },

    async findPublishedContent(accountId, contentCandidates) {
      const safeCandidates = contentCandidates.filter((candidate) =>
        /^\d+(?:_\d+)?$/.test(candidate)
      )
      if (safeCandidates.length === 0) return { data: [], error: null }
      const candidateList = safeCandidates.join(',')
      const { data, error } = await admin
        .from('facebook_publish_task_items')
        .select('id,task_id,facebook_video_id,facebook_post_id')
        .eq('account_id', accountId)
        .or(`facebook_post_id.in.(${candidateList}),facebook_video_id.in.(${candidateList})`)
        .eq('status', 'published')
        .limit(2)
      const rows = normalizeRows<FacebookContentRecord>(data, (row) => {
        const id = requiredText(row, 'id')
        const taskId = requiredText(row, 'task_id')
        const videoId = requiredText(row, 'facebook_video_id')
        const postId = requiredText(row, 'facebook_post_id')
        return id && taskId && videoId
          ? { id, task_id: taskId, facebook_video_id: videoId, facebook_post_id: postId }
          : null
      })
      return { data: rows, error: error ?? (rows ? null : new Error('invalid_result')) }
    },

    async findOwnedTasks(taskId, userId) {
      const { data, error } = await admin
        .from('facebook_publish_tasks')
        .select('id')
        .eq('id', taskId)
        .eq('user_id', userId)
        .limit(2)
      const rows = normalizeRows<FacebookTaskRecord>(data, (row) => {
        const id = requiredText(row, 'id')
        return id ? { id } : null
      })
      return { data: rows, error: error ?? (rows ? null : new Error('invalid_result')) }
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
      return { data: rows, error: error ?? (rows ? null : new Error('invalid_result')) }
    },
  }
}

function createAdminClient(config: { supabaseUrl: string; serviceRoleKey: string }) {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export const handler = createFacebookWebhookHandler({
  getEnv: (name) => Deno.env.get(name),
  createStore: (config) =>
    createFacebookWebhookCommentStore(
      createPostgrestFacebookWebhookDatabase(createAdminClient(config)),
    ),
  recordReceipt: async (receipt: FacebookWebhookReceipt) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
    if (!supabaseUrl || !serviceRoleKey) throw new Error('receipt_configuration_unavailable')
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

if ((import.meta as ImportMeta & { main?: boolean }).main) Deno.serve(handler)
