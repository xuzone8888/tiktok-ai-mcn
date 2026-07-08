import { NextRequest, NextResponse } from 'next/server'

import { isLinkedInPublishEnabledServer } from '@/lib/feature-flags'
import {
  calculateLinkedInTokenExpiration,
  exchangeLinkedInCodeForToken,
  getLinkedInMemberProfile,
  scopesToArray,
  type LinkedInOwnerInfo,
} from '@/lib/linkedin/oauth'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

function getRequestOrigin(request: NextRequest) {
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host') || request.nextUrl.host
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'http'
  return `${protocol.split(',')[0].trim()}://${host.split(',')[0].trim()}`
}

function getAppRedirectOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || getRequestOrigin(request)
}

function redirectToAccounts(origin: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params)
  const redirectUrl = new URL('/linkedin-publish/accounts', origin)
  redirectUrl.search = searchParams.toString()
  return NextResponse.redirect(redirectUrl)
}

async function readExistingRefreshToken(supabase: any, accountId: string) {
  const { data, error } = await supabase
    .from('linkedin_account_tokens')
    .select('refresh_token')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    throw new Error(`读取已有 LinkedIn 授权令牌失败: ${error.message}`)
  }

  return data?.refresh_token || null
}

async function saveLinkedInOwner(
  supabase: any,
  userId: string,
  owner: LinkedInOwnerInfo,
  token: {
    accessToken: string
    refreshToken: string | null
    accessTokenExpiresAt: string | null
    refreshTokenExpiresAt: string | null
    scopes: string[]
  }
) {
  const now = new Date().toISOString()
  const { data: existingAccount } = await supabase
    .from('linkedin_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('owner_urn', owner.ownerUrn)
    .maybeSingle()

  const refreshToken = token.refreshToken || (existingAccount?.id ? await readExistingRefreshToken(supabase, existingAccount.id) : null)

  const { data: savedAccount, error: upsertError } = await supabase
    .from('linkedin_accounts')
    .upsert({
      user_id: userId,
      owner_urn: owner.ownerUrn,
      owner_type: owner.ownerType,
      localized_name: owner.localizedName,
      vanity_name: owner.vanityName,
      avatar_url: owner.avatarUrl,
      follower_count: owner.followerCount,
      access_token_expires_at: token.accessTokenExpiresAt,
      scopes: token.scopes,
      status: 'active',
      updated_at: now,
    }, {
      onConflict: 'user_id,owner_urn',
    })
    .select('id')
    .single()

  if (upsertError) {
    throw new Error(`保存 LinkedIn 账号失败: ${upsertError.message}`)
  }

  const { error: tokenError } = await supabase
    .from('linkedin_account_tokens')
    .upsert({
      account_id: savedAccount.id,
      access_token: token.accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: token.accessTokenExpiresAt,
      refresh_token_expires_at: token.refreshTokenExpiresAt,
      updated_at: now,
    }, {
      onConflict: 'account_id',
    })

  if (tokenError) {
    throw new Error(`保存 LinkedIn 授权令牌失败: ${tokenError.message}`)
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const redirectOrigin = getAppRedirectOrigin(request)

  if (!isLinkedInPublishEnabledServer()) {
    return redirectToAccounts(redirectOrigin, { error: 'LinkedIn 发布功能已暂停' })
  }

  if ((!code && !error) || !state) {
    return redirectToAccounts(redirectOrigin, { error: '缺少 LinkedIn 授权参数' })
  }

  const supabase = createAdminClient() as any

  try {
    const { data: authState, error: stateError } = await supabase
      .from('linkedin_auth_states')
      .select('*')
      .eq('state', state)
      .single()

    if (stateError || !authState) {
      return redirectToAccounts(redirectOrigin, { error: 'LinkedIn 授权状态无效或已过期' })
    }

    if (authState.status !== 'pending') {
      return redirectToAccounts(redirectOrigin, { error: 'LinkedIn 授权状态已使用或无效，请重新绑定' })
    }

    if (error) {
      await supabase
        .from('linkedin_auth_states')
        .update({
          status: 'failed',
          error_code: error,
          error_message: errorDescription || error,
          completed_at: new Date().toISOString(),
        })
        .eq('state', state)

      return redirectToAccounts(redirectOrigin, { error: errorDescription || error })
    }

    if (new Date(authState.expires_at).getTime() <= Date.now()) {
      await supabase
        .from('linkedin_auth_states')
        .update({
          status: 'expired',
          error_code: 'expired',
          error_message: 'Authorization session expired.',
        })
        .eq('state', state)

      return redirectToAccounts(redirectOrigin, { error: 'LinkedIn 授权已过期，请重新绑定' })
    }

    if (!code) {
      throw new Error('缺少 LinkedIn authorization code')
    }

    const token = await exchangeLinkedInCodeForToken(code)
    const member = await getLinkedInMemberProfile(token.access_token)
    const accessTokenExpiresAt = calculateLinkedInTokenExpiration(token.expires_in)?.toISOString() || null
    const refreshTokenExpiresAt = calculateLinkedInTokenExpiration(token.refresh_token_expires_in)?.toISOString() || null
    const scopes = scopesToArray(token.scope)

    await saveLinkedInOwner(supabase, authState.user_id, member, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      scopes,
    })

    const now = new Date().toISOString()
    await supabase
      .from('linkedin_auth_states')
      .update({
        status: 'completed',
        completed_at: now,
      })
      .eq('state', state)

    return redirectToAccounts(redirectOrigin, {
      success: 'true',
      name: member.localizedName,
    })
  } catch (err) {
    console.error('LinkedIn callback error:', err)

    if (state) {
      await supabase
        .from('linkedin_auth_states')
        .update({
          status: 'failed',
          error_code: 'callback_failed',
          error_message: err instanceof Error ? err.message : 'LinkedIn 授权失败',
          completed_at: new Date().toISOString(),
        })
        .eq('state', state)
    }

    return redirectToAccounts(redirectOrigin, {
      error: err instanceof Error ? err.message : 'LinkedIn 授权失败',
    })
  }
}
