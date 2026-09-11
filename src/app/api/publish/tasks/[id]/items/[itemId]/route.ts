/**
 * 删除单个任务项 API
 * 
 * DELETE /api/publish/tasks/[id]/items/[itemId]
 * 
 * - 待发布：直接删除
 * - 已发布：仅删除本地记录，TikTok 线上视频需在 App 中手动删除
 */

import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

const AMBIGUOUS_PUBLISH_ERROR_CODES = new Set([
    'TIKTOK_INIT_OUTCOME_UNKNOWN',
    'WORKER_INTERRUPTED_NEEDS_REVIEW',
])

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; itemId: string }> }
) {
    try {
        const supabase = await createClient()
        const { id: taskId, itemId } = await params

        // 验证用户登录
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        // 获取任务项并验证权限
        const { data: item, error: itemError } = await supabase
            .from('publish_task_items')
            .select(`
                id,
                task_id,
                status,
                error_code,
                tiktok_publish_id,
                tiktok_transfer_method,
                tiktok_upload_outcome,
                publish_init_started_at,
                publish_tasks!inner(user_id)
            `)
            .eq('id', itemId)
            .eq('task_id', taskId)
            .single()

        if (itemError || !item) {
            return NextResponse.json({ error: '任务项不存在' }, { status: 404 })
        }

        // 验证任务属于当前用户
        const taskUserId = (item as any).publish_tasks?.user_id
        if (taskUserId !== user.id) {
            return NextResponse.json({ error: '无权操作此任务' }, { status: 403 })
        }

        // 检查状态
        const itemData = item as any
        const status = itemData.status
        const isPublished = status === 'published'
        const isProcessing = ['processing', 'uploading'].includes(status)

        if (isProcessing) {
            return NextResponse.json({
                error: '任务正在执行中，无法删除'
            }, { status: 400 })
        }

        const hasAmbiguousError = typeof itemData.error_code === 'string'
            && AMBIGUOUS_PUBLISH_ERROR_CODES.has(itemData.error_code)
        const fileUploadMayExist = itemData.tiktok_transfer_method === 'FILE_UPLOAD'
            && (Boolean(itemData.tiktok_publish_id) || Boolean(itemData.publish_init_started_at))
            && status !== 'published'
            && itemData.error_code !== 'TIKTOK_STATUS_FAILED'
            && !(
                itemData.error_code === 'TIKTOK_FILE_UPLOAD_INCOMPLETE'
                && itemData.tiktok_upload_outcome === 'rejected'
            )
        if (hasAmbiguousError || fileUploadMayExist) {
            return NextResponse.json({
                error: '发布结果无法确认，请先在 TikTok 中人工核对，暂不可删除',
                requires_manual_review: true,
            }, { status: 409 })
        }

        // Reject old clients that still request the removed remote-delete capability.
        let deleteTikTokVideo = false
        if (isPublished) {
            try {
                const body = await request.json()
                deleteTikTokVideo = body.deleteTikTokVideo === true
            } catch {
                // 没有请求体，默认不删除 TikTok 视频
            }
        }

        if (deleteTikTokVideo) {
            return NextResponse.json({
                error: '当前 TikTok API 不支持由本应用删除已发布视频，请先在 TikTok App 中手动删除',
                code: 'tiktok_remote_delete_unsupported',
            }, { status: 400 })
        }

        // 删除任务项
        const { error: deleteError } = await supabase
            .from('publish_task_items')
            .delete()
            .eq('id', itemId)

        if (deleteError) {
            console.error('Failed to delete task item:', deleteError)
            return NextResponse.json({ error: '删除失败' }, { status: 500 })
        }

        // 更新父任务统计
        await updateTaskStatistics(supabase, taskId)

        return NextResponse.json({
            success: true,
            deletedTikTokVideo: false,
            deletedItemStatus: status,
        })

    } catch (error) {
        console.error('Error deleting task item:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}

/**
 * 更新任务统计缓存
 */
async function updateTaskStatistics(
    supabase: Awaited<ReturnType<typeof createClient>>,
    taskId: string
) {
    const { data: items } = await supabase
        .from('publish_task_items')
        .select('status')
        .eq('task_id', taskId)

    if (!items) return

    const itemsList = items as any[]
    const publishedCount = itemsList.filter(i => i.status === 'published').length
    const pendingCount = itemsList.filter(i => ['pending', 'scheduled'].includes(i.status)).length
    const failedCount = itemsList.filter(i => i.status === 'failed').length

    await supabase
        .from('publish_tasks')
        .update({
            published_count: publishedCount,
            pending_count: pendingCount,
            failed_count: failedCount,
            total_items: itemsList.length
        } as any)
        .eq('id', taskId)
}
