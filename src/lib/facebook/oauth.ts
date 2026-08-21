import crypto from 'crypto'

import { callBroker, isBrokerEnabled } from '@/lib/oauth-broker/client'

const FACEBOOK_API_VERSION = process.env.FACEBOOK_API_VERSION || 'v25.0'
const FACEBOOK_AUTH_URL = `https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth`
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

export interface FacebookOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  pageLoginConfigId: string | null
}

export interface FacebookTokenResponse {
  access_token: string
  expires_in?: number
  scope?: string
  token_type?: string
}

export interface FacebookPageInfo {
  pageId: string
  name: string
  category: string | null
  thumbnailUrl: string | null
  followerCount: number
  fanCount: number
  link: string | null
  tasks: string[]
  accessToken: string
}

export interface FacebookPageTokenResponse {
  access_token: string
  expires_in?: number
  user_access_token: string
  page: FacebookPageInfo
}

export interface FacebookTokenDebugInfo {
  appId: string | null
  isValid: boolean | null
  scopes: string[]
  granularScopes: Array<{
    scope: string
    targetIds: string[]
  }>
}

export interface FacebookPermissionInfo {
  permission: string
  status: string
}

export interface FacebookUserInfo {
  id: string
}

export type FacebookUiLocale = 'en_US' | 'zh_CN'

const FACEBOOK_PAGE_PUBLISH_TASKS = new Set(['CREATE_CONTENT'])
const FACEBOOK_ACCOUNT_EDGE_FIELDS = 'id,name,access_token,category,followers_count,fan_count,link,tasks,picture{url}'
const FACEBOOK_DIRECT_PAGE_FIELDS = 'id,name,access_token,category,followers_count,fan_count,link,picture{url}'
const FACEBOOK_DIRECT_PAGE_MINIMAL_FIELDS = 'id,name,access_token,category,fan_count,link,picture{url}'
export const FACEBOOK_PAGE_SCOPES = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
  'pages_manage_engagement',
]

export function getMissingFacebookPageScopes(
  permissions: FacebookPermissionInfo[],
): string[] {
  const granted = new Set(
    permissions
      .filter((entry) => entry.status === 'granted')
      .map((entry) => entry.permission.trim())
      .filter(Boolean),
  )
  return FACEBOOK_PAGE_SCOPES.filter((scope) => !granted.has(scope))
}

export function assertFacebookRequiredPageScopes(
  permissions: FacebookPermissionInfo[],
): void {
  const missing = getMissingFacebookPageScopes(permissions)
  if (missing.length > 0) {
    throw new Error(
      `Facebook Page authorization is missing required permissions: ${missing.join(', ')}. Please reconnect and grant all requested Page permissions.`,
    )
  }
}
export function hasFacebookPagePublishPermission(tasks: string[] | null | undefined): boolean {
  return Array.isArray(tasks) && tasks.some((task) => FACEBOOK_PAGE_PUBLISH_TASKS.has(task))
}

export function getFacebookPagePublishPermissionError(pageName?: string, locale: FacebookUiLocale = 'zh_CN'): string {
  if (locale === 'en_US') {
    return `${pageName ? `Facebook Page "${pageName}"` : 'This Facebook Page'} does not have permission to publish content. Confirm that the Facebook account has full control of the Page, then reconnect and grant access to that Page.`
  }
  return `${pageName ? `Facebook Page「${pageName}」` : '当前 Facebook Page'}没有发布内容权限。请确认该 Facebook 账号拥有 Page 完整控制权限，并重新授权时勾选允许访问对应 Page。`
}

export function getFacebookOAuthConfig(): FacebookOAuthConfig {
  const clientId = process.env.FACEBOOK_CLIENT_ID
  const clientSecret = process.env.FACEBOOK_CLIENT_SECRET
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI
  const pageLoginConfigId = process.env.FACEBOOK_PAGE_LOGIN_CONFIG_ID || null

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Facebook OAuth configuration is incomplete. Please set FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET, and FACEBOOK_REDIRECT_URI.')
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: FACEBOOK_PAGE_SCOPES,
    pageLoginConfigId,
  }
}

export function generateFacebookPKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

export function generateFacebookState(userId: string, locale: FacebookUiLocale = 'zh_CN'): string {
  return `${crypto.randomBytes(16).toString('hex')}_${userId}_${locale === 'en_US' ? 'en' : 'zh'}`
}

export function getFacebookUiLocaleFromState(state: string | null | undefined): FacebookUiLocale {
  return state?.endsWith('_en') ? 'en_US' : 'zh_CN'
}

export function buildFacebookAuthorizationUrl(userId: string, locale: FacebookUiLocale = 'zh_CN'): {
  authUrl: string
  state: string
  codeVerifier: string
} {
  const config = getFacebookOAuthConfig()
  const { codeVerifier, codeChallenge } = generateFacebookPKCE()
  const state = generateFacebookState(userId, locale)

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    state,
    auth_type: 'rerequest',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  if (config.pageLoginConfigId) {
    params.set('config_id', config.pageLoginConfigId)
  } else {
    params.set('scope', config.scopes.join(','))
  }

  return {
    authUrl: `${FACEBOOK_AUTH_URL}?${params.toString()}`,
    state,
    codeVerifier,
  }
}

async function readFacebookApiError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as any
  return data?.error?.message || data?.error_description || data?.error || response.statusText
}

// appsecret_proof = HMAC-SHA256(access_token, app secret)。
// Meta 应用开启「Require proof of app secret」后，所有携带用户/页面令牌的 Graph 调用都必须带上，
// 否则返回 OAuthException 导致绑定/刷新/发布全部失败；同时降低令牌泄露后被直接重放的风险。
// 仅用于携带用户/页面令牌的调用；使用 app access token 的 debug_token 不需要。
export function getFacebookAppSecretProof(accessToken: string): string {
  return crypto.createHmac('sha256', getFacebookOAuthConfig().clientSecret).update(accessToken).digest('hex')
}

export function isFacebookPageWebhookEnabled(): boolean {
  return process.env.FACEBOOK_PAGE_WEBHOOK_ENABLED === 'true'
}

export async function getFacebookUserInfo(userAccessToken: string): Promise<FacebookUserInfo> {
  if (isBrokerEnabled()) {
    return callBroker<FacebookUserInfo>('facebook', 'getFacebookUserInfo', { userAccessToken })
  }
  const params = new URLSearchParams({
    fields: 'id',
    appsecret_proof: getFacebookAppSecretProof(userAccessToken),
  })
  const response = await fetch(`${FACEBOOK_GRAPH_URL}/me?${params.toString()}`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch Facebook user identity: ${await readFacebookApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!data || typeof data.id !== 'string' || !data.id) {
    throw new Error('Facebook user identity response is invalid.')
  }
  return { id: data.id }
}

export async function subscribeFacebookPageToWebhooks(
  pageId: string,
  pageAccessToken: string,
): Promise<void> {
  if (isBrokerEnabled()) {
    await callBroker<void>('facebook', 'subscribeFacebookPageToWebhooks', {
      pageId,
      pageAccessToken,
    })
    return
  }

  const body = new URLSearchParams({
    subscribed_fields: 'feed',
    appsecret_proof: getFacebookAppSecretProof(pageAccessToken),
  })
  const response = await fetch(
    `${FACEBOOK_GRAPH_URL}/${encodeURIComponent(pageId)}/subscribed_apps`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  )
  if (!response.ok) {
    throw new Error(`Failed to subscribe Facebook Page webhooks: ${await readFacebookApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (data?.success !== true) {
    throw new Error('Facebook Page webhook subscription returned an invalid response.')
  }
}

export async function unsubscribeFacebookPageFromWebhooks(
  pageId: string,
  pageAccessToken: string,
): Promise<void> {
  if (isBrokerEnabled()) {
    await callBroker<void>('facebook', 'unsubscribeFacebookPageFromWebhooks', {
      pageId,
      pageAccessToken,
    })
    return
  }

  const body = new URLSearchParams({
    appsecret_proof: getFacebookAppSecretProof(pageAccessToken),
  })
  const response = await fetch(
    `${FACEBOOK_GRAPH_URL}/${encodeURIComponent(pageId)}/subscribed_apps`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  )
  if (!response.ok) {
    throw new Error(`Failed to unsubscribe Facebook Page webhooks: ${await readFacebookApiError(response)}`)
  }
}

export async function exchangeFacebookCodeForToken(code: string, codeVerifier?: string | null): Promise<FacebookTokenResponse> {
  if (isBrokerEnabled()) return callBroker<FacebookTokenResponse>('facebook', 'exchangeFacebookCodeForToken', { code, codeVerifier })
  const config = getFacebookOAuthConfig()
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  })

  if (codeVerifier) {
    params.set('code_verifier', codeVerifier)
  }

  const response = await fetch(`${FACEBOOK_GRAPH_URL}/oauth/access_token?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Facebook OAuth token exchange failed: ${await readFacebookApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!data || typeof data.access_token !== 'string') {
    throw new Error('Facebook OAuth token exchange returned an invalid response.')
  }

  return data as unknown as FacebookTokenResponse
}

export async function exchangeForLongLivedUserToken(accessToken: string): Promise<FacebookTokenResponse> {
  if (isBrokerEnabled()) return callBroker<FacebookTokenResponse>('facebook', 'exchangeForLongLivedUserToken', { accessToken })
  const config = getFacebookOAuthConfig()
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    fb_exchange_token: accessToken,
  })

  const response = await fetch(`${FACEBOOK_GRAPH_URL}/oauth/access_token?${params.toString()}`)
  if (!response.ok) {
    // 附带 HTTP 状态码：上层据此区分"令牌确实失效(400/401)"与"瞬时故障(5xx/429/网络)"，仅前者才标记账号 expired。
    const error = new Error(`Facebook long-lived token exchange failed: ${await readFacebookApiError(response)}`) as Error & { httpStatus?: number }
    error.httpStatus = response.status
    throw error
  }

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!data || typeof data.access_token !== 'string') {
    throw new Error('Facebook long-lived token exchange returned an invalid response.')
  }

  return data as unknown as FacebookTokenResponse
}

export async function revokeFacebookToken(token: string): Promise<void> {
  if (isBrokerEnabled()) { await callBroker<void>('facebook', 'revokeFacebookToken', { token }); return }
  const params = new URLSearchParams({
    appsecret_proof: getFacebookAppSecretProof(token),
  })
  const response = await fetch(`${FACEBOOK_GRAPH_URL}/me/permissions?${params.toString()}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const message = await readFacebookApiError(response)
    throw new Error(`Failed to revoke Facebook token: ${message}`)
  }
}

export async function getFacebookGrantedPermissions(userAccessToken: string): Promise<FacebookPermissionInfo[]> {
  if (isBrokerEnabled()) return callBroker<FacebookPermissionInfo[]>('facebook', 'getFacebookGrantedPermissions', { userAccessToken })
  const params = new URLSearchParams({
    appsecret_proof: getFacebookAppSecretProof(userAccessToken),
  })
  const response = await fetch(`${FACEBOOK_GRAPH_URL}/me/permissions?${params.toString()}`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Facebook permissions: ${await readFacebookApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as any
  const permissions = Array.isArray(data?.data) ? data.data : []

  return permissions
    .filter((entry: any) => typeof entry?.permission === 'string')
    .map((entry: any) => ({
      permission: entry.permission,
      status: typeof entry.status === 'string' ? entry.status : 'unknown',
    }))
}

export function getGrantedFacebookScopes(permissions: FacebookPermissionInfo[]): string[] {
  return [...new Set(
    permissions
      .filter((entry) => entry.status === 'granted')
      .map((entry) => entry.permission.trim())
      .filter(Boolean)
  )]
}

export async function debugFacebookUserToken(userAccessToken: string): Promise<FacebookTokenDebugInfo> {
  if (isBrokerEnabled()) return callBroker<FacebookTokenDebugInfo>('facebook', 'debugFacebookUserToken', { userAccessToken })
  const config = getFacebookOAuthConfig()
  const appAccessToken = `${config.clientId}|${config.clientSecret}`
  const params = new URLSearchParams({
    input_token: userAccessToken,
    access_token: appAccessToken,
  })

  const response = await fetch(`${FACEBOOK_GRAPH_URL}/debug_token?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to debug Facebook token: ${await readFacebookApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as any
  const tokenData = data?.data || {}
  const scopes = Array.isArray(tokenData.scopes) ? tokenData.scopes.map(String) : []
  const granularScopes = Array.isArray(tokenData.granular_scopes)
    ? tokenData.granular_scopes
      .filter((entry: any) => typeof entry?.scope === 'string')
      .map((entry: any) => ({
        scope: entry.scope,
        targetIds: Array.isArray(entry.target_ids) ? entry.target_ids.map(String) : [],
      }))
    : []

  return {
    appId: typeof tokenData.app_id === 'string' ? tokenData.app_id : null,
    isValid: typeof tokenData.is_valid === 'boolean' ? tokenData.is_valid : null,
    scopes,
    granularScopes,
  }
}

function mapFacebookPage(page: any, fallbackTasks: string[] = []): FacebookPageInfo {
  return {
    pageId: page.id,
    name: page.name,
    category: page.category || null,
    thumbnailUrl: page.picture?.data?.url || null,
    followerCount: Number(page.followers_count || page.fan_count || 0),
    fanCount: Number(page.fan_count || 0),
    link: page.link || `https://www.facebook.com/${page.id}`,
    tasks: Array.isArray(page.tasks) ? page.tasks.map(String) : fallbackTasks,
    accessToken: page.access_token,
  }
}

function getDebugPageTargets(debugInfo: FacebookTokenDebugInfo): Map<string, Set<string>> {
  const targets = new Map<string, Set<string>>()

  for (const scopeName of FACEBOOK_PAGE_SCOPES) {
    const granularScope = debugInfo.granularScopes.find((entry) => entry.scope === scopeName)
    for (const targetId of granularScope?.targetIds || []) {
      if (!targets.has(targetId)) {
        targets.set(targetId, new Set())
      }
      targets.get(targetId)?.add(scopeName)
    }
  }

  return targets
}

async function getFacebookPageById(userAccessToken: string, pageId: string, fields: string, mode: string): Promise<any | null> {
  const params = new URLSearchParams({
    fields,
    appsecret_proof: getFacebookAppSecretProof(userAccessToken),
  })

  const response = await fetch(`${FACEBOOK_GRAPH_URL}/${encodeURIComponent(pageId)}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
  })
  if (!response.ok) {
    console.warn('Facebook direct Page fallback failed:', {
      pageId,
      mode,
      error: await readFacebookApiError(response),
    })
    return null
  }

  const page = await response.json().catch(() => null) as any
  return page?.id && page?.name && page?.access_token ? page : null
}

async function getFacebookPageByIdWithFallback(userAccessToken: string, pageId: string): Promise<any | null> {
  const page = await getFacebookPageById(userAccessToken, pageId, FACEBOOK_DIRECT_PAGE_FIELDS, 'direct_page')
  if (page) return page

  return getFacebookPageById(userAccessToken, pageId, FACEBOOK_DIRECT_PAGE_MINIMAL_FIELDS, 'direct_page_minimal')
}

async function getFacebookPagesFromDebugTargets(userAccessToken: string): Promise<any[]> {
  const debugInfo = await debugFacebookUserToken(userAccessToken).catch(() => null)
  if (!debugInfo) return []

  const pageTargets = getDebugPageTargets(debugInfo)
  if (pageTargets.size === 0) return []

  const pages = await Promise.all([...pageTargets.entries()].map(async ([pageId, scopes]) => {
    const page = await getFacebookPageByIdWithFallback(userAccessToken, pageId)
    if (!page) return null

    return {
      ...page,
      tasks: scopes.has('pages_manage_posts') ? ['CREATE_CONTENT'] : [],
    }
  }))

  return pages.filter(Boolean)
}

function hasFacebookPageAccessToken(page: any): boolean {
  return Boolean(page?.id && page?.name && page?.access_token)
}

export async function getMyFacebookPages(userAccessToken: string): Promise<FacebookPageInfo[]> {
  if (isBrokerEnabled()) return callBroker<FacebookPageInfo[]>('facebook', 'getMyFacebookPages', { userAccessToken })
  const params = new URLSearchParams({
    fields: FACEBOOK_ACCOUNT_EDGE_FIELDS,
    appsecret_proof: getFacebookAppSecretProof(userAccessToken),
    limit: '100',
  })

  const response = await fetch(`${FACEBOOK_GRAPH_URL}/me/accounts?${params.toString()}`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch Facebook Pages: ${await readFacebookApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as any
  let pages = Array.isArray(data?.data) ? data.data : []

  if (pages.length === 0) {
    pages = await getFacebookPagesFromDebugTargets(userAccessToken)
  }

  return pages
    .filter(hasFacebookPageAccessToken)
    .map(mapFacebookPage)
}

export async function getFacebookPageInfo(pageId: string, pageAccessToken: string): Promise<Omit<FacebookPageInfo, 'accessToken'>> {
  if (isBrokerEnabled()) return callBroker<Omit<FacebookPageInfo, 'accessToken'>>('facebook', 'getFacebookPageInfo', { pageId, pageAccessToken })
  const params = new URLSearchParams({
    fields: 'id,name,category,followers_count,fan_count,link,tasks,picture{url}',
    appsecret_proof: getFacebookAppSecretProof(pageAccessToken),
  })

  const response = await fetch(`${FACEBOOK_GRAPH_URL}/${encodeURIComponent(pageId)}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${pageAccessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch Facebook Page: ${await readFacebookApiError(response)}`)
  }

  const page = await response.json().catch(() => null) as any
  if (!page?.id || !page?.name) {
    throw new Error('No Facebook Page found for this access token.')
  }

  return {
    pageId: page.id,
    name: page.name,
    category: page.category || null,
    thumbnailUrl: page.picture?.data?.url || null,
    followerCount: Number(page.followers_count || page.fan_count || 0),
    fanCount: Number(page.fan_count || 0),
    link: page.link || `https://www.facebook.com/${page.id}`,
    tasks: Array.isArray(page.tasks) ? page.tasks.map(String) : [],
  }
}

export async function refreshFacebookPageAccessToken(userAccessToken: string, pageId: string): Promise<FacebookPageTokenResponse> {
  if (isBrokerEnabled()) return callBroker<FacebookPageTokenResponse>('facebook', 'refreshFacebookPageAccessToken', { userAccessToken, pageId })
  const longLived = await exchangeForLongLivedUserToken(userAccessToken)
  const pages = await getMyFacebookPages(longLived.access_token)
  const page = pages.find((candidate) => candidate.pageId === pageId)

  if (!page) {
    throw new Error('Facebook Page is no longer available for this authorization.')
  }
  if (!hasFacebookPagePublishPermission(page.tasks)) {
    throw new Error(getFacebookPagePublishPermissionError(page.name))
  }

  return {
    access_token: page.accessToken,
    expires_in: longLived.expires_in,
    user_access_token: longLived.access_token,
    page,
  }
}

export function calculateFacebookTokenExpiration(expiresIn?: number): Date | null {
  if (!expiresIn) return null
  return new Date(Date.now() + expiresIn * 1000)
}

export function scopesToArray(scope: string | undefined): string[] {
  return scope ? scope.split(/[,\s]+/).filter(Boolean) : getFacebookOAuthConfig().scopes
}
