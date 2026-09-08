import { getFacebookAppSecretProof } from '@/lib/facebook/oauth'
import { instagramGraphHeaders } from '@/lib/instagram/graph-auth'
import { getInstagramAuthMode } from '@/lib/instagram/oauth'
import { BrokerTransportError, callBroker, isBrokerEnabled } from '@/lib/oauth-broker/client'
import type { ExternalSocialComment, SocialCommentListResult, SocialPlatform } from '@/lib/social-comments/types'

const YOUTUBE_COMMENT_THREADS_URL = 'https://www.googleapis.com/youtube/v3/commentThreads'
const YOUTUBE_COMMENTS_URL = 'https://www.googleapis.com/youtube/v3/comments'
const YOUTUBE_PAGE_SIZE = 100
const YOUTUBE_MAX_TOP_LEVEL_COMMENTS = 500
const FACEBOOK_API_VERSION = process.env.FACEBOOK_API_VERSION || 'v25.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`
const FACEBOOK_PAGE_SIZE = 100
const FACEBOOK_MAX_TOP_LEVEL_COMMENTS = 500
const FACEBOOK_MAX_REPLIES_PER_COMMENT = 500
// Keep Instagram versioning independent from Facebook review changes. Setting
// FACEBOOK_API_VERSION must never silently move Instagram Graph API traffic.
const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_API_VERSION || 'v20.0'
const INSTAGRAM_AUTH_MODE = getInstagramAuthMode()
const INSTAGRAM_GRAPH_URL = INSTAGRAM_AUTH_MODE === 'instagram'
  ? `https://graph.instagram.com/${INSTAGRAM_API_VERSION}`
  : `https://graph.facebook.com/${INSTAGRAM_API_VERSION}`
const INSTAGRAM_PAGE_SIZE = 50
const INSTAGRAM_NATIVE_COMMENT_FIELDS = 'from,text'
const INSTAGRAM_NATIVE_REPLY_FIELDS = 'from,text'
const INSTAGRAM_FACEBOOK_COMMENT_FIELDS = 'id,text,from{id,username},timestamp,like_count,hidden,replies{id,text,from{id,username},timestamp,like_count,hidden}'
const INSTAGRAM_FACEBOOK_REPLY_FIELDS = 'id,text,from{id,username},timestamp,like_count,hidden'
const TIKTOK_BUSINESS_API_URL = 'https://business-api.tiktok.com/open_api/v1.3'
const TIKTOK_COMMENT_PAGE_SIZE = 20
const TIKTOK_MAX_TOP_LEVEL_COMMENTS = 500
const TIKTOK_MAX_REPLIES_PER_COMMENT = 500
const TIKTOK_COMMENT_TIMEOUT_MS = 20_000
const TIKTOK_REPLY_BROKER_TIMEOUT_MS = 25_000
export interface TikTokCommentReadBudget {
  topLevelRequests: number
  replyRequests: number
  resumeCursor?: number | null
  replyResume?: {
    parent_ids: string[]
    observed_parent_ids: string[]
    cursor: number | null
  } | null
}
export const INSTAGRAM_COMMENT_SYNC_LIMITS = {
  topLevel: 500,
  repliesPerComment: 500,
} as const

export class SocialCommentApiError extends Error {
  platform: SocialPlatform
  code: string
  httpStatus: number
  retryable: boolean
  retryAfter: string | null
  providerWriteOutcome: 'rejected' | 'unknown' | null

  constructor(
    platform: SocialPlatform,
    code: string,
    message: string,
    httpStatus = 500,
    retryable = false,
    retryAfter: string | null = null,
    providerWriteOutcome: 'rejected' | 'unknown' | null = null,
  ) {
    super(message)
    this.name = 'SocialCommentApiError'
    this.platform = platform
    this.code = code
    this.httpStatus = httpStatus
    this.retryable = retryable
    this.retryAfter = retryAfter
    this.providerWriteOutcome = providerWriteOutcome
  }
}

export class SocialCommentUnsupportedError extends SocialCommentApiError {
  constructor(platform: SocialPlatform, message: string) {
    super(platform, 'unsupported_platform_operation', message, 501, false)
    this.name = 'SocialCommentUnsupportedError'
  }
}

const COMMENT_BROKER_TIMEOUT_MS = 60_000

async function callCommentBroker<T>(
  platform: SocialPlatform,
  op: string,
  args: Record<string, unknown>,
  timeoutMs = COMMENT_BROKER_TIMEOUT_MS,
): Promise<T> {
  try {
    return await callBroker<T>(platform, op, args, { timeoutMs })
  } catch (error) {
    if (error instanceof BrokerTransportError) {
      throw new SocialCommentApiError(
        platform,
        'provider_unreachable',
        `${platform} comment service is temporarily unreachable through the overseas gateway.`,
        503,
        true,
        null,
        op === 'replyToTikTokComment' ? 'unknown' : null,
      )
    }

    const brokerError = error && typeof error === 'object'
      ? error as {
          code?: unknown
          httpStatus?: unknown
          retryable?: unknown
          retryAfter?: unknown
          providerWriteOutcome?: unknown
        }
      : null
    const httpStatus = typeof brokerError?.httpStatus === 'number' ? brokerError.httpStatus : 500
    throw new SocialCommentApiError(
      platform,
      typeof brokerError?.code === 'string' && brokerError.code ? brokerError.code : 'provider_error',
      error instanceof Error ? error.message : `${platform} comment request failed.`,
      httpStatus,
      brokerError?.retryable === true,
      typeof brokerError?.retryAfter === 'string' ? brokerError.retryAfter : null,
      brokerError?.providerWriteOutcome === 'rejected' || brokerError?.providerWriteOutcome === 'unknown'
        ? brokerError.providerWriteOutcome
        : null,
    )
  }
}

export interface CommentTokenContext {
  accessToken: string
  accountExternalId: string
  accountName: string
}

export interface InstagramCommentListResult {
  comments: ExternalSocialComment[]
  metadata: {
    provider_raw_count: number
    provider_reported_comment_count: number | null
    provider_visibility_mismatch: boolean
    mapped_count: number
    top_level_pagination_complete: boolean
    replies_fetched: boolean
    truncated: boolean
    thread_completeness: SocialCommentListResult['thread_completeness']
  }
}

async function readInstagramReportedCommentCount(
  token: CommentTokenContext,
  externalContentId: string
): Promise<number | null> {
  const params = new URLSearchParams({ fields: 'comments_count' })
  try {
    const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(externalContentId)}?${params.toString()}`, {
      cache: 'no-store',
      headers: instagramGraphHeaders(token.accessToken),
    })
    if (!response.ok) return null
    const data = await readJson(response)
    const count = Number(data?.comments_count)
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null
  } catch {
    return null
  }
}

type CommentOperation = 'read' | 'reply'
type CommentScopeRequirement = {
  read: string[]
  reply: string[]
}

export const COMMENT_SCOPE_REQUIREMENTS: Record<Exclude<SocialPlatform, 'tiktok' | 'instagram'>, CommentScopeRequirement> = {
  youtube: {
    read: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    reply: ['https://www.googleapis.com/auth/youtube.force-ssl'],
  },
  facebook: {
    read: ['pages_read_engagement', 'pages_read_user_content'],
    reply: ['pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement'],
  },
}

const INSTAGRAM_NATIVE_COMMENT_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
]

const INSTAGRAM_FACEBOOK_COMMENT_SCOPES = [
  'instagram_basic',
  'instagram_manage_comments',
  'pages_read_engagement',
]

export function getCommentScopeRequirements(
  platform: Exclude<SocialPlatform, 'tiktok'>
): CommentScopeRequirement {
  if (platform !== 'instagram') return COMMENT_SCOPE_REQUIREMENTS[platform]

  const required = getInstagramAuthMode() === 'instagram'
    ? INSTAGRAM_NATIVE_COMMENT_SCOPES
    : INSTAGRAM_FACEBOOK_COMMENT_SCOPES

  return {
    read: [...required],
    reply: [...required],
  }
}

export function hasAnyRequiredScope(scopes: string[], required: string[]) {
  if (required.length === 0) return true
  const granted = new Set(scopes)
  return required.some((scope) => granted.has(scope))
}

export function hasAllRequiredScopes(scopes: string[], required: string[]) {
  if (required.length === 0) return true
  const granted = new Set(scopes)
  return required.every((scope) => granted.has(scope))
}

export function hasRequiredCommentScopes(
  platform: Exclude<SocialPlatform, 'tiktok'>,
  operation: CommentOperation,
  scopes: string[]
) {
  const required = getCommentScopeRequirements(platform)[operation]
  return platform === 'instagram' || platform === 'facebook'
    ? hasAllRequiredScopes(scopes, required)
    : hasAnyRequiredScope(scopes, required)
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isDefiniteWriteRejectionStatus(status: number) {
  return [400, 401, 403, 404, 405, 409, 410, 413, 415, 422].includes(status)
}

async function readJson(response: Response): Promise<any> {
  return response.json().catch(() => null)
}

function readRetryAfter(response: Response): string | null {
  const value = response.headers.get('retry-after')
  return value && value.trim() ? value.trim() : null
}

async function readGoogleError(response: Response) {
  const data = await readJson(response)
  return {
    code: data?.error?.errors?.[0]?.reason || data?.error?.status || String(response.status),
    message: data?.error?.message || data?.error_description || data?.error || response.statusText,
    retryAfter: readRetryAfter(response),
  }
}

async function readMetaError(response: Response) {
  const data = await readJson(response)
  const rawMessage = data?.error?.message || data?.error_description || data?.error || response.statusText
  return {
    code: data?.error?.code ? String(data.error.code) : String(response.status),
    subcode: data?.error?.error_subcode ? String(data.error.error_subcode) : null,
    message: sanitizeMetaErrorMessage(rawMessage),
    retryAfter: readRetryAfter(response),
  }
}

function sanitizeMetaErrorMessage(value: unknown): string {
  return String(value || 'Instagram request failed.')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(access_token|authorization|token|secret|code)=([^\s&]+)/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 240) || 'Instagram request failed.'
}

function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function numberValue(value: unknown): number {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function safeNonNegativeInteger(value: unknown): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function parseTikTokCursor(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function tikTokDateTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const timestamp = Date.parse(
    /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`,
  )
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function readMetaAfterCursor(value: any): string | null {
  const after = value?.paging?.cursors?.after
  return typeof after === 'string' && after.trim() ? after.trim() : null
}

function hasMetaNextPage(value: any): boolean {
  return Boolean(value?.paging?.next)
}

function mapYouTubeComment(
  comment: any,
  externalContentId: string,
  parentExternalCommentId: string | null,
  threadExternalId: string | null,
  accountExternalId: string
): ExternalSocialComment | null {
  const snippet = comment?.snippet || {}
  const id = textValue(comment?.id)
  const message = textValue(snippet.textDisplay || snippet.textOriginal)
  if (!id || !message) return null
  const authorId = textValue(snippet.authorChannelId?.value) || null
  const isFromAccount = Boolean(authorId && accountExternalId && authorId === accountExternalId)

  return {
    external_comment_id: id,
    external_content_id: externalContentId,
    parent_external_comment_id: parentExternalCommentId,
    thread_external_id: threadExternalId,
    author_id: authorId,
    author_name: textValue(snippet.authorDisplayName) || null,
    author_avatar_url: textValue(snippet.authorProfileImageUrl) || null,
    message,
    like_count: numberValue(snippet.likeCount),
    reply_count: 0,
    can_reply: !isFromAccount,
    is_from_account: isFromAccount,
    permalink: `https://www.youtube.com/watch?v=${externalContentId}&lc=${encodeURIComponent(id)}`,
    remote_created_at: toIso(snippet.publishedAt),
    metadata: {
      updatedAt: snippet.updatedAt || null,
      viewerRating: snippet.viewerRating || null,
    },
  }
}

async function listYouTubeCommentReplies(
  token: CommentTokenContext,
  externalContentId: string,
  parentExternalCommentId: string,
  threadExternalId: string | null
): Promise<ExternalSocialComment[]> {
  const replies: ExternalSocialComment[] = []
  let pageToken: string | null = null

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      parentId: parentExternalCommentId,
      maxResults: String(YOUTUBE_PAGE_SIZE),
      textFormat: 'plainText',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const response = await fetch(`${YOUTUBE_COMMENTS_URL}?${params.toString()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token.accessToken}` },
    })

    if (!response.ok) {
      const error = await readGoogleError(response)
      throw new SocialCommentApiError('youtube', error.code, error.message, response.status, isRetryableStatus(response.status), error.retryAfter)
    }

    const data = await readJson(response)
    for (const reply of Array.isArray(data?.items) ? data.items : []) {
      const mapped = mapYouTubeComment(reply, externalContentId, parentExternalCommentId, threadExternalId, token.accountExternalId)
      if (mapped) replies.push(mapped)
    }
    pageToken = typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : null
  } while (pageToken)

  return replies
}

export async function listYouTubeComments(
  token: CommentTokenContext,
  externalContentId: string
): Promise<SocialCommentListResult> {
  if (isBrokerEnabled()) {
    return callCommentBroker<SocialCommentListResult>('youtube', 'listYouTubeComments', { token, externalContentId })
  }
  const comments: ExternalSocialComment[] = []
  let pageToken: string | null = null
  let topLevelCount = 0
  let topLevelLimitReached = false

  do {
    const params = new URLSearchParams({
      part: 'snippet,replies',
      videoId: externalContentId,
      maxResults: String(YOUTUBE_PAGE_SIZE),
      order: 'time',
      textFormat: 'plainText',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const response = await fetch(`${YOUTUBE_COMMENT_THREADS_URL}?${params.toString()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token.accessToken}` },
    })

    if (!response.ok) {
      const error = await readGoogleError(response)
      throw new SocialCommentApiError('youtube', error.code, error.message, response.status, isRetryableStatus(response.status), error.retryAfter)
    }

    const data = await readJson(response)
    for (const thread of Array.isArray(data?.items) ? data.items : []) {
      if (topLevelCount >= YOUTUBE_MAX_TOP_LEVEL_COMMENTS) {
        topLevelLimitReached = true
        break
      }

      const topLevel = thread?.snippet?.topLevelComment
      const threadId = thread?.id || topLevel?.id || null
      const topLevelComment = mapYouTubeComment(topLevel, externalContentId, null, threadId, token.accountExternalId)
      const parentId = topLevel?.id || topLevelComment?.external_comment_id || null
      if (topLevelComment) {
        topLevelCount += 1
        const totalReplyCount = numberValue(thread?.snippet?.totalReplyCount)
        const embeddedReplies = Array.isArray(thread?.replies?.comments) ? thread.replies.comments : []
        topLevelComment.reply_count = totalReplyCount
        topLevelComment.can_reply = !topLevelComment.is_from_account && thread?.snippet?.canReply !== false
        topLevelComment.metadata = {
          ...(topLevelComment.metadata || {}),
          totalReplyCount,
          embeddedReplyCount: embeddedReplies.length,
        }
        comments.push(topLevelComment)

        const replies = parentId && totalReplyCount > embeddedReplies.length
          ? await listYouTubeCommentReplies(token, externalContentId, parentId, threadId)
          : embeddedReplies
            .map((reply: any) => mapYouTubeComment(reply, externalContentId, parentId, threadId, token.accountExternalId))
            .filter(Boolean) as ExternalSocialComment[]
        comments.push(...replies)
      }
    }

    if (topLevelLimitReached) break
    pageToken = typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : null
  } while (pageToken && topLevelCount < YOUTUBE_MAX_TOP_LEVEL_COMMENTS)

  if (pageToken && topLevelCount >= YOUTUBE_MAX_TOP_LEVEL_COMMENTS) {
    topLevelLimitReached = true
  }

  if (topLevelLimitReached) {
    for (const comment of comments) {
      if (!comment.parent_external_comment_id) {
        comment.metadata = {
          ...(comment.metadata || {}),
          topLevelLimitReached: true,
          topLevelLimit: YOUTUBE_MAX_TOP_LEVEL_COMMENTS,
        }
      }
    }
  }

  return {
    comments,
    replies_fetched: true,
    truncated: topLevelLimitReached,
    thread_completeness: topLevelLimitReached ? 'truncated' : 'complete',
  }
}

export async function replyToYouTubeComment(
  token: CommentTokenContext,
  parentExternalCommentId: string,
  message: string
): Promise<ExternalSocialComment> {
  if (isBrokerEnabled()) {
    return callCommentBroker<ExternalSocialComment>('youtube', 'replyToYouTubeComment', {
      token,
      parentExternalCommentId,
      message,
    })
  }
  const params = new URLSearchParams({ part: 'snippet' })
  const response = await fetch(`${YOUTUBE_COMMENTS_URL}?${params.toString()}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      snippet: {
        parentId: parentExternalCommentId,
        textOriginal: message,
      },
    }),
  })

  if (!response.ok) {
    const error = await readGoogleError(response)
    throw new SocialCommentApiError('youtube', error.code, error.message, response.status, isRetryableStatus(response.status), error.retryAfter)
  }

  const data = await readJson(response)
  const mapped = mapYouTubeComment(data, '', parentExternalCommentId, parentExternalCommentId, token.accountExternalId)
  if (!mapped) {
    throw new SocialCommentApiError('youtube', 'invalid_response', 'YouTube returned an invalid comment response.')
  }
  return mapped
}

function mapInstagramComment(
  comment: any,
  externalContentId: string,
  parentExternalCommentId: string | null,
  accountExternalId: string
): ExternalSocialComment | null {
  const id = textValue(comment?.id)
  const message = textValue(comment?.text)
  if (!id || !message) return null
  const authorId = textValue(comment?.from?.id) || null
  const authorName = textValue(comment?.from?.username || comment?.username) || null
  const isFromAccount = Boolean(authorId && accountExternalId && authorId === accountExternalId)

  return {
    external_comment_id: id,
    external_content_id: externalContentId,
    parent_external_comment_id: parentExternalCommentId,
    thread_external_id: parentExternalCommentId || id,
    author_id: authorId,
    author_name: authorName,
    author_avatar_url: null,
    message,
    like_count: numberValue(comment?.like_count),
    reply_count: Array.isArray(comment?.replies?.data) ? comment.replies.data.length : numberValue(comment?.replies?.summary?.total_count),
    can_reply: !isFromAccount,
    is_from_account: isFromAccount,
    permalink: null,
    remote_created_at: toIso(comment?.timestamp),
    metadata: {
      hidden: Boolean(comment?.hidden),
    },
  }
}

async function listRemainingInstagramReplies(
  token: CommentTokenContext,
  externalContentId: string,
  parentExternalCommentId: string,
  embeddedReplies: any[],
  repliesEdge: any,
  options: { fetchFirstPage?: boolean; fields?: string } = {}
): Promise<{ comments: ExternalSocialComment[]; truncated: boolean }> {
  const comments: ExternalSocialComment[] = []
  const seen = new Set<string>()

  const append = (reply: any) => {
    if (comments.length >= INSTAGRAM_COMMENT_SYNC_LIMITS.repliesPerComment) return false
    const mapped = mapInstagramComment(reply, externalContentId, parentExternalCommentId, token.accountExternalId)
    if (!mapped || seen.has(mapped.external_comment_id)) return true
    seen.add(mapped.external_comment_id)
    comments.push(mapped)
    return comments.length < INSTAGRAM_COMMENT_SYNC_LIMITS.repliesPerComment
  }

  for (const reply of embeddedReplies) {
    if (!append(reply)) break
  }

  let hasNext = hasMetaNextPage(repliesEdge)
  let after = readMetaAfterCursor(repliesEdge)
  let truncated = comments.length >= INSTAGRAM_COMMENT_SYNC_LIMITS.repliesPerComment && hasNext
  const seenCursors = new Set<string>()
  let fetchFirstPage = options.fetchFirstPage === true

  while ((fetchFirstPage || hasNext) && !truncated) {
    if (!fetchFirstPage && (!after || seenCursors.has(after))) {
      truncated = true
      break
    }
    if (!fetchFirstPage && after) seenCursors.add(after)

    const params = new URLSearchParams({
      fields: options.fields || INSTAGRAM_FACEBOOK_REPLY_FIELDS,
      limit: String(INSTAGRAM_PAGE_SIZE),
    })
    if (!fetchFirstPage && after) params.set('after', after)
    const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(parentExternalCommentId)}/replies?${params.toString()}`, {
      cache: 'no-store',
      headers: instagramGraphHeaders(token.accessToken),
    })

    if (!response.ok) {
      const error = await readMetaError(response)
      throw new SocialCommentApiError('instagram', error.subcode || error.code, error.message, response.status, isRetryableStatus(response.status), error.retryAfter)
    }

    const data = await readJson(response)
    fetchFirstPage = false
    const pageReplies = Array.isArray(data?.data) ? data.data : []
    for (let index = 0; index < pageReplies.length; index += 1) {
      if (!append(pageReplies[index])) {
        truncated = index < pageReplies.length - 1 || hasMetaNextPage(data)
        break
      }
    }
    if (truncated) break

    hasNext = hasMetaNextPage(data)
    after = readMetaAfterCursor(data)
  }

  const paginationComplete = !truncated
  for (const comment of comments) {
    comment.metadata = {
      ...(comment.metadata || {}),
      pagination_complete: paginationComplete,
      truncated,
      reply_limit: INSTAGRAM_COMMENT_SYNC_LIMITS.repliesPerComment,
    }
  }

  return { comments, truncated }
}

export async function listInstagramComments(
  token: CommentTokenContext,
  externalContentId: string
): Promise<InstagramCommentListResult> {
  if (isBrokerEnabled()) {
    return callCommentBroker<InstagramCommentListResult>('instagram', 'listInstagramComments', { token, externalContentId })
  }
  let repliesFetched = true
  const comments: ExternalSocialComment[] = []
  const topLevelComments: ExternalSocialComment[] = []
  const seenTopLevelComments = new Set<string>()
  let after: string | null = null
  let providerRawCount = 0
  let mappedCount = 0
  let topLevelCount = 0
  let topLevelTruncated = false
  const seenCursors = new Set<string>()
  const providerReportedCommentCount = await readInstagramReportedCommentCount(token, externalContentId)

  do {
    const params = new URLSearchParams({
      fields: INSTAGRAM_AUTH_MODE === 'instagram' ? INSTAGRAM_NATIVE_COMMENT_FIELDS : INSTAGRAM_FACEBOOK_COMMENT_FIELDS,
      limit: String(INSTAGRAM_PAGE_SIZE),
    })
    if (after) params.set('after', after)

    const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(externalContentId)}/comments?${params.toString()}`, {
      cache: 'no-store',
      headers: instagramGraphHeaders(token.accessToken),
    })

    if (!response.ok) {
      const error = await readMetaError(response)
      throw new SocialCommentApiError('instagram', error.subcode || error.code, error.message, response.status, isRetryableStatus(response.status), error.retryAfter)
    }

    const data = await readJson(response)
    const pageComments = Array.isArray(data?.data) ? data.data : []
    providerRawCount += pageComments.length
    for (let index = 0; index < pageComments.length; index += 1) {
      if (topLevelCount >= INSTAGRAM_COMMENT_SYNC_LIMITS.topLevel) {
        topLevelTruncated = index < pageComments.length || hasMetaNextPage(data)
        break
      }

      const comment = pageComments[index]
      const mapped = mapInstagramComment(comment, externalContentId, null, token.accountExternalId)
      if (!mapped || seenTopLevelComments.has(mapped.external_comment_id)) continue

      seenTopLevelComments.add(mapped.external_comment_id)
      topLevelCount += 1
      mappedCount += 1

      const embeddedReplies = Array.isArray(comment?.replies?.data) ? comment.replies.data : []
      let replies: { comments: ExternalSocialComment[]; truncated: boolean }
      try {
        replies = await listRemainingInstagramReplies(
          token,
          externalContentId,
          mapped.external_comment_id,
          embeddedReplies,
          comment?.replies,
          {
            fetchFirstPage: INSTAGRAM_AUTH_MODE === 'instagram',
            fields: INSTAGRAM_AUTH_MODE === 'instagram' ? INSTAGRAM_NATIVE_REPLY_FIELDS : INSTAGRAM_FACEBOOK_REPLY_FIELDS,
          }
        )
      } catch (error) {
        if (
          INSTAGRAM_AUTH_MODE === 'instagram'
          && error instanceof SocialCommentApiError
          && (error.httpStatus === 400 || error.httpStatus === 403)
        ) {
          repliesFetched = false
          replies = { comments: [], truncated: false }
        } else {
          throw error
        }
      }
      mapped.reply_count = Math.max(mapped.reply_count, replies.comments.length)
      mapped.metadata = {
        ...(mapped.metadata || {}),
        pagination_complete: repliesFetched && !replies.truncated,
        replies_fetched: repliesFetched,
        truncated: replies.truncated,
        reply_limit: INSTAGRAM_COMMENT_SYNC_LIMITS.repliesPerComment,
      }
      topLevelComments.push(mapped)
      comments.push(mapped, ...replies.comments)
    }

    if (topLevelTruncated || topLevelCount >= INSTAGRAM_COMMENT_SYNC_LIMITS.topLevel) {
      topLevelTruncated = topLevelTruncated || hasMetaNextPage(data)
      break
    }

    const hasNext = hasMetaNextPage(data)
    const nextAfter = hasNext ? readMetaAfterCursor(data) : null
    if (hasNext && (!nextAfter || seenCursors.has(nextAfter))) {
      topLevelTruncated = true
      break
    }
    after = nextAfter
    if (nextAfter) seenCursors.add(nextAfter)
  } while (after)

  for (const comment of topLevelComments) {
    const replyTruncated = repliesFetched && comment.metadata?.truncated === true
    comment.metadata = {
      ...(comment.metadata || {}),
      pagination_complete: repliesFetched && !topLevelTruncated && !replyTruncated,
      top_level_pagination_complete: !topLevelTruncated,
      replies_fetched: repliesFetched,
      truncated: topLevelTruncated || replyTruncated,
      top_level_limit: INSTAGRAM_COMMENT_SYNC_LIMITS.topLevel,
      provider_raw_count: providerRawCount,
      mapped_count: mappedCount,
    }
  }

  const providerVisibilityMismatch = providerRawCount === 0
    && typeof providerReportedCommentCount === 'number'
    && providerReportedCommentCount > 0
  let threadCompleteness: 'complete' | 'incomplete' | 'truncated' = 'complete'
  if (topLevelTruncated || topLevelComments.some((comment) => comment.metadata?.truncated === true)) {
    threadCompleteness = 'truncated'
  } else if (!repliesFetched || providerVisibilityMismatch) {
    threadCompleteness = 'incomplete'
  }

  return {
    comments,
    metadata: {
      provider_raw_count: providerRawCount,
      provider_reported_comment_count: providerReportedCommentCount,
      provider_visibility_mismatch: providerVisibilityMismatch,
      mapped_count: mappedCount,
      top_level_pagination_complete: !topLevelTruncated,
      replies_fetched: repliesFetched,
      truncated: topLevelTruncated || topLevelComments.some((comment) => comment.metadata?.truncated === true),
      thread_completeness: threadCompleteness,
    },
  }
}

export async function replyToInstagramComment(
  token: CommentTokenContext,
  parentExternalCommentId: string,
  externalContentId: string,
  message: string
): Promise<ExternalSocialComment> {
  if (isBrokerEnabled()) {
    return callCommentBroker<ExternalSocialComment>('instagram', 'replyToInstagramComment', {
      token,
      parentExternalCommentId,
      externalContentId,
      message,
    })
  }
  const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(parentExternalCommentId)}/replies`, {
    method: 'POST',
    cache: 'no-store',
    headers: instagramGraphHeaders(token.accessToken, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ message }),
  })

  if (!response.ok) {
    const error = await readMetaError(response)
    throw new SocialCommentApiError('instagram', error.subcode || error.code, error.message, response.status, isRetryableStatus(response.status), error.retryAfter)
  }

  const data = await readJson(response)
  const id = textValue(data?.id)
  if (!id) {
    throw new SocialCommentApiError('instagram', 'invalid_response', 'Instagram returned an invalid reply response.')
  }

  return {
    external_comment_id: id,
    external_content_id: externalContentId,
    parent_external_comment_id: parentExternalCommentId,
    thread_external_id: parentExternalCommentId,
    author_id: token.accountExternalId,
    author_name: token.accountName,
    author_avatar_url: null,
    message,
    like_count: 0,
    reply_count: 0,
    can_reply: false,
    is_from_account: true,
    permalink: null,
    remote_created_at: new Date().toISOString(),
    metadata: {},
  }
}

function mapFacebookComment(
  comment: any,
  externalContentId: string,
  parentExternalCommentId: string | null,
  accountExternalId: string
): ExternalSocialComment | null {
  const id = textValue(comment?.id)
  const message = textValue(comment?.message)
  if (!id || !message) return null

  const authorId = textValue(comment?.from?.id) || null
  const isFromAccount = Boolean(authorId && accountExternalId && authorId === accountExternalId)

  return {
    external_comment_id: id,
    external_content_id: externalContentId,
    parent_external_comment_id: parentExternalCommentId,
    thread_external_id: parentExternalCommentId || id,
    author_id: authorId,
    author_name: textValue(comment?.from?.name) || null,
    author_avatar_url: null,
    message,
    like_count: numberValue(comment?.like_count),
    reply_count: numberValue(comment?.comment_count),
    can_reply: !isFromAccount && comment?.can_comment !== false,
    is_from_account: isFromAccount,
    permalink: textValue(comment?.permalink_url) || null,
    remote_created_at: toIso(comment?.created_time),
    metadata: {
      canRemove: comment?.can_remove ?? null,
      canHide: comment?.can_hide ?? null,
      first_page_only: false,
      truncated: false,
    },
  }
}

async function fetchFacebookCommentPage(
  accessToken: string,
  objectId: string,
  after: string | null
) {
  const params = new URLSearchParams({
    fields: 'id,message,from,created_time,like_count,comment_count,can_comment,can_remove,can_hide,permalink_url',
    limit: String(FACEBOOK_PAGE_SIZE),
    order: 'reverse_chronological',
    appsecret_proof: getFacebookAppSecretProof(accessToken),
  })
  if (after) params.set('after', after)

  const response = await fetch(`${FACEBOOK_GRAPH_URL}/${encodeURIComponent(objectId)}/comments?${params.toString()}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    const error = await readMetaError(response)
    throw new SocialCommentApiError('facebook', error.subcode || error.code, error.message, response.status, isRetryableStatus(response.status), error.retryAfter)
  }
  return readJson(response)
}

async function listFacebookCommentReplies(
  token: CommentTokenContext,
  externalContentId: string,
  parentExternalCommentId: string
): Promise<{ comments: ExternalSocialComment[]; truncated: boolean }> {
  const comments: ExternalSocialComment[] = []
  let after: string | null = null
  let truncated = false

  do {
    const data = await fetchFacebookCommentPage(token.accessToken, parentExternalCommentId, after)
    for (const reply of Array.isArray(data?.data) ? data.data : []) {
      if (comments.length >= FACEBOOK_MAX_REPLIES_PER_COMMENT) {
        truncated = true
        break
      }
      const mapped = mapFacebookComment(reply, externalContentId, parentExternalCommentId, token.accountExternalId)
      if (mapped) comments.push(mapped)
    }
    if (truncated) break
    const hasNext = hasMetaNextPage(data)
    const nextAfter = readMetaAfterCursor(data)
    if (comments.length >= FACEBOOK_MAX_REPLIES_PER_COMMENT && hasNext) {
      truncated = true
      break
    }
    if (!hasNext) break
    if (!nextAfter) {
      truncated = true
      break
    }
    after = nextAfter
  } while (comments.length < FACEBOOK_MAX_REPLIES_PER_COMMENT)

  return { comments, truncated }
}

export async function listFacebookComments(
  token: CommentTokenContext,
  externalContentId: string
): Promise<ExternalSocialComment[]> {
  if (isBrokerEnabled()) {
    return callCommentBroker<ExternalSocialComment[]>('facebook', 'listFacebookComments', { token, externalContentId })
  }
  const comments: ExternalSocialComment[] = []
  let topLevelCount = 0
  let after: string | null = null
  let topLevelTruncated = false
  let replyTruncated = false

  do {
    const data = await fetchFacebookCommentPage(token.accessToken, externalContentId, after)
    for (const comment of Array.isArray(data?.data) ? data.data : []) {
      if (topLevelCount >= FACEBOOK_MAX_TOP_LEVEL_COMMENTS) {
        topLevelTruncated = true
        break
      }
      const mapped = mapFacebookComment(comment, externalContentId, null, token.accountExternalId)
      if (!mapped) continue
      topLevelCount += 1
      comments.push(mapped)

      if (mapped.reply_count > 0) {
        const replies = await listFacebookCommentReplies(token, externalContentId, mapped.external_comment_id)
        comments.push(...replies.comments)
        replyTruncated = replyTruncated || replies.truncated
      }
    }
    if (topLevelTruncated) break
    const hasNext = hasMetaNextPage(data)
    const nextAfter = readMetaAfterCursor(data)
    if (topLevelCount >= FACEBOOK_MAX_TOP_LEVEL_COMMENTS && hasNext) {
      topLevelTruncated = true
      break
    }
    if (!hasNext) break
    if (!nextAfter) {
      topLevelTruncated = true
      break
    }
    after = nextAfter
  } while (topLevelCount < FACEBOOK_MAX_TOP_LEVEL_COMMENTS)

  const truncated = topLevelTruncated || replyTruncated
  if (truncated) {
    for (const comment of comments) {
      comment.metadata = { ...(comment.metadata || {}), truncated: true }
    }
  }

  return comments
}

export async function replyToFacebookComment(
  token: CommentTokenContext,
  parentExternalCommentId: string,
  externalContentId: string,
  message: string
): Promise<ExternalSocialComment> {
  if (isBrokerEnabled()) {
    return callCommentBroker<ExternalSocialComment>('facebook', 'replyToFacebookComment', {
      token,
      parentExternalCommentId,
      externalContentId,
      message,
    })
  }
  const accessToken = token.accessToken
  const body = new URLSearchParams({
    message,
    appsecret_proof: getFacebookAppSecretProof(accessToken),
  })

  const response = await fetch(`${FACEBOOK_GRAPH_URL}/${encodeURIComponent(parentExternalCommentId)}/comments`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    const error = await readMetaError(response)
    throw new SocialCommentApiError('facebook', error.subcode || error.code, error.message, response.status, isRetryableStatus(response.status), error.retryAfter)
  }

  const data = await readJson(response)
  const id = textValue(data?.id)
  if (!id) {
    throw new SocialCommentApiError('facebook', 'invalid_response', 'Facebook returned an invalid reply response.')
  }

  return {
    external_comment_id: id,
    external_content_id: externalContentId,
    parent_external_comment_id: parentExternalCommentId,
    thread_external_id: parentExternalCommentId,
    author_id: token.accountExternalId,
    author_name: token.accountName,
    author_avatar_url: null,
    message,
    like_count: 0,
    reply_count: 0,
    can_reply: false,
    is_from_account: true,
    permalink: null,
    remote_created_at: new Date().toISOString(),
    metadata: {},
  }
}

interface TikTokBusinessCommentTokenContext extends CommentTokenContext {
  accountExternalId: string
}

interface TikTokBusinessCommentListPage {
  comments: any[]
  cursor: number | null
  hasMore: boolean
}

interface TikTokRequestBudget {
  remaining: number
}

function tikTokReadRetryDelayMs(retryAfter: string | null, attempt: number): number {
  let providerDelay = 0
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    providerDelay = Number(retryAfter.trim()) * 1000
  } else if (retryAfter) {
    const timestamp = Date.parse(retryAfter)
    if (Number.isFinite(timestamp)) providerDelay = Math.max(0, timestamp - Date.now())
  }
  const exponential = 250 * 2 ** attempt
  const jitter = Math.floor(Math.random() * 251)
  return Math.min(2000, Math.max(providerDelay, exponential) + jitter)
}

async function waitForTikTokReadRetry(delayMs: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function mapTikTokBusinessComment(
  value: any,
  externalContentId: string,
  accountExternalId: string,
  fallbackParentId: string | null,
): ExternalSocialComment | null {
  const commentId = textValue(value?.comment_id).trim()
  const message = textValue(value?.text)
  if (!commentId || !message.trim()) return null

  const parentId = textValue(value?.parent_comment_id).trim() || fallbackParentId
  const isFromAccount = value?.owner === true
    || (textValue(value?.user_id).trim() !== ''
      && textValue(value?.user_id).trim() === accountExternalId)

  return {
    external_comment_id: commentId,
    external_content_id: externalContentId,
    parent_external_comment_id: parentId,
    thread_external_id: parentId || commentId,
    author_id: textValue(value?.user_id).trim() || null,
    author_name: textValue(value?.display_name).trim()
      || textValue(value?.username).trim()
      || textValue(value?.unique_identifier).trim()
      || null,
    author_avatar_url: textValue(value?.profile_image).trim() || null,
    message,
    like_count: safeNonNegativeInteger(value?.likes),
    reply_count: safeNonNegativeInteger(value?.replies),
    can_reply: !isFromAccount,
    is_from_account: isFromAccount,
    permalink: null,
    remote_created_at: tikTokDateTime(value?.create_time),
    metadata: {
      provider: 'tiktok_business',
      visibility: textValue(value?.status).trim() || null,
      liked: value?.liked === true,
      pinned: value?.pinned === true,
    },
  }
}

async function fetchTikTokBusinessCommentPage(
  token: TikTokBusinessCommentTokenContext,
  endpoint: '/business/comment/list/' | '/business/comment/reply/list/',
  externalContentId: string,
  parentExternalCommentId: string | null,
  cursor: number,
  requestBudget: TikTokRequestBudget,
): Promise<TikTokBusinessCommentListPage> {
  const params = new URLSearchParams({
    business_id: token.accountExternalId,
    video_id: externalContentId,
    status: 'ALL',
    cursor: String(cursor),
    max_count: String(TIKTOK_COMMENT_PAGE_SIZE),
  })
  if (parentExternalCommentId) {
    params.set('comment_id', parentExternalCommentId)
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (requestBudget.remaining <= 0) {
      throw new SocialCommentApiError(
        'tiktok',
        'comment_read_budget_exhausted',
        'TikTok comment synchronization reached its provider call budget.',
        429,
        true,
        '60',
      )
    }
    requestBudget.remaining -= 1

    let response: Response
    try {
      response = await fetch(`${TIKTOK_BUSINESS_API_URL}${endpoint}?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Access-Token': token.accessToken,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(TIKTOK_COMMENT_TIMEOUT_MS),
      })
    } catch {
      if (attempt < 2 && requestBudget.remaining > 0) {
        await waitForTikTokReadRetry(tikTokReadRetryDelayMs(null, attempt))
        continue
      }
      throw new SocialCommentApiError(
        'tiktok',
        'provider_unreachable',
        'TikTok Business comment service is temporarily unreachable.',
        503,
        true,
      )
    }

    const payload = await readJson(response)
    if (
      !response.ok
      || payload?.code !== 0
      || !payload?.data
      || typeof payload.data !== 'object'
      || Array.isArray(payload.data)
    ) {
      const code = payload?.code === undefined ? String(response.status) : String(payload.code)
      const retryable = isRetryableStatus(response.status)
        || response.ok && Number(payload?.code) >= 50000
      const retryAfter = readRetryAfter(response)
      if (retryable && attempt < 2 && requestBudget.remaining > 0) {
        await waitForTikTokReadRetry(tikTokReadRetryDelayMs(retryAfter, attempt))
        continue
      }
      throw new SocialCommentApiError(
        'tiktok',
        code,
        'TikTok Business comment request failed.',
        response.ok ? 502 : response.status,
        retryable,
        retryAfter,
      )
    }

    const rawItems = parentExternalCommentId
      ? payload.data.reply_list || payload.data.comments
      : payload.data.comments || payload.data.comment_list
    if (!Array.isArray(rawItems) || typeof payload.data.has_more !== 'boolean') {
      throw new SocialCommentApiError(
        'tiktok',
        'invalid_response',
        'TikTok Business returned an invalid comment list response.',
        502,
      )
    }
    const nextCursor = parseTikTokCursor(payload.data.cursor)
    if (payload.data.has_more === true && nextCursor === null) {
      throw new SocialCommentApiError(
        'tiktok',
        'invalid_response',
        'TikTok Business returned an invalid comment pagination cursor.',
        502,
      )
    }
    return {
      comments: rawItems,
      cursor: nextCursor,
      hasMore: payload.data.has_more,
    }
  }

  throw new SocialCommentApiError(
    'tiktok',
    'provider_unreachable',
    'TikTok Business comment service is temporarily unreachable.',
    503,
    true,
  )
}

async function listTikTokBusinessCommentPages(
  token: TikTokBusinessCommentTokenContext,
  externalContentId: string,
  parentExternalCommentId: string | null,
  limit: number,
  requestBudget: TikTokRequestBudget,
  initialCursor = 0,
): Promise<{ comments: ExternalSocialComment[]; truncated: boolean; resumeCursor: number | null }> {
  const comments: ExternalSocialComment[] = []
  const seenCommentIds = new Set<string>()
  const seenCursors = new Set<number>()
  let cursor = initialCursor
  let resumeCursor: number | null = null
  let truncated = false
  let pageCount = 0
  const maxPages = Math.ceil(limit / TIKTOK_COMMENT_PAGE_SIZE)
  let paginationComplete = false

  while (comments.length < limit && pageCount < maxPages) {
    if (requestBudget.remaining <= 0) {
      truncated = true
      resumeCursor = cursor
      break
    }
    if (seenCursors.has(cursor)) {
      truncated = true
      break
    }
    seenCursors.add(cursor)
    pageCount += 1

    const page = await fetchTikTokBusinessCommentPage(
      token,
      parentExternalCommentId
        ? '/business/comment/reply/list/'
        : '/business/comment/list/',
      externalContentId,
      parentExternalCommentId,
      cursor,
      requestBudget,
    )
    for (const rawComment of page.comments) {
      const mapped = mapTikTokBusinessComment(
        rawComment,
        externalContentId,
        token.accountExternalId,
        parentExternalCommentId,
      )
      if (!mapped || seenCommentIds.has(mapped.external_comment_id)) continue
      seenCommentIds.add(mapped.external_comment_id)
      comments.push(mapped)
      if (comments.length >= limit) break
    }

    if (!page.hasMore) {
      paginationComplete = true
      break
    }
    if (page.cursor === null || page.cursor === cursor) {
      truncated = true
      break
    }
    cursor = page.cursor
    if (comments.length >= limit) {
      truncated = true
      resumeCursor = cursor
    }
  }

  if (pageCount >= maxPages && !paginationComplete) {
    truncated = true
    resumeCursor = cursor
  }

  return { comments, truncated, resumeCursor }
}

export async function listTikTokComments(
  token: TikTokBusinessCommentTokenContext,
  externalContentId: string,
  budget: TikTokCommentReadBudget = { topLevelRequests: 5, replyRequests: 15 },
): Promise<SocialCommentListResult> {
  if (isBrokerEnabled()) {
    return callCommentBroker<SocialCommentListResult>('tiktok', 'listTikTokComments', {
      token,
      externalContentId,
      budget,
    })
  }

  const topLevelBudget = { remaining: Math.max(0, Math.trunc(budget.topLevelRequests)) }
  const resumeCursor = Number.isSafeInteger(budget.resumeCursor) && Number(budget.resumeCursor) > 0
    ? Number(budget.resumeCursor)
    : null
  // Always read the newest page first. When a prior run paused deeper
  // pagination, spend the remaining shared budget resuming that backlog so
  // newly-arrived comments are not hidden until the backlog is exhausted.
  const newest = await listTikTokBusinessCommentPages(
    token,
    externalContentId,
    null,
    resumeCursor === null ? TIKTOK_MAX_TOP_LEVEL_COMMENTS : TIKTOK_COMMENT_PAGE_SIZE,
    topLevelBudget,
  )
  const backlog = resumeCursor !== null && topLevelBudget.remaining > 0
    ? await listTikTokBusinessCommentPages(
      token,
      externalContentId,
      null,
      Math.max(1, TIKTOK_MAX_TOP_LEVEL_COMMENTS - newest.comments.length),
      topLevelBudget,
      resumeCursor,
    )
    : null
  const topLevelComments = [...newest.comments]
  const comments = [...topLevelComments]
  const seenTopLevelIds = new Set(comments.map((comment) => comment.external_comment_id))
  for (const comment of backlog?.comments || []) {
    if (seenTopLevelIds.has(comment.external_comment_id)) continue
    seenTopLevelIds.add(comment.external_comment_id)
    topLevelComments.push(comment)
    comments.push(comment)
  }
  let truncated = newest.truncated || backlog?.truncated === true
  const replyBudget = { remaining: Math.max(0, Math.trunc(budget.replyRequests)) }

  const priorReplyParents = Array.isArray(budget.replyResume?.parent_ids)
    ? budget.replyResume.parent_ids.filter((value) => typeof value === 'string' && value.length > 0)
    : []
  const currentReplyParents = topLevelComments
    .filter((comment) => comment.reply_count > 0)
    .map((comment) => comment.external_comment_id)
  const priorObservedParents = Array.isArray(budget.replyResume?.observed_parent_ids)
    ? budget.replyResume.observed_parent_ids.filter(
      (value) => typeof value === 'string' && value.length > 0,
    )
    : priorReplyParents
  const priorObservedSet = new Set(priorObservedParents)
  const freshReplyParents = currentReplyParents.filter((parentId) => !priorObservedSet.has(parentId))
  // Finish the persisted queue first, then process only parents first observed
  // in this sync. The observed snapshot prevents restarting a completed prefix
  // while ensuring newly-arrived parents are queued before reporting complete.
  const replyParentIds = Array.from(new Set(
    priorReplyParents.length > 0
      ? [...priorReplyParents, ...freshReplyParents]
      : currentReplyParents,
  )).slice(0, TIKTOK_MAX_TOP_LEVEL_COMMENTS)
  const observedReplyParentIds = Array.from(new Set([
    ...priorObservedParents,
    ...currentReplyParents,
  ])).slice(0, TIKTOK_MAX_TOP_LEVEL_COMMENTS)
  let replyResume: SocialCommentListResult['provider_reply_resume'] = null

  for (let index = 0; index < replyParentIds.length; index += 1) {
    const parentId = replyParentIds[index]
    if (replyBudget.remaining <= 0) {
      truncated = true
      replyResume = {
        parent_ids: replyParentIds.slice(index),
        observed_parent_ids: observedReplyParentIds,
        cursor: null,
      }
      break
    }
    const initialReplyCursor = index === 0
      && priorReplyParents[0] === parentId
      && Number.isSafeInteger(budget.replyResume?.cursor)
      && Number(budget.replyResume?.cursor) >= 0
      ? Number(budget.replyResume?.cursor)
      : 0
    const replies = await listTikTokBusinessCommentPages(
      token,
      externalContentId,
      parentId,
      TIKTOK_MAX_REPLIES_PER_COMMENT,
      replyBudget,
      initialReplyCursor,
    )
    comments.push(...replies.comments)
    truncated = truncated || replies.truncated
    if (replies.resumeCursor !== null) {
      replyResume = {
        parent_ids: replyParentIds.slice(index),
        observed_parent_ids: observedReplyParentIds,
        cursor: replies.resumeCursor,
      }
      break
    }
  }

  if (truncated) {
    for (const comment of comments) {
      comment.metadata = { ...(comment.metadata || {}), truncated: true }
    }
  }

  return {
    comments,
    replies_fetched: replyResume === null,
    truncated,
    thread_completeness: truncated ? 'truncated' : 'complete',
    provider_resume_cursor: backlog
      ? backlog.resumeCursor
      : resumeCursor !== null
      ? resumeCursor
      : newest.resumeCursor,
    provider_reply_resume: replyResume,
  }
}

export async function replyToTikTokComment(
  token: TikTokBusinessCommentTokenContext,
  parentExternalCommentId: string,
  externalContentId: string,
  message: string,
): Promise<ExternalSocialComment> {
  if (isBrokerEnabled()) {
    return callCommentBroker<ExternalSocialComment>('tiktok', 'replyToTikTokComment', {
      token,
      parentExternalCommentId,
      externalContentId,
      message,
    }, TIKTOK_REPLY_BROKER_TIMEOUT_MS)
  }

  let response: Response
  try {
    response = await fetch(`${TIKTOK_BUSINESS_API_URL}/business/comment/reply/create/`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Access-Token': token.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_id: token.accountExternalId,
        video_id: externalContentId,
        comment_id: parentExternalCommentId,
        text: message,
      }),
      signal: AbortSignal.timeout(TIKTOK_COMMENT_TIMEOUT_MS),
    })
  } catch {
    throw new SocialCommentApiError(
      'tiktok',
      'provider_unreachable',
      'TikTok Business comment service is temporarily unreachable.',
      503,
      true,
      null,
      'unknown',
    )
  }

  const payload = await readJson(response)
  if (
    !response.ok
    || payload?.code !== 0
    || !payload?.data
    || typeof payload.data !== 'object'
    || Array.isArray(payload.data)
  ) {
    const code = payload?.code === undefined ? String(response.status) : String(payload.code)
    const providerWriteOutcome: 'rejected' | 'unknown' = !response.ok
      ? isDefiniteWriteRejectionStatus(response.status)
        ? 'rejected'
        : 'unknown'
      : payload?.code !== undefined && payload.code !== 0
        ? 'rejected'
        : 'unknown'
    throw new SocialCommentApiError(
      'tiktok',
      code,
      'TikTok Business comment request failed.',
      response.ok ? 502 : response.status,
      isRetryableStatus(response.status),
      readRetryAfter(response),
      providerWriteOutcome,
    )
  }

  const rawComment = payload.data.comment
    && typeof payload.data.comment === 'object'
    && !Array.isArray(payload.data.comment)
    ? payload.data.comment
    : payload.data
  const mapped = mapTikTokBusinessComment(
    {
      ...rawComment,
      text: textValue(rawComment?.text).trim() ? rawComment.text : message,
    },
    externalContentId,
    token.accountExternalId,
    parentExternalCommentId,
  )
  if (!mapped) {
    throw new SocialCommentApiError(
      'tiktok',
      'invalid_response',
      'TikTok Business returned an invalid comment reply response.',
      502,
      false,
      null,
      'unknown',
    )
  }

  return {
    ...mapped,
    parent_external_comment_id: parentExternalCommentId,
    thread_external_id: parentExternalCommentId,
    author_id: mapped.author_id || token.accountExternalId,
    author_name: mapped.author_name || token.accountName,
    message: mapped.message || message,
    can_reply: false,
    is_from_account: true,
  }
}
