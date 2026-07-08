import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: task, error: taskLookupError } = await adminSupabase
      .from('linkedin_publish_tasks')
      .select('id, status')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (taskLookupError) {
      console.error('Lookup LinkedIn publish task before delete failed:', taskLookupError)
      return NextResponse.json({ error: '查询 LinkedIn 发布任务失败' }, { status: 500 })
    }

    if (!task) {
      return NextResponse.json({ error: '任务不存在或无权限' }, { status: 404 })
    }

    const deletableTaskStatuses = new Set(['pending', 'scheduled', 'completed', 'partial_failed', 'failed', 'cancelled'])
    if (!deletableTaskStatuses.has(task.status)) {
      return NextResponse.json({ error: 'LinkedIn 任务正在执行中，暂不支持删除' }, { status: 409 })
    }

    const { data: activeItems, error: activeItemsError } = await adminSupabase
      .from('linkedin_publish_task_items')
      .select('id, status')
      .eq('task_id', params.id)
      .in('status', ['processing', 'uploading'])
      .limit(1)

    if (activeItemsError) {
      console.error('Check active LinkedIn publish task items before delete failed:', activeItemsError)
      return NextResponse.json({ error: '检查 LinkedIn 发布任务状态失败' }, { status: 500 })
    }

    if ((activeItems || []).length > 0) {
      return NextResponse.json({ error: 'LinkedIn 任务存在上传中或发布中的明细，暂不支持删除' }, { status: 409 })
    }

    const { error: itemsError } = await adminSupabase
      .from('linkedin_publish_task_items')
      .delete()
      .eq('task_id', params.id)

    if (itemsError) {
      console.error('Delete LinkedIn publish task items failed:', itemsError)
      return NextResponse.json({ error: '删除 LinkedIn 发布任务明细失败' }, { status: 500 })
    }

    const { error: taskError } = await adminSupabase
      .from('linkedin_publish_tasks')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id)

    if (taskError) {
      console.error('Delete LinkedIn publish task failed:', taskError)
      return NextResponse.json({ error: '删除 LinkedIn 发布任务失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete LinkedIn publish task error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
