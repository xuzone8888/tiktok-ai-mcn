import Link from 'next/link'

import { FacebookBrandIcon } from '@/components/brand/FacebookBrandIcon'
import { PlatformPublishPage } from '@/components/publish/platform/PlatformPublishPage'
import { META_PLATFORM_CONFIGS } from '@/lib/publish/platform-config'
import { isFacebookCommentsPageEnabled } from '@/lib/social-comments/feature-flag'

export default function FacebookPublishPage() {
  return (
    <PlatformPublishPage
      config={{
        ...META_PLATFORM_CONFIGS.facebook,
        icon: (
          <Link href="/facebook-publish" aria-label="Facebook Video Management">
            <FacebookBrandIcon className="h-12 w-14" />
          </Link>
        ),
      }}
      showCommentManagement={isFacebookCommentsPageEnabled()}
    />
  )
}
