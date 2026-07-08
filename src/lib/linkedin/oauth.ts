import crypto from 'crypto'

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo'

export type LinkedInOwnerType = 'member'

export interface LinkedInOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  apiVersion: string
}

export interface LinkedInTokenResponse {
  access_token: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  scope?: string
  token_type?: string
}

export interface LinkedInUserInfo {
  sub: string
  name?: string
  given_name?: string
  family_name?: string
  picture?: string
}

export interface LinkedInOwnerInfo {
  ownerUrn: string
  ownerType: LinkedInOwnerType
  localizedName: string
  vanityName: string | null
  avatarUrl: string | null
  followerCount: number
}

export function getLinkedInOAuthConfig(): LinkedInOAuthConfig {
  const clientId = process.env.LINKEDIN_CLIENT_ID
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI
  const apiVersion = process.env.LINKEDIN_API_VERSION

  if (!clientId || !clientSecret || !redirectUri || !apiVersion) {
    throw new Error('LinkedIn OAuth configuration is incomplete. Please set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI, and LINKEDIN_API_VERSION.')
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    apiVersion,
    scopes: ['openid', 'profile', 'w_member_social'],
  }
}

export function generateLinkedInState(userId: string): string {
  return `${crypto.randomBytes(16).toString('hex')}_${userId}`
}

export function buildLinkedInAuthorizationUrl(userId: string): {
  authUrl: string
  state: string
} {
  const config = getLinkedInOAuthConfig()
  const state = generateLinkedInState(userId)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    state,
  })

  return {
    authUrl: `${LINKEDIN_AUTH_URL}?${params.toString()}`,
    state,
  }
}

function linkedInHeaders(accessToken?: string): Record<string, string> {
  const config = getLinkedInOAuthConfig()
  return {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    'Linkedin-Version': config.apiVersion,
    'X-Restli-Protocol-Version': '2.0.0',
  }
}

async function readLinkedInApiError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as any
  return data?.message || data?.error_description || data?.error || response.statusText
}

export async function exchangeLinkedInCodeForToken(code: string): Promise<LinkedInTokenResponse> {
  const config = getLinkedInOAuthConfig()
  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    throw new Error(`LinkedIn OAuth token exchange failed: ${data?.error_description || data?.error || response.statusText}`)
  }

  if (!data || typeof data.access_token !== 'string') {
    throw new Error('LinkedIn OAuth token exchange returned an invalid response.')
  }

  return data as unknown as LinkedInTokenResponse
}

export async function refreshLinkedInAccessToken(refreshToken: string): Promise<LinkedInTokenResponse> {
  const config = getLinkedInOAuthConfig()
  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const error = new Error(`LinkedIn token refresh failed: ${data?.error_description || data?.error || response.statusText}`) as Error & { httpStatus?: number }
    error.httpStatus = response.status
    throw error
  }

  if (!data || typeof data.access_token !== 'string') {
    throw new Error('LinkedIn token refresh returned an invalid response.')
  }

  return data as unknown as LinkedInTokenResponse
}

export async function revokeLinkedInToken(token: string): Promise<void> {
  const config = getLinkedInOAuthConfig()
  const response = await fetch('https://www.linkedin.com/oauth/v2/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to revoke LinkedIn token: ${await readLinkedInApiError(response)}`)
  }
}

export async function getLinkedInMemberProfile(accessToken: string): Promise<LinkedInOwnerInfo> {
  const response = await fetch(LINKEDIN_USERINFO_URL, {
    headers: linkedInHeaders(accessToken),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch LinkedIn member profile: ${await readLinkedInApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as LinkedInUserInfo | null
  if (!data?.sub) {
    throw new Error('LinkedIn member profile did not include a subject identifier.')
  }

  const localizedName = data.name || [data.given_name, data.family_name].filter(Boolean).join(' ').trim() || 'LinkedIn Member'
  return {
    ownerUrn: `urn:li:person:${data.sub}`,
    ownerType: 'member',
    localizedName,
    vanityName: data.sub,
    avatarUrl: data.picture || null,
    followerCount: 0,
  }
}

export function calculateLinkedInTokenExpiration(expiresIn?: number): Date | null {
  if (!expiresIn) return null
  return new Date(Date.now() + expiresIn * 1000)
}

export function scopesToArray(scope: string | undefined): string[] {
  return scope ? scope.split(/\s+/).filter(Boolean) : getLinkedInOAuthConfig().scopes
}

export function getLinkedInRestHeaders(accessToken: string, contentType = 'application/json'): Record<string, string> {
  return {
    ...linkedInHeaders(accessToken),
    'Content-Type': contentType,
  }
}
