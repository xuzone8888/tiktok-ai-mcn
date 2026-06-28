import { Instagram } from 'lucide-react'

import { PlatformAccountsPage } from '@/components/publish/platform/PlatformAccountsPage'
import { META_PLATFORM_CONFIGS } from '@/lib/publish/platform-config'

export default function InstagramAccountsPage() {
  return (
    <PlatformAccountsPage
      config={{
        ...META_PLATFORM_CONFIGS.instagram,
        icon: <Instagram className="h-6 w-6 text-pink-300" />,
      }}
    />
  )
}
