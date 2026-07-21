import type { ExternalSocialComment, SocialCommentDirection, SocialCommentStatus } from '@/lib/social-comments/types'

export interface ExistingSocialCommentPersistence {
  direction: SocialCommentDirection
  status: SocialCommentStatus
  reply_to_comment_id: string | null
  can_reply: boolean
  is_from_account: boolean
}

export function resolveSocialCommentPersistence(
  comment: ExternalSocialComment,
  requestedDirection: SocialCommentDirection,
  requestedStatus: 'synced' | 'sent',
  requestedReplyToCommentId: string | null,
  existing?: ExistingSocialCommentPersistence
) {
  const preserveOutbound = existing?.direction === 'outbound'
  const direction: SocialCommentDirection = preserveOutbound || comment.is_from_account
    ? 'outbound'
    : requestedDirection

  return {
    direction,
    status: preserveOutbound
      ? existing.status || 'sent'
      : direction === 'outbound'
        ? 'sent'
        : requestedStatus,
    reply_to_comment_id: preserveOutbound
      ? existing.reply_to_comment_id || null
      : requestedReplyToCommentId,
    can_reply: preserveOutbound ? Boolean(existing.can_reply) : comment.can_reply,
    is_from_account: preserveOutbound ? Boolean(existing.is_from_account) : comment.is_from_account,
  }
}
