import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: task, error: taskLookupError } = await adminSupabase
      .from('youtube_publish_tasks')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (taskLookupError) {
      console.error('Lookup YouTube publish task before delete failed:', taskLookupError)
      return NextResponse.json({ error: '查询 YouTube 发布任务失败' }, { status: 500 })
    }

    if (!task) {
      return NextResponse.json({ error: '任务不存在或无权限' }, { status: 404 })
    }

    const { error: itemsError } = await adminSupabase
      .from('youtube_publish_task_items')
      .delete()
      .eq('task_id', id)

    if (itemsError) {
      console.error('Delete YouTube publish task items failed:', itemsError)
      return NextResponse.json({ error: '删除 YouTube 发布任务明细失败' }, { status: 500 })
    }

    const { error: taskError } = await adminSupabase
      .from('youtube_publish_tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (taskError) {
      console.error('Delete YouTube publish task failed:', taskError)
      return NextResponse.json({ error: '删除 YouTube 发布任务失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete YouTube publish task error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
