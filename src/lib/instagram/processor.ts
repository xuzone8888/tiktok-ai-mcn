import { createAdminClient } from '@/lib/supabase/admin'
import { refreshInstagramAccountAccessToken } from '@/lib/instagram/oauth'
import {
  InstagramContainerAlreadyPublishedError,
  InstagramContainerProcessingError,
  InstagramContainerTerminalError,
  InstagramMediaContainerOutcomeUnknownError,
  InstagramMediaContainerRejectedError,
  InstagramMediaPublishOutcomeUnknownError,
  InstagramMediaPublishRejectedError,
  InstagramPostPublishPersistenceError,
  publishInstagramExistingContainer,
  uploadInstagramVideoFromUrl,
} from '@/lib/instagram/publish'
import {
  INSTAGRAM_INLINE_MAX_WAIT_MS,
  INSTAGRAM_INLINE_POLL_INTERVAL_MS,
  InstagramPublishLeaseLostError,
  claimInstagramPublishItem,
  queryInstagramPublishCandidates,
  renewInstagramPublishLease,
} from '@/lib/instagram/publish-lease'
import {
  enterInstagramMediaPublishBarrier,
  persistInstagramMediaCreateOutcomeUnknown,
  persistInstagramMediaPublishOutcomeUnknown,
} from '@/lib/instagram/publish-barrier'
import { persistInstagramReconciliationState } from '@/lib/instagram/publish-reconciliation'
import {
  persistInstagramFailedItem,
  updateInstagramItemWithRetry,
} from '@/lib/instagram/publish-item-persistence'
import {
  buildInstagramActiveContainerUpdate,
  buildInstagramContainerProcessingUpdate,
  buildInstagramPublishedIdentityUpdate,
  buildInstagramPublishedItemUpdate,
} from '@/lib/instagram/publish-state'
import { buildPlatformPublishPayload } from '@/lib/publish/platform-adapters'

const MAX_ITEMS_PER_RUN = 20
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const TOKEN_REFRESH_TIMEOUT_MS = 30 * 1000
const MAX_CONTAINER_POLL_ATTEMPTS = 6
// in-request 自适应短轮询：建完容器后在同一个 /process 请求内每 5s 查一次容器状态，
// Meta 转码一完成即发布，省掉「defer→等下个 cron」的整轮来回。
// 单项上限 75s（覆盖绝大多数 Reels 转码）；超过则 defer 走上面的兜底路径。
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
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
    // uploading 表示活动 worker 持有长租约；创建出的 container ID 会立即持久化，但租约期间不会被其他 run 认领。
    // 只有内联轮询耗尽后才切到 processing，并使用更短的 deferred repoll 窗口。
    // stale uploading 与 stale processing 的恢复判定都同时存在于读取过滤和 UPDATE WHERE 的数据库 CAS 中。
    const items = await queryPendingItems(supabase, options)
    if (items.length === 0) {
      result.duration_ms = Date.now() - startTime
      return result
    }

    const touchedTaskIds = new Set<string>()
    const startedTaskIds = new Set<string>()
    const accountCache = new Map<string, InstagramAccountToken>()
    const loadedAccountIds = new Set<string>()

    for (const item of items) {
      let lease = null
      try {
        lease = await claimInstagramPublishItem(supabase, item)
      } catch (error) {
        result.failed++
        result.errors.push(getErrorMessage(error, '锁定 Instagram 发布任务失败'))
        continue
      }
      if (!lease) {
        result.skipped++
        continue
      }

      try {
        touchedTaskIds.add(item.task_id)
        if (!startedTaskIds.has(item.task_id)) {
          await updateTasksToProcessing(supabase, [item.task_id])
          startedTaskIds.add(item.task_id)
        }
        if (!loadedAccountIds.has(item.account_id)) {
          const loadedAccounts = await getAccounts(supabase, [item.account_id])
          const loadedAccount = loadedAccounts.get(item.account_id)
          if (loadedAccount) accountCache.set(item.account_id, loadedAccount)
          loadedAccountIds.add(item.account_id)
        }

        // 每项 in-request 轮询预算 = min(单项上限, 整轮剩余预算)；预算用尽则退化为「查一次即 defer」。
        const remainingRunMs = RUN_INLINE_POLL_BUDGET_MS - (Date.now() - startTime)
        const inlineWaitMs = Math.max(0, Math.min(INSTAGRAM_INLINE_MAX_WAIT_MS, remainingRunMs))
        const inlineMaxStatusChecks = Math.max(1, Math.floor(inlineWaitMs / INSTAGRAM_INLINE_POLL_INTERVAL_MS) + 1)
        const outcome = await publishItem(supabase, item, accountCache, lease.token, {
          pollIntervalMs: INSTAGRAM_INLINE_POLL_INTERVAL_MS,
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

    for (const taskId of touchedTaskIds) {
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
  const maxItems = options.maxItems || MAX_ITEMS_PER_RUN
  const select = `
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
    `
  return queryInstagramPublishCandidates<InstagramPublishItem>(supabase, {
    select,
    taskId: options.taskId,
    maxItems,
  })
}

async function updateTasksToProcessing(supabase: any, taskIds: string[]) {
  if (taskIds.length === 0) return
  const { error } = await supabase
    .from('instagram_publish_tasks')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', taskIds)
  if (error) {
    throw new Error(`更新 Instagram 发布任务状态失败: ${error.message}`)
  }
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

async function getValidAccessToken(
  supabase: any,
  account: InstagramAccountToken,
  assertLease: () => Promise<void>
): Promise<string> {
  if (!isAccessTokenExpiring(account.access_token_expires_at)) {
    return account.access_token
  }

  let refreshed
  try {
    await assertLease()
    refreshed = await withTimeout(
      refreshInstagramAccountAccessToken(account.refresh_token, account.instagram_account_id),
      TOKEN_REFRESH_TIMEOUT_MS,
      'Instagram 授权刷新超时'
    )
    await assertLease()
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
  leaseToken: string,
  inlinePoll: { pollIntervalMs: number; maxStatusChecks: number }
): Promise<'published' | 'deferred'> {
  const account = accounts.get(item.account_id)
  if (!account) {
    await markItemFailed(supabase, item.id, leaseToken, 'Instagram 账号不存在或授权无效', 'ACCOUNT_UNAVAILABLE', undefined, 'uploading')
    throw new Error('Instagram 账号不存在或授权无效')
  }

  if (!item.video_url || item.video_url.startsWith('placeholder://')) {
    await markItemFailed(supabase, item.id, leaseToken, '视频 URL 无效', 'VIDEO_URL_UNAVAILABLE', undefined, 'uploading')
    throw new Error('视频 URL 无效')
  }

  const renewLeaseBeforeExternalWrite = async () => {
    const renewed = await renewInstagramPublishLease(supabase, item.id, leaseToken)
    if (!renewed) throw new InstagramPublishLeaseLostError()
  }

  const latestItemState = await getLatestItemState(supabase, item.id)
  const existingContainerId = latestItemState.instagram_video_id || item.instagram_video_id || undefined
  const attemptCount = (latestItemState.publish_attempt_count ?? item.publish_attempt_count ?? 0) + 1
  const now = new Date().toISOString()
  const { error: attemptUpdateError } = await supabase
    .from('instagram_publish_task_items')
    .update({
      status: 'uploading',
      publish_attempt_count: attemptCount,
      updated_at: now,
    })
    .eq('id', item.id)
    .eq('status', 'uploading')
    .eq('processing_started_at', leaseToken)
    .select('id')
    .maybeSingle()
  if (attemptUpdateError) {
    throw new Error(`更新 Instagram 发布尝试状态失败: ${attemptUpdateError.message}`)
  }
  if (!attemptUpdateError) {
    const leaseActive = await renewInstagramPublishLease(supabase, item.id, leaseToken)
    if (!leaseActive) throw new InstagramPublishLeaseLostError()
  }

  try {
    const accessToken = await getValidAccessToken(supabase, account, renewLeaseBeforeExternalWrite)
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
    const onMediaPublished = async (mediaId: string) => {
      await persistPublishedIdentity(supabase, item.id, leaseToken, mediaId)
    }
    const prepareMediaPublish = async (containerId: string) => {
      await renewLeaseBeforeExternalWrite()
      const barrierSaved = await enterInstagramMediaPublishBarrier(
        supabase,
        item.id,
        leaseToken,
        containerId,
        new Date().toISOString()
      )
      if (!barrierSaved) throw new InstagramPublishLeaseLostError()
    }
    const upload = existingContainerId
      ? await publishInstagramExistingContainer(accessToken, {
        accountId: account.instagram_account_id,
        creationId: existingContainerId,
        deferOnContainerProcessing: true,
        pollIntervalMs: inlinePoll.pollIntervalMs,
        maxStatusChecks: inlinePoll.maxStatusChecks,
        beforeStatusCheck: renewLeaseBeforeExternalWrite,
        onBeforeMediaPublish: prepareMediaPublish,
        onMediaPublished,
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
        beforeStatusCheck: renewLeaseBeforeExternalWrite,
        beforeContainerCreate: renewLeaseBeforeExternalWrite,
        onBeforeMediaPublish: prepareMediaPublish,
        onMediaPublished,
        onContainerCreated: async (containerId) => {
          await markItemContainerActive(
            supabase,
            item.id,
            leaseToken,
            containerId,
            'Instagram 发布容器已创建，等待平台处理'
          )
        },
      })

    const publishedAt = new Date().toISOString()
    const publishedUpdate = buildInstagramPublishedItemUpdate(upload, publishedAt)
    const publishedUpdateSaved = await updateInstagramItemWithRetry(
      supabase,
      item.id,
      leaseToken,
      publishedUpdate,
      'published'
    )
    if (!publishedUpdateSaved) {
      console.error('[Instagram Publish] Published metadata persistence failed', {
        code: 'INSTAGRAM_PUBLISHED_METADATA_UPDATE_FAILED',
      })
    }
    return 'published'
  } catch (error) {
    if (error instanceof InstagramPublishLeaseLostError) {
      throw error
    }

    if (error instanceof InstagramPostPublishPersistenceError) {
      const reconciled = await persistInstagramReconciliationState(
        supabase,
        item.id,
        leaseToken,
        'container_created',
        error.mediaId,
        new Date().toISOString()
      )
      if (reconciled) return 'published'
      console.error('[Instagram Publish] Reconciliation persistence failed', {
        code: 'INSTAGRAM_RECONCILIATION_UPDATE_FAILED',
      })
      throw error
    }

    if (error instanceof InstagramContainerAlreadyPublishedError) {
      const reconciled = await persistInstagramReconciliationState(
        supabase,
        item.id,
        leaseToken,
        'uploading',
        error.containerId,
        new Date().toISOString()
      )
      if (reconciled) return 'published'
      console.error('[Instagram Publish] Reconciliation persistence failed', {
        code: 'INSTAGRAM_RECONCILIATION_UPDATE_FAILED',
      })
      throw error
    }

    if (error instanceof InstagramMediaContainerOutcomeUnknownError) {
      const saved = await persistInstagramMediaCreateOutcomeUnknown(
        supabase,
        item.id,
        leaseToken,
        new Date().toISOString()
      )
      if (saved) return 'published'
      console.error('[Instagram Publish] Unknown container create outcome persistence failed', {
        code: 'INSTAGRAM_MEDIA_CREATE_OUTCOME_UNKNOWN_UPDATE_FAILED',
      })
      throw error
    }

    if (error instanceof InstagramMediaContainerRejectedError) {
      await markItemFailed(
        supabase,
        item.id,
        leaseToken,
        error.message,
        'INSTAGRAM_MEDIA_CREATE_REJECTED',
        undefined,
        'uploading'
      )
      throw error
    }

    if (error instanceof InstagramMediaPublishOutcomeUnknownError) {
      const saved = await persistInstagramMediaPublishOutcomeUnknown(
        supabase,
        item.id,
        leaseToken,
        error.containerId,
        new Date().toISOString()
      )
      if (saved) return 'published'
      console.error('[Instagram Publish] Unknown media publish outcome persistence failed', {
        code: 'INSTAGRAM_MEDIA_PUBLISH_OUTCOME_UNKNOWN_UPDATE_FAILED',
      })
      throw error
    }

    if (error instanceof InstagramMediaPublishRejectedError) {
      await markItemFailed(
        supabase,
        item.id,
        leaseToken,
        error.message,
        'INSTAGRAM_MEDIA_PUBLISH_REJECTED',
        error.containerId,
        'container_created'
      )
      throw error
    }

    if (error instanceof InstagramContainerTerminalError) {
      await markItemFailed(
        supabase,
        item.id,
        leaseToken,
        error.message,
          'INSTAGRAM_CONTAINER_TERMINAL_ERROR',
          error.containerId,
          'uploading'
      )
      throw new Error(error.message)
    }

    if (error instanceof InstagramContainerProcessingError) {
      if (attemptCount >= MAX_CONTAINER_POLL_ATTEMPTS) {
        const timeoutMessage = `Instagram 发布容器处理超时 (${error.statusCode})${error.statusDetail ? `: ${error.statusDetail}` : ''}`
        await markItemFailed(
          supabase,
          item.id,
          leaseToken,
          timeoutMessage,
          'INSTAGRAM_CONTAINER_PROCESSING_TIMEOUT',
          error.containerId,
          'uploading'
        )
        throw new Error(timeoutMessage)
      }

      await markItemContainerProcessing(supabase, item.id, leaseToken, error.containerId, error.message)
      return 'deferred'
    }

    const message = getErrorMessage(error, 'Instagram 发布失败')
    await markItemFailed(supabase, item.id, leaseToken, message, 'INSTAGRAM_UPLOAD_FAILED', undefined, 'uploading')
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

async function markItemContainerProcessing(
  supabase: any,
  itemId: string,
  leaseToken: string,
  containerId: string,
  message: string
) {
  const { data, error } = await supabase
    .from('instagram_publish_task_items')
    .update(buildInstagramContainerProcessingUpdate(containerId, message, new Date().toISOString()))
    .eq('id', itemId)
    .eq('status', 'uploading')
    .eq('processing_started_at', leaseToken)
    .select('id')
    .maybeSingle()
  if (error) {
    throw new Error(`保存 Instagram 发布容器状态失败: ${error.message}`)
  }
  if (!data) throw new InstagramPublishLeaseLostError()
}

async function persistPublishedIdentity(supabase: any, itemId: string, leaseToken: string, mediaId: string) {
  const publishedAt = new Date().toISOString()
  const saved = await updateInstagramItemWithRetry(
    supabase,
    itemId,
    leaseToken,
    buildInstagramPublishedIdentityUpdate(mediaId, publishedAt),
    'container_created'
  )
  if (!saved) {
    throw new Error('保存 Instagram 最终媒体状态失败')
  }
}

async function markItemContainerActive(
  supabase: any,
  itemId: string,
  leaseToken: string,
  containerId: string,
  message: string
) {
  const { data, error } = await supabase
    .from('instagram_publish_task_items')
    .update(buildInstagramActiveContainerUpdate(containerId, message, new Date().toISOString()))
    .eq('id', itemId)
    .eq('status', 'uploading')
    .eq('processing_started_at', leaseToken)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    throw new Error(`保存 Instagram 活动发布容器失败${error ? `: ${error.message}` : ''}`)
  }
}

async function markItemFailed(
  supabase: any,
  itemId: string,
  leaseToken: string,
  message: string,
  code: string,
  containerId: string | undefined,
  expectedStatus: 'uploading' | 'container_created' | 'published'
) {
  const saved = await persistInstagramFailedItem(
    supabase,
    itemId,
    leaseToken,
    message,
    code,
    containerId,
    expectedStatus
  )
  if (!saved) throw new InstagramPublishLeaseLostError()
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
