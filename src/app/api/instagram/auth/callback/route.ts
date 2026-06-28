import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  calculateInstagramTokenExpiration,
  debugInstagramUserToken,
  discoverMyInstagramAccounts,
  exchangeInstagramCodeForToken,
  exchangeForLongLivedUserToken,
  getInstagramGrantedPermissions,
  getInstagramOAuthConfig,
  type InstagramAccountDiscoveryPage,
  type InstagramPermissionInfo,
  type InstagramTokenDebugInfo,
  scopesToArray,
} from '@/lib/instagram/oauth'

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
  const redirectUrl = new URL('/instagram-publish/accounts', origin)
  redirectUrl.search = searchParams.toString()
  return NextResponse.redirect(redirectUrl)
}

function formatInstagramDiscoveryPage(page: InstagramAccountDiscoveryPage): string {
  const pageName = page.pageName || page.pageId || '未命名 Page'

  if (page.instagramBusinessAccount) {
    const accountName = page.instagramBusinessAccount.username || page.instagramBusinessAccount.name || page.instagramBusinessAccount.id
    return `${pageName}: 已返回 instagram_business_account=${accountName}`
  }

  if (page.connectedInstagramAccount) {
    const accountName = page.connectedInstagramAccount.username || page.connectedInstagramAccount.name || page.connectedInstagramAccount.id
    return `${pageName}: 只返回 connected_instagram_account=${accountName}，未返回可发布字段 instagram_business_account`
  }

  if (!page.hasPageAccessToken) {
    return `${pageName}: 未返回 Page access token，请重新授权并勾选该 Page`
  }

  return `${pageName}: 未返回 Instagram 连接字段`
}

function formatPermissionDiagnostics(permissions: InstagramPermissionInfo[]) {
  if (permissions.length === 0) {
    return 'Meta 未返回权限列表'
  }

  const granted = permissions
    .filter((entry) => entry.status === 'granted')
    .map((entry) => entry.permission)
  const missingRequired = getInstagramOAuthConfig().scopes.filter((scope) => !granted.includes(scope))

  const grantedText = granted.length > 0 ? granted.join(', ') : '无'
  const missingText = missingRequired.length > 0 ? missingRequired.join(', ') : '无'

  return `已授权权限：${grantedText}。缺失必需权限：${missingText}`
}

function formatTokenTargetDiagnostics(tokenDebug: InstagramTokenDebugInfo | null) {
  if (!tokenDebug) {
    return 'Token target 诊断不可用'
  }

  if (getInstagramOAuthConfig().authMode === 'instagram') {
    return `Token 有效：${tokenDebug.isValid === null ? '未知' : tokenDebug.isValid ? '是' : '否'}`
  }

  const pageScopeNames = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']
  const pageScopeSummaries = pageScopeNames.map((scopeName) => {
    const granularScope = tokenDebug.granularScopes.find((entry) => entry.scope === scopeName)
    if (!granularScope) return `${scopeName}: 未返回 granular scope`
    return `${scopeName}: target_ids=${granularScope.targetIds.length > 0 ? granularScope.targetIds.join(',') : '空'}`
  })

  return `Token 有效：${tokenDebug.isValid === null ? '未知' : tokenDebug.isValid ? '是' : '否'}；${pageScopeSummaries.join('；')}`
}

function buildInstagramDiscoveryError(
  pages: InstagramAccountDiscoveryPage[],
  permissions: InstagramPermissionInfo[],
  tokenDebug: InstagramTokenDebugInfo | null
) {
  const config = getInstagramOAuthConfig()
  const permissionDiagnostics = formatPermissionDiagnostics(permissions)
  const targetDiagnostics = formatTokenTargetDiagnostics(tokenDebug)
  const configDiagnostics = `当前 App ID：${config.clientId}；授权模式：${config.authMode}；Business Login config_id：${config.loginConfigId || '未配置'}`

  if (config.authMode === 'instagram') {
    return `当前 Instagram 授权未返回可发布的专业账号。${permissionDiagnostics}。${targetDiagnostics}。${configDiagnostics}。请确认该账号是 Instagram 专业账号，并且 Instagram 登录配置包含 instagram_business_basic 和 instagram_business_content_publish。`
  }

  if (pages.length === 0) {
    return `当前授权未返回任何可访问的 Facebook Page。${permissionDiagnostics}。${targetDiagnostics}。${configDiagnostics}。请确认授权页勾选了已绑定 Instagram 专业账号的 Facebook Page，且当前 Facebook 用户对该 Page 有完整控制权限。`
  }

  const summary = pages.slice(0, 5).map(formatInstagramDiscoveryPage).join('；')
  const suffix = pages.length > 5 ? `；另有 ${pages.length - 5} 个 Page 未展示` : ''

  return `当前授权未返回可发布的 Instagram 专业账号。${permissionDiagnostics}。${targetDiagnostics}。${configDiagnostics}。Meta 返回 Page 诊断：${summary}${suffix}`
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const redirectOrigin = getAppRedirectOrigin(request)

  if ((!code && !error) || !state) {
    return redirectToAccounts(redirectOrigin, { error: '缺少 Instagram 授权参数' })
  }

  const supabase = createAdminClient() as any

  try {
    const { data: authState, error: stateError } = await supabase
      .from('instagram_auth_states')
      .select('*')
      .eq('state', state)
      .single()

    if (stateError || !authState) {
      return redirectToAccounts(redirectOrigin, { error: 'Instagram 授权状态无效或已过期' })
    }

    if (authState.status !== 'pending') {
      return redirectToAccounts(redirectOrigin, { error: 'Instagram 授权状态已使用或无效，请重新绑定' })
    }

    if (error) {
      await supabase
        .from('instagram_auth_states')
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
        .from('instagram_auth_states')
        .update({
          status: 'expired',
          error_code: 'expired',
          error_message: 'Authorization session expired.',
          code_verifier: null,
        })
        .eq('state', state)

      return redirectToAccounts(redirectOrigin, { error: 'Instagram 授权已过期，请重新绑定' })
    }

    if (!code) {
      throw new Error('缺少 Instagram authorization code')
    }

    const shortToken = await exchangeInstagramCodeForToken(code, authState.code_verifier)
    const longLivedToken = await exchangeForLongLivedUserToken(shortToken.access_token)
    const permissions = await getInstagramGrantedPermissions(longLivedToken.access_token).catch(() => [])
    const tokenDebug = await debugInstagramUserToken(longLivedToken.access_token).catch(() => null)
    const discovery = await discoverMyInstagramAccounts(longLivedToken.access_token)
    const accounts = discovery.accounts

    if (accounts.length === 0) {
      throw new Error(buildInstagramDiscoveryError(discovery.pages, permissions, tokenDebug))
    }

    const now = new Date().toISOString()
    const expiresAt = calculateInstagramTokenExpiration(longLivedToken.expires_in)?.toISOString() || null
    const scopes = scopesToArray(shortToken.scope)
    let savedCount = 0

    for (const account of accounts) {
      const { data: savedAccount, error: upsertError } = await supabase
        .from('instagram_accounts')
        .upsert({
          user_id: authState.user_id,
          channel_id: account.accountId,
          channel_title: account.name,
          channel_handle: `@${account.username}`,
          thumbnail_url: account.thumbnailUrl,
          subscriber_count: account.followerCount,
          video_count: account.mediaCount,
          view_count: 0,
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
        throw new Error(`保存 Instagram 账号失败: ${upsertError.message}`)
      }

      const { error: tokenError } = await supabase
        .from('instagram_account_tokens')
        .upsert({
          account_id: savedAccount.id,
          // 发布 token：facebook 模式必须是 Page access token（graph.facebook.com/{ig_id}/media 要求），
          // instagram 原生模式下 pageAccessToken 即用户 token。两种模式都用 pageAccessToken 才正确。
          access_token: account.pageAccessToken,
          // 刷新凭据：保留长效用户 token，供后续重新派生 Page token。
          refresh_token: longLivedToken.access_token,
          access_token_expires_at: expiresAt,
          updated_at: now,
        }, {
          onConflict: 'account_id',
        })

      if (tokenError) {
        throw new Error(`保存 Instagram 授权令牌失败: ${tokenError.message}`)
      }

      savedCount++
    }

    await supabase
      .from('instagram_auth_states')
      .update({
        status: 'completed',
        code_verifier: null,
        completed_at: now,
      })
      .eq('state', state)

    return redirectToAccounts(redirectOrigin, {
      success: 'true',
      name: `${savedCount} 个账号`,
    })
  } catch (err) {
    console.error('Instagram callback error:', err)

    if (state) {
      await supabase
        .from('instagram_auth_states')
        .update({
          status: 'failed',
          error_code: 'callback_failed',
          error_message: err instanceof Error ? err.message : 'Instagram 授权失败',
          code_verifier: null,
          completed_at: new Date().toISOString(),
        })
        .eq('state', state)
    }

    return redirectToAccounts(redirectOrigin, {
      error: err instanceof Error ? err.message : 'Instagram 授权失败',
    })
  }
}
