import {
  isYouTubeCommentsAutoSyncEnabled,
  isYouTubeCommentsPageEnabled,
} from "@/lib/social-comments/feature-flag"

import YouTubePublishClient from "./YouTubePublishClient"

export default function YouTubePublishPage() {
  return (
    <YouTubePublishClient
      showCommentManagement={isYouTubeCommentsPageEnabled()}
      enableYouTubeAutoSync={isYouTubeCommentsAutoSyncEnabled()}
    />
  )
}
