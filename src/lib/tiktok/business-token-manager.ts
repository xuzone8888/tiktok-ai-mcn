import crypto from 'crypto'

import {
  calculateTikTokBusinessExpiration,
  hasTikTokBusinessCommentScopes,
  parseTikTokBusinessScopes,
  refreshTikTokBusinessAccessToken,
} from '@/lib/tiktok/business-oauth'

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const REFRESH_LEASE_SECONDS = 60

export interface TikTokBusinessCommentToken {
  accountId: string
  businessOpenId: string
  accountName: string
  accessToken: string
  scopes: string[]
}

export class TikTokBusinessTokenAccessError extends Error {
  code: string
  httpStatus: number
  retryable: boolean

  constructor(code: string, message: string, httpStatus: number, retryable = false) {
    super(message)
    this.name = 'TikTokBusinessTokenAccessError'
    this.code = code
    this.httpStatus = httpStatus
    this.retryable = retryable
  }
}

interface BusinessTokenRow {
  credential_generation: string
  business_open_id: string
  access_token: string
  refresh_token: string
  access_token_expires_at: string
  refresh_token_expires_at: string
  scopes: unknown
  status: string
}

function isFuture(value: string, bufferMs = 0) {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now() + bufferMs
}

function assertUsableTokenRow(row: BusinessTokenRow | null): BusinessTokenRow {
  const scopes = parseTikTokBusinessScopes(
    Array.isArray(row?.scopes) ? row.scopes.map(String).join(',') : '',
  )
  if (
    !row
    || row.status !== 'active'
    || !row.credential_generation?.trim()
    || !row.business_open_id?.trim()
    || !row.access_token?.trim()
    || !row.refresh_token?.trim()
    || !hasTikTokBusinessCommentScopes(scopes)
  ) {
    throw new TikTokBusinessTokenAccessError(
      'missing_comment_authorization',
      'TikTok comment authorization is missing or must be renewed.',
      403,
    )
  }
  if (!isFuture(row.refresh_token_expires_at)) {
    throw new TikTokBusinessTokenAccessError(
      'comment_authorization_expired',
      'TikTok comment authorization has expired. Please authorize it again.',
      403,
    )
  }
  return row
}

async function readBusinessToken(admin: any, accountId: string): Promise<BusinessTokenRow> {
  const { data, error } = await admin
    .from('tiktok_business_account_tokens')
    .select(
      'business_open_id, access_token, refresh_token, access_token_expires_at, '
      + 'refresh_token_expires_at, scopes, status, credential_generation',
    )
    .eq('account_id', accountId)
    .single()

  if (error || !data) {
    throw new TikTokBusinessTokenAccessError(
      'missing_comment_authorization',
      'TikTok comment authorization is missing. Authorize comments for this account first.',
      403,
    )
  }
  return assertUsableTokenRow(data as BusinessTokenRow)
}

function toContext(account: any, row: BusinessTokenRow): TikTokBusinessCommentToken {
  return {
    accountId: String(account.id),
    businessOpenId: row.business_open_id.trim(),
    accountName: String(account.display_name || account.username || 'TikTok account'),
    accessToken: row.access_token.trim(),
    scopes: parseTikTokBusinessScopes(
      Array.isArray(row.scopes) ? row.scopes.map(String).join(',') : '',
    ),
  }
}

async function readActiveNormalAccount(admin: any, userId: string, accountId: string) {
  const { data: account, error } = await admin
    .from('tiktok_accounts')
    .select('id, user_id, account_type, status, display_name, username')
    .eq('id', accountId)
    .eq('user_id', userId)
    .eq('account_type', 'normal')
    .single()

  if (error || !account) {
    throw new TikTokBusinessTokenAccessError(
      'account_not_found',
      'TikTok account not found or not accessible.',
      404,
    )
  }
  if (account.status !== 'active') {
    throw new TikTokBusinessTokenAccessError(
      'account_not_active',
      'TikTok publishing account must be active before comments can be synced.',
      403,
    )
  }
  return account
}

export async function getTikTokBusinessCommentToken(
  admin: any,
  userId: string,
  accountId: string,
): Promise<TikTokBusinessCommentToken> {
  const account = await readActiveNormalAccount(admin, userId, accountId)

  const current = await readBusinessToken(admin, accountId)
  if (isFuture(current.access_token_expires_at, ACCESS_TOKEN_REFRESH_BUFFER_MS)) {
    return toContext(account, current)
  }

  const leaseToken = crypto.randomUUID()
  const { data: claimed, error: claimError } = await admin.rpc(
    'claim_tiktok_business_token_refresh',
    {
      p_account_id: accountId,
      p_user_id: userId,
      p_expected_credential_generation: current.credential_generation,
      p_refresh_lease_token: leaseToken,
      p_lease_seconds: REFRESH_LEASE_SECONDS,
    },
  )
  if (claimError) {
    throw new TikTokBusinessTokenAccessError(
      'token_refresh_coordination_failed',
      'TikTok comment token refresh could not be coordinated.',
      503,
      true,
    )
  }

  if (claimed !== true) {
    const winner = await readBusinessToken(admin, accountId)
    if (isFuture(winner.access_token_expires_at, ACCESS_TOKEN_REFRESH_BUFFER_MS)) {
      const activeAccount = await readActiveNormalAccount(admin, userId, accountId)
      return toContext(activeAccount, winner)
    }
    throw new TikTokBusinessTokenAccessError(
      'token_refresh_in_progress',
      'TikTok comment authorization is being refreshed. Please retry shortly.',
      409,
      true,
    )
  }

  try {
    const refreshed = await refreshTikTokBusinessAccessToken(current.refresh_token)
    const scopes = parseTikTokBusinessScopes(refreshed.scope)
    if (
      refreshed.open_id !== current.business_open_id
      || !hasTikTokBusinessCommentScopes(scopes)
    ) {
      throw new TikTokBusinessTokenAccessError(
        'invalid_refreshed_identity',
        'TikTok returned a token for an unexpected Business identity or scope set.',
        502,
      )
    }

    const { data: committed, error: commitError } = await admin.rpc(
      'commit_tiktok_business_token_refresh',
      {
        p_account_id: accountId,
        p_user_id: userId,
        p_expected_credential_generation: current.credential_generation,
        p_refresh_lease_token: leaseToken,
        p_business_open_id: refreshed.open_id,
        p_access_token: refreshed.access_token,
        p_refresh_token: refreshed.refresh_token,
        p_access_token_expires_at: calculateTikTokBusinessExpiration(refreshed.expires_in),
        p_refresh_token_expires_at: calculateTikTokBusinessExpiration(
          refreshed.refresh_token_expires_in,
        ),
        p_scopes: scopes,
      },
    )
    if (commitError || committed !== true) {
      const winner = await readBusinessToken(admin, accountId)
      if (isFuture(winner.access_token_expires_at, ACCESS_TOKEN_REFRESH_BUFFER_MS)) {
        const activeAccount = await readActiveNormalAccount(admin, userId, accountId)
        return toContext(activeAccount, winner)
      }
      throw new TikTokBusinessTokenAccessError(
        'token_refresh_commit_failed',
        'TikTok comment token refresh result could not be persisted.',
        503,
        true,
      )
    }

    return {
      accountId,
      businessOpenId: refreshed.open_id,
      accountName: String(account.display_name || account.username || 'TikTok account'),
      accessToken: refreshed.access_token,
      scopes,
    }
  } catch (error) {
    const { error: releaseError } = await admin.rpc(
      'release_tiktok_business_token_refresh',
      {
        p_account_id: accountId,
        p_user_id: userId,
        p_refresh_lease_token: leaseToken,
      },
    )
    if (releaseError) {
      console.error('TikTok Business token refresh lease release failed')
    }
    if (error instanceof TikTokBusinessTokenAccessError) throw error
    throw new TikTokBusinessTokenAccessError(
      'token_refresh_failed',
      'TikTok comment authorization could not be refreshed.',
      503,
      true,
    )
  }
}
