import { Share2 } from 'lucide-react'

import { PlatformAccountsPage } from '@/components/publish/platform/PlatformAccountsPage'
import { META_PLATFORM_CONFIGS } from '@/lib/publish/platform-config'

export default function FacebookAccountsPage() {
  return (
    <PlatformAccountsPage
      config={{
        ...META_PLATFORM_CONFIGS.facebook,
        icon: <Share2 className="h-6 w-6 text-cyan-300" />,
      }}
    />
  )
}
