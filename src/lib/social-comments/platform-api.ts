import { getFacebookAppSecretProof } from '@/lib/facebook/oauth'
import { instagramGraphHeaders } from '@/lib/instagram/graph-auth'
import { getInstagramAuthMode } from '@/lib/instagram/oauth'
import type { ExternalSocialComment, SocialCommentListResult, SocialPlatform } from '@/lib/social-comments/types'

const YOUTUBE_COMMENT_THREADS_URL = 'https://www.googleapis.com/youtube/v3/commentThreads'
const YOUTUBE_COMMENTS_URL = 'https://www.googleapis.com/youtube/v3/comments'
const YOUTUBE_PAGE_SIZE = 100
const YOUTUBE_MAX_TOP_LEVEL_COMMENTS = 500
const FACEBOOK_API_VERSION = process.env.FACEBOOK_API_VERSION || 'v20.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`
const FACEBOOK_PAGE_SIZE = 100
const FACEBOOK_MAX_TOP_LEVEL_COMMENTS = 500
const FACEBOOK_MAX_REPLIES_PER_COMMENT = 500
const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_API_VERSION || process.env.FACEBOOK_API_VERSION || 'v20.0'
const INSTAGRAM_AUTH_MODE = getInstagramAuthMode()
const INSTAGRAM_GRAPH_URL = INSTAGRAM_AUTH_MODE === 'instagram'
  ? `https://graph.instagram.com/${INSTAGRAM_API_VERSION}`
  : `https://graph.facebook.com/${INSTAGRAM_API_VERSION}`
const INSTAGRAM_PAGE_SIZE = 50
const INSTAGRAM_NATIVE_COMMENT_FIELDS = 'from,text'
const INSTAGRAM_FACEBOOK_COMMENT_FIELDS = 'id,text,from{id,username},timestamp,like_count,hidden,replies{id,text,from{id,username},timestamp,like_count,hidden}'
const INSTAGRAM_FACEBOOK_REPLY_FIELDS = 'id,text,from{id,username},timestamp,like_count,hidden'
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

  constructor(platform: SocialPlatform, code: string, message: string, httpStatus = 500, retryable = false, retryAfter: string | null = null) {
    super(message)
    this.name = 'SocialCommentApiError'
    this.platform = platform
    this.code = code
    this.httpStatus = httpStatus
    this.retryable = retryable
    this.retryAfter = retryAfter
  }
}

export class SocialCommentUnsupportedError extends SocialCommentApiError {
  constructor(platform: SocialPlatform, message: string) {
    super(platform, 'unsupported_platform_operation', message, 501, false)
    this.name = 'SocialCommentUnsupportedError'
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
    mapped_count: number
    top_level_pagination_complete: boolean
    replies_fetched: boolean
    truncated: boolean
    thread_completeness: SocialCommentListResult['thread_completeness']
  }
}

type CommentOperation = 'read' | 'reply'
type CommentScopeRequirement = {
  read: string[]
  reply: string[]
}

export const COMMENT_SCOPE_REQUIREMENTS: Record<Exclude<SocialPlatform, 'tiktok' | 'instagram'>, CommentScopeRequirement> = {
  youtube: {
    read: ['https://www.googleapis.com/auth/youtube.readonly'],
    reply: ['https://www.googleapis.com/auth/youtube.force-ssl'],
  },
  facebook: {
    read: ['pages_read_engagement'],
    reply: ['pages_manage_engagement'],
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
  return platform === 'instagram'
    ? hasAllRequiredScopes(scopes, required)
    : hasAnyRequiredScope(scopes, required)
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
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
  repliesEdge: any
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

  while (hasNext && !truncated) {
    if (!after || seenCursors.has(after)) {
      truncated = true
      break
    }
    seenCursors.add(after)

    const params = new URLSearchParams({
      fields: INSTAGRAM_FACEBOOK_REPLY_FIELDS,
      limit: String(INSTAGRAM_PAGE_SIZE),
      after,
    })
    const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(parentExternalCommentId)}/replies?${params.toString()}`, {
      cache: 'no-store',
      headers: instagramGraphHeaders(token.accessToken),
    })

    if (!response.ok) {
      const error = await readMetaError(response)
      throw new SocialCommentApiError('instagram', error.subcode || error.code, error.message, response.status, isRetryableStatus(response.status), error.retryAfter)
    }

    const data = await readJson(response)
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
  const fetchReplies = INSTAGRAM_AUTH_MODE !== 'instagram'
  const comments: ExternalSocialComment[] = []
  const topLevelComments: ExternalSocialComment[] = []
  const seenTopLevelComments = new Set<string>()
  let after: string | null = null
  let providerRawCount = 0
  let mappedCount = 0
  let topLevelCount = 0
  let topLevelTruncated = false
  const seenCursors = new Set<string>()

  do {
    const params = new URLSearchParams({
      fields: fetchReplies ? INSTAGRAM_FACEBOOK_COMMENT_FIELDS : INSTAGRAM_NATIVE_COMMENT_FIELDS,
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

      if (!fetchReplies) {
        topLevelComments.push(mapped)
        comments.push(mapped)
        continue
      }

      const embeddedReplies = Array.isArray(comment?.replies?.data) ? comment.replies.data : []
      const replies = await listRemainingInstagramReplies(
        token,
        externalContentId,
        mapped.external_comment_id,
        embeddedReplies,
        comment?.replies
      )
      mapped.reply_count = Math.max(mapped.reply_count, replies.comments.length)
      mapped.metadata = {
        ...(mapped.metadata || {}),
        pagination_complete: !replies.truncated,
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
    const replyTruncated = fetchReplies && comment.metadata?.truncated === true
    comment.metadata = {
      ...(comment.metadata || {}),
      pagination_complete: fetchReplies && !topLevelTruncated && !replyTruncated,
      top_level_pagination_complete: !topLevelTruncated,
      replies_fetched: fetchReplies,
      truncated: topLevelTruncated || replyTruncated,
      top_level_limit: INSTAGRAM_COMMENT_SYNC_LIMITS.topLevel,
      provider_raw_count: providerRawCount,
      mapped_count: mappedCount,
    }
  }

  return {
    comments,
    metadata: {
      provider_raw_count: providerRawCount,
      mapped_count: mappedCount,
      top_level_pagination_complete: !topLevelTruncated,
      replies_fetched: fetchReplies,
      truncated: topLevelTruncated || topLevelComments.some((comment) => comment.metadata?.truncated === true),
      thread_completeness: topLevelTruncated || topLevelComments.some((comment) => comment.metadata?.truncated === true)
        ? 'truncated'
        : !fetchReplies
          ? 'incomplete'
          : 'complete',
    },
  }
}

export async function replyToInstagramComment(
  token: CommentTokenContext,
  parentExternalCommentId: string,
  externalContentId: string,
  message: string
): Promise<ExternalSocialComment> {
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

export async function replyToTikTokComment(): Promise<ExternalSocialComment> {
  throw new SocialCommentUnsupportedError(
    'tiktok',
    'TikTok does not provide a public creator comment reply endpoint for Login Kit or Content Posting API accounts.'
  )
}
