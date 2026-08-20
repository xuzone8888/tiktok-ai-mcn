import Link from 'next/link'

import { FacebookBrandIcon } from '@/components/brand/FacebookBrandIcon'
import { PlatformAccountsPage } from '@/components/publish/platform/PlatformAccountsPage'
import { META_PLATFORM_CONFIGS } from '@/lib/publish/platform-config'

export default function FacebookAccountsPage() {
  return (
    <PlatformAccountsPage
      config={{
        ...META_PLATFORM_CONFIGS.facebook,
        icon: (
          <Link href="/facebook-publish/accounts" aria-label="Facebook Account Management">
            <FacebookBrandIcon className="h-12 w-14" />
          </Link>
        ),
        passLanguageToAuth: true,
      }}
    />
  )
}
