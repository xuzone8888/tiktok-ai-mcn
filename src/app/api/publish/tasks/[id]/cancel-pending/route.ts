/**
 * 批量停止待发布任务 API
 * 
 * POST /api/publish/tasks/[id]/cancel-pending
 * 
 * 将所有 pending/scheduled 状态的任务项改为 cancelled
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const supabase = await createClient()
        const taskId = params.id

        // 验证用户登录
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        // 验证任务属于当前用户
        const { data: task, error: taskError } = await supabase
            .from('publish_tasks')
            .select('id, user_id, status')
            .eq('id', taskId)
            .single()

        if (taskError || !task) {
            return NextResponse.json({ error: '任务不存在' }, { status: 404 })
        }

        if (task.user_id !== user.id) {
            return NextResponse.json({ error: '无权操作此任务' }, { status: 403 })
        }

        // 检查是否有执行中的任务
        const { data: processingItems } = await supabase
            .from('publish_task_items')
            .select('id')
            .eq('task_id', taskId)
            .in('status', ['processing', 'uploading'])

        if (processingItems && processingItems.length > 0) {
            return NextResponse.json({
                error: `有 ${processingItems.length} 个任务正在执行中，无法停止`,
                processingCount: processingItems.length
            }, { status: 400 })
        }

        // 将所有 pending/scheduled 改为 cancelled
        const { data: updatedItems, error: updateError } = await supabase
            .from('publish_task_items')
            .update({ status: 'cancelled' })
            .eq('task_id', taskId)
            .in('status', ['pending', 'scheduled'])
            .select('id')

        if (updateError) {
            console.error('Failed to cancel pending items:', updateError)
            return NextResponse.json({ error: '取消失败' }, { status: 500 })
        }

        const cancelledCount = updatedItems?.length || 0

        // 更新父任务统计和状态
        const { data: allItems } = await supabase
            .from('publish_task_items')
            .select('status')
            .eq('task_id', taskId)

        if (allItems) {
            const publishedCount = allItems.filter(i => i.status === 'published').length
            const pendingCount = allItems.filter(i => ['pending', 'scheduled'].includes(i.status)).length
            const failedCount = allItems.filter(i => i.status === 'failed').length
            const cancelledCount = allItems.filter(i => i.status === 'cancelled').length

            // 确定任务最终状态
            let taskStatus = task.status
            if (pendingCount === 0) {
                // 没有待发布的了
                if (publishedCount > 0 && (failedCount > 0 || cancelledCount > 0)) {
                    taskStatus = 'partial_failed'
                } else if (publishedCount > 0) {
                    taskStatus = 'completed'
                } else if (cancelledCount > 0) {
                    taskStatus = 'cancelled'
                } else {
                    taskStatus = 'failed'
                }
            }

            await supabase
                .from('publish_tasks')
                .update({
                    status: taskStatus,
                    published_count: publishedCount,
                    pending_count: pendingCount,
                    failed_count: failedCount
                })
                .eq('id', taskId)
        }

        return NextResponse.json({
            success: true,
            cancelledCount
        })

    } catch (error) {
        console.error('Error cancelling pending items:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}
