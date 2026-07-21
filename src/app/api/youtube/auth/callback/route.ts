import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  calculateYouTubeTokenExpiration,
  exchangeYouTubeCodeForToken,
  getMyYouTubeChannel,
  scopesToArray,
} from '@/lib/youtube/oauth'

export const dynamic = 'force-dynamic'

function getRequestOrigin(request: NextRequest) {
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host') || request.nextUrl.host
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'http'
  return `${protocol.split(',')[0].trim()}://${host.split(',')[0].trim()}`
}

function redirectToAccounts(origin: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params)
  const redirectUrl = new URL('/youtube-publish/accounts', origin)
  redirectUrl.search = searchParams.toString()
  return NextResponse.redirect(redirectUrl)
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const redirectOrigin = getRequestOrigin(request)

  if ((!code && !error) || !state) {
    return redirectToAccounts(redirectOrigin, { error: '缺少 YouTube 授权参数' })
  }

  const supabase = createAdminClient() as any

  try {
    const { data: authState, error: stateError } = await supabase
      .from('youtube_auth_states')
      .select('*')
      .eq('state', state)
      .single()

    if (stateError || !authState) {
      return redirectToAccounts(redirectOrigin, { error: 'YouTube 授权状态无效或已过期' })
    }

    if (authState.status !== 'pending') {
      return redirectToAccounts(redirectOrigin, { error: 'YouTube 授权状态已使用或无效，请重新绑定' })
    }

    if (error) {
      await supabase
        .from('youtube_auth_states')
        .update({
          status: 'failed',
          error_code: error,
          error_message: errorDescription || error,
          code_verifier: null,
          completed_at: new Date().toISOString(),
        })
        .eq('state', state)

      return redirectToAccounts(redirectOrigin, { error: errorDescription || error })
    }

    if (new Date(authState.expires_at).getTime() <= Date.now()) {
      await supabase
        .from('youtube_auth_states')
        .update({
          status: 'expired',
          error_code: 'expired',
          error_message: 'Authorization session expired.',
          code_verifier: null,
        })
        .eq('state', state)

      return redirectToAccounts(redirectOrigin, { error: 'YouTube 授权已过期，请重新绑定' })
    }

    if (!code) {
      throw new Error('缺少 YouTube authorization code')
    }

    const token = await exchangeYouTubeCodeForToken(code, authState.code_verifier)
    const channel = await getMyYouTubeChannel(token.access_token)

    const { data: existingAccount } = await supabase
      .from('youtube_accounts')
      .select('id, scopes')
      .eq('user_id', authState.user_id)
      .eq('channel_id', channel.channelId)
      .maybeSingle()

    let existingRefreshToken: string | null = null
    if (existingAccount?.id) {
      const { data: existingToken, error: existingTokenError } = await supabase
        .from('youtube_account_tokens')
        .select('refresh_token')
        .eq('account_id', existingAccount.id)
        .maybeSingle()
      if (existingTokenError) {
        throw new Error(`读取已有 YouTube 授权令牌失败: ${existingTokenError.message}`)
      }
      existingRefreshToken = existingToken?.refresh_token || null
    }

    const refreshToken = token.refresh_token || existingRefreshToken
    if (!refreshToken) {
      throw new Error('Google 未返回 refresh token，请重新授权并确认允许离线访问')
    }

    const now = new Date().toISOString()
    const expiresAt = calculateYouTubeTokenExpiration(token.expires_in).toISOString()
    const grantedScopes = token.scope
      ? scopesToArray(token.scope)
      : Array.isArray(existingAccount?.scopes)
        ? existingAccount.scopes.map(String).filter(Boolean)
        : []
    const { data: savedAccount, error: upsertError } = await supabase
      .from('youtube_accounts')
      .upsert({
        user_id: authState.user_id,
        channel_id: channel.channelId,
        channel_title: channel.title,
        channel_handle: channel.handle,
        thumbnail_url: channel.thumbnailUrl,
        subscriber_count: channel.subscriberCount,
        video_count: channel.videoCount,
        view_count: channel.viewCount,
        access_token_expires_at: expiresAt,
        scopes: grantedScopes,
        status: 'active',
        updated_at: now,
      }, {
        onConflict: 'user_id,channel_id',
      })
      .select('id')
      .single()

    if (upsertError) {
      throw new Error(`保存 YouTube 账号失败: ${upsertError.message}`)
    }

    const { error: tokenError } = await supabase
      .from('youtube_account_tokens')
      .upsert({
        account_id: savedAccount.id,
        access_token: token.access_token,
        refresh_token: refreshToken,
        access_token_expires_at: expiresAt,
        updated_at: now,
      }, {
        onConflict: 'account_id',
      })

    if (tokenError) {
      throw new Error(`保存 YouTube 授权令牌失败: ${tokenError.message}`)
    }

    await supabase
      .from('youtube_auth_states')
      .update({
        status: 'completed',
        code_verifier: null,
        completed_at: now,
      })
      .eq('state', state)

    return redirectToAccounts(redirectOrigin, {
      success: 'true',
      name: channel.title,
    })
  } catch (err) {
    console.error('YouTube callback error:', err)

    if (state) {
      await supabase
        .from('youtube_auth_states')
        .update({
          status: 'failed',
          error_code: 'callback_failed',
          error_message: err instanceof Error ? err.message : 'YouTube 授权失败',
          code_verifier: null,
          completed_at: new Date().toISOString(),
        })
        .eq('state', state)
    }

    return redirectToAccounts(redirectOrigin, {
      error: err instanceof Error ? err.message : 'YouTube 授权失败',
    })
  }
}
