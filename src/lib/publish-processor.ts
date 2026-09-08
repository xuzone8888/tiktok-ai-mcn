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
import { isNormalTikTokAccountOwnedBy } from '@/lib/tiktok/account-authorization'
import {
    checkPublishStatus,
    initVideoPublishFromFile,
    initVideoPublishFromUrl,
    isTikTokPublishingError,
    waitForPublishComplete,
} from '@/lib/tiktok/content-posting'
import {
    getTikTokAccountTokens,
    getValidTikTokAccessToken,
    type TikTokTokenRecord,
} from '@/lib/tiktok/token-manager'

// ============================================================================
// 配置常量
// ============================================================================

const MAX_ITEMS_PER_RUN = 50   // 每次最多处理任务项数
const PUBLISH_TIMEOUT_MS = 240000  // 单个发布确认最多等待 4 分钟，后续 cron 继续确认结果
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
    publish_attempt_count: number
    tiktok_transfer_method?: 'PULL_FROM_URL' | 'FILE_UPLOAD'
    source_video_size_bytes?: number | null
    source_video_mime_type?: string | null
    tiktok_upload_outcome?: 'accepted' | 'unknown' | 'rejected' | null
    tiktok_upload_reported_at?: string | null
    publish_tasks: {
        user_id: string
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
    access_token_expires_at?: string | null
    refresh_token_expires_at?: string | null
    token: TikTokTokenRecord
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
    publish_attempt_count: number
    tiktok_transfer_method: 'PULL_FROM_URL' | 'FILE_UPLOAD'
    tiktok_upload_outcome: 'accepted' | 'unknown' | 'rejected' | null
    tiktok_upload_reported_at: string | null
}

interface RecoveryDebug {
    candidate_count: number
    multi_task_count: number
    due_count: number
    status_cutoff_ms: number
    stale_cutoff_ms: number
    sample: Array<{
        id: string
        task_id: string
        status: string
        has_publish_id: boolean
        last_status_check_at: string | null
        processing_started_at: string | null
        is_multi_task: boolean
        is_due: boolean
    }>
}

interface RecoveryResult {
    recovered: number
    success: number
    failed: number
    confirming: number
    debug?: RecoveryDebug
}

type PublishOutcome = 'success' | 'failed' | 'confirming'

const ERROR_CODES = {
    tokenRefreshFailed: 'TOKEN_REFRESH_FAILED',
    accountOwnershipMismatch: 'ACCOUNT_OWNERSHIP_MISMATCH',
    videoUrlUnavailable: 'VIDEO_URL_UNAVAILABLE',
    tiktokUnauditedPrivateOnly: 'TIKTOK_UNAUDITED_PRIVATE_ONLY',
    tiktokProviderRejected: 'TIKTOK_PROVIDER_REJECTED',
    tiktokInitOutcomeUnknown: 'TIKTOK_INIT_OUTCOME_UNKNOWN',
    tiktokPublishIdPersistFailed: 'TIKTOK_PUBLISH_ID_PERSIST_FAILED',
    tiktokInitRejected: 'TIKTOK_INIT_REJECTED',
    tiktokStatusCheckPending: 'TIKTOK_STATUS_CHECK_PENDING',
    tiktokStatusFailed: 'TIKTOK_STATUS_FAILED',
    tiktokFileUploadIncomplete: 'TIKTOK_FILE_UPLOAD_INCOMPLETE',
    tiktokProcessingTimeout: 'TIKTOK_PROCESSING_TIMEOUT',
    workerInterruptedNeedsReview: 'WORKER_INTERRUPTED_NEEDS_REVIEW',
    unknown: 'UNKNOWN_ERROR',
} as const
type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]

interface PublishFailureDetails {
    errorCode: ErrorCode
    message: string
    logContext?: {
        operation: string
        providerCode: string
        httpStatus: number | null
        outcome: string
    }
}

class PublishPreparationError extends Error {
    readonly errorCode: ErrorCode

    constructor(errorCode: ErrorCode, message: string) {
        super(message)
        this.name = 'PublishPreparationError'
        this.errorCode = errorCode
    }
}

class PublishAttemptControlError extends Error {
    readonly errorCode: ErrorCode
    readonly providerMayHaveAccepted: boolean

    constructor(errorCode: ErrorCode, message: string, providerMayHaveAccepted = false) {
        super(message)
        this.name = 'PublishAttemptControlError'
        this.errorCode = errorCode
        this.providerMayHaveAccepted = providerMayHaveAccepted
    }
}

interface DurablePublishItemState {
    id: string
    status: string
    tiktok_publish_id: string | null
    publish_attempt_count: number
}

/** 处理结果 */
export interface ProcessResult {
    success: number
    failed: number
    confirming?: number
    recovered?: number
    skipped: number
    errors: string[]
    duration_ms: number
    recovery_debug?: RecoveryDebug
}

/** 处理选项 */
export interface ProcessOptions {
    /** 指定任务 ID（立即发布用） */
    taskId?: string
    /** 最多处理几个（定时发布用） */
    maxItems?: number
    /** 处理模式 */
    mode: 'immediate' | 'scheduled'
    /** 手动排查回查队列时返回候选明细 */
    debugRecovery?: boolean
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
            const recovery = await recoverInterruptedTikTokItems(supabase, options.debugRecovery)
            result.recovered = recovery.recovered
            result.success += recovery.success
            result.failed += recovery.failed
            result.confirming = (result.confirming || 0) + recovery.confirming
            if (recovery.debug) result.recovery_debug = recovery.debug
        }

        // 1. 查询待处理任务项
        let items = await queryPendingItems(supabase, options)

        if (items.length === 0) {
            console.log('[Publisher] No items to process')
            result.duration_ms = Date.now() - startTime
            return result
        }

        console.log(`[Publisher] Found ${items.length} items to process (mode: ${options.mode})`)

        const authorization = await partitionAuthorizedPublishItems(supabase, items)
        if (authorization.rejected.length > 0) {
            await markItemsFailed(
                supabase,
                authorization.rejected.map((item) => item.id),
                '任务账号归属或账号类型不匹配，已拒绝发布',
                ERROR_CODES.accountOwnershipMismatch
            )
            result.failed += authorization.rejected.length
            for (const taskId of new Set(authorization.rejected.map((item) => item.task_id))) {
                await updateTaskFinalStatus(supabase, taskId)
            }
        }
        items = authorization.allowed
        if (items.length === 0) {
            result.duration_ms = Date.now() - startTime
            return result
        }

        // 2. 先抢占任务项，后续只处理当前进程成功抢到的行，避免并发重复发布
        const lockedAttempts = await lockItems(supabase, items.map(i => i.id))
        const lockedItems = items
            .filter(item => lockedAttempts.has(item.id))
            .map(item => ({
                ...item,
                publish_attempt_count: lockedAttempts.get(item.id)!,
            }))

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
            await Promise.all(lockedItems.map(item => markItemFailedForAttempt(
                supabase,
                item.id,
                item.publish_attempt_count,
                '账号不存在或 token 无效',
                ERROR_CODES.tokenRefreshFailed,
                'processing'
            )))
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

export async function recoverInterruptedTikTokItems(
    supabase: ReturnType<typeof createAdminClient>,
    debug = false
): Promise<RecoveryResult> {
    const now = Date.now()
    const staleCutoffMs = now - RECOVERY_STALE_MS
    const statusCutoffMs = now - STATUS_CHECK_STALE_MS

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
            publish_attempt_count,
            tiktok_transfer_method,
            tiktok_upload_outcome,
            tiktok_upload_reported_at
        `)
        .in('status', ['processing', 'uploading'])
        .order('updated_at', { ascending: true })
        .limit(RECOVERY_BATCH_LIMIT)

    if (error) {
        console.error('[Publisher] Recovery query failed:', error)
        return { recovered: 0, success: 0, failed: 0, confirming: 0 }
    }

    const candidateItems = (data || []) as unknown as ActiveRecoveryItem[]
    if (candidateItems.length === 0) {
        return buildRecoveryResult(0, 0, 0, 0, debug, candidateItems, new Set(), [], staleCutoffMs, statusCutoffMs)
    }

    const candidateTaskIds = [...new Set(candidateItems.map(item => item.task_id))]
    const { data: taskRows, error: taskError } = await supabase
        .from('publish_tasks')
        .select('id, workflow')
        .in('id', candidateTaskIds)

    if (taskError) {
        console.error('[Publisher] Recovery task query failed:', taskError)
        return { recovered: 0, success: 0, failed: 0, confirming: 0 }
    }

    const existingTaskIds = new Set((taskRows || []).map(task => task.id))
    const multiTaskIds = new Set(
        (taskRows || [])
            .filter((task) => task.workflow === 'multi_task')
            .map((task) => task.id)
    )
    const dueItems = candidateItems
        .filter((item) => existingTaskIds.has(item.task_id))
        .filter((item) => isRecoveryItemDue(item, staleCutoffMs, statusCutoffMs))
    const authorization = await partitionAuthorizedPublishItems(supabase, dueItems)
    const items = authorization.allowed
    let rejectedCount = 0
    if (authorization.rejected.length > 0) {
        const rejectedOutcomes = await Promise.all(authorization.rejected.map((item) => markItemFailedForAttempt(
            supabase,
            item.id,
            item.publish_attempt_count,
            item.tiktok_transfer_method === 'FILE_UPLOAD' && Boolean(item.tiktok_publish_id)
                ? 'TikTok 可能已接收文件，但账号归属或类型已变化，请人工核对 TikTok 后处理'
                : '任务账号归属或账号类型不匹配，已拒绝恢复发布',
            item.tiktok_transfer_method === 'FILE_UPLOAD' && Boolean(item.tiktok_publish_id)
                ? ERROR_CODES.workerInterruptedNeedsReview
                : ERROR_CODES.accountOwnershipMismatch,
            item.status === 'uploading' ? 'uploading' : 'processing',
            item.tiktok_publish_id || undefined
        )))
        rejectedCount = rejectedOutcomes.filter(Boolean).length
        for (const taskId of new Set(authorization.rejected.map((item) => item.task_id))) {
            await updateTaskFinalStatus(supabase, taskId)
        }
    }
    if (items.length === 0) {
        return buildRecoveryResult(
            rejectedCount,
            0,
            rejectedCount,
            0,
            debug,
            candidateItems,
            multiTaskIds,
            dueItems,
            staleCutoffMs,
            statusCutoffMs
        )
    }

    console.log(`[Publisher] Recovering ${items.length} interrupted TikTok publish items`)

    const taskIds = new Set<string>()
    const accountIds = [...new Set(items.map(item => item.account_id))]
    const accounts = await getAccounts(supabase, accountIds)
    await refreshAccountTokens(supabase, accounts)

    let recovered = rejectedCount
    let success = 0
    let failed = rejectedCount
    let confirming = 0

    for (const item of items) {
        const itemStartedAt = item.processing_started_at || item.publish_init_started_at || item.scheduled_at
        const ageMs = itemStartedAt ? now - new Date(itemStartedAt).getTime() : Number.POSITIVE_INFINITY
        taskIds.add(item.task_id)

        if (item.status === 'processing' && !item.publish_init_started_at) {
            const restoredAt = new Date().toISOString()
            const { data: restored, error: restoreError } = await supabase
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
                .eq('publish_attempt_count', item.publish_attempt_count)
                .is('publish_init_started_at', null)
                .select('id')
                .maybeSingle()

            if (restoreError) {
                console.error('[Publisher] Failed to restore interrupted item')
            } else if (restored?.id === item.id) {
                recovered++
            }
            continue
        }

        if (item.status === 'processing' && item.publish_init_started_at && !item.tiktok_publish_id) {
            const didFail = await markItemFailedForAttempt(
                supabase,
                item.id,
                item.publish_attempt_count,
                '服务器中断，无法确认 TikTok 是否已接收，请检查账号后处理',
                ERROR_CODES.workerInterruptedNeedsReview,
                'processing'
            )
            if (didFail) {
                recovered++
                failed++
            }
            continue
        }

        if (item.status !== 'uploading' || !item.tiktok_publish_id) continue

        if (
            item.tiktok_transfer_method === 'FILE_UPLOAD'
            && item.tiktok_upload_outcome === 'rejected'
        ) {
            const didFail = await markItemFailedForAttempt(
                supabase,
                item.id,
                item.publish_attempt_count,
                'TikTok 拒绝了文件上传，请检查文件格式后重新选择文件',
                ERROR_CODES.tiktokFileUploadIncomplete,
                'uploading',
                item.tiktok_publish_id
            )
            if (didFail) {
                recovered++
                failed++
            }
            continue
        }

        const account = accounts.get(item.account_id)
        if (!account) {
            const didFail = await markItemFailedForAttempt(
                supabase,
                item.id,
                item.publish_attempt_count,
                item.tiktok_transfer_method === 'FILE_UPLOAD'
                    ? 'TikTok 可能已接收文件，但账号或授权当前不可用，请人工核对 TikTok 后处理'
                    : '账号不存在或 token 无效',
                item.tiktok_transfer_method === 'FILE_UPLOAD'
                    ? ERROR_CODES.workerInterruptedNeedsReview
                    : ERROR_CODES.tokenRefreshFailed,
                'uploading',
                item.tiktok_publish_id
            )
            if (didFail) {
                recovered++
                failed++
            }
            continue
        }

        try {
            const status = await checkPublishStatus(account.access_token, item.tiktok_publish_id)

            if (status.status === 'PUBLISH_COMPLETE' || status.status === 'SEND_TO_USER_INBOX') {
                const outcome = await persistPublishedOutcome(
                    supabase,
                    item.id,
                    item.publish_attempt_count,
                    item.tiktok_publish_id,
                    status.postId
                )
                if (outcome === 'success') {
                    recovered++
                    success++
                } else if (outcome === 'confirming') {
                    confirming++
                }
                continue
            }

            if (status.status === 'FAILED') {
                const didFail = await markItemFailedForAttempt(
                    supabase,
                    item.id,
                    item.publish_attempt_count,
                    'TikTok 返回发布失败，请检查内容和账号设置',
                    ERROR_CODES.tiktokStatusFailed,
                    'uploading',
                    item.tiktok_publish_id
                )
                if (didFail) {
                    recovered++
                    failed++
                }
                continue
            }

            const confirmationWindowMs = item.tiktok_transfer_method === 'FILE_UPLOAD'
                && !item.tiktok_upload_outcome
                ? 60 * 60 * 1000
                : STATUS_CONFIRMATION_WINDOW_MS
            if (ageMs > confirmationWindowMs) {
                const didFail = await markItemFailedForAttempt(
                    supabase,
                    item.id,
                    item.publish_attempt_count,
                    item.tiktok_transfer_method === 'FILE_UPLOAD'
                        ? 'TikTok 可能已接收文件，但长期未返回最终结果，请人工核对 TikTok 后处理'
                        : 'TikTok 长时间未返回最终结果',
                    item.tiktok_transfer_method === 'FILE_UPLOAD'
                        ? ERROR_CODES.workerInterruptedNeedsReview
                        : ERROR_CODES.tiktokProcessingTimeout,
                    'uploading',
                    item.tiktok_publish_id
                )
                if (didFail) {
                    recovered++
                    failed++
                }
                continue
            }

            const outcome = await persistPublishStatusDeferral(
                supabase,
                item.id,
                item.publish_attempt_count,
                item.tiktok_publish_id,
                'TikTok 仍在处理，系统会继续确认结果',
                null
            )
            if (outcome === 'success') {
                recovered++
                success++
            } else if (outcome === 'confirming') {
                confirming++
            }
        } catch {
            const confirmationWindowMs = item.tiktok_transfer_method === 'FILE_UPLOAD'
                && !item.tiktok_upload_outcome
                ? 60 * 60 * 1000
                : STATUS_CONFIRMATION_WINDOW_MS
            if (ageMs > confirmationWindowMs) {
                const didFail = await markItemFailedForAttempt(
                    supabase,
                    item.id,
                    item.publish_attempt_count,
                    'TikTok 发布状态长期无法确认，请人工核对账号',
                    item.tiktok_transfer_method === 'FILE_UPLOAD'
                        ? ERROR_CODES.workerInterruptedNeedsReview
                        : ERROR_CODES.tiktokStatusFailed,
                    'uploading',
                    item.tiktok_publish_id
                )
                if (didFail) {
                    recovered++
                    failed++
                }
            } else {
                const outcome = await persistPublishStatusDeferral(
                    supabase,
                    item.id,
                    item.publish_attempt_count,
                    item.tiktok_publish_id,
                    'TikTok 发布状态暂时无法确认，系统稍后继续检查',
                    ERROR_CODES.tiktokStatusCheckPending
                )
                if (outcome === 'success') {
                    recovered++
                    success++
                } else if (outcome === 'confirming') {
                    confirming++
                }
            }
        }
    }

    for (const taskId of taskIds) {
        await updateTaskFinalStatus(supabase, taskId)
    }

    return buildRecoveryResult(
        recovered,
        success,
        failed,
        confirming,
        debug,
        candidateItems,
        multiTaskIds,
        dueItems,
        staleCutoffMs,
        statusCutoffMs
    )
}

function isRecoveryItemDue(item: ActiveRecoveryItem, staleCutoffMs: number, statusCutoffMs: number): boolean {
    if (item.status === 'processing') {
        return isTimestampDue(item.processing_started_at, staleCutoffMs)
    }

    if (item.status === 'uploading') {
        return isTimestampDue(item.last_status_check_at, statusCutoffMs)
    }

    return false
}

function isTimestampDue(value: string | null | undefined, cutoffMs: number): boolean {
    if (!value) return true

    const timestampMs = new Date(value).getTime()
    if (!Number.isFinite(timestampMs)) return true

    return timestampMs <= cutoffMs
}

function buildRecoveryResult(
    recovered: number,
    success: number,
    failed: number,
    confirming: number,
    debug: boolean,
    candidateItems: ActiveRecoveryItem[],
    multiTaskIds: Set<string>,
    dueItems: ActiveRecoveryItem[],
    staleCutoffMs: number,
    statusCutoffMs: number
): RecoveryResult {
    const result: RecoveryResult = { recovered, success, failed, confirming }
    if (!debug) return result

    const dueIds = new Set(dueItems.map(item => item.id))
    result.debug = {
        candidate_count: candidateItems.length,
        multi_task_count: candidateItems.filter(item => multiTaskIds.has(item.task_id)).length,
        due_count: dueItems.length,
        stale_cutoff_ms: staleCutoffMs,
        status_cutoff_ms: statusCutoffMs,
        sample: candidateItems.slice(0, 10).map(item => ({
            id: item.id,
            task_id: item.task_id,
            status: item.status,
            has_publish_id: Boolean(item.tiktok_publish_id),
            last_status_check_at: item.last_status_check_at,
            processing_started_at: item.processing_started_at,
            is_multi_task: multiTaskIds.has(item.task_id),
            is_due: dueIds.has(item.id),
        })),
    }

    return result
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
            tiktok_transfer_method, source_video_size_bytes, source_video_mime_type,
            tiktok_upload_outcome, tiktok_upload_reported_at,
            publish_tasks (
                user_id,
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
        throw new Error(`查询 TikTok 发布任务失败: ${error.message}`)
    }

    return (data || []) as unknown as PublishItem[]
}

interface PublishItemIdentity {
    id: string
    task_id: string
    account_id: string
}

async function partitionAuthorizedPublishItems<T extends PublishItemIdentity>(
    supabase: ReturnType<typeof createAdminClient>,
    items: T[]
): Promise<{ allowed: T[]; rejected: T[] }> {
    if (items.length === 0) return { allowed: [], rejected: [] }

    const taskIds = [...new Set(items.map((item) => item.task_id))]
    const accountIds = [...new Set(items.map((item) => item.account_id))]
    const [{ data: tasks, error: taskError }, { data: accounts, error: accountError }] = await Promise.all([
        supabase.from('publish_tasks').select('id, user_id').in('id', taskIds),
        supabase
            .from('tiktok_accounts')
            .select('id, user_id, account_type, status')
            .in('id', accountIds)
            .eq('status', 'active'),
    ])

    if (taskError) {
        throw new Error(`Failed to validate TikTok publish task owners: ${taskError.message}`)
    }
    if (accountError) {
        throw new Error(`Failed to validate TikTok publish account owners: ${accountError.message}`)
    }

    const taskOwners = new Map((tasks || []).map((task) => [task.id, task.user_id]))
    const accountOwners = new Map((accounts || []).map((account) => [account.id, account]))
    const allowed: T[] = []
    const rejected: T[] = []

    for (const item of items) {
        const account = accountOwners.get(item.account_id)
        if (
            account?.status === 'active'
            && isNormalTikTokAccountOwnedBy(account, taskOwners.get(item.task_id))
        ) {
            allowed.push(item)
        } else {
            rejected.push(item)
        }
    }

    return { allowed, rejected }
}

/**
 * 获取账号信息
 */
async function getAccounts(
    supabase: ReturnType<typeof createAdminClient>,
    accountIds: string[]
): Promise<Map<string, Account>> {
    const tokens = await getTikTokAccountTokens(supabase, accountIds)
    return new Map([...tokens].map(([accountId, token]) => [
        accountId,
        {
            id: accountId,
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            access_token_expires_at: token.access_token_expires_at,
            refresh_token_expires_at: token.refresh_token_expires_at,
            token,
        },
    ]))
}

/**
 * 发布前确保 access_token 可用。
 * access_token_expires_at 可判断 24h token 是否需要刷新，避免每次发布都刷新触发额外风控。
 */
async function refreshAccountTokens(
    supabase: ReturnType<typeof createAdminClient>,
    accounts: Map<string, Account>
): Promise<void> {
    for (const [accountId, account] of accounts) {
        try {
            const accessToken = await getValidTikTokAccessToken(supabase, accountId, account.token)
            account.access_token = accessToken
        } catch (error) {
            console.error(`[Publisher] Failed to prepare token for account ${accountId}:`, error)
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
): Promise<Map<string, number>> {
    if (itemIds.length === 0) return new Map()

    const now = new Date().toISOString()
    const { data: existing, error: existingError } = await supabase
        .from('publish_task_items')
        .select('id, publish_attempt_count')
        .in('id', itemIds)

    if (existingError) {
        console.error('[Publisher] Failed to read items before lock:', existingError)
        throw new Error(`锁定 TikTok 发布任务前读取失败: ${existingError.message}`)
    }

    const lockedAttempts = new Map<string, number>()

    for (const item of existing || []) {
        const previousAttemptCount = Number(item.publish_attempt_count || 0)
        const attemptCount = previousAttemptCount + 1
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
            .eq('publish_attempt_count', previousAttemptCount)
            .in('status', ['pending', 'scheduled'])
            .select('id, publish_attempt_count')
            .maybeSingle()

        if (error) {
            console.error('[Publisher] Failed to lock item:', item.id, error)
            continue
        }

        if (data?.id && data.publish_attempt_count === attemptCount) {
            lockedAttempts.set(data.id, attemptCount)
        }
    }

    return lockedAttempts
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
        .in('status', ['pending', 'scheduled'])

    if (error) {
        console.error('[Publisher] Failed to mark locked items failed:', error)
    }
}

async function readDurablePublishItemState(
    supabase: ReturnType<typeof createAdminClient>,
    itemId: string
): Promise<DurablePublishItemState | null> {
    const { data, error } = await supabase
        .from('publish_task_items')
        .select('id, status, tiktok_publish_id, publish_attempt_count')
        .eq('id', itemId)
        .maybeSingle()

    if (error) {
        console.error('[Publisher] Failed to read durable publish state')
        return null
    }

    return data as DurablePublishItemState | null
}

function outcomeFromConcurrentState(
    state: DurablePublishItemState | null,
    expectedAttempt: number,
    publishId: string
): PublishOutcome | null {
    if (!state || state.publish_attempt_count !== expectedAttempt) return null
    if (state.status === 'published') return 'success'
    if (state.status === 'failed') return 'failed'
    if (state.status === 'uploading' && state.tiktok_publish_id === publishId) return 'confirming'
    return null
}

async function markItemFailedForAttempt(
    supabase: ReturnType<typeof createAdminClient>,
    itemId: string,
    expectedAttempt: number,
    message: string,
    errorCode: ErrorCode,
    expectedStatus: 'processing' | 'uploading',
    publishId?: string
): Promise<boolean> {
    let query = supabase
        .from('publish_task_items')
        .update({
            status: 'failed',
            error_code: errorCode,
            error_message: message,
            updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .eq('status', expectedStatus)
        .eq('publish_attempt_count', expectedAttempt)

    if (publishId) query = query.eq('tiktok_publish_id', publishId)

    const { data, error } = await query.select('id').maybeSingle()
    if (error) {
        console.error('[Publisher] Failed to persist fenced publish failure')
        return false
    }
    return data?.id === itemId
}

async function persistPublishStatusDeferral(
    supabase: ReturnType<typeof createAdminClient>,
    itemId: string,
    expectedAttempt: number,
    publishId: string,
    message: string,
    errorCode: ErrorCode | null
): Promise<PublishOutcome> {
    const checkedAt = new Date().toISOString()
    const { data, error } = await supabase
        .from('publish_task_items')
        .update({
            status: 'uploading',
            last_status_check_at: checkedAt,
            error_code: errorCode,
            error_message: message,
            updated_at: checkedAt,
        })
        .eq('id', itemId)
        .eq('status', 'uploading')
        .eq('publish_attempt_count', expectedAttempt)
        .eq('tiktok_publish_id', publishId)
        .select('id')
        .maybeSingle()

    if (!error && data?.id === itemId) return 'confirming'
    if (error) {
        console.error('[Publisher] Failed to persist fenced status deferral')
        return 'failed'
    }

    const winner = await readDurablePublishItemState(supabase, itemId)
    return outcomeFromConcurrentState(winner, expectedAttempt, publishId) ?? 'failed'
}

async function persistPublishedOutcome(
    supabase: ReturnType<typeof createAdminClient>,
    itemId: string,
    expectedAttempt: number,
    publishId: string,
    postId?: string
): Promise<PublishOutcome> {
    const publishedAt = new Date().toISOString()
    const { data, error } = await supabase
        .from('publish_task_items')
        .update({
            status: 'published',
            tiktok_share_id: postId,
            tiktok_video_id: postId,
            error_code: null,
            error_message: null,
            published_at: publishedAt,
            last_status_check_at: publishedAt,
            updated_at: publishedAt,
        })
        .eq('id', itemId)
        .eq('status', 'uploading')
        .eq('publish_attempt_count', expectedAttempt)
        .eq('tiktok_publish_id', publishId)
        .select('id')
        .maybeSingle()

    if (!error && data?.id === itemId) return 'success'
    if (error) {
        console.error('[Publisher] Failed to persist fenced publish completion')
        return 'failed'
    }

    const winner = await readDurablePublishItemState(supabase, itemId)
    return outcomeFromConcurrentState(winner, expectedAttempt, publishId) ?? 'failed'
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
export function getPublishFailureDetails(error: unknown): PublishFailureDetails {
    if (error instanceof PublishPreparationError) {
        return {
            errorCode: error.errorCode,
            message: error.message,
        }
    }

    if (isTikTokPublishingError(error)) {
        const logContext = {
            operation: error.operation,
            providerCode: error.providerCode,
            httpStatus: error.httpStatus,
            outcome: error.outcome,
        }
        if (error.providerCode === 'unaudited_client_can_only_post_to_private_accounts') {
            return {
                errorCode: ERROR_CODES.tiktokUnauditedPrivateOnly,
                message: 'TikTok 未审核应用只能向私密账号发布仅自己可见的内容',
                logContext,
            }
        }
        if (error.outcome === 'unknown') {
            if (error.operation === 'status_fetch') {
                return {
                    errorCode: ERROR_CODES.tiktokStatusCheckPending,
                    message: 'TikTok 发布状态暂时无法确认，系统稍后继续检查',
                    logContext,
                }
            }
            return {
                errorCode: ERROR_CODES.tiktokInitOutcomeUnknown,
                message: '无法确认 TikTok 是否接收了发布请求，请先检查账号后再处理',
                logContext,
            }
        }
        return {
            errorCode: ERROR_CODES.tiktokProviderRejected,
            message: 'TikTok 拒绝了发布请求',
            logContext,
        }
    }

    return {
        errorCode: ERROR_CODES.unknown,
        message: '发布失败，请稍后重试',
    }
}

async function claimPublishInitDispatch(
    supabase: ReturnType<typeof createAdminClient>,
    item: PublishItem,
    initStartedAt: string
): Promise<void> {
    const { data, error } = await supabase
        .from('publish_task_items')
        .update({
            publish_init_started_at: initStartedAt,
            updated_at: initStartedAt,
        })
        .eq('id', item.id)
        .eq('status', 'processing')
        .eq('publish_attempt_count', item.publish_attempt_count)
        .is('publish_init_started_at', null)
        .is('tiktok_publish_id', null)
        .select('id, publish_attempt_count')
        .maybeSingle()

    if (error) {
        throw new PublishAttemptControlError(
            ERROR_CODES.unknown,
            '发布请求暂未发出，请稍后重试'
        )
    }
    if (data?.id !== item.id || data.publish_attempt_count !== item.publish_attempt_count) {
        throw new PublishAttemptControlError(
            ERROR_CODES.unknown,
            '本次发布执行权已失效，未向 TikTok 发出请求'
        )
    }
}

async function persistPublishIdForAttempt(
    supabase: ReturnType<typeof createAdminClient>,
    item: PublishItem,
    initStartedAt: string,
    publishId: string
): Promise<PublishOutcome | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const checkedAt = new Date().toISOString()
        const { data, error } = await supabase
            .from('publish_task_items')
            .update({
                status: 'uploading',
                tiktok_publish_id: publishId,
                last_status_check_at: checkedAt,
                error_code: null,
                error_message: null,
                updated_at: checkedAt,
            })
            .eq('id', item.id)
            .eq('status', 'processing')
            .eq('publish_attempt_count', item.publish_attempt_count)
            .eq('publish_init_started_at', initStartedAt)
            .is('tiktok_publish_id', null)
            .select('id, status, tiktok_publish_id, publish_attempt_count')
            .maybeSingle()

        if (!error && data?.id === item.id) return 'confirming'
        if (!error) break
    }

    const state = await readDurablePublishItemState(supabase, item.id)
    return outcomeFromConcurrentState(state, item.publish_attempt_count, publishId)
}

export interface PreparedTikTokFileUpload {
    itemId: string
    attempt: number
    uploadUrl: string
    chunkSize: number
    totalChunkCount: number
}

interface FileUploadTaskItem extends PublishItem {
    source_video_size_bytes: number
    source_video_mime_type: 'video/mp4' | 'video/quicktime' | 'video/webm'
    tiktok_transfer_method: 'FILE_UPLOAD'
}

function isTikTokVideoMimeType(value: unknown): value is FileUploadTaskItem['source_video_mime_type'] {
    return value === 'video/mp4' || value === 'video/quicktime' || value === 'video/webm'
}

export async function prepareTikTokFileUpload(
    supabase: ReturnType<typeof createAdminClient>,
    userId: string,
    taskId: string,
    itemId: string
): Promise<PreparedTikTokFileUpload> {
    const { data, error } = await supabase
        .from('publish_task_items')
        .select(`
            id, task_id, account_id, video_url, title, scheduled_at, cover_timestamp_ms, status,
            tiktok_publish_id, processing_started_at, publish_init_started_at, last_status_check_at,
            publish_attempt_count, tiktok_transfer_method, source_video_size_bytes,
            source_video_mime_type, tiktok_upload_outcome, tiktok_upload_reported_at,
            publish_tasks (
                user_id,
                privacy_level,
                allow_comment,
                allow_duet,
                allow_stitch,
                brand_content_toggle,
                brand_organic_toggle,
                is_aigc
            )
        `)
        .eq('id', itemId)
        .eq('task_id', taskId)
        .maybeSingle()

    if (error) {
        console.error('[Publisher] Failed to read FILE_UPLOAD item')
        throw new PublishAttemptControlError(ERROR_CODES.unknown, '无法准备 TikTok 文件上传')
    }

    const item = data as unknown as FileUploadTaskItem | null
    if (
        !item
        || item.publish_tasks?.user_id !== userId
        || item.tiktok_transfer_method !== 'FILE_UPLOAD'
        || item.status !== 'pending'
        || item.tiktok_publish_id
        || !Number.isSafeInteger(item.source_video_size_bytes)
        || item.source_video_size_bytes <= 0
        || !isTikTokVideoMimeType(item.source_video_mime_type)
    ) {
        throw new PublishAttemptControlError(
            ERROR_CODES.unknown,
            '该文件上传任务不存在、已开始或参数无效'
        )
    }

    const authorization = await partitionAuthorizedPublishItems(supabase, [item])
    if (authorization.allowed.length !== 1) {
        throw new PublishAttemptControlError(
            ERROR_CODES.accountOwnershipMismatch,
            '任务账号归属或账号类型不匹配'
        )
    }

    const lockedAttempts = await lockItems(supabase, [item.id])
    const attempt = lockedAttempts.get(item.id)
    if (!attempt) {
        throw new PublishAttemptControlError(
            ERROR_CODES.unknown,
            '该文件上传任务已被其他请求处理'
        )
    }
    item.publish_attempt_count = attempt
    item.status = 'processing'

    const accounts = await getAccounts(supabase, [item.account_id])
    const account = accounts.get(item.account_id)
    if (!account) {
        await markItemFailedForAttempt(
            supabase,
            item.id,
            attempt,
            '账号授权无效，请重新授权后再试',
            ERROR_CODES.tokenRefreshFailed,
            'processing'
        )
        throw new PublishAttemptControlError(ERROR_CODES.tokenRefreshFailed, '账号授权无效')
    }

    try {
        account.access_token = await getValidTikTokAccessToken(
            supabase,
            item.account_id,
            account.token
        )
    } catch {
        await markItemFailedForAttempt(
            supabase,
            item.id,
            attempt,
            '账号授权无效，请重新授权后再试',
            ERROR_CODES.tokenRefreshFailed,
            'processing'
        )
        throw new PublishAttemptControlError(ERROR_CODES.tokenRefreshFailed, '账号授权无效')
    }

    await updateTasksToProcessing(supabase, [item.task_id])
    const initStartedAt = new Date().toISOString()
    await claimPublishInitDispatch(supabase, item, initStartedAt)

    try {
        const initialized = await initVideoPublishFromFile(
            account.access_token,
            item.source_video_size_bytes,
            {
                title: item.title,
                privacyLevel: item.publish_tasks.privacy_level,
                disableDuet: !item.publish_tasks.allow_duet,
                disableComment: !item.publish_tasks.allow_comment,
                disableStitch: !item.publish_tasks.allow_stitch,
                brandContentToggle: item.publish_tasks.brand_content_toggle,
                brandOrganicToggle: item.publish_tasks.brand_organic_toggle,
                isAigc: item.publish_tasks.is_aigc ?? true,
                videoCoverTimestampMs: item.cover_timestamp_ms,
            }
        )

        const persisted = await persistPublishIdForAttempt(
            supabase,
            item,
            initStartedAt,
            initialized.publishId
        )
        if (persisted !== 'confirming') {
            throw new PublishAttemptControlError(
                ERROR_CODES.tiktokPublishIdPersistFailed,
                'TikTok 已接收发布初始化，但本地确认记录失败，需要人工核对',
                true
            )
        }

        return {
            itemId: item.id,
            attempt,
            uploadUrl: initialized.uploadUrl,
            chunkSize: initialized.chunkSize,
            totalChunkCount: initialized.totalChunkCount,
        }
    } catch (caught) {
        if (caught instanceof PublishAttemptControlError) throw caught
        const failure = getPublishFailureDetails(caught)
        await markItemFailedForAttempt(
            supabase,
            item.id,
            attempt,
            failure.message,
            failure.errorCode,
            'processing'
        )
        await updateTaskFinalStatus(supabase, item.task_id)
        throw new PublishAttemptControlError(failure.errorCode, failure.message)
    }
}

export async function confirmTikTokFileUpload(
    supabase: ReturnType<typeof createAdminClient>,
    userId: string,
    taskId: string,
    itemId: string,
    expectedAttempt: number,
    uploadOutcome: 'accepted' | 'unknown' | 'rejected'
): Promise<PublishOutcome> {
    const { data, error } = await supabase
        .from('publish_task_items')
        .select(`
            id, task_id, account_id, status, tiktok_publish_id, publish_attempt_count,
            tiktok_transfer_method, tiktok_upload_outcome, tiktok_upload_reported_at,
            publish_tasks (user_id)
        `)
        .eq('id', itemId)
        .eq('task_id', taskId)
        .maybeSingle()

    if (error) {
        console.error('[Publisher] Failed to read FILE_UPLOAD confirmation state')
        throw new PublishAttemptControlError(ERROR_CODES.unknown, '无法确认 TikTok 文件上传')
    }

    const item = data as unknown as {
        id: string
        task_id: string
        account_id: string
        status: string
        tiktok_publish_id: string | null
        publish_attempt_count: number
        tiktok_transfer_method: string
        tiktok_upload_outcome: 'accepted' | 'unknown' | 'rejected' | null
        tiktok_upload_reported_at: string | null
        publish_tasks: { user_id: string }
    } | null
    if (
        !item
        || item.publish_tasks?.user_id !== userId
        || item.tiktok_transfer_method !== 'FILE_UPLOAD'
        || !['uploading', 'published', 'failed'].includes(item.status)
        || !item.tiktok_publish_id
        || item.publish_attempt_count !== expectedAttempt
    ) {
        throw new PublishAttemptControlError(
            ERROR_CODES.unknown,
            '该文件上传确认请求已失效'
        )
    }

    if (item.status === 'published') return 'success'
    if (item.status === 'failed') return 'failed'

    if (!item.tiktok_upload_outcome) {
        const reportedAt = new Date().toISOString()
        const { data: reported, error: reportError } = await supabase
            .from('publish_task_items')
            .update({
                tiktok_upload_outcome: uploadOutcome,
                tiktok_upload_reported_at: reportedAt,
                last_status_check_at: reportedAt,
                error_code: uploadOutcome === 'unknown'
                    ? ERROR_CODES.tiktokStatusCheckPending
                    : null,
                error_message: uploadOutcome === 'unknown'
                    ? 'TikTok 文件传输结果暂时无法确认，系统会继续检查'
                    : null,
                updated_at: reportedAt,
            })
            .eq('id', item.id)
            .eq('status', 'uploading')
            .eq('publish_attempt_count', expectedAttempt)
            .eq('tiktok_publish_id', item.tiktok_publish_id)
            .is('tiktok_upload_outcome', null)
            .select('id')
            .maybeSingle()
        if (reportError || reported?.id !== item.id) {
            throw new PublishAttemptControlError(
                ERROR_CODES.unknown,
                'TikTok 文件传输结果的本地记录失败，请勿重新创建任务',
                true
            )
        }
        item.tiktok_upload_outcome = uploadOutcome
    }

    if (item.tiktok_upload_outcome === 'rejected') {
        const failed = await markItemFailedForAttempt(
            supabase,
            item.id,
            expectedAttempt,
            'TikTok 拒绝了文件上传，请检查文件格式后重新选择文件',
            ERROR_CODES.tiktokFileUploadIncomplete,
            'uploading',
            item.tiktok_publish_id
        )
        await updateTaskFinalStatus(supabase, item.task_id)
        return failed ? 'failed' : 'confirming'
    }

    const authorization = await partitionAuthorizedPublishItems(supabase, [item])
    if (authorization.allowed.length !== 1) {
        throw new PublishAttemptControlError(
            ERROR_CODES.accountOwnershipMismatch,
            '任务账号归属或账号类型不匹配'
        )
    }

    const accounts = await getAccounts(supabase, [item.account_id])
    const account = accounts.get(item.account_id)
    if (!account) {
        throw new PublishAttemptControlError(ERROR_CODES.tokenRefreshFailed, '账号授权无效')
    }
    account.access_token = await getValidTikTokAccessToken(
        supabase,
        item.account_id,
        account.token
    )

    let outcome: PublishOutcome
    try {
        const status = await checkPublishStatus(account.access_token, item.tiktok_publish_id)
        if (status.status === 'PUBLISH_COMPLETE' || status.status === 'SEND_TO_USER_INBOX') {
            outcome = await persistPublishedOutcome(
                supabase,
                item.id,
                expectedAttempt,
                item.tiktok_publish_id,
                status.postId
            )
        } else if (status.status === 'FAILED') {
            const failed = await markItemFailedForAttempt(
                supabase,
                item.id,
                expectedAttempt,
                'TikTok 返回发布失败，请检查内容和账号设置',
                ERROR_CODES.tiktokStatusFailed,
                'uploading',
                item.tiktok_publish_id
            )
            outcome = failed ? 'failed' : 'confirming'
        } else {
            outcome = await persistPublishStatusDeferral(
                supabase,
                item.id,
                expectedAttempt,
                item.tiktok_publish_id,
                'TikTok 仍在处理，系统会继续确认结果',
                null
            )
        }
    } catch {
        outcome = await persistPublishStatusDeferral(
            supabase,
            item.id,
            expectedAttempt,
            item.tiktok_publish_id,
            'TikTok 发布状态暂时无法确认，系统稍后继续检查',
            ERROR_CODES.tiktokStatusCheckPending
        )
    }

    await updateTaskFinalStatus(supabase, item.task_id)
    return outcome
}

export async function publishItem(
    supabase: ReturnType<typeof createAdminClient>,
    item: PublishItem,
    accounts: Map<string, Account>
): Promise<PublishOutcome> {
    let publishId: string | null = null
    let publishIdPersisted = false

    try {
        if (!Number.isSafeInteger(item.publish_attempt_count) || item.publish_attempt_count <= 0) {
            throw new PublishAttemptControlError(
                ERROR_CODES.unknown,
                '本次发布缺少有效执行凭证，未向 TikTok 发出请求'
            )
        }

        const account = accounts.get(item.account_id)
        if (!account) {
            throw new PublishPreparationError(
                ERROR_CODES.tokenRefreshFailed,
                '账号授权无效，请重新授权后再试'
            )
        }

        if (item.tiktok_transfer_method === 'FILE_UPLOAD') {
            throw new PublishPreparationError(
                ERROR_CODES.tiktokFileUploadIncomplete,
                '本地文件直传任务必须在创建页面完成上传，请重新选择文件'
            )
        }

        // 验证视频 URL
        if (!item.video_url || item.video_url.startsWith('placeholder://')) {
            throw new PublishPreparationError(
                ERROR_CODES.videoUrlUnavailable,
                '视频地址不可用，请重新上传后再试'
            )
        }

        if (!item.video_url.startsWith('https://')) {
            throw new PublishPreparationError(
                ERROR_CODES.videoUrlUnavailable,
                '视频地址不可用，请重新上传后再试'
            )
        }

        console.log('[Publisher] Starting TikTok publish item')

        // 将视频 URL 转为 OSS 加速域名（海外 TikTok 服务器下载更快）
        const acceleratedUrl = toAcceleratedUrl(item.video_url)
        if (acceleratedUrl !== item.video_url) {
            console.log('[Publisher] Using approved accelerated media host')
        }

        const initStartedAt = new Date().toISOString()
        await claimPublishInitDispatch(supabase, item, initStartedAt)

        // 调用 TikTok 发布 API
        publishId = await initVideoPublishFromUrl(
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

        console.log('[Publisher] TikTok accepted publish initialization')

        const persistedOutcome = await persistPublishIdForAttempt(
            supabase,
            item,
            initStartedAt,
            publishId
        )
        if (persistedOutcome === 'success') return 'success'
        if (persistedOutcome !== 'confirming') {
            throw new PublishAttemptControlError(
                ERROR_CODES.tiktokPublishIdPersistFailed,
                'TikTok 已接收发布初始化，但本地确认记录失败，需要人工核对',
                true
            )
        }
        publishIdPersisted = true

        // 等待发布完成
        let result
        try {
            result = await waitForPublishComplete(
                account.access_token,
                publishId,
                PUBLISH_TIMEOUT_MS,
                POLL_INTERVAL_MS
            )
        } catch (statusError) {
            const failure = getPublishFailureDetails(statusError)
            console.warn('[Publisher] TikTok status check deferred', failure.logContext ?? {
                errorCode: ERROR_CODES.tiktokStatusCheckPending,
            })
            return persistPublishStatusDeferral(
                supabase,
                item.id,
                item.publish_attempt_count,
                publishId,
                'TikTok 发布状态暂时无法确认，系统稍后继续检查',
                ERROR_CODES.tiktokStatusCheckPending
            )
        }

        if (result.success) {
            console.log('[Publisher] TikTok publish completed')
            return persistPublishedOutcome(
                supabase,
                item.id,
                item.publish_attempt_count,
                publishId,
                result.postId
            )
        }

        if (result.timedOut === true) {
            return persistPublishStatusDeferral(
                supabase,
                item.id,
                item.publish_attempt_count,
                publishId,
                'TikTok 仍在处理，系统会继续确认结果',
                null
            )
        }

        const failed = await markItemFailedForAttempt(
            supabase,
            item.id,
            item.publish_attempt_count,
            'TikTok 返回发布失败，请检查内容和账号设置',
            ERROR_CODES.tiktokStatusFailed,
            'uploading',
            publishId
        )
        if (failed) return 'failed'
        const winner = await readDurablePublishItemState(supabase, item.id)
        return outcomeFromConcurrentState(winner, item.publish_attempt_count, publishId) ?? 'failed'

    } catch (error) {
        if (error instanceof PublishAttemptControlError) {
            console.warn('[Publisher] TikTok publish attempt stopped', {
                errorCode: error.errorCode,
                providerMayHaveAccepted: error.providerMayHaveAccepted,
            })
            return 'failed'
        }

        const failure = getPublishFailureDetails(error)
        if (failure.logContext) {
            console.warn('[Publisher] TikTok publish item stopped', failure.logContext)
        } else {
            console.warn('[Publisher] TikTok publish item stopped', {
                errorCode: failure.errorCode,
            })
        }

        const expectedStatus = publishIdPersisted ? 'uploading' : 'processing'
        await markItemFailedForAttempt(
            supabase,
            item.id,
            item.publish_attempt_count,
            failure.message,
            failure.errorCode,
            expectedStatus,
            publishIdPersisted && publishId ? publishId : undefined
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
