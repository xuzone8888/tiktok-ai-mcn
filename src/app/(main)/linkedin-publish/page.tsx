"use client"

import { format } from "date-fns"
import {
  AlertCircle,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  FileVideo,
  Hash,
  History,
  Linkedin,
  ListFilter,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  getLinkedInCharacterLength,
  normalizeLinkedInTags,
  validateLinkedInDescription,
  validateLinkedInTags,
  validateLinkedInTitle,
  LINKEDIN_DESCRIPTION_MAX_CHARACTERS,
  LINKEDIN_TITLE_MAX_CHARACTERS,
} from "@/lib/linkedin/metadata-rules"
import { isLinkedInPublishEnabled } from "@/lib/feature-flags"
import { cn } from "@/lib/utils"
import {
  LINKEDIN_MAX_FILE_SIZE,
  LINKEDIN_VIDEO_FORMATS,
  type LinkedInAccount,
  type LinkedInFileUploadStatus,
  type LinkedInIntervalMode,
  type LinkedInPublishMode,
  type LinkedInPublishTask,
  type LinkedInPublishTaskItem,
  type LinkedInSelectedVideo,
} from "@/types/linkedin-publish"

type TabType = "create" | "tasks"
type VideoSourceType = "upload" | "url"

const INTERVAL_OPTIONS: Array<{ value: LinkedInIntervalMode; label: string }> = [
  { value: "0", label: "不间隔" },
  { value: "3", label: "3 分钟" },
  { value: "5", label: "5 分钟" },
  { value: "10", label: "10 分钟" },
  { value: "30", label: "30 分钟" },
  { value: "60", label: "1 小时" },
  { value: "120", label: "2 小时" },
  { value: "360", label: "6 小时" },
  { value: "720", label: "12 小时" },
  { value: "1440", label: "24 小时" },
  { value: "custom", label: "自定义" },
]

function formatNumber(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return String(value)
}

function isLinkedInAcceptedVideoFile(file: File) {
  if (file.type === "video/mp4" && /\.mp4$/i.test(file.name)) return true
  if (file.type === "application/octet-stream" && /\.mp4$/i.test(file.name)) return true
  return false
}

function getUploadContentType(file: File) {
  return "video/mp4"
}

function formatFileSize(bytes: number) {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(1)}MB`
}

function getVideoDefaultTitle(video: Pick<LinkedInSelectedVideo, "name">, index: number) {
  return video.name.replace(/\.[^.]+$/, "").trim() || video.name || `视频 ${index + 1}`
}

function getIntervalMinutes(mode: LinkedInIntervalMode, customInterval: number) {
  return mode === "custom" ? customInterval : Number(mode)
}

function statusLabel(status: string) {
  switch (status) {
    case "completed":
      return "已完成"
    case "published":
      return "已发布"
    case "partial_failed":
      return "部分失败"
    case "failed":
      return "失败"
    case "scheduled":
      return "已定时"
    case "uploading":
      return "上传中"
    case "processing":
      return "发布中"
    case "cancelled":
      return "已取消"
    default:
      return "待发布"
  }
}

function statusClass(status: string) {
  if (status === "completed" || status === "published") return "bg-emerald-500/10 text-emerald-300 border-emerald-400/20"
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

function isStorageNotConfiguredError(message: string) {
  return /Storage service not configured|存储服务未配置/i.test(message)
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

function getAssistantErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return "生成超时，请稍后重试"
  }
  return error instanceof Error ? error.message : "请稍后再试"
}

function isAccountReady(account: LinkedInAccount) {
  return account.status === "active"
}

function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:"
  } catch {
    return false
  }
}

function getUrlName(value: string) {
  try {
    const url = new URL(value)
    const last = url.pathname.split("/").filter(Boolean).pop()
    return last ? decodeURIComponent(last) : "LinkedIn 视频"
  } catch {
    return "LinkedIn 视频"
  }
}

function parseTagsInput(value: string) {
  return normalizeLinkedInTags(value.split(/[\s,，#＃]+/).filter(Boolean))
}

async function requestLinkedInUploadCredentials(file: File) {
  const contentType = getUploadContentType(file)
  const response = await fetch("/api/upload/oss-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType,
    }),
  })

  if (!response.ok) {
    const error = await readApiError(response, "获取上传凭证失败")
    if (isStorageNotConfiguredError(error)) {
      throw new Error("LinkedIn 发布需要可信 OSS/CDN 的 HTTPS 视频地址。请配置 OSS 上传，或使用可信 CDN URL 添加视频。")
    }
    throw new Error(error)
  }

  const data = await response.json().catch(() => null)
  if (!data?.success || !data?.data?.uploadUrl || !data?.data?.publicUrl) {
    throw new Error("上传凭证无效")
  }

  return data.data as { uploadUrl: string; publicUrl: string }
}

function LinkedInTaskItemPreview({ item }: { item: LinkedInPublishTaskItem }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [item.id, item.video_url])

  return (
    <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/40">
      {item.video_url && !failed ? (
        <video
          src={`${item.video_url}#t=0.1`}
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/35">
          <FileVideo className="h-5 w-5" />
        </div>
      )}
    </div>
  )
}

function LinkedInTaskManager({ refreshSignal }: { refreshSignal: number }) {
  const { toast } = useToast()
  const [tasks, setTasks] = useState<LinkedInPublishTask[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStatus, setActiveStatus] = useState("all")
  const [dateRange, setDateRange] = useState("today")
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ dateRange, limit: "50", offset: "0" })
      if (activeStatus !== "all") params.set("status", activeStatus)
      const response = await fetch(`/api/linkedin/publish/tasks?${params.toString()}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "加载任务失败")
      setTasks(data.tasks || [])
    } catch (error) {
      toast({
        title: "加载失败",
        description: error instanceof Error ? error.message : "无法获取 LinkedIn 任务",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [activeStatus, dateRange, toast])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks, refreshSignal])

  const deleteTask = async (taskId: string) => {
    if (!window.confirm("确定删除这个 LinkedIn 发布任务吗？已发布到 LinkedIn 的视频不会被删除。")) return
    setDeletingId(taskId)
    try {
      const response = await fetch(`/api/linkedin/publish/tasks/${taskId}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "删除失败")
      setTasks((prev) => prev.filter((task) => task.id !== taskId))
      toast({ title: "任务已删除" })
    } catch (error) {
      toast({
        title: "删除失败",
        description: error instanceof Error ? error.message : "请稍后重试",
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
            ["all", "全部"],
            ["in_progress", "进行中"],
            ["completed", "已完成"],
            ["failed", "失败"],
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
            <option value="today">今天</option>
            <option value="yesterday">昨天</option>
            <option value="3days">近3天</option>
            <option value="7days">近7天</option>
          </select>
          <Button variant="titanium-outline" size="sm" onClick={fetchTasks} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            刷新
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
          <div className="text-white/70">暂无 LinkedIn 发布任务</div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {tasks.map((task) => (
            <div key={task.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{task.name || task.task_name || "未命名 LinkedIn 任务"}</h3>
                  <div className="mt-1 text-xs text-white/40">
                    {format(new Date(task.created_at), "yyyy-MM-dd HH:mm")}
                    {task.scheduled_at ? ` · 首发 ${format(new Date(task.scheduled_at), "MM-dd HH:mm")}` : ""}
                  </div>
                </div>
                <span className={cn("rounded-full border px-2.5 py-1 text-xs", statusClass(task.status))}>
                  {statusLabel(task.status)}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2 text-center text-sm">
                <div className="rounded-md bg-black/25 p-3">
                  <div className="text-white/35">视频</div>
                  <div className="mt-1 font-semibold">{task.video_count || 0}</div>
                </div>
                <div className="rounded-md bg-black/25 p-3">
                  <div className="text-white/35">身份</div>
                  <div className="mt-1 font-semibold">{task.account_count || 0}</div>
                </div>
                <div className="rounded-md bg-black/25 p-3">
                  <div className="text-white/35">成功</div>
                  <div className="mt-1 font-semibold text-emerald-300">{task.published_count || 0}</div>
                </div>
                <div className="rounded-md bg-black/25 p-3">
                  <div className="text-white/35">失败</div>
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
                          <LinkedInTaskItemPreview item={item} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-white/80">{item.title || item.source_video_name || "未命名视频"}</div>
                            {item.source_video_name && item.source_video_name !== item.title && (
                              <div className="mt-0.5 truncate text-xs text-white/35">{item.source_video_name}</div>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/35">
                              <span>{statusLabel(item.status)}</span>
                              {scheduledTime && <span>发布时间 {scheduledTime}</span>}
                            </div>
                            {item.error_message && <div className="mt-1 line-clamp-2 text-xs text-red-300">{item.error_message}</div>}
                          </div>
                        </div>
                        {item.linkedin_share_url && (
                          <a href={item.linkedin_share_url} target="_blank" className="shrink-0 text-cyan-300 hover:text-cyan-200">
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
                  删除任务
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LinkedInPublishDisabledPage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-10">
        <div className="w-full rounded-lg border border-white/10 bg-white/[0.04] p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-[#0A66C2]/20 text-[#6fb4ff]">
            <Linkedin className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-normal">领英视频发布已暂停</h1>
          <p className="mt-3 text-sm text-white/50">当前环境未启用 LinkedIn 发布能力。</p>
        </div>
      </div>
    </div>
  )
}

function LinkedInPublishPageContent() {
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState<TabType>("create")
  const [videoSource, setVideoSource] = useState<VideoSourceType>("upload")
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [selectedVideos, setSelectedVideos] = useState<LinkedInSelectedVideo[]>([])
  const [uploadingFiles, setUploadingFiles] = useState<LinkedInFileUploadStatus[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState("")

  const [taskName, setTaskName] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tagsInput, setTagsInput] = useState("")
  const [generatingTitle, setGeneratingTitle] = useState(false)
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const [publishMode, setPublishMode] = useState<LinkedInPublishMode>("now")
  const [scheduledAt, setScheduledAt] = useState("")
  const [intervalMode, setIntervalMode] = useState<LinkedInIntervalMode>("0")
  const [customInterval, setCustomInterval] = useState(5)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [taskRefreshSignal, setTaskRefreshSignal] = useState(0)

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const response = await fetch("/api/linkedin/accounts")
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "加载账号失败")
      setAccounts(data.accounts || [])
    } catch (error) {
      toast({
        title: "账号加载失败",
        description: error instanceof Error ? error.message : "无法获取 LinkedIn 账号",
        variant: "destructive",
      })
    } finally {
      setLoadingAccounts(false)
    }
  }, [toast])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const readyAccounts = useMemo(() => accounts.filter(isAccountReady), [accounts])
  const selectedAccountSet = useMemo(() => new Set(selectedAccounts), [selectedAccounts])
  const tags = useMemo(() => parseTagsInput(tagsInput), [tagsInput])
  const totalTasks = selectedVideos.length * selectedAccounts.length
  const titleCharacterCount = getLinkedInCharacterLength(title)
  const descriptionCharacterCount = getLinkedInCharacterLength(description)
  const metadataErrors = useMemo(() => {
    const errors: string[] = []
    const tagsError = validateLinkedInTags(tags)
    if (tagsError) errors.push(tagsError)

    if (selectedVideos.length === 0) return errors

    selectedVideos.forEach((video, index) => {
      const itemTitle = ((video.title ?? title) || getVideoDefaultTitle(video, index)).trim()
      const itemDescription = video.description ?? description
      const titleError = validateLinkedInTitle(itemTitle, `视频 ${index + 1} 标题`)
      const descriptionError = validateLinkedInDescription(itemDescription, `视频 ${index + 1} 描述`)
      if (titleError) errors.push(titleError)
      if (descriptionError) errors.push(descriptionError)
    })

    return errors
  }, [description, selectedVideos, tags, title])
  const canPublish =
    selectedVideos.length > 0 &&
    selectedAccounts.length > 0 &&
    !publishing &&
    !generatingTitle &&
    !generatingDescription &&
    metadataErrors.length === 0 &&
    selectedVideos.every((video) => video.url && isPublicHttpsUrl(video.url)) &&
    (publishMode === "now" || Boolean(scheduledAt))

  const updateUploadStatus = (fileId: string, updates: Partial<LinkedInFileUploadStatus>) => {
    setUploadingFiles((prev) => prev.map((file) => file.id === fileId ? { ...file, ...updates } : file))
  }

  const uploadSingleFile = async (file: File, id: string) => {
    updateUploadStatus(id, { status: "uploading", progress: 0, error: undefined })
    const credentials = await requestLinkedInUploadCredentials(file)
    const contentType = getUploadContentType(file)

    const uploadedUrl = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          updateUploadStatus(id, { progress: Math.round((event.loaded / event.total) * 96) })
        }
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(credentials.publicUrl)
        else reject(new Error(`视频上传失败 (${xhr.status})`))
      }
      xhr.onerror = () => reject(new Error("网络错误"))
      xhr.ontimeout = () => reject(new Error("上传超时"))
      xhr.open("PUT", credentials.uploadUrl)
      xhr.setRequestHeader("Content-Type", contentType)
      xhr.timeout = 600000
      xhr.send(file)
    })

    const newVideo: LinkedInSelectedVideo = {
      id,
      type: "upload",
      name: file.name,
      url: uploadedUrl,
      localUrl: URL.createObjectURL(file),
      title: getVideoDefaultTitle({ name: file.name }, 0).slice(0, LINKEDIN_TITLE_MAX_CHARACTERS),
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
      if (!isLinkedInAcceptedVideoFile(file)) {
        setUploadError("不支持的视频格式。LinkedIn 首版仅支持 .mp4 文件。")
        continue
      }
      if (file.size > LINKEDIN_MAX_FILE_SIZE) {
        setUploadError(`文件过大: ${formatFileSize(file.size)}。最大: ${formatFileSize(LINKEDIN_MAX_FILE_SIZE)}`)
        continue
      }
      validFiles.push({
        file,
        id: `linkedin-upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
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
            error: error instanceof Error ? error.message : "上传失败",
          })
        }
      })
    )

    setTimeout(() => setUploadingFiles([]), 2500)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const addVideoUrl = () => {
    const value = urlInput.trim()
    if (!isPublicHttpsUrl(value)) {
      setUploadError("请输入可信 OSS/CDN 的 HTTPS 视频地址")
      return
    }
    const name = getUrlName(value)
    const id = `linkedin-url-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    setSelectedVideos((prev) => [...prev, {
      id,
      type: "url",
      name,
      url: value,
      localUrl: value,
      title: getVideoDefaultTitle({ name }, prev.length).slice(0, LINKEDIN_TITLE_MAX_CHARACTERS),
    }])
    setUrlInput("")
    setUploadError(null)
  }

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    )
  }

  const toggleAllReadyAccounts = () => {
    if (readyAccounts.length === selectedAccounts.length) {
      setSelectedAccounts([])
      return
    }
    setSelectedAccounts(readyAccounts.map((account) => account.id))
  }

  const updateVideo = (videoId: string, updates: Partial<LinkedInSelectedVideo>) => {
    setSelectedVideos((prev) => prev.map((video) => video.id === videoId ? { ...video, ...updates } : video))
  }

  const removeVideo = (videoId: string) => {
    setSelectedVideos((prev) => {
      const removed = prev.find((video) => video.id === videoId)
      if (removed?.localUrl?.startsWith("blob:")) URL.revokeObjectURL(removed.localUrl)
      return prev.filter((video) => video.id !== videoId)
    })
  }

  const generateTitle = async () => {
    setGeneratingTitle(true)
    try {
      const { response, data } = await postJsonWithTimeout("/api/linkedin/publish/generate-titles", {
        description: description || selectedVideos[0]?.title || selectedVideos[0]?.name || taskName || "LinkedIn 视频",
        videoNames: selectedVideos.map((video) => video.name),
        count: 1,
        language: "zh",
      })
      if (!response.ok || !data?.success) throw new Error(data?.error || "生成失败")
      const generated = (data.titles || []).find((item: { title?: string; combined?: string }) => item.title || item.combined)
      if (generated) {
        setTitle(generated.title || generated.combined || "")
        if (data.warning) toast({ title: "已使用本地标题", description: data.warning })
      }
    } catch (error) {
      toast({
        title: "标题生成失败",
        description: getAssistantErrorMessage(error),
        variant: "destructive",
      })
    } finally {
      setGeneratingTitle(false)
    }
  }

  const generateDescription = async () => {
    setGeneratingDescription(true)
    try {
      const { response, data } = await postJsonWithTimeout("/api/linkedin/publish/generate-description", {
        title,
        description,
        taskName,
        videoNames: selectedVideos.map((video) => video.name),
        tags,
      })
      if (!response.ok || !data?.success) throw new Error(data?.error || "生成失败")
      setDescription(data.description || "")
    } catch (error) {
      toast({
        title: "描述生成失败",
        description: getAssistantErrorMessage(error),
        variant: "destructive",
      })
    } finally {
      setGeneratingDescription(false)
    }
  }

  const createTask = async () => {
    setPublishing(true)
    setPublishError(null)

    try {
      if (publishMode === "scheduled" && (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime()))) {
        throw new Error("请选择有效的定时发布时间")
      }
      const scheduledIso = publishMode === "scheduled" ? new Date(scheduledAt).toISOString() : null

      const response = await fetch("/api/linkedin/publish/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: taskName.trim() || `LinkedIn 发布 ${format(new Date(), "MM-dd HH:mm")}`,
          videos: selectedVideos.map((video, index) => ({
            id: video.id,
            type: video.type,
            name: video.name,
            url: video.url,
            title: (video.title || title || getVideoDefaultTitle(video, index)).trim(),
            description: video.description ?? description,
          })),
          account_ids: selectedAccounts,
          title: title.trim(),
          description,
          tags,
          publish_mode: publishMode,
          scheduled_at: scheduledIso,
          batch_interval: getIntervalMinutes(intervalMode, customInterval),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "创建 LinkedIn 发布任务失败")

      toast({
        title: publishMode === "now" ? "发布任务已创建" : "定时任务已创建",
        description: `共 ${totalTasks} 个发布项`,
      })
      setSelectedVideos([])
      setSelectedAccounts([])
      setTaskName("")
      setPublishError(null)
      setActiveTab("tasks")
      setTaskRefreshSignal((value) => value + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建失败"
      setPublishError(message)
      toast({
        title: "创建失败",
        description: message,
        variant: "destructive",
      })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#0A66C2]/20 text-[#6fb4ff]">
              <Linkedin className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">领英视频发布</h1>
              <p className="mt-1 text-sm text-white/45">创建 LinkedIn 个人身份的视频发布任务</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="titanium-outline" onClick={() => router.push("/linkedin-publish/accounts")}>
              <Users className="h-4 w-4" />
              账号绑定
            </Button>
            <Button variant="titanium-outline" onClick={fetchAccounts} disabled={loadingAccounts}>
              <RefreshCw className={cn("h-4 w-4", loadingAccounts && "animate-spin")} />
              刷新账号
            </Button>
          </div>
        </div>

        <div className="flex rounded-lg border border-white/10 bg-black/30 p-1">
          {[
            { value: "create" as TabType, label: "创建任务", icon: Send },
            { value: "tasks" as TabType, label: "任务历史", icon: History },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveTab(value)}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                activeTab === value ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/75"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {activeTab === "tasks" ? (
          <LinkedInTaskManager refreshSignal={taskRefreshSignal} />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_380px]">
            <div className="space-y-6">
              <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">发布视频</h2>
                    <div className="mt-1 text-sm text-white/45">LinkedIn 发布要求视频地址来自可信 OSS/CDN HTTPS 域名。</div>
                  </div>
                  <div className="flex rounded-lg border border-white/10 bg-black/30 p-1">
                    {[
                      { value: "upload" as VideoSourceType, label: "上传", icon: Upload },
                      { value: "url" as VideoSourceType, label: "URL", icon: ExternalLink },
                    ].map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setVideoSource(value)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                          videoSource === value ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/75"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {videoSource === "upload" ? (
                  <div className="mt-4">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={LINKEDIN_VIDEO_FORMATS.join(",")}
                      multiple
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex min-h-44 w-full flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-black/25 px-4 text-center transition-colors hover:border-[#6fb4ff]/50 hover:bg-white/[0.04]"
                    >
                      <Upload className="mb-3 h-9 w-9 text-[#6fb4ff]" />
                      <div className="text-sm font-medium text-white/80">选择 LinkedIn 视频文件</div>
                      <div className="mt-1 text-xs text-white/40">最大 {formatFileSize(LINKEDIN_MAX_FILE_SIZE)}，上传后生成可信 HTTPS 地址</div>
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-3 md:flex-row">
                    <Input
                      value={urlInput}
                      onChange={(event) => setUrlInput(event.target.value)}
                      placeholder="https://media.toryxai.com/videos/example.mp4"
                      className="border-white/10 bg-black/40 text-white placeholder:text-white/30"
                    />
                    <Button variant="mermaid" onClick={addVideoUrl}>
                      <Plus className="h-4 w-4" />
                      添加视频
                    </Button>
                  </div>
                )}

                {uploadError && (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    <AlertCircle className="h-4 w-4" />
                    {uploadError}
                  </div>
                )}

                {uploadingFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {uploadingFiles.map((file) => (
                      <div key={file.id} className="rounded-md border border-white/[0.08] bg-black/25 p-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate text-white/70">{file.name}</span>
                          <span className="text-white/45">{file.status === "error" ? "失败" : `${file.progress}%`}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div className={cn("h-full rounded-full", file.status === "error" ? "bg-red-400" : "bg-[#6fb4ff]")} style={{ width: `${file.progress}%` }} />
                        </div>
                        {file.error && <div className="mt-2 text-xs text-red-300">{file.error}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {selectedVideos.length > 0 && (
                  <div className="mt-5 space-y-3">
                    {selectedVideos.map((video, index) => (
                      <div key={video.id} className="rounded-lg border border-white/[0.08] bg-black/25 p-4">
                        <div className="flex gap-3">
                          <div className="h-20 w-32 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/50">
                            {video.localUrl ? (
                              <video src={`${video.localUrl}#t=0.1`} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-white/35">
                                <FileVideo className="h-6 w-6" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{video.name}</div>
                                <div className="mt-1 truncate text-xs text-white/35">{video.url}</div>
                              </div>
                              <Button variant="ghost" size="icon" onClick={() => removeVideo(video.id)} className="h-8 w-8 text-white/45 hover:text-white">
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            <Input
                              value={video.title ?? ""}
                              onChange={(event) => updateVideo(video.id, { title: event.target.value })}
                              placeholder={`视频 ${index + 1} 标题`}
                              className="border-white/10 bg-black/40 text-white placeholder:text-white/30"
                            />
                            <Textarea
                              value={video.description ?? ""}
                              onChange={(event) => updateVideo(video.id, { description: event.target.value })}
                              placeholder="可选：单条视频描述，留空则使用全局描述"
                              className="min-h-20 border-white/10 bg-black/40 text-white placeholder:text-white/30"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">发布文案</h2>
                    <div className="mt-1 text-sm text-white/45">可使用全局文案，也可在视频列表中覆盖单条标题和描述。</div>
                  </div>
                  <Hash className="h-5 w-5 text-white/35" />
                </div>

                <div className="mt-4 grid gap-4">
                  <Input
                    value={taskName}
                    onChange={(event) => setTaskName(event.target.value)}
                    placeholder="任务名称"
                    className="border-white/10 bg-black/40 text-white placeholder:text-white/30"
                  />

                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs text-white/40">
                      <span>标题</span>
                      <span>{titleCharacterCount}/{LINKEDIN_TITLE_MAX_CHARACTERS}</span>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="LinkedIn 视频标题，支持 {n} 和 {date}"
                        className="border-white/10 bg-black/40 text-white placeholder:text-white/30"
                      />
                      <Button variant="titanium-outline" onClick={generateTitle} disabled={generatingTitle || selectedVideos.length === 0}>
                        {generatingTitle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs text-white/40">
                      <span>描述</span>
                      <span>{descriptionCharacterCount}/{LINKEDIN_DESCRIPTION_MAX_CHARACTERS}</span>
                    </div>
                    <Textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="公开视频帖正文，支持 {n} 和 {date}"
                      className="min-h-32 border-white/10 bg-black/40 text-white placeholder:text-white/30"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button variant="titanium-outline" onClick={generateDescription} disabled={generatingDescription || selectedVideos.length === 0}>
                        {generatingDescription ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        生成描述
                      </Button>
                    </div>
                  </div>

                  <Input
                    value={tagsInput}
                    onChange={(event) => setTagsInput(event.target.value)}
                    placeholder="标签，用空格或逗号分隔，例如 AI 视频, 品牌内容"
                    className="border-white/10 bg-black/40 text-white placeholder:text-white/30"
                  />

                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-[#0A66C2]/15 px-2.5 py-1 text-xs text-[#9ccfff]">#{tag}</span>
                      ))}
                    </div>
                  )}

                  {metadataErrors.length > 0 && (
                    <div className="rounded-md border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                      {metadataErrors.slice(0, 3).map((error) => (
                        <div key={error} className="flex gap-2">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{error}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <aside className="space-y-6">
              <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">发布身份</h2>
                    <div className="mt-1 text-sm text-white/45">{selectedAccounts.length}/{readyAccounts.length} 已选择</div>
                  </div>
                  <Button variant="titanium-outline" size="sm" onClick={toggleAllReadyAccounts} disabled={readyAccounts.length === 0}>
                    <Check className="h-4 w-4" />
                    全选
                  </Button>
                </div>

                <div className="mt-4 space-y-2">
                  {loadingAccounts ? (
                    <div className="flex h-32 items-center justify-center rounded-lg border border-white/10 bg-black/25">
                      <Loader2 className="h-5 w-5 animate-spin text-white/45" />
                    </div>
                  ) : readyAccounts.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => router.push("/linkedin-publish/accounts")}
                      className="flex min-h-32 w-full flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-black/25 text-center text-white/50 hover:border-[#6fb4ff]/50 hover:text-white"
                    >
                      <Users className="mb-2 h-8 w-8" />
                      去绑定 LinkedIn 账号
                    </button>
                  ) : (
                    readyAccounts.map((account) => {
                      const selected = selectedAccountSet.has(account.id)
                      return (
                        <button
                          key={account.id}
                          type="button"
                          onClick={() => toggleAccount(account.id)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                            selected ? "border-[#6fb4ff]/50 bg-[#0A66C2]/15" : "border-white/10 bg-black/25 hover:bg-white/[0.06]"
                          )}
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0A66C2]/20 text-sm font-semibold text-[#9ccfff]">
                            {account.avatar_url ? (
                              <img src={account.avatar_url} alt={account.localized_name} className="h-full w-full object-cover" />
                            ) : (
                              account.localized_name.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{account.localized_name}</div>
                            <div className="mt-0.5 text-xs text-white/40">个人身份 · {formatNumber(account.follower_count)} 粉丝</div>
                          </div>
                          <div className={cn("flex h-5 w-5 items-center justify-center rounded-full border", selected ? "border-[#6fb4ff] bg-[#6fb4ff] text-black" : "border-white/20")}>
                            {selected && <Check className="h-3 w-3" />}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-white/40" />
                  <h2 className="text-lg font-semibold">发布时间</h2>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    { value: "now" as LinkedInPublishMode, label: "立即发布" },
                    { value: "scheduled" as LinkedInPublishMode, label: "定时发布" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPublishMode(option.value)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        publishMode === option.value ? "border-[#6fb4ff]/50 bg-[#0A66C2]/15 text-white" : "border-white/10 bg-black/25 text-white/50 hover:text-white"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {publishMode === "scheduled" && (
                  <div className="mt-4">
                    <div className="mb-2 flex items-center gap-2 text-xs text-white/40">
                      <Clock className="h-3.5 w-3.5" />
                      首条发布时间
                    </div>
                    <Input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(event) => setScheduledAt(event.target.value)}
                      className="border-white/10 bg-black/40 text-white"
                    />
                  </div>
                )}

                <div className="mt-4">
                  <div className="mb-2 text-xs text-white/40">批量间隔</div>
                  <select
                    value={intervalMode}
                    onChange={(event) => setIntervalMode(event.target.value as LinkedInIntervalMode)}
                    className="h-9 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white"
                  >
                    {INTERVAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  {intervalMode === "custom" && (
                    <Input
                      type="number"
                      min={0}
                      max={1440}
                      value={customInterval}
                      onChange={(event) => setCustomInterval(Number(event.target.value))}
                      className="mt-2 border-white/10 bg-black/40 text-white"
                    />
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <div className="mb-4 flex items-center gap-2">
                  <ListFilter className="h-5 w-5 text-white/40" />
                  <h2 className="text-lg font-semibold">任务预览</h2>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-md bg-black/25 p-3">
                    <div className="text-white/35">视频</div>
                    <div className="mt-1 font-semibold">{selectedVideos.length}</div>
                  </div>
                  <div className="rounded-md bg-black/25 p-3">
                    <div className="text-white/35">身份</div>
                    <div className="mt-1 font-semibold">{selectedAccounts.length}</div>
                  </div>
                  <div className="rounded-md bg-black/25 p-3">
                    <div className="text-white/35">发布项</div>
                    <div className="mt-1 font-semibold">{totalTasks}</div>
                  </div>
                </div>

                {publishError && (
                  <div className="mt-4 rounded-md border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">
                    {publishError}
                  </div>
                )}

                <Button variant="mermaid" className="mt-5 w-full" onClick={createTask} disabled={!canPublish}>
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {publishMode === "now" ? "创建并发布" : "创建定时任务"}
                </Button>
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}

export default function LinkedInPublishPage() {
  if (!isLinkedInPublishEnabled()) {
    return <LinkedInPublishDisabledPage />
  }

  return <LinkedInPublishPageContent />
}
