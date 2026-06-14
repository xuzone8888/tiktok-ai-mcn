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
  History,
  ListFilter,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  Upload,
  X,
  Youtube,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  YOUTUBE_MAX_FILE_SIZE,
  YOUTUBE_VIDEO_FORMATS,
  type YouTubeAccount,
  type YouTubeAssetItem,
  type YouTubeFileUploadStatus,
  type YouTubeIntervalMode,
  type YouTubePublishMode,
  type YouTubePublishTask,
  type YouTubePrivacyStatus,
  type YouTubeSelectedVideo,
} from "@/types/youtube-publish"

type TabType = "create" | "tasks"
type VideoSourceType = "upload" | "asset"

const PRIVACY_OPTIONS: Array<{ value: YouTubePrivacyStatus; label: string; desc: string }> = [
  { value: "private", label: "私密", desc: "仅频道后台可见" },
  { value: "unlisted", label: "不公开", desc: "有链接的人可看" },
  { value: "public", label: "公开", desc: "所有人可见" },
]

const INTERVAL_OPTIONS: Array<{ value: YouTubeIntervalMode; label: string }> = [
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

const CONCURRENT_TRANSFER_LIMIT = 5

function formatNumber(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return String(value)
}

function parseTags(value: string) {
  return value
    .split(/[\s,，#]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30)
}

function getIntervalMinutes(mode: YouTubeIntervalMode, customInterval: number) {
  return mode === "custom" ? customInterval : Number(mode)
}

function statusLabel(status: string) {
  switch (status) {
    case "completed":
      return "已完成"
    case "partial_failed":
      return "部分失败"
    case "failed":
      return "失败"
    case "scheduled":
      return "已定时"
    case "processing":
      return "发布中"
    case "cancelled":
      return "已取消"
    default:
      return "待发布"
  }
}

function statusClass(status: string) {
  if (status === "completed") return "bg-emerald-500/10 text-emerald-300 border-emerald-400/20"
  if (status === "failed" || status === "partial_failed") return "bg-red-500/10 text-red-300 border-red-400/20"
  if (status === "scheduled") return "bg-blue-500/10 text-blue-300 border-blue-400/20"
  return "bg-amber-500/10 text-amber-300 border-amber-400/20"
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null)
  return typeof data?.error === "string" ? data.error : fallback
}

function isStorageNotConfiguredError(message: string) {
  return /Storage service not configured|存储服务未配置/i.test(message)
}

async function requestYouTubeUploadCredentials(file: File) {
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
    throw new Error("上传凭证无效")
  }

  const ossError = await readApiError(ossResponse, "获取上传凭证失败")
  if (!isStorageNotConfiguredError(ossError)) {
    throw new Error(ossError)
  }

  const localResponse = await fetch("/api/youtube/upload/local-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!localResponse.ok) {
    throw new Error(await readApiError(localResponse, "本地测试上传凭证失败"))
  }

  const localData = await localResponse.json().catch(() => null)
  if (!localData?.success || !localData?.data?.uploadUrl || !localData?.data?.publicUrl) {
    throw new Error("本地测试上传凭证无效")
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
      const canvas = document.createElement("canvas")
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext("2d")
      if (!context) {
        URL.revokeObjectURL(video.src)
        resolve("")
        return
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const thumbnail = canvas.toDataURL("image/jpeg", 0.72)
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

function YouTubeTaskManager() {
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
      if (!response.ok) throw new Error(data.error || "加载任务失败")
      setTasks(data.tasks || [])
    } catch (error) {
      toast({
        title: "加载失败",
        description: error instanceof Error ? error.message : "无法获取 YouTube 任务",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [activeStatus, dateRange, toast])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const deleteTask = async (taskId: string) => {
    if (!window.confirm("确定删除这个 YouTube 发布任务吗？已发布到 YouTube 的视频不会被删除。")) return
    setDeletingId(taskId)
    try {
      const response = await fetch(`/api/youtube/publish/tasks/${taskId}`, { method: "DELETE" })
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
                activeStatus === value ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/6 hover:text-white"
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
          <div className="text-white/70">暂无 YouTube 发布任务</div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {tasks.map((task) => (
            <div key={task.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{task.name || task.task_name || "未命名 YouTube 任务"}</h3>
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
                  <div className="text-white/35">频道</div>
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
                <div className="mt-4 max-h-52 space-y-2 overflow-y-auto pr-1">
                  {task.items.slice(0, 8).map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-white/8 bg-black/20 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate text-white/80">{item.title}</div>
                        <div className="text-xs text-white/35">{statusLabel(item.status)}</div>
                        {item.error_message && <div className="mt-1 text-xs text-red-300">{item.error_message}</div>}
                      </div>
                      {item.youtube_watch_url && (
                        <a href={item.youtube_watch_url} target="_blank" className="shrink-0 text-cyan-300 hover:text-cyan-200">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  ))}
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

export default function YouTubePublishPage() {
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState<TabType>("create")
  const [videoSource, setVideoSource] = useState<VideoSourceType>("upload")
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
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
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tagsInput, setTagsInput] = useState("")
  const [privacyStatus, setPrivacyStatus] = useState<YouTubePrivacyStatus>("private")
  const [madeForKids, setMadeForKids] = useState(false)
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState(true)
  const [notifySubscribers, setNotifySubscribers] = useState(false)
  const [publishMode, setPublishMode] = useState<YouTubePublishMode>("now")
  const [scheduledDate, setScheduledDate] = useState("")
  const [scheduledTime, setScheduledTime] = useState("")
  const [intervalMode, setIntervalMode] = useState<YouTubeIntervalMode>("5")
  const [customInterval, setCustomInterval] = useState(5)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const response = await fetch("/api/youtube/accounts")
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "加载账号失败")
      setAccounts(data.accounts || [])
    } catch (error) {
      toast({
        title: "账号加载失败",
        description: error instanceof Error ? error.message : "无法获取 YouTube 账号",
        variant: "destructive",
      })
    } finally {
      setLoadingAccounts(false)
    }
  }, [toast])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const totalTasks = selectedVideos.length * selectedAccounts.length
  const tags = useMemo(() => parseTags(tagsInput), [tagsInput])
  const canPublish =
    selectedVideos.length > 0 &&
    selectedAccounts.length > 0 &&
    !publishing &&
    (publishMode === "now" || Boolean(scheduledDate && scheduledTime))

  const updateUploadStatus = (fileId: string, updates: Partial<YouTubeFileUploadStatus>) => {
    setUploadingFiles((prev) => prev.map((file) => file.id === fileId ? { ...file, ...updates } : file))
  }

  const uploadSingleFile = async (file: File, id: string) => {
    updateUploadStatus(id, { status: "uploading", progress: 0, error: undefined })
    const thumbnailPromise = generateVideoThumbnail(file)
    const credentials = await requestYouTubeUploadCredentials(file)

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
      const ext = `.${file.name.split(".").pop()?.toLowerCase()}`
      if (!YOUTUBE_VIDEO_FORMATS.includes(ext)) {
        setUploadError(`不支持的格式: ${ext}。支持: ${YOUTUBE_VIDEO_FORMATS.join(", ")}`)
        continue
      }
      if (file.size > YOUTUBE_MAX_FILE_SIZE) {
        setUploadError(`文件过大: ${(file.size / (1024 * 1024 * 1024)).toFixed(2)}GB。最大: 4GB`)
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
            error: error instanceof Error ? error.message : "上传失败",
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
      if (!response.ok) throw new Error(data?.error || "加载视频制作区失败")

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
          title: "已过滤失效视频",
          description: `${expiredCount} 个制作区视频链接已不可访问`,
        })
      }
    } catch (error) {
      toast({
        title: "加载失败",
        description: error instanceof Error ? error.message : "无法获取视频制作区内容",
        variant: "destructive",
      })
    } finally {
      setLoadingAssets(false)
    }
  }, [toast])

  const openAssetSelector = useCallback(() => {
    setSelectedAssetIds([])
    setShowAssetModal(true)
    fetchAssets()
  }, [fetchAssets])

  const transferSingleAsset = async (asset: YouTubeAssetItem, retryCount = 0): Promise<boolean> => {
    if (!asset.resultUrl) return false
    if (selectedVideos.some((video) => video.id === asset.id)) return true

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
        const transferError = result?.error || "视频转存失败"
        if (!isStorageNotConfiguredError(transferError)) {
          throw new Error(transferError)
        }
      }

      const name = asset.prompt?.trim().slice(0, 30) || `视频 ${format(new Date(asset.createdAt), "MM/dd HH:mm")}`
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
      return true
    } catch {
      if (retryCount < 1) {
        setTransferringAssets((prev) => {
          const next = new Set(prev)
          next.delete(asset.id)
          return next
        })
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return transferSingleAsset(asset, retryCount + 1)
      }
      return false
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

    for (let index = 0; index < assetsToTransfer.length; index += CONCURRENT_TRANSFER_LIMIT) {
      const chunk = assetsToTransfer.slice(index, index + CONCURRENT_TRANSFER_LIMIT)
      const results = await Promise.all(chunk.map((asset) => transferSingleAsset(asset)))
      results.forEach((success) => {
        if (success) completed += 1
        else failed += 1
      })
      setBatchTransfer((prev) => ({ ...prev, completed, failed }))
    }

    setBatchTransfer((prev) => ({ ...prev, isTransferring: false }))

    if (failed > 0) {
      toast({
        title: "部分视频转存失败",
        description: `成功 ${completed} 个，失败 ${failed} 个`,
        variant: "destructive",
      })
    } else {
      toast({
        title: "视频已添加",
        description: `已添加 ${completed} 个视频到 YouTube 发布列表`,
      })
    }

    setShowAssetModal(false)
    setSelectedAssetIds([])
  }

  const addVideoFromAsset = async (asset: YouTubeAssetItem) => {
    if (selectedVideos.some((video) => video.id === asset.id) || transferringAssets.has(asset.id)) return
    setBatchTransfer({ isTransferring: true, total: 1, completed: 0, failed: 0 })
    const success = await transferSingleAsset(asset)
    setBatchTransfer({ isTransferring: false, total: 1, completed: success ? 1 : 0, failed: success ? 0 : 1 })

    if (success) {
      toast({ title: "视频已添加", description: "已添加到 YouTube 发布列表" })
      setShowAssetModal(false)
      setSelectedAssetIds([])
    } else {
      toast({ title: "转存失败", description: "请稍后重试", variant: "destructive" })
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

  const createPublishTask = async () => {
    if (!canPublish) {
      setPublishError("请完成视频、账号和发布时间设置")
      return
    }

    if (privacyStatus === "public" && !window.confirm("确认创建公开发布任务？未通过 YouTube API 审核的项目可能只能上传私密视频。")) {
      return
    }

    setPublishing(true)
    setPublishError(null)
    try {
      const response = await fetch("/api/youtube/publish/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: taskName,
          videos: selectedVideos,
          account_ids: selectedAccounts,
          title,
          description,
          tags,
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
      if (!response.ok) throw new Error(data?.error || "创建 YouTube 发布任务失败")

      toast({
        title: "YouTube 发布任务已创建",
        description: `共 ${totalTasks} 个发布项`,
      })
      setSelectedVideos([])
      setSelectedAccounts([])
      setTaskName("")
      setTitle("")
      setDescription("")
      setTagsInput("")
      setActiveTab("tasks")
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建 YouTube 发布任务失败"
      setPublishError(message)
      toast({ title: "创建失败", description: message, variant: "destructive" })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="min-h-full text-white">
      <div className="mx-auto max-w-7xl space-y-6 p-6 pb-40">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight md:text-3xl">
              <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
              <span className="text-white drop-shadow-lg">YouTube 视频发布</span>
            </h1>
            <p className="ml-[19px] mt-1 max-w-xl text-white/60">
              视频发布至 YouTube，支持多条内容预约发布
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => router.push("/youtube-publish/accounts")}
              className="flex min-w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 transition-all hover:border-white/20 hover:bg-white/10"
            >
              <Settings className="h-4 w-4 text-white/70" />
              <span className="text-white/80">账号管理</span>
            </button>
            <button
              onClick={fetchAccounts}
              disabled={loadingAccounts}
              className="flex min-w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 transition-all hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4 text-white/70", loadingAccounts && "animate-spin")} />
              <span className="text-white/80">刷新账号</span>
            </button>
          </div>
        </div>

        <div className="flex w-fit gap-1 rounded-xl border border-white/10 bg-black/40 p-1.5 backdrop-blur-md">
          {[
            { id: "create" as TabType, label: "创建发布", icon: Send },
            { id: "tasks" as TabType, label: "任务管理", icon: ListFilter },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "group relative flex items-center gap-2 overflow-hidden rounded-lg px-5 py-2.5 font-medium transition-all duration-300",
                activeTab === id
                  ? "bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black shadow-[0_0_20px_rgba(0,242,234,0.4)]"
                  : "text-white/50 hover:bg-white/5 hover:text-white/80"
              )}
            >
              {activeTab === id && (
                <>
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent" />
                  <div className="pointer-events-none absolute left-0 right-0 top-[10%] h-[40%] rounded-lg bg-gradient-to-b from-white/30 to-transparent" />
                </>
              )}
              <Icon className={cn("relative z-10 h-4 w-4", activeTab === id && "text-black")} />
              <span className="relative z-10">{label}</span>
            </button>
          ))}
        </div>

        {activeTab === "tasks" ? (
          <YouTubeTaskManager />
        ) : (
          <div className="space-y-6">
            <div className="space-y-6">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">1</span>
                    选择视频
                  </h2>
                  {selectedVideos.length > 0 && (
                    <Button variant="titanium-outline" size="sm" onClick={() => setSelectedVideos([])}>
                      <Trash2 className="h-4 w-4" />
                      清空
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
                    { id: "upload" as VideoSourceType, label: "本地上传", icon: Upload },
                    { id: "asset" as VideoSourceType, label: "从视频制作区选择", icon: FileVideo },
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
                            正在上传 {uploadingFiles.length} 个视频
                          </h3>
                          <p className="mt-0.5 text-xs text-gray-400">
                            {uploadingFiles.filter((file) => file.status === "done").length}/{uploadingFiles.length} 完成
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
                                {file.status === "done" ? "完成" : file.status === "error" ? "失败" : `${file.progress}%`}
                              </span>
                            </div>
                            {file.error && <div className="truncate text-[10px] text-red-300">{file.error}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
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
                            {video.type === "asset" ? "制作区" : "本地"}
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
                            删除
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
                        <span className="px-2 text-center text-xs">从视频制作区选择</span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8" />
                        <span className="px-2 text-center text-xs">
                          上传视频
                          <br />
                          <span className="text-[10px] text-gray-500">.mp4 .webm .mov</span>
                        </span>
                      </>
                    )}
                  </button>
                </div>

                {selectedVideos.length > 0 && (
                  <>
                    <p className="mt-4 text-sm text-gray-400">
                      已选择 <span className="font-semibold text-cyan-400">{selectedVideos.length}</span> 个视频
                    </p>
                    <div className="mt-5 grid gap-3">
                      {selectedVideos.map((video, index) => (
                        <div key={`${video.id}-metadata`} className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4 md:grid-cols-[180px_minmax(0,1fr)]">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white">视频 {index + 1}</div>
                            <div className="mt-1 truncate text-xs text-white/45">{video.name}</div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <Input
                              value={video.title || ""}
                              maxLength={100}
                              onChange={(event) => updateVideo(video.id, { title: event.target.value })}
                              placeholder="单独标题，留空则使用全局标题"
                              className="border-white/10 bg-black/30 text-white"
                            />
                            <Textarea
                              value={video.description || ""}
                              maxLength={5000}
                              onChange={(event) => updateVideo(video.id, { description: event.target.value })}
                              placeholder="单独描述，留空则使用全局描述"
                              className="min-h-10 border-white/10 bg-black/30 text-white md:min-h-10"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">2</span>
                    选择发布账号
                  </h2>
                  <Button variant="titanium-outline" size="sm" onClick={() => router.push("/youtube-publish/accounts")}>
                    账号管理
                  </Button>
                </div>

                {loadingAccounts ? (
                  <div className="flex h-32 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-white/45" />
                  </div>
                ) : accounts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-8 text-center">
                    <Youtube className="mx-auto mb-3 h-10 w-10 text-cyan-300/70" />
                    <div className="text-white/70">暂无可用 YouTube 频道</div>
                    <Button variant="mermaid" className="mt-5" onClick={() => router.push("/youtube-publish/accounts")}>
                      绑定 YouTube 账号
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {accounts.map((account) => {
                      const selected = selectedAccounts.includes(account.id)
                      return (
                        <button
                          key={account.id}
                          onClick={() => toggleAccount(account.id)}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border p-4 text-left transition-colors",
                            selected ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-black/20 hover:border-white/20"
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
                            <div className="mt-1 text-xs text-white/40">{formatNumber(account.subscriber_count)} 订阅 · {formatNumber(account.video_count)} 视频</div>
                          </div>
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
                <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-400">3</span>
                  发布设置
                </h2>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm text-white/60">任务组名称</label>
                    <Input value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="YouTube 发布任务组" className="border-white/10 bg-black/30 text-white" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-white/60">全局标题</label>
                    <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="支持 {n}、{date}" className="border-white/10 bg-black/30 text-white" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm text-white/60">全局描述</label>
                    <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} placeholder="YouTube 视频描述，支持 {n}、{date}" className="min-h-28 border-white/10 bg-black/30 text-white" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm text-white/60">标签</label>
                    <Input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="用逗号、空格或 # 分隔标签" className="border-white/10 bg-black/30 text-white" />
                    {tags.length > 0 && <div className="text-xs text-white/35">已识别 {tags.length} 个标签</div>}
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  <label className="text-sm text-white/60">可见范围</label>
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
                        <div className="font-medium">{option.label}</div>
                        <div className="mt-1 text-xs text-white/40">{option.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  {[
                    ["AI 合成内容", containsSyntheticMedia, setContainsSyntheticMedia],
                    ["儿童内容", madeForKids, setMadeForKids],
                    ["通知订阅者", notifySubscribers, setNotifySubscribers],
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
                    <label className="text-sm text-white/60">发布方式</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ["now", "立即发布", Clock],
                        ["scheduled", "定时发布", Calendar],
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
                    <label className="text-sm text-white/60">发布间隔</label>
                    <div className="flex gap-3">
                      <select
                        value={intervalMode}
                        onChange={(event) => setIntervalMode(event.target.value as YouTubeIntervalMode)}
                        className="h-10 flex-1 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white"
                      >
                        {INTERVAL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
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
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">视频</span>
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-2xl font-bold text-white">{selectedVideos.length}</span>
                      <span className="text-xs text-gray-500">个</span>
                    </div>
                  </div>

                  <div className="flex h-full min-w-0 items-center gap-3 rounded-xl bg-white/5 px-4 sm:rounded-none sm:border-r sm:border-white/5 sm:bg-transparent">
                    {selectedAccounts.length > 0 ? (
                      <>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">
                          {accounts.find((account) => account.id === selectedAccounts[0])?.channel_title?.charAt(0).toUpperCase() || "Y"}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">账号</span>
                          <span className="max-w-[120px] truncate text-sm font-medium text-white">
                            {accounts.find((account) => account.id === selectedAccounts[0])?.channel_title || "已选择"}
                            {selectedAccounts.length > 1 ? ` +${selectedAccounts.length - 1}` : ""}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">账号</span>
                        <span className="text-sm text-gray-400">未选择</span>
                      </div>
                    )}
                  </div>

                  <div className="hidden h-full flex-col justify-center px-5 md:flex">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">发布时间</span>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {publishMode === "now" ? (
                        <>
                          <Clock className="h-3.5 w-3.5 text-cyan-400" />
                          <span className="text-cyan-400">立即发布</span>
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
                    <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">发布设置</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                        {PRIVACY_OPTIONS.find((option) => option.value === privacyStatus)?.label}
                      </span>
                      <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-400">
                        间隔 {getIntervalMinutes(intervalMode, customInterval)} 分钟
                      </span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                        {totalTasks} 个发布项
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto] items-center gap-2 lg:flex lg:pr-1.5">
                  {publishError && (
                    <p className="col-span-2 flex items-center gap-1 text-xs text-red-400 lg:col-span-1 lg:mr-2">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{publishError}</span>
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
                    取消
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
                          <span>创建中...</span>
                        </>
                      ) : (
                        <>
                          <span>创建任务</span>
                          <Send className="h-4 w-4" />
                        </>
                      )}
                    </div>
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-400/8 p-3 text-xs leading-5 text-amber-100/70">
                YouTube 新 API 项目在审核前上传的视频可能被限制为私密状态。公开发布前需要完成 YouTube API 合规审核。
              </div>
            </div>
          </div>
        )}
      </div>

      {showAssetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[84vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#111113] shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
                  <FileVideo className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">从视频制作区选择</h3>
                  <p className="mt-0.5 text-xs text-white/40">单击多选，双击快速添加到 YouTube 发布列表</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="titanium-outline" size="sm" onClick={fetchAssets} disabled={loadingAssets || batchTransfer.isTransferring}>
                  <RefreshCw className={cn("h-4 w-4", loadingAssets && "animate-spin")} />
                  刷新
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
                <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-white/12 bg-black/20 text-center">
                  <FileVideo className="mb-3 h-12 w-12 text-white/25" />
                  <div className="font-medium text-white/70">暂无可选视频</div>
                  <div className="mt-1 text-sm text-white/35">视频制作区完成的视频会出现在这里</div>
                  <Button variant="titanium-outline" className="mt-5" onClick={() => router.push("/assets")}>
                    查看素材
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
                          <img src={asset.thumbnailUrl} alt={asset.prompt || "视频"} className="absolute inset-0 h-full w-full object-cover" />
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
                          <div className="truncate text-sm font-medium">{asset.prompt || "未命名视频"}</div>
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
                            已添加
                          </div>
                        )}

                        {transferring && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75">
                            <Loader2 className="mb-2 h-7 w-7 animate-spin text-cyan-300" />
                            <span className="text-xs text-cyan-100">转存中</span>
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
                  <span className="text-cyan-100">正在转存 {batchTransfer.completed + batchTransfer.failed}/{batchTransfer.total}</span>
                  {batchTransfer.failed > 0 && <span className="text-red-300">失败 {batchTransfer.failed}</span>}
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
                已选 <span className="font-semibold text-cyan-200">{selectedAssetIds.length}</span> 个
                {selectedVideos.some((video) => video.type === "asset") && (
                  <span className="ml-3 text-white/30">
                    已添加 {selectedVideos.filter((video) => video.type === "asset").length} 个制作区视频
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
                  取消
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
                  确认添加 {selectedAssetIds.length > 0 ? `(${selectedAssetIds.length})` : ""}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
