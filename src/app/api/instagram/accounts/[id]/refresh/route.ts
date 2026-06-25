import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  calculateInstagramTokenExpiration,
  refreshInstagramAccountAccessToken,
} from '@/lib/instagram/oauth'

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: account, error: fetchError } = await (supabase as any)
      .from('instagram_accounts')
      .select('id, channel_id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !account) {
      return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRecord, error: tokenFetchError } = await adminSupabase
      .from('instagram_account_tokens')
      .select('refresh_token')
      .eq('account_id', account.id)
      .single()

    if (tokenFetchError || !tokenRecord?.refresh_token) {
      return NextResponse.json({ error: 'Instagram 授权令牌不存在，请重新绑定账号' }, { status: 404 })
    }

    const token = await refreshInstagramAccountAccessToken(tokenRecord.refresh_token, account.channel_id)
    const expiresAt = calculateInstagramTokenExpiration(token.expires_in)?.toISOString() || null
    const now = new Date().toISOString()

    const { error } = await adminSupabase
      .from('instagram_accounts')
      .update({
        channel_title: token.account.name,
        channel_handle: `@${token.account.username}`,
        thumbnail_url: token.account.thumbnailUrl,
        subscriber_count: token.account.followerCount,
        video_count: token.account.mediaCount,
        view_count: 0,
        access_token_expires_at: expiresAt,
        status: 'active',
        updated_at: now,
      })
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: '更新 Instagram 账号失败' }, { status: 500 })
    }

    const { error: tokenUpdateError } = await adminSupabase
      .from('instagram_account_tokens')
      .update({
        access_token: token.access_token,
        refresh_token: token.user_access_token,
        access_token_expires_at: expiresAt,
        updated_at: now,
      })
      .eq('account_id', account.id)

    if (tokenUpdateError) {
      return NextResponse.json({ error: '更新 Instagram 授权令牌失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Refresh Instagram account error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新 Instagram 授权失败' },
      { status: 500 }
    )
  }
}
