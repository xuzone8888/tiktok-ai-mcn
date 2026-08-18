import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertFacebookRequiredPageScopes,
  calculateFacebookTokenExpiration,
  debugFacebookUserToken,
  exchangeFacebookCodeForToken,
  exchangeForLongLivedUserToken,
  FACEBOOK_PAGE_SCOPES,
  getGrantedFacebookScopes,
  getFacebookGrantedPermissions,
  getFacebookOAuthConfig,
  getFacebookPagePublishPermissionError,
  getFacebookUserInfo,
  getMyFacebookPages,
  hasFacebookPagePublishPermission,
  isFacebookPageWebhookEnabled,
  subscribeFacebookPageToWebhooks,
  type FacebookPermissionInfo,
  type FacebookTokenDebugInfo,
} from '@/lib/facebook/oauth'

export const dynamic = 'force-dynamic'

function getRequestOrigin(request: NextRequest) {
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host') || request.nextUrl.host
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'http'
  return `${protocol.split(',')[0].trim()}://${host.split(',')[0].trim()}`
}

function getAppRedirectOrigin(request: NextRequest) {
  // 跳转目标钉死可信的服务端配置（NEXT_PUBLIC_APP_URL），避免用 Host/X-Forwarded-Host 头拼跳转
  // 造成 host 头注入 / 开放重定向（与 Instagram 回调、TikTok 参考实现保持一致）。
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || getRequestOrigin(request)
}

function redirectToAccounts(origin: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params)
  const redirectUrl = new URL('/facebook-publish/accounts', origin)
  redirectUrl.search = searchParams.toString()
  return NextResponse.redirect(redirectUrl)
}

function formatFacebookPermissionDiagnostics(permissions: FacebookPermissionInfo[]) {
  if (permissions.length === 0) {
    return 'Meta 未返回权限列表'
  }

  const granted = permissions
    .filter((entry) => entry.status === 'granted')
    .map((entry) => entry.permission)
  const missingRequired = FACEBOOK_PAGE_SCOPES.filter((scope) => !granted.includes(scope))

  const grantedText = granted.length > 0 ? granted.join(', ') : '无'
  const missingText = missingRequired.length > 0 ? missingRequired.join(', ') : '无'

  return `已授权权限：${grantedText}。缺失 Facebook Page 必需权限：${missingText}`
}

function formatFacebookTokenTargetDiagnostics(tokenDebug: FacebookTokenDebugInfo | null) {
  if (!tokenDebug) {
    return 'Token target 诊断不可用'
  }

  const pageScopeSummaries = FACEBOOK_PAGE_SCOPES.map((scopeName) => {
    const granularScope = tokenDebug.granularScopes.find((entry) => entry.scope === scopeName)
    if (!granularScope) return `${scopeName}: 未返回 granular scope`
    return `${scopeName}: target_ids 数量=${granularScope.targetIds.length}`
  })

  return `Token 有效：${tokenDebug.isValid === null ? '未知' : tokenDebug.isValid ? '是' : '否'}；${pageScopeSummaries.join('；')}`
}

function buildFacebookNoPageError(
  permissions: FacebookPermissionInfo[],
  tokenDebug: FacebookTokenDebugInfo | null
) {
  const config = getFacebookOAuthConfig()
  const permissionDiagnostics = formatFacebookPermissionDiagnostics(permissions)
  const targetDiagnostics = formatFacebookTokenTargetDiagnostics(tokenDebug)
  const configDiagnostics = `授权配置：Facebook Page config_id=${config.pageLoginConfigId ? '已配置' : '未配置'}`

  return `当前 Facebook 授权未返回可保存的 Page 或 Page access token。${permissionDiagnostics}。${targetDiagnostics}。${configDiagnostics}。请确认 Facebook Page 登录配置包含 pages_manage_metadata，并确认该 Facebook 账号拥有 Page 的完整控制权限；如果之前授权时没勾选 Page 或配置权限后来有调整，请先到 Facebook 设置的企业集成中移除本应用后重新绑定。`
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const errorCode = searchParams.get('error_code')
  const errorReason = searchParams.get('error_reason')
  const redirectOrigin = getAppRedirectOrigin(request)

  if ((!code && !error) || !state) {
    return redirectToAccounts(redirectOrigin, { error: '缺少 Facebook 授权参数' })
  }

  const supabase = createAdminClient() as any

  try {
    const { data: authState, error: stateError } = await supabase
      .from('facebook_auth_states')
      .select('*')
      .eq('state', state)
      .single()

    if (stateError || !authState) {
      return redirectToAccounts(redirectOrigin, { error: 'Facebook 授权状态无效或已过期' })
    }

    if (authState.status === 'failed' && authState.error_message) {
      return redirectToAccounts(redirectOrigin, {
        error: `Facebook 授权失败：${authState.error_message}`,
      })
    }

    if (authState.status !== 'pending') {
      return redirectToAccounts(redirectOrigin, { error: 'Facebook 授权状态已使用或无效，请重新绑定' })
    }

    if (error) {
      const metaErrorDetails = [
        errorDescription || error,
        errorCode ? `Meta 错误码 ${errorCode}` : null,
        errorReason ? `原因 ${errorReason}` : null,
      ].filter(Boolean).join('；')

      await supabase
        .from('facebook_auth_states')
        .update({
          status: 'failed',
          error_code: error,
          error_message: metaErrorDetails,
          code_verifier: null,
          completed_at: new Date().toISOString(),
        })
        .eq('state', state)

      return redirectToAccounts(redirectOrigin, { error: metaErrorDetails })
    }

    if (new Date(authState.expires_at).getTime() <= Date.now()) {
      await supabase
        .from('facebook_auth_states')
        .update({
          status: 'expired',
          error_code: 'expired',
          error_message: 'Authorization session expired.',
          code_verifier: null,
        })
        .eq('state', state)

      return redirectToAccounts(redirectOrigin, { error: 'Facebook 授权已过期，请重新绑定' })
    }

    if (!code) {
      throw new Error('缺少 Facebook authorization code')
    }

    const shortToken = await exchangeFacebookCodeForToken(code, authState.code_verifier)
    const longLivedToken = await exchangeForLongLivedUserToken(shortToken.access_token)
    const [facebookUser, pages, permissions] = await Promise.all([
      getFacebookUserInfo(longLivedToken.access_token),
      getMyFacebookPages(longLivedToken.access_token),
      getFacebookGrantedPermissions(longLivedToken.access_token),
    ])
    assertFacebookRequiredPageScopes(permissions)

    if (pages.length === 0) {
      const tokenDebug = await debugFacebookUserToken(longLivedToken.access_token).catch(() => null)

      throw new Error(buildFacebookNoPageError(permissions, tokenDebug))
    }
    const publishablePages = pages.filter((page) => hasFacebookPagePublishPermission(page.tasks))

    if (publishablePages.length === 0) {
      throw new Error(getFacebookPagePublishPermissionError(pages[0]?.name))
    }

    const now = new Date().toISOString()
    const expiresAt = calculateFacebookTokenExpiration(longLivedToken.expires_in)?.toISOString() || null
    const scopes = getGrantedFacebookScopes(permissions)
    let savedCount = 0

    if (isFacebookPageWebhookEnabled()) {
      await Promise.all(publishablePages.map((page) =>
        subscribeFacebookPageToWebhooks(page.pageId, page.accessToken)
      ))
    }

    for (const page of publishablePages) {
      const { data: savedAccount, error: upsertError } = await supabase
        .from('facebook_accounts')
        .upsert({
          user_id: authState.user_id,
          authorized_by_facebook_user_id: facebookUser.id,
          channel_id: page.pageId,
          channel_title: page.name,
          channel_handle: page.category,
          thumbnail_url: page.thumbnailUrl,
          subscriber_count: page.followerCount,
          video_count: 0,
          view_count: page.fanCount,
          access_token_expires_at: expiresAt,
          scopes,
          status: 'active',
          updated_at: now,
        }, {
          onConflict: 'user_id,channel_id',
        })
        .select('id')
        .single()

      if (upsertError) {
        throw new Error(`保存 Facebook Page 失败: ${upsertError.message}`)
      }

      const { error: tokenError } = await supabase
        .from('facebook_account_tokens')
        .upsert({
          account_id: savedAccount.id,
          access_token: page.accessToken,
          refresh_token: longLivedToken.access_token,
          access_token_expires_at: expiresAt,
          updated_at: now,
        }, {
          onConflict: 'account_id',
        })

      if (tokenError) {
        throw new Error(`保存 Facebook 授权令牌失败: ${tokenError.message}`)
      }

      savedCount++
    }

    await supabase
      .from('facebook_auth_states')
      .update({
        status: 'completed',
        code_verifier: null,
        completed_at: now,
      })
      .eq('state', state)

    return redirectToAccounts(redirectOrigin, {
      success: 'true',
      name: `${savedCount} 个 Page`,
    })
  } catch (err) {
    console.error('Facebook callback error:', err)

    if (state) {
      await supabase
        .from('facebook_auth_states')
        .update({
          status: 'failed',
          error_code: 'callback_failed',
          error_message: err instanceof Error ? err.message : 'Facebook 授权失败',
          code_verifier: null,
          completed_at: new Date().toISOString(),
        })
        .eq('state', state)
    }

    return redirectToAccounts(redirectOrigin, {
      error: err instanceof Error ? err.message : 'Facebook 授权失败',
    })
  }
}
