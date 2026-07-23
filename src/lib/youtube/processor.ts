import { createAdminClient } from '@/lib/supabase/admin'
import { isYouTubeAuthorizationRevokedError, refreshYouTubeAccessToken } from '@/lib/youtube/oauth'
import { uploadYouTubeVideoFromUrl } from '@/lib/youtube/publish'

const MAX_ITEMS_PER_RUN = 20
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
// 认领后超过该时长仍停留在 processing/uploading 的项视为卡死（进程崩溃/函数超时），重置回 pending 重试。
const STALE_ITEM_THRESHOLD_MS = 15 * 60 * 1000

interface YouTubePublishTaskSettings {
  privacy_status: 'private' | 'unlisted' | 'public'
  category_id: string
  tags: string[] | unknown
  made_for_kids: boolean
  contains_synthetic_media: boolean
  notify_subscribers: boolean
}

interface YouTubePublishItem {
  id: string
  task_id: string
  account_id: string
  video_url: string
  title: string
  description: string | null
  scheduled_at: string | null
  status: string
  youtube_publish_tasks: YouTubePublishTaskSettings
}

interface YouTubeAccountToken {
  account_id: string
  user_id: string
  access_token: string
  refresh_token: string
  access_token_expires_at: string | null
}

export interface YouTubeProcessOptions {
  taskId?: string
  mode: 'immediate' | 'scheduled'
  maxItems?: number
}

export interface YouTubeProcessResult {
  success: number
  failed: number
  skipped: number
  errors: string[]
  duration_ms: number
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function isAccessTokenExpiring(expiresAt: string | null) {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() <= Date.now() + TOKEN_REFRESH_BUFFER_MS
}

function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.map(String).map((tag) => tag.trim()).filter(Boolean)
  }

  return []
}

function isLocalVideoUrl(videoUrl: string) {
  try {
    const url = new URL(videoUrl)
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function isRemoteRuntime() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL || process.env.VERCEL_ENV)
}

function shouldSkipForCurrentRuntime(item: YouTubePublishItem) {
  return isRemoteRuntime() && isLocalVideoUrl(item.video_url)
}

export async function processYouTubePublishQueue(options: YouTubeProcessOptions): Promise<YouTubeProcessResult> {
  const startTime = Date.now()
  const supabase = createAdminClient() as any
  const result: YouTubeProcessResult = {
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  }

  try {
    await recoverStaleItems(supabase)
    const items = await queryPendingItems(supabase, options)
    if (items.length === 0) {
      result.duration_ms = Date.now() - startTime
      return result
    }

    // 本地测试视频地址在远程/生产运行时无法被 YouTube 拉取。必须把它们标记为失败使其离开 pending，
    // 否则会永远停留在 scheduled_at 升序队列头部，反复占用本轮窗口并最终阻塞后面的正常任务（队列静默停发）。
    const skippedForRuntime = items.filter((item) => shouldSkipForCurrentRuntime(item))
    for (const item of skippedForRuntime) {
      await markItemFailed(
        supabase,
        item.id,
        '本地测试视频地址无法在生产环境发布，请重新上传到可公开访问的地址后再发布',
        'LOCAL_URL_UNREACHABLE'
      )
      result.failed++
    }

    const runnableItems = items.filter((item) => !shouldSkipForCurrentRuntime(item))

    if (runnableItems.length === 0) {
      for (const taskId of [...new Set(skippedForRuntime.map((item) => item.task_id))]) {
        await updateTaskFinalStatus(supabase, taskId)
      }
      result.duration_ms = Date.now() - startTime
      return result
    }

    const lockedIds = await lockItems(supabase, runnableItems.map((item) => item.id))
    const lockedItems = runnableItems.filter((item) => lockedIds.has(item.id))
    result.skipped += runnableItems.length - lockedItems.length

    if (lockedItems.length === 0) {
      result.duration_ms = Date.now() - startTime
      return result
    }

    await updateTasksToProcessing(supabase, [...new Set(lockedItems.map((item) => item.task_id))])

    const accounts = await getAccounts(supabase, [...new Set(lockedItems.map((item) => item.account_id))])

    for (const item of lockedItems) {
      try {
        await publishItem(supabase, item, accounts)
        result.success++
      } catch (error) {
        result.failed++
        result.errors.push(getErrorMessage(error, 'YouTube 发布失败'))
      }
    }

    for (const taskId of [...new Set([...lockedItems, ...skippedForRuntime].map((item) => item.task_id))]) {
      await updateTaskFinalStatus(supabase, taskId)
    }

    result.duration_ms = Date.now() - startTime
    return result
  } catch (error) {
    result.errors.push(getErrorMessage(error, 'YouTube 发布队列处理失败'))
    result.duration_ms = Date.now() - startTime
    return result
  }
}

async function recoverStaleItems(supabase: any) {
  // 把卡死在 processing/uploading 的项重置回 pending，使后续 cron 能重新认领（仿 TikTok 参考的 stale 恢复）。
  // 配合 publishItem 的 youtube_video_id 幂等保护，避免对已上传成功但终态写库失败的项重复上传。
  const staleBefore = new Date(Date.now() - STALE_ITEM_THRESHOLD_MS).toISOString()
  const { error } = await supabase
    .from('youtube_publish_task_items')
    .update({ status: 'pending', processing_started_at: null, updated_at: new Date().toISOString() })
    .in('status', ['processing', 'uploading'])
    .lt('processing_started_at', staleBefore)
  if (error) {
    console.warn('恢复 YouTube 卡死发布项失败:', error.message)
  }
}

async function queryPendingItems(supabase: any, options: YouTubeProcessOptions): Promise<YouTubePublishItem[]> {
  const now = new Date().toISOString()
  let query = supabase
    .from('youtube_publish_task_items')
    .select(`
      id,
      task_id,
      account_id,
      video_url,
      title,
      description,
      scheduled_at,
      status,
      youtube_publish_tasks (
        privacy_status,
        category_id,
        tags,
        made_for_kids,
        contains_synthetic_media,
        notify_subscribers
      )
    `)
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })
    .limit(options.maxItems || MAX_ITEMS_PER_RUN)

  if (options.taskId) {
    query = query.eq('task_id', options.taskId)
  }

  query = query.lte('scheduled_at', now)

  const { data, error } = await query
  if (error) {
    throw new Error(`查询 YouTube 发布任务失败: ${error.message}`)
  }

  return (data || []) as YouTubePublishItem[]
}

async function lockItems(supabase: any, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set()

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('youtube_publish_task_items')
    .update({
      status: 'processing',
      processing_started_at: now,
      updated_at: now,
    })
    .in('id', itemIds)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    throw new Error(`锁定 YouTube 发布任务失败: ${error.message}`)
  }

  return new Set((data || []).map((row: { id: string }) => row.id))
}

async function updateTasksToProcessing(supabase: any, taskIds: string[]) {
  if (taskIds.length === 0) return
  await supabase
    .from('youtube_publish_tasks')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', taskIds)
}

async function getAccounts(supabase: any, accountIds: string[]): Promise<Map<string, YouTubeAccountToken>> {
  const { data: activeAccounts, error: accountsError } = await supabase
    .from('youtube_accounts')
    .select('id, user_id')
    .in('id', accountIds)
    .eq('status', 'active')

  if (accountsError) {
    throw new Error(`获取 YouTube 账号失败: ${accountsError.message}`)
  }

  const activeAccountIds = (activeAccounts || []).map((account: { id: string }) => account.id)
  const accountOwners = new Map(
    (activeAccounts || []).map((account: { id: string; user_id: string }) => [account.id, account.user_id])
  )
  if (activeAccountIds.length === 0) {
    return new Map()
  }

  const { data: tokens, error: tokensError } = await supabase
    .from('youtube_account_tokens')
    .select('account_id, access_token, refresh_token, access_token_expires_at')
    .in('account_id', activeAccountIds)

  if (tokensError) {
    throw new Error(`获取 YouTube 授权令牌失败: ${tokensError.message}`)
  }

  const accounts = new Map<string, YouTubeAccountToken>()
  for (const token of tokens || []) {
    const userId = accountOwners.get(token.account_id)
    if (userId) accounts.set(token.account_id, { ...token, user_id: userId })
  }
  return accounts
}

async function getValidAccessToken(supabase: any, account: YouTubeAccountToken): Promise<string> {
  if (!isAccessTokenExpiring(account.access_token_expires_at)) {
    return account.access_token
  }

  let refreshed
  try {
    refreshed = await refreshYouTubeAccessToken(account.refresh_token)
  } catch (refreshError) {
    if (isYouTubeAuthorizationRevokedError(refreshError)) {
      const { error: invalidationError } = await supabase.rpc('mark_youtube_authorization_invalid', {
        p_user_id: account.user_id,
        p_account_id: account.account_id,
      })
      if (invalidationError) {
        throw new Error(`Unable to record invalid YouTube authorization: ${invalidationError.message}`)
      }
    }
    throw refreshError
  }
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  const scopes = refreshed.scope ? refreshed.scope.split(/\s+/).filter(Boolean) : undefined
  const now = new Date().toISOString()

  const { error: tokenUpdateError } = await supabase
    .from('youtube_account_tokens')
    .update({
      access_token: refreshed.access_token,
      access_token_expires_at: expiresAt,
      updated_at: now,
    })
    .eq('account_id', account.account_id)

  if (tokenUpdateError) {
    throw new Error(`更新 YouTube 授权令牌失败: ${tokenUpdateError.message}`)
  }

  const { error: accountUpdateError } = await supabase
    .from('youtube_accounts')
    .update({
      access_token_expires_at: expiresAt,
      ...(scopes ? { scopes } : {}),
      status: 'active',
      updated_at: now,
    })
    .eq('id', account.account_id)

  if (accountUpdateError) {
    throw new Error(`更新 YouTube 账号授权状态失败: ${accountUpdateError.message}`)
  }

  account.access_token = refreshed.access_token
  account.access_token_expires_at = expiresAt
  return refreshed.access_token
}

async function publishItem(
  supabase: any,
  item: YouTubePublishItem,
  accounts: Map<string, YouTubeAccountToken>
) {
  const account = accounts.get(item.account_id)
  if (!account) {
    await markItemFailed(supabase, item.id, 'YouTube 账号不存在或授权无效', 'ACCOUNT_UNAVAILABLE')
    throw new Error('YouTube 账号不存在或授权无效')
  }

  if (!item.video_url || item.video_url.startsWith('placeholder://')) {
    await markItemFailed(supabase, item.id, '视频 URL 无效', 'VIDEO_URL_UNAVAILABLE')
    throw new Error('视频 URL 无效')
  }

  // 幂等保护：若该项已记录 youtube_video_id，说明上一轮已成功上传、仅终态写库失败而卡住。
  // 被卡死恢复重置回 pending 后，这里直接补记为 published，避免重复上传同一视频到 YouTube。
  const existingVideoId = await getExistingYouTubeVideoId(supabase, item.id)
  if (existingVideoId) {
    const ts = new Date().toISOString()
    await supabase
      .from('youtube_publish_task_items')
      .update({ status: 'published', published_at: ts, error_code: null, error_message: null, updated_at: ts })
      .eq('id', item.id)
    return
  }

  const now = new Date().toISOString()
  await supabase
    .from('youtube_publish_task_items')
    .update({
      status: 'uploading',
      publish_attempt_count: 1,
      updated_at: now,
    })
    .eq('id', item.id)

  try {
    const accessToken = await getValidAccessToken(supabase, account)
    const taskSettings = item.youtube_publish_tasks
    const upload = await uploadYouTubeVideoFromUrl(accessToken, item.video_url, {
      title: item.title,
      description: item.description || '',
      tags: parseTags(taskSettings.tags),
      categoryId: taskSettings.category_id || '22',
      privacyStatus: taskSettings.privacy_status,
      madeForKids: taskSettings.made_for_kids,
      containsSyntheticMedia: taskSettings.contains_synthetic_media,
      notifySubscribers: taskSettings.notify_subscribers,
    })

    // 先单独持久化 video_id（状态仍 uploading）。这样即使在终态写库前崩溃/超时，卡死恢复后 publishItem 的幂等守卫
    // 能读到 youtube_video_id 而补记为已发布，不会重复上传同一视频到 YouTube。
    await supabase
      .from('youtube_publish_task_items')
      .update({
        youtube_video_id: upload.videoId,
        youtube_watch_url: upload.watchUrl,
        publish_attempt_count: upload.attempts,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    const publishedAt = new Date().toISOString()
    await supabase
      .from('youtube_publish_task_items')
      .update({
        status: 'published',
        error_code: null,
        error_message: null,
        published_at: publishedAt,
        updated_at: publishedAt,
      })
      .eq('id', item.id)
  } catch (error) {
    const message = getErrorMessage(error, 'YouTube 发布失败')
    const attempts = typeof (error as { attempts?: unknown })?.attempts === 'number'
      ? Math.max(1, Math.floor((error as { attempts: number }).attempts))
      : undefined
    await markItemFailed(supabase, item.id, message, 'YOUTUBE_UPLOAD_FAILED', attempts)
    throw error
  }
}

async function getExistingYouTubeVideoId(supabase: any, itemId: string): Promise<string | null> {
  const { data } = await supabase
    .from('youtube_publish_task_items')
    .select('youtube_video_id')
    .eq('id', itemId)
    .single()
  return data?.youtube_video_id || null
}

async function markItemFailed(supabase: any, itemId: string, message: string, code: string, attempts?: number) {
  await supabase
    .from('youtube_publish_task_items')
    .update({
      status: 'failed',
      error_code: code,
      error_message: message,
      ...(attempts ? { publish_attempt_count: attempts } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
}

async function updateTaskFinalStatus(supabase: any, taskId: string) {
  const { data, error } = await supabase
    .from('youtube_publish_task_items')
    .select('status')
    .eq('task_id', taskId)

  if (error || !data) return

  const total = data.length
  const published = data.filter((item: { status: string }) => item.status === 'published').length
  const failed = data.filter((item: { status: string }) => item.status === 'failed').length
  const pending = data.filter((item: { status: string }) => ['pending', 'processing', 'uploading'].includes(item.status)).length

  let status: string = 'processing'
  if (total > 0 && published === total) {
    status = 'completed'
  } else if (failed === total) {
    status = 'failed'
  } else if (failed > 0 && pending === 0) {
    status = 'partial_failed'
  } else if (pending > 0) {
    status = 'processing'
  }

  await supabase
    .from('youtube_publish_tasks')
    .update({
      status,
      total_items: total,
      pending_count: pending,
      published_count: published,
      failed_count: failed,
      completed_at: pending === 0 ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
}
