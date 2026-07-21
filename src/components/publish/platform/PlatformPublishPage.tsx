'use client'

/* eslint-disable @next/next/no-img-element */

import { addMinutes, format } from 'date-fns'
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  FileVideo,
  Globe2,
  Hash,
  History,
  Info,
  ListFilter,
  ListTodo,
  Loader2,
  MessageCircle,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useLang } from '@/contexts/LangContext'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import SocialCommentsClient from '@/components/social-comments/SocialCommentsClient'
import { getInstagramPublishReconciliationDisplay } from '@/lib/instagram/publish-display'
import type { PlatformPrivacyStatus, PlatformPublishConfig } from '@/lib/publish/platform-config'
import {
  getAcceptedVideoExtensions,
  getInstagramUploadErrorMessage,
  getVideoFileExtension,
  getVideoFormatsLabel,
} from '@/lib/publish/platform-media'
import {
  commitUploadResults,
  createUploadedVideoSelection,
  isPlatformPublishReady,
  removeSelectedVideo,
} from '@/lib/publish/upload-selection'
import { cn } from '@/lib/utils'

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}
const DEFAULT_MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024
const DEFAULT_MAX_FILE_SIZE_LABEL = '4GB'
const MAX_VIDEOS = 40

type TabType = 'create' | 'tasks' | 'comments'
type VideoSourceType = 'upload' | 'asset'
type PublishMode = 'now' | 'scheduled'
type IntervalMode = '0' | '3' | '5' | '10' | '30' | '60' | '120' | '360' | '720' | '1440' | 'custom'
type TitleMode = 'uniform' | 'individual'
type DateRange = 'today' | 'yesterday' | '3days' | '7days'
type MetadataAssistantTarget = { scope: 'global' } | { scope: 'video'; videoId: string }

interface PlatformAccount {
  id: string
  channel_id: string
  channel_title: string
  channel_handle: string | null
  thumbnail_url: string | null
  subscriber_count: number
  video_count: number
  view_count: number
  status: string
  access_token_expires_at: string | null
}

interface SelectedVideo {
  id: string
  type: 'asset' | 'upload' | 'url'
  name: string
  thumbnail: string
  url?: string
  localUrl?: string
  duration?: number
  size?: number
  contentType?: string
  title?: string
  description?: string
}

interface AssetItem {
  id: string
  type: 'video' | 'image'
  resultUrl: string | null
  thumbnailUrl: string | null
  prompt: string | null
  model: string
  createdAt: string
  source: string
}

interface FileUploadStatus {
  id: string
  name: string
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

interface PlatformTaskItem {
  id: string
  title: string
  status: string
  video_url?: string | null
  source_video_name?: string | null
  thumbnail_url?: string | null
  error_code?: string | null
  error_message?: string | null
  scheduled_at?: string | null
  published_at?: string | null
  facebook_watch_url?: string | null
  instagram_watch_url?: string | null
}

interface PlatformTaskGroup {
  id: string
  name: string
  status: 'pending' | 'running' | 'processing' | 'completed' | 'failed' | 'scheduled' | 'partial_failed' | 'cancelled'
  total_items: number
  published_count: number
  pending_count: number
  failed_count: number
  video_count?: number
  account_count?: number
  created_at: string
  scheduled_at: string | null
  total_views?: number
  total_likes?: number
  items?: PlatformTaskItem[]
}

const dateRangeOptions: { value: DateRange; label: { zh: string; en: string } }[] = [
  { value: 'today', label: { zh: '今天', en: 'Today' } },
  { value: 'yesterday', label: { zh: '昨天', en: 'Yesterday' } },
  { value: '3days', label: { zh: '近3天', en: 'Last 3 days' } },
  { value: '7days', label: { zh: '近7天', en: 'Last 7 days' } },
]

const statusConfig: Record<string, { label: { zh: string; en: string }; className: string; icon: typeof Clock }> = {
  pending: { label: { zh: '待处理', en: 'Pending' }, className: 'text-zinc-400 border-zinc-500/30 bg-zinc-500/10', icon: Clock },
  scheduled: { label: { zh: '定时中', en: 'Scheduled' }, className: 'text-blue-400 border-blue-500/30 bg-blue-500/10', icon: Clock },
  uploading: { label: { zh: '上传中', en: 'Uploading' }, className: 'text-amber-400 border-amber-500/30 bg-amber-500/10', icon: Clock },
  processing: { label: { zh: '执行中', en: 'Processing' }, className: 'text-amber-400 border-amber-500/30 bg-amber-500/10', icon: Clock },
  running: { label: { zh: '执行中', en: 'Running' }, className: 'text-amber-400 border-amber-500/30 bg-amber-500/10', icon: Clock },
  published: { label: { zh: '已发布', en: 'Published' }, className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', icon: CheckCircle },
  completed: { label: { zh: '已完成', en: 'Completed' }, className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', icon: CheckCircle },
  draft_created: { label: { zh: '草稿已创建', en: 'Draft created' }, className: 'text-sky-400 border-sky-500/30 bg-sky-500/10', icon: CheckCircle },
  container_created: { label: { zh: '容器已创建', en: 'Container created' }, className: 'text-sky-400 border-sky-500/30 bg-sky-500/10', icon: CheckCircle },
  failed: { label: { zh: '失败', en: 'Failed' }, className: 'text-rose-400 border-rose-500/30 bg-rose-500/10', icon: XCircle },
  partial_failed: { label: { zh: '部分失败', en: 'Partially failed' }, className: 'text-orange-400 border-orange-500/30 bg-orange-500/10', icon: AlertTriangle },
  cancelled: { label: { zh: '已取消', en: 'Cancelled' }, className: 'text-zinc-500 border-zinc-500/30 bg-zinc-500/10', icon: Clock },
}

function uiText(isEnglish: boolean, zh: string, en: string) {
  return isEnglish ? en : zh
}

function localizeApiMessage(message: unknown, isEnglish: boolean, englishFallback: string) {
  const normalized = typeof message === 'string' ? message.trim() : ''
  if (!normalized) return isEnglish ? englishFallback : ''
  return isEnglish && /[\u3400-\u9fff]/.test(normalized) ? englishFallback : normalized
}

function formatNumber(num: number, isEnglish: boolean) {
  if (num >= 10000) return isEnglish ? `${(num / 1000).toFixed(1)}K` : `${(num / 10000).toFixed(1)}万`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}

function getAccountName(account: PlatformAccount) {
  return account.channel_title || account.channel_handle || account.channel_id
}

function getAccountHandle(account: PlatformAccount) {
  return account.channel_handle || account.channel_id
}

function getInitial(account: PlatformAccount) {
  return getAccountName(account).charAt(0).toUpperCase()
}

function getAssistantTargetKey(target: MetadataAssistantTarget) {
  return target.scope === 'global' ? 'global' : target.videoId
}

function isAccountAuthorized(account: PlatformAccount) {
  return account.status === 'active' &&
    (!account.access_token_expires_at || new Date(account.access_token_expires_at).getTime() > Date.now())
}

function validateFile(file: File, config: PlatformPublishConfig, isEnglish: boolean) {
  const ext = getVideoFileExtension(file.name)
  const acceptedExtensions = getAcceptedVideoExtensions(config.acceptedVideoExtensions)
  if (!acceptedExtensions.includes(ext)) return uiText(isEnglish, `不支持 ${ext} 格式`, `Unsupported ${ext} format`)
  const maxFileSize = config.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE
  const maxFileSizeLabel = config.maxFileSizeLabel || DEFAULT_MAX_FILE_SIZE_LABEL
  if (file.size > maxFileSize) return uiText(isEnglish, `单个视频不能超过 ${maxFileSizeLabel}`, `Each video must be ${maxFileSizeLabel} or smaller`)
  return null
}

function getFileContentType(file: File) {
  const ext = `.${file.name.split('.').pop()?.toLowerCase()}`
  return file.type || VIDEO_MIME_BY_EXTENSION[ext] || 'video/mp4'
}

function isLocalBrowserHost() {
  if (typeof window === 'undefined') return false
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
}

function getUploadCredentialsEndpoint(platform: PlatformPublishConfig['platform']) {
  if (platform === 'facebook' && isLocalBrowserHost()) {
    return '/api/facebook/upload/local-credentials'
  }
  if (platform === 'instagram' && isLocalBrowserHost()) {
    return '/api/instagram/upload/local-credentials'
  }

  return '/api/upload/oss-credentials'
}

function getGenerateTitlesEndpoint(platform: PlatformPublishConfig['platform']) {
  if (platform === 'facebook') {
    return '/api/facebook/publish/generate-titles'
  }
  if (platform === 'instagram') {
    return '/api/instagram/publish/generate-titles'
  }

  return '/api/publish/generate-titles'
}

function getGenerateDescriptionEndpoint(platform: PlatformPublishConfig['platform']) {
  return `/api/${platform}/publish/generate-description`
}

function stripVideoExtension(name: string) {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDefaultVideoTitle(name: string, index?: number, isEnglish = false) {
  return stripVideoExtension(name) || (typeof index === 'number'
    ? uiText(isEnglish, `视频 ${index + 1}`, `Video ${index + 1}`)
    : uiText(isEnglish, '未命名视频', 'Untitled video'))
}

function normalizeTagsInput(value: string) {
  return value
    .split(/[\s,，、#]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30)
}

function formatTags(tags: string[]) {
  return tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')
}

function appendTagsToDescription(description: string, tags: string[]) {
  const formattedTags = formatTags(tags)
  return [description.trim(), formattedTags].filter(Boolean).join('\n\n')
}

function buildInstagramCaption(title: string, description: string, tags: string[]) {
  return [title.trim(), appendTagsToDescription(description, tags)].filter(Boolean).join('\n\n')
}

function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function formatTaskTime(dateStr: string, isEnglish: boolean) {
  const date = new Date(dateStr)
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const locale = isEnglish ? 'en-US' : 'zh-CN'
  const timeStr = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  if (date.toDateString() === now.toDateString()) return uiText(isEnglish, `今天 ${timeStr}`, `Today ${timeStr}`)
  if (date.toDateString() === tomorrow.toDateString()) return uiText(isEnglish, `明天 ${timeStr}`, `Tomorrow ${timeStr}`)
  return date.toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTaskAbsoluteTime(dateStr: string | null | undefined) {
  if (!dateStr) return null
  return format(new Date(dateStr), 'MM-dd HH:mm')
}

function PlatformTaskItemPreview({ item, config, isEnglish }: { item: PlatformTaskItem; config: PlatformPublishConfig; isEnglish: boolean }) {
  const [previewIndex, setPreviewIndex] = useState(0)
  const previewSources = [
    item.thumbnail_url ? { type: 'image' as const, src: item.thumbnail_url } : null,
    item.video_url ? { type: 'video' as const, src: `${item.video_url}#t=0.1` } : null,
  ].filter(Boolean) as Array<{ type: 'image' | 'video'; src: string }>
  const currentPreview = previewSources[previewIndex]
  const showNextPreview = () => setPreviewIndex((index) => Math.min(index + 1, previewSources.length))

  useEffect(() => {
    setPreviewIndex(0)
  }, [item.id, item.thumbnail_url, item.video_url])

  return (
    <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/40">
      {currentPreview?.type === 'image' ? (
        <img
          src={currentPreview.src}
          alt={item.title || item.source_video_name || uiText(isEnglish, `${config.platformName} 视频预览`, `${config.platformName} video preview`)}
          className="h-full w-full object-cover"
          onError={showNextPreview}
        />
      ) : currentPreview?.type === 'video' ? (
        <video
          src={currentPreview.src}
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          onError={showNextPreview}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/35">
          <FileVideo className="h-5 w-5" />
        </div>
      )}
    </div>
  )
}

function getPrivacyIcon(value: PlatformPrivacyStatus | null) {
  return value === 'private' ? Users : Globe2
}

function readVideoMetadata(file: File): Promise<{ thumbnail: string; duration: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false

    const finish = (thumbnail: string) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve({
        thumbnail,
        duration: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
      })
    }

    video.src = url
    video.muted = true
    video.preload = 'metadata'
    video.playsInline = true
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration / 2 || 0)
    }
    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 180
      canvas.height = video.videoHeight || 320
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        finish('')
        return
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      finish(canvas.toDataURL('image/jpeg', 0.72))
    }
    video.onerror = () => finish('')
    setTimeout(() => finish(''), 12000)
  })
}

function putFileToOss(
  file: File,
  uploadUrl: string,
  contentType: string,
  onProgress: (progress: number) => void,
  options: { platform: PlatformPublishConfig['platform']; isEnglish: boolean }
) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress(Math.round(10 + (event.loaded / event.total) * 85))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(uploadUrl)
      else if (options.platform === 'instagram') {
        let payload: { code?: string; error?: string } | null = null
        try {
          payload = JSON.parse(xhr.responseText) as { code?: string; error?: string }
        } catch {
          payload = null
        }
        reject(new Error(getInstagramUploadErrorMessage({
          code: payload?.code,
          serverMessage: payload?.error,
          status: xhr.status,
          isEnglish: options.isEnglish,
        })))
      } else reject(new Error(uiText(options.isEnglish, `OSS上传失败 (${xhr.status})`, `OSS upload failed (${xhr.status})`)))
    }
    xhr.onerror = () => reject(new Error(
      uiText(options.isEnglish, '网络错误', 'Network error.')
    ))
    xhr.ontimeout = () => reject(new Error(
      uiText(options.isEnglish, '上传超时', 'Upload timed out.')
    ))
    xhr.open('PUT', uploadUrl)
    xhr.timeout = 600000
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.send(file)
  })
}

function PlatformTaskCard({
  config,
  task,
  isEnglish,
  onDelete,
}: {
  config: PlatformPublishConfig
  task: PlatformTaskGroup
  isEnglish: boolean
  onDelete: (task: PlatformTaskGroup) => void
}) {
  const status = statusConfig[task.status] || statusConfig.pending
  const StatusIcon = status.icon
  const visibleItems = task.items?.slice(0, 8) || []

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/5 bg-zinc-900/40 p-5 backdrop-blur-sm transition-all hover:border-white/10 hover:bg-zinc-900/60 hover:shadow-2xl hover:shadow-black/50">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="flex min-w-0 items-center gap-2 text-base font-medium text-zinc-100">
            <span className="truncate" title={task.name}>{task.name || uiText(isEnglish, '未命名任务组', 'Untitled task group')}</span>
          </h3>
        </div>
        <Badge variant="outline" className={cn('h-6 px-2 py-0.5 text-xs font-normal', status.className)}>
          <StatusIcon className="mr-1.5 h-3 w-3" />
          {status.label[isEnglish ? 'en' : 'zh']}
        </Badge>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2 text-center text-sm">
        <div className="rounded-md bg-black/25 p-3">
          <div className="text-white/35">{isEnglish ? config.statsVideoLabelEn || 'Videos' : config.statsVideoLabel}</div>
          <div className="mt-1 font-semibold text-white">{task.video_count || task.total_items || 0}</div>
        </div>
        <div className="rounded-md bg-black/25 p-3">
          <div className="text-white/35">{uiText(isEnglish, '账号', 'Accounts')}</div>
          <div className="mt-1 font-semibold text-white">{task.account_count || 0}</div>
        </div>
        <div className="rounded-md bg-black/25 p-3">
          <div className="text-white/35">{uiText(isEnglish, '成功', 'Succeeded')}</div>
          <div className="mt-1 font-semibold text-emerald-300">{task.published_count || 0}</div>
        </div>
        <div className="rounded-md bg-black/25 p-3">
          <div className="text-white/35">{uiText(isEnglish, '失败', 'Failed')}</div>
          <div className="mt-1 font-semibold text-red-300">{task.failed_count || 0}</div>
        </div>
      </div>

      {visibleItems.length > 0 && (
        <div className="mb-4 max-h-72 space-y-2 overflow-y-auto pr-1">
          {visibleItems.map((item) => {
            const watchUrl = item.facebook_watch_url || item.instagram_watch_url
            const reconciliationDisplay = getInstagramPublishReconciliationDisplay(
              config.platform,
              item.error_code,
              isEnglish
            )
            const isPublishedItem = !reconciliationDisplay && Boolean(
              item.published_at || watchUrl || (task.status === 'completed' && !item.error_message)
            )
            const resolvedStatus = isPublishedItem ? 'published' : item.status
            const itemStatus = statusConfig[resolvedStatus] || statusConfig.pending
            const itemStatusLabel = reconciliationDisplay?.label || (isPublishedItem
              ? uiText(isEnglish, '已发布', 'Published')
              : itemStatus.label[isEnglish ? 'en' : 'zh'])
            const scheduledTime = formatTaskAbsoluteTime(item.published_at || item.scheduled_at)

            return (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-white/[0.08] bg-black/20 p-2 text-sm">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <PlatformTaskItemPreview item={item} config={config} isEnglish={isEnglish} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-white/80">{item.title || item.source_video_name || uiText(isEnglish, '未命名视频', 'Untitled video')}</div>
                    {item.source_video_name && item.source_video_name !== item.title && (
                      <div className="mt-0.5 truncate text-xs text-white/35">{item.source_video_name}</div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/35">
                      <span>{itemStatusLabel}</span>
                      {scheduledTime && <span>{item.published_at ? uiText(isEnglish, '发布时间', 'Published at') : uiText(isEnglish, '计划时间', 'Scheduled for')} {scheduledTime}</span>}
                    </div>
                    {reconciliationDisplay ? (
                      <div className="mt-1 line-clamp-2 text-xs text-amber-300">{reconciliationDisplay.message}</div>
                    ) : item.error_message ? (
                      <div className="mt-1 line-clamp-2 text-xs text-red-300">{item.error_message}</div>
                    ) : null}
                  </div>
                </div>
                {watchUrl && (
                  <a
                    href={watchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-cyan-300 hover:text-cyan-200"
                    title={uiText(isEnglish, `查看 ${config.platformName} 视频`, `View on ${config.platformName}`)}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-4">
        <div className="text-xs text-zinc-600">
          <span>{task.scheduled_at ? uiText(isEnglish, '计划', 'Scheduled') : uiText(isEnglish, '创建', 'Created')}: {formatTaskTime(task.scheduled_at || task.created_at, isEnglish)}</span>
          {['running', 'processing', 'completed'].includes(task.status) && (
            <span className="mt-1 flex items-center gap-1 text-blue-400/50">
              <Info className="h-3 w-3" />
              {uiText(isEnglish, `发布后可能需要几分钟才能在 ${config.platformName} 显示`, `It may take a few minutes to appear on ${config.platformName} after publishing`)}
            </span>
          )}
        </div>

        <div className="flex translate-x-2 items-center gap-2 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation()
              onDelete(task)
            }}
            className="h-7 w-7 text-rose-500 hover:bg-rose-500/10 hover:text-rose-400"
            title={uiText(isEnglish, '删除任务组', 'Delete task group')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function PlatformTaskManager({
  config,
  isEnglish,
}: {
  config: PlatformPublishConfig
  isEnglish: boolean
}) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>('today')
  const [tasks, setTasks] = useState<PlatformTaskGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [taskToDelete, setTaskToDelete] = useState<PlatformTaskGroup | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchTasks = useCallback(async (reset = false, pageToLoad = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: '20',
        offset: reset ? '0' : ((pageToLoad - 1) * 20).toString(),
        dateRange,
      })
      if (activeTab !== 'all') params.append('status', activeTab)
      if (config.platform === 'facebook') params.append('_', Date.now().toString())

      const res = await fetch(`${config.apiBase}/publish/tasks?${params.toString()}`, {
        cache: config.platform === 'facebook' ? 'no-store' : 'default',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(localizeApiMessage(data?.error, isEnglish, 'Unable to load task list'))

      const nextTasks = (data.tasks || []).map((task: any) => ({
        ...task,
        status: task.status === 'processing' ? 'running' : task.status,
        name: task.name || task.task_name || uiText(isEnglish, '未命名任务组', 'Untitled task group'),
      })) as PlatformTaskGroup[]

      if (reset) setTasks(nextTasks)
      else setTasks((prev) => [...prev, ...nextTasks])
      setHasMore(nextTasks.length === 20)
    } catch (error) {
      toast({
        title: uiText(isEnglish, '加载失败', 'Load failed'),
        description: error instanceof Error ? localizeApiMessage(error.message, isEnglish, 'Unable to load task list') : uiText(isEnglish, '无法获取任务列表', 'Unable to load task list'),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [activeTab, config.apiBase, dateRange, isEnglish, toast])

  useEffect(() => {
    setPage(1)
    fetchTasks(true, 1)
  }, [activeTab, dateRange, fetchTasks])

  useEffect(() => {
    if (page > 1) fetchTasks(false, page)
  }, [fetchTasks, page])

  const handleDeleteTask = (task: PlatformTaskGroup) => {
    setTaskToDelete(task)
    setDeleteDialogOpen(true)
  }

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return

    setDeleting(true)
    try {
      const res = await fetch(`${config.apiBase}/publish/tasks/${taskToDelete.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(localizeApiMessage(data?.error, isEnglish, 'Delete failed'))

      toast({
        title: uiText(isEnglish, '任务组已删除', 'Task group deleted'),
        description: taskToDelete.published_count > 0
          ? uiText(isEnglish, `已发布到 ${config.platformName} 的视频不会被自动删除。`, `Videos already published to ${config.platformName} will not be deleted automatically.`)
          : undefined,
      })
      setTasks((prev) => prev.filter((task) => task.id !== taskToDelete.id))
      setDeleteDialogOpen(false)
      setTaskToDelete(null)
    } catch (error) {
      toast({
        title: uiText(isEnglish, '删除失败', 'Delete failed'),
        description: error instanceof Error ? localizeApiMessage(error.message, isEnglish, 'Please try again later') : uiText(isEnglish, '请稍后重试', 'Please try again later'),
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  const filteredTasks = tasks.filter((task) => (
    !searchQuery || task.name?.toLowerCase().includes(searchQuery.toLowerCase())
  ))

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
            <TabsList>
              <TabsTrigger value="all">{uiText(isEnglish, '全部', 'All')}</TabsTrigger>
              <TabsTrigger value="in_progress">{uiText(isEnglish, '进行中', 'In progress')}</TabsTrigger>
              <TabsTrigger value="completed">{uiText(isEnglish, '已完成', 'Completed')}</TabsTrigger>
              <TabsTrigger value="failed">{uiText(isEnglish, '失败', 'Failed')}</TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRange)}>
            <SelectTrigger className="h-9 w-28 border-white/10 bg-white/5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dateRangeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label[isEnglish ? 'en' : 'zh']}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {tasks.length > 0 && (
            <span className="hidden items-center gap-1.5 pl-1 text-[11px] text-zinc-600 sm:flex">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>{uiText(isEnglish, '记录将在 ', 'Records are cleared after ')}<strong className="text-zinc-500">{uiText(isEnglish, '7 天', '7 days')}</strong>{uiText(isEnglish, ' 后自动清理', '')}</span>
            </span>
          )}
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <Input
              placeholder={uiText(isEnglish, '搜索任务...', 'Search tasks...')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-9 border-white/10 bg-white/5 pl-9 transition-all focus:border-[#CCFF00]/30 focus:ring-1 focus:ring-[#CCFF00]/20"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setPage(1)
              fetchTasks(true, 1)
            }}
            disabled={loading}
            className="h-9 w-9"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {loading && page === 1 ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[1, 2, 3].map((item) => (
            <div key={item} className="animate-pulse rounded-xl border border-white/5 bg-zinc-900/40 p-5">
              <div className="mb-4 flex items-start justify-between">
                <div className="h-5 w-2/3 rounded bg-white/[0.08]" />
                <div className="h-5 w-16 rounded bg-white/[0.08]" />
              </div>
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="h-10 rounded bg-white/[0.08]" />
                <div className="h-10 rounded bg-white/[0.08]" />
                <div className="h-10 rounded bg-white/[0.08]" />
              </div>
              <div className="mt-4 h-4 w-1/3 rounded bg-white/[0.08]" />
            </div>
          ))}
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
            <ListTodo className="h-7 w-7 text-zinc-600" />
          </div>
          <p className="mb-1 text-zinc-400">{uiText(isEnglish, '暂无任务数据', 'No task data')}</p>
          <p className="mb-5 text-xs text-zinc-600">{uiText(isEnglish, '创建发布任务后，这里会展示任务状态和数据统计', 'Task status and statistics will appear here after you create a publishing task.')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filteredTasks.map((task) => (
            <PlatformTaskCard
              key={task.id}
              config={config}
              task={task}
              isEnglish={isEnglish}
              onDelete={handleDeleteTask}
            />
          ))}
        </div>
      )}

      {hasMore && !loading && tasks.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => current + 1)}
            className="border-white/10 text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
          >
            {uiText(isEnglish, '加载更多任务', 'Load more tasks')}
          </Button>
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="border-white/10 bg-gray-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-white">
              <Trash2 className="h-5 w-5 text-red-400" />
              {uiText(isEnglish, '删除任务组', 'Delete task group')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              {uiText(isEnglish, '确定要删除任务组', 'Delete task group')} &quot;{taskToDelete?.name || uiText(isEnglish, '未命名任务组', 'Untitled task group')}&quot;?
              {taskToDelete && taskToDelete.published_count > 0 && (
                <span className="mt-2 block text-amber-400">
                  {uiText(isEnglish, `此任务组有 ${taskToDelete.published_count} 个已发布视频，平台上的视频不会被自动删除。`, `This task group has ${taskToDelete.published_count} published videos. Videos on the platform will not be deleted automatically.`)}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/5 text-gray-300 hover:bg-white/10">
              {uiText(isEnglish, '取消', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteTask}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? uiText(isEnglish, '删除中...', 'Deleting...') : uiText(isEnglish, '确认删除', 'Confirm delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface PlatformPublishPageProps {
  config: PlatformPublishConfig
  showCommentManagement?: boolean
  instagramReplyEnabled?: boolean
}

export function PlatformPublishPage({
  config,
  showCommentManagement = false,
  instagramReplyEnabled = false,
}: PlatformPublishPageProps) {
  const router = useRouter()
  const { lang } = useLang()
  const isEnglish = lang === 'en'
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const privacyDropdownRef = useRef<HTMLDivElement>(null)

  const [activeTab, setActiveTab] = useState<TabType>('create')
  const [videoSource, setVideoSource] = useState<VideoSourceType>('upload')
  const [selectedVideos, setSelectedVideos] = useState<SelectedVideo[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [caption, setCaption] = useState('')
  const [description, setDescription] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [contentCategory, setContentCategory] = useState(config.categoryOptions?.[0]?.value || 'OTHER')
  const [taskGroupName, setTaskGroupName] = useState('')
  const [useDefaultCover, setUseDefaultCover] = useState(true)
  const [publishMode, setPublishMode] = useState<PublishMode>('now')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('09:00')
  const [intervalMode, setIntervalMode] = useState<IntervalMode>('5')
  const [customInterval, setCustomInterval] = useState(5)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [uploadingFiles, setUploadingFiles] = useState<FileUploadStatus[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [titleMode, setTitleMode] = useState<TitleMode>('uniform')
  const [privacyStatus, setPrivacyStatus] = useState<PlatformPrivacyStatus | null>(null)
  const [privacyDropdownOpen, setPrivacyDropdownOpen] = useState(false)
  const [assetDialogOpen, setAssetDialogOpen] = useState(false)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [transferringAssets, setTransferringAssets] = useState(false)
  const [showTitleAssistant, setShowTitleAssistant] = useState(false)
  const [titleAssistantTarget, setTitleAssistantTarget] = useState<MetadataAssistantTarget>({ scope: 'global' })
  const [titlePrompt, setTitlePrompt] = useState('')
  const [generatingTitleTargets, setGeneratingTitleTargets] = useState<Set<string>>(new Set())
  const [showDescriptionAssistant, setShowDescriptionAssistant] = useState(false)
  const [descriptionAssistantTarget, setDescriptionAssistantTarget] = useState<MetadataAssistantTarget>({ scope: 'global' })
  const [descriptionPrompt, setDescriptionPrompt] = useState('')
  const [generatingDescriptionTargets, setGeneratingDescriptionTargets] = useState<Set<string>>(new Set())

  const selectedAccount = useMemo(
    () => accounts.find((account) => selectedAccounts.includes(account.id)) || null,
    [accounts, selectedAccounts]
  )
  const activeAccounts = useMemo(() => accounts.filter(isAccountAuthorized), [accounts])
  const actualInterval = intervalMode === 'custom' ? customInterval : Number(intervalMode)
  const privacyOption = config.privacyOptions.find((option) => option.value === privacyStatus)
  const PrivacyIcon = getPrivacyIcon(privacyStatus)
  const canPublish = isPlatformPublishReady({
    selectedVideoCount: selectedVideos.length,
    selectedAccountCount: selectedAccounts.length,
    privacySelected: !!privacyStatus,
    isPublishing,
  })
  const privacyLabel = isEnglish ? 'Publishing status' : config.privacyLabel || '可见范围'
  const privacyPlaceholder = isEnglish ? 'Select a publishing status' : config.privacyPlaceholder || '请选择可见范围'
  const privacyMissingMessage = isEnglish ? `Select a ${config.platformName} publishing status` : config.privacyMissingMessage || '请选择发布可见范围'
  const scheduleLabel = isEnglish ? 'Scheduled publishing' : config.scheduleLabel || '预约发布'
  const minScheduleLeadMs = (config.minScheduleLeadMinutes || 0) * 60 * 1000
  const maxScheduleAheadMs = (config.maxScheduleAheadDays || 0) * 24 * 60 * 60 * 1000
  const maxFileSizeLabel = config.maxFileSizeLabel || DEFAULT_MAX_FILE_SIZE_LABEL
  const acceptedVideoExtensions = getAcceptedVideoExtensions(config.acceptedVideoExtensions)
  const videoFormatsLabel = getVideoFormatsLabel(config.acceptedVideoExtensions, config.videoFormatsLabel)
  const normalizedTags = useMemo(() => normalizeTagsInput(tagsText), [tagsText])
  const formattedTagsText = formatTags(normalizedTags)
  const tagsLength = formattedTagsText.length
  const commonInstagramCaptionLength = buildInstagramCaption(caption, description, normalizedTags).length
  const showCategorySelect = (config.categoryOptions?.length || 0) > 0
  const effectiveActiveTab = activeTab === 'comments' && !showCommentManagement ? 'create' : activeTab
  const pageTitle = isEnglish && config.pageTitleEn
    ? config.pageTitleEn
    : isEnglish ? `${config.platformName} Video Publishing` : config.pageTitle || `${config.platformName} 视频发布`
  const pageDescription = isEnglish && config.pageDescriptionEn
    ? config.pageDescriptionEn
    : isEnglish ? `Publish videos to ${config.platformName} with local scheduling support.` : config.pageDescription || `视频发布至 ${config.platformName}，支持多条内容本地预约队列`
  const accountManagementLabel = isEnglish && config.accountManagementLabelEn
    ? config.accountManagementLabelEn
    : isEnglish ? 'Account Management' : config.accountManagementLabel || '账号管理'

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const response = await fetch(`${config.apiBase}/accounts`)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localizeApiMessage(data?.error, isEnglish, 'Failed to load accounts'))
      setAccounts(data.accounts || [])
    } catch (error) {
      toast({
        title: uiText(isEnglish, '账号加载失败', 'Account loading failed'),
        description: error instanceof Error
          ? localizeApiMessage(error.message, isEnglish, `Unable to load ${config.platformName} accounts`)
          : uiText(isEnglish, `无法获取 ${config.platformName} 账号`, `Unable to load ${config.platformName} accounts`),
        variant: 'destructive',
      })
    } finally {
      setLoadingAccounts(false)
    }
  }, [config.apiBase, config.platformName, isEnglish, toast])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  useEffect(() => {
    if (!privacyStatus && config.privacyOptions.length === 1) {
      setPrivacyStatus(config.privacyOptions[0].value)
    }
  }, [config.privacyOptions, privacyStatus])

  useEffect(() => {
    if (!privacyDropdownOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (privacyDropdownRef.current && !privacyDropdownRef.current.contains(event.target as Node)) {
        setPrivacyDropdownOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPrivacyDropdownOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [privacyDropdownOpen])

  function setScheduledTimeToNearestSlot() {
    if (scheduledDate) return
    const now = new Date()
    if (config.minScheduleLeadMinutes) {
      now.setMinutes(now.getMinutes() + config.minScheduleLeadMinutes)
      const mins = now.getMinutes()
      if (mins > 0 && mins <= 30) {
        now.setMinutes(30)
      } else if (mins > 30) {
        now.setHours(now.getHours() + 1)
        now.setMinutes(0)
      }
    } else {
      const mins = now.getMinutes()
      if (mins < 15) {
        now.setMinutes(0)
      } else if (mins < 45) {
        now.setMinutes(30)
      } else {
        now.setHours(now.getHours() + 1)
        now.setMinutes(0)
      }
    }
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hour = String(now.getHours()).padStart(2, '0')
    const minute = String(now.getMinutes()).padStart(2, '0')
    setScheduledDate(`${year}-${month}-${day}`)
    setScheduledTime(`${hour}:${minute}`)
  }

  function toggleAccountSelection(accountId: string) {
    setSelectedAccounts((current) => current.includes(accountId) ? [] : [accountId])
  }

  function updateVideoTitle(videoId: string, title: string) {
    setSelectedVideos((current) => current.map((video) => (
      video.id === videoId ? { ...video, title: title.slice(0, config.maxTitleLength) } : video
    )))
  }

  function updateVideoDescription(videoId: string, nextDescription: string) {
    setSelectedVideos((current) => current.map((video) => (
      video.id === videoId ? { ...video, description: nextDescription.slice(0, config.maxDescriptionLength) } : video
    )))
  }

  function switchTitleMode(mode: TitleMode) {
    setTitleMode(mode)
    if (mode === 'individual') {
      setSelectedVideos((current) => current.map((video, index) => ({
        ...video,
        title: video.title || getDefaultVideoTitle(video.name, index, isEnglish),
        description: video.description || '',
      })))
    }
  }

  function applyFilenameTitles() {
    setSelectedVideos((current) => current.map((video, index) => ({
      ...video,
      title: getDefaultVideoTitle(video.name, index, isEnglish),
    })))
  }

  function removeVideo(videoId: string) {
    setSelectedVideos((current) => removeSelectedVideo(current, videoId))
  }

  function clearCurrentTask() {
    setSelectedVideos([])
    setSelectedAccounts([])
    setCaption('')
    setDescription('')
    setTagsText('')
    setTaskGroupName('')
    setPrivacyStatus(null)
    setContentCategory(config.categoryOptions?.[0]?.value || 'OTHER')
    setPublishError(null)
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files?.length) return

    setUploadError(null)
    const incoming = Array.from(files).slice(0, MAX_VIDEOS - selectedVideos.length)
    const validFiles: { file: File; id: string }[] = []

    for (const file of incoming) {
      const error = validateFile(file, config, isEnglish)
      if (error) {
        setUploadError(`${file.name}: ${error}`)
        continue
      }
      validFiles.push({ file, id: makeId('upload') })
    }

    if (validFiles.length === 0) return

    setUploadingFiles(validFiles.map(({ file, id }) => ({
      id,
      name: file.name,
      progress: 0,
      status: 'pending',
    })))

    const updateFileStatus = (fileId: string, updates: Partial<FileUploadStatus>) => {
      setUploadingFiles((current) => current.map((file) => (
        file.id === fileId ? { ...file, ...updates } : file
      )))
    }

    async function uploadSingleFile({ file, id }: { file: File; id: string }): Promise<SelectedVideo | null> {
      updateFileStatus(id, { status: 'uploading', progress: 5, error: undefined })
      try {
        const contentType = getFileContentType(file)
        const credentialsEndpoint = getUploadCredentialsEndpoint(config.platform)
        const [metadata, credentialsResponse] = await Promise.all([
          readVideoMetadata(file),
          fetch(credentialsEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              contentType,
              platform: config.platform,
              fileSize: file.size,
            }),
          }),
        ])

        const credentialsData = await credentialsResponse.json().catch(() => null)
        if (!credentialsResponse.ok || !credentialsData?.success || !credentialsData?.data?.uploadUrl || !credentialsData?.data?.publicUrl) {
          throw new Error(localizeApiMessage(credentialsData?.error, isEnglish, 'Unable to get upload credentials') || uiText(isEnglish, '获取上传凭证失败', 'Unable to get upload credentials'))
        }

        await putFileToOss(
          file,
          credentialsData.data.uploadUrl,
          contentType,
          (progress) => updateFileStatus(id, { progress: Math.min(progress, 95) }),
          { platform: config.platform, isEnglish }
        )

        let localUrl: string | undefined
        try {
          localUrl = URL.createObjectURL(file)
        } catch {
          localUrl = undefined
        }

        const video = createUploadedVideoSelection({
          id,
          name: file.name,
          publicUrl: credentialsData.data.publicUrl,
          thumbnail: metadata.thumbnail || '',
          localUrl,
          duration: metadata.duration,
          size: file.size,
          contentType,
          title: getDefaultVideoTitle(file.name, undefined, isEnglish),
        })
        updateFileStatus(id, { status: 'done', progress: 100 })
        return video
      } catch (error) {
        updateFileStatus(id, {
          status: 'error',
          progress: 0,
          error: error instanceof Error ? localizeApiMessage(error.message, isEnglish, 'Upload failed') : uiText(isEnglish, '上传失败', 'Upload failed'),
        })
        return null
      }
    }

    const uploadResults = await Promise.all(validFiles.map(uploadSingleFile))
    if (uploadResults.some((video) => video !== null)) {
      setSelectedVideos((current) => commitUploadResults(current, uploadResults, MAX_VIDEOS))
    }
    setTimeout(() => setUploadingFiles([]), 2000)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function checkUrlAccessible(url: string) {
    try {
      const response = await fetch('/api/upload/check-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const result = await response.json().catch(() => null)
      return result?.accessible === true
    } catch {
      return false
    }
  }

  async function fetchAssets() {
    setLoadingAssets(true)
    try {
      const response = await fetch('/api/user/tasks?type=video&status=completed&limit=50')
      const result = await response.json().catch(() => null)
      const tasks = result?.data?.tasks || result?.tasks || []
      const videoTasks = tasks.filter((task: AssetItem) => task.type === 'video' && task.resultUrl)
      const checked = await Promise.all(videoTasks.map(async (task: AssetItem) => ({
        task,
        accessible: await checkUrlAccessible(task.resultUrl!),
      })))
      setAssets(checked.filter((item) => item.accessible).map((item) => item.task))
    } catch (error) {
      toast({
        title: uiText(isEnglish, '加载失败', 'Load failed'),
        description: error instanceof Error
          ? localizeApiMessage(error.message, isEnglish, 'Unable to load the creation workspace')
          : uiText(isEnglish, '无法获取视频制作区内容', 'Unable to load the creation workspace'),
        variant: 'destructive',
      })
    } finally {
      setLoadingAssets(false)
    }
  }

  async function openAssetSelector() {
    setSelectedAssetIds([])
    setAssetDialogOpen(true)
    await fetchAssets()
  }

  function toggleAssetSelection(assetId: string) {
    if (transferringAssets) return
    setSelectedAssetIds((current) => (
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId]
    ))
  }

  async function transferSingleAsset(asset: AssetItem) {
    const response = await fetch('/api/upload/transfer-to-oss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceUrl: asset.resultUrl,
        filename: asset.prompt?.slice(0, 30) || 'video',
      }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success || !result?.data?.url) {
      throw new Error(localizeApiMessage(result?.error, isEnglish, 'Video transfer failed') || uiText(isEnglish, '视频转存失败', 'Video transfer failed'))
    }

    return {
      id: asset.id,
      type: 'asset' as const,
      name: asset.prompt?.slice(0, 30) || uiText(isEnglish, `视频 ${format(new Date(asset.createdAt), 'MM/dd HH:mm')}`, `Video ${format(new Date(asset.createdAt), 'MM/dd HH:mm')}`),
      thumbnail: asset.thumbnailUrl || '',
      url: result.data.url,
      localUrl: result.data.url,
      duration: 30,
      title: getDefaultVideoTitle(asset.prompt?.slice(0, 30) || uiText(isEnglish, `视频 ${format(new Date(asset.createdAt), 'MM/dd HH:mm')}`, `Video ${format(new Date(asset.createdAt), 'MM/dd HH:mm')}`), undefined, isEnglish),
      description: '',
    } satisfies SelectedVideo
  }

  async function addSelectedAssets() {
    const selectedAssets = assets.filter((asset) => selectedAssetIds.includes(asset.id))
    const existingIds = new Set(selectedVideos.map((video) => video.id))
    const uniqueAssets = selectedAssets.filter((asset) => !existingIds.has(asset.id))

    if (uniqueAssets.length === 0) {
      setAssetDialogOpen(false)
      return
    }

    setTransferringAssets(true)
    try {
      const transferred = await Promise.all(uniqueAssets.map(transferSingleAsset))
      setSelectedVideos((current) => [...current, ...transferred])
      setAssetDialogOpen(false)
      setSelectedAssetIds([])
    } catch (error) {
      toast({
        title: uiText(isEnglish, '转存失败', 'Transfer failed'),
        description: error instanceof Error ? localizeApiMessage(error.message, isEnglish, 'Please try again later') : uiText(isEnglish, '请稍后重试', 'Please try again later'),
        variant: 'destructive',
      })
    } finally {
      setTransferringAssets(false)
    }
  }

  function openTitleAssistant(target: MetadataAssistantTarget = { scope: 'global' }) {
    setTitleAssistantTarget(target)
    setTitlePrompt('')
    setShowTitleAssistant(true)
  }

  function openDescriptionAssistant(target: MetadataAssistantTarget = { scope: 'global' }) {
    setDescriptionAssistantTarget(target)
    setDescriptionPrompt('')
    setShowDescriptionAssistant(true)
  }

  function setTitleTargetGenerating(targetKey: string, active: boolean) {
    setGeneratingTitleTargets((current) => {
      const next = new Set(current)
      if (active) next.add(targetKey)
      else next.delete(targetKey)
      return next
    })
  }

  function setDescriptionTargetGenerating(targetKey: string, active: boolean) {
    setGeneratingDescriptionTargets((current) => {
      const next = new Set(current)
      if (active) next.add(targetKey)
      else next.delete(targetKey)
      return next
    })
  }

  async function generateTitleForTarget(target: MetadataAssistantTarget, prompt: string) {
    if (selectedVideos.length === 0) return
    const targetKey = getAssistantTargetKey(target)
    setTitleTargetGenerating(targetKey, true)
    try {
      const targetVideo = target.scope === 'video'
        ? selectedVideos.find((video) => video.id === target.videoId)
        : null
      if (target.scope === 'video' && !targetVideo) {
        throw new Error(uiText(isEnglish, '视频已不存在，请重新选择', 'The video no longer exists. Select it again.'))
      }

      const isBatchDifferent = titleMode === 'individual' && target.scope === 'global'
      const targetVideoIndex = targetVideo ? selectedVideos.findIndex((video) => video.id === targetVideo.id) : -1
      const currentTitle = targetVideo
        ? targetVideo.title || getDefaultVideoTitle(targetVideo.name, targetVideoIndex >= 0 ? targetVideoIndex : 0, isEnglish)
        : caption
      const promptDescription = prompt || [
        targetVideo?.description?.trim(),
        currentTitle,
        targetVideo?.name,
        !targetVideo ? description.trim() : '',
        !targetVideo ? formattedTagsText : '',
        !targetVideo ? selectedVideos.map((video) => video.name).filter(Boolean).join(isEnglish ? ', ' : '、') : '',
      ].filter(Boolean).join('\n') || uiText(isEnglish, '视频内容', 'Video content')

      const response = await fetch(getGenerateTitlesEndpoint(config.platform), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: promptDescription,
          count: isBatchDifferent ? selectedVideos.length : 1,
          language: isEnglish ? 'en' : 'zh',
          platform: config.platform,
          videoNames: targetVideo ? [targetVideo.name] : selectedVideos.map((video) => video.name),
          currentTitle,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(localizeApiMessage(data?.error, isEnglish, 'Generation failed'))
      const titles = (data.titles || [])
        .map((item: { title?: string; combined?: string }) => item.title || item.combined || '')
        .filter(Boolean)

      if (targetVideo) {
        updateVideoTitle(targetVideo.id, (titles[0] || currentTitle).slice(0, config.maxTitleLength))
      } else if (isBatchDifferent) {
        setSelectedVideos((current) => current.map((video, index) => ({
          ...video,
          title: (titles[index] || titles[0] || video.title || getDefaultVideoTitle(video.name, index, isEnglish)).slice(0, config.maxTitleLength),
        })))
      } else {
        setCaption((titles[0] || caption).slice(0, config.maxTitleLength))
      }

      if (data.fallback) {
        toast({
          title: uiText(isEnglish, 'AI 写标题已生成', 'AI title generated'),
          description: localizeApiMessage(data.warning, isEnglish, 'No AI key is configured, so a local fallback was used.'),
        })
      }
    } catch (error) {
      toast({
        title: uiText(isEnglish, 'AI 写标题失败', 'AI title generation failed'),
        description: error instanceof Error ? localizeApiMessage(error.message, isEnglish, 'Please try again later') : uiText(isEnglish, '请稍后再试', 'Please try again later'),
        variant: 'destructive',
      })
    } finally {
      setTitleTargetGenerating(targetKey, false)
    }
  }

  function startTitleGeneration() {
    const target = titleAssistantTarget
    const prompt = titlePrompt.trim()
    const targetKey = getAssistantTargetKey(target)
    if (generatingTitleTargets.has(targetKey)) return

    setShowTitleAssistant(false)
    setTitlePrompt('')
    setTitleAssistantTarget({ scope: 'global' })
    void generateTitleForTarget(target, prompt)
  }

  async function generateDescriptionForTarget(target: MetadataAssistantTarget, prompt: string) {
    if (selectedVideos.length === 0) return
    const targetKey = getAssistantTargetKey(target)
    setDescriptionTargetGenerating(targetKey, true)
    try {
      const targetVideo = target.scope === 'video'
        ? selectedVideos.find((video) => video.id === target.videoId)
        : null
      if (target.scope === 'video' && !targetVideo) {
        throw new Error(uiText(isEnglish, '视频已不存在，请重新选择', 'The video no longer exists. Select it again.'))
      }

      const targetVideoIndex = targetVideo ? selectedVideos.findIndex((video) => video.id === targetVideo.id) : -1
      const response = await fetch(getGenerateDescriptionEndpoint(config.platform), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          title: targetVideo
            ? targetVideo.title || getDefaultVideoTitle(targetVideo.name, targetVideoIndex >= 0 ? targetVideoIndex : 0, isEnglish)
            : titleMode === 'individual'
              ? selectedVideos.map((video, index) => video.title || getDefaultVideoTitle(video.name, index, isEnglish)).join(isEnglish ? ', ' : '、')
              : caption,
          description: targetVideo
            ? targetVideo.description || ''
            : titleMode === 'individual'
              ? selectedVideos.map((video) => video.description || '').filter(Boolean).join('\n')
              : description,
          taskName: taskGroupName,
          videoNames: targetVideo ? [targetVideo.name] : selectedVideos.map((video) => video.name),
          tags: normalizedTags,
          platform: config.platform,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(localizeApiMessage(data?.error, isEnglish, 'Generation failed'))
      const nextDescription = String(data.description || '').slice(0, config.maxDescriptionLength)

      if (targetVideo) {
        updateVideoDescription(targetVideo.id, nextDescription)
      } else if (titleMode === 'individual') {
        setSelectedVideos((current) => current.map((video) => ({
          ...video,
          description: nextDescription,
        })))
      } else {
        setDescription(nextDescription)
      }
    } catch (error) {
      toast({
        title: uiText(isEnglish, 'AI 写描述失败', 'AI description generation failed'),
        description: error instanceof Error ? localizeApiMessage(error.message, isEnglish, 'Please try again later') : uiText(isEnglish, '请稍后再试', 'Please try again later'),
        variant: 'destructive',
      })
    } finally {
      setDescriptionTargetGenerating(targetKey, false)
    }
  }

  function startDescriptionGeneration() {
    const target = descriptionAssistantTarget
    const prompt = descriptionPrompt.trim()
    const targetKey = getAssistantTargetKey(target)
    if (generatingDescriptionTargets.has(targetKey)) return

    setShowDescriptionAssistant(false)
    setDescriptionPrompt('')
    setDescriptionAssistantTarget({ scope: 'global' })
    void generateDescriptionForTarget(target, prompt)
  }

  async function handlePublish() {
    if (selectedVideos.length === 0) {
      setPublishError(uiText(isEnglish, '请至少选择一个视频', 'Select at least one video'))
      return
    }
    if (selectedAccounts.length === 0) {
      setPublishError(uiText(isEnglish, '请至少选择一个发布账号/账号组', 'Select at least one publishing account'))
      return
    }
    if (!privacyStatus) {
      setPublishError(privacyMissingMessage)
      return
    }
    if (tagsLength > config.maxTagsLength) {
      setPublishError(uiText(isEnglish, `${config.platformName} 标签不能超过 ${config.maxTagsLength} 个字符`, `${config.platformName} tags cannot exceed ${config.maxTagsLength} characters`))
      return
    }
    if (titleMode === 'uniform') {
      if (caption.length > config.maxTitleLength) {
        setPublishError(uiText(isEnglish, `${config.platformName} 标题不能超过 ${config.maxTitleLength} 个字符`, `${config.platformName} title cannot exceed ${config.maxTitleLength} characters`))
        return
      }
      if (description.length > config.maxDescriptionLength) {
        setPublishError(uiText(isEnglish, `${config.platformName} 描述不能超过 ${config.maxDescriptionLength} 个字符`, `${config.platformName} description cannot exceed ${config.maxDescriptionLength} characters`))
        return
      }
      if (config.maxCombinedTextLength && commonInstagramCaptionLength > config.maxCombinedTextLength) {
        setPublishError(uiText(isEnglish, `${config.platformName} 标题、描述和标签合计不能超过 ${config.maxCombinedTextLength} 个字符`, `${config.platformName} title, description, and tags cannot exceed ${config.maxCombinedTextLength} characters combined`))
        return
      }
    } else {
      for (let index = 0; index < selectedVideos.length; index++) {
        const video = selectedVideos[index]
        const videoTitle = video.title || getDefaultVideoTitle(video.name, index, isEnglish)
        const videoDescription = video.description || ''
        if (videoTitle.length > config.maxTitleLength) {
          setPublishError(uiText(isEnglish, `视频 ${index + 1} 标题不能超过 ${config.maxTitleLength} 个字符`, `Video ${index + 1} title cannot exceed ${config.maxTitleLength} characters`))
          return
        }
        if (videoDescription.length > config.maxDescriptionLength) {
          setPublishError(uiText(isEnglish, `视频 ${index + 1} 描述不能超过 ${config.maxDescriptionLength} 个字符`, `Video ${index + 1} description cannot exceed ${config.maxDescriptionLength} characters`))
          return
        }
        if (config.maxCombinedTextLength && buildInstagramCaption(videoTitle, videoDescription, []).length > config.maxCombinedTextLength) {
          setPublishError(uiText(isEnglish, `视频 ${index + 1} 标题和描述合计不能超过 ${config.maxCombinedTextLength} 个字符`, `Video ${index + 1} title and description cannot exceed ${config.maxCombinedTextLength} characters combined`))
          return
        }
      }
    }
    if (publishMode === 'scheduled' && (!scheduledDate || !scheduledTime)) {
      setPublishError(uiText(isEnglish, `请选择${scheduleLabel}时间`, `Select a scheduled publishing time`))
      return
    }
    if (publishMode === 'scheduled') {
      const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}`)
      if (Number.isNaN(scheduledAt.getTime())) {
        setPublishError(uiText(isEnglish, `${scheduleLabel}时间格式无效`, 'Invalid scheduled publishing time'))
        return
      }
      if (scheduledAt.getTime() <= Date.now()) {
        setPublishError(uiText(isEnglish, `${scheduleLabel}时间不能早于当前时间`, 'Scheduled publishing time must be in the future'))
        return
      }
      if (minScheduleLeadMs > 0 && scheduledAt.getTime() < Date.now() + minScheduleLeadMs) {
        setPublishError(uiText(isEnglish, `${config.platformName} ${scheduleLabel}至少需要提前 ${config.minScheduleLeadMinutes} 分钟`, `${config.platformName} scheduled publishing requires at least ${config.minScheduleLeadMinutes} minutes of lead time`))
        return
      }
      if (maxScheduleAheadMs > 0 && scheduledAt.getTime() > Date.now() + maxScheduleAheadMs) {
        setPublishError(uiText(isEnglish, `${config.platformName} ${scheduleLabel}不能超过 ${config.maxScheduleAheadDays} 天`, `${config.platformName} scheduled publishing cannot be more than ${config.maxScheduleAheadDays} days ahead`))
        return
      }
    }
    if (publishMode === 'now' && selectedVideos.length >= 3 && actualInterval === 0) {
      const confirmed = window.confirm(uiText(
        isEnglish,
        `您即将立即发布 ${selectedVideos.length} 条视频，且发布间隔为 0 分钟。\n\n短时间内连续发布多条视频可能导致部分视频发布失败。\n\n建议设置 3~5 分钟的发布间隔，以确保每条视频都能成功发布。\n\n是否仍然继续？`,
        `You are about to publish ${selectedVideos.length} videos immediately with no interval.\n\nPublishing several videos in quick succession may cause some uploads to fail.\n\nA 3–5 minute interval is recommended.\n\nContinue anyway?`
      ))
      if (!confirmed) return
    }

    setIsPublishing(true)
    setPublishError(null)

    try {
      const response = await fetch(`${config.apiBase}/publish/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: taskGroupName,
          videos: selectedVideos.map((video) => ({
            id: video.id,
            type: video.type,
            name: video.name,
            url: video.url,
            title: titleMode === 'individual' ? video.title || getDefaultVideoTitle(video.name, undefined, isEnglish) : undefined,
            description: titleMode === 'individual' ? video.description || '' : undefined,
          })),
          account_ids: selectedAccounts,
          title: titleMode === 'uniform' ? caption : '',
          description: titleMode === 'uniform' ? description : '',
          category_id: config.platform === 'facebook' ? contentCategory : undefined,
          tags: titleMode === 'uniform' ? normalizedTags : [],
          privacy_status: privacyStatus,
          made_for_kids: false,
          notify_subscribers: false,
          publish_mode: publishMode,
          scheduled_at: publishMode === 'scheduled'
            ? new Date(`${scheduledDate}T${scheduledTime}`).toISOString()
            : null,
          batch_interval: actualInterval,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localizeApiMessage(data?.error, isEnglish, 'Failed to create publishing task'))

      toast({
        title: localizeApiMessage(data?.message, isEnglish, 'Publishing task created'),
        description: data?.processing?.failed > 0
          ? uiText(isEnglish, `失败 ${data.processing.failed} 项，请到任务管理查看详情。`, `${data.processing.failed} items failed. View task management for details.`)
          : undefined,
      })
      clearCurrentTask()
      setActiveTab('tasks')
    } catch (error) {
      setPublishError(error instanceof Error ? localizeApiMessage(error.message, isEnglish, 'Failed to create publishing task') : uiText(isEnglish, '创建发布任务失败', 'Failed to create publishing task'))
    } finally {
      setIsPublishing(false)
    }
  }

  const titleAssistantVideoIndex = titleAssistantTarget.scope === 'video'
    ? selectedVideos.findIndex((video) => video.id === titleAssistantTarget.videoId)
    : -1
  const descriptionAssistantVideoIndex = descriptionAssistantTarget.scope === 'video'
    ? selectedVideos.findIndex((video) => video.id === descriptionAssistantTarget.videoId)
    : -1
  const titleAssistantVideoNumber = titleAssistantVideoIndex >= 0 ? titleAssistantVideoIndex + 1 : 1
  const descriptionAssistantVideoNumber = descriptionAssistantVideoIndex >= 0 ? descriptionAssistantVideoIndex + 1 : 1
  const titleAssistantTitle = titleAssistantTarget.scope === 'video'
    ? uiText(isEnglish, `AI 写视频 ${titleAssistantVideoNumber} 标题`, `Write title for video ${titleAssistantVideoNumber} with AI`)
    : titleMode === 'individual'
      ? uiText(isEnglish, 'AI 批量写标题', 'Write titles with AI')
      : uiText(isEnglish, 'AI 写标题', 'Write title with AI')
  const descriptionAssistantTitle = descriptionAssistantTarget.scope === 'video'
    ? uiText(isEnglish, `AI 写视频 ${descriptionAssistantVideoNumber} 描述`, `Write description for video ${descriptionAssistantVideoNumber} with AI`)
    : titleMode === 'individual'
      ? uiText(isEnglish, 'AI 批量写描述', 'Write descriptions with AI')
      : uiText(isEnglish, 'AI 写描述', 'Write description with AI')
  const titleDialogGenerating = generatingTitleTargets.has(getAssistantTargetKey(titleAssistantTarget))
  const descriptionDialogGenerating = generatingDescriptionTargets.has(getAssistantTargetKey(descriptionAssistantTarget))
  const globalTitleGenerating = generatingTitleTargets.has('global')
  const globalDescriptionGenerating = generatingDescriptionTargets.has('global')

  return (
    <div className="mx-auto min-h-full max-w-7xl space-y-6 p-6 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
            <span className="text-white drop-shadow-lg">{pageTitle}</span>
          </h1>
          <p className="ml-[19px] mt-1 text-white/60">
            {pageDescription}
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.push(config.accountManagePath || `${config.routeBase}/accounts`)}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 transition-all hover:border-white/20 hover:bg-white/10"
        >
          <Settings className="h-4 w-4 text-white/70" />
          <span className="text-white/80">{accountManagementLabel}</span>
        </button>
      </div>

      <div className="flex w-fit gap-1 rounded-xl border border-white/10 bg-black/40 p-1.5 backdrop-blur-md">
        {[
          {
            id: 'create' as TabType,
            label: isEnglish ? 'Video Publishing' : '视频发布',
            icon: Send,
          },
          {
            id: 'tasks' as TabType,
            label: isEnglish ? 'Video List' : '视频列表',
            icon: ListFilter,
          },
          ...(showCommentManagement
            ? [{ id: 'comments' as TabType, label: isEnglish ? 'Comment Management' : '评论管理', icon: MessageCircle }]
            : []),
        ].map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'group relative flex items-center gap-2 overflow-hidden rounded-lg px-5 py-2.5 font-medium transition-all duration-300',
                effectiveActiveTab === tab.id
                  ? 'bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black shadow-[0_0_20px_rgba(0,242,234,0.4)]'
                  : 'text-white/50 hover:bg-white/5 hover:text-white/80'
              )}
            >
              {effectiveActiveTab === tab.id && (
                <>
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent" />
                  <div className="pointer-events-none absolute left-0 right-0 top-[10%] h-[40%] rounded-lg bg-gradient-to-b from-white/30 to-transparent" />
                </>
              )}
              <Icon className={cn('relative z-10 h-4 w-4', effectiveActiveTab === tab.id && 'text-black')} />
              <span className="relative z-10">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {effectiveActiveTab === 'tasks' ? (
        <PlatformTaskManager config={config} isEnglish={isEnglish} />
      ) : effectiveActiveTab === 'comments' && showCommentManagement ? (
        <SocialCommentsClient
          platformLock={config.platform}
          embedded
          instagramReplyEnabled={instagramReplyEnabled}
        />
      ) : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">1</div>
                {uiText(isEnglish, '选择视频', 'Select videos')}
              </h2>

              <div className="flex items-center gap-4">
                {selectedVideos.length > 0 && (
                  <button
                    type="button"
                    onClick={clearCurrentTask}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3 w-3" />
                    {uiText(isEnglish, '清空任务', 'Clear task')}
                  </button>
                )}

                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <span className="text-xs font-medium text-white/60">{uiText(isEnglish, '使用默认封面', 'Use default cover')}</span>
                  <button
                    type="button"
                    onClick={() => setUseDefaultCover((current) => !current)}
                    className={cn(
                      'relative h-6 w-11 rounded-full transition-all duration-300',
                      useDefaultCover
                        ? 'bg-gradient-to-r from-[#CCFF00] to-[#00F2EA] shadow-[0_0_12px_rgba(0,242,234,0.4)]'
                        : 'border border-white/20 bg-white/10'
                    )}
                  >
                    <div className={cn(
                      'absolute left-1 top-1 h-4 w-4 rounded-full transition-all duration-300',
                      useDefaultCover ? 'translate-x-5 bg-black shadow-md' : 'translate-x-0 bg-white/60'
                    )} />
                  </button>
                  <span className={cn('text-xs font-bold', useDefaultCover ? 'text-[#00F2EA]' : 'text-white/40')}>
                    {useDefaultCover ? uiText(isEnglish, '首帧', 'First frame') : uiText(isEnglish, '自定义', 'Custom')}
                  </span>
                </div>
              </div>
            </div>

            {useDefaultCover && selectedVideos.length > 0 && (
              <p className="mb-4 rounded-lg bg-gray-800/50 px-3 py-2 text-xs text-gray-500">
                {uiText(isEnglish, '默认使用视频首帧作为封面。关闭开关可自定义每个视频的封面。', 'The first video frame is used as the cover by default. Turn this off to customize each cover.')}
              </p>
            )}

            <div className="mb-4 inline-flex gap-1 rounded-xl bg-black/40 p-1.5">
              {[
                { id: 'upload' as VideoSourceType, label: uiText(isEnglish, '本地上传', 'Local upload'), Icon: Upload },
                { id: 'asset' as VideoSourceType, label: uiText(isEnglish, '从视频制作区选择', 'Select from creation workspace'), Icon: FileVideo },
              ].map(({ id, label, Icon }) => {
                const active = videoSource === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setVideoSource(id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all duration-300',
                      active
                        ? 'bg-white/10 text-white shadow-lg shadow-black/20 ring-1 ring-white/10'
                        : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
                    )}
                  >
                    <Icon className={cn('h-4 w-4', active && 'text-cyan-400')} />
                    <span>{label}</span>
                  </button>
                )
              })}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedVideoExtensions.join(',')}
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />

            {uploadError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {uploadError}
                <button type="button" onClick={() => setUploadError(null)} className="ml-auto">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {uploadingFiles.length > 0 && (
              <div className="mb-6 rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/90 to-black/90 p-5 shadow-xl backdrop-blur-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-cyan-500/10 p-2">
                      {uploadingFiles.every((file) => file.status === 'done') ? (
                        <CheckCircle2 className="h-5 w-5 text-cyan-400" />
                      ) : (
                        <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">{uiText(isEnglish, `正在上传 ${uploadingFiles.length} 个视频`, `Uploading ${uploadingFiles.length} videos`)}</h3>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {uploadingFiles.filter((file) => file.status === 'done').length}/{uploadingFiles.length} {uiText(isEnglish, '完成', 'completed')}
                        <span className="mx-1.5 text-white/10">|</span>
                        <span className="font-medium text-cyan-400">
                          {Math.round(uploadingFiles.reduce((sum, file) => sum + file.progress, 0) / uploadingFiles.length)}%
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="relative mb-4 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="absolute left-0 top-0 h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 shadow-[0_0_10px_rgba(6,182,212,0.5)] transition-all duration-300 ease-out"
                    style={{ width: `${uploadingFiles.reduce((sum, file) => sum + file.progress, 0) / uploadingFiles.length}%` }}
                  />
                </div>

                <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto pr-2 sm:grid-cols-2">
                  {uploadingFiles.map((file) => (
                    <div key={file.id} className="group flex items-center gap-3 rounded-lg border border-transparent bg-white/5 p-2 transition-colors hover:border-white/5 hover:bg-white/10">
                      <div className="shrink-0">
                        {file.status === 'done' ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/20">
                            <Check className="h-3.5 w-3.5 text-green-400" />
                          </div>
                        ) : file.status === 'error' ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20">
                            <X className="h-3.5 w-3.5 text-red-400" />
                          </div>
                        ) : (
                          <div className="relative flex h-6 w-6 items-center justify-center">
                            <svg className="h-full w-full -rotate-90">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" className="text-white/10" />
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-500 transition-all duration-300" strokeDasharray={62.8} strokeDashoffset={62.8 - (62.8 * file.progress) / 100} />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center justify-between">
                          <span className={cn('truncate text-xs font-medium', file.status === 'done' ? 'text-gray-300 group-hover:text-white' : 'text-white')}>
                            {file.name}
                          </span>
                          <span className={cn(
                            'text-[10px] tabular-nums',
                            file.status === 'done' ? 'text-green-400' : file.status === 'error' ? 'text-red-400' : 'text-cyan-400'
                          )}>
                            {file.status === 'done' ? uiText(isEnglish, '完成', 'Completed') : file.status === 'error' ? uiText(isEnglish, '失败', 'Failed') : `${file.progress}%`}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {selectedVideos.map((video, index) => (
                <div key={video.id} className="group relative aspect-[9/16] overflow-hidden rounded-xl border border-white/10 bg-white/5">
                  {video.thumbnail ? (
                    <img src={video.thumbnail} alt={video.name} className="absolute inset-0 h-full w-full object-cover" />
                  ) : video.url ? (
                    <video src={video.url} className="absolute inset-0 h-full w-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                      <Play className="h-8 w-8" />
                    </div>
                  )}
                  <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
                    {uiText(isEnglish, `视频 ${index + 1}`, `Video ${index + 1}`)}
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <p className="truncate text-xs">{video.name}</p>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="inline-flex items-center gap-1 rounded bg-green-500/30 px-1.5 py-0.5 text-[10px] text-green-300">
                        <Check className="h-2.5 w-2.5" />
                        {uiText(isEnglish, '已上传', 'Uploaded')}
                      </span>
                    </div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex items-center justify-center gap-1 bg-black/70 p-2 backdrop-blur-sm">
                      <button
                        type="button"
                        onClick={() => removeVideo(video.id)}
                        className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-white transition-colors hover:bg-red-500/50"
                      >
                        <Trash2 className="h-3 w-3" />
                        {uiText(isEnglish, '删除', 'Delete')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => {
                  if (videoSource === 'asset') openAssetSelector()
                  else fileInputRef.current?.click()
                }}
                className="flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 text-gray-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
              >
                {videoSource === 'asset' ? (
                  <>
                    <FileVideo className="h-8 w-8" />
                    <span className="px-2 text-center text-xs">{uiText(isEnglish, '从视频制作区选择', 'Select from creation workspace')}</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8" />
                    <span className="px-2 text-center text-xs">
                      {uiText(isEnglish, '上传视频', 'Upload videos')}<br />
                      <span className="text-[10px] text-gray-500">{videoFormatsLabel} · {maxFileSizeLabel}</span>
                    </span>
                  </>
                )}
              </button>
            </div>

            {selectedVideos.length > 0 && (
              <p className="mt-4 text-sm text-gray-400">
                {uiText(isEnglish, '已选择', 'Selected')} <span className="font-semibold text-cyan-400">{selectedVideos.length}</span> {uiText(isEnglish, '个视频', 'videos')}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">2</div>
                {uiText(isEnglish, '选择账号/账号组', 'Select an account')}
              </h2>
              <button
                type="button"
                onClick={() => router.push(`${config.routeBase}/accounts`)}
                className="group relative flex items-center gap-1.5 overflow-hidden rounded-lg bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] px-4 py-2 text-sm font-bold text-black transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.4)]"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/40 via-white/15 to-transparent" />
                <div className="pointer-events-none absolute left-0 right-0 top-[10%] h-[35%] rounded-lg bg-gradient-to-b from-white/25 to-transparent" />
                <Plus className="relative z-10 h-3.5 w-3.5" />
                <span className="relative z-10">{uiText(isEnglish, '去绑定', 'Connect')}</span>
              </button>
            </div>

            {loadingAccounts ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
              </div>
            ) : accounts.length === 0 ? (
              <div className="py-8 text-center">
                <Users className="mx-auto mb-3 h-12 w-12 text-gray-500" />
                <p className="mb-4 text-gray-400">{uiText(isEnglish, `还没有绑定 ${config.platformName} 账号`, `No ${config.platformName} account connected yet`)}</p>
                <button
                  type="button"
                  onClick={() => router.push(`${config.routeBase}/accounts`)}
                  className="group relative overflow-hidden rounded-full bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] px-5 py-2 text-sm font-bold text-black transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(0,242,234,0.5)]"
                >
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent" />
                  <div className="pointer-events-none absolute left-0 right-0 top-[15%] h-[35%] rounded-full bg-gradient-to-b from-white/30 to-transparent" />
                  <span className="relative z-10 flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    {uiText(isEnglish, '立即绑定账号', 'Connect account')}
                  </span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {accounts.map((account) => {
                  const authorized = isAccountAuthorized(account)
                  const selected = selectedAccounts.includes(account.id)
                  return (
                    <div
                      key={account.id}
                      onClick={() => authorized && toggleAccountSelection(account.id)}
                      className={cn(
                        'group relative cursor-pointer overflow-hidden rounded-xl border p-4 transition-all duration-300',
                        selected
                          ? 'border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/30'
                          : authorized
                            ? 'border-white/5 bg-white/5 hover:-translate-y-1 hover:border-white/10 hover:bg-white/10'
                            : 'cursor-not-allowed border-white/5 bg-white/5 opacity-50'
                      )}
                    >
                      {selected && <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent opacity-50" />}
                      <div className="relative flex items-center gap-3">
                        <div className="relative">
                          <div className={cn('h-12 w-12 rounded-full p-0.5', selected ? 'bg-gradient-to-r from-cyan-400 to-blue-500' : 'bg-white/10')}>
                            {account.thumbnail_url ? (
                              <img
                                src={account.thumbnail_url}
                                alt={getAccountName(account)}
                                className="h-full w-full rounded-full border border-black/50 object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 font-bold text-white">
                                {getInitial(account)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <h3 className={cn('truncate text-sm font-semibold', selected ? 'text-white' : 'text-gray-200')}>
                              {getAccountName(account)}
                            </h3>
                            {account.status === 'active' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-400" />}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-gray-400">{getAccountHandle(account)}</p>
                          <p className="mt-0.5 text-xs text-gray-400">{uiText(isEnglish, '粉丝', 'Followers')} {formatNumber(account.subscriber_count, isEnglish)}</p>
                        </div>
                        <div className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                          selected ? 'border-cyan-400 bg-cyan-500' : 'border-white/20 group-hover:border-white/40'
                        )}>
                          {selected && <Check className="h-3.5 w-3.5 text-white" />}
                        </div>
                      </div>
                      {!authorized && (
                        <div className="absolute right-2 top-2">
                          <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] text-orange-400">
                            <AlertCircle className="h-2.5 w-2.5" />
                            {uiText(isEnglish, '需授权', 'Authorization required')}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}

                <button
                  type="button"
                  onClick={() => router.push(`${config.routeBase}/accounts`)}
                  className="group flex min-h-[80px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 p-4 transition-all hover:border-cyan-500/50 hover:bg-cyan-500/5"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 transition-all group-hover:scale-110 group-hover:bg-cyan-500/20">
                    <Plus className="h-5 w-5 text-gray-400 group-hover:text-cyan-400" />
                  </div>
                  <span className="text-sm text-gray-400 group-hover:text-cyan-400">{uiText(isEnglish, '绑定新账号', 'Connect new account')}</span>
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">3</div>
                {uiText(isEnglish, '视频标题与描述', 'Video titles and descriptions')}
              </h2>
              <div className="flex w-fit gap-1 rounded-xl bg-black/40 p-1.5 text-sm">
                <button
                  type="button"
                  onClick={() => switchTitleMode('uniform')}
                  className={cn(
                    'rounded-lg px-4 py-2 font-medium transition-all',
                    titleMode === 'uniform' ? 'bg-white/10 text-cyan-300 ring-1 ring-cyan-400/30' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
                  )}
                >
                  {uiText(isEnglish, '相同内容', 'Same content')}
                </button>
                <button
                  type="button"
                  onClick={() => switchTitleMode('individual')}
                  className={cn(
                    'rounded-lg px-4 py-2 font-medium transition-all',
                    titleMode === 'individual' ? 'bg-white/10 text-pink-300 ring-1 ring-pink-400/30' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
                  )}
                >
                  {uiText(isEnglish, '不同内容', 'Different content')}
                </button>
              </div>
            </div>
            {config.titleDescriptionHint && (
              <p className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-gray-400">
                {isEnglish ? `The title and description are combined into the ${config.platformName} caption.` : config.titleDescriptionHint}
              </p>
            )}

            {titleMode === 'uniform' ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-300">{uiText(isEnglish, '视频标题', 'Video title')}</label>
                    <span className={cn('font-mono text-xs', caption.length > config.maxTitleLength * 0.9 ? 'text-amber-400' : 'text-gray-600')}>
                      {caption.length}/{config.maxTitleLength}
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      value={caption}
                      onChange={(event) => setCaption(event.target.value.slice(0, config.maxTitleLength))}
                      placeholder={uiText(isEnglish, '输入视频标题...', 'Enter a video title...')}
                      maxLength={config.maxTitleLength}
                      className="h-12 border-white/10 bg-white/5 pr-32 text-white placeholder-gray-500 focus:border-cyan-500/50 focus:ring-cyan-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => openTitleAssistant({ scope: 'global' })}
                      disabled={globalTitleGenerating}
                      className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-3 py-1.5 text-xs font-medium text-pink-300 shadow-lg shadow-pink-500/5 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30"
                    >
                      {globalTitleGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {globalTitleGenerating ? uiText(isEnglish, '生成中', 'Generating') : uiText(isEnglish, 'AI 写标题', 'Write title with AI')}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-300">{uiText(isEnglish, '视频描述', 'Video description')}</label>
                    <span className={cn('font-mono text-xs', description.length > config.maxDescriptionLength * 0.9 ? 'text-amber-400' : 'text-gray-600')}>
                      {description.length}/{config.maxDescriptionLength}
                    </span>
                  </div>
                  <div className="group relative">
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value.slice(0, config.maxDescriptionLength))}
                      placeholder={uiText(isEnglish, '输入视频描述...', 'Enter a video description...')}
                      rows={6}
                      maxLength={config.maxDescriptionLength}
                      className="min-h-40 resize-none border-white/10 bg-white/5 pb-14 text-white placeholder-gray-500 focus:border-cyan-500/50 focus:ring-cyan-500/50"
                    />
                    <div className="absolute bottom-3 right-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setTagsText((current) => `${current}${current.trim() ? ' ' : ''}#`)}
                        className="flex items-center gap-1.5 rounded-lg border border-transparent bg-white/5 px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                      >
                        <Hash className="h-3.5 w-3.5" />
                        {uiText(isEnglish, '话题', 'Hashtag')}
                      </button>
                      <button
                        type="button"
                        onClick={() => openDescriptionAssistant({ scope: 'global' })}
                        disabled={globalDescriptionGenerating}
                        className="flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-3 py-1.5 text-xs font-medium text-pink-300 shadow-lg shadow-pink-500/5 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30"
                      >
                        {globalDescriptionGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {globalDescriptionGenerating ? uiText(isEnglish, '生成中', 'Generating') : uiText(isEnglish, 'AI 写描述', 'Write description with AI')}
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-300">{uiText(isEnglish, '标签', 'Tags')}</label>
                    <span className={cn('font-mono text-xs', tagsLength > config.maxTagsLength * 0.9 ? 'text-amber-400' : 'text-gray-600')}>
                      {tagsLength}/{config.maxTagsLength}
                    </span>
                  </div>
                  <Input
                    value={tagsText}
                    onChange={(event) => setTagsText(event.target.value)}
                    placeholder={uiText(isEnglish, '例如：钢琴 音乐 生活记录；会追加到描述中', 'Example: piano music daily life; appended to the description')}
                    className="h-12 border-white/10 bg-white/5 text-white placeholder-gray-500 focus:border-cyan-500/50 focus:ring-cyan-500/50"
                  />
                  {config.tagsHint && (
                    <p className="mt-2 text-xs text-gray-500">{isEnglish ? `Hashtags are appended to the ${config.platformName} description and are not sent as a separate API field.` : config.tagsHint}</p>
                  )}
                  {config.maxCombinedTextLength && (
                    <p className={cn('mt-2 text-xs', commonInstagramCaptionLength > config.maxCombinedTextLength ? 'text-red-400' : 'text-gray-500')}>
                      {uiText(isEnglish, 'Caption 合计', 'Total caption')} {commonInstagramCaptionLength}/{config.maxCombinedTextLength}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={applyFilenameTitles}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {uiText(isEnglish, '按文件名填标题', 'Use filenames as titles')}
                  </button>
                  <button
                    type="button"
                    onClick={() => openTitleAssistant({ scope: 'global' })}
                    disabled={globalTitleGenerating}
                    className="flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-3 py-1.5 text-sm font-medium text-pink-300 shadow-lg shadow-pink-500/5 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30"
                  >
                    {globalTitleGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {globalTitleGenerating ? uiText(isEnglish, '批量生成中', 'Generating') : uiText(isEnglish, 'AI 批量写标题', 'Write titles with AI')}
                  </button>
                  <button
                    type="button"
                    onClick={() => openDescriptionAssistant({ scope: 'global' })}
                    disabled={globalDescriptionGenerating}
                    className="flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-3 py-1.5 text-sm font-medium text-pink-300 shadow-lg shadow-pink-500/5 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30"
                  >
                    {globalDescriptionGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {globalDescriptionGenerating ? uiText(isEnglish, '批量生成中', 'Generating') : uiText(isEnglish, 'AI 批量写描述', 'Write descriptions with AI')}
                  </button>
                </div>

                {selectedVideos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-white/40">
                    {uiText(isEnglish, '上传视频后填写标题和描述', 'Upload videos to add titles and descriptions')}
                  </div>
                ) : (
                  selectedVideos.map((video, index) => {
                    const videoTitle = video.title || getDefaultVideoTitle(video.name, index, isEnglish)
                    const videoDescription = video.description || ''
                    const itemCaptionLength = buildInstagramCaption(videoTitle, videoDescription, normalizedTags).length
                    const itemTitleGenerating = generatingTitleTargets.has(video.id) || globalTitleGenerating
                    const itemDescriptionGenerating = generatingDescriptionTargets.has(video.id)
                    return (
                      <div key={video.id} className="grid gap-4 rounded-xl border border-white/10 bg-black/20 p-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                        <div className="min-w-0">
                          <div className="relative mb-3 aspect-video overflow-hidden rounded-lg border border-white/10 bg-white/5">
                            {video.thumbnail ? (
                              <img src={video.thumbnail} alt={video.name} className="absolute inset-0 h-full w-full object-cover" />
                            ) : video.localUrl || video.url ? (
                              <video src={video.localUrl || video.url} className="absolute inset-0 h-full w-full object-cover" muted playsInline preload="metadata" />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center text-white/35">
                                <FileVideo className="h-6 w-6" />
                              </div>
                            )}
                          </div>
                          <div className="text-sm font-medium text-white">{uiText(isEnglish, `视频 ${index + 1}`, `Video ${index + 1}`)}</div>
                          <div className="mt-1 truncate text-xs text-white/45">{video.name}</div>
                        </div>

                        <div className="grid min-w-0 gap-3">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <label className="text-sm text-white/60">{uiText(isEnglish, '视频标题', 'Video title')}</label>
                                {itemTitleGenerating && (
                                  <span className="flex items-center gap-1 rounded-full bg-pink-500/10 px-2 py-1 text-xs text-pink-200">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    {uiText(isEnglish, '生成中', 'Generating')}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => openTitleAssistant({ scope: 'video', videoId: video.id })}
                                disabled={itemTitleGenerating}
                                className={cn(
                                  'flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-2.5 py-1.5 text-xs font-medium text-pink-300 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30',
                                  itemTitleGenerating && 'cursor-not-allowed opacity-60'
                                )}
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                {uiText(isEnglish, 'AI 写标题', 'Write title with AI')}
                              </button>
                            </div>
                            <Input
                              value={videoTitle}
                              onChange={(event) => updateVideoTitle(video.id, event.target.value)}
                              placeholder={uiText(isEnglish, '输入视频标题...', 'Enter a video title...')}
                              className="border-white/10 bg-black/30 text-white placeholder-gray-500 focus:border-pink-500/50 focus:ring-pink-500/50"
                            />
                            <div className={cn('text-right font-mono text-xs', videoTitle.length > config.maxTitleLength * 0.9 ? 'text-amber-400' : 'text-white/35')}>
                              {videoTitle.length}/{config.maxTitleLength} {uiText(isEnglish, '字符', 'characters')}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <label className="text-sm text-white/60">{uiText(isEnglish, '视频描述', 'Video description')}</label>
                                {itemDescriptionGenerating && (
                                  <span className="flex items-center gap-1 rounded-full bg-pink-500/10 px-2 py-1 text-xs text-pink-200">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    {uiText(isEnglish, '生成中', 'Generating')}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => updateVideoDescription(video.id, `${videoDescription}${videoDescription.trim() ? ' ' : ''}#`)}
                                  className="flex items-center gap-1.5 rounded-lg border border-transparent bg-white/5 px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                                >
                                  <Hash className="h-3.5 w-3.5" />
                                  {uiText(isEnglish, '话题', 'Hashtag')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openDescriptionAssistant({ scope: 'video', videoId: video.id })}
                                  disabled={itemDescriptionGenerating}
                                  className={cn(
                                    'flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-2.5 py-1.5 text-xs font-medium text-pink-300 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30',
                                    itemDescriptionGenerating && 'cursor-not-allowed opacity-60'
                                  )}
                                >
                                  <Sparkles className="h-3.5 w-3.5" />
                                  {uiText(isEnglish, 'AI 写描述', 'Write description with AI')}
                                </button>
                              </div>
                            </div>
                            <Textarea
                              value={videoDescription}
                              onChange={(event) => updateVideoDescription(video.id, event.target.value)}
                              placeholder={uiText(isEnglish, '输入视频描述...', 'Enter a video description...')}
                              maxLength={config.maxDescriptionLength}
                              className="min-h-28 resize-none border-white/10 bg-black/30 text-white placeholder-gray-500 focus:border-pink-500/50 focus:ring-pink-500/50"
                            />
                            <div className={cn('text-right font-mono text-xs', videoDescription.length > config.maxDescriptionLength * 0.9 ? 'text-amber-400' : 'text-white/35')}>
                              {videoDescription.length}/{config.maxDescriptionLength} {uiText(isEnglish, '字符', 'characters')}
                            </div>
                            {config.maxCombinedTextLength && (
                              <p className={cn('mt-1 text-xs', itemCaptionLength > config.maxCombinedTextLength ? 'text-red-400' : 'text-gray-500')}>
                                {uiText(isEnglish, 'Caption 合计', 'Total caption')} {itemCaptionLength}/{config.maxCombinedTextLength}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">4</div>
              {uiText(isEnglish, '发布设置', 'Publishing settings')}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  {uiText(isEnglish, '任务组名称', 'Task group name')} <span className="font-normal text-gray-500">{uiText(isEnglish, '(可选)', '(optional)')}</span>
                </label>
                <input
                  type="text"
                  value={taskGroupName}
                  onChange={(event) => setTaskGroupName(event.target.value)}
                  placeholder={uiText(isEnglish, '例如：今日穿搭分享、产品推广第3期...', 'Example: Daily outfit or Product campaign 3...')}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-500 transition-all focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
                <p className="mt-1 text-xs text-gray-500">{uiText(isEnglish, '为本次发布任务起个名字，方便后续在“发布记录”中查找', 'Name this publishing task so it is easier to find in the task list later.')}</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  {privacyLabel} <span className="text-red-500">*</span>
                </label>
                <div className="relative" ref={privacyDropdownRef}>
                  <div className={cn('pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500/20 to-purple-500/20 transition-opacity duration-300', privacyDropdownOpen ? 'opacity-100' : 'opacity-0')} />
                  <button
                    type="button"
                    onClick={() => setPrivacyDropdownOpen((current) => !current)}
                    className={cn(
                      'relative z-0 flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-white/[0.04] py-3 pl-3 pr-10 font-medium text-white transition-all focus:outline-none',
                      privacyDropdownOpen ? 'border-cyan-500/50' : 'border-white/10'
                    )}
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-gradient-to-br from-cyan-400/20 via-cyan-500/10 to-transparent shadow-[0_0_10px_rgba(34,211,238,0.15),inset_0_1px_1px_rgba(255,255,255,0.1)]">
                      <PrivacyIcon className="h-3.5 w-3.5 text-cyan-300 drop-shadow-[0_0_3px_rgba(34,211,238,0.5)]" />
                    </div>
                    {privacyOption ? (
                      <span>{isEnglish ? 'Public' : privacyOption.label} - {isEnglish ? `Publish to ${config.platformName}` : privacyOption.desc}</span>
                    ) : (
                      <span className="text-gray-500">{privacyPlaceholder}</span>
                    )}
                  </button>
                  <ChevronDown className={cn('pointer-events-none absolute right-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400 transition-transform duration-200', privacyDropdownOpen && 'rotate-180')} />

                  {privacyDropdownOpen && (
                    <div className="animate-in fade-in slide-in-from-top-2 absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 shadow-2xl shadow-black/50 backdrop-blur-xl duration-200">
                      {config.privacyOptions.map((option) => {
                        const Icon = getPrivacyIcon(option.value)
                        const selected = privacyStatus === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setPrivacyStatus(option.value)
                              setPrivacyDropdownOpen(false)
                            }}
                            className={cn('flex w-full cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-cyan-500/10', selected && 'bg-white/[0.06]')}
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-gradient-to-br from-cyan-400/30 via-cyan-500/15 to-transparent shadow-[0_0_10px_rgba(34,211,238,0.2),inset_0_1px_1px_rgba(255,255,255,0.1)]">
                              <Icon className="h-3.5 w-3.5 text-cyan-300" />
                            </div>
                            <div className="flex-1 text-left">
                              <p className="text-sm font-medium text-white">{isEnglish ? 'Public' : option.label}</p>
                              <p className="text-[11px] text-gray-500">{isEnglish ? `Publish to ${config.platformName}` : option.desc}</p>
                            </div>
                            {selected && <Check className="h-4 w-4 shrink-0 text-cyan-400" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {!privacyStatus && selectedAccounts.length > 0 && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-400">
                    <Info className="h-3 w-3" />
                    {privacyMissingMessage}
                  </p>
                )}
              </div>

              {showCategorySelect && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">{uiText(isEnglish, '分类', 'Category')}</label>
                  <Select value={contentCategory} onValueChange={setContentCategory}>
                    <SelectTrigger className="h-12 border-white/10 bg-white/5 text-white">
                      <SelectValue placeholder={uiText(isEnglish, '请选择分类', 'Select a category')} />
                    </SelectTrigger>
                    <SelectContent>
                      {config.categoryOptions?.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {isEnglish ? option.value.toLowerCase().split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="inline-flex gap-1 rounded-xl bg-black/40 p-1.5">
                {[
                  { id: 'now' as PublishMode, label: uiText(isEnglish, '立即发布', 'Publish now'), Icon: Rocket, colorClass: 'text-cyan-400' },
                  { id: 'scheduled' as PublishMode, label: scheduleLabel, Icon: Calendar, colorClass: 'text-pink-400' },
                ].map(({ id, label, Icon, colorClass }) => {
                  const active = publishMode === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setPublishMode(id)
                        if (id === 'scheduled') setScheduledTimeToNearestSlot()
                      }}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-all duration-300',
                        active
                          ? 'bg-white/10 text-white shadow-lg shadow-black/20 ring-1 ring-white/10'
                          : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
                      )}
                    >
                      <Icon className={cn('h-4 w-4', active && colorClass)} />
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>

              {publishMode === 'scheduled' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className="mb-1 block text-sm text-gray-400">{uiText(isEnglish, '日期', 'Date')}</label>
                      <input
                        type="date"
                        value={scheduledDate}
                        onChange={(event) => setScheduledDate(event.target.value)}
                        min={format(new Date(), 'yyyy-MM-dd')}
                        className="rounded-lg border border-white/10 bg-[#1a1a2e] px-4 py-2 text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-gray-400">{uiText(isEnglish, '时间', 'Time')}</label>
                      <input
                        type="time"
                        value={scheduledTime}
                        onChange={(event) => setScheduledTime(event.target.value)}
                        className="rounded-lg border border-white/10 bg-[#1a1a2e] px-4 py-2 text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                      />
                    </div>
                  </div>
                  {scheduledDate && scheduledTime && (() => {
                    const selectedTime = new Date(`${scheduledDate}T${scheduledTime}`)
                    const now = Date.now()
                    const isPast = selectedTime.getTime() <= now
                    const isTooSoon = minScheduleLeadMs > 0 && selectedTime.getTime() < now + minScheduleLeadMs
                    const isTooFar = maxScheduleAheadMs > 0 && selectedTime.getTime() > now + maxScheduleAheadMs
                    return (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-400">
                          <span className="mr-1 inline-block rounded bg-red-500/20 px-1 py-0.5 text-[10px] font-medium text-red-300">{uiText(isEnglish, '北京', 'Beijing')}</span>
                          {scheduledDate.slice(5).replace('-', '/')} {scheduledTime}
                        </p>
                        {isPast && <p className="text-xs text-red-400">{uiText(isEnglish, '所选时间已过，请选择未来的时间', 'The selected time has passed. Choose a future time.')}</p>}
                        {!isPast && isTooSoon && (
                          <p className="text-xs text-amber-400">
                            {uiText(isEnglish, `${config.platformName} 本地预约队列至少需要提前 ${config.minScheduleLeadMinutes} 分钟`, `${config.platformName} requires scheduling at least ${config.minScheduleLeadMinutes} minutes in advance.`)}
                          </p>
                        )}
                        {isTooFar && (
                          <p className="text-xs text-amber-400">
                            {uiText(isEnglish, `${config.platformName} 本地预约时间不能超过 ${config.maxScheduleAheadDays} 天`, `${config.platformName} cannot be scheduled more than ${config.maxScheduleAheadDays} days ahead.`)}
                          </p>
                        )}
                        {config.scheduleHint && !isPast && !isTooSoon && !isTooFar && (
                          <p className="text-xs text-gray-500">{isEnglish ? 'The local queue will process the publishing task at the selected time.' : config.scheduleHint}</p>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}

              {selectedVideos.length > 1 && (
                <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-cyan-400" />
                    <div>
                      <p className="text-sm font-medium">{uiText(isEnglish, '发布间隔', 'Publishing interval')}</p>
                      <p className="text-xs text-gray-400">{uiText(isEnglish, '本地队列会按间隔逐条处理多视频发布任务', 'The local queue processes multi-video publishing tasks one at a time using this interval.')}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: '0', label: uiText(isEnglish, '不间隔', 'No interval') },
                      { value: '3', label: uiText(isEnglish, '3分钟', '3 minutes') },
                      { value: '5', label: uiText(isEnglish, '5分钟', '5 minutes') },
                      { value: '10', label: uiText(isEnglish, '10分钟', '10 minutes') },
                      { value: '30', label: uiText(isEnglish, '30分钟', '30 minutes') },
                      { value: '60', label: uiText(isEnglish, '1小时', '1 hour') },
                      { value: '120', label: uiText(isEnglish, '2小时', '2 hours') },
                      { value: '360', label: uiText(isEnglish, '6小时', '6 hours') },
                      { value: '720', label: uiText(isEnglish, '12小时', '12 hours') },
                      { value: '1440', label: uiText(isEnglish, '24小时', '24 hours') },
                    ].map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setIntervalMode(value as IntervalMode)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs transition-all',
                          intervalMode === value
                            ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-400'
                            : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setIntervalMode('custom')}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs transition-all',
                        intervalMode === 'custom'
                          ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-400'
                          : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10'
                      )}
                    >
                      {uiText(isEnglish, '自定义', 'Custom')}
                    </button>
                  </div>

                  {intervalMode === 'custom' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={customInterval}
                        onChange={(event) => setCustomInterval(Math.max(1, Math.min(1440, Number(event.target.value) || 1)))}
                        min={1}
                        max={1440}
                        className="w-20 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-center text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                      />
                      <span className="text-sm text-gray-400">{uiText(isEnglish, '分钟 (最长24小时)', 'minutes (up to 24 hours)')}</span>
                    </div>
                  )}

                  {publishMode === 'scheduled' && scheduledDate && scheduledTime && (
                    <div className="mt-3 rounded-lg bg-white/5 p-3">
                      <p className="mb-2 text-xs text-gray-400">{uiText(isEnglish, '发布时间预览：', 'Publishing time preview:')}</p>
                      <div className="max-h-32 space-y-1 overflow-y-auto">
                        {selectedVideos.slice(0, 10).map((video, index) => {
                          const publishTime = addMinutes(new Date(`${scheduledDate}T${scheduledTime}`), index * actualInterval)
                          return (
                            <div key={video.id} className="flex items-center gap-2 text-xs">
                              <span className="text-gray-500">{uiText(isEnglish, `视频${index + 1}:`, `Video ${index + 1}:`)}</span>
                              <span className="text-cyan-400">{format(publishTime, isEnglish ? 'MMM dd HH:mm' : 'MM月dd日 HH:mm')}</span>
                            </div>
                          )
                        })}
                        {selectedVideos.length > 10 && (
                          <p className="text-xs text-gray-500">{uiText(isEnglish, `... 更多 ${selectedVideos.length - 10} 个视频`, `... ${selectedVideos.length - 10} more videos`)}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="sticky bottom-4 z-10 mt-6">
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-gray-900/80 p-1.5 shadow-2xl backdrop-blur-xl">
              <div className="flex h-16 items-center">
                <div className="flex h-full flex-col justify-center border-r border-white/5 px-5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{uiText(isEnglish, '视频', 'Videos')}</span>
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-2xl font-bold text-white">{selectedVideos.length}</span>
                    <span className="text-xs text-gray-500">{uiText(isEnglish, '个', 'items')}</span>
                  </div>
                </div>
                <div className="flex h-full items-center gap-3 border-r border-white/5 px-5">
                  {selectedAccount ? (
                    <>
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">
                        {getInitial(selectedAccount)}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{uiText(isEnglish, '账号/账号组', 'Account')}</span>
                        <span className="max-w-[100px] truncate text-sm font-medium text-white">
                          {getAccountName(selectedAccount)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{uiText(isEnglish, '账号/账号组', 'Account')}</span>
                      <span className="text-sm text-gray-400">{uiText(isEnglish, '未选择', 'Not selected')}</span>
                    </div>
                  )}
                </div>
                <div className="hidden h-full flex-col justify-center px-5 md:flex">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{uiText(isEnglish, '发布时间', 'Publishing time')}</span>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {publishMode === 'now' ? (
                      <>
                        <Rocket className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="text-cyan-400">{uiText(isEnglish, '立即发布', 'Publish now')}</span>
                      </>
                    ) : (
                      <>
                        <Calendar className="h-3.5 w-3.5 text-pink-400" />
                        <span className="text-pink-400">{scheduledDate} {scheduledTime}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="hidden h-full flex-col justify-center px-5 lg:flex">
                  <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">{uiText(isEnglish, '发布设置', 'Publishing settings')}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {privacyOption ? (
                      <span className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                        <Globe2 className="h-2.5 w-2.5" />
                        {isEnglish ? privacyOption.value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (char) => char.toUpperCase()) : privacyOption.label}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-500">{uiText(isEnglish, '默认', 'Default')}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pr-1.5">
                {publishError && (
                  <p className="mr-2 flex items-center gap-1 text-xs text-red-400">
                    <XCircle className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{publishError}</span>
                  </p>
                )}
                <button
                  type="button"
                  onClick={clearCurrentTask}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-gray-400 transition-colors hover:bg-white/5"
                >
                  {uiText(isEnglish, '取消', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={!canPublish}
                  className="group relative h-12 overflow-hidden rounded-xl bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] px-6 transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(0,242,234,0.5)] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
                >
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent" />
                  <div className="pointer-events-none absolute left-0 right-0 top-[10%] h-[40%] rounded-xl bg-gradient-to-b from-white/30 to-transparent" />
                  <div className="relative z-10 flex items-center gap-2 font-bold text-black">
                    {isPublishing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{uiText(isEnglish, '创建中...', 'Creating...')}</span>
                      </>
                    ) : (
                      <>
                        <span>{uiText(isEnglish, '创建任务', 'Create task')}</span>
                        <Zap className="h-4 w-4" />
                      </>
                    )}
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={assetDialogOpen} onOpenChange={(open) => !transferringAssets && setAssetDialogOpen(open)}>
        <DialogContent className="border-white/10 bg-zinc-950 text-white sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{uiText(isEnglish, '从视频制作区选择', 'Select from the creation workspace')}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 text-sm text-white/50">
            <span>{uiText(isEnglish, `已选择 ${selectedAssetIds.length} 个视频`, `${selectedAssetIds.length} videos selected`)}</span>
            <Button variant="mermaid-ghost" size="sm" onClick={fetchAssets} disabled={loadingAssets || transferringAssets}>
              <RefreshCw className={cn('h-3.5 w-3.5', loadingAssets && 'animate-spin')} />
              {uiText(isEnglish, '刷新', 'Refresh')}
            </Button>
          </div>
          {loadingAssets ? (
            <div className="flex h-64 items-center justify-center text-white/45">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : assets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-white/45">
              {uiText(isEnglish, '暂无可用视频', 'No videos available')}
            </div>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
              {assets.map((asset) => {
                const selected = selectedAssetIds.includes(asset.id)
                const alreadyAdded = selectedVideos.some((video) => video.id === asset.id)
                return (
                  <button
                    key={asset.id}
                    type="button"
                    disabled={transferringAssets || alreadyAdded}
                    onClick={() => toggleAssetSelection(asset.id)}
                    className={cn(
                      'flex gap-3 rounded-xl border p-3 text-left transition',
                      selected ? 'border-cyan-300/60 bg-cyan-300/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20',
                      alreadyAdded && 'cursor-not-allowed opacity-55'
                    )}
                  >
                    <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-black/30">
                      {asset.thumbnailUrl ? (
                        <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/25">
                          <FileVideo className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium text-white">{asset.prompt || asset.model || uiText(isEnglish, '视频制作区', 'Creation workspace')}</p>
                      <p className="mt-2 line-clamp-2 text-xs text-white/40">{format(new Date(asset.createdAt), 'MM/dd HH:mm')}</p>
                      {alreadyAdded && <p className="mt-2 text-xs text-cyan-200">{uiText(isEnglish, '已加入任务', 'Already added')}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="titanium-outline" onClick={() => setAssetDialogOpen(false)} disabled={transferringAssets}>{uiText(isEnglish, '取消', 'Cancel')}</Button>
            <Button variant="mermaid" onClick={addSelectedAssets} disabled={selectedAssetIds.length === 0 || transferringAssets}>
              {transferringAssets ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {uiText(isEnglish, '添加到任务', 'Add to task')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showTitleAssistant}
        onOpenChange={(open) => {
          setShowTitleAssistant(open)
          if (!open) {
            setTitlePrompt('')
            setTitleAssistantTarget({ scope: 'global' })
          }
        }}
      >
        <DialogContent className="border-white/10 bg-zinc-950 text-white">
          <DialogHeader>
            <DialogTitle>{titleAssistantTitle}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={titlePrompt}
            onChange={(event) => setTitlePrompt(event.target.value)}
            placeholder={titleAssistantTarget.scope === 'video'
              ? uiText(isEnglish, '可填写这条视频的风格、关键词或禁用词', 'Add a style, keywords, or terms to avoid for this video')
              : uiText(isEnglish, '可填写风格、关键词或禁用词', 'Add a style, keywords, or terms to avoid')}
            className="min-h-32 border-white/10 bg-white/[0.04] text-white"
          />
          <DialogFooter>
            <Button variant="titanium-outline" onClick={() => setShowTitleAssistant(false)} disabled={titleDialogGenerating}>{uiText(isEnglish, '取消', 'Cancel')}</Button>
            <Button variant="mermaid" onClick={startTitleGeneration} disabled={titleDialogGenerating}>
              {titleDialogGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {titleDialogGenerating ? uiText(isEnglish, '生成中', 'Generating') : uiText(isEnglish, '生成', 'Generate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showDescriptionAssistant}
        onOpenChange={(open) => {
          setShowDescriptionAssistant(open)
          if (!open) {
            setDescriptionPrompt('')
            setDescriptionAssistantTarget({ scope: 'global' })
          }
        }}
      >
        <DialogContent className="border-white/10 bg-zinc-950 text-white">
          <DialogHeader>
            <DialogTitle>{descriptionAssistantTitle}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={descriptionPrompt}
            onChange={(event) => setDescriptionPrompt(event.target.value)}
            placeholder={descriptionAssistantTarget.scope === 'video'
              ? uiText(isEnglish, '可填写这条视频的描述风格、关键词、话题或禁用词', 'Add a description style, keywords, topics, or terms to avoid for this video')
              : uiText(isEnglish, '可填写描述风格、关键词、话题或禁用词', 'Add a description style, keywords, topics, or terms to avoid')}
            className="min-h-32 border-white/10 bg-white/[0.04] text-white"
          />
          <DialogFooter>
            <Button variant="titanium-outline" onClick={() => setShowDescriptionAssistant(false)} disabled={descriptionDialogGenerating}>{uiText(isEnglish, '取消', 'Cancel')}</Button>
            <Button variant="mermaid" onClick={startDescriptionGeneration} disabled={descriptionDialogGenerating}>
              {descriptionDialogGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {descriptionDialogGenerating ? uiText(isEnglish, '生成中', 'Generating') : uiText(isEnglish, '生成', 'Generate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
