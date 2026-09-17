import { resolveFacebookVideoPostIdentity } from '@/lib/facebook/post-identity'

type RecoveryStatus = 'present' | 'recovered' | 'unresolved' | 'not_owned' | 'failed' | 'concurrent_change'

/** Each completed, owned Facebook sync can request recovery once. */
export async function recoverFacebookIdentityForSync(
  admin: any, userId: string, logId: string,
  recover: (accountId: string, videoId: string) => Promise<RecoveryStatus>,
): Promise<RecoveryStatus | 'not_pending'> {
  const { data: log, error } = await admin.from('social_comment_action_logs')
    .select('id,account_id,external_content_id,metadata').eq('id', logId).eq('user_id', userId)
    .eq('platform', 'facebook').eq('action_type', 'sync').eq('status', 'completed').maybeSingle()
  if (error) return 'failed'
  if (!log) return 'not_owned'
  if (!log.account_id || !log.external_content_id || log.metadata?.facebook_post_identity_status !== 'pending') return 'not_pending'
  const claimed = await admin.from('social_comment_action_logs').update({
    metadata: { ...log.metadata, facebook_post_identity_status: 'running' },
  }).eq('id', logId).eq('user_id', userId).eq('platform', 'facebook').eq('status', 'completed')
    .eq('metadata->>facebook_post_identity_status', 'pending').select('id')
  if (claimed.error) return 'failed'
  if (!Array.isArray(claimed.data) || claimed.data.length !== 1) return 'not_pending'
  let status: RecoveryStatus
  try { status = await recover(log.account_id, log.external_content_id) } catch { status = 'failed' }
  const saved = await admin.from('social_comment_action_logs').update({
    metadata: { ...log.metadata, facebook_post_identity_status: status },
  }).eq('id', logId).eq('user_id', userId).eq('platform', 'facebook')
    .eq('metadata->>facebook_post_identity_status', 'running')
  return saved.error ? 'failed' : status
}

/** Optional compensation for old uploads. It must never prevent normal comment reads. */
export async function recoverFacebookPostIdentity(
  admin: any,
  input: { userId: string; accountId: string; pageId: string; taskItemId: string; videoId: string; accessToken: string },
): Promise<RecoveryStatus> {
  try {
    const account = await admin.from('facebook_accounts').select('id')
      .eq('id', input.accountId).eq('user_id', input.userId)
      .eq('channel_id', input.pageId).eq('status', 'active').maybeSingle()
    if (account.error) return 'failed'
    if (!account.data) return 'not_owned'

    const item = await admin.from('facebook_publish_task_items').select('task_id,facebook_post_id')
      .eq('id', input.taskItemId).eq('account_id', input.accountId)
      .eq('facebook_video_id', input.videoId).eq('status', 'published').maybeSingle()
    if (item.error) return 'failed'
    if (!item.data) return 'not_owned'
    const task = await admin.from('facebook_publish_tasks').select('id')
      .eq('id', item.data.task_id).eq('user_id', input.userId).maybeSingle()
    if (task.error) return 'failed'
    if (!task.data) return 'not_owned'
    if (item.data.facebook_post_id) return 'present'

    const identity = await resolveFacebookVideoPostIdentity(input.accessToken, input.pageId, input.videoId)
    // A broker result must satisfy the same Page-specific numeric shape before any write.
    if (!/^\d+$/.test(input.pageId) || !identity?.postId
      || !new RegExp(`^${input.pageId}_\\d+$`).test(identity.postId)) return 'unresolved'

    let update = admin.from('facebook_publish_task_items').update({
      facebook_post_id: identity.postId,
      updated_at: new Date().toISOString(),
    }).eq('id', input.taskItemId).eq('account_id', input.accountId)
      .eq('task_id', item.data.task_id).eq('facebook_video_id', input.videoId).eq('status', 'published')
    // Compare-and-set: never overwrite another process's successful recovery.
    update = item.data.facebook_post_id === null
      ? update.is('facebook_post_id', null) : update.eq('facebook_post_id', '')
    const saved = await update.select('id')
    if (saved.error) return 'failed'
    return Array.isArray(saved.data) && saved.data.length === 1 ? 'recovered' : 'concurrent_change'
  } catch {
    // No provider messages, tokens, post IDs or response bodies in the action log.
    return 'failed'
  }
}
