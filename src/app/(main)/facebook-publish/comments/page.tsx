import { notFound } from "next/navigation"

import SocialCommentsClient from "@/components/social-comments/SocialCommentsClient"
import { isFacebookCommentsPageEnabled } from "@/lib/social-comments/feature-flag"

export default function FacebookCommentsPage() {
  if (!isFacebookCommentsPageEnabled()) {
    notFound()
  }

  return (
    <SocialCommentsClient
      platformLock="facebook"
      initialSyncEnabled
      backgroundInitialSync
        initialSyncDelayMs={5000}
      translationStartDelayMs={800}
    />
  )
}
