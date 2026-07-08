import { createAdminClient } from '@/lib/supabase/admin'
import { isLinkedInPublishEnabledServer } from '@/lib/feature-flags'
import { refreshLinkedInAccessToken } from '@/lib/linkedin/oauth'
import {
  LinkedInVideoProcessingFailedError,
  LinkedInVideoStillProcessingError,
  publishLinkedInFinalizedVideo,
  uploadLinkedInVideoAssetFromUrl,
} from '@/lib/linkedin/publish'

const MAX_ITEMS_PER_RUN = 20
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const STALE_ITEM_THRESHOLD_MS = 15 * 60 * 1000
const VIDEO_REPOLL_DELAY_MS = 60 * 1000
const MAX_VIDEO_PROCESSING_POLLS = 24 * 60
const MAX_VIDEO_PROCESSING_MS = 24 * 60 * 60 * 1000
const LINKEDIN_ITEM_SELECT = `
  id,
  task_id,
  account_id,
  video_url,
  title,
  description,
  scheduled_at,
  status,
  linkedin_post_urn,
  upload_asset_urn,
  video_processing_started_at,
  processing_poll_count,
  last_video_status,
  updated_at,
  linkedin_publish_tasks (
    privacy_status,
    tags
  )
`

interface LinkedInPublishTaskSettings {
  privacy_status: 'public'
  tags: string[] | unknown
}

interface LinkedInPublishItem {
  id: string
  task_id: string
  account_id: string
  video_url: string
  title: string
  description: string | null
  scheduled_at: string | null
  status: string
  linkedin_post_urn: string | null
  upload_asset_urn: string | null
  video_processing_started_at: string | null
  processing_poll_count: number | null
  last_video_status: string | null
  updated_at: string | null
  linkedin_publish_tasks: LinkedInPublishTaskSettings
}

interface LinkedInAccountToken {
  account_id: string
  owner_urn: string
  access_token: string
  refresh_token: string | null
  access_token_expires_at: string | null
}

export interface LinkedInProcessOptions {
  taskId?: string
  mode: 'immediate' | 'scheduled'
  maxItems?: number
}

export interface LinkedInProcessResult {
  success: number
  failed: number
  skipped: number
  errors: string[]
  duration_ms: number
}

class LinkedInPostPersistFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkedInPostPersistFailedError'
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function isAccessTokenExpired(expiresAt: string | null) {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now()
}

function isAccessTokenExpiring(expiresAt: string | null) {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now() + TOKEN_REFRESH_BUFFER_MS
}

function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.map(String).map((tag) => tag.trim()).filter(Boolean)
  }
  return []
}

function isVideoProcessingTimedOut(startedAt: string, pollCount: number) {
  if (pollCount >= MAX_VIDEO_PROCESSING_POLLS) {
    return true
  }

  const startedAtMs = new Date(startedAt).getTime()
  return Number.isFinite(startedAtMs) && Date.now() - startedAtMs >= MAX_VIDEO_PROCESSING_MS
}

function buildVideoProcessingTimeoutMessage(status: string, pollCount: number) {
  return `LinkedIn 视频转码超时，最后状态: ${status || 'UNKNOWN'}，已轮询 ${pollCount} 次`
}

async function mustUpdateLinkedInItem(
  supabase: any,
  itemId: string,
  values: Record<string, unknown>,
  context: string,
  applyFilters?: (query: any) => any
) {
  let query = supabase
    .from('linkedin_publish_task_items')
    .update(values)
    .eq('id', itemId)

  if (applyFilters) {
    query = applyFilters(query)
  }

  const { data, error } = await query.select('id')

  if (error) {
    throw new Error(`${context}: ${error.message}`)
  }
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`${context}: expected 1 updated LinkedIn item row, got ${Array.isArray(data) ? data.length : 0}`)
  }
}

async function mustUpdateLinkedInTask(
  supabase: any,
  taskId: string,
  values: Record<string, unknown>,
  context: string
) {
  const { data, error } = await supabase
    .from('linkedin_publish_tasks')
    .update(values)
    .eq('id', taskId)
    .select('id')

  if (error) {
    throw new Error(`${context}: ${error.message}`)
  }
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`${context}: expected 1 updated LinkedIn task row, got ${Array.isArray(data) ? data.length : 0}`)
  }
}

async function mustUpdateLinkedInAccount(
  supabase: any,
  accountId: string,
  values: Record<string, unknown>,
  context: string
) {
  const { data, error } = await supabase
    .from('linkedin_accounts')
    .update(values)
    .eq('id', accountId)
    .select('id')

  if (error) {
    throw new Error(`${context}: ${error.message}`)
  }
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`${context}: expected 1 updated LinkedIn account row, got ${Array.isArray(data) ? data.length : 0}`)
  }
}

export async function processLinkedInPublishQueue(options: LinkedInProcessOptions): Promise<LinkedInProcessResult> {
  const startTime = Date.now()
  const result: LinkedInProcessResult = {
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  }

  if (!isLinkedInPublishEnabledServer()) {
    result.duration_ms = Date.now() - startTime
    return result
  }

  const supabase = createAdminClient() as any

  try {
    await recoverStaleItems(supabase)
    const items = await queryPendingItems(supabase, options)
    if (items.length === 0) {
      result.duration_ms = Date.now() - startTime
      return result
    }

    const lockedItems = await lockItems(supabase, items.map((item) => item.id))
    result.skipped = items.length - lockedItems.length

    if (lockedItems.length === 0) {
      result.duration_ms = Date.now() - startTime
      return result
    }

    await updateTasksToProcessing(supabase, [...new Set(lockedItems.map((item) => item.task_id))])
    const accounts = await getAccounts(supabase, [...new Set(lockedItems.map((item) => item.account_id))])

    for (const item of lockedItems) {
      try {
        const itemResult = await publishItem(supabase, item, accounts)
        if (itemResult === 'published') {
          result.success++
        } else {
          result.skipped++
        }
      } catch (error) {
        result.failed++
        result.errors.push(getErrorMessage(error, 'LinkedIn 发布失败'))
      }
    }

    for (const taskId of [...new Set(lockedItems.map((item) => item.task_id))]) {
      await updateTaskFinalStatus(supabase, taskId)
    }

    result.duration_ms = Date.now() - startTime
    return result
  } catch (error) {
    result.errors.push(getErrorMessage(error, 'LinkedIn 发布队列处理失败'))
    result.duration_ms = Date.now() - startTime
    return result
  }
}

async function recoverStaleItems(supabase: any) {
  const staleBefore = new Date(Date.now() - STALE_ITEM_THRESHOLD_MS).toISOString()
  const { error: uploadingError } = await supabase
    .from('linkedin_publish_task_items')
    .update({ status: 'pending', processing_started_at: null, updated_at: new Date().toISOString() })
    .eq('status', 'uploading')
    .lt('processing_started_at', staleBefore)

  if (uploadingError) {
    console.warn('恢复 LinkedIn 卡死上传项失败:', uploadingError.message)
  }

  const { error: processingError } = await supabase
    .from('linkedin_publish_task_items')
    .update({ status: 'pending', processing_started_at: null, updated_at: new Date().toISOString() })
    .eq('status', 'processing')
    .is('upload_asset_urn', null)
    .lt('processing_started_at', staleBefore)

  if (processingError) {
    console.warn('恢复 LinkedIn 未保存视频 URN 的卡死发布项失败:', processingError.message)
  }
}

async function queryPendingItems(supabase: any, options: LinkedInProcessOptions): Promise<LinkedInPublishItem[]> {
  const now = new Date().toISOString()
  const repollBefore = new Date(Date.now() - VIDEO_REPOLL_DELAY_MS).toISOString()
  const maxItems = options.maxItems || MAX_ITEMS_PER_RUN

  let pendingQuery = supabase
    .from('linkedin_publish_task_items')
    .select(LINKEDIN_ITEM_SELECT)
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })
    .limit(maxItems)

  if (options.taskId) {
    pendingQuery = pendingQuery.eq('task_id', options.taskId)
  }

  pendingQuery = pendingQuery.lte('scheduled_at', now)

  const { data: pendingData, error: pendingError } = await pendingQuery
  if (pendingError) {
    throw new Error(`查询 LinkedIn 待发布任务失败: ${pendingError.message}`)
  }

  const remaining = Math.max(0, maxItems - (pendingData || []).length)
  if (remaining === 0) {
    return (pendingData || []) as LinkedInPublishItem[]
  }

  let processingQuery = supabase
    .from('linkedin_publish_task_items')
    .select(LINKEDIN_ITEM_SELECT)
    .eq('status', 'processing')
    .not('upload_asset_urn', 'is', null)
    .lte('updated_at', repollBefore)
    .order('updated_at', { ascending: true })
    .limit(remaining)

  if (options.taskId) {
    processingQuery = processingQuery.eq('task_id', options.taskId)
  }

  processingQuery = processingQuery.lte('scheduled_at', now)

  const { data: processingData, error: processingError } = await processingQuery
  if (processingError) {
    throw new Error(`查询 LinkedIn 转码中任务失败: ${processingError.message}`)
  }

  return ([...(pendingData || []), ...(processingData || [])]) as LinkedInPublishItem[]
}

async function loadItemsByIds(supabase: any, itemIds: string[]): Promise<LinkedInPublishItem[]> {
  if (itemIds.length === 0) return []

  const { data, error } = await supabase
    .from('linkedin_publish_task_items')
    .select(LINKEDIN_ITEM_SELECT)
    .in('id', itemIds)

  if (error) {
    throw new Error(`读取 LinkedIn 发布任务最新状态失败: ${error.message}`)
  }

  const byId = new Map((data || []).map((item: LinkedInPublishItem) => [item.id, item]))
  return itemIds.map((id) => byId.get(id)).filter((item): item is LinkedInPublishItem => Boolean(item))
}

async function lockItems(supabase: any, itemIds: string[]): Promise<LinkedInPublishItem[]> {
  if (itemIds.length === 0) return []

  const now = new Date().toISOString()
  const repollBefore = new Date(Date.now() - VIDEO_REPOLL_DELAY_MS).toISOString()
  const locked = new Set<string>()

  const { data: pendingLocked, error: pendingError } = await supabase
    .from('linkedin_publish_task_items')
    .update({
      status: 'processing',
      processing_started_at: now,
      updated_at: now,
    })
    .in('id', itemIds)
    .eq('status', 'pending')
    .select('id')

  if (pendingError) {
    throw new Error(`锁定 LinkedIn 待发布任务失败: ${pendingError.message}`)
  }
  ;(pendingLocked || []).forEach((row: { id: string }) => locked.add(row.id))

  const remaining = itemIds.filter((id) => !locked.has(id))
  if (remaining.length > 0) {
    const { data: processingLocked, error: processingError } = await supabase
      .from('linkedin_publish_task_items')
      .update({
        status: 'processing',
        processing_started_at: now,
        updated_at: now,
      })
      .in('id', remaining)
      .eq('status', 'processing')
      .not('upload_asset_urn', 'is', null)
      .lte('updated_at', repollBefore)
      .select('id')

    if (processingError) {
      throw new Error(`锁定 LinkedIn 转码轮询任务失败: ${processingError.message}`)
    }
    ;(processingLocked || []).forEach((row: { id: string }) => locked.add(row.id))
  }

  return loadItemsByIds(supabase, itemIds.filter((id) => locked.has(id)))
}

async function updateTasksToProcessing(supabase: any, taskIds: string[]) {
  if (taskIds.length === 0) return
  const { error } = await supabase
    .from('linkedin_publish_tasks')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', taskIds)

  if (error) {
    throw new Error(`更新 LinkedIn 任务处理中状态失败: ${error.message}`)
  }
}

async function getAccounts(supabase: any, accountIds: string[]): Promise<Map<string, LinkedInAccountToken>> {
  const { data: activeAccounts, error: accountsError } = await supabase
    .from('linkedin_accounts')
    .select('id, owner_urn, scopes')
    .in('id', accountIds)
    .eq('status', 'active')
    .eq('owner_type', 'member')

  if (accountsError) {
    throw new Error(`获取 LinkedIn 账号失败: ${accountsError.message}`)
  }

  const publishableAccounts = (activeAccounts || []).filter((account: { scopes: unknown }) => {
    const scopes = Array.isArray(account.scopes) ? account.scopes.map(String) : []
    return scopes.includes('w_member_social')
  })
  const activeAccountIds = publishableAccounts.map((account: { id: string }) => account.id)
  const ownerUrnsByAccountId = new Map(publishableAccounts.map((account: { id: string; owner_urn: string }) => [account.id, account.owner_urn]))
  if (activeAccountIds.length === 0) {
    return new Map()
  }

  const { data: tokens, error: tokensError } = await supabase
    .from('linkedin_account_tokens')
    .select('account_id, access_token, refresh_token, access_token_expires_at')
    .in('account_id', activeAccountIds)

  if (tokensError) {
    throw new Error(`获取 LinkedIn 授权令牌失败: ${tokensError.message}`)
  }

  const accounts = new Map<string, LinkedInAccountToken>()
  for (const token of tokens || []) {
    accounts.set(token.account_id, {
      ...token,
      owner_urn: ownerUrnsByAccountId.get(token.account_id) || '',
    })
  }

  return accounts
}

async function getValidAccessToken(supabase: any, account: LinkedInAccountToken): Promise<string> {
  if (!isAccessTokenExpiring(account.access_token_expires_at)) {
    return account.access_token
  }

  if (!account.refresh_token) {
    if (isAccessTokenExpired(account.access_token_expires_at)) {
      await mustUpdateLinkedInAccount(
        supabase,
        account.account_id,
        { status: 'expired', updated_at: new Date().toISOString() },
        '标记 LinkedIn 账号授权过期失败'
      )
      throw new Error('LinkedIn 授权已过期，请重新连接账号')
    }
    return account.access_token
  }

  let refreshed
  try {
    refreshed = await refreshLinkedInAccessToken(account.refresh_token)
  } catch (error) {
    const httpStatus = (error as { httpStatus?: number })?.httpStatus
    if (httpStatus === 400 || httpStatus === 401) {
      await mustUpdateLinkedInAccount(
        supabase,
        account.account_id,
        { status: 'expired', updated_at: new Date().toISOString() },
        '标记 LinkedIn 账号授权过期失败'
      )
      throw new Error(`LinkedIn 授权已过期，请重新连接账号: ${getErrorMessage(error, '令牌刷新失败')}`)
    }
    throw error
  }

  const expiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null
  const refreshExpiresAt = refreshed.refresh_token_expires_in ? new Date(Date.now() + refreshed.refresh_token_expires_in * 1000).toISOString() : null
  const now = new Date().toISOString()

  const { error: tokenUpdateError } = await supabase
    .from('linkedin_account_tokens')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || account.refresh_token,
      access_token_expires_at: expiresAt,
      ...(refreshExpiresAt ? { refresh_token_expires_at: refreshExpiresAt } : {}),
      updated_at: now,
    })
    .eq('account_id', account.account_id)

  if (tokenUpdateError) {
    throw new Error(`更新 LinkedIn 授权令牌失败: ${tokenUpdateError.message}`)
  }

  await mustUpdateLinkedInAccount(
    supabase,
    account.account_id,
    {
      access_token_expires_at: expiresAt,
      status: 'active',
      updated_at: now,
    },
    '更新 LinkedIn 账号授权状态失败'
  )

  account.access_token = refreshed.access_token
  account.refresh_token = refreshed.refresh_token || account.refresh_token
  account.access_token_expires_at = expiresAt
  return refreshed.access_token
}

async function publishItem(
  supabase: any,
  item: LinkedInPublishItem,
  accounts: Map<string, LinkedInAccountToken>
): Promise<'published' | 'deferred'> {
  const [latestItem] = await loadItemsByIds(supabase, [item.id])
  if (!latestItem) {
    throw new Error('LinkedIn 发布任务项不存在或已删除')
  }
  item = latestItem

  if (item.linkedin_post_urn) {
    const ts = new Date().toISOString()
    await mustUpdateLinkedInItem(
      supabase,
      item.id,
      { status: 'published', published_at: ts, error_code: null, error_message: null, updated_at: ts },
      '标记 LinkedIn 已发布任务项失败'
    )
    return 'published'
  }

  if (item.last_video_status === 'POSTING' && !item.linkedin_post_urn) {
    await markItemFailed(
      supabase,
      item.id,
      'LinkedIn 帖子可能已创建，但本地 post URN 未保存成功，需要人工核对后补偿处理',
      'LINKEDIN_POST_PERSIST_FAILED',
      undefined,
      { last_video_status: 'POSTING' }
    )
    throw new LinkedInPostPersistFailedError('LinkedIn 帖子可能已创建但本地未保存 post URN，已停止自动重试')
  }

  const account = accounts.get(item.account_id)
  if (!account) {
    await markItemFailed(supabase, item.id, 'LinkedIn 账号不存在或授权无效', 'ACCOUNT_UNAVAILABLE')
    throw new Error('LinkedIn 账号不存在或授权无效')
  }

  if (!item.video_url || item.video_url.startsWith('placeholder://')) {
    await markItemFailed(supabase, item.id, '视频 URL 无效', 'VIDEO_URL_UNAVAILABLE')
    throw new Error('视频 URL 无效')
  }

  const now = new Date().toISOString()

  try {
    const accessToken = await getValidAccessToken(supabase, account)
    const taskSettings = item.linkedin_publish_tasks
    if (taskSettings.privacy_status !== 'public') {
      throw new Error('LinkedIn 首版仅支持公开发布')
    }
    const tags = parseTags(taskSettings.tags)

    let assetUrn = item.upload_asset_urn
    let attempts: number | undefined

    if (!assetUrn) {
      await mustUpdateLinkedInItem(
        supabase,
        item.id,
        {
          status: 'uploading',
          publish_attempt_count: 1,
          updated_at: now,
        },
        '标记 LinkedIn 视频上传中失败'
      )

      const upload = await uploadLinkedInVideoAssetFromUrl(accessToken, item.video_url, account.owner_urn)
      assetUrn = upload.assetUrn
      attempts = upload.attempts

      const finalizedAt = new Date().toISOString()
      await mustUpdateLinkedInItem(
        supabase,
        item.id,
        {
          status: 'processing',
          upload_asset_urn: assetUrn,
          video_processing_started_at: finalizedAt,
          processing_poll_count: 0,
          last_video_status: 'FINALIZED',
          publish_attempt_count: upload.attempts,
          error_code: null,
          error_message: null,
          updated_at: finalizedAt,
        },
        '保存 LinkedIn 视频 URN 失败'
      )

      item.upload_asset_urn = assetUrn
      item.video_processing_started_at = finalizedAt
      item.processing_poll_count = 0
      item.last_video_status = 'FINALIZED'
    }

    const post = await publishLinkedInFinalizedVideo(
      accessToken,
      assetUrn,
      {
        ownerUrn: account.owner_urn,
        title: item.title,
        description: item.description || '',
        tags,
      },
      async () => {
        const postingAt = new Date().toISOString()
        await mustUpdateLinkedInItem(
          supabase,
          item.id,
          {
            status: 'processing',
            last_video_status: 'POSTING',
            error_code: null,
            error_message: null,
            updated_at: postingAt,
          },
          '标记 LinkedIn 发帖中状态失败',
          (query) => query
            .eq('status', 'processing')
            .is('linkedin_post_urn', null)
            .not('upload_asset_urn', 'is', null)
        )
        item.last_video_status = 'POSTING'
      }
    )
    const publishedAt = new Date().toISOString()
    try {
      await mustUpdateLinkedInItem(
        supabase,
        item.id,
        {
          status: 'published',
          linkedin_post_urn: post.postUrn,
          linkedin_share_url: post.shareUrl,
          upload_asset_urn: assetUrn,
          last_video_status: 'AVAILABLE',
          ...(attempts ? { publish_attempt_count: attempts } : {}),
          error_code: null,
          error_message: null,
          published_at: publishedAt,
          updated_at: publishedAt,
        },
        '保存 LinkedIn post URN 失败'
      )
    } catch (persistError) {
      const message = `LinkedIn 帖子已创建，但本地保存 post URN 失败，需要人工核对后补偿处理: ${getErrorMessage(persistError, '保存失败')}`
      await markItemFailed(supabase, item.id, message, 'LINKEDIN_POST_PERSIST_FAILED', attempts, {
        last_video_status: 'POSTING',
        linkedin_share_url: post.shareUrl,
      })
      throw new LinkedInPostPersistFailedError(message)
    }

    return 'published'
  } catch (error) {
    if (error instanceof LinkedInVideoStillProcessingError) {
      const lastVideoStatus = error.status || 'PROCESSING'
      const nextPollCount = Math.max(0, Number(item.processing_poll_count || 0)) + 1
      const videoProcessingStartedAt = item.video_processing_started_at || new Date().toISOString()

      if (isVideoProcessingTimedOut(videoProcessingStartedAt, nextPollCount)) {
        const message = buildVideoProcessingTimeoutMessage(lastVideoStatus, nextPollCount)
        await markItemFailed(supabase, item.id, message, 'LINKEDIN_VIDEO_PROCESSING_TIMEOUT', undefined, {
          video_processing_started_at: videoProcessingStartedAt,
          processing_poll_count: nextPollCount,
          last_video_status: lastVideoStatus,
        })
        throw new Error(message)
      }

      await mustUpdateLinkedInItem(
        supabase,
        item.id,
        {
          status: 'processing',
          video_processing_started_at: videoProcessingStartedAt,
          processing_poll_count: nextPollCount,
          last_video_status: lastVideoStatus,
          error_code: null,
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        '更新 LinkedIn 视频转码轮询状态失败'
      )
      return 'deferred'
    }

    if (error instanceof LinkedInPostPersistFailedError) {
      throw error
    }

    if (error instanceof LinkedInVideoProcessingFailedError) {
      await markItemFailed(supabase, item.id, error.message, 'LINKEDIN_VIDEO_PROCESSING_FAILED', undefined, {
        last_video_status: error.status,
      })
      throw error
    }

    const message = getErrorMessage(error, 'LinkedIn 发布失败')
    const attempts = typeof (error as { attempts?: unknown })?.attempts === 'number'
      ? Math.max(1, Math.floor((error as { attempts: number }).attempts))
      : undefined
    await markItemFailed(supabase, item.id, message, 'LINKEDIN_UPLOAD_FAILED', attempts)
    throw error
  }
}

async function markItemFailed(
  supabase: any,
  itemId: string,
  message: string,
  code: string,
  attempts?: number,
  extra?: Record<string, unknown>
) {
  await mustUpdateLinkedInItem(
    supabase,
    itemId,
    {
      status: 'failed',
      error_code: code,
      error_message: message,
      ...(attempts ? { publish_attempt_count: attempts } : {}),
      ...(extra || {}),
      updated_at: new Date().toISOString(),
    },
    '标记 LinkedIn 发布任务项失败'
  )
}

async function updateTaskFinalStatus(supabase: any, taskId: string) {
  const { data, error } = await supabase
    .from('linkedin_publish_task_items')
    .select('status')
    .eq('task_id', taskId)

  if (error) {
    throw new Error(`统计 LinkedIn 发布任务状态失败: ${error.message}`)
  }
  if (!data) return

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

  await mustUpdateLinkedInTask(
    supabase,
    taskId,
    {
      status,
      total_items: total,
      pending_count: pending,
      published_count: published,
      failed_count: failed,
      completed_at: pending === 0 ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    '更新 LinkedIn 发布任务最终状态失败'
  )
}
