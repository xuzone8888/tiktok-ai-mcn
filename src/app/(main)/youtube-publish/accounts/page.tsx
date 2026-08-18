import Link from "next/link"

import { YouTubeBrandIcon } from "@/components/brand/YouTubeBrandIcon"
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
  icon: (
    <Link href="/youtube-publish/accounts" aria-label="YouTube Account Management">
      <YouTubeBrandIcon className="h-12 w-14" />
    </Link>
  ),
  requiredCommentScopes: [
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ],
  requireLegalConsent: true,
  legalConsentText: "绑定 YouTube 前，我已阅读并同意当前政策，并授权 Star Gaze 按所述方式处理 YouTube API 数据。",
  legalConsentTextEn: "Before connecting YouTube, I have read and accept the current policies and authorize Star Gaze to process YouTube API data as described.",
  disconnectConfirmation: "解绑将删除此频道在 Star Gaze 中的账号数据、评论缓存和相关发布记录，并安排撤销授权。如 Google 暂时不可用，刷新令牌会仅为重试撤权而在受限队列中暂存，最长不超过 7 天。YouTube 上的视频和评论不会被删除。是否继续？",
  disconnectConfirmationEn: "Disconnecting deletes this channel's account data, cached comments, and related publishing history from Star Gaze and schedules authorization revocation. If Google is temporarily unavailable, the refresh token is retained only in a restricted retry queue for no more than 7 days. Videos and comments hosted on YouTube will not be deleted. Continue?",
  deleteAllDataEndpoint: "/api/youtube/data",
  deleteAllDataLabel: "删除全部 YouTube 数据",
  deleteAllDataLabelEn: "Delete all YouTube data",
  deleteAllDataConfirmation: "这会删除你在 Star Gaze 中的全部 YouTube 账号数据、发布记录、评论缓存和日志，并安排撤销 Google 授权。如 Google 暂时不可用，刷新令牌会仅为重试撤权而在受限队列中暂存，最长不超过 7 天。YouTube 上的视频和评论不会被删除。此操作不可恢复，是否继续？",
  deleteAllDataConfirmationEn: "This permanently deletes all your YouTube account data, publishing history, cached comments, and logs from Star Gaze and schedules Google authorization revocation. If Google is temporarily unavailable, the refresh token is retained only in a restricted retry queue for no more than 7 days. Videos and comments hosted on YouTube will not be deleted. Continue?",
}

export default function YouTubeAccountsPage() {
  return <PlatformAccountsPage config={YOUTUBE_ACCOUNT_CONFIG} />
}
