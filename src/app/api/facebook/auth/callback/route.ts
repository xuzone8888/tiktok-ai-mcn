import { NextRequest, NextResponse } from 'next/server'

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
  getFacebookUiLocaleFromState,
  getFacebookPagePublishPermissionError,
  getFacebookUserInfo,
  getMyFacebookPages,
  hasFacebookPagePublishPermission,
  isFacebookPageWebhookEnabled,
  subscribeFacebookPageToWebhooks,
  type FacebookPermissionInfo,
  type FacebookTokenDebugInfo,
} from '@/lib/facebook/oauth'
import { createAdminClient } from '@/lib/supabase/admin'

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

function formatFacebookPermissionDiagnostics(permissions: FacebookPermissionInfo[], isEnglish: boolean) {
  if (permissions.length === 0) {
    return isEnglish ? 'Meta did not return a permission list' : 'Meta 未返回权限列表'
  }

  const granted = permissions
    .filter((entry) => entry.status === 'granted')
    .map((entry) => entry.permission)
  const missingRequired = FACEBOOK_PAGE_SCOPES.filter((scope) => !granted.includes(scope))

  const noneText = isEnglish ? 'none' : '无'
  const grantedText = granted.length > 0 ? granted.join(', ') : noneText
  const missingText = missingRequired.length > 0 ? missingRequired.join(', ') : noneText

  return isEnglish
    ? `Granted permissions: ${grantedText}. Missing required Facebook Page permissions: ${missingText}`
    : `已授权权限：${grantedText}。缺失 Facebook Page 必需权限：${missingText}`
}

function formatFacebookTokenTargetDiagnostics(tokenDebug: FacebookTokenDebugInfo | null, isEnglish: boolean) {
  if (!tokenDebug) {
    return isEnglish ? 'Token target diagnostics are unavailable' : 'Token target 诊断不可用'
  }

  const pageScopeSummaries = FACEBOOK_PAGE_SCOPES.map((scopeName) => {
    const granularScope = tokenDebug.granularScopes.find((entry) => entry.scope === scopeName)
    if (!granularScope) return `${scopeName}: ${isEnglish ? 'granular scope was not returned' : '未返回 granular scope'}`
    return isEnglish
      ? `${scopeName}: ${granularScope.targetIds.length} target_id(s)`
      : `${scopeName}: target_ids 数量=${granularScope.targetIds.length}`
  })

  if (isEnglish) {
    const validity = tokenDebug.isValid === null ? 'unknown' : tokenDebug.isValid ? 'yes' : 'no'
    return `Token valid: ${validity}; ${pageScopeSummaries.join('; ')}`
  }
  return `Token 有效：${tokenDebug.isValid === null ? '未知' : tokenDebug.isValid ? '是' : '否'}；${pageScopeSummaries.join('；')}`
}

function buildFacebookNoPageError(
  permissions: FacebookPermissionInfo[],
  tokenDebug: FacebookTokenDebugInfo | null,
  isEnglish: boolean,
) {
  const config = getFacebookOAuthConfig()
  const permissionDiagnostics = formatFacebookPermissionDiagnostics(permissions, isEnglish)
  const targetDiagnostics = formatFacebookTokenTargetDiagnostics(tokenDebug, isEnglish)
  const configDiagnostics = isEnglish
    ? `Authorization configuration: Facebook Page config_id is ${config.pageLoginConfigId ? 'configured' : 'not configured'}`
    : `授权配置：Facebook Page config_id=${config.pageLoginConfigId ? '已配置' : '未配置'}`

  return isEnglish
    ? `Facebook authorization did not return a Page or Page access token that can be saved. ${permissionDiagnostics}. ${targetDiagnostics}. ${configDiagnostics}. Confirm that the Facebook Page login configuration includes pages_manage_metadata and that this Facebook account has full control of the Page. If the Page was not selected during an earlier authorization or the configuration changed later, remove this app from Facebook Business Integrations and reconnect.`
    : `当前 Facebook 授权未返回可保存的 Page 或 Page access token。${permissionDiagnostics}。${targetDiagnostics}。${configDiagnostics}。请确认 Facebook Page 登录配置包含 pages_manage_metadata，并确认该 Facebook 账号拥有 Page 的完整控制权限；如果之前授权时没勾选 Page 或配置权限后来有调整，请先到 Facebook 设置的企业集成中移除本应用后重新绑定。`
}

function localizeFacebookCallbackError(error: unknown, isEnglish: boolean) {
  const message = error instanceof Error ? error.message : ''
  if (!isEnglish) return message || 'Facebook 授权失败'
  if (!message) return 'Facebook authorization failed.'
  if (/Facebook Page authorization is missing required permissions:/.test(message)) return message
  if (/Facebook authorization did not return a Page/.test(message)) return message
  if (/does not have permission to publish content/.test(message)) return message
  if (!/[\u3400-\u9fff]/.test(message)) return message
  return 'Facebook authorization could not be completed. Reconnect and grant access to the required Pages and permissions.'
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const locale = getFacebookUiLocaleFromState(state)
  const isEnglish = locale === 'en_US'
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const errorCode = searchParams.get('error_code')
  const errorReason = searchParams.get('error_reason')
  const redirectOrigin = getAppRedirectOrigin(request)

  if ((!code && !error) || !state) {
    return redirectToAccounts(redirectOrigin, {
      error: isEnglish ? 'Missing Facebook authorization parameters.' : '缺少 Facebook 授权参数',
    })
  }

  const supabase = createAdminClient() as any

  try {
    const { data: authState, error: stateError } = await supabase
      .from('facebook_auth_states')
      .select('*')
      .eq('state', state)
      .single()

    if (stateError || !authState) {
      return redirectToAccounts(redirectOrigin, {
        error: isEnglish ? 'The Facebook authorization session is invalid or expired.' : 'Facebook 授权状态无效或已过期',
      })
    }

    if (authState.status === 'failed' && authState.error_message) {
      const storedError = localizeFacebookCallbackError(new Error(authState.error_message), isEnglish)
      return redirectToAccounts(redirectOrigin, {
        error: isEnglish
          ? `Facebook authorization failed: ${storedError}`
          : `Facebook 授权失败：${storedError}`,
      })
    }

    if (authState.status !== 'pending') {
      return redirectToAccounts(redirectOrigin, {
        error: isEnglish ? 'The Facebook authorization session was already used or is invalid. Please reconnect.' : 'Facebook 授权状态已使用或无效，请重新绑定',
      })
    }

    if (error) {
      const metaErrorDetails = [
        errorDescription || error,
        errorCode ? (isEnglish ? `Meta error code ${errorCode}` : `Meta 错误码 ${errorCode}`) : null,
        errorReason ? (isEnglish ? `Reason: ${errorReason}` : `原因 ${errorReason}`) : null,
      ].filter(Boolean).join(isEnglish ? '; ' : '；')
      const localizedMetaError = localizeFacebookCallbackError(new Error(metaErrorDetails), isEnglish)

      await supabase
        .from('facebook_auth_states')
        .update({
          status: 'failed',
          error_code: error,
          error_message: localizedMetaError,
          code_verifier: null,
          completed_at: new Date().toISOString(),
        })
        .eq('state', state)

      return redirectToAccounts(redirectOrigin, { error: localizedMetaError })
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

      return redirectToAccounts(redirectOrigin, {
        error: isEnglish ? 'Facebook authorization expired. Please reconnect.' : 'Facebook 授权已过期，请重新绑定',
      })
    }

    if (!code) {
      throw new Error(isEnglish ? 'Missing Facebook authorization code.' : '缺少 Facebook authorization code')
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

      throw new Error(buildFacebookNoPageError(permissions, tokenDebug, isEnglish))
    }
    const publishablePages = pages.filter((page) => hasFacebookPagePublishPermission(page.tasks))

    if (publishablePages.length === 0) {
      throw new Error(getFacebookPagePublishPermissionError(pages[0]?.name, locale))
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
        throw new Error(isEnglish ? `Failed to save Facebook Page: ${upsertError.message}` : `保存 Facebook Page 失败: ${upsertError.message}`)
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
        throw new Error(isEnglish ? `Failed to save the Facebook authorization token: ${tokenError.message}` : `保存 Facebook 授权令牌失败: ${tokenError.message}`)
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
      name: isEnglish
        ? `${savedCount} Page${savedCount === 1 ? '' : 's'}`
        : `${savedCount} 个 Page`,
    })
  } catch (err) {
    console.error('Facebook callback error:', err)

    if (state) {
      await supabase
        .from('facebook_auth_states')
        .update({
          status: 'failed',
          error_code: 'callback_failed',
          error_message: localizeFacebookCallbackError(err, isEnglish),
          code_verifier: null,
          completed_at: new Date().toISOString(),
        })
        .eq('state', state)
    }

    return redirectToAccounts(redirectOrigin, {
      error: localizeFacebookCallbackError(err, isEnglish),
    })
  }
}
