/**
 * 删除单个任务项 API
 * 
 * DELETE /api/publish/tasks/[id]/items/[itemId]
 * 
 * - 待发布：直接删除
 * - 已发布：询问是否删除 TikTok 视频
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
                tiktok_share_id,
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

        // 解析请求体（已发布任务需要确认是否删除 TikTok 视频）
        let deleteTikTokVideo = false
        if (isPublished) {
            try {
                const body = await request.json()
                deleteTikTokVideo = body.deleteTikTokVideo === true
            } catch {
                // 没有请求体，默认不删除 TikTok 视频
            }
        }

        let tiktokDeleteResult = null

        // 如果需要删除 TikTok 视频，调用 TikTok API
        if (deleteTikTokVideo && itemData.tiktok_share_id) {
            // 获取账号 access_token
            const { data: account } = await supabase
                .from('tiktok_accounts')
                .select('access_token')
                .eq('id', itemData.account_id)
                .single()

            const accountData = account as any
            if (accountData?.access_token) {
                const { deleteVideo } = await import('@/lib/tiktok/content-posting')
                const success = await deleteVideo(accountData.access_token, itemData.tiktok_share_id)
                tiktokDeleteResult = success ? 'success' : 'failed'
            } else {
                tiktokDeleteResult = 'no_token'
            }
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
            deletedTikTokVideo: deleteTikTokVideo,
            tiktokDeleteStatus: tiktokDeleteResult
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
