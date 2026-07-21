import { Youtube } from "lucide-react"

import { PlatformAccountsPage } from "@/components/publish/platform/PlatformAccountsPage"

const YOUTUBE_ACCOUNT_CONFIG = {
  platformName: "YouTube",
  accountsPageTitle: "YouTube 账号管理",
  accountsPageTitleEn: "YouTube Account Management",
  accountsPageDescription: "绑定和管理 YouTube 频道、授权状态与账号数据。",
  accountsPageDescriptionEn: "Connect and manage YouTube channels, authorization status, and account data.",
  routeBase: "/youtube-publish",
  apiBase: "/api/youtube",
  emptyAccountTitle: "还没有绑定 YouTube 频道",
  emptyAccountTitleEn: "No YouTube channel connected yet",
  emptyAccountDescription: "绑定频道后，可以发布视频并管理评论。",
  emptyAccountDescriptionEn: "Connect a channel to publish videos and manage comments.",
  bindButtonText: "绑定 YouTube 频道",
  bindButtonTextEn: "Connect YouTube channel",
  statsVideoLabel: "视频",
  statsVideoLabelEn: "Videos",
  icon: <Youtube className="h-6 w-6 text-red-300" />,
  requiredCommentScopes: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ],
}

export default function YouTubeAccountsPage() {
  return <PlatformAccountsPage config={YOUTUBE_ACCOUNT_CONFIG} />
}
