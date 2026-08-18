import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  calculateYouTubeTokenExpiration,
  getMyYouTubeChannel,
  isYouTubeAuthorizationRevokedError,
  refreshYouTubeAccessToken,
  scopesToArray,
} from '@/lib/youtube/oauth'
import { markYouTubeAuthorizationInvalid } from '@/lib/youtube/data-governance'

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  let ownedAccountId: string | null = null
  let adminSupabase: any = null

  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: account, error: fetchError } = await (supabase as any)
      .from('youtube_accounts')
      .select('id, scopes')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !account) {
      return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
    }
    ownedAccountId = account.id

    adminSupabase = createAdminClient() as any
    const { data: tokenRecord, error: tokenFetchError } = await adminSupabase
      .from('youtube_account_tokens')
      .select('refresh_token')
      .eq('account_id', account.id)
      .single()

    if (tokenFetchError || !tokenRecord?.refresh_token) {
      return NextResponse.json({ error: 'YouTube 授权令牌不存在，请重新绑定账号' }, { status: 404 })
    }

    const token = await refreshYouTubeAccessToken(tokenRecord.refresh_token)
    const channel = await getMyYouTubeChannel(token.access_token)
    const expiresAt = calculateYouTubeTokenExpiration(token.expires_in).toISOString()
    const now = new Date().toISOString()
    const refreshedScopes = token.scope ? scopesToArray(token.scope) : null

    const { error } = await adminSupabase
      .from('youtube_accounts')
      .update({
        channel_title: channel.title,
        channel_handle: channel.handle,
        thumbnail_url: channel.thumbnailUrl,
        subscriber_count: channel.subscriberCount,
        video_count: channel.videoCount,
        view_count: channel.viewCount,
        access_token_expires_at: expiresAt,
        ...(refreshedScopes ? { scopes: refreshedScopes } : {}),
        status: 'active',
        last_authorization_verified_at: now,
        authorization_invalidated_at: null,
        updated_at: now,
      })
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: '更新 YouTube 账号失败' }, { status: 500 })
    }

    const { error: tokenUpdateError } = await adminSupabase
      .from('youtube_account_tokens')
      .update({
        access_token: token.access_token,
        access_token_expires_at: expiresAt,
        updated_at: now,
      })
      .eq('account_id', account.id)

    if (tokenUpdateError) {
      return NextResponse.json({ error: '更新 YouTube 授权令牌失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (ownedAccountId && adminSupabase && isYouTubeAuthorizationRevokedError(error)) {
      try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) await markYouTubeAuthorizationInvalid(adminSupabase, user.id, ownedAccountId)
      } catch (markError) {
        console.error('Failed to record invalid YouTube authorization:', markError)
      }
    }
    console.error('Refresh YouTube account error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新 YouTube 授权失败' },
      { status: 500 }
    )
  }
}
