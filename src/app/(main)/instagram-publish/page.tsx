import { Instagram } from 'lucide-react'

import { PlatformPublishPage } from '@/components/publish/platform/PlatformPublishPage'
import { META_PLATFORM_CONFIGS } from '@/lib/publish/platform-config'

export default function InstagramPublishPage() {
  return (
    <PlatformPublishPage
      config={{
        ...META_PLATFORM_CONFIGS.instagram,
        icon: <Instagram className="h-6 w-6 text-pink-300" />,
      }}
    />
  )
}
