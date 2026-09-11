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

    const admin = createAdminClient()
    const { data: deletion, error } = await admin.rpc('delete_tiktok_user_data', {
      p_user_id: user.id,
    })
    if (error) {
      if (error.message?.includes('tiktok_authorization_must_disconnect_first')) {
        return NextResponse.json(
          {
            code: 'tiktok_authorization_must_disconnect_first',
            error: '请先逐个断开 TikTok 评论授权和发布授权，确认撤权完成后再删除全部本地数据。',
          },
          { status: 409 }
        )
      }
      console.error('[TikTok Data] User data deletion failed:', { code: error.code })
      return NextResponse.json({ error: '删除 TikTok 数据失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true, deletion })
  } catch (error) {
    console.error('[TikTok Data] Delete request failed:', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
