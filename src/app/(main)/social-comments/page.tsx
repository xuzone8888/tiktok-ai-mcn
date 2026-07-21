import { notFound } from "next/navigation"

import { isSocialCommentsCenterEnabled } from "@/lib/social-comments/feature-flag"
import SocialCommentsClient from "@/components/social-comments/SocialCommentsClient"

export default function SocialCommentsPage() {
  if (!isSocialCommentsCenterEnabled()) {
    notFound()
  }

  return <SocialCommentsClient />
}
