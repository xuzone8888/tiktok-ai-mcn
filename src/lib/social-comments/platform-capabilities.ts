import type { SocialPlatform } from '@/lib/social-comments/types'

export type SocialCommentCapabilityState = 'supported' | 'feature_flag' | 'needs_verification' | 'unsupported'

export interface SocialCommentPlatformCapabilities {
  read: SocialCommentCapabilityState
  sync: SocialCommentCapabilityState
  reply: SocialCommentCapabilityState
  requires_explicit_content: boolean
  recent_sync: boolean
  auto_sync: boolean
}

export const SOCIAL_COMMENT_PLATFORM_CAPABILITIES: Record<SocialPlatform, SocialCommentPlatformCapabilities> = {
  youtube: {
    read: 'supported',
    sync: 'supported',
    reply: 'supported',
    requires_explicit_content: false,
    recent_sync: true,
    auto_sync: true,
  },
  instagram: {
    read: 'supported',
    sync: 'supported',
    reply: 'feature_flag',
    requires_explicit_content: true,
    recent_sync: false,
    auto_sync: false,
  },
  facebook: {
    read: 'supported',
    sync: 'supported',
    reply: 'supported',
    requires_explicit_content: false,
    recent_sync: true,
    auto_sync: false,
  },
  tiktok: {
    read: 'unsupported',
    sync: 'unsupported',
    reply: 'unsupported',
    requires_explicit_content: false,
    recent_sync: false,
    auto_sync: false,
  },
}

export function getSocialCommentPlatformCapabilities(platform: SocialPlatform) {
  return SOCIAL_COMMENT_PLATFORM_CAPABILITIES[platform]
}

export function isSocialCommentOperationSupported(
  platform: SocialPlatform,
  operation: 'read' | 'sync' | 'reply',
  options: { instagramReplyEnabled?: boolean } = {}
) {
  const state = SOCIAL_COMMENT_PLATFORM_CAPABILITIES[platform][operation]
  if (state === 'supported') return true
  return state === 'feature_flag' && platform === 'instagram' && options.instagramReplyEnabled === true
}
