"use client"

import { format } from "date-fns"
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileVideo,
  Hash,
  History,
  Layers3,
  ListFilter,
  Loader2,
  MessageCircle,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  Youtube,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import SocialCommentsClient from "@/components/social-comments/SocialCommentsClient"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useLang } from "@/contexts/LangContext"
import { usePersistedPublishTab, type PublishPageTab } from "@/hooks/use-persisted-publish-tab"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  getUtf8ByteLength,
  getYouTubeCharacterLength,
  truncateYouTubeTextByCharacters,
  truncateYouTubeTextByUtf8Bytes,
  validateYouTubeDescription,
  validateYouTubeTitle,
  YOUTUBE_DESCRIPTION_MAX_BYTES,
  YOUTUBE_TITLE_MAX_CHARACTERS,
} from "@/lib/youtube/metadata-rules"
import {
  YOUTUBE_MAX_FILE_SIZE,
  YOUTUBE_VIDEO_FORMATS,
  type YouTubeAccount,
  type YouTubeAssetItem,
  type YouTubeFileUploadStatus,
  type YouTubeIntervalMode,
  type YouTubePublishMode,
  type YouTubePublishTask,
  type YouTubePublishTaskItem,
  type YouTubePrivacyStatus,
  type YouTubeSelectedVideo,
} from "@/types/youtube-publish"

type TabType = PublishPageTab
type VideoSourceType = "upload" | "asset"
type AccountSelectionMode = "accounts" | "groups"
type MetadataContentMode = "same" | "different"
type MetadataAssistantTarget = { scope: "global" } | { scope: "video"; videoId: string }

const PRIVACY_OPTIONS: Array<{ value: YouTubePrivacyStatus; label: { zh: string; en: string }; desc: { zh: string; en: string } }> = [
  { value: "private", label: { zh: "私密", en: "Private" }, desc: { zh: "仅自己可见", en: "Only you can view" } },
  { value: "unlisted", label: { zh: "不公开", en: "Unlisted" }, desc: { zh: "有链接的人可看", en: "Anyone with the link can view" } },
  { value: "public", label: { zh: "公开", en: "Public" }, desc: { zh: "所有人可见", en: "Visible to everyone" } },
]

const INTERVAL_OPTIONS: Array<{ value: YouTubeIntervalMode; label: { zh: string; en: string } }> = [
  { value: "0", label: { zh: "不间隔", en: "No interval" } },
  { value: "3", label: { zh: "3 分钟", en: "3 minutes" } },
  { value: "5", label: { zh: "5 分钟", en: "5 minutes" } },
  { value: "10", label: { zh: "10 分钟", en: "10 minutes" } },
  { value: "30", label: { zh: "30 分钟", en: "30 minutes" } },
  { value: "60", label: { zh: "1 小时", en: "1 hour" } },
  { value: "120", label: { zh: "2 小时", en: "2 hours" } },
  { value: "360", label: { zh: "6 小时", en: "6 hours" } },
  { value: "720", label: { zh: "12 小时", en: "12 hours" } },
  { value: "1440", label: { zh: "24 小时", en: "24 hours" } },
  { value: "custom", label: { zh: "自定义", en: "Custom" } },
]

const CONCURRENT_TRANSFER_LIMIT = 5

function t(isEnglish: boolean, zh: string, en: string) {
  return isEnglish ? en : zh
}

function formatNumber(value: number, isEnglish = false) {
  if (isEnglish) {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value)
  }
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return String(value)
}

function isYouTubeAcceptedVideoFile(file: File) {
  if (file.type.startsWith("video/") || file.type === "application/octet-stream") return true
  return /\.(mp4|webm|mov|m4v|avi|mpeg|mpg|3gp|3gpp|mkv)$/i.test(file.name)
}

function formatFileSize(bytes: number, isEnglish = false) {
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${Number.isInteger(gb) ? gb.toFixed(0) : gb.toFixed(1)}${isEnglish ? " GB" : "GB"}`
  return `${Math.ceil(bytes / (1024 * 1024))}MB`
}

function getVideoDefaultTitle(video: Pick<YouTubeSelectedVideo, "name">, index: number, isEnglish = false) {
  return video.name.replace(/\.[^.]+$/, "").trim() || video.name || t(isEnglish, `视频 ${index + 1}`, `Video ${index + 1}`)
}

function getAssistantTargetKey(target: MetadataAssistantTarget) {
  return target.scope === "global" ? "global" : target.videoId
}

function getIntervalMinutes(mode: YouTubeIntervalMode, customInterval: number) {
  return mode === "custom" ? customInterval : Number(mode)
}

function statusLabel(status: string, isEnglish = false) {
  switch (status) {
    case "completed":
      return t(isEnglish, "已完成", "Completed")
    case "published":
      return t(isEnglish, "已发布", "Published")
    case "partial_failed":
      return t(isEnglish, "部分失败", "Partial failed")
    case "failed":
      return t(isEnglish, "失败", "Failed")
    case "scheduled":
      return t(isEnglish, "已定时", "Scheduled")
    case "uploading":
      return t(isEnglish, "上传中", "Uploading")
    case "processing":
      return t(isEnglish, "发布中", "Publishing")
    case "cancelled":
      return t(isEnglish, "已取消", "Cancelled")
    default:
      return t(isEnglish, "待发布", "Pending")
  }
}

function statusClass(status: string) {
  if (status === "completed") return "bg-emerald-500/10 text-emerald-300 border-emerald-400/20"
  if (status === "failed" || status === "partial_failed") return "bg-red-500/10 text-red-300 border-red-400/20"
  if (status === "scheduled") return "bg-blue-500/10 text-blue-300 border-blue-400/20"
  return "bg-amber-500/10 text-amber-300 border-amber-400/20"
}

function formatScheduledTime(value: string | null) {
  if (!value) return null
  const scheduledAt = new Date(value)
  if (Number.isNaN(scheduledAt.getTime())) return null
  return format(scheduledAt, "MM-dd HH:mm")
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null)
  return typeof data?.error === "string" ? data.error : fallback
}

async function postJsonWithTimeout(url: string, body: unknown, timeoutMs = 60000) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => null)
    return { response, data }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function getAssistantErrorMessage(error: unknown, isEnglish = false) {
  if (error instanceof Error && error.name === "AbortError") {
    return t(isEnglish, "生成超时，请稍后重试", "Generation timed out. Please try again later.")
  }
  return error instanceof Error ? translateYouTubeAuxiliaryError(error.message, isEnglish) : t(isEnglish, "请稍后再试", "Please try again later.")
}

function isStorageNotConfiguredError(message: string) {
  return /Storage service not configured|存储服务未配置/i.test(message)
}

function translateYouTubeMetadataError(message: string, isEnglish: boolean) {
  if (!isEnglish) return message
  if (message.endsWith("不能为空")) {
    return `${message.replace("不能为空", "")} is required`
  }
  if (message.includes("不能包含 < 或 >")) {
    return `${message.replace("不能包含 < 或 >", "")} cannot contain < or >`
  }
  const characterMatch = message.match(/^(.*)不能超过 (\d+) 个字符$/)
  if (characterMatch) {
    return `${characterMatch[1]} must be ${characterMatch[2]} characters or fewer`
  }
  const bytesMatch = message.match(/^(.*)不能超过 (\d+) bytes$/)
  if (bytesMatch) {
    return `${bytesMatch[1]} must be ${bytesMatch[2]} bytes or fewer`
  }
  return message
}

const YOUTUBE_PUBLISH_ERROR_MESSAGES: Record<string, string> = {
  "获取 YouTube 账号失败": "Failed to fetch YouTube accounts.",
  "获取 YouTube 发布任务失败": "Failed to fetch YouTube publishing tasks.",
  "服务器错误": "Server error.",
  "任务不存在或无权限": "The task does not exist or you do not have access.",
  "请先登录": "Sign in first.",
  "请至少选择一个视频": "Select at least one video.",
  "请至少选择一个 YouTube 账号": "Select at least one YouTube account.",
  "YouTube 账号列表中存在重复账号": "Duplicate YouTube accounts were selected.",
  "请选择 YouTube 发布方式": "Select a YouTube publishing mode.",
  "请选择 YouTube 定时发布时间": "Select a scheduled YouTube publishing time.",
  "YouTube 定时发布时间格式无效": "Invalid YouTube scheduled publishing time format.",
  "YouTube 定时发布时间不能早于当前时间": "YouTube scheduled publishing time cannot be earlier than the current time.",
  "请选择 YouTube 可见范围": "Select YouTube visibility.",
  "YouTube 发布间隔必须在 0 到 1440 分钟之间": "YouTube publishing interval must be between 0 and 1440 minutes.",
  "YouTube 发布设置无效": "Invalid YouTube publishing settings.",
  "部分 YouTube 账号不存在或无权访问": "Some YouTube accounts do not exist or you do not have access.",
  "部分 YouTube 账号授权不可用，请先刷新或重新绑定": "Some YouTube account authorizations are unavailable. Refresh or reconnect them first.",
  "部分 YouTube 账号缺少授权令牌，请重新绑定": "Some YouTube accounts are missing authorization tokens. Please reconnect them.",
  "创建 YouTube 发布任务失败": "Failed to create YouTube publishing task.",
  "查询 YouTube 发布任务失败": "Failed to look up the YouTube publishing task.",
  "删除 YouTube 发布任务明细失败": "Failed to delete YouTube publishing task items.",
  "删除 YouTube 发布任务失败": "Failed to delete the YouTube publishing task.",
}

const YOUTUBE_PUBLISH_ERROR_PREFIXES: Array<[string, string]> = [
  ["获取 YouTube 账号失败:", "Failed to fetch YouTube accounts."],
  ["获取 YouTube 账号失败：", "Failed to fetch YouTube accounts."],
  ["检查 YouTube 授权令牌失败:", "Failed to check YouTube authorization tokens."],
  ["检查 YouTube 授权令牌失败：", "Failed to check YouTube authorization tokens."],
  ["创建 YouTube 任务失败:", "Failed to create the YouTube task."],
  ["创建 YouTube 任务失败：", "Failed to create the YouTube task."],
  ["创建 YouTube 任务项失败:", "Failed to create YouTube task items."],
  ["创建 YouTube 任务项失败：", "Failed to create YouTube task items."],
]

function translateYouTubePublishError(message: string, isEnglish: boolean) {
  if (!isEnglish) return message
  const exactMessage = YOUTUBE_PUBLISH_ERROR_MESSAGES[message]
  if (exactMessage) return exactMessage
  if (message.startsWith('视频"')) return "Invalid video title or description."
  const prefixMessage = YOUTUBE_PUBLISH_ERROR_PREFIXES.find(([prefix]) => message.startsWith(prefix))
  return prefixMessage?.[1] || message
}

const YOUTUBE_AUXILIARY_ERROR_MESSAGES: Record<string, string> = {
  "请先登录": "Sign in first.",
  "请输入视频内容描述或先选择视频": "Enter a video content description or select a video first.",
  "生成数量需在 1-50 之间": "Generation count must be between 1 and 50.",
  "请先填写标题、描述或补充要求": "Add a title, description, or extra instructions first.",
  "生成失败": "Generation failed.",
  "不支持的视频格式": "Unsupported video format.",
  "本地上传签名配置缺失": "Local upload signing configuration is missing.",
  "YouTube local upload signing secret is not configured": "YouTube local upload signing secret is not configured.",
  "YouTube local upload fallback is only available on localhost.": "YouTube local upload fallback is only available on localhost.",
}

function translateYouTubeAuxiliaryError(message: string, isEnglish: boolean) {
  if (!isEnglish) return message
  const exactMessage = YOUTUBE_AUXILIARY_ERROR_MESSAGES[message]
  if (exactMessage) return exactMessage
  if (message.startsWith("不支持的视频格式")) return "Unsupported video format."
  return translateYouTubePublishError(message, isEnglish)
}

function getYouTubeTaskDisplayName(task: YouTubePublishTask, isEnglish: boolean) {
  const name = task.name || task.task_name || t(isEnglish, "未命名 YouTube 任务", "Untitled YouTube task")
  if (isEnglish && name === "未命名 YouTube 任务") return "Untitled YouTube task"
  return name
}

function isAccountReady(account: YouTubeAccount) {
  return account.status === "active"
}

async function requestYouTubeUploadCredentials(file: File, isEnglish = false) {
  const payload = {
    filename: file.name,
    contentType: file.type || "video/mp4",
  }

  const ossResponse = await fetch("/api/upload/oss-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (ossResponse.ok) {
    const data = await ossResponse.json().catch(() => null)
    if (data?.success && data?.data?.uploadUrl && data?.data?.publicUrl) {
      return data.data as { uploadUrl: string; publicUrl: string }
    }
    throw new Error(t(isEnglish, "上传凭证无效", "Invalid upload credentials"))
  }

  const ossError = await readApiError(ossResponse, t(isEnglish, "获取上传凭证失败", "Failed to get upload credentials"))
  if (!isStorageNotConfiguredError(ossError)) {
    throw new Error(translateYouTubeAuxiliaryError(ossError, isEnglish))
  }

  const localResponse = await fetch("/api/youtube/upload/local-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!localResponse.ok) {
    const localError = await readApiError(localResponse, t(isEnglish, "本地测试上传凭证失败", "Failed to get local test upload credentials"))
    throw new Error(translateYouTubeAuxiliaryError(localError, isEnglish))
  }

  const localData = await localResponse.json().catch(() => null)
  if (!localData?.success || !localData?.data?.uploadUrl || !localData?.data?.publicUrl) {
    throw new Error(t(isEnglish, "本地测试上传凭证无效", "Invalid local test upload credentials"))
  }

  return localData.data as { uploadUrl: string; publicUrl: string }
}

async function checkVideoUrlAccessible(url: string) {
  try {
    const response = await fetch("/api/upload/check-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
    const data = await response.json().catch(() => null)
    return data?.accessible === true
  } catch {
    return false
  }
}

async function generateVideoThumbnail(videoFile: File): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video")
    video.preload = "metadata"
    video.muted = true
    video.playsInline = true

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, Math.max(0, video.duration / 2))
    }

    video.onseeked = () => {
      const maxWidth = 320
      const scale = video.videoWidth > 0 ? Math.min(1, maxWidth / video.videoWidth) : 1
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const context = canvas.getContext("2d")
      if (!context) {
        URL.revokeObjectURL(video.src)
        resolve("")
        return
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const thumbnail = canvas.toDataURL("image/jpeg", 0.68)
      URL.revokeObjectURL(video.src)
      resolve(thumbnail)
    }

    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      resolve("")
    }

    video.src = URL.createObjectURL(videoFile)
  })
}

function getYouTubeVideoThumbnail(videoId: string | null) {
  return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null
}

function YouTubeTaskItemPreview({ item, isEnglish }: { item: YouTubePublishTaskItem; isEnglish: boolean }) {
  const [previewIndex, setPreviewIndex] = useState(0)
  const previewSources = [
    item.thumbnail_url ? { type: "image" as const, src: item.thumbnail_url } : null,
    item.video_url ? { type: "video" as const, src: `${item.video_url}#t=0.1` } : null,
    getYouTubeVideoThumbnail(item.youtube_video_id)
      ? { type: "image" as const, src: getYouTubeVideoThumbnail(item.youtube_video_id)! }
      : null,
  ].filter(Boolean) as Array<{ type: "image" | "video"; src: string }>
  const currentPreview = previewSources[previewIndex]
  const showNextPreview = () => setPreviewIndex((index) => Math.min(index + 1, previewSources.length))

  useEffect(() => {
    setPreviewIndex(0)
  }, [item.id, item.thumbnail_url, item.video_url, item.youtube_video_id])

  return (
    <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/40">
      {currentPreview?.type === "image" ? (
        <img
          src={currentPreview.src}
          alt={item.title || item.source_video_name || t(isEnglish, "YouTube 视频预览", "YouTube video preview")}
          className="h-full w-full object-cover"
          onError={showNextPreview}
        />
      ) : currentPreview?.type === "video" ? (
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

function YouTubeTaskManager({ isEnglish }: { isEnglish: boolean }) {
  const { toast } = useToast()
  const [tasks, setTasks] = useState<YouTubePublishTask[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStatus, setActiveStatus] = useState("all")
  const [dateRange, setDateRange] = useState("today")
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ dateRange, limit: "50", offset: "0" })
      if (activeStatus !== "all") params.set("status", activeStatus)
      const response = await fetch(`/api/youtube/publish/tasks?${params.toString()}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t(isEnglish, "加载任务失败", "Failed to load tasks"))
      setTasks(data.tasks || [])
    } catch (error) {
      toast({
        title: t(isEnglish, "加载失败", "Load failed"),
        description: error instanceof Error
          ? translateYouTubePublishError(error.message, isEnglish)
          : t(isEnglish, "无法获取 YouTube 任务", "Unable to get YouTube tasks"),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [activeStatus, dateRange, isEnglish, toast])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const deleteTask = async (taskId: string) => {
    if (!window.confirm(t(
      isEnglish,
      "确定删除这个 YouTube 发布任务吗？已发布到 YouTube 的视频不会被删除。",
      "Delete this YouTube publishing task? Videos already published to YouTube will not be deleted."
    ))) return
    setDeletingId(taskId)
    try {
      const response = await fetch(`/api/youtube/publish/tasks/${taskId}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || t(isEnglish, "删除失败", "Delete failed"))
      setTasks((prev) => prev.filter((task) => task.id !== taskId))
      toast({ title: t(isEnglish, "任务已删除", "Task deleted") })
    } catch (error) {
      toast({
        title: t(isEnglish, "删除失败", "Delete failed"),
        description: error instanceof Error
          ? translateYouTubePublishError(error.message, isEnglish)
          : t(isEnglish, "请稍后重试", "Please try again later"),
        variant: "destructive",
      })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", t(isEnglish, "全部", "All")],
            ["in_progress", t(isEnglish, "进行中", "In progress")],
            ["completed", t(isEnglish, "已完成", "Completed")],
            ["failed", t(isEnglish, "失败", "Failed")],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setActiveStatus(value)}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                activeStatus === value ? "bg-white/[0.12] text-white" : "text-white/50 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <select
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value)}
            className="h-9 rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white"
          >
            <option value="today">{t(isEnglish, "今天", "Today")}</option>
            <option value="yesterday">{t(isEnglish, "昨天", "Yesterday")}</option>
            <option value="3days">{t(isEnglish, "近3天", "Last 3 days")}</option>
            <option value="7days">{t(isEnglish, "近7天", "Last 7 days")}</option>
          </select>
          <Button variant="titanium-outline" size="sm" onClick={fetchTasks} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t(isEnglish, "刷新", "Refresh")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-56 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
          <Loader2 className="h-6 w-6 animate-spin text-white/50" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] text-center">
          <History className="mb-3 h-10 w-10 text-white/35" />
          <div className="text-white/70">{t(isEnglish, "暂无 YouTube 发布任务", "No YouTube publishing tasks")}</div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {tasks.map((task) => (
            <div key={task.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{getYouTubeTaskDisplayName(task, isEnglish)}</h3>
                  <div className="mt-1 text-xs text-white/40">
                    {format(new Date(task.created_at), "yyyy-MM-dd HH:mm")}
                    {task.scheduled_at ? ` · ${t(isEnglish, "首发", "First publish")} ${format(new Date(task.scheduled_at), "MM-dd HH:mm")}` : ""}
                  </div>
                </div>
                <span className={cn("rounded-full border px-2.5 py-1 text-xs", statusClass(task.status))}>
                  {statusLabel(task.status, isEnglish)}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2 text-center text-sm">
                <div className="rounded-md bg-black/25 p-3">
                  <div className="text-white/35">{t(isEnglish, "视频", "Videos")}</div>
                  <div className="mt-1 font-semibold">{task.video_count || 0}</div>
                </div>
                <div className="rounded-md bg-black/25 p-3">
                  <div className="text-white/35">{t(isEnglish, "账号", "Accounts")}</div>
                  <div className="mt-1 font-semibold">{task.account_count || 0}</div>
                </div>
                <div className="rounded-md bg-black/25 p-3">
                  <div className="text-white/35">{t(isEnglish, "成功", "Success")}</div>
                  <div className="mt-1 font-semibold text-emerald-300">{task.published_count || 0}</div>
                </div>
                <div className="rounded-md bg-black/25 p-3">
                  <div className="text-white/35">{t(isEnglish, "失败", "Failed")}</div>
                  <div className="mt-1 font-semibold text-red-300">{task.failed_count || 0}</div>
                </div>
              </div>

              {task.items && task.items.length > 0 && (
                <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {task.items.slice(0, 8).map((item) => {
                    const scheduledTime = formatScheduledTime(item.scheduled_at)

                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-white/[0.08] bg-black/20 p-2 text-sm">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <YouTubeTaskItemPreview item={item} isEnglish={isEnglish} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-white/80">{item.title || item.source_video_name || t(isEnglish, "未命名视频", "Untitled video")}</div>
                            {item.source_video_name && item.source_video_name !== item.title && (
                              <div className="mt-0.5 truncate text-xs text-white/35">{item.source_video_name}</div>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/35">
                              <span>{statusLabel(item.status, isEnglish)}</span>
                              {scheduledTime && <span>{t(isEnglish, "发布时间", "Publish time")} {scheduledTime}</span>}
                            </div>
                            {item.error_message && <div className="mt-1 line-clamp-2 text-xs text-red-300">{item.error_message}</div>}
                          </div>
                        </div>
                        {item.youtube_watch_url && (
                          <a href={item.youtube_watch_url} target="_blank" className="shrink-0 text-cyan-300 hover:text-cyan-200">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <Button variant="destructive" size="sm" onClick={() => deleteTask(task.id)} disabled={deletingId === task.id}>
                  {deletingId === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {t(isEnglish, "删除任务", "Delete Task")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type YouTubePublishClientProps = {
  showCommentManagement: boolean
  enableYouTubeAutoSync: boolean
}

export default function YouTubePublishClient({ showCommentManagement, enableYouTubeAutoSync }: YouTubePublishClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { lang } = useLang()
  const isEnglish = lang === "en"
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = usePersistedPublishTab(showCommentManagement)
  const effectiveActiveTab = showCommentManagement || activeTab !== "comments" ? activeTab : "create"
  const [videoSource, setVideoSource] = useState<VideoSourceType>("upload")
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [accountSelectionMode, setAccountSelectionMode] = useState<AccountSelectionMode>("accounts")
  const [selectedVideos, setSelectedVideos] = useState<YouTubeSelectedVideo[]>([])
  const [uploadingFiles, setUploadingFiles] = useState<YouTubeFileUploadStatus[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [assets, setAssets] = useState<YouTubeAssetItem[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [transferringAssets, setTransferringAssets] = useState<Set<string>>(new Set())
  const [batchTransfer, setBatchTransfer] = useState({
    isTransferring: false,
    total: 0,
    completed: 0,
    failed: 0,
  })

  const [taskName, setTaskName] = useState("")
  const [metadataMode, setMetadataMode] = useState<MetadataContentMode>("same")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [showTitleAssistant, setShowTitleAssistant] = useState(false)
  const [titleAssistantTarget, setTitleAssistantTarget] = useState<MetadataAssistantTarget>({ scope: "global" })
  const [titlePrompt, setTitlePrompt] = useState("")
  const [generatingTitleTargets, setGeneratingTitleTargets] = useState<Set<string>>(new Set())
  const [showDescriptionAssistant, setShowDescriptionAssistant] = useState(false)
  const [descriptionAssistantTarget, setDescriptionAssistantTarget] = useState<MetadataAssistantTarget>({ scope: "global" })
  const [descriptionPrompt, setDescriptionPrompt] = useState("")
  const [generatingDescriptionTargets, setGeneratingDescriptionTargets] = useState<Set<string>>(new Set())
  const [privacyStatus, setPrivacyStatus] = useState<YouTubePrivacyStatus>("private")
  const [madeForKids, setMadeForKids] = useState(false)
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState(true)
  const [notifySubscribers, setNotifySubscribers] = useState(false)
  const [publishMode, setPublishMode] = useState<YouTubePublishMode>("now")
  const [scheduledDate, setScheduledDate] = useState("")
  const [scheduledTime, setScheduledTime] = useState("")
  const [intervalMode, setIntervalMode] = useState<YouTubeIntervalMode>("0")
  const [customInterval, setCustomInterval] = useState(5)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const response = await fetch("/api/youtube/accounts")
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t(isEnglish, "加载账号失败", "Failed to load accounts"))
      setAccounts(data.accounts || [])
    } catch (error) {
      toast({
        title: t(isEnglish, "账号加载失败", "Account load failed"),
        description: error instanceof Error
          ? translateYouTubePublishError(error.message, isEnglish)
          : t(isEnglish, "无法获取 YouTube 账号", "Unable to get YouTube accounts"),
        variant: "destructive",
      })
    } finally {
      setLoadingAccounts(false)
    }
  }, [isEnglish, toast])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const readyAccounts = useMemo(() => accounts.filter(isAccountReady), [accounts])
  const accountGroups = useMemo(() => {
    if (readyAccounts.length === 0) return []

    return [
      {
        id: "all-ready",
        name: isEnglish ? "All publish-ready accounts" : "全部可发布账号",
        accountIds: readyAccounts.map((account) => account.id),
        accounts: readyAccounts,
      },
    ]
  }, [isEnglish, readyAccounts])
  const selectedGroupId = useMemo(() => {
    const selectedSet = new Set(selectedAccounts)
    return accountGroups.find((group) =>
      group.accountIds.length === selectedAccounts.length &&
      group.accountIds.every((accountId) => selectedSet.has(accountId))
    )?.id || null
  }, [accountGroups, selectedAccounts])
  const totalTasks = selectedVideos.length * selectedAccounts.length
  const titleCharacterCount = getYouTubeCharacterLength(title)
  const descriptionByteCount = getUtf8ByteLength(description)
  const aiGeneratingCount = generatingTitleTargets.size + generatingDescriptionTargets.size
  const metadataErrors = useMemo(() => {
    const errors: string[] = []
    if (selectedVideos.length === 0) return errors

    if (metadataMode === "same") {
      const titleError = validateYouTubeTitle(title, t(isEnglish, "视频标题", "Video title"))
      const descriptionError = validateYouTubeDescription(description, t(isEnglish, "视频描述", "Video description"))
      if (titleError) errors.push(translateYouTubeMetadataError(titleError, isEnglish))
      if (descriptionError) errors.push(translateYouTubeMetadataError(descriptionError, isEnglish))
      return errors
    }

    selectedVideos.forEach((video, index) => {
      const itemTitle = (video.title ?? getVideoDefaultTitle(video, index, isEnglish)).trim()
      const itemDescription = video.description ?? ""
      const titleError = validateYouTubeTitle(itemTitle, t(isEnglish, `视频 ${index + 1} 标题`, `Video ${index + 1} title`))
      const descriptionError = validateYouTubeDescription(itemDescription, t(isEnglish, `视频 ${index + 1} 描述`, `Video ${index + 1} description`))
      if (titleError) errors.push(translateYouTubeMetadataError(titleError, isEnglish))
      if (descriptionError) errors.push(translateYouTubeMetadataError(descriptionError, isEnglish))
    })

    return errors
  }, [description, isEnglish, metadataMode, selectedVideos, title])
  const canPublish =
    selectedVideos.length > 0 &&
    selectedAccounts.length > 0 &&
    !publishing &&
    aiGeneratingCount === 0 &&
    metadataErrors.length === 0 &&
    (publishMode === "now" || Boolean(scheduledDate && scheduledTime))

  const updateUploadStatus = (fileId: string, updates: Partial<YouTubeFileUploadStatus>) => {
    setUploadingFiles((prev) => prev.map((file) => file.id === fileId ? { ...file, ...updates } : file))
  }

  const uploadSingleFile = async (file: File, id: string) => {
    updateUploadStatus(id, { status: "uploading", progress: 0, error: undefined })
    const thumbnailPromise = generateVideoThumbnail(file)
    const credentials = await requestYouTubeUploadCredentials(file, isEnglish)

    const uploadedUrl = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          updateUploadStatus(id, { progress: Math.round((event.loaded / event.total) * 96) })
        }
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(credentials.publicUrl)
        else reject(new Error(t(isEnglish, `视频上传失败 (${xhr.status})`, `Video upload failed (${xhr.status})`)))
      }
      xhr.onerror = () => reject(new Error(t(isEnglish, "网络错误", "Network error")))
      xhr.ontimeout = () => reject(new Error(t(isEnglish, "上传超时", "Upload timed out")))
      xhr.open("PUT", credentials.uploadUrl)
      xhr.setRequestHeader("Content-Type", file.type || "video/mp4")
      xhr.timeout = 600000
      xhr.send(file)
    })

    const thumbnail = await thumbnailPromise
    const newVideo: YouTubeSelectedVideo = {
      id,
      type: "upload",
      name: file.name,
      thumbnail,
      url: uploadedUrl,
      localUrl: URL.createObjectURL(file),
      title: file.name.replace(/\.[^.]+$/, "").slice(0, 100),
    }

    setSelectedVideos((prev) => [...prev, newVideo])
    updateUploadStatus(id, { status: "done", progress: 100 })
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    setUploadError(null)
    const validFiles: Array<{ file: File; id: string }> = []

    for (const file of Array.from(files)) {
      if (!isYouTubeAcceptedVideoFile(file)) {
        setUploadError(t(
          isEnglish,
          "不支持的视频格式。YouTube 上传要求 video/* 或 application/octet-stream",
          "Unsupported video format. YouTube upload requires video/* or application/octet-stream."
        ))
        continue
      }
      if (file.size > YOUTUBE_MAX_FILE_SIZE) {
        setUploadError(t(
          isEnglish,
          `文件过大: ${(file.size / (1024 * 1024 * 1024)).toFixed(2)}GB。最大: ${formatFileSize(YOUTUBE_MAX_FILE_SIZE)}`,
          `File is too large: ${(file.size / (1024 * 1024 * 1024)).toFixed(2)} GB. Maximum: ${formatFileSize(YOUTUBE_MAX_FILE_SIZE, true)}`
        ))
        continue
      }
      validFiles.push({
        file,
        id: `youtube-upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      })
    }

    if (validFiles.length === 0) return

    setUploadingFiles(validFiles.map(({ file, id }) => ({
      id,
      name: file.name,
      progress: 0,
      status: "pending",
    })))

    await Promise.all(
      validFiles.map(async ({ file, id }) => {
        try {
          await uploadSingleFile(file, id)
    } catch (error) {
      updateUploadStatus(id, {
        status: "error",
        progress: 0,
        error: error instanceof Error
          ? translateYouTubeAuxiliaryError(error.message, isEnglish)
          : t(isEnglish, "上传失败", "Upload failed"),
      })
    }
  })
    )

    setTimeout(() => setUploadingFiles([]), 2500)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const fetchAssets = useCallback(async () => {
    setLoadingAssets(true)
    try {
      const response = await fetch("/api/user/tasks?type=video&status=completed&limit=50")
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || t(isEnglish, "加载视频制作区失败", "Failed to load videos from the creation workspace"))

      const tasks = (data?.data?.tasks || data?.tasks || []) as YouTubeAssetItem[]
      const videoTasks = tasks.filter((task) => task.type === "video" && task.resultUrl)
      const checks = await Promise.all(
        videoTasks.map(async (task) => ({
          task,
          accessible: await checkVideoUrlAccessible(task.resultUrl!),
        }))
      )

      const validAssets = checks.filter(({ accessible }) => accessible).map(({ task }) => task)
      const expiredCount = checks.length - validAssets.length
      setAssets(validAssets)

      if (expiredCount > 0) {
        toast({
          title: t(isEnglish, "已过滤失效视频", "Unavailable videos filtered out"),
          description: t(
            isEnglish,
            `${expiredCount} 个制作区视频链接已不可访问`,
            `${expiredCount} creation workspace video links are no longer accessible`
          ),
        })
      }
    } catch (error) {
      toast({
        title: t(isEnglish, "加载失败", "Load failed"),
        description: error instanceof Error
          ? translateYouTubeAuxiliaryError(error.message, isEnglish)
          : t(isEnglish, "无法获取视频制作区内容", "Unable to get creation workspace videos"),
        variant: "destructive",
      })
    } finally {
      setLoadingAssets(false)
    }
  }, [isEnglish, toast])

  const openAssetSelector = useCallback(() => {
    setSelectedAssetIds([])
    setShowAssetModal(true)
    fetchAssets()
  }, [fetchAssets])

  const transferSingleAsset = async (asset: YouTubeAssetItem, retryCount = 0): Promise<{ success: boolean; error?: string }> => {
    if (!asset.resultUrl) {
      return { success: false, error: t(isEnglish, "视频已不存在，请重新选择", "This video no longer exists. Please select it again.") }
    }
    if (selectedVideos.some((video) => video.id === asset.id)) return { success: true }

    setTransferringAssets((prev) => new Set(prev).add(asset.id))
    try {
      const response = await fetch("/api/upload/transfer-to-oss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: asset.resultUrl,
          filename: asset.prompt?.slice(0, 30) || "youtube-video",
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success || !result?.data?.url) {
        const transferError = typeof result?.error === "string" ? result.error : t(isEnglish, "视频转存失败", "Video transfer failed")
        if (!isStorageNotConfiguredError(transferError)) {
          throw new Error(translateYouTubeAuxiliaryError(transferError, isEnglish))
        }
      }

      const name = asset.prompt?.trim().slice(0, 30) || t(isEnglish, `视频 ${format(new Date(asset.createdAt), "MM/dd HH:mm")}`, `Video ${format(new Date(asset.createdAt), "MM/dd HH:mm")}`)
      const videoUrl = result?.data?.url || asset.resultUrl
      const newVideo: YouTubeSelectedVideo = {
        id: asset.id,
        type: "asset",
        name,
        thumbnail: asset.thumbnailUrl || "",
        url: videoUrl,
        localUrl: videoUrl,
        title: (asset.prompt || name).slice(0, 100),
        description: asset.prompt || undefined,
        duration: 30,
      }

      setSelectedVideos((prev) => (prev.some((video) => video.id === asset.id) ? prev : [...prev, newVideo]))
      return { success: true }
    } catch (error) {
      if (retryCount < 1) {
        setTransferringAssets((prev) => {
          const next = new Set(prev)
          next.delete(asset.id)
          return next
        })
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return transferSingleAsset(asset, retryCount + 1)
      }
      return {
        success: false,
        error: error instanceof Error
          ? translateYouTubeAuxiliaryError(error.message, isEnglish)
          : t(isEnglish, "视频转存失败", "Video transfer failed"),
      }
    } finally {
      setTransferringAssets((prev) => {
        const next = new Set(prev)
        next.delete(asset.id)
        return next
      })
    }
  }

  const startBatchTransfer = async (assetIds: string[]) => {
    const assetsToTransfer = assetIds
      .map((id) => assets.find((asset) => asset.id === id))
      .filter((asset): asset is YouTubeAssetItem => Boolean(asset))
      .filter((asset) => !selectedVideos.some((video) => video.id === asset.id))

    if (assetsToTransfer.length === 0) {
      setShowAssetModal(false)
      setSelectedAssetIds([])
      return
    }

    setBatchTransfer({
      isTransferring: true,
      total: assetsToTransfer.length,
      completed: 0,
      failed: 0,
    })

    let completed = 0
    let failed = 0
    let firstFailureMessage: string | undefined

    for (let index = 0; index < assetsToTransfer.length; index += CONCURRENT_TRANSFER_LIMIT) {
      const chunk = assetsToTransfer.slice(index, index + CONCURRENT_TRANSFER_LIMIT)
      const results = await Promise.all(chunk.map((asset) => transferSingleAsset(asset)))
      results.forEach((result) => {
        if (result.success) completed += 1
        else {
          failed += 1
          if (!firstFailureMessage && result.error) firstFailureMessage = result.error
        }
      })
      setBatchTransfer((prev) => ({ ...prev, completed, failed }))
    }

    setBatchTransfer((prev) => ({ ...prev, isTransferring: false }))

    if (failed > 0) {
      const transferSummary = t(isEnglish, `成功 ${completed} 个，失败 ${failed} 个`, `${completed} succeeded, ${failed} failed`)
      toast({
        title: t(isEnglish, "部分视频转存失败", "Some videos failed to transfer"),
        description: firstFailureMessage ? `${transferSummary}. ${firstFailureMessage}` : transferSummary,
        variant: "destructive",
      })
    } else {
      toast({
        title: t(isEnglish, "视频已添加", "Videos added"),
        description: t(isEnglish, `已添加 ${completed} 个视频到 YouTube 发布列表`, `${completed} videos added to the YouTube publishing list`),
      })
    }

    setShowAssetModal(false)
    setSelectedAssetIds([])
  }

  const addVideoFromAsset = async (asset: YouTubeAssetItem) => {
    if (selectedVideos.some((video) => video.id === asset.id) || transferringAssets.has(asset.id)) return
    setBatchTransfer({ isTransferring: true, total: 1, completed: 0, failed: 0 })
    const result = await transferSingleAsset(asset)
    setBatchTransfer({ isTransferring: false, total: 1, completed: result.success ? 1 : 0, failed: result.success ? 0 : 1 })

    if (result.success) {
      toast({
        title: t(isEnglish, "视频已添加", "Video added"),
        description: t(isEnglish, "已添加到 YouTube 发布列表", "Added to the YouTube publishing list"),
      })
      setShowAssetModal(false)
      setSelectedAssetIds([])
    } else {
      toast({
        title: t(isEnglish, "转存失败", "Transfer failed"),
        description: result.error || t(isEnglish, "请稍后重试", "Please try again later"),
        variant: "destructive",
      })
    }
  }

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    )
  }

  const updateVideo = (videoId: string, updates: Partial<YouTubeSelectedVideo>) => {
    setSelectedVideos((prev) => prev.map((video) => video.id === videoId ? { ...video, ...updates } : video))
  }

  const removeVideo = (videoId: string) => {
    setSelectedVideos((prev) => prev.filter((video) => video.id !== videoId))
  }

  const openTitleAssistant = (target: MetadataAssistantTarget = { scope: "global" }) => {
    setTitleAssistantTarget(target)
    setTitlePrompt("")
    setShowTitleAssistant(true)
  }

  const openDescriptionAssistant = (target: MetadataAssistantTarget = { scope: "global" }) => {
    setDescriptionAssistantTarget(target)
    setDescriptionPrompt("")
    setShowDescriptionAssistant(true)
  }

  const setTitleTargetGenerating = (targetKey: string, active: boolean) => {
    setGeneratingTitleTargets((prev) => {
      const next = new Set(prev)
      if (active) next.add(targetKey)
      else next.delete(targetKey)
      return next
    })
  }

  const setDescriptionTargetGenerating = (targetKey: string, active: boolean) => {
    setGeneratingDescriptionTargets((prev) => {
      const next = new Set(prev)
      if (active) next.add(targetKey)
      else next.delete(targetKey)
      return next
    })
  }

  const generateTitle = async (target: MetadataAssistantTarget, prompt: string) => {
    const targetKey = getAssistantTargetKey(target)
    setTitleTargetGenerating(targetKey, true)
    try {
      const targetVideo = target.scope === "video"
        ? selectedVideos.find((video) => video.id === target.videoId)
        : null
      if (target.scope === "video" && !targetVideo) {
        throw new Error(t(isEnglish, "视频已不存在，请重新选择", "This video no longer exists. Please select it again."))
      }
      const isBatchDifferent = metadataMode === "different" && target.scope === "global"
      const { response, data } = await postJsonWithTimeout("/api/youtube/publish/generate-titles", {
        description: prompt ||
          targetVideo?.description ||
          targetVideo?.title ||
          targetVideo?.name ||
          description ||
          selectedVideos[0]?.name ||
          taskName ||
          t(isEnglish, "YouTube 视频", "YouTube video"),
        videoNames: targetVideo ? [targetVideo.name] : selectedVideos.map((video) => video.name),
        count: isBatchDifferent ? Math.max(selectedVideos.length, 1) : 1,
        language: isEnglish ? "en" : "zh",
      })
      if (!response.ok || !data?.success) throw new Error(data?.error || t(isEnglish, "生成失败", "Generation failed"))

      const generatedTitles = (data.titles || [])
        .map((item: { title?: string; combined?: string }) => item.title || item.combined || "")
        .filter(Boolean)

      if (generatedTitles.length > 0) {
        if (targetVideo) {
          updateVideo(targetVideo.id, {
            title: truncateYouTubeTextByCharacters(generatedTitles[0], YOUTUBE_TITLE_MAX_CHARACTERS),
          })
        } else if (isBatchDifferent && selectedVideos.length > 0) {
          setSelectedVideos((prev) => prev.map((video, index) => ({
            ...video,
            title: truncateYouTubeTextByCharacters(
              generatedTitles[index] || generatedTitles[0] || video.title || getVideoDefaultTitle(video, index, isEnglish),
              YOUTUBE_TITLE_MAX_CHARACTERS
            ),
          })))
        } else {
          setTitle(truncateYouTubeTextByCharacters(generatedTitles[0], YOUTUBE_TITLE_MAX_CHARACTERS))
        }
      }
    } catch (error) {
      toast({
        title: t(isEnglish, "AI 写标题失败", "AI title generation failed"),
        description: getAssistantErrorMessage(error, isEnglish),
        variant: "destructive",
      })
    } finally {
      setTitleTargetGenerating(targetKey, false)
    }
  }

  const startTitleGeneration = () => {
    const target = titleAssistantTarget
    const prompt = titlePrompt
    const targetKey = getAssistantTargetKey(target)
    if (generatingTitleTargets.has(targetKey)) return

    setShowTitleAssistant(false)
    setTitlePrompt("")
    setTitleAssistantTarget({ scope: "global" })
    void generateTitle(target, prompt)
  }

  const generateDescription = async (target: MetadataAssistantTarget, prompt: string) => {
    const targetKey = getAssistantTargetKey(target)
    setDescriptionTargetGenerating(targetKey, true)
    try {
      const targetVideo = target.scope === "video"
        ? selectedVideos.find((video) => video.id === target.videoId)
        : null
      if (target.scope === "video" && !targetVideo) {
        throw new Error(t(isEnglish, "视频已不存在，请重新选择", "This video no longer exists. Please select it again."))
      }
      const targetVideoIndex = targetVideo ? selectedVideos.findIndex((video) => video.id === targetVideo.id) : -1
      const { response, data } = await postJsonWithTimeout("/api/youtube/publish/generate-description", {
        prompt,
        title: targetVideo
          ? (targetVideo.title || getVideoDefaultTitle(targetVideo, targetVideoIndex >= 0 ? targetVideoIndex : 0, isEnglish))
          : title,
        description: targetVideo ? (targetVideo.description || "") : description,
        taskName,
        videoNames: targetVideo ? [targetVideo.name] : selectedVideos.map((video) => video.name),
        tags: [],
        language: isEnglish ? "en" : "zh",
      })
      if (!response.ok || !data?.success) throw new Error(data?.error || t(isEnglish, "生成失败", "Generation failed"))

      if (typeof data.description === "string" && data.description.trim()) {
        const nextDescription = truncateYouTubeTextByUtf8Bytes(data.description, YOUTUBE_DESCRIPTION_MAX_BYTES)
        if (targetVideo) {
          updateVideo(targetVideo.id, { description: nextDescription })
        } else {
          setDescription(nextDescription)
        }
      }
    } catch (error) {
      toast({
        title: t(isEnglish, "AI 写描述失败", "AI description generation failed"),
        description: getAssistantErrorMessage(error, isEnglish),
        variant: "destructive",
      })
    } finally {
      setDescriptionTargetGenerating(targetKey, false)
    }
  }

  const startDescriptionGeneration = () => {
    const target = descriptionAssistantTarget
    const prompt = descriptionPrompt
    const targetKey = getAssistantTargetKey(target)
    if (generatingDescriptionTargets.has(targetKey)) return

    setShowDescriptionAssistant(false)
    setDescriptionPrompt("")
    setDescriptionAssistantTarget({ scope: "global" })
    void generateDescription(target, prompt)
  }

  const createPublishTask = async () => {
    if (metadataErrors.length > 0) {
      setPublishError(metadataErrors[0])
      return
    }

    if (!canPublish) {
      setPublishError(t(isEnglish, "请完成视频、账号和发布时间设置", "Complete video, account, and publishing time settings."))
      return
    }

    if (privacyStatus === "public" && !window.confirm(t(
      isEnglish,
      "确认创建公开发布任务？未通过 YouTube API 审核的项目可能只能上传私密视频。",
      "Create a public publishing task? Projects that have not passed YouTube API review may only upload private videos."
    ))) {
      return
    }

    setPublishing(true)
    setPublishError(null)
    try {
      const videosForTask = selectedVideos.map((video, index) => {
        if (metadataMode === "same") {
          return {
            ...video,
            title: undefined,
            description: undefined,
          }
        }

        return {
          ...video,
          title: (video.title ?? getVideoDefaultTitle(video, index, isEnglish)).trim(),
          description: video.description ?? "",
        }
      })
      const taskTitle = metadataMode === "same" ? title.trim() : ""
      const taskDescription = metadataMode === "same" ? description : ""

      const response = await fetch("/api/youtube/publish/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: taskName,
          videos: videosForTask,
          account_ids: selectedAccounts,
          title: taskTitle,
          description: taskDescription,
          tags: [],
          privacy_status: privacyStatus,
          category_id: "22",
          made_for_kids: madeForKids,
          contains_synthetic_media: containsSyntheticMedia,
          notify_subscribers: notifySubscribers,
          publish_mode: publishMode,
          scheduled_at: publishMode === "scheduled" ? new Date(`${scheduledDate}T${scheduledTime}`).toISOString() : null,
          batch_interval: getIntervalMinutes(intervalMode, customInterval),
        }),
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || t(isEnglish, "创建 YouTube 发布任务失败", "Failed to create YouTube publishing task"))

      toast({
        title: t(isEnglish, "YouTube 发布任务已创建", "YouTube publishing task created"),
        description: t(isEnglish, `共 ${totalTasks} 个发布项`, `${totalTasks} publishing items`),
      })
      setSelectedVideos([])
      setSelectedAccounts([])
      setTaskName("")
      setMetadataMode("same")
      setTitle("")
      setDescription("")
      setActiveTab("tasks")
    } catch (error) {
      const message = error instanceof Error
        ? translateYouTubePublishError(error.message, isEnglish)
        : t(isEnglish, "创建 YouTube 发布任务失败", "Failed to create YouTube publishing task")
      setPublishError(message)
      toast({ title: t(isEnglish, "创建失败", "Create failed"), description: message, variant: "destructive" })
    } finally {
      setPublishing(false)
    }
  }

  const titleAssistantVideoIndex = titleAssistantTarget.scope === "video"
    ? selectedVideos.findIndex((video) => video.id === titleAssistantTarget.videoId)
    : -1
  const descriptionAssistantVideoIndex = descriptionAssistantTarget.scope === "video"
    ? selectedVideos.findIndex((video) => video.id === descriptionAssistantTarget.videoId)
    : -1
  const titleAssistantVideoNumber = titleAssistantVideoIndex >= 0 ? titleAssistantVideoIndex + 1 : 1
  const descriptionAssistantVideoNumber = descriptionAssistantVideoIndex >= 0 ? descriptionAssistantVideoIndex + 1 : 1
  const titleAssistantTitle = titleAssistantTarget.scope === "video"
    ? t(isEnglish, `AI 写视频 ${titleAssistantVideoNumber} 标题`, `AI Write Video ${titleAssistantVideoNumber} Title`)
    : metadataMode === "different"
      ? t(isEnglish, "AI 批量写标题", "AI Batch Write Titles")
      : t(isEnglish, "AI 写标题", "AI Write Title")
  const descriptionAssistantTitle = descriptionAssistantTarget.scope === "video"
    ? t(isEnglish, `AI 写视频 ${descriptionAssistantVideoNumber} 描述`, `AI Write Video ${descriptionAssistantVideoNumber} Description`)
    : t(isEnglish, "AI 写描述", "AI Write Description")
  const titleDialogGenerating = generatingTitleTargets.has(getAssistantTargetKey(titleAssistantTarget))
  const descriptionDialogGenerating = generatingDescriptionTargets.has(getAssistantTargetKey(descriptionAssistantTarget))
  const globalTitleGenerating = generatingTitleTargets.has("global")
  const globalDescriptionGenerating = generatingDescriptionTargets.has("global")

  return (
    <div className="min-h-full text-white">
      <div className="mx-auto max-w-7xl space-y-6 p-6 pb-40">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight md:text-3xl">
              <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
              <span className="text-white drop-shadow-lg">
                {isEnglish ? "YouTube Video Management" : "YouTube 视频管理"}
              </span>
            </h1>
            <p className="ml-[19px] mt-1 max-w-xl text-white/60">
              {isEnglish
                ? "Manage YouTube video publishing, scheduled releases, and task history."
                : "管理 YouTube 视频发布、预约发布和任务历史。"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => router.push("/youtube-publish/accounts")}
              className="flex min-w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 transition-all hover:border-white/20 hover:bg-white/10"
            >
              <Settings className="h-4 w-4 text-white/70" />
              <span className="text-white/80">{isEnglish ? "Account Management" : "账号管理"}</span>
            </button>
            <button
              onClick={fetchAccounts}
              disabled={loadingAccounts}
              className="flex min-w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 transition-all hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4 text-white/70", loadingAccounts && "animate-spin")} />
              <span className="text-white/80">{isEnglish ? "Refresh Accounts" : "刷新账号"}</span>
            </button>
          </div>
        </div>

        <div className="flex w-fit gap-1 rounded-xl border border-white/10 bg-black/40 p-1.5 backdrop-blur-md">
          {[
            { id: "create" as TabType, label: isEnglish ? "Video Publishing" : "视频发布", icon: Send },
            { id: "tasks" as TabType, label: isEnglish ? "Video List" : "视频列表", icon: ListFilter },
            ...(showCommentManagement
              ? [{ id: "comments" as TabType, label: isEnglish ? "Comment Management" : "评论管理", icon: MessageCircle }]
              : []),
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "group relative flex items-center gap-2 overflow-hidden rounded-lg px-5 py-2.5 font-medium transition-all duration-300",
                effectiveActiveTab === id
                  ? "bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black shadow-[0_0_20px_rgba(0,242,234,0.4)]"
                  : "text-white/50 hover:bg-white/5 hover:text-white/80"
              )}
            >
              {effectiveActiveTab === id && (
                <>
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent" />
                  <div className="pointer-events-none absolute left-0 right-0 top-[10%] h-[40%] rounded-lg bg-gradient-to-b from-white/30 to-transparent" />
                </>
              )}
              <Icon className={cn("relative z-10 h-4 w-4", effectiveActiveTab === id && "text-black")} />
              <span className="relative z-10">{label}</span>
            </button>
          ))}
        </div>

        {effectiveActiveTab === "tasks" ? (
          <YouTubeTaskManager isEnglish={isEnglish} />
        ) : effectiveActiveTab === "comments" && showCommentManagement ? (
          <SocialCommentsClient
            platformLock="youtube"
            embedded
            autoSyncEnabled={enableYouTubeAutoSync}
            initialSyncEnabled
          />
        ) : (
          <div className="space-y-6">
            <div className="space-y-6">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">1</span>
                    {t(isEnglish, "选择视频", "Select Videos")}
                  </h2>
                  {selectedVideos.length > 0 && (
                    <Button variant="titanium-outline" size="sm" onClick={() => setSelectedVideos([])}>
                      <Trash2 className="h-4 w-4" />
                      {t(isEnglish, "清空", "Clear")}
                    </Button>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={YOUTUBE_VIDEO_FORMATS.join(",")}
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <div className="mb-4 inline-flex gap-1 rounded-xl bg-black/40 p-1.5">
                  {[
                    { id: "upload" as VideoSourceType, label: t(isEnglish, "本地上传", "Local Upload"), icon: Upload },
                    { id: "asset" as VideoSourceType, label: t(isEnglish, "从视频制作区选择", "Select from Creation Workspace"), icon: FileVideo },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setVideoSource(id)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all duration-300",
                        videoSource === id
                          ? "bg-white/10 text-white shadow-lg shadow-black/20 ring-1 ring-white/10"
                          : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
                      )}
                    >
                      <Icon className={cn("h-4 w-4", videoSource === id && "text-cyan-400")} />
                      {label}
                    </button>
                  ))}
                </div>

                {uploadError && (
                  <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    {uploadError}
                    <button onClick={() => setUploadError(null)} className="ml-auto">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {uploadingFiles.length > 0 && (
                  <div className="mb-6 rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/90 to-black/90 p-5 shadow-xl backdrop-blur-md">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="rounded-full bg-cyan-500/10 p-2">
                          {uploadingFiles.every((file) => file.status === "done") ? (
                            <CheckCircle2 className="h-5 w-5 text-cyan-400" />
                          ) : (
                            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
                          )}
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-white">
                            {t(isEnglish, `正在上传 ${uploadingFiles.length} 个视频`, `Uploading ${uploadingFiles.length} videos`)}
                          </h3>
                          <p className="mt-0.5 text-xs text-gray-400">
                            {uploadingFiles.filter((file) => file.status === "done").length}/{uploadingFiles.length} {t(isEnglish, "完成", "complete")}
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
                        className="absolute left-0 top-0 h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 shadow-[0_0_10px_rgba(6,182,212,0.5)] transition-all duration-300"
                        style={{ width: `${uploadingFiles.reduce((sum, file) => sum + file.progress, 0) / uploadingFiles.length}%` }}
                      />
                    </div>

                    <div className="custom-scrollbar grid max-h-48 grid-cols-1 gap-2 overflow-y-auto pr-2 sm:grid-cols-2">
                      {uploadingFiles.map((file) => (
                        <div key={file.id} className="group flex items-center gap-3 rounded-lg border border-transparent bg-white/5 p-2 transition-colors hover:border-white/5 hover:bg-white/10">
                          <div className="shrink-0">
                            {file.status === "done" ? (
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/20">
                                <Check className="h-3.5 w-3.5 text-green-400" />
                              </div>
                            ) : file.status === "error" ? (
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20">
                                <X className="h-3.5 w-3.5 text-red-400" />
                              </div>
                            ) : (
                              <div className="relative flex h-6 w-6 items-center justify-center">
                                <svg className="h-full w-full -rotate-90">
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" className="text-white/10" />
                                  <circle
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    fill="none"
                                    className="text-cyan-500 transition-all duration-300"
                                    strokeDasharray={62.8}
                                    strokeDashoffset={62.8 - (62.8 * file.progress) / 100}
                                  />
                                </svg>
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="mb-0.5 flex items-center justify-between gap-2">
                              <span className={cn("truncate text-xs font-medium", file.status === "done" ? "text-gray-300 group-hover:text-white" : "text-white")}>
                                {file.name}
                              </span>
                              <span className={cn(
                                "tabular-nums text-[10px]",
                                file.status === "done" ? "text-green-400" : file.status === "error" ? "text-red-400" : "text-cyan-400"
                              )}>
                                {file.status === "done" ? t(isEnglish, "完成", "Done") : file.status === "error" ? t(isEnglish, "失败", "Failed") : `${file.progress}%`}
                              </span>
                            </div>
                            {file.error && <div className="truncate text-[10px] text-red-300">{file.error}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedVideos.length > 0 && (
                  <p className="mb-4 text-sm text-gray-400">
                    {isEnglish ? (
                      <>Selected <span className="font-semibold text-cyan-400">{selectedVideos.length}</span> videos</>
                    ) : (
                      <>已选择 <span className="font-semibold text-cyan-400">{selectedVideos.length}</span> 个视频</>
                    )}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {selectedVideos.map((video) => (
                    <div
                      key={video.id}
                      className="group relative aspect-[9/16] overflow-hidden rounded-xl border border-white/10 bg-white/5"
                    >
                      {video.thumbnail ? (
                        <img src={video.thumbnail} alt={video.name} className="absolute inset-0 h-full w-full object-cover" />
                      ) : video.localUrl || video.url ? (
                        <video
                          src={video.localUrl || video.url}
                          className="absolute inset-0 h-full w-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                          <Play className="h-8 w-8" />
                        </div>
                      )}

                      <div className="absolute left-2 top-2 rounded-full bg-green-500/90 p-1">
                        <Check className="h-3 w-3 text-white" />
                      </div>

                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                        <p className="truncate text-xs">{video.name}</p>
                        <div className="mt-1 flex items-center gap-1">
                          <span className={cn(
                            "rounded px-1.5 py-0.5 text-[10px]",
                            video.type === "asset" ? "bg-cyan-500/30 text-cyan-300" : "bg-green-500/30 text-green-300"
                          )}>
                            {video.type === "asset" ? t(isEnglish, "制作区", "Workspace") : t(isEnglish, "本地", "Local")}
                          </span>
                        </div>
                      </div>

                      <div className="absolute inset-x-0 bottom-0 opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="flex items-center justify-center gap-1 bg-black/70 p-2 backdrop-blur-sm">
                          <button
                            onClick={() => removeVideo(video.id)}
                            className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-white transition-colors hover:bg-red-500/50"
                          >
                            <Trash2 className="h-3 w-3" />
                            {t(isEnglish, "删除", "Delete")}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => (videoSource === "asset" ? openAssetSelector() : fileInputRef.current?.click())}
                    className="flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 text-gray-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
                  >
                    {videoSource === "asset" ? (
                      <>
                        <FileVideo className="h-8 w-8" />
                        <span className="px-2 text-center text-xs">{t(isEnglish, "从视频制作区选择", "Select from Creation Workspace")}</span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8" />
                        <span className="px-2 text-center text-xs">
                          {t(isEnglish, "上传视频", "Upload Video")}
                          <br />
                          <span className="text-[10px] text-gray-500">.mp4 .webm .mov</span>
                        </span>
                      </>
                    )}
                  </button>
                </div>

              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">2</span>
                    {isEnglish ? "Select Publishing Accounts or Groups" : "选择发布账号/账号组"}
                  </h2>
                  <div className="flex items-center gap-3">
                    <div className="flex rounded-lg border border-white/10 bg-black/30 p-1">
                      {[
                        { value: "accounts" as AccountSelectionMode, label: isEnglish ? "Accounts" : "账号", icon: Users },
                        { value: "groups" as AccountSelectionMode, label: isEnglish ? "Account Groups" : "账号组", icon: Layers3 },
                      ].map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setAccountSelectionMode(value)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                            accountSelectionMode === value ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/75"
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push("/youtube-publish/accounts")}
                      className="group relative flex items-center gap-1.5 overflow-hidden rounded-lg bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] px-4 py-2 text-sm font-bold text-black transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.4)]"
                    >
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/40 via-white/15 to-transparent" />
                      <div className="pointer-events-none absolute left-0 right-0 top-[10%] h-[35%] rounded-lg bg-gradient-to-b from-white/25 to-transparent" />
                      <Plus className="relative z-10 h-3.5 w-3.5" />
                      <span className="relative z-10">{isEnglish ? "Connect" : "去绑定"}</span>
                    </button>
                  </div>
                </div>

                {loadingAccounts ? (
                  <div className="flex h-32 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-white/45" />
                  </div>
                ) : accounts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-8 text-center">
                    <Youtube className="mx-auto mb-3 h-10 w-10 text-cyan-300/70" />
                    <div className="text-white/70">
                      {isEnglish ? "No available YouTube accounts" : "暂无可用 YouTube 账号"}
                    </div>
                    <Button variant="mermaid" className="mt-5" onClick={() => router.push("/youtube-publish/accounts")}>
                      {isEnglish ? "Connect YouTube Account" : "绑定 YouTube 账号"}
                    </Button>
                  </div>
                ) : accountSelectionMode === "groups" ? (
                  accountGroups.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-8 text-center">
                      <Layers3 className="mx-auto mb-3 h-10 w-10 text-white/30" />
                      <div className="text-white/70">
                        {isEnglish ? "No account groups available for publishing" : "暂无可用于发布的账号组"}
                      </div>
                      <p className="mx-auto mt-2 max-w-md text-sm text-white/40">
                        {isEnglish
                          ? "Refresh authorization on the account management page first. Publish-ready accounts will be added to the default group automatically."
                          : "请先在账号绑定页完成授权刷新。可发布账号会自动进入默认账号组。"}
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {accountGroups.map((group) => {
                        const selected = selectedGroupId === group.id
                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => setSelectedAccounts(group.accountIds)}
                            className={cn(
                              "relative overflow-hidden rounded-xl border p-5 text-left transition-all duration-300",
                              selected
                                ? "border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                                : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.04]"
                            )}
                          >
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#CCFF00]/0 via-[#00F2EA]/35 to-[#EC4899]/0" />
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold text-white">{group.name}</div>
                                <div className="mt-1 text-xs text-white/40">
                                  {isEnglish ? `${group.accounts.length} accounts` : `${group.accounts.length} 个账号`}
                                </div>
                              </div>
                              {selected && (
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400 text-black">
                                  <Check className="h-3 w-3" />
                                </span>
                              )}
                            </div>

                            <div className="mt-5 grid grid-cols-8 gap-2">
                              {group.accounts.slice(0, 8).map((account) => (
                                <div key={account.id} className="flex aspect-square items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5">
                                  {account.thumbnail_url ? (
                                    <img src={account.thumbnail_url} alt={account.channel_title} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="text-[10px] font-bold text-white/75">{account.channel_title.charAt(0).toUpperCase()}</span>
                                  )}
                                </div>
                              ))}
                            </div>

                            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300">
                                {isEnglish ? `Authorized ${group.accounts.length}` : `已授权 ${group.accounts.length}`}
                              </span>
                              <span className="rounded-md bg-white/[0.06] px-2 py-1 text-white/45">
                                {isEnglish
                                  ? `Will create ${selectedVideos.length * group.accounts.length} publishing tasks`
                                  : `将创建 ${selectedVideos.length * group.accounts.length} 个发布任务`}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {accounts.map((account) => {
                      const selected = selectedAccounts.includes(account.id)
                      const authorized = isAccountReady(account)
                      return (
                        <button
                          key={account.id}
                          onClick={() => authorized && toggleAccount(account.id)}
                          disabled={!authorized}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border p-4 text-left transition-colors",
                            selected ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-black/20 hover:border-white/20",
                            !authorized && "cursor-not-allowed opacity-50"
                          )}
                        >
                          {account.thumbnail_url ? (
                            <img src={account.thumbnail_url} alt={account.channel_title} className="h-11 w-11 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
                              {account.channel_title.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{account.channel_title}</div>
                            <div className="mt-1 text-xs text-white/40">
                              {isEnglish
                                ? `${formatNumber(account.subscriber_count, true)} subscribers · ${formatNumber(account.video_count, true)} videos`
                                : `${formatNumber(account.subscriber_count)} 订阅 · ${formatNumber(account.video_count)} 视频`}
                            </div>
                          </div>
                          {!authorized && (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                              {isEnglish ? "Auth required" : "需授权"}
                            </span>
                          )}
                          {selected && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400 text-black">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">3</span>
                    {t(isEnglish, "视频标题与描述", "Video Title and Description")}
                  </h2>
                  <div className="flex w-fit rounded-lg border border-white/10 bg-black/30 p-1">
                    {[
                      { value: "same" as MetadataContentMode, label: t(isEnglish, "相同内容", "Same Content") },
                      { value: "different" as MetadataContentMode, label: t(isEnglish, "不同内容", "Different Content") },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setMetadataMode(option.value)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                          metadataMode === option.value ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/75"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedVideos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-white/45">
                    {t(isEnglish, "上传视频后填写标题和描述", "Upload videos before entering titles and descriptions")}
                  </div>
                ) : metadataMode === "same" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm text-white/60">{t(isEnglish, "视频标题", "Video Title")}</label>
                      <div className="group relative">
                        <textarea
                          value={title}
                          onChange={(event) => setTitle(truncateYouTubeTextByCharacters(event.target.value, YOUTUBE_TITLE_MAX_CHARACTERS))}
                          placeholder={t(isEnglish, "输入视频标题...", "Enter video title...")}
                          rows={5}
                          maxLength={YOUTUBE_TITLE_MAX_CHARACTERS}
                          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 pb-14 pt-4 text-white placeholder-gray-500 transition-all focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                        />
                        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                          <div className={cn("font-mono text-xs", titleCharacterCount > YOUTUBE_TITLE_MAX_CHARACTERS * 0.9 ? "text-amber-400" : "text-gray-600")}>
                            {titleCharacterCount}/{YOUTUBE_TITLE_MAX_CHARACTERS} {t(isEnglish, "字符", "characters")}
                          </div>
                          <div className="flex items-center gap-2">
                            {globalTitleGenerating && (
                              <span className="flex items-center gap-1 rounded-full bg-pink-500/10 px-2 py-1 text-xs text-pink-200">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {t(isEnglish, "生成中", "Generating")}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => openTitleAssistant({ scope: "global" })}
                              disabled={globalTitleGenerating}
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-3 py-1.5 text-xs font-medium text-pink-300 shadow-lg shadow-pink-500/5 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30",
                                globalTitleGenerating && "cursor-not-allowed opacity-60"
                              )}
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              {t(isEnglish, "AI 写标题", "AI Write Title")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm text-white/60">{t(isEnglish, "视频描述", "Video Description")}</label>
                      <div className="group relative">
                        <textarea
                          value={description}
                          onChange={(event) => setDescription(truncateYouTubeTextByUtf8Bytes(event.target.value, YOUTUBE_DESCRIPTION_MAX_BYTES))}
                          placeholder={t(isEnglish, "输入视频描述...", "Enter video description...")}
                          rows={5}
                          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 pb-14 pt-4 text-white placeholder-gray-500 transition-all focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                        />
                        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                          <div className={cn("font-mono text-xs", descriptionByteCount > YOUTUBE_DESCRIPTION_MAX_BYTES * 0.9 ? "text-amber-400" : "text-gray-600")}>
                            {descriptionByteCount}/{YOUTUBE_DESCRIPTION_MAX_BYTES} bytes
                          </div>
                          <div className="flex items-center gap-2">
                            {globalDescriptionGenerating && (
                              <span className="flex items-center gap-1 rounded-full bg-pink-500/10 px-2 py-1 text-xs text-pink-200">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {t(isEnglish, "生成中", "Generating")}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setDescription((current) => truncateYouTubeTextByUtf8Bytes(`${current} #`, YOUTUBE_DESCRIPTION_MAX_BYTES))}
                              className="flex items-center gap-1.5 rounded-lg border border-transparent bg-white/5 px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                            >
                              <Hash className="h-3.5 w-3.5" />
                              {t(isEnglish, "话题", "Hashtag")}
                            </button>
                            <button
                              type="button"
                              onClick={() => openDescriptionAssistant({ scope: "global" })}
                              disabled={globalDescriptionGenerating}
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-3 py-1.5 text-xs font-medium text-pink-300 shadow-lg shadow-pink-500/5 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30",
                                globalDescriptionGenerating && "cursor-not-allowed opacity-60"
                              )}
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              {t(isEnglish, "AI 写描述", "AI Write Description")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedVideos((prev) => prev.map((video, index) => ({
                          ...video,
                          title: truncateYouTubeTextByCharacters(getVideoDefaultTitle(video, index, isEnglish), YOUTUBE_TITLE_MAX_CHARACTERS),
                        })))}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        {t(isEnglish, "按文件名填标题", "Fill Titles from File Names")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openTitleAssistant({ scope: "global" })}
                        disabled={globalTitleGenerating}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-3 py-2 text-xs font-medium text-pink-300 shadow-lg shadow-pink-500/5 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30",
                          globalTitleGenerating && "cursor-not-allowed opacity-60"
                        )}
                      >
                        {globalTitleGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {globalTitleGenerating
                          ? t(isEnglish, "批量生成中", "Generating Batch")
                          : t(isEnglish, "AI 批量写标题", "AI Batch Write Titles")}
                      </button>
                    </div>
                    {selectedVideos.map((video, index) => {
                      const itemTitle = video.title ?? getVideoDefaultTitle(video, index, isEnglish)
                      const itemDescription = video.description ?? ""
                      const itemTitleCount = getYouTubeCharacterLength(itemTitle)
                      const itemDescriptionBytes = getUtf8ByteLength(itemDescription)
                      const itemTitleGenerating = generatingTitleTargets.has(video.id) || globalTitleGenerating
                      const itemDescriptionGenerating = generatingDescriptionTargets.has(video.id)

                      return (
                        <div key={`${video.id}-metadata`} className="grid gap-4 rounded-xl border border-white/10 bg-black/20 p-4 lg:grid-cols-[180px_minmax(0,1fr)]">
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
                            <div className="text-sm font-medium text-white">{t(isEnglish, `视频 ${index + 1}`, `Video ${index + 1}`)}</div>
                            <div className="mt-1 truncate text-xs text-white/45">{video.name}</div>
                          </div>

                          <div className="grid min-w-0 gap-3">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <label className="text-sm text-white/60">{t(isEnglish, "视频标题", "Video Title")}</label>
                                  {itemTitleGenerating && (
                                    <span className="flex items-center gap-1 rounded-full bg-pink-500/10 px-2 py-1 text-xs text-pink-200">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      {t(isEnglish, "生成中", "Generating")}
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openTitleAssistant({ scope: "video", videoId: video.id })}
                                  disabled={itemTitleGenerating}
                                  className={cn(
                                    "flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-2.5 py-1.5 text-xs font-medium text-pink-300 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30",
                                    itemTitleGenerating && "cursor-not-allowed opacity-60"
                                  )}
                                >
                                  <Sparkles className="h-3.5 w-3.5" />
                                  {t(isEnglish, "AI 写标题", "AI Write Title")}
                                </button>
                              </div>
                              <Input
                                value={itemTitle}
                                maxLength={YOUTUBE_TITLE_MAX_CHARACTERS}
                                onChange={(event) => updateVideo(video.id, { title: truncateYouTubeTextByCharacters(event.target.value, YOUTUBE_TITLE_MAX_CHARACTERS) })}
                                placeholder={t(isEnglish, "输入视频标题...", "Enter video title...")}
                                className="border-white/10 bg-black/30 text-white"
                              />
                              <div className={cn("text-right font-mono text-xs", itemTitleCount > YOUTUBE_TITLE_MAX_CHARACTERS * 0.9 ? "text-amber-400" : "text-white/35")}>
                                {itemTitleCount}/{YOUTUBE_TITLE_MAX_CHARACTERS} {t(isEnglish, "字符", "characters")}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <label className="text-sm text-white/60">{t(isEnglish, "视频描述", "Video Description")}</label>
                                  {itemDescriptionGenerating && (
                                    <span className="flex items-center gap-1 rounded-full bg-pink-500/10 px-2 py-1 text-xs text-pink-200">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      {t(isEnglish, "生成中", "Generating")}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => updateVideo(video.id, { description: truncateYouTubeTextByUtf8Bytes(`${itemDescription} #`, YOUTUBE_DESCRIPTION_MAX_BYTES) })}
                                    className="flex items-center gap-1.5 rounded-lg border border-transparent bg-white/5 px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                                  >
                                    <Hash className="h-3.5 w-3.5" />
                                    {t(isEnglish, "话题", "Hashtag")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openDescriptionAssistant({ scope: "video", videoId: video.id })}
                                    disabled={itemDescriptionGenerating}
                                    className={cn(
                                      "flex items-center gap-1.5 rounded-lg border border-pink-500/20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-2.5 py-1.5 text-xs font-medium text-pink-300 transition-all hover:border-pink-500/40 hover:from-purple-500/30 hover:to-pink-500/30",
                                      itemDescriptionGenerating && "cursor-not-allowed opacity-60"
                                    )}
                                  >
                                    <Sparkles className="h-3.5 w-3.5" />
                                    {t(isEnglish, "AI 写描述", "AI Write Description")}
                                  </button>
                                </div>
                              </div>
                              <Textarea
                                value={itemDescription}
                                onChange={(event) => updateVideo(video.id, { description: truncateYouTubeTextByUtf8Bytes(event.target.value, YOUTUBE_DESCRIPTION_MAX_BYTES) })}
                                placeholder={t(isEnglish, "输入视频描述...", "Enter video description...")}
                                className="min-h-28 border-white/10 bg-black/30 text-white"
                              />
                              <div className={cn("text-right font-mono text-xs", itemDescriptionBytes > YOUTUBE_DESCRIPTION_MAX_BYTES * 0.9 ? "text-amber-400" : "text-white/35")}>
                                {itemDescriptionBytes}/{YOUTUBE_DESCRIPTION_MAX_BYTES} bytes
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {selectedVideos.length > 0 && metadataErrors.length > 0 && (
                  <div className="mt-5 flex items-center gap-2 text-xs text-red-300">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {metadataErrors[0]}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">4</span>
                  {t(isEnglish, "发布设置", "Publishing Settings")}
                </h2>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm text-white/60">{t(isEnglish, "任务组名称", "Task Group Name")}</label>
                    <Input
                      value={taskName}
                      onChange={(event) => setTaskName(event.target.value)}
                      placeholder={t(isEnglish, "YouTube 发布任务组", "YouTube publishing task group")}
                      className="border-white/10 bg-black/30 text-white"
                    />
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  <label className="text-sm text-white/60">{t(isEnglish, "可见范围", "Visibility")}</label>
                  <div className="grid gap-3 md:grid-cols-3">
                    {PRIVACY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setPrivacyStatus(option.value)}
                        className={cn(
                          "rounded-lg border p-4 text-left transition-colors",
                          privacyStatus === option.value ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-black/20 hover:border-white/20"
                        )}
                      >
                        <div className="font-medium">{isEnglish ? option.label.en : option.label.zh}</div>
                        <div className="mt-1 text-xs text-white/40">{isEnglish ? option.desc.en : option.desc.zh}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  {[
                    [t(isEnglish, "AI 合成内容", "AI-generated Content"), containsSyntheticMedia, setContainsSyntheticMedia],
                    [t(isEnglish, "儿童内容", "Made for Kids"), madeForKids, setMadeForKids],
                    [t(isEnglish, "通知订阅者", "Notify Subscribers"), notifySubscribers, setNotifySubscribers],
                  ].map(([label, checked, setter]) => (
                    <label key={String(label)} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm">
                      <span>{label as string}</span>
                      <input
                        type="checkbox"
                        checked={checked as boolean}
                        onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)}
                        className="h-4 w-4 accent-cyan-500"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <label className="text-sm text-white/60">{t(isEnglish, "发布方式", "Publishing Mode")}</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ["now", t(isEnglish, "立即发布", "Publish Now"), Clock],
                        ["scheduled", t(isEnglish, "定时发布", "Schedule"), Calendar],
                      ].map(([value, label, Icon]) => (
                        <button
                          key={String(value)}
                          onClick={() => setPublishMode(value as YouTubePublishMode)}
                          className={cn(
                            "rounded-lg border p-4 text-left transition-colors",
                            publishMode === value ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-black/20 hover:border-white/20"
                          )}
                        >
                          <div className="flex items-center gap-2 font-medium">
                            <Icon className="h-4 w-4 text-cyan-300" />
                            {label as string}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm text-white/60">{t(isEnglish, "发布间隔", "Publishing Interval")}</label>
                    <div className="flex gap-3">
                      <select
                        value={intervalMode}
                        onChange={(event) => setIntervalMode(event.target.value as YouTubeIntervalMode)}
                        className="h-10 flex-1 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white"
                      >
                        {INTERVAL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{isEnglish ? option.label.en : option.label.zh}</option>
                        ))}
                      </select>
                      {intervalMode === "custom" && (
                        <Input
                          type="number"
                          min={1}
                          max={1440}
                          value={customInterval}
                          onChange={(event) => setCustomInterval(Number(event.target.value) || 5)}
                          className="w-28 border-white/10 bg-black/30 text-white"
                        />
                      )}
                    </div>
                  </div>
                </div>

                {publishMode === "scheduled" && (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Input type="date" value={scheduledDate} min={new Date().toISOString().split("T")[0]} onChange={(event) => setScheduledDate(event.target.value)} className="border-white/10 bg-black/30 text-white" />
                    <Input type="time" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} className="border-white/10 bg-black/30 text-white" />
                  </div>
                )}
              </section>
            </div>

            <div className="z-10 mt-6 md:sticky md:bottom-4">
              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-gray-900/80 p-3 shadow-2xl backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between lg:p-1.5">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:h-16 sm:items-center">
                  <div className="flex h-full min-w-0 flex-col justify-center rounded-xl bg-white/5 px-4 sm:rounded-none sm:border-r sm:border-white/5 sm:bg-transparent">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t(isEnglish, "视频", "Videos")}</span>
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-2xl font-bold text-white">{selectedVideos.length}</span>
                      <span className="text-xs text-gray-500">{t(isEnglish, "个", "items")}</span>
                    </div>
                  </div>

                  <div className="flex h-full min-w-0 items-center gap-3 rounded-xl bg-white/5 px-4 sm:rounded-none sm:border-r sm:border-white/5 sm:bg-transparent">
                    {selectedAccounts.length > 0 ? (
                      <>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">
                          {accounts.find((account) => account.id === selectedAccounts[0])?.channel_title?.charAt(0).toUpperCase() || "Y"}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t(isEnglish, "账号", "Account")}</span>
                          <span className="max-w-[120px] truncate text-sm font-medium text-white">
                            {accounts.find((account) => account.id === selectedAccounts[0])?.channel_title || t(isEnglish, "已选择", "Selected")}
                            {selectedAccounts.length > 1 ? ` +${selectedAccounts.length - 1}` : ""}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t(isEnglish, "账号", "Account")}</span>
                        <span className="text-sm text-gray-400">{t(isEnglish, "未选择", "Not selected")}</span>
                      </div>
                    )}
                  </div>

                  <div className="hidden h-full flex-col justify-center px-5 md:flex">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t(isEnglish, "发布时间", "Publish Time")}</span>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {publishMode === "now" ? (
                        <>
                          <Clock className="h-3.5 w-3.5 text-cyan-400" />
                          <span className="text-cyan-400">{t(isEnglish, "立即发布", "Publish Now")}</span>
                        </>
                      ) : (
                        <>
                          <Calendar className="h-3.5 w-3.5 text-pink-400" />
                          <span className="text-pink-400">{scheduledDate} {scheduledTime}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="hidden h-full flex-col justify-center px-5 xl:flex">
                    <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">{t(isEnglish, "发布设置", "Settings")}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                        {(() => {
                          const option = PRIVACY_OPTIONS.find((item) => item.value === privacyStatus)
                          return option ? (isEnglish ? option.label.en : option.label.zh) : privacyStatus
                        })()}
                      </span>
                      <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-400">
                        {t(isEnglish, `间隔 ${getIntervalMinutes(intervalMode, customInterval)} 分钟`, `Interval ${getIntervalMinutes(intervalMode, customInterval)} min`)}
                      </span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                        {t(isEnglish, `${totalTasks} 个发布项`, `${totalTasks} publishing items`)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto] items-center gap-2 lg:flex lg:pr-1.5">
                  {(publishError || metadataErrors[0]) && (
                    <p className="col-span-2 flex items-center gap-1 text-xs text-red-400 lg:col-span-1 lg:mr-2">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{publishError || metadataErrors[0]}</span>
                    </p>
                  )}

                  <button
                    onClick={() => {
                      setSelectedVideos([])
                      setSelectedAccounts([])
                      setPublishError(null)
                    }}
                    className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-gray-400 transition-colors hover:bg-white/5"
                  >
                    {t(isEnglish, "取消", "Cancel")}
                  </button>
                  <button
                    onClick={createPublishTask}
                    disabled={!canPublish}
                    className="group relative h-12 min-w-[112px] overflow-hidden rounded-xl bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] px-6 transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(0,242,234,0.5)] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
                  >
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent" />
                    <div className="pointer-events-none absolute left-0 right-0 top-[10%] h-[40%] rounded-xl bg-gradient-to-b from-white/30 to-transparent" />
                    <div className="relative z-10 flex items-center gap-2 font-bold text-black">
                      {publishing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>{t(isEnglish, "创建中...", "Creating...")}</span>
                        </>
                      ) : (
                        <>
                          <span>{t(isEnglish, "创建任务", "Create Task")}</span>
                          <Send className="h-4 w-4" />
                        </>
                      )}
                    </div>
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-amber-400/[0.15] bg-amber-400/[0.08] p-3 text-xs leading-5 text-amber-100/70">
                {t(
                  isEnglish,
                  "YouTube 新 API 项目在审核前上传的视频可能被限制为私密状态。公开发布前需要完成 YouTube API 合规审核。",
                  "Videos uploaded by new YouTube API projects may be restricted to private before review. Complete YouTube API compliance review before public publishing."
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={showTitleAssistant}
        onOpenChange={(open) => {
          setShowTitleAssistant(open)
          if (!open) {
            setTitlePrompt("")
            setTitleAssistantTarget({ scope: "global" })
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
            placeholder={
              titleAssistantTarget.scope === "video"
                ? t(isEnglish, "可填写这条视频的风格、关键词或禁用词", "Optional style, keywords, or banned words for this video")
                : t(isEnglish, "可填写风格、关键词或禁用词", "Optional style, keywords, or banned words")
            }
            className="min-h-32 border-white/10 bg-white/[0.04] text-white"
          />
          <DialogFooter>
            <Button variant="titanium-outline" onClick={() => setShowTitleAssistant(false)}>
              {t(isEnglish, "取消", "Cancel")}
            </Button>
            <Button variant="mermaid" onClick={startTitleGeneration} disabled={titleDialogGenerating}>
              {titleDialogGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {titleDialogGenerating ? t(isEnglish, "生成中", "Generating") : t(isEnglish, "生成", "Generate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showDescriptionAssistant}
        onOpenChange={(open) => {
          setShowDescriptionAssistant(open)
          if (!open) {
            setDescriptionPrompt("")
            setDescriptionAssistantTarget({ scope: "global" })
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
            placeholder={
              descriptionAssistantTarget.scope === "video"
                ? t(isEnglish, "可填写这条视频的描述风格、关键词、话题或禁用词", "Optional description style, keywords, hashtags, or banned words for this video")
                : t(isEnglish, "可填写描述风格、关键词、话题或禁用词", "Optional description style, keywords, hashtags, or banned words")
            }
            className="min-h-32 border-white/10 bg-white/[0.04] text-white"
          />
          <DialogFooter>
            <Button variant="titanium-outline" onClick={() => setShowDescriptionAssistant(false)}>
              {t(isEnglish, "取消", "Cancel")}
            </Button>
            <Button variant="mermaid" onClick={startDescriptionGeneration} disabled={descriptionDialogGenerating}>
              {descriptionDialogGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {descriptionDialogGenerating ? t(isEnglish, "生成中", "Generating") : t(isEnglish, "生成", "Generate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showAssetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[84vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#111113] shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
                  <FileVideo className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">{t(isEnglish, "从视频制作区选择", "Select from Creation Workspace")}</h3>
                  <p className="mt-0.5 text-xs text-white/40">
                    {t(isEnglish, "单击多选，双击快速添加到 YouTube 发布列表", "Click to multi-select. Double-click to quickly add to the YouTube publishing list.")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="titanium-outline" size="sm" onClick={fetchAssets} disabled={loadingAssets || batchTransfer.isTransferring}>
                  <RefreshCw className={cn("h-4 w-4", loadingAssets && "animate-spin")} />
                  {t(isEnglish, "刷新", "Refresh")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (batchTransfer.isTransferring) return
                    setShowAssetModal(false)
                    setSelectedAssetIds([])
                  }}
                  disabled={batchTransfer.isTransferring}
                  className="text-white/55 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {loadingAssets ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-cyan-300" />
                </div>
              ) : assets.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.12] bg-black/20 text-center">
                  <FileVideo className="mb-3 h-12 w-12 text-white/25" />
                  <div className="font-medium text-white/70">{t(isEnglish, "暂无可选视频", "No selectable videos")}</div>
                  <div className="mt-1 text-sm text-white/35">
                    {t(isEnglish, "视频制作区完成的视频会出现在这里", "Completed videos from the creation workspace will appear here")}
                  </div>
                  <Button variant="titanium-outline" className="mt-5" onClick={() => router.push("/assets")}>
                    {t(isEnglish, "查看素材", "View Assets")}
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {assets.map((asset) => {
                    const alreadyAdded = selectedVideos.some((video) => video.id === asset.id)
                    const selected = selectedAssetIds.includes(asset.id)
                    const transferring = transferringAssets.has(asset.id)

                    return (
                      <button
                        key={asset.id}
                        onClick={() => {
                          if (alreadyAdded || transferring || batchTransfer.isTransferring) return
                          setSelectedAssetIds((prev) =>
                            prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id]
                          )
                        }}
                        onDoubleClick={() => {
                          if (alreadyAdded || transferring || batchTransfer.isTransferring) return
                          addVideoFromAsset(asset)
                        }}
                        disabled={alreadyAdded || batchTransfer.isTransferring}
                        className={cn(
                          "group relative aspect-video overflow-hidden rounded-lg border text-left transition-all",
                          alreadyAdded && "cursor-not-allowed opacity-40",
                          selected ? "border-cyan-400 ring-2 ring-cyan-400/25" : "border-white/10 hover:border-cyan-400/50"
                        )}
                      >
                        {asset.thumbnailUrl ? (
                          <img src={asset.thumbnailUrl} alt={asset.prompt || t(isEnglish, "视频", "Video")} className="absolute inset-0 h-full w-full object-cover" />
                        ) : asset.resultUrl ? (
                          <video
                            src={`${asset.resultUrl}#t=0.1`}
                            className="absolute inset-0 h-full w-full object-cover"
                            muted
                            playsInline
                            preload="metadata"
                            onMouseEnter={(event) => event.currentTarget.play().catch(() => undefined)}
                            onMouseLeave={(event) => {
                              event.currentTarget.pause()
                              event.currentTarget.currentTime = 0.1
                            }}
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                            <FileVideo className="h-8 w-8 text-white/30" />
                          </div>
                        )}

                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3">
                          <div className="truncate text-sm font-medium">{asset.prompt || t(isEnglish, "未命名视频", "Untitled video")}</div>
                          <div className="mt-1 text-xs text-white/45">{format(new Date(asset.createdAt), "MM/dd HH:mm")}</div>
                        </div>

                        {!alreadyAdded && !transferring && (
                          <span className={cn(
                            "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border",
                            selected ? "border-cyan-400 bg-cyan-400 text-black" : "border-white/50 bg-black/40 text-transparent"
                          )}>
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        )}

                        {alreadyAdded && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white/80">
                            {t(isEnglish, "已添加", "Added")}
                          </div>
                        )}

                        {transferring && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75">
                            <Loader2 className="mb-2 h-7 w-7 animate-spin text-cyan-300" />
                            <span className="text-xs text-cyan-100">{t(isEnglish, "转存中", "Transferring")}</span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {batchTransfer.isTransferring && (
              <div className="border-t border-cyan-400/20 bg-cyan-500/10 px-5 py-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-cyan-100">
                    {t(isEnglish, `正在转存 ${batchTransfer.completed + batchTransfer.failed}/${batchTransfer.total}`, `Transferring ${batchTransfer.completed + batchTransfer.failed}/${batchTransfer.total}`)}
                  </span>
                  {batchTransfer.failed > 0 && (
                    <span className="text-red-300">
                      {t(isEnglish, `失败 ${batchTransfer.failed}`, `${batchTransfer.failed} failed`)}
                    </span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-cyan-400 transition-all"
                    style={{
                      width: `${batchTransfer.total > 0 ? ((batchTransfer.completed + batchTransfer.failed) / batchTransfer.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 border-t border-white/10 bg-black/25 px-5 py-4">
              <div className="text-sm text-white/45">
                {isEnglish ? (
                  <>Selected <span className="font-semibold text-cyan-200">{selectedAssetIds.length}</span></>
                ) : (
                  <>已选 <span className="font-semibold text-cyan-200">{selectedAssetIds.length}</span> 个</>
                )}
                {selectedVideos.some((video) => video.type === "asset") && (
                  <span className="ml-3 text-white/30">
                    {t(
                      isEnglish,
                      `已添加 ${selectedVideos.filter((video) => video.type === "asset").length} 个制作区视频`,
                      `${selectedVideos.filter((video) => video.type === "asset").length} workspace videos added`
                    )}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="titanium-outline"
                  onClick={() => {
                    if (batchTransfer.isTransferring) return
                    setShowAssetModal(false)
                    setSelectedAssetIds([])
                  }}
                  disabled={batchTransfer.isTransferring}
                >
                  {t(isEnglish, "取消", "Cancel")}
                </Button>
                <Button
                  variant="mermaid"
                  disabled={selectedAssetIds.length === 0 || batchTransfer.isTransferring}
                  onClick={() => startBatchTransfer(selectedAssetIds)}
                >
                  {batchTransfer.isTransferring ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {t(isEnglish, "确认添加", "Confirm Add")} {selectedAssetIds.length > 0 ? `(${selectedAssetIds.length})` : ""}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
