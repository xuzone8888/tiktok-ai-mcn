import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteParams {
    params: Promise<{ id: string }>
}

const AMBIGUOUS_PUBLISH_ERROR_CODES = new Set([
    'TIKTOK_INIT_OUTCOME_UNKNOWN',
    'WORKER_INTERRUPTED_NEEDS_REVIEW',
])

function itemRequiresPublishReview(item: {
    status: string
    error_code: string | null
    tiktok_publish_id: string | null
    tiktok_transfer_method: string | null
    tiktok_upload_outcome: string | null
    publish_init_started_at: string | null
}): boolean {
    if (['processing', 'uploading'].includes(item.status)) return true
    if (item.error_code && AMBIGUOUS_PUBLISH_ERROR_CODES.has(item.error_code)) return true
    if (
        item.tiktok_transfer_method === 'FILE_UPLOAD'
        && (Boolean(item.tiktok_publish_id) || Boolean(item.publish_init_started_at))
    ) {
        const explicitlyResolved = item.status === 'published'
            || item.error_code === 'TIKTOK_STATUS_FAILED'
            || (
                item.error_code === 'TIKTOK_FILE_UPLOAD_INCOMPLETE'
                && item.tiktok_upload_outcome === 'rejected'
            )
        return !explicitlyResolved
    }
    return false
}

// GET - Get task details with all items
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        // Get task with items and account info
        const { data: task, error } = await supabase
            .from('publish_tasks')
            .select(`
        *,
        items:publish_task_items(
          *,
          account:tiktok_accounts(
            id,
            open_id,
            display_name,
            avatar_url
          )
        )
      `)
            .eq('id', id)
            .eq('user_id', user.id)
            .single()

        if (error || !task) {
            return NextResponse.json({ error: '任务不存在' }, { status: 404 })
        }

        // Calculate summary
        const summary = {
            total_items: task.items?.length || 0,
            pending_items: task.items?.filter((i: { status: string }) => i.status === 'pending').length || 0,
            processing_items: task.items?.filter((i: { status: string }) => i.status === 'processing').length || 0,
            completed_items: task.items?.filter((i: { status: string }) => i.status === 'completed').length || 0,
            failed_items: task.items?.filter((i: { status: string }) => i.status === 'failed').length || 0,
            video_count: new Set(task.items?.map((i: { video_url: string }) => i.video_url)).size,
            account_count: new Set(task.items?.map((i: { account_id: string }) => i.account_id)).size
        }

        const {
            items,
            plan_config: _planConfig,
            idempotency_key: _idempotencyKey,
            ...publicTask
        } = task
        const publicItems = (items || []).map(item => {
            const { dedupe_key: _dedupeKey, ...publicItem } = item
            return {
                ...publicItem,
                video_url: item.tiktok_transfer_method === 'FILE_UPLOAD' ? '' : item.video_url,
            }
        })

        return NextResponse.json({
            task: {
                ...publicTask,
                items: publicItems,
                summary
            }
        })

    } catch (error) {
        console.error('Error fetching task:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}

// DELETE - Delete a task group (local only, TikTok videos must be deleted manually)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        // Check if task exists and belongs to user
        const { data: task, error: fetchError } = await supabase
            .from('publish_tasks')
            .select(`
                id,
                status,
                items:publish_task_items(
                    status,
                    error_code,
                    tiktok_publish_id,
                    tiktok_transfer_method,
                    tiktok_upload_outcome,
                    publish_init_started_at
                )
            `)
            .eq('id', id)
            .eq('user_id', user.id)
            .single()

        if (fetchError || !task) {
            return NextResponse.json({ error: '任务不存在' }, { status: 404 })
        }

        const guardedTask = task as unknown as {
            status: string
            items: Array<Parameters<typeof itemRequiresPublishReview>[0]> | null
        }
        if (
            guardedTask.status === 'running'
            || (guardedTask.items || []).some(itemRequiresPublishReview)
        ) {
            return NextResponse.json({
                error: '任务仍在执行或发布结果无法确认，请先在 TikTok 中人工核对，暂不可删除',
                requires_manual_review: true,
            }, { status: 409 })
        }

        // Delete task items first
        await supabase
            .from('publish_task_items')
            .delete()
            .eq('task_id', id)

        // Delete the task
        const { error: deleteError } = await supabase
            .from('publish_tasks')
            .delete()
            .eq('id', id)

        if (deleteError) {
            console.error('Failed to delete task:', deleteError)
            return NextResponse.json({ error: '删除任务失败' }, { status: 500 })
        }

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Error deleting task:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}

// PATCH - Update task (cancel scheduled tasks, etc.)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        const body = await request.json()
        const { action } = body

        // Check if task exists and belongs to user
        const { data: task, error: fetchError } = await supabase
            .from('publish_tasks')
            .select('id, status')
            .eq('id', id)
            .eq('user_id', user.id)
            .single()

        if (fetchError || !task) {
            return NextResponse.json({ error: '任务不存在' }, { status: 404 })
        }

        if (action === 'cancel') {
            // Only scheduled tasks can be cancelled
            if (task.status !== 'scheduled') {
                return NextResponse.json({
                    error: '只能取消定时任务'
                }, { status: 400 })
            }

            // Update task status to cancelled
            await supabase
                .from('publish_tasks')
                .update({ status: 'cancelled' })
                .eq('id', id)

            // Update all pending items to cancelled
            await supabase
                .from('publish_task_items')
                .update({ status: 'cancelled' })
                .eq('task_id', id)
                .eq('status', 'scheduled')

            return NextResponse.json({ success: true, status: 'cancelled' })
        }

        return NextResponse.json({ error: '无效的操作' }, { status: 400 })

    } catch (error) {
        console.error('Error updating task:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}
