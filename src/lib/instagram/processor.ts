import { createAdminClient } from '@/lib/supabase/admin'
import { refreshInstagramAccountAccessToken } from '@/lib/instagram/oauth'
import {
  InstagramContainerProcessingError,
  publishInstagramExistingContainer,
  uploadInstagramVideoFromUrl,
} from '@/lib/instagram/publish'
import { buildPlatformPublishPayload } from '@/lib/publish/platform-adapters'

const MAX_ITEMS_PER_RUN = 20
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
// 容器建好后 defer 兜底路径的重轮询间隔。in-request 短轮询（见下）已让绝大多数在首个 /process 内发完，
// 此闸只影响转码超过 in-request 上限的极慢项；从 60s 降到 15s 让这类慢项的兜底重查更快。
const CONTAINER_REPOLL_DELAY_MS = 15 * 1000
const MAX_CONTAINER_POLL_ATTEMPTS = 6
// in-request 自适应短轮询：建完容器后在同一个 /process 请求内每 5s 查一次容器状态，
// Meta 转码一完成即发布，省掉「defer→等 60s 闸→等下个 cron」的整轮来回（IG 慢的主因）。
// 单项上限 75s（覆盖绝大多数 Reels 转码）；超过则 defer 走上面的兜底路径。
const CONTAINER_INLINE_POLL_INTERVAL_MS = 5 * 1000
const CONTAINER_INLINE_MAX_WAIT_MS = 75 * 1000
// 整轮 in-request 轮询总预算，防一次 run 里多个项各等 75s 撑爆 maxDuration=300 / cron -m 290。
// 预算耗尽后剩余项退化为「查一次即 defer」，由下个 cron 处理。留足余量（200s < 290/300）。
const RUN_INLINE_POLL_BUDGET_MS = 200 * 1000

interface InstagramPublishTaskSettings {
  privacy_status: 'private' | 'public'
  tags: string[] | null
}

interface InstagramPublishItem {
  id: string
  task_id: string
  account_id: string
  video_url: string
  title: string
  description: string | null
  instagram_video_id: string | null
  scheduled_at: string | null
  status: string
  publish_attempt_count: number
  updated_at: string
  instagram_publish_tasks: InstagramPublishTaskSettings
}

interface InstagramAccountToken {
  account_id: string
  instagram_account_id: string
  access_token: string
  refresh_token: string
  access_token_expires_at: string | null
}

export interface InstagramProcessOptions {
  taskId?: string
  mode: 'immediate' | 'scheduled'
  maxItems?: number
}

export interface InstagramProcessResult {
  success: number
  failed: number
  deferred: number
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

export async function processInstagramPublishQueue(options: InstagramProcessOptions): Promise<InstagramProcessResult> {
  const startTime = Date.now()
  const supabase = createAdminClient() as any
  const result: InstagramProcessResult = {
    success: 0,
    failed: 0,
    deferred: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  }

  try {
    // 注意：IG 不做 'uploading' 项的自动卡死恢复。IG 是两步发布(创建容器→media_publish)，容器 id 在库函数内部产生、
    // 'uploading' 阶段未持久化，无法安全区分"创建容器前崩溃(可重传)"与"media_publish 后崩溃(重传=重复公开帖)"，
    // 故宁可让极少数 'uploading' 卡死项停住(与 baseline 一致、安全)也不冒重复发帖风险。
    // 'processing'(已持久化容器 id)卡死项由 lockItems 的原子 CAS 重轮询恢复。
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
        // 每项 in-request 轮询预算 = min(单项上限, 整轮剩余预算)；预算用尽则退化为「查一次即 defer」。
        const remainingRunMs = RUN_INLINE_POLL_BUDGET_MS - (Date.now() - startTime)
        const inlineWaitMs = Math.max(0, Math.min(CONTAINER_INLINE_MAX_WAIT_MS, remainingRunMs))
        const inlineMaxStatusChecks = Math.max(1, Math.floor(inlineWaitMs / CONTAINER_INLINE_POLL_INTERVAL_MS) + 1)
        const outcome = await publishItem(supabase, item, accounts, {
          pollIntervalMs: CONTAINER_INLINE_POLL_INTERVAL_MS,
          maxStatusChecks: inlineMaxStatusChecks,
        })
        if (outcome === 'deferred') {
          result.deferred++
        } else {
          result.success++
        }
      } catch (error) {
        result.failed++
        result.errors.push(getErrorMessage(error, 'Instagram 发布失败'))
      }
    }

    for (const taskId of [...new Set(lockedItems.map((item) => item.task_id))]) {
      await updateTaskFinalStatus(supabase, taskId)
    }

    result.duration_ms = Date.now() - startTime
    return result
  } catch (error) {
    result.errors.push(getErrorMessage(error, 'Instagram 发布队列处理失败'))
    result.duration_ms = Date.now() - startTime
    return result
  }
}

async function queryPendingItems(supabase: any, options: InstagramProcessOptions): Promise<InstagramPublishItem[]> {
  const now = new Date().toISOString()
  let query = supabase
    .from('instagram_publish_task_items')
    .select(`
      id,
      task_id,
      account_id,
      video_url,
      title,
      description,
      instagram_video_id,
      scheduled_at,
      status,
      publish_attempt_count,
      updated_at,
      instagram_publish_tasks (
        privacy_status,
        tags
      )
    `)
    .in('status', ['pending', 'processing'])
    .order('scheduled_at', { ascending: true })
    .limit(options.maxItems || MAX_ITEMS_PER_RUN)

  if (options.taskId) {
    query = query.eq('task_id', options.taskId)
  }

  query = query.lte('scheduled_at', now)

  const { data, error } = await query
  if (error) {
    throw new Error(`查询 Instagram 发布任务失败: ${error.message}`)
  }

  const repollBefore = Date.now() - CONTAINER_REPOLL_DELAY_MS
  return ((data || []) as InstagramPublishItem[]).filter((item) => {
    if (item.status !== 'processing' || !item.instagram_video_id) return true
    const updatedAt = new Date(item.updated_at).getTime()
    return !Number.isFinite(updatedAt) || updatedAt <= repollBefore
  })
}

async function lockItems(supabase: any, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set()

  const now = new Date().toISOString()
  // 原子认领（compare-and-swap）：只认领 pending，或 processing 且已过重轮询窗口（陈旧）的项。
  // 把陈旧判定放进 UPDATE 的 WHERE（而非仅在读取侧 queryPendingItems 过滤），
  // 这样两个并发 run 中先提交者把 updated_at 刷成 now，后者的 WHERE 重新求值即失败，
  // 无法重复认领同一容器 → 杜绝同一视频被 media_publish 两次的重复公开发帖。
  //
  // 注意：PostgREST 在「UPDATE + .or() + RETURNING」组合下、当有行命中时会误报
  // `column instagram_publish_task_items.status does not exist`（逻辑算子用于 mutation
  // 的已知缺陷，空匹配时不报、命中时才暴露）。因此这里拆成两条等价的单条件 UPDATE：
  // 先认领 pending，再认领陈旧 processing。两条都把判定放进 WHERE，仍是行级 CAS，
  // 并发安全性与原子性不变（与 Facebook lockItems 的 .eq 写法一致）。
  const repollBefore = new Date(Date.now() - CONTAINER_REPOLL_DELAY_MS).toISOString()
  const locked = new Set<string>()

  const { data: pendingLocked, error: pendingError } = await supabase
    .from('instagram_publish_task_items')
    .update({
      status: 'processing',
      processing_started_at: now,
      updated_at: now,
    })
    .in('id', itemIds)
    .eq('status', 'pending')
    .select('id')

  if (pendingError) {
    throw new Error(`锁定 Instagram 发布任务失败: ${pendingError.message}`)
  }
  ;(pendingLocked || []).forEach((row: { id: string }) => locked.add(row.id))

  const remaining = itemIds.filter((id) => !locked.has(id))
  if (remaining.length > 0) {
    const { data: staleLocked, error: staleError } = await supabase
      .from('instagram_publish_task_items')
      .update({
        status: 'processing',
        processing_started_at: now,
        updated_at: now,
      })
      .in('id', remaining)
      .eq('status', 'processing')
      .lte('updated_at', repollBefore)
      .select('id')

    if (staleError) {
      throw new Error(`锁定 Instagram 发布任务失败: ${staleError.message}`)
    }
    ;(staleLocked || []).forEach((row: { id: string }) => locked.add(row.id))
  }

  return locked
}

async function updateTasksToProcessing(supabase: any, taskIds: string[]) {
  if (taskIds.length === 0) return
  await supabase
    .from('instagram_publish_tasks')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', taskIds)
}

async function getAccounts(supabase: any, accountIds: string[]): Promise<Map<string, InstagramAccountToken>> {
  const { data: activeAccounts, error: accountsError } = await supabase
    .from('instagram_accounts')
    .select('id, channel_id')
    .in('id', accountIds)
    .eq('status', 'active')

  if (accountsError) {
    throw new Error(`获取 Instagram 账号失败: ${accountsError.message}`)
  }

  const activeAccountIds = (activeAccounts || []).map((account: { id: string }) => account.id)
  const instagramIdsByAccountId = new Map((activeAccounts || []).map((account: { id: string; channel_id: string }) => [account.id, account.channel_id]))
  if (activeAccountIds.length === 0) {
    return new Map()
  }

  const { data: tokens, error: tokensError } = await supabase
    .from('instagram_account_tokens')
    .select('account_id, access_token, refresh_token, access_token_expires_at')
    .in('account_id', activeAccountIds)

  if (tokensError) {
    throw new Error(`获取 Instagram 授权令牌失败: ${tokensError.message}`)
  }

  const accounts = new Map<string, InstagramAccountToken>()
  for (const token of tokens || []) {
    accounts.set(token.account_id, {
      ...token,
      instagram_account_id: instagramIdsByAccountId.get(token.account_id) || '',
    })
  }
  return accounts
}

async function getValidAccessToken(supabase: any, account: InstagramAccountToken): Promise<string> {
  if (!isAccessTokenExpiring(account.access_token_expires_at)) {
    return account.access_token
  }

  let refreshed
  try {
    refreshed = await refreshInstagramAccountAccessToken(account.refresh_token, account.instagram_account_id)
  } catch (error) {
    // 长效用户令牌约 60 天硬过期且无法自动续期。仅当令牌端点明确返回失效(HTTP 400/401)时才标记 expired 并提示重连；
    // 5xx/429/网络等瞬时错误直接抛出交下轮 cron 重试，避免误禁用本来有效的账号。
    const httpStatus = (error as { httpStatus?: number })?.httpStatus
    if (httpStatus === 400 || httpStatus === 401) {
      await supabase
        .from('instagram_accounts')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', account.account_id)
      throw new Error(`Instagram 授权已过期，请重新连接账号: ${getErrorMessage(error, '令牌刷新失败')}`)
    }
    throw error
  }
  const expiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null
  const now = new Date().toISOString()

  const { error: tokenUpdateError } = await supabase
    .from('instagram_account_tokens')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.user_access_token,
      access_token_expires_at: expiresAt,
      updated_at: now,
    })
    .eq('account_id', account.account_id)

  if (tokenUpdateError) {
    throw new Error(`更新 Instagram 授权令牌失败: ${tokenUpdateError.message}`)
  }

  const { error: accountUpdateError } = await supabase
    .from('instagram_accounts')
    .update({
      channel_title: refreshed.account.name,
      channel_handle: `@${refreshed.account.username}`,
      thumbnail_url: refreshed.account.thumbnailUrl,
      subscriber_count: refreshed.account.followerCount,
      video_count: refreshed.account.mediaCount,
      view_count: 0,
      access_token_expires_at: expiresAt,
      status: 'active',
      updated_at: now,
    })
    .eq('id', account.account_id)

  if (accountUpdateError) {
    throw new Error(`更新 Instagram 账号授权状态失败: ${accountUpdateError.message}`)
  }

  account.access_token = refreshed.access_token
  account.refresh_token = refreshed.user_access_token
  account.access_token_expires_at = expiresAt
  return refreshed.access_token
}

async function publishItem(
  supabase: any,
  item: InstagramPublishItem,
  accounts: Map<string, InstagramAccountToken>,
  inlinePoll: { pollIntervalMs: number; maxStatusChecks: number }
): Promise<'published' | 'deferred'> {
  const account = accounts.get(item.account_id)
  if (!account) {
    await markItemFailed(supabase, item.id, 'Instagram 账号不存在或授权无效', 'ACCOUNT_UNAVAILABLE')
    throw new Error('Instagram 账号不存在或授权无效')
  }

  if (!item.video_url || item.video_url.startsWith('placeholder://')) {
    await markItemFailed(supabase, item.id, '视频 URL 无效', 'VIDEO_URL_UNAVAILABLE')
    throw new Error('视频 URL 无效')
  }

  const latestItemState = await getLatestItemState(supabase, item.id)
  const existingContainerId = latestItemState.instagram_video_id || item.instagram_video_id || undefined
  const attemptCount = (latestItemState.publish_attempt_count ?? item.publish_attempt_count ?? 0) + 1
  const now = new Date().toISOString()
  await supabase
    .from('instagram_publish_task_items')
    .update({
      status: 'uploading',
      publish_attempt_count: attemptCount,
      updated_at: now,
    })
    .eq('id', item.id)

  try {
    const accessToken = await getValidAccessToken(supabase, account)
    const taskSettings = item.instagram_publish_tasks
    const platformPayload = buildPlatformPublishPayload('instagram', {
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
      tags: taskSettings.tags || [],
      platform_settings: {
        published: taskSettings.privacy_status === 'public',
      },
    }).items[0]
    const upload = existingContainerId
      ? await publishInstagramExistingContainer(accessToken, {
        accountId: account.instagram_account_id,
        creationId: existingContainerId,
        deferOnContainerProcessing: true,
        pollIntervalMs: inlinePoll.pollIntervalMs,
        maxStatusChecks: inlinePoll.maxStatusChecks,
      })
      : await uploadInstagramVideoFromUrl(accessToken, item.video_url, {
        accountId: account.instagram_account_id,
        title: '',
        description: '',
        caption: platformPayload.caption,
        published: taskSettings.privacy_status === 'public',
        deferOnContainerProcessing: true,
        pollIntervalMs: inlinePoll.pollIntervalMs,
        maxStatusChecks: inlinePoll.maxStatusChecks,
      })

    const publishedAt = new Date().toISOString()
    await supabase
      .from('instagram_publish_task_items')
      .update({
        status: upload.published ? 'published' : 'container_created',
        instagram_video_id: upload.videoId,
        instagram_watch_url: upload.watchUrl,
        error_code: null,
        error_message: null,
        published_at: upload.published ? publishedAt : null,
        updated_at: publishedAt,
      })
      .eq('id', item.id)
    return 'published'
  } catch (error) {
    if (error instanceof InstagramContainerProcessingError) {
      if (attemptCount >= MAX_CONTAINER_POLL_ATTEMPTS) {
        const timeoutMessage = `Instagram 发布容器处理超时 (${error.statusCode})${error.statusDetail ? `: ${error.statusDetail}` : ''}`
        await markItemFailed(supabase, item.id, timeoutMessage, 'INSTAGRAM_UPLOAD_FAILED')
        throw new Error(timeoutMessage)
      }

      await markItemContainerProcessing(supabase, item.id, error.containerId, error.message)
      return 'deferred'
    }

    const message = getErrorMessage(error, 'Instagram 发布失败')
    await markItemFailed(supabase, item.id, message, 'INSTAGRAM_UPLOAD_FAILED')
    throw error
  }
}

async function getLatestItemState(supabase: any, itemId: string): Promise<{
  instagram_video_id: string | null
  publish_attempt_count: number | null
}> {
  const { data, error } = await supabase
    .from('instagram_publish_task_items')
    .select('instagram_video_id, publish_attempt_count')
    .eq('id', itemId)
    .single()

  if (error || !data) {
    return {
      instagram_video_id: null,
      publish_attempt_count: null,
    }
  }

  return data
}

async function markItemContainerProcessing(supabase: any, itemId: string, containerId: string, message: string) {
  await supabase
    .from('instagram_publish_task_items')
    .update({
      status: 'processing',
      instagram_video_id: containerId,
      error_code: null,
      error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
}

async function markItemFailed(supabase: any, itemId: string, message: string, code: string) {
  await supabase
    .from('instagram_publish_task_items')
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
    .from('instagram_publish_task_items')
    .select('status')
    .eq('task_id', taskId)

  if (error || !data) return

  const total = data.length
  const terminalSuccessStatuses = new Set(['published', 'container_created'])
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
    .from('instagram_publish_tasks')
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
