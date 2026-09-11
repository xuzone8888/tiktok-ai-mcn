import { notFound } from "next/navigation"

import SocialCommentsClient from "@/components/social-comments/SocialCommentsClient"
import {
  isSocialCommentsCenterEnabled,
  isTikTokCommentsReplyEnabled,
} from "@/lib/social-comments/feature-flag"

export default function SocialCommentsPage() {
  if (!isSocialCommentsCenterEnabled()) {
    notFound()
  }

  return <SocialCommentsClient tiktokReplyEnabled={isTikTokCommentsReplyEnabled()} />
}
