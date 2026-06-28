import { Share2 } from 'lucide-react'

import { PlatformPublishPage } from '@/components/publish/platform/PlatformPublishPage'
import { META_PLATFORM_CONFIGS } from '@/lib/publish/platform-config'

export default function FacebookPublishPage() {
  return (
    <PlatformPublishPage
      config={{
        ...META_PLATFORM_CONFIGS.facebook,
        icon: <Share2 className="h-6 w-6 text-cyan-300" />,
      }}
    />
  )
}
