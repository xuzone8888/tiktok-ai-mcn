import { createAdminClient } from '@/lib/supabase/admin'
import { refreshFacebookPageAccessToken } from '@/lib/facebook/oauth'
import { uploadFacebookVideoFromUrl } from '@/lib/facebook/publish'
import { buildPlatformPublishPayload } from '@/lib/publish/platform-adapters'

const MAX_ITEMS_PER_RUN = 20
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

interface FacebookPublishTaskSettings {
  privacy_status: 'private' | 'public'
  category_id: string | null
}

interface FacebookPublishItem {
  id: string
  task_id: string
  account_id: string
  video_url: string
  title: string
  description: string | null
  scheduled_at: string | null
  status: string
  facebook_publish_tasks: FacebookPublishTaskSettings
}

interface FacebookAccountToken {
  account_id: string
  page_id: string
  access_token: string
  refresh_token: string
  access_token_expires_at: string | null
}

export interface FacebookProcessOptions {
  taskId?: string
  mode: 'immediate' | 'scheduled'
  maxItems?: number
}

export interface FacebookProcessResult {
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
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now() + TOKEN_REFRESH_BUFFER_MS
}

export async function processFacebookPublishQueue(options: FacebookProcessOptions): Promise<FacebookProcessResult> {
  const startTime = Date.now()
  const supabase = createAdminClient() as any
  const result: FacebookProcessResult = {
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  }

  try {
    const items = await queryPendingItems(supabase, options)
    if (items.length === 0) {
      result.duration_ms = Date.now() - startTime
      return result
    }

    const lockedIds = await lockItems(supabase, items.map((item) => item.id))
    const lockedItems = items.filter((item) => lockedIds.has(item.id))
    result.skipped = items.length - lockedItems.length

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
        result.errors.push(getErrorMessage(error, 'Facebook 发布失败'))
      }
    }

    for (const taskId of [...new Set(lockedItems.map((item) => item.task_id))]) {
      await updateTaskFinalStatus(supabase, taskId)
    }

    result.duration_ms = Date.now() - startTime
    return result
  } catch (error) {
    result.errors.push(getErrorMessage(error, 'Facebook 发布队列处理失败'))
    result.duration_ms = Date.now() - startTime
    return result
  }
}

async function queryPendingItems(supabase: any, options: FacebookProcessOptions): Promise<FacebookPublishItem[]> {
  const now = new Date().toISOString()
  let query = supabase
    .from('facebook_publish_task_items')
    .select(`
      id,
      task_id,
      account_id,
      video_url,
      title,
      description,
      scheduled_at,
      status,
      facebook_publish_tasks (
        privacy_status,
        category_id
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
    throw new Error(`查询 Facebook 发布任务失败: ${error.message}`)
  }

  return (data || []) as FacebookPublishItem[]
}

async function lockItems(supabase: any, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set()

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('facebook_publish_task_items')
    .update({
      status: 'processing',
      processing_started_at: now,
      updated_at: now,
    })
    .in('id', itemIds)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    throw new Error(`锁定 Facebook 发布任务失败: ${error.message}`)
  }

  return new Set((data || []).map((row: { id: string }) => row.id))
}

async function updateTasksToProcessing(supabase: any, taskIds: string[]) {
  if (taskIds.length === 0) return
  await supabase
    .from('facebook_publish_tasks')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', taskIds)
}

async function getAccounts(supabase: any, accountIds: string[]): Promise<Map<string, FacebookAccountToken>> {
  const { data: activeAccounts, error: accountsError } = await supabase
    .from('facebook_accounts')
    .select('id, channel_id')
    .in('id', accountIds)
    .eq('status', 'active')

  if (accountsError) {
    throw new Error(`获取 Facebook 账号失败: ${accountsError.message}`)
  }

  const activeAccountIds = (activeAccounts || []).map((account: { id: string }) => account.id)
  const pageIdsByAccountId = new Map((activeAccounts || []).map((account: { id: string; channel_id: string }) => [account.id, account.channel_id]))
  if (activeAccountIds.length === 0) {
    return new Map()
  }

  const { data: tokens, error: tokensError } = await supabase
    .from('facebook_account_tokens')
    .select('account_id, access_token, refresh_token, access_token_expires_at')
    .in('account_id', activeAccountIds)

  if (tokensError) {
    throw new Error(`获取 Facebook 授权令牌失败: ${tokensError.message}`)
  }

  const accounts = new Map<string, FacebookAccountToken>()
  for (const token of tokens || []) {
    accounts.set(token.account_id, {
      ...token,
      page_id: pageIdsByAccountId.get(token.account_id) || '',
    })
  }
  return accounts
}

async function getValidAccessToken(supabase: any, account: FacebookAccountToken): Promise<string> {
  if (!isAccessTokenExpiring(account.access_token_expires_at)) {
    return account.access_token
  }

  const refreshed = await refreshFacebookPageAccessToken(account.refresh_token, account.page_id)
  const expiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null
  const now = new Date().toISOString()

  const { error: tokenUpdateError } = await supabase
    .from('facebook_account_tokens')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.user_access_token,
      access_token_expires_at: expiresAt,
      updated_at: now,
    })
    .eq('account_id', account.account_id)

  if (tokenUpdateError) {
    throw new Error(`更新 Facebook 授权令牌失败: ${tokenUpdateError.message}`)
  }

  const { error: accountUpdateError } = await supabase
    .from('facebook_accounts')
    .update({
      channel_title: refreshed.page.name,
      channel_handle: refreshed.page.category,
      thumbnail_url: refreshed.page.thumbnailUrl,
      subscriber_count: refreshed.page.followerCount,
      view_count: refreshed.page.fanCount,
      access_token_expires_at: expiresAt,
      status: 'active',
      updated_at: now,
    })
    .eq('id', account.account_id)

  if (accountUpdateError) {
    throw new Error(`更新 Facebook 账号授权状态失败: ${accountUpdateError.message}`)
  }

  account.access_token = refreshed.access_token
  account.refresh_token = refreshed.user_access_token
  account.access_token_expires_at = expiresAt
  return refreshed.access_token
}

async function publishItem(
  supabase: any,
  item: FacebookPublishItem,
  accounts: Map<string, FacebookAccountToken>
) {
  const account = accounts.get(item.account_id)
  if (!account) {
    await markItemFailed(supabase, item.id, 'Facebook 账号不存在或授权无效', 'ACCOUNT_UNAVAILABLE')
    throw new Error('Facebook 账号不存在或授权无效')
  }

  if (!item.video_url || item.video_url.startsWith('placeholder://')) {
    await markItemFailed(supabase, item.id, '视频 URL 无效', 'VIDEO_URL_UNAVAILABLE')
    throw new Error('视频 URL 无效')
  }

  const now = new Date().toISOString()
  await supabase
    .from('facebook_publish_task_items')
    .update({
      status: 'uploading',
      publish_attempt_count: 1,
      updated_at: now,
    })
    .eq('id', item.id)

  try {
    const accessToken = await getValidAccessToken(supabase, account)
    const taskSettings = item.facebook_publish_tasks
    if (taskSettings.privacy_status !== 'public') {
      throw new Error('Facebook 当前仅支持公开发布。未发布/广告草稿需要 Page 的 ADVERTISE 权限和 pages_manage_ads。')
    }
    const platformPayload = buildPlatformPublishPayload('facebook', {
      title: item.title,
      description: item.description || '',
      videos: [{
        id: item.id,
        name: item.title,
        url: item.video_url,
        title: item.title,
        description: item.description || '',
      }],
      account_ids: [item.account_id],
      publish_mode: 'now',
      scheduled_at: item.scheduled_at,
      platform_settings: {
        content_category: taskSettings.category_id || 'OTHER',
        published: true,
      },
    }).items[0]
    const upload = await uploadFacebookVideoFromUrl(accessToken, item.video_url, {
      pageId: account.page_id,
      title: platformPayload.title,
      description: platformPayload.description,
      published: platformPayload.published,
      contentCategory: platformPayload.content_category,
    })

    const publishedAt = new Date().toISOString()
    await supabase
      .from('facebook_publish_task_items')
      .update({
      status: upload.published ? 'published' : 'draft_created',
      facebook_video_id: upload.videoId,
      facebook_watch_url: upload.watchUrl,
      error_code: null,
      error_message: null,
      published_at: upload.published ? publishedAt : null,
      updated_at: publishedAt,
    })
      .eq('id', item.id)
  } catch (error) {
    const message = getErrorMessage(error, 'Facebook 发布失败')
    await markItemFailed(supabase, item.id, message, 'FACEBOOK_UPLOAD_FAILED')
    throw error
  }
}

async function markItemFailed(supabase: any, itemId: string, message: string, code: string) {
  await supabase
    .from('facebook_publish_task_items')
    .update({
      status: 'failed',
      error_code: code,
      error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
}

async function updateTaskFinalStatus(supabase: any, taskId: string) {
  const { data, error } = await supabase
    .from('facebook_publish_task_items')
    .select('status')
    .eq('task_id', taskId)

  if (error || !data) return

  const total = data.length
  const terminalSuccessStatuses = new Set(['published', 'draft_created'])
  const published = data.filter((item: { status: string }) => item.status === 'published').length
  const succeeded = data.filter((item: { status: string }) => terminalSuccessStatuses.has(item.status)).length
  const failed = data.filter((item: { status: string }) => item.status === 'failed').length
  const pending = data.filter((item: { status: string }) => ['pending', 'processing', 'uploading'].includes(item.status)).length

  let status: string = 'processing'
  if (total > 0 && succeeded === total) {
    status = 'completed'
  } else if (failed === total) {
    status = 'failed'
  } else if (failed > 0 && pending === 0) {
    status = 'partial_failed'
  } else if (pending > 0) {
    status = 'processing'
  }

  await supabase
    .from('facebook_publish_tasks')
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
