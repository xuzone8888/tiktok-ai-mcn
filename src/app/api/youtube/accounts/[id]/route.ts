import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revokeYouTubeToken } from '@/lib/youtube/oauth'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: account, error: fetchError } = await (supabase as any)
      .from('youtube_accounts')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !account) {
      return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRecord } = await adminSupabase
      .from('youtube_account_tokens')
      .select('refresh_token')
      .eq('account_id', account.id)
      .maybeSingle()

    try {
      if (tokenRecord?.refresh_token) {
        await revokeYouTubeToken(tokenRecord.refresh_token)
      }
    } catch (error) {
      console.warn('Failed to revoke YouTube token, removing local binding anyway:', error)
    }

    const { error } = await adminSupabase
      .from('youtube_accounts')
      .delete()
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: '移除 YouTube 账号失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete YouTube account error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
