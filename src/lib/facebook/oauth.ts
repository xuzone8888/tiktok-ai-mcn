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

export const FACEBOOK_PAGE_DISCOVERY_CONTRACT_VERSION = 2

export type FacebookPageDiscoveryWarningCode =
  | 'selection_diagnostics_unavailable'
  | 'selected_pages_unavailable'

export interface FacebookPageDiscoveryWarning {
  code: FacebookPageDiscoveryWarningCode
  count?: number
}

export interface FacebookPageDiscoveryResult {
  contractVersion: typeof FACEBOOK_PAGE_DISCOVERY_CONTRACT_VERSION
  pages: FacebookPageInfo[]
  warnings: FacebookPageDiscoveryWarning[]
}

export interface FacebookPageBindingPlan {
  pagesToSave: FacebookPageInfo[]
  warning: string | null
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

interface FacebookRawPage extends Record<string, unknown> {
  id?: unknown
  name?: unknown
  access_token?: unknown
  tasks?: unknown
}

interface FacebookPageLookupResult {
  page: FacebookRawPage | null
  httpStatus: number | null
}

async function getFacebookPageById(
  userAccessToken: string,
  pageId: string,
  fields: string,
  mode: string,
): Promise<FacebookPageLookupResult> {
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
    return { page: null, httpStatus: response.status }
  }

  const page = await response.json().catch(() => null) as FacebookRawPage | null
  return {
    page: typeof page?.id === 'string' && typeof page.name === 'string' && typeof page.access_token === 'string'
      ? page
      : null,
    httpStatus: null,
  }
}

async function getFacebookPageByIdWithFallback(userAccessToken: string, pageId: string): Promise<FacebookRawPage | null> {
  const primary = await getFacebookPageById(userAccessToken, pageId, FACEBOOK_DIRECT_PAGE_FIELDS, 'direct_page')
  if (primary.page) return primary.page

  const minimal = await getFacebookPageById(
    userAccessToken,
    pageId,
    FACEBOOK_DIRECT_PAGE_MINIMAL_FIELDS,
    'direct_page_minimal',
  )
  if (minimal.page) return minimal.page

  const retryableStatus = [primary.httpStatus, minimal.httpStatus]
    .find((status) => status === 429 || (typeof status === 'number' && status >= 500))
  if (retryableStatus) {
    const error = new Error('Facebook could not verify all selected Pages because Meta is temporarily unavailable. Please try again.') as Error & { httpStatus?: number }
    error.httpStatus = retryableStatus
    throw error
  }

  return null
}

async function getFacebookPagesFromDebugTargets(
  userAccessToken: string,
  pageTargets: Map<string, Set<string>>,
  targetIds: string[],
): Promise<FacebookRawPage[]> {
  const pages = await Promise.all(targetIds.map(async (pageId) => {
    const scopes = pageTargets.get(pageId) || new Set<string>()
    const page = await getFacebookPageByIdWithFallback(userAccessToken, pageId)
    if (!page) return null

    return {
      ...page,
      tasks: scopes.has('pages_manage_posts') ? ['CREATE_CONTENT'] : [],
    }
  }))

  return pages.filter((page): page is FacebookRawPage & { tasks: string[] } => Boolean(page))
}

function hasFacebookPageAccessToken(page: any): boolean {
  return Boolean(page?.id && page?.name && page?.access_token)
}

async function discoverFacebookPages(
  userAccessToken: string,
  options: { requireAllSelectedTargets: boolean; targetPageId?: string },
): Promise<FacebookPageDiscoveryResult> {
  const params = new URLSearchParams({
    fields: FACEBOOK_ACCOUNT_EDGE_FIELDS,
    appsecret_proof: getFacebookAppSecretProof(userAccessToken),
    limit: '100',
  })

  const accountsResponsePromise = fetch(`${FACEBOOK_GRAPH_URL}/me/accounts?${params.toString()}`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
  })
  let response: Response
  let debugInfo: FacebookTokenDebugInfo | null = null
  if (options.requireAllSelectedTargets) {
    [response, debugInfo] = await Promise.all([
      accountsResponsePromise,
      debugFacebookUserToken(userAccessToken).catch(() => null),
    ])
  } else {
    response = await accountsResponsePromise
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch Facebook Pages: ${await readFacebookApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as any
  const edgePages = Array.isArray(data?.data) ? data.data : []
  const pagesById = new Map<string, any>()

  for (const page of edgePages) {
    if (hasFacebookPageAccessToken(page)) {
      pagesById.set(String(page.id), page)
    }
  }

  if (!options.requireAllSelectedTargets && options.targetPageId && pagesById.has(options.targetPageId)) {
    return {
      contractVersion: FACEBOOK_PAGE_DISCOVERY_CONTRACT_VERSION,
      pages: [...pagesById.values()].map((page) => mapFacebookPage(page)),
      warnings: [],
    }
  }

  if (options.requireAllSelectedTargets && !debugInfo) {
    return {
      contractVersion: FACEBOOK_PAGE_DISCOVERY_CONTRACT_VERSION,
      pages: [...pagesById.values()].map((page) => mapFacebookPage(page)),
      warnings: [{ code: 'selection_diagnostics_unavailable' }],
    }
  }

  const resolvedDebugInfo = debugInfo || await debugFacebookUserToken(userAccessToken)
  const pageTargets = getDebugPageTargets(resolvedDebugInfo)
  const missingTargetIds = [...pageTargets.keys()].filter((pageId) => !pagesById.has(pageId))
  const targetIdsToRecover = options.requireAllSelectedTargets
    ? missingTargetIds
    : missingTargetIds.filter((pageId) => pageId === options.targetPageId)
  const recoveredPages = await getFacebookPagesFromDebugTargets(
    userAccessToken,
    pageTargets,
    targetIdsToRecover,
  )

  for (const page of recoveredPages) {
    if (hasFacebookPageAccessToken(page)) {
      pagesById.set(String(page.id), page)
    }
  }

  const unresolvedTargetCount = [...pageTargets.keys()].filter((pageId) => !pagesById.has(pageId)).length
  const warnings: FacebookPageDiscoveryWarning[] = []
  if (options.requireAllSelectedTargets && pageTargets.size === 0) {
    warnings.push({ code: 'selection_diagnostics_unavailable' })
  }
  if (options.requireAllSelectedTargets && unresolvedTargetCount > 0) {
    warnings.push({ code: 'selected_pages_unavailable', count: unresolvedTargetCount })
  }

  return {
    contractVersion: FACEBOOK_PAGE_DISCOVERY_CONTRACT_VERSION,
    pages: [...pagesById.values()].map((page) => mapFacebookPage(page)),
    warnings,
  }
}

function assertFacebookPageDiscoveryContract(result: FacebookPageDiscoveryResult): FacebookPageDiscoveryResult {
  if (result?.contractVersion !== FACEBOOK_PAGE_DISCOVERY_CONTRACT_VERSION || !Array.isArray(result.pages) || !Array.isArray(result.warnings)) {
    throw new Error('Facebook Page discovery broker is out of date. Rebuild the OAuth broker with the same application release before reconnecting.')
  }
  return result
}

export async function discoverMyFacebookPages(userAccessToken: string): Promise<FacebookPageDiscoveryResult> {
  if (isBrokerEnabled()) {
    try {
      const result = await callBroker<FacebookPageDiscoveryResult>(
        'facebook',
        'discoverMyFacebookPages',
        { userAccessToken },
        { timeoutMs: 30_000 },
      )
      return assertFacebookPageDiscoveryContract(result)
    } catch (error) {
      // An older broker does not know this versioned operation and returns its
      // closed-whitelist HTTP 400. Convert that transport-only response into a
      // specific, localizable rollout error instead of showing a raw status.
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error || '')
      if (/OAuth broker returned transport status 400/.test(errorMessage)) {
        throw new Error('Facebook Page discovery broker is out of date. Rebuild the OAuth broker with the same application release before reconnecting.')
      }
      throw error
    }
  }
  return assertFacebookPageDiscoveryContract(
    await discoverFacebookPages(userAccessToken, { requireAllSelectedTargets: true }),
  )
}

export async function getMyFacebookPages(userAccessToken: string): Promise<FacebookPageInfo[]> {
  return (await discoverMyFacebookPages(userAccessToken)).pages
}

function formatPageNames(names: string[], isEnglish: boolean): string {
  const visible = names.slice(0, 3)
  const remaining = names.length - visible.length
  const list = visible.map((name) => `“${name}”`).join(isEnglish ? ', ' : '、')
  if (remaining <= 0) return list
  return isEnglish ? `${list} and ${remaining} more` : `${list}等 ${names.length} 个 Page`
}

export function planFacebookPageBinding(
  discovery: FacebookPageDiscoveryResult,
  locale: FacebookUiLocale = 'zh_CN',
): FacebookPageBindingPlan {
  const isEnglish = locale === 'en_US'
  const pagesToSave = discovery.pages.filter((page) => hasFacebookPagePublishPermission(page.tasks))
  const pagesWithoutPublishPermission = discovery.pages.filter((page) => !hasFacebookPagePublishPermission(page.tasks))

  if (pagesToSave.length === 0 && pagesWithoutPublishPermission.length > 0) {
    throw new Error(getFacebookPagePublishPermissionError(pagesWithoutPublishPermission[0]?.name, locale))
  }

  const warningParts: string[] = []
  if (pagesWithoutPublishPermission.length > 0) {
    const pageNames = formatPageNames(pagesWithoutPublishPermission.map((page) => page.name), isEnglish)
    warningParts.push(isEnglish
      ? `Skipped ${pageNames} because this Facebook account does not have permission to publish to ${pagesWithoutPublishPermission.length === 1 ? 'that Page' : 'those Pages'}.`
      : `已跳过 ${pageNames}，因为当前 Facebook 账号没有这些 Page 的发布权限。`)
  }

  for (const warning of discovery.warnings) {
    if (warning.code === 'selected_pages_unavailable' && Number(warning.count) > 0) {
      const count = Number(warning.count)
      warningParts.push(isEnglish
        ? `${count} selected Page${count === 1 ? '' : 's'} could not be connected because Meta did not return Page access data.`
        : `另有 ${count} 个已选择的 Page 因 Meta 未返回 Page 访问数据而未能连接。`)
    }
    if (warning.code === 'selection_diagnostics_unavailable') {
      warningParts.push(isEnglish
        ? 'Meta Page-selection diagnostics were temporarily unavailable. Confirm that every selected Page appears in the account list.'
        : 'Meta 的 Page 选择诊断暂时不可用，请确认账号列表中是否显示了全部已选择的 Page。')
    }
  }

  return {
    pagesToSave,
    warning: warningParts.length > 0 ? warningParts.join(' ') : null,
  }
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
  const discovery = await discoverFacebookPages(longLived.access_token, {
    requireAllSelectedTargets: false,
    targetPageId: pageId,
  })
  const pages = discovery.pages
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
