import { Instagram } from 'lucide-react'

import { PlatformPublishPage } from '@/components/publish/platform/PlatformPublishPage'
import { getInstagramAuthMode } from '@/lib/instagram/oauth'
import { META_PLATFORM_CONFIGS } from '@/lib/publish/platform-config'
import {
  isInstagramCommentsPageEnabled,
  isInstagramCommentsReplyEnabled,
} from '@/lib/social-comments/feature-flag'

export default function InstagramPublishPage() {
  const showCommentManagement = isInstagramCommentsPageEnabled() && getInstagramAuthMode() === 'instagram'

  return (
    <PlatformPublishPage
      config={{
        ...META_PLATFORM_CONFIGS.instagram,
        icon: <Instagram className="h-6 w-6 text-pink-300" />,
      }}
      showCommentManagement={showCommentManagement}
      instagramReplyEnabled={showCommentManagement && isInstagramCommentsReplyEnabled()}
    />
  )
}
