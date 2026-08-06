import { notFound } from "next/navigation"

import SocialCommentsClient from "@/components/social-comments/SocialCommentsClient"
import {
  isYouTubeCommentsAutoSyncEnabled,
  isYouTubeCommentsPageEnabled,
} from "@/lib/social-comments/feature-flag"

export default function YouTubeCommentsPage() {
  if (!isYouTubeCommentsPageEnabled()) {
    notFound()
  }

  return (
    <SocialCommentsClient
      platformLock="youtube"
      autoSyncEnabled={isYouTubeCommentsAutoSyncEnabled()}
      initialSyncEnabled
    />
  )
}
