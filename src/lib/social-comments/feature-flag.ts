import { SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/social-comments/types'

export function isSocialCommentsApiEnabled() {
  return process.env.SOCIAL_COMMENTS_API_ENABLED === 'true'
}

export function getEnabledSocialCommentPlatforms(): SocialPlatform[] {
  const raw = process.env.SOCIAL_COMMENTS_ENABLED_PLATFORMS || ''
  const seen = new Set<SocialPlatform>()

  for (const value of raw.split(/[,\s]+/)) {
    const platform = value.trim().toLowerCase()
    if (SOCIAL_PLATFORMS.includes(platform as SocialPlatform)) {
      seen.add(platform as SocialPlatform)
    }
  }

  return [...seen]
}

export function isSocialCommentPlatformEnabled(platform: SocialPlatform) {
  return getEnabledSocialCommentPlatforms().includes(platform)
}

export function isYouTubeCommentsPageEnabled() {
  return process.env.NEXT_PUBLIC_YOUTUBE_COMMENTS_ENABLED === 'true'
}

export function isInstagramCommentsPageEnabled() {
  return process.env.NEXT_PUBLIC_INSTAGRAM_COMMENTS_ENABLED === 'true'
}

export function isInstagramCommentsReplyEnabled() {
  return process.env.INSTAGRAM_COMMENTS_REPLY_ENABLED === 'true'
}

export function isFacebookCommentsPageEnabled() {
  return process.env.NEXT_PUBLIC_FACEBOOK_COMMENTS_ENABLED === 'true'
}

export function isYouTubeCommentsAutoSyncEnabled() {
  return process.env.YOUTUBE_COMMENTS_AUTO_SYNC_ENABLED === 'true'
}

export function isSocialCommentsCenterEnabled() {
  return process.env.NEXT_PUBLIC_SOCIAL_COMMENTS_CENTER_ENABLED === 'true'
}
