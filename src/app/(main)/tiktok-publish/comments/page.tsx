import { notFound } from "next/navigation"

import SocialCommentsClient from "@/components/social-comments/SocialCommentsClient"
import {
  isTikTokCommentsPageEnabled,
  isTikTokCommentsReplyEnabled,
} from "@/lib/social-comments/feature-flag"

export default function TikTokCommentsPage() {
  if (!isTikTokCommentsPageEnabled()) {
    notFound()
  }

  return (
    <SocialCommentsClient
      platformLock="tiktok"
      tiktokReplyEnabled={isTikTokCommentsReplyEnabled()}
    />
  )
}
