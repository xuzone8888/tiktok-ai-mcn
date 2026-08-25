import { FacebookBrandIcon } from '@/components/brand/FacebookBrandIcon'
import { PlatformAccountsPage } from '@/components/publish/platform/PlatformAccountsPage'
import { META_PLATFORM_CONFIGS } from '@/lib/publish/platform-config'

export default function FacebookAccountsPage() {
  return (
    <PlatformAccountsPage
      config={{
        ...META_PLATFORM_CONFIGS.facebook,
        icon: <FacebookBrandIcon className="h-8 w-8" />,
        passLanguageToAuth: true,
        showAuthCallbackWarning: true,
      }}
    />
  )
}
