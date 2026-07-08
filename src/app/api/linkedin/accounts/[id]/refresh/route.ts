import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isLinkedInPublishEnabledServer } from '@/lib/feature-flags'
import {
  calculateLinkedInTokenExpiration,
  getLinkedInMemberProfile,
  refreshLinkedInAccessToken,
  scopesToArray,
} from '@/lib/linkedin/oauth'

export const dynamic = 'force-dynamic'

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now()
}

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isLinkedInPublishEnabledServer()) {
      return NextResponse.json({ error: 'LinkedIn 发布功能已暂停', disabled: true }, { status: 403 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: account, error: fetchError } = await (supabase as any)
      .from('linkedin_accounts')
      .select('id, owner_urn, scopes')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .eq('owner_type', 'member')
      .single()

    if (fetchError || !account) {
      return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRecord, error: tokenFetchError } = await adminSupabase
      .from('linkedin_account_tokens')
      .select('access_token, refresh_token, access_token_expires_at')
      .eq('account_id', account.id)
      .single()

    if (tokenFetchError || !tokenRecord?.access_token) {
      return NextResponse.json({ error: 'LinkedIn 授权令牌不存在，请重新绑定账号' }, { status: 404 })
    }

    let accessToken = tokenRecord.access_token as string
    let accessTokenExpiresAt = tokenRecord.access_token_expires_at as string | null
    let refreshToken = tokenRecord.refresh_token as string | null
    let refreshTokenExpiresAt: string | null = null
    let scopes = Array.isArray(account.scopes) ? account.scopes : []

    if (refreshToken) {
      let token
      try {
        token = await refreshLinkedInAccessToken(refreshToken)
      } catch (error) {
        const httpStatus = (error as { httpStatus?: number })?.httpStatus
        if (httpStatus === 400 || httpStatus === 401) {
          await adminSupabase
            .from('linkedin_accounts')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', account.id)

          return NextResponse.json(
            { error: 'LinkedIn 授权已过期，请重新绑定账号' },
            { status: 400 }
          )
        }
        throw error
      }
      accessToken = token.access_token
      refreshToken = token.refresh_token || refreshToken
      accessTokenExpiresAt = calculateLinkedInTokenExpiration(token.expires_in)?.toISOString() || null
      refreshTokenExpiresAt = calculateLinkedInTokenExpiration(token.refresh_token_expires_in)?.toISOString() || null
      scopes = scopesToArray(token.scope)
    } else if (isExpired(accessTokenExpiresAt)) {
      await adminSupabase
        .from('linkedin_accounts')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', account.id)

      return NextResponse.json({ error: 'LinkedIn 授权已过期，请重新绑定账号' }, { status: 400 })
    }

    const owner = await getLinkedInMemberProfile(accessToken)
    const now = new Date().toISOString()

    const { error: accountError } = await adminSupabase
      .from('linkedin_accounts')
      .update({
        owner_type: owner.ownerType,
        localized_name: owner.localizedName,
        vanity_name: owner.vanityName,
        avatar_url: owner.avatarUrl,
        follower_count: owner.followerCount,
        access_token_expires_at: accessTokenExpiresAt,
        scopes,
        status: 'active',
        updated_at: now,
      })
      .eq('id', account.id)

    if (accountError) {
      return NextResponse.json({ error: '更新 LinkedIn 账号失败' }, { status: 500 })
    }

    const { error: tokenUpdateError } = await adminSupabase
      .from('linkedin_account_tokens')
      .update({
        access_token: accessToken,
        refresh_token: refreshToken,
        access_token_expires_at: accessTokenExpiresAt,
        ...(refreshTokenExpiresAt ? { refresh_token_expires_at: refreshTokenExpiresAt } : {}),
        updated_at: now,
      })
      .eq('account_id', account.id)

    if (tokenUpdateError) {
      return NextResponse.json({ error: '更新 LinkedIn 授权令牌失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Refresh LinkedIn account error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新 LinkedIn 授权失败' },
      { status: 500 }
    )
  }
}
