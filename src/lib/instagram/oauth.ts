import crypto from 'crypto'

import { instagramGraphHeaders } from '@/lib/instagram/graph-auth'
import { requestSensitiveInstagramOAuthJson } from '@/lib/instagram/oauth-transport'
import { callBroker, isBrokerEnabled } from '@/lib/oauth-broker/client'

const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_API_VERSION || process.env.FACEBOOK_API_VERSION || 'v20.0'
const META_AUTH_URL = `https://www.facebook.com/${INSTAGRAM_API_VERSION}/dialog/oauth`
const META_GRAPH_URL = `https://graph.facebook.com/${INSTAGRAM_API_VERSION}`
const INSTAGRAM_AUTH_URL = 'https://www.instagram.com/oauth/authorize'
const INSTAGRAM_GRAPH_URL = `https://graph.instagram.com/${INSTAGRAM_API_VERSION}`

export type InstagramAuthMode = 'facebook' | 'instagram'

export interface InstagramOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  loginConfigId: string | null
  authMode: InstagramAuthMode
  nativeEmbedUrl: string | null
}

export interface InstagramAuthorizationStateInput {
  state: string
  codeVerifier: string | null
}

export interface InstagramTokenResponse {
  access_token: string
  expires_in?: number
  permissions?: string[]
  scope?: string
  token_type?: string
  user_id?: string | number
}

export interface InstagramAccountInfo {
  accountId: string
  username: string
  name: string
  thumbnailUrl: string | null
  followerCount: number
  mediaCount: number
  pageId: string
  pageName: string
  pageAccessToken: string
}

export interface InstagramAccountDiscoveryPage {
  pageId: string
  pageName: string
  hasPageAccessToken: boolean
  instagramBusinessAccount: {
    id: string
    username: string | null
    name: string | null
  } | null
  connectedInstagramAccount: {
    id: string
    username: string | null
    name: string | null
  } | null
}

export interface InstagramAccountDiscoveryResult {
  accounts: InstagramAccountInfo[]
  pages: InstagramAccountDiscoveryPage[]
}

export interface InstagramAccountTokenResponse {
  access_token: string
  expires_in?: number
  user_access_token: string
  account: InstagramAccountInfo
}

export interface InstagramPermissionInfo {
  permission: string
  status: string
}

export interface InstagramTokenDebugInfo {
  appId: string | null
  isValid: boolean | null
  scopes: string[]
  granularScopes: Array<{
    scope: string
    targetIds: string[]
  }>
}

const INSTAGRAM_FACEBOOK_LOGIN_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
]

const INSTAGRAM_NATIVE_LOGIN_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
]

export class InstagramRequiredScopeError extends Error {
  code = 'missing_required_scopes'

  constructor() {
    super('Instagram authorization is missing required permissions.')
    this.name = 'InstagramRequiredScopeError'
  }
}

export function getInstagramRequiredScopes(authMode: InstagramAuthMode): string[] {
  return authMode === 'instagram'
    ? [...INSTAGRAM_NATIVE_LOGIN_SCOPES]
    : [...INSTAGRAM_FACEBOOK_LOGIN_SCOPES]
}

export function assertInstagramRequiredScopes(
  authMode: InstagramAuthMode,
  verifiedScopes: readonly string[]
) {
  const verified = new Set(verifiedScopes)
  if (!getInstagramRequiredScopes(authMode).every((scope) => verified.has(scope))) {
    throw new InstagramRequiredScopeError()
  }
}

export function getInstagramAuthMode(): InstagramAuthMode {
  return process.env.INSTAGRAM_AUTH_MODE === 'instagram' ? 'instagram' : 'facebook'
}

function parseInstagramNativeEmbedUrl(embedUrl: string | undefined): {
  clientId: string | null
  redirectUri: string | null
  scopes: string[]
} {
  if (!embedUrl) {
    return { clientId: null, redirectUri: null, scopes: [] }
  }

  try {
    const url = new URL(embedUrl)
    const scope = url.searchParams.get('scope')
    return {
      clientId: url.searchParams.get('client_id'),
      redirectUri: url.searchParams.get('redirect_uri'),
      scopes: scope ? scope.split(/[,\s]+/).filter(Boolean) : [],
    }
  } catch {
    return { clientId: null, redirectUri: null, scopes: [] }
  }
}

export function getInstagramOAuthConfig(): InstagramOAuthConfig {
  const authMode = getInstagramAuthMode()
  const nativeEmbedUrl = authMode === 'instagram' ? process.env.INSTAGRAM_NATIVE_EMBED_URL || null : null
  const nativeEmbedConfig = parseInstagramNativeEmbedUrl(nativeEmbedUrl || undefined)
  const clientId = authMode === 'instagram'
    ? process.env.INSTAGRAM_NATIVE_CLIENT_ID || nativeEmbedConfig.clientId || process.env.INSTAGRAM_CLIENT_ID || process.env.FACEBOOK_CLIENT_ID
    : process.env.INSTAGRAM_CLIENT_ID || process.env.FACEBOOK_CLIENT_ID
  const clientSecret = authMode === 'instagram'
    ? process.env.INSTAGRAM_NATIVE_CLIENT_SECRET || process.env.INSTAGRAM_CLIENT_SECRET || process.env.FACEBOOK_CLIENT_SECRET
    : process.env.INSTAGRAM_CLIENT_SECRET || process.env.FACEBOOK_CLIENT_SECRET
  const redirectUri = authMode === 'instagram'
    ? process.env.INSTAGRAM_NATIVE_REDIRECT_URI || process.env.INSTAGRAM_REDIRECT_URI || nativeEmbedConfig.redirectUri
    : process.env.INSTAGRAM_REDIRECT_URI
  const scopes = authMode === 'instagram'
    ? (nativeEmbedConfig.scopes.length > 0 ? nativeEmbedConfig.scopes : getInstagramRequiredScopes(authMode))
    : getInstagramRequiredScopes(authMode)
  const loginConfigId = authMode === 'facebook' ? process.env.INSTAGRAM_LOGIN_CONFIG_ID || null : null

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Instagram OAuth configuration is incomplete. Please set INSTAGRAM_NATIVE_CLIENT_ID, INSTAGRAM_NATIVE_CLIENT_SECRET, and INSTAGRAM_REDIRECT_URI.')
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    loginConfigId,
    authMode,
    nativeEmbedUrl,
  }
}

export function generateInstagramPKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = createInstagramPKCEChallenge(codeVerifier)
  return { codeVerifier, codeChallenge }
}

export function createInstagramPKCEChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url')
}

export function generateInstagramState(userId: string): string {
  return `${crypto.randomBytes(16).toString('hex')}_${userId}`
}

export function buildInstagramAuthorizationUrlForConfig(
  config: InstagramOAuthConfig,
  input: InstagramAuthorizationStateInput
): string {
  if (!input.state) {
    throw new Error('Instagram OAuth state is required.')
  }

  if (config.authMode === 'instagram' && input.codeVerifier) {
    throw new Error('Instagram Login auth state must not include a PKCE verifier.')
  }

  if (config.authMode === 'facebook' && !input.codeVerifier) {
    throw new Error('Facebook Login auth state is missing its PKCE verifier.')
  }

  const url = new URL(config.authMode === 'instagram' && config.nativeEmbedUrl ? config.nativeEmbedUrl : (config.authMode === 'instagram' ? INSTAGRAM_AUTH_URL : META_AUTH_URL))
  const params = url.searchParams
  params.set('client_id', config.clientId)
  params.set('redirect_uri', config.redirectUri)
  params.set('response_type', 'code')
  params.set('state', input.state)

  if (config.authMode === 'instagram') {
    params.delete('config_id')
    params.set('enable_fb_login', 'false')
    params.set('force_reauth', 'true')
  } else {
    params.set('auth_type', 'rerequest')
  }

  if (input.codeVerifier) {
    params.set('code_challenge', createInstagramPKCEChallenge(input.codeVerifier))
    params.set('code_challenge_method', 'S256')
  }

  if (config.authMode === 'facebook' && config.loginConfigId) {
    params.set('config_id', config.loginConfigId)
  } else {
    params.set('scope', config.scopes.join(','))
  }

  return url.toString()
}

export function buildInstagramAuthorizationUrlFromState(input: InstagramAuthorizationStateInput): string {
  return buildInstagramAuthorizationUrlForConfig(getInstagramOAuthConfig(), input)
}

export function buildInstagramAuthorizationUrl(userId: string): {
  authUrl: string
  state: string
  codeVerifier: string | null
} {
  const config = getInstagramOAuthConfig()
  const codeVerifier = config.authMode === 'facebook' ? generateInstagramPKCE().codeVerifier : null
  const state = generateInstagramState(userId)

  return {
    authUrl: buildInstagramAuthorizationUrlForConfig(config, { state, codeVerifier }),
    state,
    codeVerifier,
  }
}

async function readInstagramApiError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as any
  return String(data?.error?.message || data?.error_description || data?.error || response.statusText || 'Instagram request failed.')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(access_token|authorization|token|secret|code)=([^\s&]+)/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 240) || 'Instagram request failed.'
}

export async function exchangeInstagramCodeForToken(code: string, codeVerifier?: string | null): Promise<InstagramTokenResponse> {
  if (isBrokerEnabled()) return callBroker<InstagramTokenResponse>('instagram', 'exchangeInstagramCodeForToken', { code, codeVerifier })
  const config = getInstagramOAuthConfig()

  if (config.authMode === 'instagram') {
    const { json: data } = await requestSensitiveInstagramOAuthJson<InstagramTokenResponse>({
      host: 'api.instagram.com',
      path: '/oauth/access_token',
      method: 'POST',
      params: {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
      },
    })
    if (!data || typeof data.access_token !== 'string') {
      throw new Error('Instagram OAuth token exchange returned an invalid response.')
    }

    return data as unknown as InstagramTokenResponse
  }

  const { json: data } = await requestSensitiveInstagramOAuthJson<InstagramTokenResponse>({
    host: 'graph.facebook.com',
    path: `/${INSTAGRAM_API_VERSION}/oauth/access_token`,
    method: 'GET',
    params: {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    },
  })
  if (!data || typeof data.access_token !== 'string') {
    throw new Error('Instagram OAuth token exchange returned an invalid response.')
  }

  return data as unknown as InstagramTokenResponse
}

export async function exchangeForLongLivedUserToken(accessToken: string): Promise<InstagramTokenResponse> {
  if (isBrokerEnabled()) return callBroker<InstagramTokenResponse>('instagram', 'exchangeForLongLivedUserToken', { accessToken })
  const config = getInstagramOAuthConfig()

  if (config.authMode === 'instagram') {
    const { json: data } = await requestSensitiveInstagramOAuthJson<InstagramTokenResponse>({
      host: 'graph.instagram.com',
      path: '/access_token',
      method: 'GET',
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: config.clientSecret,
        access_token: accessToken,
      },
    })
    if (!data || typeof data.access_token !== 'string') {
      throw new Error('Instagram long-lived token exchange returned an invalid response.')
    }

    return data as unknown as InstagramTokenResponse
  }

  const { json: data } = await requestSensitiveInstagramOAuthJson<InstagramTokenResponse>({
    host: 'graph.facebook.com',
    path: `/${INSTAGRAM_API_VERSION}/oauth/access_token`,
    method: 'GET',
    params: {
      grant_type: 'fb_exchange_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      fb_exchange_token: accessToken,
    },
  })
  if (!data || typeof data.access_token !== 'string') {
    throw new Error('Instagram long-lived token exchange returned an invalid response.')
  }

  return data as unknown as InstagramTokenResponse
}

async function refreshLongLivedInstagramToken(accessToken: string): Promise<InstagramTokenResponse> {
  const { json: data } = await requestSensitiveInstagramOAuthJson<InstagramTokenResponse>({
    host: 'graph.instagram.com',
    path: '/refresh_access_token',
    method: 'GET',
    params: {
      grant_type: 'ig_refresh_token',
      access_token: accessToken,
    },
  })
  if (!data || typeof data.access_token !== 'string') {
    throw new Error('Instagram token refresh returned an invalid response.')
  }

  return data as unknown as InstagramTokenResponse
}

export async function revokeInstagramToken(token: string): Promise<void> {
  if (isBrokerEnabled()) { await callBroker<void>('instagram', 'revokeInstagramToken', { token }); return }
  const response = await fetch(`${META_GRAPH_URL}/me/permissions`, {
    method: 'DELETE',
    headers: instagramGraphHeaders(token),
  })

  if (!response.ok) {
    const message = await readInstagramApiError(response)
    throw new Error(`Failed to revoke Instagram token: ${message}`)
  }
}

export async function getInstagramGrantedPermissions(userAccessToken: string): Promise<InstagramPermissionInfo[]> {
  if (getInstagramAuthMode() === 'instagram') {
    return []
  }
  if (isBrokerEnabled()) return callBroker<InstagramPermissionInfo[]>('instagram', 'getInstagramGrantedPermissions', { userAccessToken })

  const response = await fetch(`${META_GRAPH_URL}/me/permissions`, {
    headers: instagramGraphHeaders(userAccessToken),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Instagram permissions: ${await readInstagramApiError(response)}`)
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

export async function debugInstagramUserToken(userAccessToken: string): Promise<InstagramTokenDebugInfo> {
  if (getInstagramAuthMode() === 'instagram') {
    return {
      appId: process.env.INSTAGRAM_NATIVE_CLIENT_ID || process.env.INSTAGRAM_CLIENT_ID || null,
      isValid: null,
      scopes: [],
      granularScopes: [],
    }
  }
  if (isBrokerEnabled()) return callBroker<InstagramTokenDebugInfo>('instagram', 'debugInstagramUserToken', { userAccessToken })
  // The direct debug_token protocol requires the inspected token in the query URL.
  // Without the broker, fail conservatively instead of exposing a credential to request logs.
  return {
    appId: process.env.INSTAGRAM_CLIENT_ID || null,
    isValid: null,
    scopes: [],
    granularScopes: [],
  }
}

export async function getMyInstagramAccounts(userAccessToken: string): Promise<InstagramAccountInfo[]> {
  const discovery = await discoverMyInstagramAccounts(userAccessToken)
  return discovery.accounts
}

const INSTAGRAM_NATIVE_ACCOUNT_FIELDS = [
  'user_id',
  'username',
  'name',
  'profile_picture_url',
  'followers_count',
  'media_count',
  'account_type',
].join(',')

const INSTAGRAM_PAGE_FIELDS = [
  'id',
  'name',
  'access_token',
  'instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}',
  'connected_instagram_account{id,username,name,profile_picture_url,followers_count,media_count}',
].join(',')

function toDiscoveryAccount(account: any): InstagramAccountDiscoveryPage['instagramBusinessAccount'] {
  if (!account?.id) return null

  return {
    id: String(account.id),
    username: typeof account.username === 'string' ? account.username : null,
    name: typeof account.name === 'string' ? account.name : null,
  }
}

function mapInstagramDiscoveryPages(pages: any[]): InstagramAccountDiscoveryPage[] {
  return pages.map((page: any) => ({
    pageId: String(page?.id || ''),
    pageName: String(page?.name || ''),
    hasPageAccessToken: typeof page?.access_token === 'string' && page.access_token.length > 0,
    instagramBusinessAccount: toDiscoveryAccount(page?.instagram_business_account),
    connectedInstagramAccount: toDiscoveryAccount(page?.connected_instagram_account),
  }))
}

function mapInstagramAccountsFromPages(pages: any[]): InstagramAccountInfo[] {
  return pages
    .filter((page: any) => page?.access_token && page?.instagram_business_account?.id && page?.instagram_business_account?.username)
    .map((page: any) => {
      const account = page.instagram_business_account
      return {
        accountId: account.id,
        username: account.username,
        name: account.name || account.username,
        thumbnailUrl: account.profile_picture_url || null,
        followerCount: Number(account.followers_count || 0),
        mediaCount: Number(account.media_count || 0),
        pageId: page.id,
        pageName: page.name || '',
        pageAccessToken: page.access_token,
      }
    })
}

function mapNativeInstagramAccount(account: any, accessToken: string): InstagramAccountInfo | null {
  const accountId = account?.user_id || account?.id
  const username = account?.username

  if (!accountId || typeof username !== 'string') {
    return null
  }

  return {
    accountId: String(accountId),
    username,
    name: typeof account.name === 'string' && account.name ? account.name : username,
    thumbnailUrl: account.profile_picture_url || null,
    followerCount: Number(account.followers_count || 0),
    mediaCount: Number(account.media_count || 0),
    pageId: '',
    pageName: '',
    pageAccessToken: accessToken,
  }
}

function getDebugPageTargetIds(debugInfo: InstagramTokenDebugInfo): string[] {
  const pageScopeNames = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']
  const ids = new Set<string>()

  for (const scopeName of pageScopeNames) {
    const granularScope = debugInfo.granularScopes.find((entry) => entry.scope === scopeName)
    for (const targetId of granularScope?.targetIds || []) {
      ids.add(targetId)
    }
  }

  return [...ids]
}

async function getInstagramPageById(userAccessToken: string, pageId: string): Promise<any | null> {
  const params = new URLSearchParams({
    fields: INSTAGRAM_PAGE_FIELDS,
  })

  const response = await fetch(`${META_GRAPH_URL}/${encodeURIComponent(pageId)}?${params.toString()}`, {
    headers: instagramGraphHeaders(userAccessToken),
  })
  if (!response.ok) {
    return null
  }

  const page = await response.json().catch(() => null) as any
  return page?.id ? page : null
}

async function getInstagramPagesFromDebugTargets(userAccessToken: string): Promise<any[]> {
  const debugInfo = await debugInstagramUserToken(userAccessToken).catch(() => null)
  if (!debugInfo) return []

  const pageIds = getDebugPageTargetIds(debugInfo)
  if (pageIds.length === 0) return []

  const pages = await Promise.all(pageIds.map((pageId) => getInstagramPageById(userAccessToken, pageId)))
  return pages.filter(Boolean)
}

export async function discoverMyInstagramAccounts(userAccessToken: string): Promise<InstagramAccountDiscoveryResult> {
  if (isBrokerEnabled()) return callBroker<InstagramAccountDiscoveryResult>('instagram', 'discoverMyInstagramAccounts', { userAccessToken })
  if (getInstagramAuthMode() === 'instagram') {
    const params = new URLSearchParams({
      fields: INSTAGRAM_NATIVE_ACCOUNT_FIELDS,
    })

    const response = await fetch(`${INSTAGRAM_GRAPH_URL}/me?${params.toString()}`, {
      headers: instagramGraphHeaders(userAccessToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch Instagram account: ${await readInstagramApiError(response)}`)
    }

    const data = await response.json().catch(() => null) as any
    const account = mapNativeInstagramAccount(data, userAccessToken)

    return {
      accounts: account ? [account] : [],
      pages: [],
    }
  }

  const params = new URLSearchParams({
    fields: INSTAGRAM_PAGE_FIELDS,
    limit: '100',
  })

  const response = await fetch(`${META_GRAPH_URL}/me/accounts?${params.toString()}`, {
    headers: instagramGraphHeaders(userAccessToken),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch Instagram accounts: ${await readInstagramApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as any
  let pages = Array.isArray(data?.data) ? data.data : []

  if (pages.length === 0) {
    pages = await getInstagramPagesFromDebugTargets(userAccessToken)
  }

  return {
    accounts: mapInstagramAccountsFromPages(pages),
    pages: mapInstagramDiscoveryPages(pages),
  }
}

export async function refreshInstagramAccountAccessToken(userAccessToken: string, accountId: string): Promise<InstagramAccountTokenResponse> {
  if (isBrokerEnabled()) return callBroker<InstagramAccountTokenResponse>('instagram', 'refreshInstagramAccountAccessToken', { userAccessToken, accountId })
  const refreshed = getInstagramAuthMode() === 'instagram'
    ? await refreshLongLivedInstagramToken(userAccessToken)
    : await exchangeForLongLivedUserToken(userAccessToken)
  const accounts = await getMyInstagramAccounts(refreshed.access_token)
  const account = accounts.find((candidate) => candidate.accountId === accountId)

  if (!account) {
    throw new Error('Instagram account is no longer available for this authorization.')
  }

  return {
    // 发布 token = 重新派生的 Page token（facebook 模式）；原生模式下 pageAccessToken 即刷新后的用户 token。
    access_token: account.pageAccessToken,
    expires_in: refreshed.expires_in,
    // 刷新凭据 = 新的长效用户 token，供下次刷新。
    user_access_token: refreshed.access_token,
    account,
  }
}

export function calculateInstagramTokenExpiration(expiresIn?: number): Date | null {
  if (!expiresIn) return null
  return new Date(Date.now() + expiresIn * 1000)
}

export function scopesToArray(scope: string | undefined): string[] {
  if (!scope) return []

  return [...new Set(scope.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean))]
}
