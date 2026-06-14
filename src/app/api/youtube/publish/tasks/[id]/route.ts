import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const { error } = await (supabase as any)
      .from('youtube_publish_tasks')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: '删除 YouTube 发布任务失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete YouTube publish task error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
