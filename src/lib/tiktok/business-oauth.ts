import crypto from 'crypto'

import { callBroker, isBrokerEnabled } from '@/lib/oauth-broker/client'

const TIKTOK_BUSINESS_AUTH_URL = 'https://business-api.tiktok.com/portal/auth'
const TIKTOK_BUSINESS_TOKEN_URL =
  'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/'
const TIKTOK_BUSINESS_REFRESH_URL =
  'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/refresh_token/'
const TIKTOK_BUSINESS_REVOKE_URL =
  'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/revoke/'
const TIKTOK_BUSINESS_TIMEOUT_MS = 20_000

export const TIKTOK_BUSINESS_COMMENT_SCOPES = [
  'comment.list',
  'comment.list.manage',
] as const

export interface TikTokBusinessToken {
  access_token: string
  refresh_token: string
  expires_in: number
  refresh_token_expires_in: number
  open_id: string
  scope: string
  token_type: string
}

export class TikTokBusinessRevocationError extends Error {
  readonly code: string
  readonly httpStatus: number
  readonly providerWriteOutcome: 'rejected' | 'unknown'

  constructor(
    code: string,
    httpStatus: number,
    providerWriteOutcome: 'rejected' | 'unknown',
  ) {
    super('TikTok Business comment authorization could not be revoked.')
    this.name = 'TikTokBusinessRevocationError'
    this.code = code
    this.httpStatus = httpStatus
    this.providerWriteOutcome = providerWriteOutcome
  }
}

interface TikTokBusinessApiResponse<T> {
  code?: unknown
  message?: unknown
  request_id?: unknown
  data?: T
}

export function getTikTokBusinessOAuthConfig() {
  const clientId = process.env.TIKTOK_BUSINESS_CLIENT_ID
  const clientSecret = process.env.TIKTOK_BUSINESS_CLIENT_SECRET
  const redirectUri = process.env.TIKTOK_BUSINESS_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'TikTok Business OAuth configuration is incomplete. Required: '
      + 'TIKTOK_BUSINESS_CLIENT_ID, TIKTOK_BUSINESS_CLIENT_SECRET, '
      + 'TIKTOK_BUSINESS_REDIRECT_URI.',
    )
  }

  return { clientId, clientSecret, redirectUri }
}

export function parseTikTokBusinessScopes(scope: string | null | undefined): string[] {
  return [...new Set(
    (scope || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )]
}

export function hasTikTokBusinessCommentScopes(scopes: string[]) {
  return scopes.includes('comment.list') && scopes.includes('comment.list.manage')
}

export function buildTikTokBusinessAuthorizationUrl(state: string) {
  const config = getTikTokBusinessOAuthConfig()
  const params = new URLSearchParams({
    app_id: config.clientId,
    scope: TIKTOK_BUSINESS_COMMENT_SCOPES.join(','),
    redirect_uri: config.redirectUri,
    state,
  })

  return `${TIKTOK_BUSINESS_AUTH_URL}?${params.toString()}`
}

export function generateTikTokBusinessState() {
  return crypto.randomBytes(32).toString('base64url')
}

function assertBusinessToken(value: unknown): TikTokBusinessToken {
  const token = value as Partial<TikTokBusinessToken> | null
  const accessToken = typeof token?.access_token === 'string' ? token.access_token.trim() : ''
  const refreshToken = typeof token?.refresh_token === 'string' ? token.refresh_token.trim() : ''
  const openId = typeof token?.open_id === 'string' ? token.open_id.trim() : ''
  if (
    !token
    || !accessToken
    || !refreshToken
    || !openId
    || !Number.isSafeInteger(token.expires_in)
    || Number(token.expires_in) <= 0
    || !Number.isSafeInteger(token.refresh_token_expires_in)
    || Number(token.refresh_token_expires_in) <= 0
    || typeof token.scope !== 'string'
    || token.token_type !== 'Bearer'
  ) {
    throw new Error('TikTok Business returned an invalid token response')
  }

  return {
    ...(token as TikTokBusinessToken),
    access_token: accessToken,
    refresh_token: refreshToken,
    open_id: openId,
    scope: token.scope.trim(),
    token_type: 'Bearer',
  }
}

async function postTikTokBusinessToken<T>(
  url: string,
  body: Record<string, string>,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIKTOK_BUSINESS_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`TikTok Business OAuth request failed with HTTP ${response.status}`)
  }

  const payload = await response.json().catch(() => null) as TikTokBusinessApiResponse<T> | null
  if (!payload || payload.code !== 0 || !payload.data) {
    const code = typeof payload?.code === 'number' ? payload.code : 'invalid_response'
    const message = typeof payload?.message === 'string' ? payload.message : 'OAuth request failed'
    throw new Error(`TikTok Business OAuth error ${code}: ${message}`)
  }

  return payload.data
}

export async function exchangeTikTokBusinessCodeForToken(
  authCode: string,
): Promise<TikTokBusinessToken> {
  if (isBrokerEnabled()) {
    return assertBusinessToken(await callBroker(
      'tiktok',
      'exchangeTikTokBusinessCodeForToken',
      { authCode },
      { timeoutMs: TIKTOK_BUSINESS_TIMEOUT_MS },
    ))
  }

  const config = getTikTokBusinessOAuthConfig()
  return assertBusinessToken(await postTikTokBusinessToken<TikTokBusinessToken>(
    TIKTOK_BUSINESS_TOKEN_URL,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      auth_code: authCode,
      redirect_uri: config.redirectUri,
    },
  ))
}

export async function refreshTikTokBusinessAccessToken(
  refreshToken: string,
): Promise<TikTokBusinessToken> {
  if (isBrokerEnabled()) {
    return assertBusinessToken(await callBroker(
      'tiktok',
      'refreshTikTokBusinessAccessToken',
      { refreshToken },
      { timeoutMs: TIKTOK_BUSINESS_TIMEOUT_MS },
    ))
  }

  const config = getTikTokBusinessOAuthConfig()
  return assertBusinessToken(await postTikTokBusinessToken<TikTokBusinessToken>(
    TIKTOK_BUSINESS_REFRESH_URL,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
  ))
}

export async function revokeTikTokBusinessAccessToken(accessToken: string): Promise<void> {
  if (isBrokerEnabled()) {
    await callBroker(
      'tiktok',
      'revokeTikTokBusinessAccessToken',
      { accessToken },
      { timeoutMs: TIKTOK_BUSINESS_TIMEOUT_MS },
    )
    return
  }

  const config = getTikTokBusinessOAuthConfig()
  let response: Response
  try {
    response = await fetch(TIKTOK_BUSINESS_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        access_token: accessToken,
      }),
      signal: AbortSignal.timeout(TIKTOK_BUSINESS_TIMEOUT_MS),
    })
  } catch {
    throw new TikTokBusinessRevocationError('provider_unreachable', 503, 'unknown')
  }

  const payload = await response.json().catch(() => null) as TikTokBusinessApiResponse<object> | null
  if (response.ok && payload?.code === 0 && payload.data && typeof payload.data === 'object') {
    return
  }

  const code = typeof payload?.code === 'number'
    ? String(payload.code)
    : response.ok
      ? 'invalid_response'
      : String(response.status)
  const outcome = response.status >= 400 && response.status < 500
    && ![408, 425, 429].includes(response.status)
    ? 'rejected'
    : 'unknown'
  throw new TikTokBusinessRevocationError(
    code,
    response.ok ? 502 : response.status,
    outcome,
  )
}

export function calculateTikTokBusinessExpiration(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString()
}
