export const TIKTOK_COMMENT_REPLY_MAX_CODE_POINTS = 1200

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length
}

export function isTikTokCommentReplyWithinLimit(value: string): boolean {
  return countUnicodeCodePoints(value) <= TIKTOK_COMMENT_REPLY_MAX_CODE_POINTS
}
