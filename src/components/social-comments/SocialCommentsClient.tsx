"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare2,
  ChevronDown,
  Instagram,
  MessageCircle,
  Music2,
  RefreshCw,
  Send,
  Share2,
  Youtube,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useLang } from "@/contexts/LangContext"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { createWorkspaceRequestGuard, type WorkspaceRequestToken } from "./workspace-request-guard"
import { getSocialCommentPlatformCapabilities } from "@/lib/social-comments/platform-capabilities"
import { chunkTranslationIds } from "@/lib/social-comments/translation-core"
import type {
  SavedSocialComment,
  SavedSocialCommentTranslation,
  SocialAccountSummary,
  SocialCommentSyncCompleteness,
  SocialContentItem,
} from "@/lib/social-comments/types"

type Platform = "all" | "youtube" | "tiktok" | "instagram" | "facebook"
type ConcretePlatform = Exclude<Platform, "all">

type AccountSummary = SocialAccountSummary
type ContentItem = SocialContentItem
type SocialComment = SavedSocialComment

interface SocialCommentsClientProps {
  platformLock?: ConcretePlatform
  embedded?: boolean
  autoSyncEnabled?: boolean
  instagramReplyEnabled?: boolean
}

interface LoadErrorState {
  code?: string
  status?: number
}

const PLATFORM_ORDER: Platform[] = ["all", "youtube", "tiktok", "instagram", "facebook"]
const YOUTUBE_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000
const YOUTUBE_AUTO_SYNC_INITIAL_DELAY_MS = 2000

const TEXT = {
  title: { zh: "评论管理", en: "Comments" },
  youtubeTitle: { zh: "YouTube 评论管理", en: "YouTube Comments" },
  instagramTitle: { zh: "Instagram 评论管理", en: "Instagram Comment Management" },
  facebookTitle: { zh: "Facebook 评论管理", en: "Facebook Comment Management" },
  subtitle: {
    zh: "读取已发布视频/帖子的评论，并用绑定账号回复。",
    en: "Read comments on published content and reply from connected accounts.",
  },
  youtubeSubtitle: {
    zh: "读取已发布 YouTube 视频评论，并使用绑定频道人工回复。",
    en: "Read comments on published YouTube videos and reply manually from the connected channel.",
  },
  instagramSubtitle: {
    zh: "读取通过本平台发布的 Instagram 内容评论，并使用绑定账号手动回复。",
    en: "Read comments on Instagram content published through this platform and reply manually from the connected account.",
  },
  facebookSubtitle: {
    zh: "读取 Facebook Page 视频评论，并使用绑定 Page 手动回复。",
    en: "Read comments on Facebook Page videos and reply manually from the connected Page.",
  },
  platform: { zh: "平台", en: "Platform" },
  account: { zh: "账号", en: "Account" },
  youtubeAccount: { zh: "YouTube 频道", en: "YouTube channel" },
  instagramAccount: { zh: "Instagram 账号", en: "Instagram account" },
  facebookAccount: { zh: "Facebook Page", en: "Facebook Page" },
  content: { zh: "内容", en: "Content" },
  youtubeContent: { zh: "YouTube 视频", en: "YouTube video" },
  instagramContent: { zh: "Instagram 内容", en: "Instagram content" },
  facebookContent: { zh: "Facebook 视频", en: "Facebook video" },
  allPlatforms: { zh: "全部平台", en: "All platforms" },
  allAccounts: { zh: "全部账号", en: "All accounts" },
  selectYoutubeChannel: { zh: "选择 YouTube 频道", en: "Select a YouTube channel" },
  selectInstagramAccount: { zh: "选择 Instagram 账号", en: "Select an Instagram account" },
  selectFacebookAccount: { zh: "选择 Facebook Page", en: "Select a Facebook Page" },
  allContent: { zh: "全部内容", en: "All content" },
  selectYoutubeVideo: { zh: "选择已发布视频", en: "Select a published video" },
  selectInstagramContent: { zh: "选择已发布内容", en: "Select published content" },
  selectFacebookContent: { zh: "选择已发布视频", en: "Select a published video" },
  syncSelected: { zh: "同步所选内容", en: "Sync selected" },
  syncRecent: { zh: "同步最近内容", en: "Sync recent" },
  selectContentFirst: { zh: "请先选择内容", en: "Select content first" },
  syncing: { zh: "同步中", en: "Syncing" },
  refresh: { zh: "刷新", en: "Refresh" },
  reply: { zh: "回复", en: "Reply" },
  batchReply: { zh: "批量回复", en: "Batch reply" },
  sendBatchReply: { zh: "发送批量回复", en: "Send batch reply" },
  selectedComments: { zh: "条已选评论", en: "comments selected" },
  selectReplyable: { zh: "选择全部可回复评论", en: "Select all replyable comments" },
  batchReplyResult: { zh: "批量回复完成", en: "Batch reply completed" },
  sending: { zh: "发送中", en: "Sending" },
  writeReply: { zh: "写一条回复...", en: "Write a reply..." },
  noAccounts: { zh: "还没有可用账号", en: "No connected accounts" },
  noYoutubeAccounts: {
    zh: "还没有绑定 YouTube 频道。",
    en: "No YouTube channel is connected yet.",
  },
  noYoutubeAccountsHelp: {
    zh: "请先绑定 YouTube 频道，并授予评论读取和人工回复权限。",
    en: "Connect a YouTube channel first and grant comment read and manual reply permissions.",
  },
  connectYoutube: { zh: "绑定 YouTube 频道", en: "Connect YouTube channel" },
  noInstagramAccounts: {
    zh: "还没有绑定 Instagram 账号。",
    en: "No Instagram account is connected yet.",
  },
  noInstagramAccountsHelp: {
    zh: "请先绑定 Instagram 专业账号，再进行评论读取和手动回复测试。",
    en: "Connect an Instagram professional account before testing comment reads and manual replies.",
  },
  connectInstagram: { zh: "绑定 Instagram 账号", en: "Connect Instagram account" },
  noContent: { zh: "没有已发布内容", en: "No published content" },
  noYoutubeContent: {
    zh: "没有可管理的已发布 YouTube 视频。",
    en: "No published YouTube videos are available for comment management.",
  },
  noYoutubeContentHelp: {
    zh: "请先通过 YouTube 发布功能发布视频，评论管理只显示本平台发布且已成功的视频。",
    en: "Publish a video through YouTube Publish first. This page only shows videos published successfully from this platform.",
  },
  publishYoutubeVideo: { zh: "发布 YouTube 视频", en: "Publish YouTube video" },
  noInstagramContent: {
    zh: "没有可管理的已发布 Instagram 内容。",
    en: "No published Instagram content is available for comment management.",
  },
  noInstagramContentHelp: {
    zh: "评论管理只展示由本平台发布且任务项 status=published 的记录。",
    en: "Comment management only shows records published through this platform whose task item status is published.",
  },
  publishInstagramContent: { zh: "发布 Instagram 内容", en: "Publish Instagram content" },
  noComments: { zh: "暂无评论", en: "No comments yet" },
  noYoutubeComments: {
    zh: "暂无 YouTube 评论。",
    en: "No YouTube comments yet.",
  },
  noYoutubeCommentsHelp: {
    zh: "选择频道和已发布视频后点击同步；如果仍为空，可能是该视频暂无评论。",
    en: "Select a channel and published video, then click Sync. If it stays empty, the video may not have comments yet.",
  },
  noInstagramComments: {
    zh: "暂无 Instagram 评论。",
    en: "No Instagram comments yet.",
  },
  noInstagramCommentsHelp: {
    zh: "选择 Instagram 账号和已发布内容后手动点击同步；如果仍为空，该内容可能暂无评论。",
    en: "Select an Instagram account and published content, then sync manually. If it stays empty, the content may not have comments yet.",
  },
  synced: { zh: "同步请求已完成", en: "Sync completed" },
  partialSyncFailure: {
    zh: "部分内容同步失败或被节流",
    en: "Some content failed to sync or was throttled",
  },
  paginationTruncated: {
    zh: "评论或回复已达安全同步上限，本次结果已截断。",
    en: "Comments or replies reached the safe sync limit, so this result was truncated.",
  },
  autoRefreshOn: {
    zh: "自动刷新已开启：选中视频后每 5 分钟刷新一次评论。回复仍需手动发送。",
    en: "Auto refresh is on: comments refresh every 5 minutes after a video is selected. Replies are still manual.",
  },
  autoRefreshing: {
    zh: "自动刷新中...",
    en: "Auto refreshing...",
  },
  lastAutoRefresh: {
    zh: "上次自动刷新",
    en: "Last auto refresh",
  },
  showingCount: {
    zh: "显示",
    en: "Showing",
  },
  totalCount: {
    zh: "共",
    en: "of",
  },
  latestLimitNotice: {
    zh: "当前仅显示最近 120 条评论，请缩小筛选条件或后续加载更多。",
    en: "Showing the latest 120 comments. Narrow filters or load more later.",
  },
  replySent: { zh: "回复已发送", en: "Reply sent" },
  missingSelection: { zh: "请选择账号", en: "Select an account" },
  needsReconnect: {
    zh: "该账号缺少评论权限，请重新绑定账号并授予最新 OAuth scope。",
    en: "This account is missing comment permissions. Reconnect it with the latest OAuth scopes.",
  },
  youtubeScopeHelp: {
    zh: "YouTube 评论管理需要 youtube.readonly 读取评论，并需要 youtube.force-ssl 发送人工回复。",
    en: "YouTube comment management requires youtube.readonly to read comments and youtube.force-ssl to send manual replies.",
  },
  instagramScopeHelp: {
    zh: "当前 Native Instagram Login 模式需要实际授予 instagram_business_basic 和 instagram_business_manage_comments。请求这些 scopes 不代表已经授权。",
    en: "The current Native Instagram Login mode requires instagram_business_basic and instagram_business_manage_comments to be actually granted. Requesting these scopes does not mean they were granted.",
  },
  reconnectYoutube: { zh: "重新绑定 YouTube 频道", en: "Reconnect YouTube channel" },
  reconnectInstagram: { zh: "重新绑定 Instagram 账号", en: "Reconnect Instagram account" },
  readOnly: {
    zh: "该账号当前只能读取评论，回复需要重新授权或平台权限。",
    en: "This account can read comments only. Replies require renewed authorization or platform permissions.",
  },
  unsupported: {
    zh: "TikTok 普通 Login Kit / Content Posting API 不提供创作者评论读取或回复，请打开原平台处理评论。",
    en: "TikTok Login Kit / Content Posting API does not provide creator comment reading or replies. Open TikTok to manage comments.",
  },
  needsVerification: {
    zh: "该平台评论接口仍需验证，当前不开放同步或回复。",
    en: "Comment sync and reply for this platform still need verification and are disabled for now.",
  },
  error: { zh: "操作失败", en: "Action failed" },
  unableLoadAccounts: { zh: "无法加载账号", en: "Unable to load accounts" },
  unableLoadInstagramAccounts: { zh: "无法加载 Instagram 账号", en: "Unable to load Instagram accounts" },
  unableLoadContent: { zh: "无法加载已发布内容", en: "Unable to load published content" },
  unableLoadComments: { zh: "无法加载评论", en: "Unable to load comments" },
  retry: { zh: "重试", en: "Retry" },
  comments: { zh: "条评论", en: "comments" },
  likes: { zh: "赞", en: "likes" },
  replies: { zh: "条回复", en: "replies" },
  fromAccount: { zh: "账号回复", en: "Account reply" },
  openOnYouTube: { zh: "打开 YouTube 原视频", en: "Open on YouTube" },
  openOnInstagram: { zh: "在 Instagram 打开", en: "Open on Instagram" },
  openOnFacebook: { zh: "在 Facebook 打开", en: "Open on Facebook" },
  openComment: { zh: "打开原评论", en: "Open comment" },
  instagramLimitHelp: {
    zh: "Instagram 会分页读取评论和回复；达到安全同步上限时会明确提示截断。所有回复只能手动触发。",
    en: "Instagram comments and replies are read page by page. Truncation is reported when a safe sync limit is reached. All replies must be triggered manually.",
  },
  translating: { zh: "翻译中…", en: "Translating…" },
  translation: { zh: "中文翻译", en: "English translation" },
  translationUnavailable: { zh: "翻译暂不可用", en: "Translation unavailable" },
}

const PLATFORM_LABELS: Record<Platform, string> = {
  all: "All",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
}

const PLATFORM_STYLES: Record<ConcretePlatform, string> = {
  youtube: "border-red-400/40 bg-red-500/10 text-red-200",
  tiktok: "border-cyan-300/40 bg-cyan-500/10 text-cyan-200",
  instagram: "border-pink-300/40 bg-pink-500/10 text-pink-200",
  facebook: "border-blue-300/40 bg-blue-500/10 text-blue-200",
}

function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  if (platform === "youtube") return <Youtube className={className} />
  if (platform === "tiktok") return <Music2 className={className} />
  if (platform === "instagram") return <Instagram className={className} />
  if (platform === "facebook") return <Share2 className={className} />
  return <MessageCircle className={className} />
}

type SocialCommentsApiError = Error & {
  code?: string
  status?: number
}

function toLoadErrorState(error: unknown): LoadErrorState {
  const apiError = error as SocialCommentsApiError
  return {
    code: typeof apiError?.code === "string" ? apiError.code : undefined,
    status: typeof apiError?.status === "number" ? apiError.status : undefined,
  }
}

function LoadErrorPanel({
  title,
  retryLabel,
  onRetry,
}: {
  title: string
  retryLabel: string
  onRetry: () => void | Promise<void>
}) {
  return (
    <div className="rounded-lg border border-amber-300/25 bg-amber-500/10 p-8 text-center text-sm text-amber-100">
      <AlertTriangle className="mx-auto h-5 w-5" />
      <div className="mt-3 text-base font-medium">{title}</div>
      <Button
        variant="titanium-outline"
        className="mt-4 h-9 rounded-lg border-amber-200/35 text-amber-50 hover:bg-amber-300/10"
        onClick={() => void onRetry()}
      >
        <RefreshCw className="mr-2 h-4 w-4" />
        {retryLabel}
      </Button>
    </div>
  )
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.error || response.statusText) as SocialCommentsApiError
    if (typeof data?.code === "string") error.code = data.code
    error.status = response.status
    throw error
  }
  return data
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") search.set(key, String(value))
  }
  return search.toString()
}

function createReplyIdempotencyKey(commentId: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${commentId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatDate(value: string | null, lang: "zh" | "en") {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatTime(value: number, lang: "zh" | "en") {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function getAccountLabel(account: AccountSummary) {
  return account.handle ? `${account.name} (${account.handle})` : account.name
}

function getContentLabel(content: ContentItem) {
  return content.task_name ? `${content.title} · ${content.task_name}` : content.title
}

function isCommentReplyPlatformEnabled(comment: SocialComment, instagramReplyEnabled: boolean) {
  const capability = getSocialCommentPlatformCapabilities(comment.platform)
  return capability.reply === "supported"
    || (capability.reply === "feature_flag" && comment.platform === "instagram" && instagramReplyEnabled)
}

type TranslationUiState = {
  sourceText: string
  status: 'loading' | 'translated' | 'same_language' | 'error'
  translatedText: string | null
}

function flattenCommentsForTranslation(commentGroups: SocialComment[][]): SocialComment[] {
  const byId = new Map<string, SocialComment>()
  const visit = (comment: SocialComment) => {
    byId.set(comment.id, comment)
    for (const reply of comment.replies || []) visit(reply)
  }
  for (const group of commentGroups) {
    for (const comment of group) visit(comment)
  }
  return [...byId.values()]
}

function CommentTranslationLine({
  comment,
  lang,
  translations,
  className,
}: {
  comment: SocialComment
  lang: 'zh' | 'en'
  translations: Record<string, TranslationUiState>
  className?: string
}) {
  const state = translations[`${lang}:${comment.id}`]
  if (!state || state.sourceText !== comment.message || state.status === 'loading') {
    return <p className={cn("mt-1 text-xs text-cyan-100/35", className)}>{TEXT.translating[lang]}</p>
  }
  if (state.status === 'same_language') return null
  if (state.status === 'error' || !state.translatedText) {
    return <p className={cn("mt-1 text-xs text-white/25", className)}>{TEXT.translationUnavailable[lang]}</p>
  }
  return (
    <p className={cn("mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-cyan-100/60", className)}>
      <span className="mr-1 font-medium text-cyan-200/55">{TEXT.translation[lang]}:</span>
      {state.translatedText}
    </p>
  )
}

export default function SocialCommentsClient({
  platformLock,
  embedded = false,
  autoSyncEnabled = false,
  instagramReplyEnabled = false,
}: SocialCommentsClientProps) {
  const { lang } = useLang()
  const { toast } = useToast()
  const isYouTubeLocked = platformLock === "youtube"
  const isInstagramLocked = platformLock === "instagram"
  const isFacebookLocked = platformLock === "facebook"
  const lastAutoSyncAtByTarget = useRef<Map<string, number>>(new Map())
  const autoSyncInFlightTarget = useRef<string | null>(null)
  const contentAbortRef = useRef<AbortController | null>(null)
  const commentsAbortRef = useRef(new Map<string, AbortController>())
  const detailAbortRef = useRef<AbortController | null>(null)
  const contentSeqRef = useRef(0)
  const commentsSeqRef = useRef(new Map<string, number>())
  const detailSeqRef = useRef(0)
  const contentCacheRef = useRef(new Map<string, ContentItem[]>())
  const commentsCacheRef = useRef(new Map<string, { comments: SocialComment[]; total: number | null; loaded: number }>())
  const workspaceGuardRef = useRef(createWorkspaceRequestGuard("all:all"))
  const syncRequestTokenRef = useRef<symbol | null>(null)
  const autoSyncRequestTokenRef = useRef<symbol | null>(null)
  const [platform, setPlatform] = useState<Platform>(platformLock || "all")
  const [accountId, setAccountId] = useState("all")
  const [contentId, setContentId] = useState("all")
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [content, setContent] = useState<ContentItem[]>([])
  const [comments, setComments] = useState<SocialComment[]>([])
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null)
  const [detailComments, setDetailComments] = useState<SocialComment[]>([])
  const [detailTotal, setDetailTotal] = useState<number | null>(null)
  const [detailLoaded, setDetailLoaded] = useState(0)
  const [detailLoading, setDetailLoading] = useState(false)
  const [syncCompleteness, setSyncCompleteness] = useState<SocialCommentSyncCompleteness | null>(null)
  const [totalComments, setTotalComments] = useState<number | null>(null)
  const [loadedComments, setLoadedComments] = useState(0)
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<LoadErrorState | null>(null)
  const [contentError, setContentError] = useState<LoadErrorState | null>(null)
  const [commentsError, setCommentsError] = useState<LoadErrorState | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [autoSyncing, setAutoSyncing] = useState(false)
  const [autoSyncError, setAutoSyncError] = useState<string | null>(null)
  const [autoSyncLastCompletedAt, setAutoSyncLastCompletedAt] = useState<Record<string, number>>({})
  const [replying, setReplying] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [openReplies, setOpenReplies] = useState<Set<string>>(new Set())
  const [selectedReplyIds, setSelectedReplyIds] = useState<Set<string>>(new Set())
  const [batchReplyOpen, setBatchReplyOpen] = useState(false)
  const [batchDraft, setBatchDraft] = useState("")
  const [batchReplying, setBatchReplying] = useState(false)
  const [translations, setTranslations] = useState<Record<string, TranslationUiState>>({})

  const requestHeaders = useMemo(() => ({ "x-toryx-lang": lang }), [lang])

  const filteredAccounts = useMemo(() => {
    return accounts.filter((account) => platform === "all" || account.platform === platform)
  }, [accounts, platform])

  const selectedAccount = useMemo(() => {
    return accounts.find((account) => account.id === accountId) || null
  }, [accounts, accountId])
  const selectedPlatform = platformLock || (platform === "all" ? selectedAccount?.platform : platform)

  const selectedContent = useMemo(() => {
    return content.find((item) => item.id === contentId) || null
  }, [content, contentId])

  const selectedComment = useMemo(() => {
    return comments.find((comment) => comment.id === selectedCommentId) || null
  }, [comments, selectedCommentId])

  const translationCandidates = useMemo(
    () => flattenCommentsForTranslation([comments, detailComments]),
    [comments, detailComments]
  )
  const translationCandidateSignature = useMemo(
    () => translationCandidates.map((comment) => `${comment.id}:${comment.message}`).join('\u0001'),
    [translationCandidates]
  )

  const contentByExternalId = useMemo(() => {
    return new Map(content.map((item) => [item.external_content_id, item]))
  }, [content])

  const accountById = useMemo(() => {
    return new Map(accounts.map((account) => [account.id, account]))
  }, [accounts])

  const canSyncSelectedAccount = selectedAccount
    ? getSocialCommentPlatformCapabilities(selectedAccount.platform).sync !== "supported"
      ? false
      : selectedAccount.comment_capability === "ready" || selectedAccount.comment_capability === "read_only"
    : false
  const selectedPlatformCapabilities = selectedAccount
    ? getSocialCommentPlatformCapabilities(selectedAccount.platform)
    : null
  const autoSyncTargetKey = autoSyncEnabled && selectedAccount && selectedPlatformCapabilities?.auto_sync && accountId !== "all" && selectedContent?.id
    ? `${selectedAccount.platform}:${accountId}:${selectedContent.id}`
    : null
  const shouldShowAutoSyncStatus = Boolean(autoSyncEnabled && selectedPlatformCapabilities?.auto_sync)
  const selectedAutoSyncLastAt = autoSyncTargetKey ? autoSyncLastCompletedAt[autoSyncTargetKey] : undefined
  const canAttemptAutoSync = Boolean(
    autoSyncEnabled
      && selectedAccount
      && getSocialCommentPlatformCapabilities(selectedAccount.platform).auto_sync
      && accountId !== "all"
      && selectedContent?.id
      && canSyncSelectedAccount
      && !syncing
      && !commentsLoading
  )
  const inboxComments = comments.filter((comment) => !comment.parent_external_comment_id)
  const canReplyToComment = (comment: SocialComment) => Boolean(
    comment.direction === "inbound"
      && comment.can_reply
      && accountById.get(comment.account_id)?.comment_capability === "ready"
      && isCommentReplyPlatformEnabled(comment, instagramReplyEnabled)
  )
  const replyableInboxComments = inboxComments.filter(canReplyToComment)
  const allReplyableSelected = replyableInboxComments.length > 0
    && replyableInboxComments.every((comment) => selectedReplyIds.has(comment.id))

  useEffect(() => {
    if (translationCandidates.length === 0) return
    const pending = translationCandidates.filter((comment) => {
      const current = translations[`${lang}:${comment.id}`]
      return !current
        || current.sourceText !== comment.message
        || current.status === 'loading'
        || current.status === 'error'
    })
    if (pending.length === 0) return

    let cancelled = false
    const byId = new Map(pending.map((comment) => [comment.id, comment]))
    const chunks = chunkTranslationIds(pending.map((comment) => comment.id), 30)
    setTranslations((current) => {
      const next = { ...current }
      for (const comment of pending) {
        next[`${lang}:${comment.id}`] = {
          sourceText: comment.message,
          status: 'loading',
          translatedText: null,
        }
      }
      return next
    })

    const translateChunk = async (commentIds: string[]) => {
      try {
        const data = await fetch('/api/social-comments/translations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...requestHeaders,
          },
          body: JSON.stringify({ commentIds, targetLanguage: lang }),
        }).then(readJson) as { translations?: SavedSocialCommentTranslation[] }
        if (cancelled) return
        const received = new Map((data.translations || []).map((translation) => [translation.comment_id, translation]))
        setTranslations((current) => {
          const next = { ...current }
          for (const commentId of commentIds) {
            const source = byId.get(commentId)
            const translated = received.get(commentId)
            if (!source) continue
            next[`${lang}:${commentId}`] = translated
              ? {
                  sourceText: source.message,
                  status: translated.status,
                  translatedText: translated.translated_text,
                }
              : { sourceText: source.message, status: 'error', translatedText: null }
          }
          return next
        })
      } catch (error) {
        if (cancelled) return
        setTranslations((current) => {
          const next = { ...current }
          for (const commentId of commentIds) {
            const source = byId.get(commentId)
            if (source) next[`${lang}:${commentId}`] = { sourceText: source.message, status: 'error', translatedText: null }
          }
          return next
        })
      }
    }

    void (async () => {
      let nextIndex = 0
      const worker = async () => {
        while (!cancelled) {
          const chunk = chunks[nextIndex++]
          if (!chunk) return
          await translateChunk(chunk)
        }
      }
      await Promise.all([worker(), worker()])
    })()

    return () => { cancelled = true }
    // The signature intentionally tracks source-text changes without depending on the mutable translation cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, requestHeaders, translationCandidateSignature])

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setAccountsError(null)
    try {
      const data = await fetch("/api/social-comments/accounts", { headers: requestHeaders }).then(readJson)
      const nextAccounts: AccountSummary[] = data.accounts || []
      setAccounts(nextAccounts)
      if (platformLock) {
        const first = nextAccounts.find((item) => item.platform === platformLock)
        if (first) setAccountId((current) => current === "all" ? first.id : current)
      }
    } catch (error) {
      setAccountsError(toLoadErrorState(error))
      const description = isInstagramLocked ? TEXT.unableLoadInstagramAccounts[lang] : TEXT.unableLoadAccounts[lang]
      toast({
        title: TEXT.error[lang],
        description,
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [isInstagramLocked, lang, requestHeaders, toast])

  const loadContent = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const key = `${selectedPlatform || platform}:${accountId}`
    const seq = ++contentSeqRef.current
    contentAbortRef.current?.abort()
    const controller = new AbortController()
    contentAbortRef.current = controller
    if (!silent) setContentLoading(true)
    setContentError(null)
    try {
      const query = buildQuery({
        platform: selectedPlatform,
        accountId: accountId === "all" ? undefined : accountId,
        limit: 120,
      })
      const data = await fetch(`/api/social-comments/content?${query}`, { headers: requestHeaders, signal: controller.signal }).then(readJson)
      if (seq !== contentSeqRef.current || controller.signal.aborted) return
      const nextContent = data.content || []
      contentCacheRef.current.set(key, nextContent)
      setContent(nextContent)
    } catch (error) {
      if (controller.signal.aborted || seq !== contentSeqRef.current) return
      setContentError(toLoadErrorState(error))
      toast({
        title: TEXT.error[lang],
        description: TEXT.unableLoadContent[lang],
        variant: "destructive",
      })
    } finally {
      if (seq === contentSeqRef.current && !controller.signal.aborted) setContentLoading(false)
    }
  }, [accountId, lang, platform, requestHeaders, selectedPlatform, toast])

  const loadComments = useCallback(async ({
    silent = false,
    target,
    visibleToken,
  }: {
    silent?: boolean
    target?: { platform: ConcretePlatform; accountId: string }
    visibleToken?: WorkspaceRequestToken
  } = {}) => {
    const targetPlatform = target?.platform || selectedPlatform || platform
    const targetAccountId = target?.accountId || accountId
    const key = `${targetPlatform}:${targetAccountId}`
    const backgroundOnly = Boolean(visibleToken && !workspaceGuardRef.current.isActive(visibleToken))
    const seq = backgroundOnly ? -1 : (commentsSeqRef.current.get(key) || 0) + 1
    if (!backgroundOnly) {
      commentsSeqRef.current.set(key, seq)
      commentsAbortRef.current.get(key)?.abort()
    }
    const controller = new AbortController()
    if (!backgroundOnly) commentsAbortRef.current.set(key, controller)
    const canWriteVisible = () => workspaceGuardRef.current.currentKey() === key
      && (!visibleToken || workspaceGuardRef.current.isActive(visibleToken))
    if (!silent && canWriteVisible()) setCommentsLoading(true)
    if (canWriteVisible()) setCommentsError(null)
    try {
      const query = buildQuery({
        platform: targetPlatform,
        accountId: targetAccountId === "all" ? undefined : targetAccountId,
        limit: 120,
      })
      const data = await fetch(`/api/social-comments?${query}`, { headers: requestHeaders, signal: controller.signal }).then(readJson)
      if ((!backgroundOnly && seq !== commentsSeqRef.current.get(key)) || controller.signal.aborted) return
      const next = {
        comments: data.comments || [],
        total: typeof data.total === "number" ? data.total : null,
        loaded: typeof data.loadedCount === "number" ? data.loadedCount : (data.comments || []).length,
      }
      commentsCacheRef.current.set(key, next)
      if (canWriteVisible()) {
        setComments(next.comments)
        setTotalComments(next.total)
        setLoadedComments(next.loaded)
      }
    } catch (error) {
      if (controller.signal.aborted || backgroundOnly || seq !== commentsSeqRef.current.get(key) || !canWriteVisible()) return
      setCommentsError(toLoadErrorState(error))
      if (silent) {
        setAutoSyncError(TEXT.unableLoadComments[lang])
      } else {
        toast({
          title: TEXT.error[lang],
          description: TEXT.unableLoadComments[lang],
          variant: "destructive",
        })
      }
    } finally {
      if (!backgroundOnly && seq === commentsSeqRef.current.get(key) && !controller.signal.aborted && canWriteVisible()) setCommentsLoading(false)
    }
  }, [accountId, lang, platform, requestHeaders, selectedPlatform, toast])

  const loadDetailComments = useCallback(async (comment: SocialComment, { silent = false, visibleToken }: { silent?: boolean; visibleToken?: WorkspaceRequestToken } = {}) => {
    const seq = ++detailSeqRef.current
    detailAbortRef.current?.abort()
    const controller = new AbortController()
    detailAbortRef.current = controller
    if (!silent) setDetailLoading(true)
    try {
      const query = buildQuery({
        platform: comment.platform,
        accountId: comment.account_id,
        contentId: comment.external_content_id,
        limit: 200,
      })
      const data = await fetch(`/api/social-comments?${query}`, { headers: requestHeaders, signal: controller.signal }).then(readJson)
      if (seq !== detailSeqRef.current || controller.signal.aborted || (visibleToken && !workspaceGuardRef.current.isActive(visibleToken))) return
      setDetailComments(data.comments || [])
      setDetailTotal(typeof data.total === "number" ? data.total : null)
      setDetailLoaded(typeof data.loadedCount === "number" ? data.loadedCount : (data.comments || []).length)
    } catch (error) {
      if (controller.signal.aborted || seq !== detailSeqRef.current || (visibleToken && !workspaceGuardRef.current.isActive(visibleToken))) return
      toast({ title: TEXT.error[lang], description: TEXT.unableLoadComments[lang], variant: "destructive" })
    } finally {
      if (seq === detailSeqRef.current && !controller.signal.aborted && (!visibleToken || workspaceGuardRef.current.isActive(visibleToken))) setDetailLoading(false)
    }
  }, [lang, requestHeaders, toast])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    workspaceGuardRef.current.activate(`${selectedPlatform || platform}:${accountId}`)
  }, [accountId, platform, selectedPlatform])

  useEffect(() => {
    if (accountId === "all") {
      setContent([])
      setComments([])
      return
    }
    void loadContent({ silent: contentCacheRef.current.has(`${selectedPlatform || platform}:${accountId}`) })
  }, [loadContent])

  useEffect(() => {
    if (accountId !== "all") void loadComments({ silent: commentsCacheRef.current.has(`${selectedPlatform || platform}:${accountId}`) })
  }, [loadComments])

  useEffect(() => () => {
    contentAbortRef.current?.abort()
    commentsAbortRef.current.forEach((controller) => controller.abort())
    detailAbortRef.current?.abort()
  }, [])

  const changePlatform = (nextPlatform: Platform) => {
    if (platformLock) return
    workspaceGuardRef.current.activate(`${nextPlatform}:all`)
    setPlatform(nextPlatform)
    setAccountId("all")
    setContentId("all")
    setSelectedReplyIds(new Set())
    setOpenReplies(new Set())
    setBatchReplyOpen(false)
    setBatchDraft("")
    setBatchReplying(false)
  }

  const changeAccount = (nextAccountId: string) => {
    const nextAccount = accounts.find((item) => item.id === nextAccountId)
    const key = `${platformLock || nextAccount?.platform || platform}:${nextAccountId}`
    workspaceGuardRef.current.activate(key)
    contentAbortRef.current?.abort()
    detailAbortRef.current?.abort()
    contentSeqRef.current += 1
    detailSeqRef.current += 1
    syncRequestTokenRef.current = null
    autoSyncRequestTokenRef.current = null
    setSyncing(false)
    setAutoSyncing(false)
    setBatchReplying(false)
    setReplying(new Set())
    setSelectedReplyIds(new Set())
    setOpenReplies(new Set())
    setBatchReplyOpen(false)
    setBatchDraft("")
    setAccountId(nextAccountId)
    setContentId("all")
    setSelectedCommentId(null)
    setDetailComments([])
    setDetailTotal(null)
    setDetailLoaded(0)
    setSyncCompleteness(null)
    const cachedContent = contentCacheRef.current.get(key)
    const cachedComments = commentsCacheRef.current.get(key)
    setContent(cachedContent || [])
    setComments(cachedComments?.comments || [])
    setTotalComments(cachedComments?.total ?? null)
    setLoadedComments(cachedComments?.loaded || 0)
    setContentLoading(!cachedContent)
    setCommentsLoading(!cachedComments)
  }

  const selectComment = (comment: SocialComment) => {
    const visibleToken = workspaceGuardRef.current.capture()
    setSelectedCommentId(comment.id)
    const linkedContent = content.find((item) => item.external_content_id === comment.external_content_id)
    setContentId(linkedContent?.id || "all")
    setDetailComments([])
    setDetailTotal(null)
    setDetailLoaded(0)
    void loadDetailComments(comment, { visibleToken })
  }

  const syncComments = useCallback(async ({ source = "manual" }: { source?: "manual" | "auto" } = {}) => {
    const isAuto = source === "auto"
    const selectedContentId = selectedContent?.id
    if (accountId === "all") {
      if (!isAuto) toast({ title: TEXT.missingSelection[lang], variant: "destructive" })
      return { status: "skipped" as const }
    }

    if (selectedPlatformCapabilities?.requires_explicit_content && !selectedContentId) {
      if (!isAuto) toast({ title: TEXT.selectContentFirst[lang], variant: "destructive" })
      return { status: "skipped" as const }
    }

    const syncPlatform = selectedAccount?.platform
    if (!syncPlatform) return { status: "skipped" as const }
    if (isAuto && (syncPlatform !== "youtube" || !selectedContent?.id)) {
      return { status: "skipped" as const }
    }
    if (!canSyncSelectedAccount) {
      let description = TEXT.unsupported[lang]
      if (selectedAccount.comment_capability === "needs_verification") description = TEXT.needsVerification[lang]
      if (selectedAccount.comment_capability === "needs_reconnect") description = TEXT.needsReconnect[lang]
      if (selectedAccount.comment_capability === "read_only") description = TEXT.readOnly[lang]
      if (isAuto) {
        setAutoSyncError(description)
      } else {
        toast({ title: TEXT.error[lang], description, variant: "destructive" })
      }
      return { status: "skipped" as const }
    }

    const workspaceToken = workspaceGuardRef.current.capture()
    const syncTarget = { platform: syncPlatform, accountId }
    const requestToken = Symbol("social-comment-sync")
    syncRequestTokenRef.current = requestToken
    setSyncing(true)
    try {
      const idempotencyKey = isAuto && selectedContent?.id
        ? `auto:youtube:${accountId}:${selectedContent.id}:${Math.floor(Date.now() / YOUTUBE_AUTO_SYNC_INTERVAL_MS)}`
        : undefined
      const data = await fetch("/api/social-comments/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...requestHeaders,
        },
        body: JSON.stringify({
          platform: syncPlatform,
          accountId,
          contentId: selectedContentId,
          ...(isAuto ? { source: "auto" } : {}),
          ...(idempotencyKey ? { idempotencyKey } : {}),
        }),
      }).then(readJson)

      if (workspaceGuardRef.current.isActive(workspaceToken) && data.mode !== "recent") {
        setSyncCompleteness({
          thread_completeness: data.thread_completeness || "unknown",
          replies_fetched: data.replies_fetched === true,
          truncated: data.truncated === true,
        })
      }

      if (!isAuto && workspaceGuardRef.current.isActive(workspaceToken)) {
        const failedCount = Number(data.failedCount || 0)
        const descriptionParts = [
          `${data.syncedCount || 0} ${TEXT.comments[lang]}`,
        ]
        if (syncPlatform === "instagram" && data.truncated === true) {
          descriptionParts.push(TEXT.paginationTruncated[lang])
        }
        if (failedCount > 0) descriptionParts.push(TEXT.partialSyncFailure[lang])

        toast({
          title: TEXT.synced[lang],
          description: descriptionParts.join(" · "),
        })
      }
      await loadComments({ silent: isAuto, target: syncTarget, visibleToken: workspaceToken })
      return { status: "completed" as const, data }
    } catch (error) {
      const apiError = error as SocialCommentsApiError
      const isExpectedAutoThrottle = isAuto && (
        apiError.code === "sync_throttled"
          || apiError.code === "sync_already_running"
          || (apiError instanceof Error && /sync_(throttled|already_running)/.test(apiError.message))
      )
      if (!isExpectedAutoThrottle && workspaceGuardRef.current.isActive(workspaceToken)) {
        if (isAuto) {
          setAutoSyncError(apiError instanceof Error ? apiError.message : TEXT.error[lang])
        } else {
          toast({
            title: TEXT.error[lang],
            description: apiError instanceof Error ? apiError.message : undefined,
            variant: "destructive",
          })
        }
      }
      return { status: "failed" as const, error: apiError }
    } finally {
      if (syncRequestTokenRef.current === requestToken && workspaceGuardRef.current.isActive(workspaceToken)) {
        syncRequestTokenRef.current = null
        setSyncing(false)
      }
    }
  }, [accountId, canSyncSelectedAccount, lang, loadComments, requestHeaders, selectedAccount, selectedContent?.id, selectedPlatformCapabilities?.requires_explicit_content, toast])

  useEffect(() => {
    setAutoSyncError(null)
  }, [autoSyncTargetKey])

  const attemptAutoSync = useCallback(() => {
    if (!canAttemptAutoSync || !autoSyncTargetKey) return
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return
    if (autoSyncInFlightTarget.current) return

    const now = Date.now()
    const lastAutoSyncAt = lastAutoSyncAtByTarget.current.get(autoSyncTargetKey) || 0
    if (now - lastAutoSyncAt < YOUTUBE_AUTO_SYNC_INTERVAL_MS) return

    lastAutoSyncAtByTarget.current.set(autoSyncTargetKey, now)
    autoSyncInFlightTarget.current = autoSyncTargetKey
    const workspaceToken = workspaceGuardRef.current.capture()
    const requestToken = Symbol("social-comment-auto-sync")
    autoSyncRequestTokenRef.current = requestToken
    setAutoSyncing(true)
    setAutoSyncError(null)

    void (async () => {
      try {
        const result = await syncComments({ source: "auto" })
        if (result.status === "completed" && workspaceGuardRef.current.isActive(workspaceToken)) {
          const completedAt = Date.now()
          setAutoSyncLastCompletedAt((prev) => ({
            ...prev,
            [autoSyncTargetKey]: completedAt,
          }))
        }
      } finally {
        if (autoSyncInFlightTarget.current === autoSyncTargetKey) {
          autoSyncInFlightTarget.current = null
        }
        if (autoSyncRequestTokenRef.current === requestToken && workspaceGuardRef.current.isActive(workspaceToken)) {
          autoSyncRequestTokenRef.current = null
          setAutoSyncing(false)
        }
      }
    })()
  }, [autoSyncTargetKey, canAttemptAutoSync, syncComments])

  useEffect(() => {
    if (!canAttemptAutoSync || !autoSyncTargetKey) return

    const initialTimeout = window.setTimeout(attemptAutoSync, YOUTUBE_AUTO_SYNC_INITIAL_DELAY_MS)
    const interval = window.setInterval(attemptAutoSync, YOUTUBE_AUTO_SYNC_INTERVAL_MS)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        attemptAutoSync()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.clearTimeout(initialTimeout)
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [attemptAutoSync, autoSyncTargetKey, canAttemptAutoSync])

  const postReply = async (comment: SocialComment, message: string) => {
    await fetch(`/api/social-comments/${comment.id}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...requestHeaders,
      },
      body: JSON.stringify({
        message,
        idempotencyKey: createReplyIdempotencyKey(comment.id),
      }),
    }).then(readJson)
  }

  const sendReply = async (comment: SocialComment) => {
    const message = (drafts[comment.id] || "").trim()
    if (!message) return
    const workspaceToken = workspaceGuardRef.current.capture()
    const replyTarget = { platform: comment.platform, accountId: comment.account_id }

    setReplying((prev) => new Set(prev).add(comment.id))
    try {
      await postReply(comment, message)

      if (workspaceGuardRef.current.isActive(workspaceToken)) {
        setDrafts((prev) => ({ ...prev, [comment.id]: "" }))
        setOpenReplies((prev) => {
          const next = new Set(prev)
          next.delete(comment.id)
          return next
        })
        toast({ title: TEXT.replySent[lang] })
      }
      await loadComments({ silent: true, target: replyTarget, visibleToken: workspaceToken })
      if (workspaceGuardRef.current.isActive(workspaceToken)) {
        await loadDetailComments(comment, { silent: true, visibleToken: workspaceToken })
      }
    } catch (error) {
      if (workspaceGuardRef.current.isActive(workspaceToken)) {
        toast({
          title: TEXT.error[lang],
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        })
      }
    } finally {
      if (workspaceGuardRef.current.isActive(workspaceToken)) {
        setReplying((prev) => {
          const next = new Set(prev)
          next.delete(comment.id)
          return next
        })
      }
    }
  }

  const sendBatchReply = async () => {
    const message = batchDraft.trim()
    if (!message || selectedReplyIds.size === 0 || batchReplying) return

    const targets = inboxComments.filter((comment) => selectedReplyIds.has(comment.id) && canReplyToComment(comment))
    if (targets.length === 0) return

    const workspaceToken = workspaceGuardRef.current.capture()
    const replyTarget = { platform: targets[0].platform, accountId: targets[0].account_id }
    const successfulIds = new Set<string>()
    let failedCount = 0
    setBatchReplying(true)

    for (const comment of targets) {
      if (!workspaceGuardRef.current.isActive(workspaceToken)) break
      setReplying((prev) => new Set(prev).add(comment.id))
      try {
        await postReply(comment, message)
        successfulIds.add(comment.id)
      } catch {
        failedCount += 1
      } finally {
        if (workspaceGuardRef.current.isActive(workspaceToken)) {
          setReplying((prev) => {
            const next = new Set(prev)
            next.delete(comment.id)
            return next
          })
        }
      }
    }

    if (workspaceGuardRef.current.isActive(workspaceToken)) {
      setSelectedReplyIds((prev) => {
        const next = new Set(prev)
        successfulIds.forEach((id) => next.delete(id))
        return next
      })
      if (failedCount === 0) {
        setBatchDraft("")
        setBatchReplyOpen(false)
      }
      toast({
        title: TEXT.batchReplyResult[lang],
        description: lang === "zh"
          ? `成功 ${successfulIds.size} 条，失败 ${failedCount} 条`
          : `${successfulIds.size} succeeded, ${failedCount} failed`,
        variant: failedCount > 0 ? "destructive" : "default",
      })
      await loadComments({ silent: true, target: replyTarget, visibleToken: workspaceToken })
      if (selectedComment) await loadDetailComments(selectedComment, { silent: true, visibleToken: workspaceToken })
      setBatchReplying(false)
    }
  }

  const toggleReplies = (commentId: string) => {
    setOpenReplies((prev) => {
      const next = new Set(prev)
      if (next.has(commentId)) next.delete(commentId)
      else next.add(commentId)
      return next
    })
  }

  const capabilityNotice = selectedAccount?.comment_capability
  const pageTitle = isYouTubeLocked
    ? TEXT.youtubeTitle[lang]
    : isInstagramLocked
      ? TEXT.instagramTitle[lang]
      : isFacebookLocked
        ? TEXT.facebookTitle[lang]
        : TEXT.title[lang]
  const pageSubtitle = isYouTubeLocked
    ? TEXT.youtubeSubtitle[lang]
    : isInstagramLocked
      ? TEXT.instagramSubtitle[lang]
      : isFacebookLocked
        ? TEXT.facebookSubtitle[lang]
        : TEXT.subtitle[lang]
  const accountLabel = isYouTubeLocked
    ? TEXT.youtubeAccount[lang]
    : isInstagramLocked
      ? TEXT.instagramAccount[lang]
      : isFacebookLocked
        ? TEXT.facebookAccount[lang]
        : TEXT.account[lang]
  const accountPlaceholder = isYouTubeLocked
    ? TEXT.selectYoutubeChannel[lang]
    : isInstagramLocked
      ? TEXT.selectInstagramAccount[lang]
      : isFacebookLocked
        ? TEXT.selectFacebookAccount[lang]
        : TEXT.allAccounts[lang]
  const contentLabel = isYouTubeLocked
    ? TEXT.youtubeContent[lang]
    : isInstagramLocked
      ? TEXT.instagramContent[lang]
      : isFacebookLocked
        ? TEXT.facebookContent[lang]
        : TEXT.content[lang]
  const contentPlaceholder = isYouTubeLocked
    ? TEXT.selectYoutubeVideo[lang]
    : isInstagramLocked
      ? TEXT.selectInstagramContent[lang]
      : isFacebookLocked
        ? TEXT.selectFacebookContent[lang]
        : TEXT.allContent[lang]
  const commentCountLabel = totalComments !== null && totalComments > loadedComments
    ? lang === "zh"
      ? `${TEXT.showingCount.zh} ${loadedComments} / ${TEXT.totalCount.zh} ${totalComments} ${TEXT.comments.zh}`
      : `${TEXT.showingCount.en} ${loadedComments} ${TEXT.totalCount.en} ${totalComments} ${TEXT.comments.en}`
    : `${loadedComments} ${TEXT.comments[lang]}`
  const selectedDetailContent = selectedComment
    ? contentByExternalId.get(selectedComment.external_content_id) || null
    : null
  const toggleReplySelection = (commentId: string) => {
    setSelectedReplyIds((prev) => {
      const next = new Set(prev)
      if (next.has(commentId)) next.delete(commentId)
      else next.add(commentId)
      return next
    })
  }

  const toggleAllReplyable = () => {
    setSelectedReplyIds(allReplyableSelected ? new Set() : new Set(replyableInboxComments.map((comment) => comment.id)))
  }

  return (
    <div className={cn(embedded ? "text-white" : "min-h-screen bg-[#090909] text-white")}>
      <div className={cn(
        "flex w-full flex-col",
        embedded ? "gap-4" : "mx-auto max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:px-8"
      )}>
        {embedded ? (
          <div className="flex flex-col gap-2 border-b border-white/10 pb-4 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-cyan-300" />
              <span className="font-medium text-white/80">{pageTitle}</span>
              <span className="hidden text-white/35 sm:inline">/</span>
              <span className="hidden sm:inline">{pageSubtitle}</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <span>{commentCountLabel}</span>
            </div>
          </div>
        ) : (
          <header className="flex flex-col gap-3 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-white/55">
                <MessageCircle className="h-4 w-4" />
                <span>{pageTitle}</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-normal text-white">{pageTitle}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">{pageSubtitle}</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-white/55">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <span>{commentCountLabel}</span>
            </div>
          </header>
        )}

        <section className="overflow-hidden rounded-xl border border-white/10 bg-black/25">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="text-sm font-medium text-white/80">
              {lang === "zh" ? "评论工作台" : "Comment workspace"}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              <Select value={contentId} onValueChange={setContentId}>
                <SelectTrigger className="h-9 w-full max-w-[280px] rounded-lg border-white/10 bg-white/[0.03] text-white">
                  <SelectValue placeholder={contentPlaceholder} />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-zinc-950 text-white">
                  <SelectItem value="all">{contentLoading ? TEXT.syncing[lang] : contentPlaceholder}</SelectItem>
                  {content.map((item) => <SelectItem key={item.id} value={item.id}>{getContentLabel(item)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="titanium-outline" className="h-9 gap-2 rounded-lg" onClick={() => void loadComments()} disabled={commentsLoading || accountId === "all"}>
                <RefreshCw className={cn("h-4 w-4", commentsLoading && "animate-spin")} />
                {TEXT.refresh[lang]}
              </Button>
              <Button className="h-9 gap-2 rounded-lg bg-white text-black hover:bg-white/85" onClick={() => void syncComments({ source: "manual" })} disabled={syncing || accountId === "all" || !canSyncSelectedAccount || (selectedPlatformCapabilities?.requires_explicit_content === true && !selectedContent)}>
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                {syncing
                  ? TEXT.syncing[lang]
                  : selectedContent
                    ? TEXT.syncSelected[lang]
                    : selectedPlatformCapabilities?.requires_explicit_content
                      ? TEXT.selectContentFirst[lang]
                      : TEXT.syncRecent[lang]}
              </Button>
              {syncCompleteness ? (
                <span className={cn("text-xs", syncCompleteness.thread_completeness === "complete" ? "text-emerald-300/75" : "text-amber-200/75")}>
                  {syncCompleteness.thread_completeness === "complete"
                    ? (lang === "zh" ? "讨论串完整" : "Thread complete")
                    : syncCompleteness.thread_completeness === "truncated"
                      ? (lang === "zh" ? "结果已截断" : "Results truncated")
                      : (lang === "zh" ? "回复未完整读取" : "Replies incomplete")}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col xl:grid xl:min-h-[650px] xl:grid-cols-[240px_390px_minmax(0,1fr)]">
            <aside className="border-b border-white/10 xl:border-b-0 xl:border-r">
              <div className="border-b border-white/10 px-4 py-3 text-xs font-medium uppercase tracking-wide text-white/45">
                {accountLabel}
              </div>
              <div className="flex gap-2 overflow-x-auto p-3 xl:block xl:space-y-2 xl:overflow-visible">
                {filteredAccounts.map((account) => {
                  const cacheKey = `${platformLock || account.platform}:${account.id}`
                  const cachedCount = commentsCacheRef.current.get(cacheKey)?.total
                  const active = account.id === accountId
                  return (
                    <button key={account.id} type="button" onClick={() => changeAccount(account.id)} className={cn("flex min-w-[210px] items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors xl:min-w-0 xl:w-full", active ? "border-cyan-300/35 bg-cyan-400/10" : "border-white/10 bg-white/[0.025] hover:bg-white/[0.06]")}>
                      {account.avatar_url ? <img src={account.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" /> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10"><PlatformIcon platform={account.platform} className="h-4 w-4" /></div>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white/85">{account.name}</span>
                        <span className="block truncate text-xs text-white/40">{account.handle || PLATFORM_LABELS[account.platform]}</span>
                      </span>
                      <span className="text-xs text-white/35">{typeof cachedCount === "number" ? cachedCount : "—"}</span>
                    </button>
                  )
                })}
              </div>
            </aside>

            <div className="border-b border-white/10 xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    checked={allReplyableSelected}
                    onCheckedChange={toggleAllReplyable}
                    disabled={replyableInboxComments.length === 0 || batchReplying}
                    aria-label={TEXT.selectReplyable[lang]}
                    className="border-white/25 data-[state=checked]:border-cyan-300 data-[state=checked]:bg-cyan-300 data-[state=checked]:text-black"
                  />
                  <span className="truncate text-xs font-medium uppercase tracking-wide text-white/45">{lang === "zh" ? "评论列表" : "Comments"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs text-white/35 sm:inline">{commentCountLabel}</span>
                  <Button
                    type="button"
                    variant="titanium-outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg px-2.5"
                    onClick={() => setBatchReplyOpen((open) => !open)}
                    disabled={selectedReplyIds.size === 0 || batchReplying}
                  >
                    <CheckSquare2 className="h-3.5 w-3.5" />
                    {TEXT.batchReply[lang]}
                  </Button>
                </div>
              </div>
              {batchReplyOpen ? (
                <div className="space-y-2 border-b border-cyan-300/15 bg-cyan-400/[0.04] p-3">
                  <div className="text-xs text-cyan-100/70">{selectedReplyIds.size} {TEXT.selectedComments[lang]}</div>
                  <Textarea
                    value={batchDraft}
                    onChange={(event) => setBatchDraft(event.target.value)}
                    placeholder={TEXT.writeReply[lang]}
                    className="min-h-[72px] rounded-lg border-white/10 bg-black/25 text-white placeholder:text-white/35"
                    disabled={batchReplying}
                  />
                  <Button
                    type="button"
                    className="h-9 w-full gap-2 rounded-lg bg-white text-black hover:bg-white/85"
                    disabled={!batchDraft.trim() || selectedReplyIds.size === 0 || batchReplying}
                    onClick={() => void sendBatchReply()}
                  >
                    <Send className="h-4 w-4" />
                    {batchReplying ? TEXT.sending[lang] : TEXT.sendBatchReply[lang]}
                  </Button>
                </div>
              ) : null}
              <div className="max-h-[500px] overflow-y-auto p-2 xl:max-h-[720px]">
                {commentsLoading && comments.length === 0 ? (
                  <div className="space-y-2 p-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-white/[0.05]" />)}</div>
                ) : inboxComments.length === 0 ? (
                  <div className="p-8 text-center text-sm text-white/40">{accountId === "all" ? accountPlaceholder : TEXT.noComments[lang]}</div>
                ) : inboxComments.map((comment) => {
                  const canReply = canReplyToComment(comment)
                  const replyOpen = openReplies.has(comment.id)
                  return (
                    <article key={comment.id} className={cn("mb-1 w-full rounded-lg border px-3 py-3 transition-colors", selectedCommentId === comment.id ? "border-cyan-300/35 bg-cyan-400/10" : "border-transparent hover:border-white/10 hover:bg-white/[0.04]")}>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={selectedReplyIds.has(comment.id)}
                          onCheckedChange={() => toggleReplySelection(comment.id)}
                          disabled={!canReply || batchReplying}
                          aria-label={`${TEXT.batchReply[lang]}: ${comment.author_name || PLATFORM_LABELS[comment.platform]}`}
                          className="mt-1 border-white/25 data-[state=checked]:border-cyan-300 data-[state=checked]:bg-cyan-300 data-[state=checked]:text-black"
                        />
                        <button type="button" onClick={() => selectComment(comment)} className="min-w-0 flex-1 text-left">
                          <div className="flex items-center gap-2">
                            {comment.author_avatar_url ? <img src={comment.author_avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" /> : <div className="h-7 w-7 rounded-full bg-white/10" />}
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/80">{comment.author_name || PLATFORM_LABELS[comment.platform]}</span>
                            <span className="text-[11px] text-white/35">{formatDate(comment.remote_created_at || comment.created_at, lang)}</span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm leading-5 text-white/55">{comment.message}</p>
                          <CommentTranslationLine comment={comment} lang={lang} translations={translations} className="line-clamp-2" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 pl-6">
                        <span className="min-w-0 truncate text-[11px] text-white/30">{contentByExternalId.get(comment.external_content_id)?.title || comment.external_content_id.slice(-8)}</span>
                        <Button
                          type="button"
                          variant="titanium-outline"
                          size="sm"
                          className="h-7 shrink-0 gap-1.5 rounded-md px-2.5"
                          disabled={!canReply || replying.has(comment.id) || batchReplying}
                          onClick={() => toggleReplies(comment.id)}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {TEXT.reply[lang]}
                        </Button>
                      </div>
                      {replyOpen ? (
                        <div className="mt-3 space-y-2 border-t border-white/[0.07] pt-3">
                          <Textarea
                            value={drafts[comment.id] || ""}
                            onChange={(event) => setDrafts((prev) => ({ ...prev, [comment.id]: event.target.value }))}
                            placeholder={TEXT.writeReply[lang]}
                            className="min-h-[72px] rounded-lg border-white/10 bg-black/25 text-white placeholder:text-white/35"
                            disabled={replying.has(comment.id)}
                          />
                          <Button
                            type="button"
                            className="h-8 w-full gap-2 rounded-lg bg-white text-black hover:bg-white/85"
                            disabled={replying.has(comment.id) || !(drafts[comment.id] || "").trim()}
                            onClick={() => void sendReply(comment)}
                          >
                            <Send className="h-3.5 w-3.5" />
                            {replying.has(comment.id) ? TEXT.sending[lang] : TEXT.reply[lang]}
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </div>

            <main className="min-w-0">
              <div className="border-b border-white/10 px-4 py-3 text-xs font-medium uppercase tracking-wide text-white/45">{lang === "zh" ? "评论详情" : "Comment detail"}</div>
              {!selectedComment ? (
                <div className="flex min-h-[420px] items-center justify-center p-8 text-center text-sm text-white/40">{lang === "zh" ? "选择一条评论以查看对应内容和完整讨论" : "Select a comment to view its content and discussion"}</div>
              ) : (
                <div className="space-y-4 p-4">
                  <article className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.025]">
                    {selectedDetailContent?.preview_url ? <video controls preload="none" poster={selectedDetailContent.thumbnail_url || undefined} src={selectedDetailContent.preview_url} className="aspect-video w-full bg-black object-contain" /> : selectedDetailContent?.thumbnail_url ? <img src={selectedDetailContent.thumbnail_url} alt="" className="aspect-video w-full bg-black object-contain" /> : <div className="flex aspect-video items-center justify-center bg-black/50 text-sm text-white/30"><PlatformIcon platform={selectedComment.platform} className="h-8 w-8" /></div>}
                    <div className="p-3">
                      <div className="text-sm font-medium text-white/80">{selectedDetailContent?.title || selectedComment.external_content_id}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/40"><span>{formatDate(selectedDetailContent?.published_at || null, lang)}</span>{selectedDetailContent?.url ? <a href={selectedDetailContent.url} target="_blank" rel="noreferrer" className="hover:text-white hover:underline">{selectedComment.platform === "youtube" ? TEXT.openOnYouTube[lang] : selectedComment.platform === "facebook" ? TEXT.openOnFacebook[lang] : TEXT.openOnInstagram[lang]}</a> : null}</div>
                    </div>
                  </article>

                  <section className="rounded-lg border border-white/10 bg-white/[0.02]">
                    <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-white/45"><span>{lang === "zh" ? "该内容的全部缓存评论" : "All cached comments for this content"}</span><span>{detailLoaded}{detailTotal !== null && detailTotal > detailLoaded ? ` / ${detailTotal}` : ""}</span></div>
                    {detailTotal !== null && detailTotal > detailLoaded ? <div className="border-b border-amber-300/15 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/70">{lang === "zh" ? `仅显示最近 ${detailLoaded} 条` : `Showing the latest ${detailLoaded}`}</div> : null}
                    <div className="max-h-64 overflow-y-auto p-2">
                      {detailLoading ? <div className="p-4 text-center text-xs text-white/35">{TEXT.syncing[lang]}</div> : detailComments.length === 0 ? <div className="p-4 text-center text-xs text-white/35">{TEXT.noComments[lang]}</div> : detailComments.map((comment) => <div key={comment.id} className="border-b border-white/[0.06] p-2 last:border-0"><div className="flex gap-2 text-xs"><span className="font-medium text-white/65">{comment.author_name || PLATFORM_LABELS[comment.platform]}</span><span className="text-white/30">{formatDate(comment.remote_created_at || comment.created_at, lang)}</span></div><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-white/55">{comment.message}</p><CommentTranslationLine comment={comment} lang={lang} translations={translations} />{(comment.replies || []).map((reply) => <div key={reply.id} className="ml-4 mt-2 border-l border-white/10 pl-3"><span className="text-xs font-medium text-white/50">{reply.author_name || TEXT.fromAccount[lang]}</span><p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/50">{reply.message}</p><CommentTranslationLine comment={reply} lang={lang} translations={translations} /></div>)}</div>)}
                    </div>
                  </section>

                </div>
              )}
            </main>
          </div>
        </section>
      </div>
    </div>
  )
}
