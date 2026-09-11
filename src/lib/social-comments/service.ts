import { createHash, randomUUID } from 'node:crypto'

import { createAdminClient } from '@/lib/supabase/admin'
import { mergeActionLogMetadata } from '@/lib/social-comments/action-log'
import {
  assertFacebookRequiredPageScopes,
  calculateFacebookTokenExpiration,
  getGrantedFacebookScopes,
  getFacebookGrantedPermissions,
  getFacebookUserInfo,
  refreshFacebookPageAccessToken,
} from '@/lib/facebook/oauth'
import {
  calculateInstagramTokenExpiration,
  refreshInstagramAccountAccessToken,
} from '@/lib/instagram/oauth'
import {
  calculateYouTubeTokenExpiration,
  isYouTubeAuthorizationRevokedError,
  refreshYouTubeAccessToken,
  scopesToArray as youtubeScopesToArray,
} from '@/lib/youtube/oauth'
import {
  hasRequiredCommentScopes,
  INSTAGRAM_COMMENT_SYNC_LIMITS,
  listFacebookComments,
  listInstagramComments,
  listTikTokComments,
  listYouTubeComments,
  replyToFacebookComment,
  replyToInstagramComment,
  replyToTikTokComment,
  replyToYouTubeComment,
  SocialCommentApiError,
  SocialCommentUnsupportedError,
} from '@/lib/social-comments/platform-api'
import type {
  CommentFilters,
  CommentSyncTarget,
  ExternalSocialComment,
  SavedSocialComment,
  SocialAccountSummary,
  SocialContentItem,
  SocialPlatform,
} from '@/lib/social-comments/types'
import { normalizeScopes } from '@/lib/social-comments/types'
import { isSocialCommentRecentSyncAllowed } from '@/lib/social-comments/sync-request'
import { isSocialCommentReplyPlatformEnabled } from '@/lib/social-comments/reply-policy'
import {
  getSocialCommentPlatformCapabilities,
  isSocialCommentOperationSupported,
} from '@/lib/social-comments/platform-capabilities'
import type { SocialCommentSyncCompleteness } from '@/lib/social-comments/types'
import { resolveSocialCommentPersistence } from '@/lib/social-comments/persistence-policy'
import {
  getTikTokBusinessCommentToken,
  TikTokBusinessTokenAccessError,
} from '@/lib/tiktok/business-token-manager'
import {
  countUnicodeCodePoints,
  isTikTokCommentReplyWithinLimit,
  TIKTOK_COMMENT_REPLY_MAX_CODE_POINTS,
} from '@/lib/tiktok/comment-text'
import { getTikTokCommentReadLimits } from '@/lib/tiktok/business-comment-limits'

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const MAX_SYNC_TARGETS = 10
const REPLY_THROTTLE_MS = 10_000
const TIKTOK_REPLY_DISPATCH_STALE_MS = 60_000
const TIKTOK_REPLY_RECONCILE_WINDOW_MS = 2 * 60 * 1000
const SYNC_THROTTLE_MS = 60_000
const AUTO_SYNC_THROTTLE_MS = 5 * 60 * 1000
const TIKTOK_UNSUPPORTED_MESSAGE = 'TikTok Login Kit and Content Posting API do not provide creator comment reading or reply endpoints. Open the published TikTok content on TikTok to manage comments.'

type SyncSource = 'manual' | 'auto'

function replyMessageHash(message: string) {
  return createHash('sha256').update(message, 'utf8').digest('hex')
}

interface PlatformAccountToken {
  platform: SocialPlatform
  accountId: string
  accountExternalId: string
  accountName: string
  accessToken: string
  scopes: string[]
}

interface PlatformContentLookup {
  id: string
  external_content_id: string
  provider_comment_content_id: string
  account_id: string
  title: string | null
}

interface PlatformContentConfig {
  accountTable: string
  taskTable: string
  itemTable: string
  externalIdKey: string
  urlKey: string
  previewKey: string
  thumbnailKey?: string
  commentContentIdKey?: string
}

interface SyncOptions {
  idempotencyKey?: string
  source?: SyncSource
}

interface ReplyOptions {
  enabledPlatforms?: SocialPlatform[]
  instagramReplyEnabled?: boolean
  tiktokReplyEnabled?: boolean
}

interface RecentSyncTargetResult {
  contentId: string
  externalContentId: string
  status: 'completed' | 'failed' | 'throttled' | 'unsupported'
  syncedCount: number
  code?: string
  error?: string
  retryable?: boolean
  httpStatus?: number
  retryAfter?: string | null
}

interface RecentSyncResult {
  syncedCount: number
  completedCount: number
  failedCount: number
  results: RecentSyncTargetResult[]
}

const PLATFORM_CONTENT_CONFIG: Record<SocialPlatform, PlatformContentConfig> = {
  youtube: {
    accountTable: 'youtube_accounts',
    taskTable: 'youtube_publish_tasks',
    itemTable: 'youtube_publish_task_items',
    externalIdKey: 'youtube_video_id',
    urlKey: 'youtube_watch_url',
    previewKey: 'video_url',
    thumbnailKey: 'thumbnail_url',
  },
  tiktok: {
    accountTable: 'tiktok_accounts',
    taskTable: 'publish_tasks',
    itemTable: 'publish_task_items',
    externalIdKey: 'tiktok_video_id',
    urlKey: 'tiktok_share_id',
    previewKey: 'video_url',
  },
  instagram: {
    accountTable: 'instagram_accounts',
    taskTable: 'instagram_publish_tasks',
    itemTable: 'instagram_publish_task_items',
    externalIdKey: 'instagram_video_id',
    urlKey: 'instagram_watch_url',
    previewKey: 'video_url',
  },
  facebook: {
    accountTable: 'facebook_accounts',
    taskTable: 'facebook_publish_tasks',
    itemTable: 'facebook_publish_task_items',
    externalIdKey: 'facebook_video_id',
    urlKey: 'facebook_watch_url',
    previewKey: 'video_url',
  },
}

const SOCIAL_COMMENT_PLATFORM_ORDER: SocialPlatform[] = ['youtube', 'tiktok', 'instagram', 'facebook']

function shouldRefreshToken(expiresAt: string | null | undefined) {
  if (!expiresAt) return false
  const time = new Date(expiresAt).getTime()
  return Number.isFinite(time) && time <= Date.now() + TOKEN_REFRESH_BUFFER_MS
}

function mapApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof SocialCommentApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.httpStatus,
      unsupported: error instanceof SocialCommentUnsupportedError || error.code === 'needs_verification',
      retryable: error.retryable,
      httpStatus: error.httpStatus,
      retryAfter: error.retryAfter,
      providerWriteOutcome: error.providerWriteOutcome,
    }
  }

  return {
    code: 'internal_error',
    message: fallbackMessage,
    status: 500,
    unsupported: false,
    retryable: false,
    httpStatus: 500,
    retryAfter: null,
    providerWriteOutcome: null,
  }
}

function errorObservabilityMetadata(mapped: ReturnType<typeof mapApiError>) {
  return {
    retryable: mapped.retryable,
    httpStatus: mapped.httpStatus,
    retryAfter: mapped.retryAfter,
  }
}

function commentCapability(
  platform: SocialPlatform,
  scopes: string[],
  status: string,
  commentAuthorization?: {
    scopes: string[]
    status: string
    refreshTokenExpiresAt: string | null
  } | null,
): SocialAccountSummary['comment_capability'] {
  const capability = getSocialCommentPlatformCapabilities(platform)
  if (capability.read === 'unsupported') return 'unsupported'
  if (capability.read === 'needs_verification') return 'needs_verification'

  if (status !== 'active') {
    return 'needs_reconnect'
  }

  if (platform === 'tiktok') {
    if (
      commentAuthorization?.status !== 'active'
      || !commentAuthorization.scopes.includes('comment.list')
      || !commentAuthorization.refreshTokenExpiresAt
      || new Date(commentAuthorization.refreshTokenExpiresAt).getTime() <= Date.now()
    ) {
      return 'needs_reconnect'
    }
    return commentAuthorization.scopes.includes('comment.list.manage')
      ? 'ready'
      : 'read_only'
  }

  const canRead = hasRequiredCommentScopes(platform, 'read', scopes)
  const canReply = hasRequiredCommentScopes(platform, 'reply', scopes)
  if (canRead && canReply) return 'ready'
  if (canRead) return 'read_only'
  return 'needs_reconnect'
}

function buildAccountSummary(
  platform: SocialPlatform,
  row: any,
  externalIdKey: string,
  nameKey: string,
  handleKey: string | null,
  avatarKey: string,
  commentAuthorization?: {
    scopes: string[]
    status: string
    refreshTokenExpiresAt: string | null
  } | null,
): SocialAccountSummary {
  const scopes = normalizeScopes(row.scopes)
  const capability = commentCapability(
    platform,
    scopes,
    row.status || 'unknown',
    commentAuthorization,
  )
  return {
    id: row.id,
    platform,
    external_id: String(row[externalIdKey] || ''),
    name: String(row[nameKey] || 'Untitled account'),
    handle: handleKey ? row[handleKey] || null : null,
    avatar_url: row[avatarKey] || null,
    status: row.status || 'unknown',
    scopes,
    needs_reconnect_for_comments: capability === 'needs_reconnect',
    comment_capability: capability,
  }
}

function assertScopes(platform: Exclude<SocialPlatform, 'tiktok'>, operation: 'read' | 'reply', scopes: string[]) {
  if (!hasRequiredCommentScopes(platform, operation, scopes)) {
    throw new SocialCommentApiError(
      platform,
      'missing_comment_scope',
      `${platform} account is missing comment ${operation} permission. Please reconnect the account with the latest OAuth scopes.`,
      403,
      false
    )
  }
}

async function getYouTubeToken(admin: any, userId: string, accountId: string): Promise<PlatformAccountToken> {
  const { data: account, error } = await admin
    .from('youtube_accounts')
    .select('id, user_id, channel_id, channel_title, scopes, status, access_token_expires_at')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single()

  if (error || !account) {
    throw new SocialCommentApiError('youtube', 'account_not_found', 'YouTube account not found or not accessible.', 404)
  }
  if (account.status !== 'active') {
    throw new SocialCommentApiError('youtube', 'account_not_active', 'YouTube account must be reconnected before it can be used.', 403)
  }

  const { data: tokenRecord, error: tokenError } = await admin
    .from('youtube_account_tokens')
    .select('access_token, refresh_token, access_token_expires_at')
    .eq('account_id', accountId)
    .single()

  if (tokenError || !tokenRecord?.access_token) {
    throw new SocialCommentApiError('youtube', 'token_missing', 'YouTube authorization token is missing. Please reconnect the account.', 404)
  }

  let accessToken = tokenRecord.access_token
  let scopes = normalizeScopes(account.scopes)
  if (shouldRefreshToken(tokenRecord.access_token_expires_at || account.access_token_expires_at)) {
    let refreshed
    try {
      refreshed = await refreshYouTubeAccessToken(tokenRecord.refresh_token)
    } catch (refreshError) {
      if (isYouTubeAuthorizationRevokedError(refreshError)) {
        const { error: invalidationError } = await admin.rpc('mark_youtube_authorization_invalid', {
          p_user_id: userId,
          p_account_id: accountId,
        })
        if (invalidationError) {
          throw new Error(`Unable to record invalid YouTube authorization: ${invalidationError.message}`)
        }
      }
      throw refreshError
    }
    const expiresAt = calculateYouTubeTokenExpiration(refreshed.expires_in).toISOString()
    const verifiedAt = new Date().toISOString()
    accessToken = refreshed.access_token
    scopes = refreshed.scope ? youtubeScopesToArray(refreshed.scope) : scopes
    await Promise.all([
      admin
        .from('youtube_account_tokens')
        .update({
          access_token: accessToken,
          access_token_expires_at: expiresAt,
          updated_at: verifiedAt,
        })
        .eq('account_id', accountId),
      admin
        .from('youtube_accounts')
        .update({
          access_token_expires_at: expiresAt,
          scopes,
          status: 'active',
          last_authorization_verified_at: verifiedAt,
          authorization_invalidated_at: null,
          updated_at: verifiedAt,
        })
        .eq('id', accountId),
    ])
  }

  return {
    platform: 'youtube',
    accountId,
    accountExternalId: account.channel_id,
    accountName: account.channel_title,
    accessToken,
    scopes,
  }
}

async function getFacebookToken(admin: any, userId: string, accountId: string): Promise<PlatformAccountToken> {
  const { data: account, error } = await admin
    .from('facebook_accounts')
    .select('id, user_id, channel_id, channel_title, scopes, status, access_token_expires_at')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single()

  if (error || !account) {
    throw new SocialCommentApiError('facebook', 'account_not_found', 'Facebook account not found or not accessible.', 404)
  }
  if (account.status !== 'active') {
    throw new SocialCommentApiError('facebook', 'account_not_active', 'Facebook account must be reconnected before it can be used.', 403)
  }

  const { data: tokenRecord, error: tokenError } = await admin
    .from('facebook_account_tokens')
    .select('access_token, refresh_token, access_token_expires_at')
    .eq('account_id', accountId)
    .single()

  if (tokenError || !tokenRecord?.access_token) {
    throw new SocialCommentApiError('facebook', 'token_missing', 'Facebook authorization token is missing. Please reconnect the account.', 404)
  }

  let accessToken = tokenRecord.access_token
  let scopes = normalizeScopes(account.scopes)
  if (shouldRefreshToken(tokenRecord.access_token_expires_at || account.access_token_expires_at)) {
    const refreshed = await refreshFacebookPageAccessToken(tokenRecord.refresh_token, account.channel_id)
    const [facebookUser, permissions] = await Promise.all([
      getFacebookUserInfo(refreshed.user_access_token),
      getFacebookGrantedPermissions(refreshed.user_access_token),
    ])
    assertFacebookRequiredPageScopes(permissions)
    scopes = getGrantedFacebookScopes(permissions)
    const expiresAt = calculateFacebookTokenExpiration(refreshed.expires_in)?.toISOString() || null
    accessToken = refreshed.access_token
    await Promise.all([
      admin
        .from('facebook_account_tokens')
        .update({
          access_token: accessToken,
          refresh_token: refreshed.user_access_token,
          access_token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId),
      admin
        .from('facebook_accounts')
        .update({
          channel_title: refreshed.page.name,
          channel_handle: refreshed.page.category,
          thumbnail_url: refreshed.page.thumbnailUrl,
          subscriber_count: refreshed.page.followerCount,
          view_count: refreshed.page.fanCount,
          access_token_expires_at: expiresAt,
          authorized_by_facebook_user_id: facebookUser.id,
          scopes,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', accountId),
    ])
  }

  return {
    platform: 'facebook',
    accountId,
    accountExternalId: account.channel_id,
    accountName: account.channel_title,
    accessToken,
    scopes,
  }
}

async function getInstagramToken(admin: any, userId: string, accountId: string): Promise<PlatformAccountToken> {
  const { data: account, error } = await admin
    .from('instagram_accounts')
    .select('id, user_id, channel_id, channel_title, scopes, status, access_token_expires_at')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single()

  if (error || !account) {
    throw new SocialCommentApiError('instagram', 'account_not_found', 'Instagram account not found or not accessible.', 404)
  }
  if (account.status !== 'active') {
    throw new SocialCommentApiError('instagram', 'account_not_active', 'Instagram account must be reconnected before it can be used.', 403)
  }

  const { data: tokenRecord, error: tokenError } = await admin
    .from('instagram_account_tokens')
    .select('access_token, refresh_token, access_token_expires_at')
    .eq('account_id', accountId)
    .single()

  if (tokenError || !tokenRecord?.access_token) {
    throw new SocialCommentApiError('instagram', 'token_missing', 'Instagram authorization token is missing. Please reconnect the account.', 404)
  }

  let accessToken = tokenRecord.access_token
  const scopes = normalizeScopes(account.scopes)
  if (shouldRefreshToken(tokenRecord.access_token_expires_at || account.access_token_expires_at)) {
    const refreshed = await refreshInstagramAccountAccessToken(tokenRecord.refresh_token, account.channel_id)
    const expiresAt = calculateInstagramTokenExpiration(refreshed.expires_in)?.toISOString() || null
    accessToken = refreshed.access_token
    await Promise.all([
      admin
        .from('instagram_account_tokens')
        .update({
          access_token: accessToken,
          refresh_token: refreshed.user_access_token,
          access_token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId),
      admin
        .from('instagram_accounts')
        .update({
          channel_title: refreshed.account.name,
          channel_handle: `@${refreshed.account.username}`,
          thumbnail_url: refreshed.account.thumbnailUrl,
          subscriber_count: refreshed.account.followerCount,
          video_count: refreshed.account.mediaCount,
          access_token_expires_at: expiresAt,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', accountId),
    ])
  }

  return {
    platform: 'instagram',
    accountId,
    accountExternalId: account.channel_id,
    accountName: account.channel_title,
    accessToken,
    scopes,
  }
}

async function getPlatformToken(userId: string, platform: SocialPlatform, accountId: string): Promise<PlatformAccountToken> {
  const admin = createAdminClient() as any
  if (platform === 'youtube') return getYouTubeToken(admin, userId, accountId)
  if (platform === 'facebook') return getFacebookToken(admin, userId, accountId)
  if (platform === 'instagram') return getInstagramToken(admin, userId, accountId)
  try {
    const token = await getTikTokBusinessCommentToken(admin, userId, accountId)
    return {
      platform: 'tiktok',
      accountId: token.accountId,
      accountExternalId: token.businessOpenId,
      accountName: token.accountName,
      accessToken: token.accessToken,
      scopes: token.scopes,
    }
  } catch (error) {
    if (error instanceof TikTokBusinessTokenAccessError) {
      throw new SocialCommentApiError(
        'tiktok',
        error.code,
        error.message,
        error.httpStatus,
        error.retryable,
      )
    }
    throw new SocialCommentApiError(
      'tiktok',
      'missing_comment_authorization',
      'TikTok comment authorization failed.',
      403,
    )
  }
}

export async function getSocialCommentAccounts(
  userId: string,
  enabledPlatforms: SocialPlatform[] = SOCIAL_COMMENT_PLATFORM_ORDER
): Promise<SocialAccountSummary[]> {
  const admin = createAdminClient() as any
  const enabled = new Set(enabledPlatforms)
  const emptyResult = Promise.resolve({ data: [], error: null })
  const [youtube, tiktok, instagram, facebook] = await Promise.all([
    enabled.has('youtube')
      ? admin
        .from('youtube_accounts')
        .select('id, channel_id, channel_title, channel_handle, thumbnail_url, status, scopes')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      : emptyResult,
    enabled.has('tiktok')
      ? admin
        .from('tiktok_accounts')
        .select('id, open_id, username, display_name, avatar_url, status, scopes')
        .eq('user_id', userId)
        .eq('account_type', 'normal')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
      : emptyResult,
    enabled.has('instagram')
      ? admin
        .from('instagram_accounts')
        .select('id, channel_id, channel_title, channel_handle, thumbnail_url, status, scopes')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      : emptyResult,
    enabled.has('facebook')
      ? admin
        .from('facebook_accounts')
        .select('id, channel_id, channel_title, channel_handle, thumbnail_url, status, scopes')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      : emptyResult,
  ])

  for (const result of [youtube, tiktok, instagram, facebook]) {
    if (result.error) {
      throw new Error(result.error.message)
    }
  }

  const tiktokAccountIds = (tiktok.data || []).map((row: any) => row.id).filter(Boolean)
  let tiktokAuthorizationByAccount = new Map<string, {
    scopes: string[]
    status: string
    refreshTokenExpiresAt: string | null
  }>()
  if (tiktokAccountIds.length > 0) {
    const { data: authorizations, error: authorizationError } = await admin
      .from('tiktok_business_account_tokens')
      .select('account_id, scopes, status, refresh_token_expires_at')
      .in('account_id', tiktokAccountIds)

    if (authorizationError) throw new Error(authorizationError.message)
    tiktokAuthorizationByAccount = new Map(
      (authorizations || []).map((row: any) => [
        String(row.account_id),
        {
          scopes: normalizeScopes(row.scopes),
          status: String(row.status || 'unknown'),
          refreshTokenExpiresAt: row.refresh_token_expires_at || null,
        },
      ]),
    )
  }

  return [
    ...(youtube.data || []).map((row: any) => buildAccountSummary('youtube', row, 'channel_id', 'channel_title', 'channel_handle', 'thumbnail_url')),
    ...(tiktok.data || []).map((row: any) => buildAccountSummary(
      'tiktok',
      row,
      'open_id',
      'display_name',
      'username',
      'avatar_url',
      tiktokAuthorizationByAccount.get(String(row.id)) || null,
    )),
    ...(instagram.data || []).map((row: any) => buildAccountSummary('instagram', row, 'channel_id', 'channel_title', 'channel_handle', 'thumbnail_url')),
    ...(facebook.data || []).map((row: any) => buildAccountSummary('facebook', row, 'channel_id', 'channel_title', 'channel_handle', 'thumbnail_url')),
  ]
}

async function getOwnedAccountIds(
  admin: any,
  config: PlatformContentConfig,
  userId: string,
  accountId?: string
): Promise<Set<string>> {
  let query = admin
    .from(config.accountTable)
    .select('id')
    .eq('user_id', userId)

  if (accountId) query = query.eq('id', accountId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return new Set((data || []).map((row: any) => row.id).filter(Boolean))
}

function contentItemSelect(config: PlatformContentConfig, includeThumbnail = true) {
  const optional = includeThumbnail && config.thumbnailKey ? `, ${config.thumbnailKey}` : ''
  const commentContentId = config.commentContentIdKey ? `, ${config.commentContentIdKey}` : ''
  return `id, task_id, account_id, title, source_video_name, ${config.externalIdKey}${commentContentId}, ${config.urlKey}, ${config.previewKey}${optional}, published_at, status`
}

function isMissingOptionalContentColumn(error: any, column: string | undefined) {
  if (!column || !error) return false
  const message = String(error.message || '').toLowerCase()
  const code = String(error.code || '')
  return message.includes(column.toLowerCase())
    && (code === '42703' || code === 'PGRST204' || message.includes('does not exist'))
}

function queryPublishedContentItems(
  admin: any,
  config: PlatformContentConfig,
  accountIds: string[],
  limit: number,
  includeThumbnail: boolean
) {
  return admin
    .from(config.itemTable)
    .select(contentItemSelect(config, includeThumbnail))
    .in('account_id', accountIds)
    .eq('status', 'published')
    .not(config.externalIdKey, 'is', null)
    .neq(config.externalIdKey, '')
    .order('published_at', { ascending: false })
    .limit(limit)
}

function mapContentRows(
  platform: SocialPlatform,
  rows: any[],
  externalIdKey: string,
  urlKey: string,
  previewKey: string,
  thumbnailKey: string | undefined,
  taskNames: Map<string, string | null>
): SocialContentItem[] {
  const normalizeContentUrl = (value: unknown) => {
    const url = typeof value === 'string' ? value.trim() : ''
    if (!url) return null
    if (platform === 'facebook' && url.startsWith('/')) return `https://www.facebook.com${url}`
    if (platform === 'tiktok' && !/^https?:\/\//i.test(url)) return null
    return url
  }

  return rows
    .filter((row) => row?.[externalIdKey])
    .map((row) => ({
      id: row.id,
      platform,
      account_id: row.account_id,
      external_content_id: String(row[externalIdKey]),
      title: row.title || row.source_video_name || row[externalIdKey],
      url: normalizeContentUrl(row[urlKey]),
      preview_url: row[previewKey] || null,
      thumbnail_url: thumbnailKey ? row[thumbnailKey] || null : null,
      published_at: row.published_at || null,
      task_name: taskNames.get(row.task_id) || null,
    }))
}

async function getPlatformSocialContent(
  admin: any,
  userId: string,
  platform: SocialPlatform,
  filters: { accountId?: string; limit: number }
): Promise<SocialContentItem[]> {
  const config = PLATFORM_CONTENT_CONFIG[platform]
  const accountIds = await getOwnedAccountIds(admin, config, userId, filters.accountId)
  if (accountIds.size === 0) return []

  const accountIdList = [...accountIds]
  let { data, error } = await queryPublishedContentItems(
    admin,
    config,
    accountIdList,
    filters.limit,
    true
  )

  // Older YouTube task tables predate the optional thumbnail column. Keep
  // comment management usable while that additive migration rolls out.
  if (error && isMissingOptionalContentColumn(error, config.thumbnailKey)) {
    const fallback = await queryPublishedContentItems(
      admin,
      config,
      accountIdList,
      filters.limit,
      false
    )
    data = fallback.data
    error = fallback.error
  }

  if (error) throw new Error(error.message)
  const rows = data || []
  const taskIds = [...new Set(rows.map((row: any) => row.task_id).filter(Boolean))]
  if (taskIds.length === 0) return []

  const { data: ownedTasks, error: taskError } = await admin
    .from(config.taskTable)
    .select('id, task_name')
    .eq('user_id', userId)
    .in('id', taskIds)

  if (taskError) throw new Error(taskError.message)
  const taskNames = new Map<string, string | null>(
    (ownedTasks || []).map((task: any): [string, string | null] => [String(task.id), task.task_name || null])
  )
  const ownedRows = rows.filter((row: any) => taskNames.has(row.task_id))
  return mapContentRows(
    platform,
    ownedRows,
    config.externalIdKey,
    config.urlKey,
    config.previewKey,
    config.thumbnailKey,
    taskNames
  )
}

export async function getSocialCommentContent(
  userId: string,
  filters: { platform?: SocialPlatform | 'all'; accountId?: string; limit?: number }
): Promise<SocialContentItem[]> {
  const admin = createAdminClient() as any
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 200)
  const platform = filters.platform || 'all'
  const platforms = platform === 'all' ? SOCIAL_COMMENT_PLATFORM_ORDER : [platform]
  const results = (await Promise.all(
    platforms.map((item) => getPlatformSocialContent(admin, userId, item, {
      accountId: filters.accountId,
      limit,
    }))
  )).flat()

  return results
    .sort((left, right) => new Date(right.published_at || 0).getTime() - new Date(left.published_at || 0).getTime())
    .slice(0, limit)
}

async function getOwnedTaskNameForTaskId(
  admin: any,
  config: PlatformContentConfig,
  userId: string,
  taskId: string
): Promise<string | null | undefined> {
  const { data, error } = await admin
    .from(config.taskTable)
    .select('id, task_name')
    .eq('id', taskId)
    .eq('user_id', userId)
    .limit(1)

  if (error) throw new Error(error.message)
  const task = Array.isArray(data) ? data[0] : null
  if (!task) return undefined
  return task.task_name || null
}

async function queryPublishedTaskItemsByField(
  admin: any,
  config: PlatformContentConfig,
  accountId: string,
  field: string,
  value: string
): Promise<any[]> {
  if (!value) return []
  const commentContentId = config.commentContentIdKey ? `, ${config.commentContentIdKey}` : ''
  const ownershipSelect = `id, task_id, account_id, title, source_video_name, ${config.externalIdKey}${commentContentId}`
  const { data, error } = await admin
    .from(config.itemTable)
    .select(ownershipSelect)
    .eq(field, value)
    .eq('account_id', accountId)
    .eq('status', 'published')
    .not(config.externalIdKey, 'is', null)
    .neq(config.externalIdKey, '')

  if (error) throw new Error(error.message)
  return data || []
}

async function findOwnedPublishedContent(
  admin: any,
  userId: string,
  platform: SocialPlatform,
  accountId: string,
  contentId: string
): Promise<PlatformContentLookup> {
  const config = PLATFORM_CONTENT_CONFIG[platform]
  const accountIds = await getOwnedAccountIds(admin, config, userId, accountId)
  if (accountIds.size === 0) {
    throw new SocialCommentApiError(platform, 'account_not_found', 'Account not found or not accessible.', 404)
  }

  const rowsById = await queryPublishedTaskItemsByField(admin, config, accountId, 'id', contentId)
  const rowsByExternalId = await queryPublishedTaskItemsByField(admin, config, accountId, config.externalIdKey, contentId)
  const seen = new Set<string>()
  const rows = [...rowsById, ...rowsByExternalId].filter((row) => {
    if (!row?.id || seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })

  for (const row of rows) {
    const taskName = await getOwnedTaskNameForTaskId(admin, config, userId, row.task_id)
    if (taskName !== undefined) {
      return {
        id: row.id,
        external_content_id: String(row[config.externalIdKey]),
        provider_comment_content_id: String(
          (config.commentContentIdKey ? row[config.commentContentIdKey] : null) || row[config.externalIdKey]
        ),
        account_id: row.account_id,
        title: row.title || row.source_video_name || row[config.externalIdKey] || null,
      }
    }
  }

  throw new SocialCommentApiError(platform, 'content_not_found', 'Published content not found or not accessible.', 404)
}

async function findContentForTarget(userId: string, target: CommentSyncTarget): Promise<PlatformContentLookup> {
  const admin = createAdminClient() as any
  return findOwnedPublishedContent(admin, userId, target.platform, target.accountId, target.contentId)
}

function mapSavedComment(row: any): SavedSocialComment {
  return {
    id: row.id,
    user_id: row.user_id,
    platform: row.platform,
    account_id: row.account_id,
    task_item_id: row.task_item_id,
    external_comment_id: row.external_comment_id,
    external_content_id: row.external_content_id,
    parent_external_comment_id: row.parent_external_comment_id,
    thread_external_id: row.thread_external_id,
    direction: row.direction,
    author_id: row.author_id,
    author_name: row.author_name,
    author_avatar_url: row.author_avatar_url,
    message: row.message,
    like_count: Number(row.like_count || 0),
    reply_count: Number(row.reply_count || 0),
    can_reply: Boolean(row.can_reply),
    is_from_account: Boolean(row.is_from_account),
    permalink: row.permalink,
    status: row.status,
    metadata: row.metadata || {},
    remote_created_at: row.remote_created_at,
    local_error_code: row.local_error_code,
    local_error_message: row.local_error_message,
    reply_to_comment_id: row.reply_to_comment_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function nestReplies(comments: SavedSocialComment[]): SavedSocialComment[] {
  const byExternalId = new Map<string, SavedSocialComment>()
  for (const comment of comments) {
    comment.replies = []
    byExternalId.set(comment.external_comment_id, comment)
  }

  const roots: SavedSocialComment[] = []
  for (const comment of comments) {
    if (comment.parent_external_comment_id) {
      const parent = byExternalId.get(comment.parent_external_comment_id)
      if (parent) {
        parent.replies?.push(comment)
        continue
      }
    }
    roots.push(comment)
  }

  return roots
}

export async function getSavedSocialComments(userId: string, filters: CommentFilters): Promise<{
  comments: SavedSocialComment[]
  total: number | null
  loadedCount: number
}> {
  const admin = createAdminClient() as any
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 200)
  const offset = Math.max(Number(filters.offset || 0), 0)
  let query = admin
    .from('social_comments')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('remote_created_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filters.platform && filters.platform !== 'all') query = query.eq('platform', filters.platform)
  if (filters.accountId) query = query.eq('account_id', filters.accountId)
  if (filters.contentId) query = query.eq('external_content_id', filters.contentId)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  const rows = data || []
  return {
    comments: nestReplies(rows.map(mapSavedComment)),
    total: count ?? null,
    loadedCount: rows.length,
  }
}

async function upsertComments(
  userId: string,
  platform: SocialPlatform,
  accountId: string,
  taskItemId: string | null,
  comments: ExternalSocialComment[],
  direction: 'inbound' | 'outbound' = 'inbound',
  status: 'synced' | 'sent' = direction === 'inbound' ? 'synced' : 'sent',
  replyToCommentId?: string | null
): Promise<SavedSocialComment[]> {
  if (comments.length === 0) return []
  const admin = createAdminClient() as any
  const now = new Date().toISOString()
  const externalCommentIds = [...new Set(comments.map((comment) => comment.external_comment_id).filter(Boolean))]
  const { data: existingRows, error: existingError } = await admin
    .from('social_comments')
    .select('external_comment_id, direction, status, reply_to_comment_id, can_reply, is_from_account')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('account_id', accountId)
    .in('external_comment_id', externalCommentIds)

  if (existingError) throw new Error(existingError.message)
  const existingByExternalId = new Map<string, any>(
    (existingRows || []).map((row: any) => [String(row.external_comment_id), row])
  )

  const rows = comments.map((comment) => {
    const existing = existingByExternalId.get(comment.external_comment_id)
    const persistence = resolveSocialCommentPersistence(
      comment,
      direction,
      status,
      replyToCommentId || null,
      existing
    )

    return ({
    user_id: userId,
    platform,
    account_id: accountId,
    task_item_id: taskItemId,
    external_content_id: comment.external_content_id,
    external_comment_id: comment.external_comment_id,
    parent_external_comment_id: comment.parent_external_comment_id,
    thread_external_id: comment.thread_external_id,
    direction: persistence.direction,
    author_id: comment.author_id,
    author_name: comment.author_name,
    author_avatar_url: comment.author_avatar_url,
    message: comment.message,
    like_count: comment.like_count,
    reply_count: comment.reply_count,
    can_reply: persistence.can_reply,
    is_from_account: persistence.is_from_account,
    permalink: comment.permalink,
    status: persistence.status,
    metadata: comment.metadata || {},
    remote_created_at: comment.remote_created_at,
    last_synced_at: now,
    reply_to_comment_id: persistence.reply_to_comment_id,
    updated_at: now,
    })
  })

  const { data, error } = await admin
    .from('social_comments')
    .upsert(rows, { onConflict: 'user_id,platform,account_id,external_comment_id' })
    .select('*')

  if (error) throw new Error(error.message)
  return (data || []).map(mapSavedComment)
}

async function insertSyncRun(userId: string, target: CommentSyncTarget, externalContentId?: string) {
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('social_comment_sync_runs')
    .insert({
      user_id: userId,
      platform: target.platform,
      account_id: target.accountId,
      external_content_id: externalContentId || target.contentId,
      status: 'running',
      metadata: {
        requested_content_id: target.contentId,
      },
    })
    .select('id')
    .single()
  return data?.id as string | undefined
}

async function completeSyncRun(
  runId: string | undefined,
  status: 'completed' | 'failed' | 'unsupported',
  syncedCount: number,
  errorCode?: string,
  errorMessage?: string,
  metadata?: Record<string, unknown>
) {
  if (!runId) return
  const admin = createAdminClient() as any
  await admin
    .from('social_comment_sync_runs')
    .update({
      status,
      synced_count: syncedCount,
      error_code: errorCode || null,
      error_message: errorMessage || null,
      metadata: metadata || {},
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
}

async function readTikTokCommentResumeState(
  admin: any,
  userId: string,
  accountId: string,
  externalContentId: string,
): Promise<{
  topLevelCursor: number | null
  replyResume: {
    parent_ids: string[]
    observed_parent_ids: string[]
    cursor: number | null
  } | null
}> {
  try {
    const { data, error } = await admin
      .from('social_comment_sync_runs')
      .select('metadata')
      .eq('user_id', userId)
      .eq('platform', 'tiktok')
      .eq('account_id', accountId)
      .eq('external_content_id', externalContentId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return { topLevelCursor: null, replyResume: null }
    const value = data?.metadata?.provider_resume_cursor
    const rawReplyResume = data?.metadata?.provider_reply_resume
    const parentIds = Array.isArray(rawReplyResume?.parent_ids)
      ? rawReplyResume.parent_ids.filter(
        (item: unknown): item is string => typeof item === 'string' && item.length > 0,
      ).slice(0, 500)
      : []
    const rawReplyCursor = rawReplyResume?.cursor
    const observedParentIds = Array.isArray(rawReplyResume?.observed_parent_ids)
      ? rawReplyResume.observed_parent_ids.filter(
        (item: unknown): item is string => typeof item === 'string' && item.length > 0,
      ).slice(0, 500)
      : parentIds
    const replyCursor = rawReplyCursor === null
      ? null
      : Number.isSafeInteger(rawReplyCursor) && rawReplyCursor >= 0
      ? rawReplyCursor
      : undefined
    return {
      topLevelCursor: Number.isSafeInteger(value) && value >= 0 ? value : null,
      replyResume: parentIds.length > 0 && replyCursor !== undefined
        ? {
          parent_ids: parentIds,
          observed_parent_ids: observedParentIds,
          cursor: replyCursor,
        }
        : null,
    }
  } catch {
    return { topLevelCursor: null, replyResume: null }
  }
}

async function insertActionLog(
  admin: any,
  input: {
    userId: string
    platform: SocialPlatform
    accountId?: string | null
    externalContentId?: string | null
    externalCommentId?: string | null
    actionType: 'sync' | 'reply' | 'permission_error' | 'token_error'
    status?: 'running' | 'sent' | 'completed' | 'failed' | 'unsupported'
    idempotencyKey?: string | null
    errorCode?: string | null
    errorMessage?: string | null
    metadata?: Record<string, unknown>
  }
) {
  const { data, error } = await admin
    .from('social_comment_action_logs')
    .insert({
      user_id: input.userId,
      platform: input.platform,
      account_id: input.accountId || null,
      external_content_id: input.externalContentId || null,
      external_comment_id: input.externalCommentId || null,
      action_type: input.actionType,
      status: input.status || 'running',
      idempotency_key: input.idempotencyKey || null,
      error_code: input.errorCode || null,
      error_message: input.errorMessage || null,
      metadata: input.metadata || {},
      completed_at: input.status && input.status !== 'running' ? new Date().toISOString() : null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

async function completeActionLog(
  admin: any,
  logId: string | undefined,
  userId: string,
  status: 'sent' | 'completed' | 'failed' | 'unsupported' | 'unknown',
  input: {
    errorCode?: string | null
    errorMessage?: string | null
    metadata?: Record<string, unknown>
    fromStatuses?: Array<'running' | 'sent' | 'unknown' | 'failed' | 'unsupported'>
  } = {}
) {
  if (!logId) return false
  const { data: existing, error: readError } = await admin
    .from('social_comment_action_logs')
    .select('metadata')
    .eq('id', logId)
    .eq('user_id', userId)
    .maybeSingle()

  if (readError) throw readError

  let updateQuery = admin
    .from('social_comment_action_logs')
    .update({
      status,
      error_code: input.errorCode || null,
      error_message: input.errorMessage || null,
      metadata: mergeActionLogMetadata(existing?.metadata, input.metadata),
      completed_at: new Date().toISOString(),
    })
    .eq('id', logId)
    .eq('user_id', userId)
  const fromStatuses = input.fromStatuses
    || (status === 'sent' ? ['running', 'sent'] as const : null)
  if (fromStatuses) {
    updateQuery = updateQuery.in('status', [...fromStatuses])
  }
  if (input.fromStatuses) {
    const { data: updated, error: updateError } = await updateQuery
      .select('id')
      .maybeSingle()
    if (updateError) throw updateError
    return Boolean(updated)
  }
  const { error: updateError } = await updateQuery

  if (updateError) throw updateError
  return true
}

async function transitionTikTokReplyAction(
  admin: any,
  userId: string,
  actionLogId: string,
  replyAttemptToken: string,
  fromStatuses: Array<'running' | 'sent' | 'failed' | 'unsupported' | 'unknown'>,
  toStatus: 'sent' | 'failed' | 'unsupported' | 'unknown',
  input: {
    errorCode?: string | null
    errorMessage?: string | null
    metadata?: Record<string, unknown>
  } = {},
) {
  const { data, error } = await admin.rpc('transition_tiktok_reply_action', {
    p_user_id: userId,
    p_action_log_id: actionLogId,
    p_reply_attempt_token: replyAttemptToken,
    p_from_statuses: fromStatuses,
    p_to_status: toStatus,
    p_error_code: input.errorCode || null,
    p_error_message: input.errorMessage || null,
    p_metadata: input.metadata || {},
  })
  if (error) throw error
  return data === true
}

async function logCommentErrorAction(
  admin: any,
  userId: string,
  platform: SocialPlatform,
  actionType: 'permission_error' | 'token_error',
  input: {
    accountId?: string | null
    externalContentId?: string | null
    externalCommentId?: string | null
    errorCode: string
    errorMessage: string
  }
) {
  await insertActionLog(admin, {
    userId,
    platform,
    accountId: input.accountId,
    externalContentId: input.externalContentId,
    externalCommentId: input.externalCommentId,
    actionType,
    status: 'failed',
    idempotencyKey: `${actionType}:${platform}:${input.accountId || 'none'}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  }).catch(() => null)
}

function syncWindowBucket(throttleMs: number) {
  return Math.floor(Date.now() / throttleMs)
}

function normalizeOptionalIdempotencyKey(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function buildSyncActionKey(
  scope: 'target' | 'recent',
  platform: SocialPlatform,
  accountId: string,
  externalContentId: string | null,
  source: SyncSource,
  throttleMs: number
) {
  return `sync:${source}:${scope}:${platform}:${accountId}:${externalContentId || 'recent'}:${syncWindowBucket(throttleMs)}`
}

async function getSyncActionLogByKey(admin: any, userId: string, idempotencyKey: string) {
  const { data, error } = await admin
    .from('social_comment_action_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('action_type', 'sync')
    .eq('idempotency_key', idempotencyKey)
    .limit(1)

  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data[0] : null
}

async function findRecentSyncActionLog(
  admin: any,
  input: {
    userId: string
    platform: SocialPlatform
    accountId: string
    externalContentId: string | null
    throttleMs: number
  }
) {
  const since = new Date(Date.now() - input.throttleMs).toISOString()
  let query = admin
    .from('social_comment_action_logs')
    .select('id, status, created_at')
    .eq('user_id', input.userId)
    .eq('platform', input.platform)
    .eq('account_id', input.accountId)
    .eq('action_type', 'sync')
    .in('status', ['running', 'completed', 'failed', 'unsupported'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)

  query = input.externalContentId
    ? query.eq('external_content_id', input.externalContentId)
    : query.is('external_content_id', null)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data[0] : null
}

function throwSyncThrottle(platform: SocialPlatform, existing: any): never {
  if (existing?.status === 'running') {
    throw new SocialCommentApiError(platform, 'sync_already_running', 'The same sync is already running. Check again shortly.', 409)
  }
  throw new SocialCommentApiError(platform, 'sync_throttled', 'Sync was requested too recently. Please wait before trying again.', 429)
}

async function resetExistingSyncActionLog(
  admin: any,
  userId: string,
  logId: string,
  metadata: Record<string, unknown>
) {
  const { data, error } = await admin
    .from('social_comment_action_logs')
    .update({
      status: 'running',
      error_code: null,
      error_message: null,
      metadata,
      created_at: new Date().toISOString(),
      completed_at: null,
    })
    .eq('id', logId)
    .eq('user_id', userId)
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return data?.id as string
}

async function startSyncActionLog(
  admin: any,
  input: {
    userId: string
    platform: SocialPlatform
    accountId: string
    externalContentId: string | null
    scope: 'target' | 'recent'
    requestedContentId?: string | null
    idempotencyKey?: string
    source?: SyncSource
  }
): Promise<string> {
  const source = input.source || 'manual'
  const throttleMs = source === 'auto' ? AUTO_SYNC_THROTTLE_MS : SYNC_THROTTLE_MS
  const existing = await findRecentSyncActionLog(admin, { ...input, throttleMs })
  if (existing) throwSyncThrottle(input.platform, existing)

  const actionKey = buildSyncActionKey(input.scope, input.platform, input.accountId, input.externalContentId, source, throttleMs)
  const metadata = {
    sync_scope: input.scope,
    sync_source: source,
    requested_content_id: input.requestedContentId || null,
    client_idempotency_key: normalizeOptionalIdempotencyKey(input.idempotencyKey),
    throttle_ms: throttleMs,
  }

  try {
    const log = await insertActionLog(admin, {
      userId: input.userId,
      platform: input.platform,
      accountId: input.accountId,
      externalContentId: input.externalContentId,
      actionType: 'sync',
      idempotencyKey: actionKey,
      metadata,
    })
    return log.id
  } catch (error: any) {
    if (error?.code !== '23505') throw error

    const existingByKey = await getSyncActionLogByKey(admin, input.userId, actionKey)
    if (!existingByKey) {
      throw new SocialCommentApiError(input.platform, 'sync_already_running', 'The same sync is already running. Check again shortly.', 409)
    }
    if (existingByKey.status === 'running' || existingByKey.status === 'completed') {
      throwSyncThrottle(input.platform, existingByKey)
    }
    return resetExistingSyncActionLog(admin, input.userId, existingByKey.id, metadata)
  }
}

export async function syncSocialComments(userId: string, target: CommentSyncTarget, options: SyncOptions = {}): Promise<{
  comments: SavedSocialComment[]
  syncedCount: number
} & SocialCommentSyncCompleteness> {
  const admin = createAdminClient() as any
  const syncSource = options.source || 'manual'
  const throttleMs = syncSource === 'auto' ? AUTO_SYNC_THROTTLE_MS : SYNC_THROTTLE_MS
  let actionLogId: string | undefined
  let runId: string | undefined
  let content: PlatformContentLookup | null = null
  try {
    const capability = getSocialCommentPlatformCapabilities(target.platform)
    if (!isSocialCommentOperationSupported(target.platform, 'sync')) {
      throw new SocialCommentUnsupportedError(target.platform, TIKTOK_UNSUPPORTED_MESSAGE)
    }
    content = await findContentForTarget(userId, target)
    actionLogId = await startSyncActionLog(admin, {
      userId,
      platform: target.platform,
      accountId: target.accountId,
      externalContentId: content.external_content_id,
      scope: 'target',
      requestedContentId: target.contentId,
      idempotencyKey: options.idempotencyKey,
      source: syncSource,
    })
    runId = await insertSyncRun(userId, target, content.external_content_id)
    let comments: ExternalSocialComment[]
    let truncated = false
    let repliesFetched = false
    let threadCompleteness: SocialCommentSyncCompleteness['thread_completeness'] = 'unknown'
    let syncMetadata: Record<string, unknown> = {
      sync_source: syncSource,
      throttle_ms: throttleMs,
      requested_content_id: target.contentId,
      external_content_id: content.external_content_id,
    }

    if (target.platform === 'youtube') {
      const token = await getPlatformToken(userId, target.platform, target.accountId)
      assertScopes('youtube', 'read', token.scopes)
      const result = await listYouTubeComments(token, content.external_content_id)
      comments = result.comments
      truncated = result.truncated
      repliesFetched = result.replies_fetched
      threadCompleteness = result.thread_completeness
      syncMetadata = {
        ...syncMetadata,
        top_level_limit: 500,
        truncated,
      }
    } else if (target.platform === 'tiktok') {
      const token = await getPlatformToken(userId, target.platform, target.accountId)
      const limits = getTikTokCommentReadLimits()
      const resumeState = await readTikTokCommentResumeState(
        admin,
        userId,
        target.accountId,
        content.external_content_id,
      )
      const [topLevelReservation, replyReservation] = await Promise.all([
        admin.rpc('claim_tiktok_business_api_budget', {
          p_account_id: target.accountId,
          p_user_id: userId,
          p_endpoint: 'comment.list',
          p_requested_requests: limits.topLevelRequestBudget,
          p_window_limit: limits.perEndpointRequestsPerMinute,
        }),
        admin.rpc('claim_tiktok_business_api_budget', {
          p_account_id: target.accountId,
          p_user_id: userId,
          p_endpoint: 'comment.reply.list',
          p_requested_requests: limits.replyRequestBudget,
          p_window_limit: limits.perEndpointRequestsPerMinute,
        }),
      ])
      if (
        topLevelReservation.error
        || replyReservation.error
        || topLevelReservation.data !== true
        || replyReservation.data !== true
      ) {
        throw new SocialCommentApiError(
          'tiktok',
          'comment_read_rate_limited',
          'TikTok comment synchronization is temporarily rate limited. Try again after the current window.',
          429,
          true,
          '60',
        )
      }
      const result = await listTikTokComments(token, content.external_content_id, {
        topLevelRequests: limits.topLevelRequestBudget,
        replyRequests: limits.replyRequestBudget,
        resumeCursor: resumeState.topLevelCursor,
        replyResume: resumeState.replyResume,
      })
      comments = result.comments
      truncated = result.truncated
      repliesFetched = result.replies_fetched
      threadCompleteness = result.thread_completeness
      syncMetadata = {
        ...syncMetadata,
        pagination_complete: !result.truncated,
        replies_fetched: result.replies_fetched,
        provider_raw_count: result.comments.length,
        mapped_count: result.comments.length,
        top_level_limit: 500,
        reply_limit_per_comment: 500,
        provider_resume_cursor: result.provider_resume_cursor ?? null,
        provider_reply_resume: result.provider_reply_resume ?? null,
        truncated,
      }
    } else if (target.platform === 'instagram') {
      const token = await getPlatformToken(userId, target.platform, target.accountId)
      assertScopes('instagram', 'read', token.scopes)
      const result = await listInstagramComments(token, content.external_content_id)
      comments = result.comments
      truncated = result.metadata.truncated
      repliesFetched = result.metadata.replies_fetched
      threadCompleteness = result.metadata.thread_completeness
      syncMetadata = {
        ...syncMetadata,
        pagination_complete: result.metadata.top_level_pagination_complete
          && result.metadata.replies_fetched
          && !result.metadata.provider_visibility_mismatch,
        top_level_pagination_complete: result.metadata.top_level_pagination_complete,
        replies_fetched: result.metadata.replies_fetched,
        provider_raw_count: result.metadata.provider_raw_count,
        provider_reported_comment_count: result.metadata.provider_reported_comment_count,
        provider_visibility_mismatch: result.metadata.provider_visibility_mismatch,
        mapped_count: result.metadata.mapped_count,
        top_level_limit: INSTAGRAM_COMMENT_SYNC_LIMITS.topLevel,
        reply_limit_per_comment: result.metadata.replies_fetched
          ? INSTAGRAM_COMMENT_SYNC_LIMITS.repliesPerComment
          : null,
        truncated,
      }
    } else if (target.platform === 'facebook') {
      const token = await getPlatformToken(userId, target.platform, target.accountId)
      assertScopes('facebook', 'read', token.scopes)
      const providerComments = await listFacebookComments(token, content.provider_comment_content_id)
      comments = providerComments.map((comment) => ({
        ...comment,
        external_content_id: content!.external_content_id,
        metadata: {
          ...(comment.metadata || {}),
          provider_comment_content_id: content!.provider_comment_content_id,
        },
      }))
      truncated = providerComments.some((comment) => comment.metadata?.truncated === true)
      repliesFetched = true
      threadCompleteness = truncated ? 'truncated' : 'complete'
      syncMetadata = {
        ...syncMetadata,
        pagination_complete: !truncated,
        replies_fetched: true,
        provider_raw_count: providerComments.length,
        mapped_count: comments.length,
        truncated,
      }
    } else {
      throw new SocialCommentUnsupportedError(target.platform, TIKTOK_UNSUPPORTED_MESSAGE)
    }

    syncMetadata = {
      ...syncMetadata,
      thread_completeness: threadCompleteness,
      replies_fetched: repliesFetched,
      truncated,
      provider_reported_comment_count: target.platform === 'instagram'
        ? typeof syncMetadata.provider_reported_comment_count === 'number'
          ? syncMetadata.provider_reported_comment_count
          : null
        : undefined,
      provider_visibility_mismatch: target.platform === 'instagram'
        ? syncMetadata.provider_visibility_mismatch === true
        : undefined,
    }

    if (target.platform === 'tiktok') {
      await reconcileUnknownTikTokReplies(
        admin,
        userId,
        target.accountId,
        content.id,
        content.external_content_id,
        comments,
      )
    }

    const commentsToSave = target.platform === 'instagram'
      ? comments.filter((comment) => !comment.is_from_account)
      : comments
    if (target.platform === 'instagram') {
      syncMetadata = {
        ...syncMetadata,
        from_account_omitted_count: comments.length - commentsToSave.length,
      }
    }
    const saved = await upsertComments(userId, target.platform, target.accountId, content.id, commentsToSave)
    await completeSyncRun(runId, 'completed', saved.length, undefined, undefined, syncMetadata)
    await completeActionLog(admin, actionLogId, userId, 'completed', {
      metadata: {
        ...syncMetadata,
        synced_count: saved.length,
      },
    })
    return {
      comments: saved,
      syncedCount: saved.length,
      thread_completeness: threadCompleteness,
      replies_fetched: repliesFetched,
      truncated,
      provider_reported_comment_count: target.platform === 'instagram'
        ? typeof syncMetadata.provider_reported_comment_count === 'number'
          ? syncMetadata.provider_reported_comment_count
          : null
        : undefined,
      provider_visibility_mismatch: target.platform === 'instagram'
        ? syncMetadata.provider_visibility_mismatch === true
        : undefined,
    }
  } catch (error) {
    const mapped = mapApiError(error, 'Comment sync failed.')
    const status = mapped.unsupported ? 'unsupported' : 'failed'
    const metadata = {
      sync_source: syncSource,
      throttle_ms: throttleMs,
      requested_content_id: target.contentId,
      external_content_id: content?.external_content_id || null,
      ...errorObservabilityMetadata(mapped),
    }
    await completeSyncRun(runId, status, 0, mapped.code, mapped.message, metadata)
    await completeActionLog(admin, actionLogId, userId, status, {
      errorCode: mapped.code,
      errorMessage: mapped.message,
      metadata,
    })
    if (mapped.code === 'missing_comment_scope') {
      await logCommentErrorAction(admin, userId, target.platform, 'permission_error', {
        accountId: target.accountId,
        externalContentId: content?.external_content_id || target.contentId,
        errorCode: mapped.code,
        errorMessage: mapped.message,
      })
    } else if (mapped.code === 'token_missing') {
      await logCommentErrorAction(admin, userId, target.platform, 'token_error', {
        accountId: target.accountId,
        externalContentId: content?.external_content_id || target.contentId,
        errorCode: mapped.code,
        errorMessage: mapped.message,
      })
    }
    throw error
  }
}

async function getCommentForReply(userId: string, commentId: string): Promise<SavedSocialComment> {
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('social_comments')
    .select('*')
    .eq('id', commentId)
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    throw new SocialCommentApiError('youtube', 'comment_not_found', 'Comment not found or not accessible.', 404)
  }
  return mapSavedComment(data)
}

async function findOwnedPublishedTaskItemForComment(
  admin: any,
  userId: string,
  comment: SavedSocialComment
): Promise<PlatformContentLookup> {
  const config = PLATFORM_CONTENT_CONFIG[comment.platform]
  const accountIds = await getOwnedAccountIds(admin, config, userId, comment.account_id)
  if (accountIds.size === 0) {
    throw new SocialCommentApiError(comment.platform, 'account_not_found', 'Account not found or not accessible.', 404)
  }

  if (!comment.external_content_id) {
    throw new SocialCommentApiError(comment.platform, 'content_not_found', 'Published content not found or not accessible.', 404)
  }

  const rows = comment.task_item_id
    ? await queryPublishedTaskItemsByField(admin, config, comment.account_id, 'id', comment.task_item_id)
    : await queryPublishedTaskItemsByField(admin, config, comment.account_id, config.externalIdKey, comment.external_content_id)

  for (const row of rows) {
    if (String(row[config.externalIdKey]) !== comment.external_content_id) continue
    const taskName = await getOwnedTaskNameForTaskId(admin, config, userId, row.task_id)
    if (taskName !== undefined) {
      return {
        id: row.id,
        external_content_id: String(row[config.externalIdKey]),
        provider_comment_content_id: String(
          (config.commentContentIdKey ? row[config.commentContentIdKey] : null) || row[config.externalIdKey]
        ),
        account_id: row.account_id,
        title: row.title || row.source_video_name || row[config.externalIdKey] || null,
      }
    }
  }

  throw new SocialCommentApiError(comment.platform, 'content_not_found', 'Published content not found or not accessible.', 404)
}

export async function assertCommentReplyTargetOwned(
  userId: string,
  comment: SavedSocialComment
): Promise<PlatformContentLookup> {
  if (comment.user_id !== userId) {
    throw new SocialCommentApiError(comment.platform, 'comment_not_found', 'Comment not found or not accessible.', 404)
  }

  if (comment.direction !== 'inbound') {
    throw new SocialCommentApiError(comment.platform, 'cannot_reply', 'Only inbound comments can be replied to.', 400)
  }

  const admin = createAdminClient() as any
  return findOwnedPublishedTaskItemForComment(admin, userId, comment)
}

async function getReplyActionLogByKey(admin: any, userId: string, idempotencyKey: string) {
  const { data, error } = await admin
    .from('social_comment_action_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('action_type', 'reply')
    .eq('idempotency_key', idempotencyKey)
    .limit(1)

  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data[0] : null
}

async function getSavedReplyFromActionLog(admin: any, userId: string, actionLog: any): Promise<SavedSocialComment | null> {
  const replyId = actionLog?.metadata?.reply_comment_id
  if (!replyId) return null
  const { data, error } = await admin
    .from('social_comments')
    .select('*')
    .eq('id', replyId)
    .eq('user_id', userId)
    .limit(1)

  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : null
  return row ? mapSavedComment(row) : null
}

function providerReplyFromActionLog(actionLog: any): ExternalSocialComment | null {
  const value = actionLog?.metadata?.provider_reply
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (
    typeof value.external_comment_id !== 'string'
    || !value.external_comment_id.trim()
    || typeof value.external_content_id !== 'string'
    || !value.external_content_id.trim()
    || typeof value.message !== 'string'
    || !value.message.trim()
  ) {
    return null
  }
  return value as ExternalSocialComment
}

async function assertNoUnknownReplyOutcome(
  admin: any,
  userId: string,
  comment: SavedSocialComment,
) {
  const providerTarget = comment.parent_external_comment_id || comment.external_comment_id
  const { data, error } = await admin
    .from('social_comment_action_logs')
    .select('id, external_comment_id, metadata')
    .eq('user_id', userId)
    .eq('platform', comment.platform)
    .eq('account_id', comment.account_id)
    .eq('action_type', 'reply')
    .eq('status', 'unknown')

  if (error) throw new Error(error.message)
  const hasUnknownProviderTarget = Array.isArray(data) && data.some((row) => (
    (row?.metadata?.parent_external_comment_id || row?.external_comment_id) === providerTarget
  ))
  if (hasUnknownProviderTarget) {
    throw new SocialCommentApiError(
      comment.platform,
      'reply_outcome_unknown',
      'A previous reply has an unknown provider outcome. Sync comments before retrying.',
      409,
    )
  }
}

async function enforceReplyThrottle(
  admin: any,
  userId: string,
  comment: SavedSocialComment,
  currentLogId: string,
  replyAttemptToken?: string,
) {
  const since = new Date(Date.now() - REPLY_THROTTLE_MS).toISOString()
  const providerTarget = comment.parent_external_comment_id || comment.external_comment_id
  const { data, error } = await admin
    .from('social_comment_action_logs')
    .select('id, external_comment_id, metadata')
    .eq('user_id', userId)
    .eq('platform', comment.platform)
    .eq('account_id', comment.account_id)
    .eq('action_type', 'reply')
    .in('status', ['running', 'sent', 'completed'])
    .gte('created_at', since)
    .neq('id', currentLogId)

  if (error) throw new Error(error.message)
  const hasRecentProviderTarget = Array.isArray(data) && data.some((row) => (
    (row?.metadata?.parent_external_comment_id || row?.external_comment_id) === providerTarget
  ))
  if (hasRecentProviderTarget) {
    const transitionInput = {
      errorCode: 'reply_throttled',
      errorMessage: 'Please wait before replying to this comment again.',
      metadata: {
        comment_id: comment.id,
        throttle_ms: REPLY_THROTTLE_MS,
      },
    }
    if (comment.platform === 'tiktok' && replyAttemptToken) {
      await transitionTikTokReplyAction(
        admin,
        userId,
        currentLogId,
        replyAttemptToken,
        ['running'],
        'failed',
        transitionInput,
      )
    } else {
      await completeActionLog(admin, currentLogId, userId, 'failed', transitionInput)
    }
    throw new SocialCommentApiError(comment.platform, 'reply_throttled', 'Please wait before replying to this comment again.', 429)
  }
}

async function startReplyActionLog(
  admin: any,
  userId: string,
  comment: SavedSocialComment,
  idempotencyKey: string,
  replyMessage: string,
): Promise<
  | { logId: string; replyAttemptToken: string; existingReply?: never; providerReply?: never }
  | { logId?: never; existingReply: SavedSocialComment; providerReply?: never }
  | { logId: string; replyAttemptToken: string; existingReply?: never; providerReply: ExternalSocialComment }
> {
  await assertNoUnknownReplyOutcome(admin, userId, comment)
  const replyAttemptToken = randomUUID()
  try {
    const log = await insertActionLog(admin, {
      userId,
      platform: comment.platform,
      accountId: comment.account_id,
      externalContentId: comment.external_content_id,
      externalCommentId: comment.external_comment_id,
      actionType: 'reply',
      idempotencyKey,
      metadata: {
        comment_id: comment.id,
        parent_external_comment_id: comment.parent_external_comment_id || comment.external_comment_id,
        reply_message_hash: replyMessageHash(replyMessage),
        reply_attempt_token: replyAttemptToken,
      },
    })
    await enforceReplyThrottle(admin, userId, comment, log.id, replyAttemptToken)
    return { logId: log.id, replyAttemptToken }
  } catch (error: any) {
    if (error?.code !== '23505') throw error

    const existing = await getReplyActionLogByKey(admin, userId, idempotencyKey)
    if (!existing) {
      throw new SocialCommentApiError(comment.platform, 'duplicate_request_running', 'A duplicate reply request is already running.', 409)
    }
    const existingProviderTarget = existing?.metadata?.parent_external_comment_id || existing.external_comment_id
    const requestedProviderTarget = comment.parent_external_comment_id || comment.external_comment_id
    const requestedMessageHash = replyMessageHash(replyMessage)
    const existingMessageHash = typeof existing?.metadata?.reply_message_hash === 'string'
      ? existing.metadata.reply_message_hash
      : ''
    if (
      existing.platform !== comment.platform
      || existing.account_id !== comment.account_id
      || existingProviderTarget !== requestedProviderTarget
      || existingMessageHash !== requestedMessageHash
    ) {
      throw new SocialCommentApiError(comment.platform, 'idempotency_key_conflict', 'This idempotency key was already used for another reply request.', 409)
    }

    if (existing.status === 'sent' || existing.status === 'completed') {
      const reply = await getSavedReplyFromActionLog(admin, userId, existing)
      if (reply) return { existingReply: reply }
      const providerReply = providerReplyFromActionLog(existing)
      if (existing.status === 'sent' && providerReply) {
        const existingAttemptToken = typeof existing?.metadata?.reply_attempt_token === 'string'
          ? existing.metadata.reply_attempt_token
          : ''
        if (!existingAttemptToken) {
          throw new SocialCommentApiError(
            comment.platform,
            'duplicate_request_sent',
            'This reply request is missing its attempt fence.',
            409,
          )
        }
        return {
          logId: existing.id,
          replyAttemptToken: existingAttemptToken,
          providerReply,
        }
      }
      throw new SocialCommentApiError(comment.platform, 'duplicate_request_sent', 'This reply request already completed.', 409)
    }

    if (existing.status === 'running') {
      throw new SocialCommentApiError(comment.platform, 'duplicate_request_running', 'A duplicate reply request is already running.', 409)
    }

    if (existing.status === 'failed' || existing.status === 'unsupported') {
      const { data: restarted, error: restartError } = await admin
        .from('social_comment_action_logs')
        .update({
          status: 'running',
          error_code: null,
          error_message: null,
          metadata: mergeActionLogMetadata(existing.metadata, {
            comment_id: comment.id,
            parent_external_comment_id: comment.parent_external_comment_id || comment.external_comment_id,
            reply_message_hash: requestedMessageHash,
            reply_attempt_token: replyAttemptToken,
            provider_dispatch_started_at: null,
            restarted_at: new Date().toISOString(),
          }),
          completed_at: null,
        })
        .eq('id', existing.id)
        .eq('user_id', userId)
        .in('status', ['failed', 'unsupported'])
        .select('*')
        .maybeSingle()
      if (restartError) throw restartError
      if (!restarted) {
        throw new SocialCommentApiError(comment.platform, 'duplicate_request_running', 'A duplicate reply request is already running.', 409)
      }
      await enforceReplyThrottle(
        admin,
        userId,
        comment,
        existing.id,
        replyAttemptToken,
      )
      return { logId: existing.id, replyAttemptToken }
    }

    throw new SocialCommentApiError(comment.platform, 'duplicate_request_failed', 'This reply request already has a terminal status.', 409)
  }
}

async function markTikTokReplyDispatchStarted(
  admin: any,
  userId: string,
  actionLogId: string,
  replyAttemptToken: string,
) {
  const { data: marked, error } = await admin.rpc('mark_tiktok_reply_dispatch_started', {
    p_user_id: userId,
    p_action_log_id: actionLogId,
    p_reply_attempt_token: replyAttemptToken,
  })
  if (error) throw error
  if (marked !== true) {
    throw new SocialCommentApiError(
      'tiktok',
      'duplicate_request_running',
      'This reply request is no longer eligible for provider dispatch.',
      409,
    )
  }
}

async function finalizeSocialCommentReply(
  admin: any,
  userId: string,
  actionLogId: string,
  replyAttemptToken: string,
  parentExternalCommentId: string,
  taskItemId: string | null,
  externalReply: ExternalSocialComment,
): Promise<SavedSocialComment> {
  const { data, error } = await admin.rpc('finalize_social_comment_reply', {
    p_user_id: userId,
    p_action_log_id: actionLogId,
    p_reply_attempt_token: replyAttemptToken,
    p_parent_external_comment_id: parentExternalCommentId,
    p_task_item_id: taskItemId,
    p_reply: externalReply,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Reply finalization returned no row.')
  return mapSavedComment(row)
}

export async function reconcileUnknownTikTokReplies(
  admin: any,
  userId: string,
  accountId: string,
  taskItemId: string,
  externalContentId: string,
  providerComments: ExternalSocialComment[],
) {
  const { data: unknownActions, error } = await admin
    .from('social_comment_action_logs')
    .select('id, status, metadata, created_at')
    .eq('user_id', userId)
    .eq('platform', 'tiktok')
    .eq('account_id', accountId)
    .eq('external_content_id', externalContentId)
    .eq('action_type', 'reply')
    .in('status', ['running', 'unknown'])

  if (error) throw new Error(error.message)
  for (const action of unknownActions || []) {
    const messageHash = typeof action?.metadata?.reply_message_hash === 'string'
      ? action.metadata.reply_message_hash
      : ''
    const parentExternalId = typeof action?.metadata?.parent_external_comment_id === 'string'
      ? action.metadata.parent_external_comment_id
      : ''
    const replyAttemptToken = typeof action?.metadata?.reply_attempt_token === 'string'
      ? action.metadata.reply_attempt_token
      : ''
    const hasDispatchTimestamp = typeof action?.metadata?.provider_dispatch_started_at === 'string'
      && action.metadata.provider_dispatch_started_at.trim() !== ''
    if (action.status === 'running' && !hasDispatchTimestamp) {
      if (!replyAttemptToken) continue
      const { data: abandoned, error: abandonedError } = await admin.rpc(
        'abandon_stale_tiktok_reply_dispatch',
        {
          p_user_id: userId,
          p_action_log_id: action.id,
          p_reply_attempt_token: replyAttemptToken,
        },
      )
      if (abandonedError) throw abandonedError
      if (abandoned !== true) {
        continue
      }
      continue
    }

    const dispatchStartedAt = hasDispatchTimestamp
      ? action.metadata.provider_dispatch_started_at
      : action.created_at
    const actionTime = new Date(dispatchStartedAt).getTime()
    if (!messageHash || !parentExternalId || !Number.isFinite(actionTime)) continue

    if (action.status === 'running' && Date.now() - actionTime >= TIKTOK_REPLY_DISPATCH_STALE_MS) {
      if (!replyAttemptToken) continue
      const { data: transitioned, error: transitionError } = await admin.rpc(
        'mark_stale_tiktok_reply_dispatch_unknown',
        {
          p_user_id: userId,
          p_action_log_id: action.id,
          p_reply_attempt_token: replyAttemptToken,
        },
      )
      if (transitionError) throw transitionError
      if (!transitioned) continue
      action.status = 'unknown'
    }

    const candidates = providerComments
      .filter((comment) => {
        if (
          !comment.is_from_account
          || comment.parent_external_comment_id !== parentExternalId
          || replyMessageHash(comment.message.trim()) !== messageHash
          || !comment.remote_created_at
        ) {
          return false
        }
        const remoteTime = new Date(comment.remote_created_at).getTime()
        return Number.isFinite(remoteTime)
          && remoteTime >= actionTime - TIKTOK_REPLY_RECONCILE_WINDOW_MS
          && remoteTime <= actionTime + TIKTOK_REPLY_RECONCILE_WINDOW_MS
      })

    if (candidates.length !== 1) continue
    const matched = candidates[0]
    try {
      await finalizeSocialCommentReply(
        admin,
        userId,
        action.id,
        typeof action?.metadata?.reply_attempt_token === 'string'
          ? action.metadata.reply_attempt_token
          : '',
        parentExternalId,
        taskItemId,
        {
          ...matched,
          metadata: {
            ...(matched.metadata || {}),
            reconciled_from_unknown: true,
          },
        },
      )
    } catch (finalizeError) {
      const { data: latest, error: latestError } = await admin
        .from('social_comment_action_logs')
        .select('status')
        .eq('id', action.id)
        .eq('user_id', userId)
        .maybeSingle()
      if (latestError || latest?.status !== 'completed') throw finalizeError
    }
  }
}

export async function replyToSocialComment(
  userId: string,
  commentId: string,
  message: string,
  idempotencyKey: string,
  options: ReplyOptions = {}
): Promise<SavedSocialComment> {
  const trimmed = message.trim()
  if (!trimmed) {
    throw new SocialCommentApiError('youtube', 'empty_reply', 'Reply message cannot be empty.', 400)
  }
  const idempotencyKeyTrimmed = idempotencyKey.trim()
  if (!idempotencyKeyTrimmed) {
    throw new SocialCommentApiError('youtube', 'missing_idempotency_key', 'Reply idempotency key is required.', 400)
  }

  const comment = await getCommentForReply(userId, commentId)
  if (countUnicodeCodePoints(trimmed) > 2000) {
    throw new SocialCommentApiError(
      comment.platform,
      'reply_too_long',
      'Reply message cannot exceed 2000 Unicode characters.',
      400,
    )
  }
  if (options.enabledPlatforms && !options.enabledPlatforms.includes(comment.platform)) {
    throw new SocialCommentApiError(comment.platform, 'comment_not_found', 'Comment not found or not accessible.', 404)
  }
  if (!isSocialCommentReplyPlatformEnabled(
    comment.platform,
    options.instagramReplyEnabled === true,
    options.tiktokReplyEnabled === true,
  )) {
    throw new SocialCommentApiError(
      comment.platform,
      'reply_disabled',
      `${comment.platform} comment replies are disabled.`,
      403,
    )
  }
  const ownedContent = await assertCommentReplyTargetOwned(userId, comment)
  if (!comment.can_reply) {
    throw new SocialCommentApiError(comment.platform, 'cannot_reply', 'This comment cannot be replied to with the current account.', 400)
  }
  if (comment.platform === 'tiktok' && !isTikTokCommentReplyWithinLimit(trimmed)) {
    throw new SocialCommentApiError(
      'tiktok',
      'reply_too_long',
      `TikTok reply message cannot exceed ${TIKTOK_COMMENT_REPLY_MAX_CODE_POINTS} Unicode characters.`,
      400,
    )
  }

  const admin = createAdminClient() as any
  const action = await startReplyActionLog(admin, userId, comment, idempotencyKeyTrimmed, trimmed)
  if (action.existingReply) return action.existingReply

  const actionLogId = action.logId
  const parentExternalCommentId = comment.parent_external_comment_id || comment.external_comment_id
  let token: PlatformAccountToken | null = null
  let externalReply: ExternalSocialComment
  let providerAccepted = Boolean(action.providerReply)

  try {
    if (action.providerReply) {
      externalReply = action.providerReply
    } else {
      token = await getPlatformToken(userId, comment.platform, comment.account_id)
      if (comment.platform === 'youtube') {
        assertScopes('youtube', 'reply', token.scopes)
        externalReply = await replyToYouTubeComment(token, parentExternalCommentId, trimmed)
      } else if (comment.platform === 'instagram') {
        assertScopes('instagram', 'reply', token.scopes)
        externalReply = await replyToInstagramComment(token, parentExternalCommentId, comment.external_content_id, trimmed)
      } else if (comment.platform === 'facebook') {
        assertScopes('facebook', 'reply', token.scopes)
        externalReply = await replyToFacebookComment(token, parentExternalCommentId, comment.external_content_id, trimmed)
      } else if (comment.platform === 'tiktok') {
        if (!token.scopes.includes('comment.list.manage')) {
          throw new SocialCommentApiError(
            'tiktok',
            'missing_comment_scope',
            'TikTok comment management permission is missing. Refresh the comment authorization and try again.',
            403,
          )
        }
        await markTikTokReplyDispatchStarted(
          admin,
          userId,
          actionLogId,
          action.replyAttemptToken,
        )
        externalReply = await replyToTikTokComment(
          token,
          parentExternalCommentId,
          comment.external_content_id,
          trimmed,
        )
      } else {
        throw new SocialCommentUnsupportedError('tiktok', TIKTOK_UNSUPPORTED_MESSAGE)
      }

      externalReply.external_content_id = comment.external_content_id
      externalReply.parent_external_comment_id = parentExternalCommentId
      externalReply.thread_external_id = parentExternalCommentId
      externalReply.is_from_account = true
      externalReply.author_id = externalReply.author_id || token.accountExternalId
      externalReply.author_name = externalReply.author_name || token.accountName
      externalReply.metadata = {
        ...(externalReply.metadata || {}),
        idempotency_key: idempotencyKeyTrimmed,
      }

      if (comment.platform === 'tiktok') {
        providerAccepted = true
        const receiptPersisted = await transitionTikTokReplyAction(
          admin,
          userId,
          actionLogId,
          action.replyAttemptToken,
          ['running', 'sent'],
          'sent',
          {
            metadata: {
              comment_id: comment.id,
              parent_external_comment_id: parentExternalCommentId,
              external_reply_id: externalReply.external_comment_id,
              provider_reply: externalReply,
            },
          },
        )
        if (!receiptPersisted) {
          throw new SocialCommentApiError(
            'tiktok',
            'reply_attempt_fenced',
            'This TikTok reply attempt was superseded before its receipt could be saved.',
            409,
          )
        }
      }
    }

    if (comment.platform === 'tiktok') {
      return await finalizeSocialCommentReply(
        admin,
        userId,
        actionLogId,
        action.replyAttemptToken,
        parentExternalCommentId,
        ownedContent.id,
        externalReply,
      )
    }

    const saved = await upsertComments(
      userId,
      comment.platform,
      comment.account_id,
      ownedContent.id,
      [externalReply],
      'outbound',
      'sent',
      comment.id,
    )
    const reply = saved[0]
    const { error: countError } = await admin
      .from('social_comments')
      .update({
        reply_count: Math.max(0, comment.reply_count + 1),
        updated_at: new Date().toISOString(),
      })
      .eq('id', comment.id)
      .eq('user_id', userId)
    if (countError) throw new Error(countError.message)

    await completeActionLog(admin, actionLogId, userId, 'sent', {
      metadata: {
        comment_id: comment.id,
        reply_comment_id: reply.id,
        parent_external_comment_id: parentExternalCommentId,
        external_reply_id: reply.external_comment_id,
      },
    })
    return reply
  } catch (error) {
    const mapped = mapApiError(error, 'Reply failed.')
    const providerOutcomeUnknown = comment.platform === 'tiktok'
      && !providerAccepted
      && (
        mapped.providerWriteOutcome === 'unknown'
        || (mapped.providerWriteOutcome === null && mapped.code === 'provider_unreachable')
      )
    const terminalStatus = providerAccepted
      ? 'sent'
      : providerOutcomeUnknown
        ? 'unknown'
        : mapped.unsupported
          ? 'unsupported'
          : 'failed'
    const terminalInput = {
      errorCode: mapped.code,
      errorMessage: mapped.message,
      metadata: {
        comment_id: comment.id,
        parent_external_comment_id: parentExternalCommentId,
        ...(providerAccepted ? { provider_reply: externalReply! } : {}),
        provider_outcome_unknown: providerOutcomeUnknown,
        ...errorObservabilityMetadata(mapped),
      },
    }
    const terminalPersisted = comment.platform === 'tiktok'
      ? await transitionTikTokReplyAction(
        admin,
        userId,
        actionLogId,
        action.replyAttemptToken,
        terminalStatus === 'sent'
          ? ['running', 'sent']
          : terminalStatus === 'unknown'
            ? ['running', 'unknown']
            : ['running'],
        terminalStatus,
        terminalInput,
      ).catch(() => null)
      : await completeActionLog(admin, actionLogId, userId, terminalStatus, {
        ...terminalInput,
        fromStatuses: terminalStatus === 'sent'
          ? ['running', 'sent']
          : terminalStatus === 'unknown'
            ? ['running', 'unknown']
            : ['running'],
      }).catch(() => null)
    if (terminalPersisted === false) {
      const { data: winner, error: winnerError } = await admin
        .from('social_comment_action_logs')
        .select('*')
        .eq('id', actionLogId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!winnerError && winner?.status === 'completed') {
        const savedWinner = await getSavedReplyFromActionLog(admin, userId, winner)
        if (savedWinner) return savedWinner
      }
      if (
        comment.platform === 'tiktok'
        && winner?.metadata?.reply_attempt_token !== action.replyAttemptToken
      ) {
        throw error
      }
    }
    if (mapped.code === 'missing_comment_scope') {
      await logCommentErrorAction(admin, userId, comment.platform, 'permission_error', {
        accountId: comment.account_id,
        externalContentId: comment.external_content_id,
        externalCommentId: comment.external_comment_id,
        errorCode: mapped.code,
        errorMessage: mapped.message,
      })
    } else if (mapped.code === 'token_missing') {
      await logCommentErrorAction(admin, userId, comment.platform, 'token_error', {
        accountId: comment.account_id,
        externalContentId: comment.external_content_id,
        externalCommentId: comment.external_comment_id,
        errorCode: mapped.code,
        errorMessage: mapped.message,
      })
    }
    throw error
  }
}

export async function syncRecentSocialComments(
  userId: string,
  platform: SocialPlatform,
  accountId: string,
  options: SyncOptions = {}
): Promise<RecentSyncResult> {
  if (!isSocialCommentRecentSyncAllowed(platform, options.source || 'manual')) {
    if (platform === 'instagram') {
      throw new SocialCommentApiError('instagram', 'invalid_request', 'Instagram comment sync requires an explicit published content target.', 400)
    }
    throw new SocialCommentApiError(platform, 'invalid_request', 'Auto sync does not support recent batch sync.', 400)
  }

  const admin = createAdminClient() as any
  const config = PLATFORM_CONTENT_CONFIG[platform]
  const accountIds = await getOwnedAccountIds(admin, config, userId, accountId)
  if (accountIds.size === 0) {
    throw new SocialCommentApiError(platform, 'account_not_found', 'Account not found or not accessible.', 404)
  }

  let actionLogId: string | undefined
  try {
    actionLogId = await startSyncActionLog(admin, {
      userId,
      platform,
      accountId,
      externalContentId: null,
      scope: 'recent',
      idempotencyKey: options.idempotencyKey,
      source: 'manual',
    })

    const contents = await getSocialCommentContent(userId, { platform, accountId, limit: MAX_SYNC_TARGETS })
    const results: RecentSyncTargetResult[] = []
    for (const content of contents.slice(0, MAX_SYNC_TARGETS)) {
      try {
        const result = await syncSocialComments(userId, {
          platform,
          accountId,
          contentId: content.id,
        })
        results.push({
          contentId: content.id,
          externalContentId: content.external_content_id,
          status: 'completed',
          syncedCount: result.syncedCount,
        })
      } catch (error) {
        const mapped = mapApiError(error, 'Comment sync failed.')
        const targetStatus = mapped.code === 'sync_throttled' || mapped.code === 'sync_already_running'
          ? 'throttled'
          : mapped.unsupported
            ? 'unsupported'
            : 'failed'
        results.push({
          contentId: content.id,
          externalContentId: content.external_content_id,
          status: targetStatus,
          syncedCount: 0,
          code: mapped.code,
          error: mapped.message,
          ...errorObservabilityMetadata(mapped),
        })
      }
    }

    const completedCount = results.filter((result) => result.status === 'completed').length
    const failedTargets = results.filter((result) => result.status !== 'completed')
    const syncedCount = results.reduce((total, result) => total + result.syncedCount, 0)
    const recentResult: RecentSyncResult = {
      syncedCount,
      completedCount,
      failedCount: failedTargets.length,
      results,
    }

    await completeActionLog(admin, actionLogId, userId, completedCount > 0 || results.length === 0 ? 'completed' : 'failed', {
      errorCode: completedCount === 0 && failedTargets.length > 0 ? 'recent_sync_failed' : null,
      errorMessage: completedCount === 0 && failedTargets.length > 0 ? 'All recent sync targets failed.' : null,
      metadata: {
        sync_scope: 'recent',
        sync_source: 'manual',
        partial_failed: completedCount > 0 && failedTargets.length > 0,
        synced_targets: completedCount,
        failed_target_count: failedTargets.length,
        synced_count: syncedCount,
        results: results.map((result) => ({
          contentId: result.contentId,
          externalContentId: result.externalContentId,
          status: result.status,
          code: result.code || null,
          retryable: result.retryable || false,
          httpStatus: result.httpStatus || null,
          retryAfter: result.retryAfter || null,
        })),
        failed_targets: failedTargets.map((result) => ({
          contentId: result.contentId,
          externalContentId: result.externalContentId,
          status: result.status,
          code: result.code || null,
          retryable: result.retryable || false,
          httpStatus: result.httpStatus || null,
          retryAfter: result.retryAfter || null,
        })),
        throttle_ms: SYNC_THROTTLE_MS,
      },
    })

    return recentResult
  } catch (error) {
    const mapped = mapApiError(error, 'Comment sync failed.')
    await completeActionLog(admin, actionLogId, userId, mapped.unsupported ? 'unsupported' : 'failed', {
      errorCode: mapped.code,
      errorMessage: mapped.message,
      metadata: {
        sync_scope: 'recent',
        sync_source: 'manual',
        throttle_ms: SYNC_THROTTLE_MS,
        ...errorObservabilityMetadata(mapped),
      },
    })
    throw error
  }
}

export { mapApiError as mapSocialCommentError }
