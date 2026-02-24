import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteParams {
    params: Promise<{ id: string }>
}

// POST - Retry failed items in a task
export async function POST(request: NextRequest, { params }: RouteParams) {
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
          id,
          status,
          account_id
        )
      `)
            .eq('id', id)
            .eq('user_id', user.id)
            .single()

        if (fetchError || !task) {
            return NextResponse.json({ error: '任务不存在' }, { status: 404 })
        }

        // Get failed items
        const failedItems = task.items?.filter((i: { status: string }) => i.status === 'failed') || []

        if (failedItems.length === 0) {
            return NextResponse.json({
                error: '没有失败的任务项需要重试'
            }, { status: 400 })
        }

        // Check if related accounts are still authorized
        const accountIds = Array.from(new Set(failedItems.map((i: { account_id: string }) => i.account_id)))

        const { data: accounts, error: accountsError } = await supabase
            .from('tiktok_accounts')
            .select('id, token_expires_at')
            .eq('user_id', user.id)
            .in('id', accountIds)

        if (accountsError) {
            return NextResponse.json({ error: '获取账号信息失败' }, { status: 500 })
        }

        const now = new Date()
        const expiredAccounts = accounts?.filter(a => a.token_expires_at && new Date(a.token_expires_at) <= now) || []

        if (expiredAccounts.length > 0) {
            return NextResponse.json({
                error: '部分账号授权已过期，请先刷新授权后再重试',
                expired_count: expiredAccounts.length
            }, { status: 400 })
        }

        // Reset failed items to pending
        const failedItemIds = failedItems.map((i: { id: string }) => i.id)

        const { error: updateError } = await supabase
            .from('publish_task_items')
            .update({
                status: 'pending',
                error_message: null,
            })
            .in('id', failedItemIds)

        if (updateError) {
            console.error('Failed to reset items:', updateError)
            return NextResponse.json({ error: '重置任务状态失败' }, { status: 500 })
        }

        // Update task status back to processing
        await supabase
            .from('publish_tasks')
            .update({ status: 'processing' })
            .eq('id', id)

        // In production, trigger the background job to process these items
        // For now, we just return success

        return NextResponse.json({
            success: true,
            retrying_count: failedItems.length
        })

    } catch (error) {
        console.error('Error retrying task:', error)
        return NextResponse.json({ error: '服务器错误' }, { status: 500 })
    }
}
