import crypto from 'crypto'

import { callBroker, isBrokerEnabled } from '@/lib/oauth-broker/client'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'

export interface YouTubeOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
}

export interface YouTubeTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type: string
}

export interface YouTubeRefreshTokenResponse {
  access_token: string
  expires_in: number
  scope?: string
  token_type: string
}

export interface YouTubeChannelInfo {
  channelId: string
  title: string
  handle: string | null
  thumbnailUrl: string | null
  subscriberCount: number
  videoCount: number
  viewCount: number
}

export function getYouTubeOAuthConfig(): YouTubeOAuthConfig {
  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('YouTube OAuth configuration is incomplete. Please set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI.')
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
  }
}

export function generateYouTubePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

export function generateYouTubeState(userId: string): string {
  return `${crypto.randomBytes(16).toString('hex')}_${userId}`
}

export function buildYouTubeAuthorizationUrl(userId: string): {
  authUrl: string
  state: string
  codeVerifier: string
} {
  const config = getYouTubeOAuthConfig()
  const { codeVerifier, codeChallenge } = generateYouTubePKCE()
  const state = generateYouTubeState(userId)

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return {
    authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    state,
    codeVerifier,
  }
}

export async function exchangeYouTubeCodeForToken(code: string, codeVerifier?: string | null): Promise<YouTubeTokenResponse> {
  if (isBrokerEnabled()) return callBroker<YouTubeTokenResponse>('youtube', 'exchangeYouTubeCodeForToken', { code, codeVerifier })
  const config = getYouTubeOAuthConfig()
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  })

  if (codeVerifier) {
    body.set('code_verifier', codeVerifier)
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const message = typeof data?.error_description === 'string'
      ? data.error_description
      : typeof data?.error === 'string'
        ? data.error
        : await response.text().catch(() => 'Token exchange failed')
    throw new Error(`YouTube OAuth token exchange failed: ${message}`)
  }

  if (!data || typeof data.access_token !== 'string') {
    throw new Error('YouTube OAuth token exchange returned an invalid response.')
  }

  return data as unknown as YouTubeTokenResponse
}

export async function refreshYouTubeAccessToken(refreshToken: string): Promise<YouTubeRefreshTokenResponse> {
  if (isBrokerEnabled()) return callBroker<YouTubeRefreshTokenResponse>('youtube', 'refreshYouTubeAccessToken', { refreshToken })
  const config = getYouTubeOAuthConfig()
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const message = typeof data?.error_description === 'string'
      ? data.error_description
      : typeof data?.error === 'string'
        ? data.error
        : 'Refresh token request failed'
    throw new Error(`YouTube token refresh failed: ${message}`)
  }

  if (!data || typeof data.access_token !== 'string') {
    throw new Error('YouTube token refresh returned an invalid response.')
  }

  return data as unknown as YouTubeRefreshTokenResponse
}

export async function revokeYouTubeToken(token: string): Promise<void> {
  if (isBrokerEnabled()) { await callBroker<void>('youtube', 'revokeYouTubeToken', { token }); return }
  const response = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Failed to revoke YouTube token: ${errorText || response.statusText}`)
  }
}

export async function getMyYouTubeChannel(accessToken: string): Promise<YouTubeChannelInfo> {
  if (isBrokerEnabled()) return callBroker<YouTubeChannelInfo>('youtube', 'getMyYouTubeChannel', { accessToken })
  const params = new URLSearchParams({
    part: 'snippet,statistics,status',
    mine: 'true',
    maxResults: '1',
  })

  const response = await fetch(`${YOUTUBE_CHANNELS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const data = await response.json().catch(() => null) as any
  if (!response.ok) {
    const message = data?.error?.message || response.statusText
    throw new Error(`Failed to fetch YouTube channel: ${message}`)
  }

  const channel = data?.items?.[0]
  if (!channel?.id || !channel?.snippet?.title) {
    throw new Error('No YouTube channel found for this Google account.')
  }

  const statistics = channel.statistics || {}
  const thumbnails = channel.snippet.thumbnails || {}

  return {
    channelId: channel.id,
    title: channel.snippet.title,
    handle: channel.snippet.customUrl || null,
    thumbnailUrl: thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || null,
    subscriberCount: Number(statistics.subscriberCount || 0),
    videoCount: Number(statistics.videoCount || 0),
    viewCount: Number(statistics.viewCount || 0),
  }
}

export function calculateYouTubeTokenExpiration(expiresIn: number): Date {
  return new Date(Date.now() + expiresIn * 1000)
}

export function scopesToArray(scope: string | undefined): string[] {
  return scope ? scope.split(/\s+/).filter(Boolean) : getYouTubeOAuthConfig().scopes
}
