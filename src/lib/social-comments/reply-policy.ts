import type { SocialPlatform } from '@/lib/social-comments/types'
import { isSocialCommentOperationSupported } from '@/lib/social-comments/platform-capabilities'

export function isSocialCommentReplyPlatformEnabled(
  platform: SocialPlatform,
  instagramReplyEnabled: boolean,
  tiktokReplyEnabled = false,
): boolean {
  return isSocialCommentOperationSupported(platform, 'reply', {
    instagramReplyEnabled,
    tiktokReplyEnabled,
  })
}
