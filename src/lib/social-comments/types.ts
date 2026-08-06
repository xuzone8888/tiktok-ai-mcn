export type SocialPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook'

export type SocialCommentDirection = 'inbound' | 'outbound'

export type SocialCommentStatus =
  | 'synced'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'unsupported'
  | 'deleted'
  | 'hidden'

export interface SocialAccountSummary {
  id: string
  platform: SocialPlatform
  external_id: string
  name: string
  handle: string | null
  avatar_url: string | null
  status: string
  scopes: string[]
  needs_reconnect_for_comments: boolean
  comment_capability: 'ready' | 'needs_reconnect' | 'read_only' | 'needs_verification' | 'unsupported'
}

export interface SocialContentItem {
  id: string
  platform: SocialPlatform
  account_id: string
  external_content_id: string
  title: string
  url: string | null
  preview_url: string | null
  thumbnail_url: string | null
  published_at: string | null
  task_name: string | null
}

export type SocialCommentThreadCompleteness = 'complete' | 'incomplete' | 'truncated' | 'unknown'

export interface SocialCommentSyncCompleteness {
  thread_completeness: SocialCommentThreadCompleteness
  replies_fetched: boolean
  truncated: boolean
  provider_reported_comment_count?: number | null
  provider_visibility_mismatch?: boolean
}

export interface SocialCommentListResult extends SocialCommentSyncCompleteness {
  comments: ExternalSocialComment[]
}

export interface ExternalSocialComment {
  external_comment_id: string
  external_content_id: string
  parent_external_comment_id: string | null
  thread_external_id: string | null
  author_id: string | null
  author_name: string | null
  author_avatar_url: string | null
  message: string
  like_count: number
  reply_count: number
  can_reply: boolean
  is_from_account: boolean
  permalink: string | null
  remote_created_at: string | null
  metadata?: Record<string, unknown>
}

export interface SavedSocialComment extends ExternalSocialComment {
  id: string
  user_id: string
  platform: SocialPlatform
  account_id: string
  task_item_id: string | null
  direction: SocialCommentDirection
  status: SocialCommentStatus
  local_error_code: string | null
  local_error_message: string | null
  reply_to_comment_id: string | null
  created_at: string
  updated_at: string
  replies?: SavedSocialComment[]
}

export interface SavedSocialCommentTranslation {
  comment_id: string
  target_language: 'zh' | 'en'
  detected_source_language: string | null
  translated_text: string | null
  status: 'translated' | 'same_language'
}

export interface CommentFilters {
  platform?: SocialPlatform | 'all'
  accountId?: string
  contentId?: string
  status?: string
  limit?: number
  offset?: number
}

export interface CommentSyncTarget {
  platform: SocialPlatform
  accountId: string
  contentId: string
}

export const SOCIAL_PLATFORMS: SocialPlatform[] = ['youtube', 'tiktok', 'instagram', 'facebook']

export function isSocialPlatform(value: string | null | undefined): value is SocialPlatform {
  return Boolean(value && SOCIAL_PLATFORMS.includes(value as SocialPlatform))
}

export function normalizeScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean)
  return []
}
