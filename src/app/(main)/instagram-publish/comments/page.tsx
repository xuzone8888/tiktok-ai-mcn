import { notFound } from "next/navigation"

import SocialCommentsClient from "@/components/social-comments/SocialCommentsClient"
import { getInstagramAuthMode } from "@/lib/instagram/oauth"
import {
  isInstagramCommentsPageEnabled,
  isInstagramCommentsReplyEnabled,
} from "@/lib/social-comments/feature-flag"

export default function InstagramCommentsPage() {
  if (!isInstagramCommentsPageEnabled() || getInstagramAuthMode() !== "instagram") {
    notFound()
  }

  return (
    <SocialCommentsClient
      platformLock="instagram"
      instagramReplyEnabled={isInstagramCommentsReplyEnabled()}
    />
  )
}
