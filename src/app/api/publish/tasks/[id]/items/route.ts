/**
 * 任务项分页 API
 * 
 * GET /api/publish/tasks/[id]/items
 * 获取任务组下的任务项列表（分页）
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient()
        const { id: taskId } = await params

        // 验证用户登录
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        // 验证任务属于当前用户
        const { data: task } = await supabase
            .from('publish_tasks')
            .select('id, user_id')
            .eq('id', taskId)
            .single()

        if (!task || task.user_id !== user.id) {
            return NextResponse.json({ error: '任务不存在' }, { status: 404 })
        }

        // 解析分页参数
        const searchParams = request.nextUrl.searchParams
        const page = parseInt(searchParams.get('page') || '1')
        const limit = parseInt(searchParams.get('limit') || '20')
        const statusFilter = searchParams.get('status') // all, scheduled, published, failed

        const offset = (page - 1) * limit

        // 构建查询
        let query = supabase
            .from('publish_task_items')
            .select(`
                id,
                task_id,
                account_id,
                video_url,
                title,
                scheduled_at,
                status,
                published_at,
                tiktok_share_id,
                error_message,
                cover_timestamp_ms,
                tiktok_accounts!inner(id, display_name, avatar_url)
            `, { count: 'exact' })
            .eq('task_id', taskId)
            .order('scheduled_at', { ascending: true })

        // 状态筛选
        if (statusFilter && statusFilter !== 'all') {
            if (statusFilter === 'pending') {
                query = query.in('status', ['pending', 'scheduled'])
            } else {
                query = query.eq('status', statusFilter)
            }
        }

        // 分页
        query = query.range(offset, offset + limit - 1)

        const { data: items, error, count } = await query

        if (error) {
            console.error('Failed to fetch task items:', error)
            return NextResponse.json({ error: '获取任务项失败' }, { status: 500 })
        }

        return NextResponse.json({
            items: items || [],
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit)
            }
        })

    } catch (error) {
        console.error('Error fetching task items:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}
