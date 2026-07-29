import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  calculateFacebookTokenExpiration,
  refreshFacebookPageAccessToken,
} from '@/lib/facebook/oauth'

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: account, error: fetchError } = await (supabase as any)
      .from('facebook_accounts')
      .select('id, channel_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !account) {
      return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRecord, error: tokenFetchError } = await adminSupabase
      .from('facebook_account_tokens')
      .select('refresh_token')
      .eq('account_id', account.id)
      .single()

    if (tokenFetchError || !tokenRecord?.refresh_token) {
      return NextResponse.json({ error: 'Facebook 授权令牌不存在，请重新绑定账号' }, { status: 404 })
    }

    const token = await refreshFacebookPageAccessToken(tokenRecord.refresh_token, account.channel_id)
    const expiresAt = calculateFacebookTokenExpiration(token.expires_in)?.toISOString() || null
    const now = new Date().toISOString()

    const { error } = await adminSupabase
      .from('facebook_accounts')
      .update({
        channel_title: token.page.name,
        channel_handle: token.page.category,
        thumbnail_url: token.page.thumbnailUrl,
        subscriber_count: token.page.followerCount,
        video_count: 0,
        view_count: token.page.fanCount,
        access_token_expires_at: expiresAt,
        status: 'active',
        updated_at: now,
      })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: '更新 Facebook 账号失败' }, { status: 500 })
    }

    const { error: tokenUpdateError } = await adminSupabase
      .from('facebook_account_tokens')
      .update({
        access_token: token.access_token,
        refresh_token: token.user_access_token,
        access_token_expires_at: expiresAt,
        updated_at: now,
      })
      .eq('account_id', account.id)

    if (tokenUpdateError) {
      return NextResponse.json({ error: '更新 Facebook 授权令牌失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Refresh Facebook account error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新 Facebook 授权失败' },
      { status: 500 }
    )
  }
}
