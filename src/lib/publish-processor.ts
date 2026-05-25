/**
 * 发布任务处理器 - 共用模块
 * 
 * 统一处理立即发布和定时发布任务
 * 
 * 特性：
 * - 动态并发（5-20 个账号）
 * - 状态锁定防止重复执行
 * - 超时保护（2分钟/个）
 * - 自动更新父任务状态
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { checkPublishStatus, initVideoPublishFromUrl, waitForPublishComplete } from '@/lib/tiktok/content-posting'
import { refreshAccessToken } from '@/lib/tiktok/oauth'

// ============================================================================
// 配置常量
// ============================================================================

const MAX_ITEMS_PER_RUN = 50   // 每次最多处理任务项数
const PUBLISH_TIMEOUT_MS = 300000  // 单个发布超时 5 分钟（TikTok 需从 URL 下载视频）
const POLL_INTERVAL_MS = 8000  // 轮询间隔 8 秒（避免触发限频）
const RECOVERY_STALE_MS = 15 * 60 * 1000
const STATUS_CHECK_STALE_MS = 5 * 60 * 1000
const STATUS_CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000
const RECOVERY_BATCH_LIMIT = 50

// OSS 加速域名（已在 TikTok URL Properties 白名单中验证通过）
const OSS_ACCELERATE_HOST = 'tokfactory-videos.oss-accelerate.aliyuncs.com'

/**
 * 将视频 URL 转为 OSS 加速域名
 * TikTok 海外服务器通过加速域名下载视频更快，避免超时
 */
function toAcceleratedUrl(url: string): string {
    try {
        const u = new URL(url)
        // 匹配 OSS 原始域名
        if (u.hostname === 'tokfactory-videos.oss-cn-beijing.aliyuncs.com') {
            u.hostname = OSS_ACCELERATE_HOST
            return u.toString()
        }
        // 匹配 media 自定义域名（通过 ECS 反代到 OSS）
        if (u.hostname === 'media.toryxai.com' || u.hostname === 'media.tokfactoryai.com') {
            u.hostname = OSS_ACCELERATE_HOST
            return u.toString()
        }
        return url
    } catch {
        return url
    }
}

// ============================================================================
// 类型定义
// ============================================================================

/** 待处理任务项 */
interface PublishItem {
    id: string
    task_id: string
    account_id: string
    video_url: string
    title: string
    scheduled_at: string | null
    cover_timestamp_ms?: number
    plan_sequence?: number | null
    status: string
    tiktok_publish_id?: string | null
    processing_started_at?: string | null
    publish_init_started_at?: string | null
    last_status_check_at?: string | null
    publish_attempt_count?: number | null
    publish_tasks: {
        privacy_level: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'
        allow_comment: boolean
        allow_duet: boolean
        allow_stitch: boolean
        brand_content_toggle: boolean
        brand_organic_toggle: boolean
        is_aigc: boolean
    }
}

/** 账号信息 */
interface Account {
    id: string
    access_token: string
    refresh_token: string
}

interface ActiveRecoveryItem {
    id: string
    task_id: string
    account_id: string
    status: string
    scheduled_at: string | null
    tiktok_publish_id: string | null
    processing_started_at: string | null
    publish_init_started_at: string | null
    last_status_check_at: string | null
}

type PublishOutcome = 'success' | 'failed' | 'confirming'

const ERROR_CODES = {
    tokenRefreshFailed: 'TOKEN_REFRESH_FAILED',
    videoUrlUnavailable: 'VIDEO_URL_UNAVAILABLE',
    tiktokInitRejected: 'TIKTOK_INIT_REJECTED',
    tiktokStatusFailed: 'TIKTOK_STATUS_FAILED',
    tiktokProcessingTimeout: 'TIKTOK_PROCESSING_TIMEOUT',
    workerInterruptedNeedsReview: 'WORKER_INTERRUPTED_NEEDS_REVIEW',
    unknown: 'UNKNOWN_ERROR',
} as const
type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]

/** 处理结果 */
export interface ProcessResult {
    success: number
    failed: number
    confirming?: number
    recovered?: number
    skipped: number
    errors: string[]
    duration_ms: number
}

/** 处理选项 */
export interface ProcessOptions {
    /** 指定任务 ID（立即发布用） */
    taskId?: string
    /** 最多处理几个（定时发布用） */
    maxItems?: number
    /** 处理模式 */
    mode: 'immediate' | 'scheduled'
}

// ============================================================================
// 主处理函数
// ============================================================================

/**
 * 处理发布队列
 * 
 * @param options 处理选项
 * @returns 处理结果
 */
export async function processPublishQueue(options: ProcessOptions): Promise<ProcessResult> {
    const startTime = Date.now()
    const supabase = createAdminClient()

    const result: ProcessResult = {
        success: 0,
        failed: 0,
        confirming: 0,
        recovered: 0,
        skipped: 0,
        errors: [],
        duration_ms: 0
    }

    try {
        if (options.mode === 'scheduled') {
            const recovery = await recoverInterruptedMultiTaskItems(supabase)
            result.recovered = recovery.recovered
            result.success += recovery.success
            result.failed += recovery.failed
            result.confirming = (result.confirming || 0) + recovery.confirming
        }

        // 1. 查询待处理任务项
        const items = await queryPendingItems(supabase, options)

        if (items.length === 0) {
            console.log('[Publisher] No items to process')
            result.duration_ms = Date.now() - startTime
            return result
        }

        console.log(`[Publisher] Found ${items.length} items to process (mode: ${options.mode})`)

        // 2. 先抢占任务项，后续只处理当前进程成功抢到的行，避免并发重复发布
        const lockedItemIds = await lockItems(supabase, items.map(i => i.id))
        const lockedItems = items.filter(item => lockedItemIds.has(item.id))

        if (lockedItems.length === 0) {
            console.log('[Publisher] No items locked, another processor may have claimed them')
            result.skipped = items.length
            result.duration_ms = Date.now() - startTime
            return result
        }

        result.skipped = items.length - lockedItems.length

        // 3. 获取当前进程抢到的账号
        const accountIds = [...new Set(lockedItems.map(item => item.account_id))]
        const accounts = await getAccounts(supabase, accountIds)

        if (accounts.size === 0) {
            console.error('[Publisher] No valid accounts found')
            await markItemsFailed(
                supabase,
                lockedItems.map(item => item.id),
                '账号不存在或 token 无效',
                ERROR_CODES.tokenRefreshFailed
            )
            const taskIds = [...new Set(lockedItems.map(item => item.task_id))]
            for (const taskId of taskIds) {
                await updateTaskFinalStatus(supabase, taskId)
            }
            result.failed += lockedItems.length
            result.duration_ms = Date.now() - startTime
            return result
        }

        // 4. 发布前统一刷新所有涉及账号的 access_token
        await refreshAccountTokens(supabase, accounts)

        // 5. 更新父任务状态为 processing
        const taskIds = [...new Set(lockedItems.map(item => item.task_id))]
        await updateTasksToProcessing(supabase, taskIds)

        // 6. 按 scheduled_at 时间顺序处理（支持间隔发布）
        // 在"立即发布+间隔"模式下，等待直到每个任务的 scheduled_at 时间
        for (const item of lockedItems) {
            // 计算需要等待的时间
            const scheduledAt = new Date(item.scheduled_at || Date.now())
            const waitMs = Math.max(0, scheduledAt.getTime() - Date.now())

            if (waitMs > 0 && waitMs < 30 * 60 * 1000) { // 最多等待30分钟
                console.log(`[Publisher] Waiting ${Math.round(waitMs / 1000)}s for item ${item.id}`)
                await new Promise(resolve => setTimeout(resolve, waitMs))
            }

            // 处理单个任务项
            try {
                const outcome = await publishItem(supabase, item, accounts)
                if (outcome === 'success') {
                    result.success++
                } else if (outcome === 'failed') {
                    result.failed++
                } else {
                    result.confirming = (result.confirming || 0) + 1
                }
            } catch (_error) {
                result.failed++
            }
        }

        // 7. 更新父任务最终状态
        for (const taskId of taskIds) {
            await updateTaskFinalStatus(supabase, taskId)
        }

        result.duration_ms = Date.now() - startTime
        console.log(`[Publisher] Completed in ${result.duration_ms}ms. Success: ${result.success}, Failed: ${result.failed}`)

        return result

    } catch (error) {
        console.error('[Publisher] Error:', error)
        result.errors.push(error instanceof Error ? error.message : 'Unknown error')
        result.duration_ms = Date.now() - startTime
        return result
    }
}

// ============================================================================
// 辅助函数
// ============================================================================

async function recoverInterruptedMultiTaskItems(
    supabase: ReturnType<typeof createAdminClient>
): Promise<{ recovered: number; success: number; failed: number; confirming: number }> {
    const now = Date.now()
    const staleCutoff = new Date(now - RECOVERY_STALE_MS).toISOString()
    const statusCutoff = new Date(now - STATUS_CHECK_STALE_MS).toISOString()

    const { data, error } = await supabase
        .from('publish_task_items')
        .select(`
            id,
            task_id,
            account_id,
            status,
            scheduled_at,
            tiktok_publish_id,
            processing_started_at,
            publish_init_started_at,
            last_status_check_at,
            publish_tasks!inner(workflow)
        `)
        .in('status', ['processing', 'uploading'])
        .eq('publish_tasks.workflow', 'multi_task')
        .order('updated_at', { ascending: true })
        .limit(RECOVERY_BATCH_LIMIT)

    if (error) {
        console.error('[Publisher] Recovery query failed:', error)
        return { recovered: 0, success: 0, failed: 0, confirming: 0 }
    }

    const items = ((data || []) as unknown as ActiveRecoveryItem[]).filter((item) => {
        if (item.status === 'processing') {
            return !item.processing_started_at || item.processing_started_at <= staleCutoff
        }

        if (item.status === 'uploading') {
            return !item.last_status_check_at || item.last_status_check_at <= statusCutoff
        }

        return false
    })
    if (items.length === 0) return { recovered: 0, success: 0, failed: 0, confirming: 0 }

    const taskIds = new Set<string>()
    const accountIds = [...new Set(items.map(item => item.account_id))]
    const accounts = await getAccounts(supabase, accountIds)
    await refreshAccountTokens(supabase, accounts)

    let recovered = 0
    let success = 0
    let failed = 0
    let confirming = 0

    for (const item of items) {
        const itemStartedAt = item.processing_started_at || item.publish_init_started_at || item.scheduled_at
        const ageMs = itemStartedAt ? now - new Date(itemStartedAt).getTime() : Number.POSITIVE_INFINITY
        taskIds.add(item.task_id)

        if (item.status === 'processing' && !item.publish_init_started_at) {
            const restoredAt = new Date().toISOString()
            const { error: restoreError } = await supabase
                .from('publish_task_items')
                .update({
                    status: 'scheduled',
                    processing_started_at: null,
                    error_code: null,
                    error_message: null,
                    updated_at: restoredAt,
                })
                .eq('id', item.id)
                .eq('status', 'processing')

            if (restoreError) {
                console.error('[Publisher] Failed to restore interrupted item:', item.id, restoreError)
            } else {
                recovered++
            }
            continue
        }

        if (item.status === 'processing' && item.publish_init_started_at && !item.tiktok_publish_id) {
            await markItemFailed(
                supabase,
                item.id,
                '服务器中断，无法确认 TikTok 是否已接收，请检查账号后处理',
                ERROR_CODES.workerInterruptedNeedsReview
            )
            recovered++
            failed++
            continue
        }

        if (item.status !== 'uploading' || !item.tiktok_publish_id) continue

        const account = accounts.get(item.account_id)
        if (!account) {
            await markItemFailed(supabase, item.id, '账号不存在或 token 无效', ERROR_CODES.tokenRefreshFailed)
            recovered++
            failed++
            continue
        }

        try {
            const checkedAt = new Date().toISOString()
            const status = await checkPublishStatus(account.access_token, item.tiktok_publish_id)

            if (status.status === 'PUBLISH_COMPLETE' || status.status === 'SEND_TO_USER_INBOX') {
                await supabase
                    .from('publish_task_items')
                    .update({
                        status: 'published',
                        tiktok_share_id: status.postId,
                        tiktok_video_id: status.postId,
                        published_at: checkedAt,
                        last_status_check_at: checkedAt,
                        error_code: null,
                        error_message: null,
                        updated_at: checkedAt,
                    })
                    .eq('id', item.id)
                recovered++
                success++
                continue
            }

            if (status.status === 'FAILED') {
                await markItemFailed(
                    supabase,
                    item.id,
                    status.failReason || 'TikTok 返回发布失败',
                    ERROR_CODES.tiktokStatusFailed
                )
                recovered++
                failed++
                continue
            }

            if (ageMs > STATUS_CONFIRMATION_WINDOW_MS) {
                await markItemFailed(
                    supabase,
                    item.id,
                    'TikTok 长时间未返回最终结果',
                    ERROR_CODES.tiktokProcessingTimeout
                )
                recovered++
                failed++
                continue
            }

            await supabase
                .from('publish_task_items')
                .update({
                    last_status_check_at: checkedAt,
                    error_code: null,
                    error_message: 'TikTok 仍在处理，系统会继续确认结果',
                    updated_at: checkedAt,
                })
                .eq('id', item.id)
            confirming++
        } catch (statusError) {
            if (ageMs > STATUS_CONFIRMATION_WINDOW_MS) {
                await markItemFailed(
                    supabase,
                    item.id,
                    getErrorMessage(statusError, 'TikTok 状态确认失败'),
                    ERROR_CODES.tiktokStatusFailed
                )
                recovered++
                failed++
            } else {
                const checkedAt = new Date().toISOString()
                await supabase
                    .from('publish_task_items')
                    .update({
                        last_status_check_at: checkedAt,
                        error_message: getErrorMessage(statusError, 'TikTok 状态确认失败'),
                        updated_at: checkedAt,
                    })
                    .eq('id', item.id)
                confirming++
            }
        }
    }

    for (const taskId of taskIds) {
        await updateTaskFinalStatus(supabase, taskId)
    }

    return { recovered, success, failed, confirming }
}

/**
 * 查询待处理任务项
 */
async function queryPendingItems(
    supabase: ReturnType<typeof createAdminClient>,
    options: ProcessOptions
): Promise<PublishItem[]> {
    const now = new Date().toISOString()

    let query = supabase
        .from('publish_task_items')
        .select(`
            id, task_id, account_id, video_url, title, scheduled_at, cover_timestamp_ms, plan_sequence, status,
            tiktok_publish_id, processing_started_at, publish_init_started_at, last_status_check_at, publish_attempt_count,
            publish_tasks (
                privacy_level,
                allow_comment,
                allow_duet,
                allow_stitch,
                brand_content_toggle,
                brand_organic_toggle,
                is_aigc
            )
        `)

    if (options.mode === 'immediate' && options.taskId) {
        // 立即发布：查询指定任务的所有 pending 项
        query = query
            .eq('task_id', options.taskId)
            .eq('status', 'pending')
    } else if (options.mode === 'scheduled') {
        // 定时发布：查询已到期的 scheduled 项
        query = query
            .eq('status', 'scheduled')
            .lte('scheduled_at', now)
    }

    query = query
        .order('scheduled_at', { ascending: true })
        .order('plan_sequence', { ascending: true, nullsFirst: false })
        .limit(options.maxItems || MAX_ITEMS_PER_RUN)

    const { data, error } = await query

    if (error) {
        console.error('[Publisher] Query error:', error)
        return []
    }

    return (data || []) as unknown as PublishItem[]
}

/**
 * 获取账号信息
 */
async function getAccounts(
    supabase: ReturnType<typeof createAdminClient>,
    accountIds: string[]
): Promise<Map<string, Account>> {
    const { data, error } = await supabase
        .from('tiktok_accounts')
        .select('id, access_token, refresh_token')
        .in('id', accountIds)

    if (error || !data) {
        console.error('[Publisher] Failed to get accounts:', error)
        return new Map()
    }

    return new Map(data.map(a => [a.id, a]))
}

/**
 * 发布前统一刷新所有账号的 access_token
 * 
 * TikTok access_token 有效期仅 ~24h，但数据库 token_expires_at 存的是 refresh_token 的 90 天寿命，
 * 无法可靠判断 access_token 是否过期。因此每次发布前统一刷新，确保 token 有效。
 */
async function refreshAccountTokens(
    supabase: ReturnType<typeof createAdminClient>,
    accounts: Map<string, Account>
): Promise<void> {
    for (const [accountId, account] of accounts) {
        try {
            console.log(`[Publisher] Refreshing token for account ${accountId}`)
            const tokenResponse = await refreshAccessToken(account.refresh_token)

            // 更新内存中的 token
            account.access_token = tokenResponse.access_token
            account.refresh_token = tokenResponse.refresh_token

            // 写回数据库
            await supabase
                .from('tiktok_accounts')
                .update({
                    access_token: tokenResponse.access_token,
                    refresh_token: tokenResponse.refresh_token,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', accountId)

            console.log(`[Publisher] Token refreshed for account ${accountId}`)
        } catch (error) {
            console.error(`[Publisher] Failed to refresh token for account ${accountId}:`, error)
            // 刷新失败不阻塞其他账号，但该账号的发布会在 publishItem 中失败
        }
    }
}

/**
 * 锁定任务项（状态改为 processing）
 */
async function lockItems(
    supabase: ReturnType<typeof createAdminClient>,
    itemIds: string[]
): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set()

    const now = new Date().toISOString()
    const { data: existing, error: existingError } = await supabase
        .from('publish_task_items')
        .select('id, publish_attempt_count')
        .in('id', itemIds)

    if (existingError) {
        console.error('[Publisher] Failed to read items before lock:', existingError)
        return new Set()
    }

    const lockedIds = new Set<string>()

    for (const item of existing || []) {
        const attemptCount = Number(item.publish_attempt_count || 0) + 1
        const { data, error } = await supabase
            .from('publish_task_items')
            .update({
                status: 'processing',
                processing_started_at: now,
                publish_init_started_at: null,
                last_status_check_at: null,
                publish_attempt_count: attemptCount,
                error_code: null,
                error_message: null,
                updated_at: now,
            })
            .eq('id', item.id)
            .in('status', ['pending', 'scheduled'])
            .select('id')
            .maybeSingle()

        if (error) {
            console.error('[Publisher] Failed to lock item:', item.id, error)
            continue
        }

        if (data?.id) lockedIds.add(data.id)
    }

    return lockedIds
}

async function markItemsFailed(
    supabase: ReturnType<typeof createAdminClient>,
    itemIds: string[],
    message: string,
    errorCode: ErrorCode = ERROR_CODES.unknown
): Promise<void> {
    if (itemIds.length === 0) return

    const { error } = await supabase
        .from('publish_task_items')
        .update({
            status: 'failed',
            error_code: errorCode,
            error_message: message,
            updated_at: new Date().toISOString(),
        })
        .in('id', itemIds)

    if (error) {
        console.error('[Publisher] Failed to mark locked items failed:', error)
    }
}

async function markItemFailed(
    supabase: ReturnType<typeof createAdminClient>,
    itemId: string,
    message: string,
    errorCode: ErrorCode = ERROR_CODES.unknown
): Promise<void> {
    const { error } = await supabase
        .from('publish_task_items')
        .update({
            status: 'failed',
            error_code: errorCode,
            error_message: message,
            updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)

    if (error) {
        console.error('[Publisher] Failed to mark item failed:', itemId, error)
    }
}

/**
 * 更新任务状态为 processing
 */
async function updateTasksToProcessing(
    supabase: ReturnType<typeof createAdminClient>,
    taskIds: string[]
): Promise<void> {
    const { error } = await supabase
        .from('publish_tasks')
        .update({ status: 'running' })  // W9: DB CHECK 约束使用 'running' 而非 'processing'
        .in('id', taskIds)
        .in('status', ['pending', 'scheduled'])

    if (error) {
        console.error('[Publisher] Failed to update tasks to processing:', error)
    }
}

/**
 * 发布单个任务项
 */
function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback
}

function getPublishErrorCode(error: unknown) {
    const message = getErrorMessage(error, '').toLowerCase()
    if (message.includes('videourl') || message.includes('视频url') || message.includes('https') || message.includes('placeholder')) {
        return ERROR_CODES.videoUrlUnavailable
    }
    if (message.includes('token') || message.includes('授权')) {
        return ERROR_CODES.tokenRefreshFailed
    }
    if (message.includes('tiktok') || message.includes('publish')) {
        return ERROR_CODES.tiktokInitRejected
    }
    return ERROR_CODES.unknown
}

function isPublishTimeout(errorMessage: string | undefined) {
    return !!errorMessage && errorMessage.toLowerCase().includes('timeout')
}

async function publishItem(
    supabase: ReturnType<typeof createAdminClient>,
    item: PublishItem,
    accounts: Map<string, Account>
): Promise<PublishOutcome> {
    try {
        const account = accounts.get(item.account_id)
        if (!account) {
            throw new Error('账号不存在或 token 无效')
        }

        // 验证视频 URL
        if (!item.video_url || item.video_url.startsWith('placeholder://')) {
            throw new Error('视频URL无效')
        }

        if (!item.video_url.startsWith('https://')) {
            throw new Error('视频URL必须使用HTTPS')
        }

        console.log('[Publisher] Publishing:', item.id, item.video_url.substring(0, 60))

        // 将视频 URL 转为 OSS 加速域名（海外 TikTok 服务器下载更快）
        const acceleratedUrl = toAcceleratedUrl(item.video_url)
        if (acceleratedUrl !== item.video_url) {
            console.log('[Publisher] Using accelerated URL:', acceleratedUrl.substring(0, 80))
        }

        const initStartedAt = new Date().toISOString()
        await supabase
            .from('publish_task_items')
            .update({
                publish_init_started_at: initStartedAt,
                updated_at: initStartedAt,
            })
            .eq('id', item.id)

        // 调用 TikTok 发布 API
        const publishId = await initVideoPublishFromUrl(
            account.access_token,
            acceleratedUrl,
            {
                title: item.title,
                privacyLevel: item.publish_tasks?.privacy_level,
                disableDuet: !item.publish_tasks?.allow_duet,
                disableComment: !item.publish_tasks?.allow_comment,
                disableStitch: !item.publish_tasks?.allow_stitch,
                brandContentToggle: item.publish_tasks?.brand_content_toggle,
                brandOrganicToggle: item.publish_tasks?.brand_organic_toggle,
                isAigc: item.publish_tasks?.is_aigc ?? true,
                videoCoverTimestampMs: item.cover_timestamp_ms,
            }
        )

        console.log('[Publisher] Initiated:', publishId)

        // 更新为 uploading 状态
        await supabase
            .from('publish_task_items')
            .update({
                status: 'uploading',
                tiktok_publish_id: publishId,
                last_status_check_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', item.id)

        // 等待发布完成
        const result = await waitForPublishComplete(
            account.access_token,
            publishId,
            PUBLISH_TIMEOUT_MS,
            POLL_INTERVAL_MS
        )

        if (result.success) {
            console.log('[Publisher] Success:', result.postId)

            const now = new Date().toISOString()
            await supabase
                .from('publish_task_items')
                .update({
                    status: 'published',
                    tiktok_share_id: result.postId,
                    tiktok_video_id: result.postId,  // W5: sync-stats 依赖此字段查询视频统计
                    error_code: null,
                    error_message: null,
                    published_at: now,
                    updated_at: now,
                })
                .eq('id', item.id)

            return 'success'
        }

        if (isPublishTimeout(result.error)) {
            const now = new Date().toISOString()
            await supabase
                .from('publish_task_items')
                .update({
                    status: 'uploading',
                    error_code: null,
                    error_message: 'TikTok 仍在处理，系统会继续确认结果',
                    last_status_check_at: now,
                    updated_at: now,
                })
                .eq('id', item.id)

            return 'confirming'
        }

        await markItemFailed(
            supabase,
            item.id,
            result.error || 'TikTok 发布失败',
            ERROR_CODES.tiktokStatusFailed
        )
        return 'failed'

    } catch (error) {
        console.error('[Publisher] Item failed:', item.id, error)

        await markItemFailed(
            supabase,
            item.id,
            getErrorMessage(error, '发布失败'),
            getPublishErrorCode(error)
        )

        return 'failed'
    }
}

/**
 * 更新父任务最终状态
 */
async function updateTaskFinalStatus(
    supabase: ReturnType<typeof createAdminClient>,
    taskId: string
): Promise<void> {
    try {
        // 查询该任务下所有项的状态
        const { data: items } = await supabase
            .from('publish_task_items')
            .select('status')
            .eq('task_id', taskId)

        if (!items || items.length === 0) return

        const statuses = items.map(i => i.status)

        // 计算各状态数量（for cache）
        const publishedCount = statuses.filter(s => s === 'published').length
        const pendingCount = statuses.filter(s => s === 'pending' || s === 'scheduled').length
        const activeCount = statuses.filter(s => s === 'processing' || s === 'uploading').length
        const failedCount = statuses.filter(s => s === 'failed').length
        const cancelledCount = statuses.filter(s => s === 'cancelled').length

        if (activeCount > 0 || pendingCount > 0) {
            let nextStatus = 'pending'
            if (activeCount > 0) {
                nextStatus = 'running'
            } else if (statuses.includes('scheduled')) {
                nextStatus = 'scheduled'
            }

            await supabase
                .from('publish_tasks')
                .update({
                    status: nextStatus,
                    success_count: publishedCount,
                    failed_count: failedCount,
                    published_count: publishedCount,
                    pending_count: pendingCount
                })
                .eq('id', taskId)

            return
        }

        // 确定最终状态
        let finalStatus: string
        if (cancelledCount === statuses.length) {
            finalStatus = 'cancelled'
        } else if (failedCount === 0 && cancelledCount === 0) {
            finalStatus = 'completed'
        } else if (publishedCount === 0) {
            finalStatus = failedCount > 0 ? 'failed' : 'cancelled'
        } else {
            finalStatus = 'partial_failed'
        }

        await supabase
            .from('publish_tasks')
            .update({
                status: finalStatus,
                completed_at: new Date().toISOString(),
                success_count: publishedCount,
                failed_count: failedCount,
                published_count: publishedCount,
                pending_count: pendingCount
            })
            .eq('id', taskId)

        console.log('[Publisher] Task', taskId, 'status:', finalStatus)

    } catch (error) {
        console.error('[Publisher] Failed to update task status:', taskId, error)
    }
}
