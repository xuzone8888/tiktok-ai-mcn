import { getSocialCommentPlatformCapabilities } from '@/lib/social-comments/platform-capabilities'
import { isSocialPlatform } from '@/lib/social-comments/types'

export type SocialCommentSyncSource = 'manual' | 'auto'

export function normalizeSocialCommentContentId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isSocialCommentSyncTargetValid(
  platform: string,
  source: SocialCommentSyncSource,
  contentId: string
): boolean {
  if (!isSocialPlatform(platform)) return false
  const capability = getSocialCommentPlatformCapabilities(platform)
  if (capability.sync !== 'supported') return false
  if (source === 'auto') return capability.auto_sync && contentId.length > 0
  return !capability.requires_explicit_content || contentId.length > 0
}

export function isSocialCommentRecentSyncAllowed(
  platform: string,
  source: SocialCommentSyncSource
): boolean {
  if (!isSocialPlatform(platform)) return false
  const capability = getSocialCommentPlatformCapabilities(platform)
  return source === 'manual' && capability.sync === 'supported' && capability.recent_sync
}
