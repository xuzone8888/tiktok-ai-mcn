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
import { initVideoPublishFromUrl, waitForPublishComplete } from '@/lib/tiktok/content-posting'

// ============================================================================
// 配置常量
// ============================================================================

const MAX_CONCURRENT = 20      // 最大并发数
const MAX_ITEMS_PER_RUN = 50   // 每次最多处理任务项数
const PUBLISH_TIMEOUT_MS = 120000  // 单个发布超时 2 分钟
const POLL_INTERVAL_MS = 5000  // 轮询间隔 5 秒

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
    status: string
}

/** 账号信息 */
interface Account {
    id: string
    access_token: string
}

/** 处理结果 */
export interface ProcessResult {
    success: number
    failed: number
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
// 动态并发计算
// ============================================================================

function getConcurrency(queueSize: number): number {
    if (queueSize <= 5) return 5
    if (queueSize <= 20) return 10
    return MAX_CONCURRENT
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
        skipped: 0,
        errors: [],
        duration_ms: 0
    }

    try {
        // 1. 查询待处理任务项
        const items = await queryPendingItems(supabase, options)

        if (items.length === 0) {
            console.log('[Publisher] No items to process')
            result.duration_ms = Date.now() - startTime
            return result
        }

        console.log(`[Publisher] Found ${items.length} items to process (mode: ${options.mode})`)

        // 2. 获取所有涉及的账号
        const accountIds = [...new Set(items.map(item => item.account_id))]
        const accounts = await getAccounts(supabase, accountIds)

        if (accounts.size === 0) {
            console.error('[Publisher] No valid accounts found')
            result.skipped = items.length
            result.duration_ms = Date.now() - startTime
            return result
        }

        // 3. 锁定任务项（状态改为 processing）
        await lockItems(supabase, items.map(i => i.id))

        // 4. 更新父任务状态为 processing
        const taskIds = [...new Set(items.map(item => item.task_id))]
        await updateTasksToProcessing(supabase, taskIds)

        // 5. 按 scheduled_at 时间顺序处理（支持间隔发布）
        // 在"立即发布+间隔"模式下，等待直到每个任务的 scheduled_at 时间
        for (const item of items) {
            // 计算需要等待的时间
            const scheduledAt = new Date(item.scheduled_at || Date.now())
            const waitMs = Math.max(0, scheduledAt.getTime() - Date.now())

            if (waitMs > 0 && waitMs < 30 * 60 * 1000) { // 最多等待30分钟
                console.log(`[Publisher] Waiting ${Math.round(waitMs / 1000)}s for item ${item.id}`)
                await new Promise(resolve => setTimeout(resolve, waitMs))
            }

            // 处理单个任务项
            try {
                const success = await publishItem(supabase, item, accounts)
                if (success) {
                    result.success++
                } else {
                    result.failed++
                }
            } catch (error) {
                result.failed++
            }
        }

        // 6. 更新父任务最终状态
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
        .select('id, task_id, account_id, video_url, title, scheduled_at, cover_timestamp_ms, status')

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
        .limit(options.maxItems || MAX_ITEMS_PER_RUN)

    const { data, error } = await query

    if (error) {
        console.error('[Publisher] Query error:', error)
        return []
    }

    return data || []
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
        .select('id, access_token')
        .in('id', accountIds)

    if (error || !data) {
        console.error('[Publisher] Failed to get accounts:', error)
        return new Map()
    }

    return new Map(data.map(a => [a.id, a]))
}

/**
 * 锁定任务项（状态改为 processing）
 */
async function lockItems(
    supabase: ReturnType<typeof createAdminClient>,
    itemIds: string[]
): Promise<void> {
    const { error } = await supabase
        .from('publish_task_items')
        .update({ status: 'processing' })
        .in('id', itemIds)

    if (error) {
        console.error('[Publisher] Failed to lock items:', error)
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
        .update({ status: 'processing' })
        .in('id', taskIds)
        .in('status', ['pending', 'scheduled'])

    if (error) {
        console.error('[Publisher] Failed to update tasks to processing:', error)
    }
}

/**
 * 发布单个任务项
 */
async function publishItem(
    supabase: ReturnType<typeof createAdminClient>,
    item: PublishItem,
    accounts: Map<string, Account>
): Promise<boolean> {
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

        // 调用 TikTok 发布 API
        const publishId = await initVideoPublishFromUrl(
            account.access_token,
            item.video_url,
            {
                title: item.title,
                privacyLevel: 'SELF_ONLY',  // 沙盒模式
                disableDuet: false,
                disableComment: false,
                disableStitch: false,
                isAigc: true,
                videoCoverTimestampMs: item.cover_timestamp_ms,
            }
        )

        console.log('[Publisher] Initiated:', publishId)

        // 更新为 uploading 状态
        await supabase
            .from('publish_task_items')
            .update({
                status: 'uploading',
                tiktok_publish_id: publishId
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

            await supabase
                .from('publish_task_items')
                .update({
                    status: 'published',
                    tiktok_share_id: result.postId,
                    published_at: new Date().toISOString()
                })
                .eq('id', item.id)

            return true
        } else {
            throw new Error(result.error || 'TikTok发布失败')
        }

    } catch (error) {
        console.error('[Publisher] Item failed:', item.id, error)

        await supabase
            .from('publish_task_items')
            .update({
                status: 'failed',
                error_message: error instanceof Error ? error.message : '发布失败'
            })
            .eq('id', item.id)

        return false
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

        // 检查是否还有未完成的项
        const pendingStatuses = ['pending', 'scheduled', 'processing', 'uploading']
        const hasIncomplete = statuses.some(s => pendingStatuses.includes(s))

        if (hasIncomplete) {
            // 还有未完成的，保持 processing
            return
        }

        // 计算各状态数量（for cache）
        const publishedCount = statuses.filter(s => s === 'published').length
        const pendingCount = statuses.filter(s => s === 'pending' || s === 'scheduled').length
        const failedCount = statuses.filter(s => s === 'failed').length

        // 确定最终状态
        let finalStatus: string
        if (failedCount === 0) {
            finalStatus = 'completed'
        } else if (publishedCount === 0) {
            finalStatus = 'failed'
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
