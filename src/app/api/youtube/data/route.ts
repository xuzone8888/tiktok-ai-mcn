import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient() as any
    const { data: deletion, error } = await admin.rpc('delete_youtube_user_data', {
      p_user_id: user.id,
    })
    if (error) {
      console.error('YouTube user data deletion failed:', { code: error.code, message: error.message })
      return NextResponse.json({ error: '删除 YouTube 数据失败' }, { status: 500 })
    }

    // The service-only scheduled worker handles the newly queued revocations.
    // A user request never processes another user's revocation job.
    return NextResponse.json({ success: true, deletion })
  } catch (error) {
    console.error('Delete all YouTube data error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
