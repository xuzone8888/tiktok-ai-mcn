'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
    Rocket,
    Video,
    Upload,
    Check,
    Plus,
    Clock,
    AlertCircle,
    Settings,
    Users,
    Calendar,
    Play,
    Trash2,
    RefreshCw,
    Send,
    CheckCircle2,
    XCircle,
    Loader2,
    X,
    FileVideo,
    Timer,
    History,
    ImageIcon,
    Sliders,
    Sparkles,
    ListFilter,
    Globe2,
    Lock,
    UserCheck,
    Hash,
    Zap,
    MessageCircle,
    Repeat2,
    Scissors,
    ShieldCheck,
    ExternalLink,
    Info,
    ChevronDown
} from 'lucide-react'
import { format, addMinutes } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useToast } from '@/hooks/use-toast'
import { TaskManager } from '@/components/publish/TaskManager'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter, // Make sure to export Footer if available, otherwise just use div
} from "@/components/ui/dialog"

// TikTok supported video formats
const TIKTOK_VIDEO_FORMATS = ['.mp4', '.webm', '.mov']
const TIKTOK_MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024 // 4GB
const TIKTOK_MAX_DURATION = 10 * 60 * 1000 // 10 minutes in ms

// Asset from delivery order
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

// Types
interface TikTokAccount {
    id: string
    open_id: string
    display_name: string
    avatar_url: string | null
    follower_count: number
    following_count: number
    likes_count: number
    video_count: number
    account_type: string
    status: string
    token_expires_at: string
    scopes: string[]
}

interface SelectedVideo {
    id: string
    type: 'asset' | 'upload' | 'url'
    name: string
    thumbnail: string
    url?: string
    localUrl?: string        // Local blob URL for frame capture (avoids CORS issues)
    duration?: number
    cover?: string           // Custom cover image URL or data URL
    coverTimestampMs?: number  // Cover frame timestamp in milliseconds
    title?: string           // Individual title for this video
    coverOptions?: string[]  // Auto-generated cover options at different time points
}

interface PublishTask {
    id: string
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'scheduled' | 'partial_failed'
    video_count: number
    account_count: number
    total_items: number
    completed_items: number
    failed_items: number
    created_at: string
    scheduled_at: string | null
}

interface FileUploadStatus {
    id: string
    name: string
    progress: number  // 0-100
    status: 'pending' | 'uploading' | 'done' | 'error'
    error?: string
}

type TabType = 'create' | 'tasks'
type VideoSourceType = 'upload' | 'asset'  // Only support local upload and asset library

export default function PublishPage() {
    console.log('[PublishPage] v2024.01.31-A - Component loaded')
    const router = useRouter()
    const { toast } = useToast()
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Tab state
    const [activeTab, setActiveTab] = useState<TabType>('create')

    // Create publish form state
    const [videoSource, setVideoSource] = useState<VideoSourceType>('upload')  // Default to local upload
    const [selectedVideos, setSelectedVideos] = useState<SelectedVideo[]>([])
    const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
    const [accounts, setAccounts] = useState<TikTokAccount[]>([])
    const [loadingAccounts, setLoadingAccounts] = useState(true)

    // Publish settings
    const [caption, setCaption] = useState('')
    const [taskGroupName, setTaskGroupName] = useState('')  // Task group name for tracking
    const [useDefaultCover, setUseDefaultCover] = useState(true)  // Use video first frame as cover (default ON)

    // Schedule settings
    const [publishMode, setPublishMode] = useState<'now' | 'scheduled'>('now')
    const [scheduledDate, setScheduledDate] = useState('')
    const [scheduledTime, setScheduledTime] = useState('09:00')
    // Interval mode: preset values or custom (all in minutes)
    const [intervalMode, setIntervalMode] = useState<'0' | '3' | '5' | '10' | '30' | '60' | '120' | '360' | '720' | '1440' | 'custom'>('5')
    const [customInterval, setCustomInterval] = useState(5)

    // Task creation modal states
    const [showCreatingModal, setShowCreatingModal] = useState(false)
    const [creatingStep, setCreatingStep] = useState<'verifying' | 'creating' | 'done' | 'error'>('verifying')
    const [createdTaskId, setCreatedTaskId] = useState<string | null>(null)

    // Publishing state
    const [isPublishing, setIsPublishing] = useState(false)
    const [publishError, setPublishError] = useState<string | null>(null)

    // Asset library state (成品库)
    const [showAssetModal, setShowAssetModal] = useState(false)
    const [assets, setAssets] = useState<AssetItem[]>([])
    const [loadingAssets, setLoadingAssets] = useState(false)
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])  // Multi-select in asset library

    // Batch transfer state (for controlled concurrency)
    const [batchTransfer, setBatchTransfer] = useState<{
        isTransferring: boolean
        total: number
        completed: number
        failed: number
        currentBatch: string[]
    }>({
        isTransferring: false,
        total: 0,
        completed: 0,
        failed: 0,
        currentBatch: []
    })

    // Upload state - tracks each file's upload progress
    const [uploadingFiles, setUploadingFiles] = useState<FileUploadStatus[]>([])
    const [uploadError, setUploadError] = useState<string | null>(null)

    // Title mode: 'uniform' = same title for all, 'individual' = different titles per video
    const [titleMode, setTitleMode] = useState<'uniform' | 'individual'>('uniform')

    // Privacy level for TikTok publishing — 初始为 null（无默认值，TikTok 审核要求）
    const [privacyLevel, setPrivacyLevel] = useState<string | null>(null)

    // AI generated content flag (default ON - ToryX 是 AI 创作工具，所有内容默认标记 AI 生成)
    const [isAiGenerated, setIsAiGenerated] = useState(true)

    // ===== TikTok 审核合规 - Creator Info 数据层 =====
    interface CreatorInfoData {
        avatar_url: string
        username: string
        nickname: string
        privacy_level_options: string[]
        comment_disabled: boolean
        duet_disabled: boolean
        stitch_disabled: boolean
        max_video_post_duration_sec: number
    }
    const [creatorInfo, setCreatorInfo] = useState<CreatorInfoData | null>(null)
    const [creatorInfoLoading, setCreatorInfoLoading] = useState(false)
    const [creatorInfoError, setCreatorInfoError] = useState<string | null>(null)

    // 互动开关 — 默认全部关闭（TikTok 审核要求：默认 unchecked）
    const [allowComment, setAllowComment] = useState(false)
    const [allowDuet, setAllowDuet] = useState(false)
    const [allowStitch, setAllowStitch] = useState(false)

    // 商业内容披露
    const [contentDisclosure, setContentDisclosure] = useState(false)
    const [yourBrand, setYourBrand] = useState(false)
    const [brandedContent, setBrandedContent] = useState(false)

    // Expanded video for editing (shows cover options inline)
    const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null)

    // Cover selection state (simplified)
    const coverInputRef = useRef<HTMLInputElement>(null)
    const [coverUploadVideoId, setCoverUploadVideoId] = useState<string | null>(null)

    // Video blob URL cache for cover selection (remote videos need to be downloaded first)
    const [videoBlobCache, setVideoBlobCache] = useState<Record<string, string>>({})
    const [loadingVideoBlob, setLoadingVideoBlob] = useState(false)

    // Clear task confirmation
    const [showClearConfirm, setShowClearConfirm] = useState(false)

    // Clear all task function
    const clearAllTask = () => {
        setSelectedVideos([])
        setSelectedAccounts([])
        setCaption('')
        setTaskGroupName('')
        setPublishMode('now')
        setScheduledDate('')
        setScheduledTime('09:00')
        setExpandedVideoId(null)
        setShowClearConfirm(false)
        // 重置审核合规相关 state
        setPrivacyLevel(null)
        setAllowComment(false)
        setAllowDuet(false)
        setAllowStitch(false)
        setContentDisclosure(false)
        setYourBrand(false)
        setBrandedContent(false)
        setCreatorInfo(null)
        setCreatorInfoError(null)
    }

    // AI Title Assistant state
    const [showTitleAssistant, setShowTitleAssistant] = useState(false)
    const [titleDescription, setTitleDescription] = useState('')
    const [titleLanguage, setTitleLanguage] = useState<'zh' | 'en'>('en')
    const [generatedTitles, setGeneratedTitles] = useState<{
        index: number
        content: string
        selected: boolean
    }[]>([])
    const [generatingTitles, setGeneratingTitles] = useState(false)
    const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)
    const fetchAccounts = useCallback(async () => {
        setLoadingAccounts(true)
        try {
            const response = await fetch('/api/publish/accounts')
            if (response.ok) {
                const data = await response.json()
                setAccounts(data.accounts || [])
            }
        } catch (error) {
            console.error('Failed to fetch accounts:', error)
        } finally {
            setLoadingAccounts(false)
        }
    }, [])



    useEffect(() => {
        fetchAccounts()
    }, [fetchAccounts])

    // Check if account is authorized
    const isAccountAuthorized = (account: TikTokAccount) => {
        return new Date(account.token_expires_at) > new Date()
    }

    // Toggle account selection (single select mode - only one account at a time)
    const toggleAccountSelection = (accountId: string) => {
        // Single select: if already selected, deselect; otherwise select only this one
        setSelectedAccounts(prev =>
            prev.includes(accountId) ? [] : [accountId]
        )
    }

    // Remove selected video
    const removeVideo = (videoId: string) => {
        setSelectedVideos(prev => prev.filter(v => v.id !== videoId))
    }

    // Calculate total tasks
    const totalTasks = selectedVideos.length * selectedAccounts.length

    // Check if video URL is still accessible (using server-side API for accurate detection)
    const checkUrlAccessible = async (url: string): Promise<boolean> => {
        try {
            const response = await fetch('/api/upload/check-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            })
            const result = await response.json()
            return result.accessible === true
        } catch {
            // API error, assume URL is not accessible
            return false
        }
    }

    // Delete expired video from database
    const deleteExpiredTask = async (taskId: string) => {
        try {
            await fetch(`/api/user/tasks/${taskId}`, {
                method: 'DELETE',
            })
            console.log(`[Assets] Deleted expired task: ${taskId}`)
        } catch (error) {
            console.error(`[Assets] Failed to delete task ${taskId}:`, error)
        }
    }

    // Fetch assets from delivery order (成品交付单)
    const fetchAssets = useCallback(async () => {
        setLoadingAssets(true)
        try {
            const response = await fetch('/api/user/tasks?type=video&status=completed&limit=50')
            if (response.ok) {
                const result = await response.json()
                // API returns { success: true, data: { tasks: [...] } }
                const tasks = result.data?.tasks || result.tasks || []
                const videoTasks = tasks.filter((t: AssetItem) => t.type === 'video' && t.resultUrl)

                // Check URL accessibility in parallel for better performance
                const accessibilityChecks = await Promise.all(
                    videoTasks.map(async (task: AssetItem) => {
                        const isAccessible = await checkUrlAccessible(task.resultUrl!)
                        return { task, isAccessible }
                    })
                )

                // Separate valid and expired videos
                const validVideos: AssetItem[] = []
                const expiredVideos: AssetItem[] = []

                accessibilityChecks.forEach(({ task, isAccessible }) => {
                    if (isAccessible) {
                        validVideos.push(task)
                    } else {
                        expiredVideos.push(task)
                    }
                })

                // Delete expired videos from database (async, don't wait)
                if (expiredVideos.length > 0) {
                    console.log(`[Assets] Deleting ${expiredVideos.length} expired videos`)
                    toast({
                        title: '清理过期视频',
                        description: `正在删除 ${expiredVideos.length} 个已过期的视频...`,
                    })

                    // Delete in background
                    Promise.all(expiredVideos.map(v => deleteExpiredTask(v.id)))
                        .then(() => {
                            toast({
                                title: '清理完成',
                                description: `已删除 ${expiredVideos.length} 个过期视频`,
                            })
                        })
                }

                setAssets(validVideos)
            }
        } catch (error) {
            console.error('Failed to fetch assets:', error)
        } finally {
            setLoadingAssets(false)
        }
    }, [toast])

    // Open asset selector modal
    const openAssetSelector = () => {
        setShowAssetModal(true)
        fetchAssets()
    }

    // Add video from asset library - transfer to OSS first for permanent storage
    const [transferringAssets, setTransferringAssets] = useState<Set<string>>(new Set())

    // Concurrent transfer limit - increased to 5 with stream-based transfer (minimal memory usage)
    const CONCURRENT_TRANSFER_LIMIT = 5

    // Single asset transfer with 1 retry
    const transferSingleAsset = async (asset: AssetItem, retryCount = 0): Promise<boolean> => {
        if (selectedVideos.some(v => v.id === asset.id)) return true // Already added

        setTransferringAssets(prev => new Set(prev).add(asset.id))

        try {
            const response = await fetch('/api/upload/transfer-to-oss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceUrl: asset.resultUrl,
                    filename: asset.prompt?.slice(0, 30) || 'video'
                })
            })

            const result = await response.json()

            if (!result.success || !result.data?.url) {
                throw new Error(result.error || '视频转存失败')
            }

            const newVideo: SelectedVideo = {
                id: asset.id,
                type: 'asset',
                name: asset.prompt?.slice(0, 30) || `视频 ${format(new Date(asset.createdAt), 'MM/dd HH:mm')}`,
                thumbnail: asset.thumbnailUrl || '',
                url: result.data.url,
                localUrl: result.data.url,
                duration: 30
            }
            setSelectedVideos(prev => [...prev, newVideo])
            return true
        } catch (error) {
            console.error('Transfer asset failed:', error)

            // Retry once on failure
            if (retryCount < 1) {
                console.log('[Transfer] Retrying:', asset.id)
                setTransferringAssets(prev => {
                    const next = new Set(prev)
                    next.delete(asset.id)
                    return next
                })
                await new Promise(r => setTimeout(r, 1000)) // Wait 1s before retry
                return transferSingleAsset(asset, retryCount + 1)
            }

            return false
        } finally {
            setTransferringAssets(prev => {
                const next = new Set(prev)
                next.delete(asset.id)
                return next
            })
        }
    }

    // Batch transfer with controlled concurrency
    const startBatchTransfer = async (assetIds: string[]) => {
        const assetsToTransfer = assetIds
            .map(id => assets.find(a => a.id === id))
            .filter((a): a is AssetItem => !!a && !selectedVideos.some(v => v.id === a.id))

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
            currentBatch: []
        })

        let completed = 0
        let failed = 0

        // Process in chunks of CONCURRENT_TRANSFER_LIMIT
        for (let i = 0; i < assetsToTransfer.length; i += CONCURRENT_TRANSFER_LIMIT) {
            const chunk = assetsToTransfer.slice(i, i + CONCURRENT_TRANSFER_LIMIT)
            const chunkIds = chunk.map(a => a.id)

            setBatchTransfer(prev => ({ ...prev, currentBatch: chunkIds }))

            // Process chunk in parallel
            const results = await Promise.all(chunk.map(asset => transferSingleAsset(asset)))

            // Update counts
            results.forEach(success => {
                if (success) completed++
                else failed++
            })

            setBatchTransfer(prev => ({
                ...prev,
                completed,
                failed,
            }))
        }

        // All done
        setBatchTransfer(prev => ({ ...prev, isTransferring: false, currentBatch: [] }))

        // Show summary toast
        if (failed > 0) {
            toast({
                variant: 'destructive',
                title: '批量转存完成',
                description: `成功 ${completed} 个，失败 ${failed} 个`,
            })
        } else {
            toast({
                title: '✅ 批量转存完成',
                description: `已添加 ${completed} 个视频到发布列表`,
            })
        }

        setShowAssetModal(false)
        setSelectedAssetIds([])
    }

    // Legacy single add (for double-click)
    const addVideoFromAsset = async (asset: AssetItem) => {
        if (selectedVideos.some(v => v.id === asset.id)) return
        if (transferringAssets.has(asset.id)) return

        setBatchTransfer({ isTransferring: true, total: 1, completed: 0, failed: 0, currentBatch: [asset.id] })

        const success = await transferSingleAsset(asset)

        setBatchTransfer({ isTransferring: false, total: 1, completed: success ? 1 : 0, failed: success ? 0 : 1, currentBatch: [] })

        if (success) {
            toast({ title: '✅ 视频已转存', description: `已添加到发布列表` })
            setShowAssetModal(false)
            setSelectedAssetIds([])
        } else {
            toast({ variant: 'destructive', title: '转存失败', description: '请重试' })
        }
    }

    // Generate video thumbnail from first frame
    const generateVideoThumbnail = (videoFile: File): Promise<string> => {
        return new Promise((resolve) => {
            const video = document.createElement('video')
            video.preload = 'metadata'
            video.muted = true
            video.playsInline = true

            video.onloadeddata = () => {
                // Seek to 1 second or 0 if video is shorter
                video.currentTime = Math.min(1, video.duration / 2)
            }

            video.onseeked = () => {
                const canvas = document.createElement('canvas')
                canvas.width = video.videoWidth
                canvas.height = video.videoHeight
                const ctx = canvas.getContext('2d')
                if (ctx) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                    const thumbnail = canvas.toDataURL('image/jpeg', 0.7)
                    URL.revokeObjectURL(video.src)
                    resolve(thumbnail)
                } else {
                    URL.revokeObjectURL(video.src)
                    resolve('')
                }
            }

            video.onerror = () => {
                URL.revokeObjectURL(video.src)
                resolve('')
            }

            video.src = URL.createObjectURL(videoFile)
        })
    }

    // Handle local file upload - uploads to OSS and gets public URL
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files
        if (!files || files.length === 0) return

        setUploadError(null)
        const fileList = Array.from(files)

        // Validate all files first
        const validFiles: { file: File; id: string }[] = []
        for (const file of fileList) {
            const ext = '.' + file.name.split('.').pop()?.toLowerCase()
            if (!TIKTOK_VIDEO_FORMATS.includes(ext)) {
                setUploadError(`不支持的格式: ${ext}。TikTok支持: ${TIKTOK_VIDEO_FORMATS.join(', ')}`)
                continue
            }
            if (file.size > TIKTOK_MAX_FILE_SIZE) {
                setUploadError(`文件过大: ${(file.size / (1024 * 1024 * 1024)).toFixed(2)}GB。最大: 4GB`)
                continue
            }
            validFiles.push({
                file,
                id: `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            })
        }

        if (validFiles.length === 0) return

        // Initialize all files as pending
        const initialStatus: FileUploadStatus[] = validFiles.map(({ file, id }) => ({
            id,
            name: file.name,
            progress: 0,
            status: 'pending' as const
        }))
        setUploadingFiles(initialStatus)

        // Helper to update a single file's status
        const updateFileStatus = (fileId: string, updates: Partial<FileUploadStatus>) => {
            setUploadingFiles(prev => prev.map(f =>
                f.id === fileId ? { ...f, ...updates } : f
            ))
        }

        // Upload single file directly to OSS with retry logic
        const uploadSingleFile = async ({ file, id }: { file: File; id: string }) => {
            const MAX_RETRIES = 2
            let lastError: Error | null = null

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                updateFileStatus(id, { status: 'uploading', progress: 0, error: undefined })

                try {
                    // Generate thumbnail while preparing upload (only on first attempt)
                    const thumbnailPromise = attempt === 1 ? generateVideoThumbnail(file) : Promise.resolve('')

                    // Step 1: Get presigned upload URL from server
                    updateFileStatus(id, { progress: 5 })
                    const credentialsRes = await fetch('/api/upload/oss-credentials', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            filename: file.name,
                            contentType: file.type || 'video/mp4'
                        })
                    })

                    if (!credentialsRes.ok) {
                        const errData = await credentialsRes.json().catch(() => ({}))
                        throw new Error(errData.error || '获取上传凭证失败')
                    }

                    const { success, data: credentials } = await credentialsRes.json()
                    if (!success || !credentials?.uploadUrl) {
                        throw new Error('获取上传凭证失败')
                    }

                    // Step 2: Upload directly to OSS using presigned URL
                    const ossUrl = await new Promise<string>((resolve, reject) => {
                        const xhr = new XMLHttpRequest()

                        // Track upload progress (10-95%) with throttle
                        let lastReportedProgress = 10
                        xhr.upload.onprogress = (event) => {
                            if (event.lengthComputable) {
                                // Map 0-100% to 10-95% (leave room for completion steps)
                                const percent = Math.round(10 + (event.loaded / event.total) * 85)
                                if (percent >= lastReportedProgress + 5 || percent >= 95) {
                                    lastReportedProgress = percent
                                    updateFileStatus(id, { progress: percent })
                                }
                            }
                        }

                        xhr.onload = () => {
                            // OSS returns 200 on success for PUT
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve(credentials.publicUrl)
                            } else {
                                reject(new Error(`OSS上传失败 (${xhr.status})`))
                            }
                        }

                        xhr.onerror = () => reject(new Error('网络错误'))
                        xhr.ontimeout = () => reject(new Error('上传超时'))

                        // PUT file directly to OSS
                        xhr.open('PUT', credentials.uploadUrl)
                        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
                        xhr.timeout = 600000 // 10 minutes for large files
                        xhr.send(file)
                    })

                    updateFileStatus(id, { progress: 98 })

                    // Wait for thumbnail
                    const thumbnail = await thumbnailPromise

                    // Create video entry with OSS URL and local blob URL for frame capture
                    const localBlobUrl = URL.createObjectURL(file)
                    const newVideo: SelectedVideo = {
                        id,
                        type: 'upload',
                        name: file.name,
                        thumbnail: thumbnail || '',
                        url: ossUrl,
                        localUrl: localBlobUrl,
                        duration: 0
                    }
                    setSelectedVideos(prev => [...prev, newVideo])

                    updateFileStatus(id, { status: 'done', progress: 100 })
                    return // Success, exit retry loop

                } catch (error) {
                    lastError = error instanceof Error ? error : new Error('上传失败')
                    console.error(`Video upload error (attempt ${attempt}/${MAX_RETRIES}):`, error)

                    if (attempt < MAX_RETRIES) {
                        updateFileStatus(id, { progress: 0, error: `重试中 (${attempt}/${MAX_RETRIES})...` })
                        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
                    }
                }
            }

            // All retries failed
            updateFileStatus(id, {
                status: 'error',
                progress: 0,
                error: lastError?.message || '上传失败'
            })
        }

        // ✅ True concurrent upload - all files at once!
        // Browser uploads directly to OSS, no server bottleneck
        await Promise.all(validFiles.map(uploadSingleFile))

        // Clear upload status after delay
        setTimeout(() => {
            setUploadingFiles([])
        }, 2000)

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }




    // Generate cover options from video at different time points
    const generateCoverOptions = async (videoUrl: string): Promise<string[]> => {
        return new Promise((resolve) => {
            const video = document.createElement('video')
            video.crossOrigin = 'anonymous'
            video.src = videoUrl
            video.muted = true
            video.playsInline = true

            const covers: string[] = []
            const timePoints = [0.1, 0.25, 0.5, 0.75] // 10%, 25%, 50%, 75% of duration

            video.onloadedmetadata = () => {
                let currentIndex = 0

                const captureFrame = () => {
                    if (currentIndex >= timePoints.length) {
                        resolve(covers)
                        return
                    }

                    video.currentTime = video.duration * timePoints[currentIndex]
                }

                video.onseeked = () => {
                    const canvas = document.createElement('canvas')
                    canvas.width = video.videoWidth
                    canvas.height = video.videoHeight
                    const ctx = canvas.getContext('2d')
                    if (ctx) {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                        covers.push(canvas.toDataURL('image/jpeg', 0.7))
                    }
                    currentIndex++
                    captureFrame()
                }

                captureFrame()
            }

            video.onerror = () => resolve([])
        })
    }

    // Handle custom cover upload
    const handleCoverUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file || !coverUploadVideoId) return

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('请上传图片文件')
            return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string
            updateVideoCover(coverUploadVideoId, dataUrl)
            setCoverUploadVideoId(null)
        }
        reader.readAsDataURL(file)

        // Reset input
        if (coverInputRef.current) {
            coverInputRef.current.value = ''
        }
    }

    // Update a video's cover
    const updateVideoCover = (videoId: string, coverDataUrl: string, timestampMs?: number) => {
        setSelectedVideos(prev => prev.map(v =>
            v.id === videoId ? { ...v, cover: coverDataUrl, coverTimestampMs: timestampMs } : v
        ))
    }

    // Update a video's title
    const updateVideoTitle = (videoId: string, title: string) => {
        setSelectedVideos(prev => prev.map(v =>
            v.id === videoId ? { ...v, title } : v
        ))
    }

    // Toggle expanded video for inline editing
    const toggleVideoExpanded = async (videoId: string) => {
        if (expandedVideoId === videoId) {
            setExpandedVideoId(null)
        } else {
            const video = selectedVideos.find(v => v.id === videoId)
            if (!video?.url) return

            // For remote OSS videos, generate a proxy URL that returns correct headers
            // This avoids the Content-Disposition: attachment issue
            const isLocalUrl = video.localUrl?.startsWith('blob:')
            const hasProxyUrl = videoBlobCache[videoId]

            if (!isLocalUrl && !hasProxyUrl && video.url.includes('media.toryxai.com')) {
                // Generate proxy URL for OSS videos
                const proxyUrl = `/api/proxy/video?url=${encodeURIComponent(video.url)}`
                setVideoBlobCache(prev => ({ ...prev, [videoId]: proxyUrl }))
                console.log('[Cover] Using proxy URL for OSS video')
            }

            setExpandedVideoId(videoId)
            // Generate cover options if not already generated
            if (video.url && (!video.coverOptions || video.coverOptions.length === 0)) {
                const options = await generateCoverOptions(video.url)
                setSelectedVideos(prev => prev.map(v =>
                    v.id === videoId ? { ...v, coverOptions: options } : v
                ))
            }
        }
    }

    // =========================================================================
    // AI Title Assistant Functions
    // =========================================================================

    // Generate all titles
    const generateAllTitles = async () => {
        if (!titleDescription.trim()) return
        if (selectedVideos.length === 0) return

        setGeneratingTitles(true)
        try {
            const response = await fetch('/api/publish/generate-titles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: titleDescription,
                    count: selectedVideos.length,
                    language: titleLanguage
                })
            })

            const data = await response.json()

            if (data.success && data.titles) {
                setGeneratedTitles(data.titles.map((t: { index: number; combined: string }) => ({
                    index: t.index,
                    content: t.combined,
                    selected: true
                })))
            } else {
                alert(data.error || '生成失败，请重试')
            }
        } catch (error) {
            console.error('Generate titles error:', error)
            alert('生成失败，请检查网络连接')
        } finally {
            setGeneratingTitles(false)
        }
    }

    // Regenerate single title
    const regenerateSingleTitle = async (index: number) => {
        if (!titleDescription.trim()) return

        setRegeneratingIndex(index)
        try {
            // Get existing titles to avoid duplicates
            const existingTitles = generatedTitles
                .filter((_, i) => i !== index)
                .map(t => t.content)

            const response = await fetch('/api/publish/generate-titles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: titleDescription,
                    count: 1,
                    language: titleLanguage,
                    regenerateIndex: index,
                    existingTitles
                })
            })

            const data = await response.json()

            if (data.success && data.titles?.[0]) {
                setGeneratedTitles(prev => prev.map((t, i) =>
                    i === index ? { ...t, content: data.titles[0].combined, selected: true } : t
                ))
            } else {
                alert(data.error || '重新生成失败')
            }
        } catch (error) {
            console.error('Regenerate title error:', error)
        } finally {
            setRegeneratingIndex(null)
        }
    }

    // Toggle title selection
    const toggleTitleSelection = (index: number) => {
        setGeneratedTitles(prev => prev.map((t, i) =>
            i === index ? { ...t, selected: !t.selected } : t
        ))
    }

    // Update title content (manual edit)
    const updateTitleContent = (index: number, content: string) => {
        setGeneratedTitles(prev => prev.map((t, i) =>
            i === index ? { ...t, content } : t
        ))
    }

    // Apply selected titles to videos
    const applySelectedTitles = () => {
        generatedTitles.forEach((title, index) => {
            if (title.selected && selectedVideos[index]) {
                updateVideoTitle(selectedVideos[index].id, title.content)
            }
        })
        setShowTitleAssistant(false)
        setGeneratedTitles([])
        // Switch to individual title mode to show the results
        setTitleMode('individual')
    }

    // ===== 获取 Creator Info（选择账号后自动调用）=====
    const fetchCreatorInfo = useCallback(async (accountId: string) => {
        setCreatorInfoLoading(true)
        setCreatorInfoError(null)
        setCreatorInfo(null)
        // 重置依赖 creator_info 的状态
        setPrivacyLevel(null)
        setAllowComment(false)
        setAllowDuet(false)
        setAllowStitch(false)

        try {
            const res = await fetch(`/api/publish/creator-info?account_id=${accountId}`)
            const data = await res.json()
            if (!res.ok || !data.success) {
                throw new Error(data.error || '获取创作者信息失败')
            }
            setCreatorInfo(data.data)
        } catch (error) {
            const msg = error instanceof Error ? error.message : '获取创作者信息失败'
            setCreatorInfoError(msg)
            console.error('[CreatorInfo] Error:', error)
        } finally {
            setCreatorInfoLoading(false)
        }
    }, [])

    // 账号选择变化时自动获取 creator_info
    useEffect(() => {
        if (selectedAccounts.length === 1) {
            fetchCreatorInfo(selectedAccounts[0])
        } else {
            setCreatorInfo(null)
            setCreatorInfoError(null)
        }
    }, [selectedAccounts, fetchCreatorInfo])

    // ===== 发布前校验 =====
    // 商业披露开但未选子选项 → 禁用发布
    const disclosureIncomplete = contentDisclosure && !yourBrand && !brandedContent
    // Branded Content + SELF_ONLY 冲突
    const brandedPrivacyConflict = brandedContent && privacyLevel === 'SELF_ONLY'
    // 1.8 视频时长校验：检查是否有视频超过 creator 允许的最大时长
    const maxDurationSec = creatorInfo?.max_video_post_duration_sec || 0
    const overDuration = maxDurationSec > 0 && selectedVideos.some(v => 
        v.duration && (v.duration / 1000) > maxDurationSec
    )
    // 发布按钮是否可用
    const canPublish = selectedVideos.length > 0 
        && selectedAccounts.length > 0 
        && privacyLevel !== null 
        && !disclosureIncomplete 
        && !brandedPrivacyConflict 
        && !overDuration
        && !isPublishing

    // Handle publish
    const handlePublish = async () => {
        if (selectedVideos.length === 0) {
            setPublishError('请至少选择一个视频')
            return
        }
        if (selectedAccounts.length === 0) {
            setPublishError('请至少选择一个发布账号')
            return
        }
        if (!privacyLevel) {
            setPublishError('请选择可见范围')
            return
        }
        if (disclosureIncomplete) {
            setPublishError('请选择商业披露类型')
            return
        }
        if (brandedPrivacyConflict) {
            setPublishError('品牌合作内容不能设为仅自己可见')
            return
        }
        if (overDuration) {
            setPublishError(`视频时长超过该账号允许的最大时长 (${maxDurationSec}秒)`)
            return
        }

        setIsPublishing(true)
        setPublishError(null)

        try {
            const response = await fetch('/api/publish/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: taskGroupName,
                    videos: selectedVideos,
                    account_ids: selectedAccounts,
                    caption,
                    // TikTok 审核合规字段
                    privacy_level: privacyLevel,
                    allow_comment: allowComment,
                    allow_duet: allowDuet,
                    allow_stitch: allowStitch,
                    brand_content_toggle: brandedContent,
                    brand_organic_toggle: yourBrand,
                    is_ai_generated: isAiGenerated,
                    publish_mode: publishMode,
                    scheduled_at: publishMode === 'scheduled'
                        ? new Date(`${scheduledDate}T${scheduledTime}`).toISOString()
                        : null,
                    batch_interval: intervalMode === 'custom' ? customInterval : parseInt(intervalMode)
                })
            })

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.error || '创建发布任务失败')
            }

            // Success - reset form and switch to history tab
            setSelectedVideos([])
            setSelectedAccounts([])
            setCaption('')
            setPrivacyLevel(null)
            setAllowComment(false)
            setAllowDuet(false)
            setAllowStitch(false)
            setContentDisclosure(false)
            setYourBrand(false)
            setBrandedContent(false)
            setCreatorInfo(null)
            setActiveTab('tasks')
        } catch (error) {
            setPublishError(error instanceof Error ? error.message : '创建发布任务失败')
        } finally {
            setIsPublishing(false)
        }
    }

    return (
        <div className="space-y-6 p-6 max-w-7xl mx-auto min-h-full pb-20">
            {/* Header - JCUI 2.0 Titanium Bar */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
                        <span className="text-white drop-shadow-lg">TikTok 视频发布</span>
                    </h1>
                    <p className="mt-1 text-white/60 ml-[19px]">
                        一键发布至多平台，智能调度分发任务
                    </p>
                </div>

                <button
                    onClick={() => router.push('/publish/accounts')}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all"
                >
                    <Settings className="w-4 h-4 text-white/70" />
                    <span className="text-white/80">账号管理</span>
                </button>
            </div>

            {/* Tabs - JCUI 2.0 Fluid Segmented Controls with Holographic Gradient */}
            <div className="flex gap-1 p-1.5 bg-black/40 rounded-xl border border-white/10 w-fit backdrop-blur-md">
                {[
                    { id: 'create' as TabType, label: '创建发布', icon: Send },
                    { id: 'tasks' as TabType, label: '任务管理', icon: ListFilter }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`group relative flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all duration-300 overflow-hidden ${activeTab === tab.id
                            ? 'bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black shadow-[0_0_20px_rgba(0,242,234,0.4)]'
                            : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                            }`}
                    >
                        {/* Enhanced Glass overlays for active state */}
                        {activeTab === tab.id && (
                            <>
                                {/* Primary gloss */}
                                <div className="absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent pointer-events-none" />
                                {/* Secondary shine band */}
                                <div className="absolute top-[10%] left-0 right-0 h-[40%] bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-lg" />
                            </>
                        )}
                        <tab.icon className={`w-4 h-4 relative z-10 ${activeTab === tab.id ? 'text-black' : ''}`} />
                        <span className="relative z-10">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'create' && (
                <div className="space-y-6">

                    {/* Step 1: Select Videos */}
                    <section className="bg-white/5 rounded-2xl border border-white/10 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-sm text-cyan-400">1</div>
                                选择视频
                            </h2>

                            <div className="flex items-center gap-4">
                                {/* Clear task button - show when videos exist */}
                                {selectedVideos.length > 0 && (
                                    <button
                                        onClick={() => setShowClearConfirm(true)}
                                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                        清空任务
                                    </button>
                                )}

                                {/* Default cover toggle - JCUI 2.0 Style */}
                                <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                                    <span className="text-xs text-white/60 font-medium">使用默认封面</span>
                                    <button
                                        onClick={() => setUseDefaultCover(!useDefaultCover)}
                                        className={`relative w-11 h-6 rounded-full transition-all duration-300 ${useDefaultCover
                                            ? 'bg-gradient-to-r from-[#CCFF00] to-[#00F2EA] shadow-[0_0_12px_rgba(0,242,234,0.4)]'
                                            : 'bg-white/10 border border-white/20'
                                            }`}
                                    >
                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-all duration-300 ${useDefaultCover
                                            ? 'translate-x-5 bg-black shadow-md'
                                            : 'translate-x-0 bg-white/60'
                                            }`} />
                                    </button>
                                    <span className={`text-xs font-bold ${useDefaultCover ? 'text-[#00F2EA]' : 'text-white/40'}`}>
                                        {useDefaultCover ? '首帧' : '自定义'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Tip for cover setting */}
                        {useDefaultCover && selectedVideos.length > 0 && (
                            <p className="text-xs text-gray-500 mb-4 bg-gray-800/50 px-3 py-2 rounded-lg">
                                💡 默认使用视频首帧作为封面。关闭开关可自定义每个视频的封面。
                            </p>
                        )}

                        {/* Video source tabs - Segmented Control */}
                        <div className="bg-black/40 p-1.5 rounded-xl inline-flex gap-1 mb-4">
                            {[
                                { id: 'upload' as VideoSourceType, label: '本地上传', Icon: Upload },
                                { id: 'asset' as VideoSourceType, label: '从成品库选择', Icon: FileVideo }
                            ].map(({ id, label, Icon }) => {
                                const isActive = videoSource === id
                                return (
                                    <button
                                        key={id}
                                        onClick={() => setVideoSource(id)}
                                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 ${isActive
                                            ? 'bg-white/10 text-white shadow-lg shadow-black/20 ring-1 ring-white/10'
                                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                                            }`}
                                    >
                                        <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : ''}`} />
                                        <span>{label}</span>
                                    </button>
                                )
                            })}
                        </div>

                        {/* Hidden file input for upload */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={TIKTOK_VIDEO_FORMATS.join(',')}
                            multiple
                            onChange={handleFileUpload}
                            className="hidden"
                        />

                        {/* Upload error message */}
                        {uploadError && (
                            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                {uploadError}
                                <button onClick={() => setUploadError(null)} className="ml-auto">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        )}



                        {/* Upload Progress List - Optimized UI */}
                        {uploadingFiles.length > 0 && (
                            <div className="mb-6 p-5 rounded-2xl bg-gradient-to-br from-gray-900/90 to-black/90 border border-white/10 backdrop-blur-md shadow-xl">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-full bg-cyan-500/10">
                                            {uploadingFiles.every(f => f.status === 'done') ? (
                                                <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                                            ) : (
                                                <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-semibold text-white">
                                                正在上传 {uploadingFiles.length} 个视频
                                            </h3>
                                            <p className="text-xs text-gray-400 mt-0.5">
                                                {uploadingFiles.filter(f => f.status === 'done').length}/{uploadingFiles.length} 完成
                                                <span className="mx-1.5 text-white/10">|</span>
                                                <span className="text-cyan-400 font-medium">{Math.round(uploadingFiles.reduce((sum, f) => sum + f.progress, 0) / uploadingFiles.length)}%</span>
                                            </p>
                                        </div>
                                    </div>


                                </div>

                                {/* Total progress bar */}
                                <div className="relative w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-4">
                                    <div
                                        className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(6,182,212,0.5)]"
                                        style={{ width: `${uploadingFiles.reduce((sum, f) => sum + f.progress, 0) / uploadingFiles.length}%` }}
                                    />
                                </div>

                                {/* Individual file status list - Grid for better density */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                                    {uploadingFiles.map(file => (
                                        <div key={file.id} className="group flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-transparent hover:border-white/5">
                                            <div className="flex-shrink-0">
                                                {file.status === 'done' ? (
                                                    <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                                                        <Check className="w-3.5 h-3.5 text-green-400" />
                                                    </div>
                                                ) : file.status === 'error' ? (
                                                    <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
                                                        <X className="w-3.5 h-3.5 text-red-400" />
                                                    </div>
                                                ) : (
                                                    <div className="relative w-6 h-6 flex items-center justify-center">
                                                        <svg className="w-full h-full transform -rotate-90">
                                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" className="text-white/10" />
                                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-500 transition-all duration-300" strokeDasharray={62.8} strokeDashoffset={62.8 - (62.8 * file.progress) / 100} />
                                                        </svg>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <span className={`text-xs font-medium truncate ${file.status === 'done' ? 'text-gray-300 group-hover:text-white' : 'text-white'}`}>
                                                        {file.name}
                                                    </span>
                                                    <span className={`text-[10px] tabular-nums ${file.status === 'done' ? 'text-green-400' :
                                                        file.status === 'error' ? 'text-red-400' :
                                                            'text-cyan-400'
                                                        }`}>
                                                        {file.status === 'done' ? '完成' :
                                                            file.status === 'error' ? '失败' :
                                                                `${file.progress}%`}
                                                    </span>
                                                </div>
                                                {/* Mini individual bar for active uploads */}

                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Selected videos grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                            {selectedVideos.map(video => (
                                <div
                                    key={video.id}
                                    className="relative group aspect-[9/16] rounded-xl bg-white/5 border border-white/10 overflow-hidden"
                                >
                                    {/* Show custom cover if set, otherwise show thumbnail or video */}
                                    {video.cover ? (
                                        <img
                                            src={video.cover}
                                            alt={`${video.name} 封面`}
                                            className="absolute inset-0 w-full h-full object-cover"
                                        />
                                    ) : video.thumbnail && video.thumbnail.length > 0 ? (
                                        <img
                                            src={video.thumbnail}
                                            alt={video.name}
                                            className="absolute inset-0 w-full h-full object-cover"
                                        />
                                    ) : video.url ? (
                                        /* Show video preview if URL available but no thumbnail */
                                        <video
                                            src={video.url}
                                            className="absolute inset-0 w-full h-full object-cover"
                                            muted
                                            playsInline
                                            preload="metadata"
                                        />
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                                            <Play className="w-8 h-8" />
                                        </div>
                                    )}
                                    {/* Success indicator overlay */}
                                    <div className="absolute top-2 left-2 bg-green-500/90 rounded-full p-1">
                                        <Check className="w-3 h-3 text-white" />
                                    </div>
                                    {/* Cover indicator */}
                                    {video.cover && (
                                        <div className="absolute top-2 left-8 bg-pink-500/90 rounded-full px-2 py-0.5">
                                            <span className="text-[10px] text-white">已设封面</span>
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                        <p className="text-xs truncate">{video.name}</p>
                                        <div className="flex items-center gap-1 mt-1">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${video.type === 'asset' ? 'bg-cyan-500/30 text-cyan-300' : 'bg-green-500/30 text-green-300'}`}>
                                                {video.type === 'asset' ? '成品库' : '本地'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Bottom action bar - appears on hover */}
                                    <div className="absolute bottom-0 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="flex items-center justify-center gap-1 p-2 bg-black/70 backdrop-blur-sm">
                                            {/* Cover edit button - only show when useDefaultCover is OFF */}
                                            {!useDefaultCover && video.url && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); toggleVideoExpanded(video.id); }}
                                                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 text-white hover:bg-cyan-500/50 transition-colors text-xs"
                                                >
                                                    <ImageIcon className="w-3 h-3" />
                                                    封面
                                                </button>
                                            )}
                                            {/* Delete button */}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); removeVideo(video.id); }}
                                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 text-white hover:bg-red-500/50 transition-colors text-xs"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                                删除
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Add video button - changes based on source type */}
                            <button
                                onClick={() => {
                                    if (videoSource === 'asset') {
                                        openAssetSelector()
                                    } else if (videoSource === 'upload') {
                                        fileInputRef.current?.click()
                                    }
                                    // URL handled by input above
                                }}
                                className="aspect-[9/16] rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-cyan-400 hover:border-cyan-500/50 transition-colors"
                            >
                                {videoSource === 'asset' ? (
                                    <>
                                        <FileVideo className="w-8 h-8" />
                                        <span className="text-xs text-center px-2">从成品库选择</span>
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-8 h-8" />
                                        <span className="text-xs text-center px-2">上传视频<br /><span className="text-[10px] text-gray-500">.mp4 .webm .mov</span></span>
                                    </>
                                )}
                            </button>
                        </div>

                        {selectedVideos.length > 0 && (
                            <p className="mt-4 text-sm text-gray-400">
                                已选择 <span className="text-cyan-400 font-semibold">{selectedVideos.length}</span> 个视频
                                {expandedVideoId && <span className="ml-2 text-pink-400">· 正在编辑封面</span>}
                            </p>
                        )}


                    </section>

                    {/* Step 2: Select Accounts */}
                    <section className="bg-white/5 rounded-2xl border border-white/10 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-sm text-cyan-400">2</div>
                                选择发布账号
                            </h2>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => router.push('/publish/accounts')}
                                    className="group relative flex items-center gap-1.5 px-4 py-2 rounded-lg overflow-hidden bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black font-bold text-sm transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.4)]"
                                >
                                    {/* Glass shine */}
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-white/15 to-transparent pointer-events-none" />
                                    <div className="absolute top-[10%] left-0 right-0 h-[35%] bg-gradient-to-b from-white/25 to-transparent pointer-events-none rounded-lg" />
                                    <Plus className="w-3.5 h-3.5 relative z-10" />
                                    <span className="relative z-10">去绑定</span>
                                </button>
                            </div>
                        </div>

                        {loadingAccounts ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                            </div>
                        ) : accounts.length === 0 ? (
                            <div className="text-center py-8">
                                <Users className="w-12 h-12 mx-auto mb-3 text-gray-500" />
                                <p className="text-gray-400 mb-4">还没有绑定 TikTok 账号</p>
                                <button
                                    onClick={() => router.push('/publish/accounts')}
                                    className="group relative px-5 py-2 rounded-full font-bold text-black text-sm overflow-hidden transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(0,242,234,0.5)] bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899]"
                                >
                                    {/* Strong glass shine - top half highlight */}
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent pointer-events-none" />
                                    {/* Secondary horizontal shine band */}
                                    <div className="absolute top-[15%] left-0 right-0 h-[35%] bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-full" />
                                    {/* Shimmer effect on hover */}
                                    <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.5),transparent)] bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-300 pointer-events-none" />
                                    <span className="relative z-10 flex items-center gap-2">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                        立即绑定账号
                                    </span>
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {accounts.map(account => {
                                    const isAuthorized = isAccountAuthorized(account)
                                    const isSelected = selectedAccounts.includes(account.id)

                                    return (
                                        <div
                                            key={account.id}
                                            onClick={() => isAuthorized && toggleAccountSelection(account.id)}
                                            className={`group relative p-4 rounded-xl border transition-all duration-300 cursor-pointer overflow-hidden ${isSelected
                                                ? 'bg-cyan-500/10 border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/30'
                                                : isAuthorized
                                                    ? 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10 hover:-translate-y-1'
                                                    : 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed'
                                                }`}
                                        >
                                            {/* Background Gradient Effect */}
                                            {isSelected && (
                                                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent opacity-50" />
                                            )}

                                            <div className="relative flex items-center gap-3">
                                                {/* Avatar with Status Ring */}
                                                <div className="relative">
                                                    <div className={`w-12 h-12 rounded-full p-0.5 ${isSelected ? 'bg-gradient-to-r from-cyan-400 to-blue-500' : 'bg-white/10'
                                                        }`}>
                                                        {account.avatar_url ? (
                                                            <img
                                                                src={account.avatar_url}
                                                                alt={account.display_name}
                                                                className="w-full h-full rounded-full object-cover border border-black/50"
                                                                onError={(e) => {
                                                                    e.currentTarget.style.display = 'none'
                                                                    e.currentTarget.nextElementSibling?.classList.remove('hidden')
                                                                }}
                                                            />
                                                        ) : null}
                                                        <div className={`w-full h-full rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center text-white font-bold ${account.avatar_url ? 'hidden' : ''}`}>
                                                            {account.display_name.charAt(0).toUpperCase()}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Info */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <h3 className={`font-semibold text-sm truncate ${isSelected ? 'text-white' : 'text-gray-200'}`}>
                                                            @{account.display_name}
                                                        </h3>
                                                        {account.status === 'active' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
                                                    </div>
                                                    <p className="text-xs text-gray-400 mt-0.5">
                                                        粉丝 {account.follower_count >= 1000
                                                            ? `${(account.follower_count / 1000).toFixed(1)}K`
                                                            : account.follower_count}
                                                    </p>
                                                </div>

                                                {/* Selection Checkbox */}
                                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${isSelected ? 'border-cyan-400 bg-cyan-500' : 'border-white/20 group-hover:border-white/40'
                                                    }`}>
                                                    {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                                                </div>
                                            </div>

                                            {/* Authorization Status Badge */}
                                            {!isAuthorized && (
                                                <div className="absolute top-2 right-2">
                                                    <span className="px-2 py-0.5 text-[10px] rounded-full bg-orange-500/20 text-orange-400 flex items-center gap-1">
                                                        <AlertCircle className="w-2.5 h-2.5" />
                                                        需授权
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}

                                {/* Add New Button */}
                                <button
                                    onClick={() => router.push('/publish/accounts')}
                                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-white/10 hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all group min-h-[80px]"
                                >
                                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-cyan-500/20 group-hover:scale-110 transition-all">
                                        <Plus className="w-5 h-5 text-gray-400 group-hover:text-cyan-400" />
                                    </div>
                                    <span className="text-sm text-gray-400 group-hover:text-cyan-400">绑定新账号</span>
                                </button>
                            </div>
                        )}
                    </section>

                    {/* Step 3: Publish Settings */}
                    <section className="bg-white/5 rounded-2xl border border-white/10 p-6">
                        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-sm text-cyan-400">3</div>
                            发布设置
                        </h2>

                        <div className="space-y-4">
                            {/* Task Group Name */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    任务组名称 <span className="text-gray-500 font-normal">(可选)</span>
                                </label>
                                <input
                                    type="text"
                                    value={taskGroupName}
                                    onChange={(e) => setTaskGroupName(e.target.value)}
                                    placeholder="例如：今日穿搭分享、产品推广第3期..."
                                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all text-sm"
                                />
                                <p className="text-xs text-gray-500 mt-1">为本次发布任务起个名字，方便后续在"发布记录"中查找</p>
                            </div>

                            {/* Title Mode Selector */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-sm font-medium text-gray-300">
                                        视频标题
                                    </label>
                                    <div className="flex items-center gap-2">

                                        {/* Title Mode Toggle */}
                                        {selectedVideos.length > 1 && (
                                            <div className="flex items-center gap-1 text-xs">
                                                <button
                                                    onClick={() => setTitleMode('uniform')}
                                                    className={`px-2 py-1 rounded-lg transition-colors ${titleMode === 'uniform'
                                                        ? 'bg-cyan-500/20 text-cyan-400'
                                                        : 'text-gray-400 hover:text-white'
                                                        }`}
                                                >
                                                    统一标题
                                                </button>
                                                <button
                                                    onClick={() => setTitleMode('individual')}
                                                    className={`px-2 py-1 rounded-lg transition-colors ${titleMode === 'individual'
                                                        ? 'bg-pink-500/20 text-pink-400'
                                                        : 'text-gray-400 hover:text-white'
                                                        }`}
                                                >
                                                    独立标题
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {titleMode === 'uniform' ? (
                                    /* Uniform title - single input with integrated toolbar */
                                    <div className="relative group">
                                        <textarea
                                            value={caption}
                                            onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
                                            placeholder="输入视频标题..."
                                            rows={5}
                                            maxLength={2200}
                                            className="w-full pl-4 pr-4 pt-4 pb-14 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all resize-none"
                                        />

                                        {/* Floating Toolbar */}
                                        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                                            {/* Character Count */}
                                            <div className={`text-xs font-mono ${caption.length > 2000 ? 'text-amber-400' : caption.length > 2100 ? 'text-red-400' : 'text-gray-600'}`}>
                                                {caption.length}/2200
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="flex items-center gap-2">
                                                {/* Topic Button */}
                                                <button
                                                    type="button"
                                                    onClick={() => setCaption(prev => prev + ' #')}
                                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-xs font-medium border border-transparent hover:border-white/10"
                                                >
                                                    <Hash className="w-3.5 h-3.5" />
                                                    话题
                                                </button>

                                                {/* AI Assistant Button */}
                                                {selectedVideos.length > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowTitleAssistant(true)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 text-pink-300 transition-all text-xs font-medium border border-pink-500/20 hover:border-pink-500/40 shadow-lg shadow-pink-500/5"
                                                    >
                                                        <Sparkles className="w-3.5 h-3.5" />
                                                        AI 写标题
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    /* Individual titles - one input per video */
                                    <div className="space-y-3">
                                        {selectedVideos.map((video, index) => (
                                            <div key={video.id} className="flex gap-3 items-start p-3 rounded-xl bg-white/5 border border-white/10">
                                                <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-black/40 border border-white/10 flex items-center justify-center">
                                                    {video.cover ? (
                                                        <img
                                                            src={video.cover}
                                                            alt=""
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : video.thumbnail ? (
                                                        <img
                                                            src={video.thumbnail}
                                                            alt=""
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <span className="text-xs text-white/40">{index + 1}</span>
                                                    )}
                                                </div>
                                                <div className="flex-1">
                                                    <input
                                                        type="text"
                                                        value={video.title || ''}
                                                        onChange={(e) => updateVideoTitle(video.id, e.target.value)}
                                                        placeholder={`视频 ${index + 1} 的标题...`}
                                                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all text-sm"
                                                    />
                                                    <p className="text-[10px] text-gray-500 mt-1 truncate">{video.name}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Quick action buttons - Only show for individual mode */}
                            {titleMode === 'individual' && (
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setCaption(prev => prev + ' #')}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-cyan-400 hover:border-cyan-500/50 transition-colors text-sm"
                                    >
                                        <span className="text-cyan-400 font-bold">#</span>
                                        添加话题
                                    </button>
                                </div>
                            )}

                            {/* ===== Creator Info 展示 ===== */}
                            {selectedAccounts.length === 1 && (
                                <div className="mt-4 p-4 bg-black/30 rounded-xl border border-white/10">
                                    {creatorInfoLoading ? (
                                        <div className="flex items-center gap-3">
                                            <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                                            <span className="text-sm text-gray-400">获取创作者信息...</span>
                                        </div>
                                    ) : creatorInfoError ? (
                                        <div className="flex items-center gap-2 text-red-400 text-sm">
                                            <AlertCircle className="w-4 h-4" />
                                            <span>{creatorInfoError}</span>
                                        </div>
                                    ) : creatorInfo ? (
                                        <div className="flex items-center gap-3">
                                            {creatorInfo.avatar_url ? (
                                                <img src={creatorInfo.avatar_url} alt="" className="w-10 h-10 rounded-full border-2 border-cyan-500/30" />
                                            ) : (
                                                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                                                    <UserCheck className="w-5 h-5 text-cyan-400" />
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-sm font-medium text-white">{creatorInfo.nickname || creatorInfo.username}</p>
                                                <p className="text-xs text-gray-500">@{creatorInfo.username}</p>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            )}

                            {/* ===== 可见范围（动态下拉，无默认值） ===== */}
                            <div className="mt-4">
                                <label className="block text-sm font-medium text-gray-300 mb-3">
                                    可见范围 <span className="text-red-400">*</span>
                                </label>
                                <div className="relative">
                                    <select
                                        value={privacyLevel || ''}
                                        onChange={(e) => setPrivacyLevel(e.target.value || null)}
                                        className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                                    >
                                        <option value="" disabled>请选择可见范围</option>
                                        {(creatorInfo?.privacy_level_options || ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']).map(option => {
                                            const labels: Record<string, string> = {
                                                'PUBLIC_TO_EVERYONE': '🌐 公开 - 所有人可见',
                                                'MUTUAL_FOLLOW_FRIENDS': '👥 好友 - 互关好友可见',
                                                'FOLLOWER_OF_CREATOR': '📢 粉丝 - 粉丝可见',
                                                'SELF_ONLY': '🔒 仅自己 - 仅自己可见',
                                            }
                                            // Branded Content 时禁用 SELF_ONLY
                                            const disabled = brandedContent && option === 'SELF_ONLY'
                                            return (
                                                <option key={option} value={option} disabled={disabled}>
                                                    {labels[option] || option}{disabled ? ' (品牌合作不可选)' : ''}
                                                </option>
                                            )
                                        })}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                </div>
                                {!privacyLevel && selectedAccounts.length > 0 && (
                                    <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                                        <Info className="w-3 h-3" />
                                        请选择可见范围后才能发布
                                    </p>
                                )}
                            </div>

                            {/* ===== 互动设置（默认全部关闭） ===== */}
                            <div className="mt-4 space-y-3">
                                <label className="block text-sm font-medium text-gray-300">
                                    互动设置
                                </label>
                                {[
                                    { key: 'comment', label: '允许评论', icon: MessageCircle, value: allowComment, setter: setAllowComment, disabled: creatorInfo?.comment_disabled },
                                    { key: 'duet', label: '允许合拍', icon: Repeat2, value: allowDuet, setter: setAllowDuet, disabled: creatorInfo?.duet_disabled },
                                    { key: 'stitch', label: '允许剪辑引用', icon: Scissors, value: allowStitch, setter: setAllowStitch, disabled: creatorInfo?.stitch_disabled },
                                ].map(({ key, label, icon: Icon, value, setter, disabled }) => (
                                    <div key={key} className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5">
                                        <div className="flex items-center gap-2">
                                            <Icon className={`w-4 h-4 ${disabled ? 'text-gray-600' : value ? 'text-cyan-400' : 'text-gray-500'}`} />
                                            <span className={`text-sm ${disabled ? 'text-gray-600' : 'text-gray-300'}`}>{label}</span>
                                            {disabled && <span className="text-[10px] text-gray-600 bg-white/5 px-1.5 py-0.5 rounded">创作者已禁用</span>}
                                        </div>
                                        <button
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => setter(!value)}
                                            className={`relative w-10 h-5 rounded-full transition-colors duration-300 ${disabled ? 'bg-white/5 cursor-not-allowed' : value ? 'bg-cyan-500' : 'bg-white/10'}`}
                                        >
                                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${value && !disabled ? 'left-5' : 'left-0.5'}`} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* ===== 商业内容披露 ===== */}
                            <div className="mt-4">
                                <div className="flex items-center justify-between p-4 bg-black/30 rounded-xl border border-white/10">
                                    <div className="flex items-center gap-3">
                                        <ShieldCheck className={`w-5 h-5 ${contentDisclosure ? 'text-amber-400' : 'text-gray-500'}`} />
                                        <div>
                                            <p className="text-sm font-medium text-white">商业内容披露</p>
                                            <p className="text-xs text-gray-500">声明此内容包含商业推广</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (contentDisclosure) {
                                                setContentDisclosure(false)
                                                setYourBrand(false)
                                                setBrandedContent(false)
                                            } else {
                                                setContentDisclosure(true)
                                            }
                                        }}
                                        className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${contentDisclosure ? 'bg-amber-500' : 'bg-white/10'}`}
                                    >
                                        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${contentDisclosure ? 'left-7' : 'left-1'}`} />
                                    </button>
                                </div>

                                {contentDisclosure && (
                                    <div className="mt-3 ml-4 space-y-2">
                                        <label className="flex items-center gap-3 p-3 bg-black/20 rounded-lg border border-white/5 cursor-pointer hover:bg-white/5 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={yourBrand}
                                                onChange={(e) => setYourBrand(e.target.checked)}
                                                className="w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500/50"
                                            />
                                            <div>
                                                <p className="text-sm text-white">自有品牌推广</p>
                                                <p className="text-[11px] text-gray-500">标记为 &quot;Promotional content&quot;</p>
                                            </div>
                                        </label>
                                        <label className="flex items-center gap-3 p-3 bg-black/20 rounded-lg border border-white/5 cursor-pointer hover:bg-white/5 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={brandedContent}
                                                onChange={(e) => {
                                                    setBrandedContent(e.target.checked)
                                                    // Branded Content 选中时，自动清除 SELF_ONLY
                                                    if (e.target.checked && privacyLevel === 'SELF_ONLY') {
                                                        setPrivacyLevel(null)
                                                    }
                                                }}
                                                className="w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500/50"
                                            />
                                            <div>
                                                <p className="text-sm text-white">品牌合作内容</p>
                                                <p className="text-[11px] text-gray-500">标记为 &quot;Paid partnership&quot;</p>
                                            </div>
                                        </label>
                                        {disclosureIncomplete && (
                                            <p className="text-xs text-amber-400 flex items-center gap-1 mt-1">
                                                <Info className="w-3 h-3" />
                                                请选择至少一种披露类型
                                            </p>
                                        )}
                                        {brandedPrivacyConflict && (
                                            <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
                                                <AlertCircle className="w-3 h-3" />
                                                品牌合作内容不能设为仅自己可见
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* ===== AI Generated Content Toggle (默认 ON) ===== */}
                            <div className="mt-4 flex items-center justify-between p-4 bg-black/30 rounded-xl border border-white/10">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                                        <Sparkles className="w-5 h-5 text-purple-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">AI 生成内容</p>
                                        <p className="text-xs text-gray-500">标记视频为 AI 生成，符合 TikTok 政策</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsAiGenerated(!isAiGenerated)}
                                    className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${isAiGenerated ? 'bg-purple-500' : 'bg-white/10'}`}
                                >
                                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${isAiGenerated ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>

                            {/* ===== 1.7 发布上限 + 1.8 时长校验警告 ===== */}
                            {overDuration && (
                                <div className="mt-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                                    <p className="text-xs text-red-400 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                        视频时长超过该创作者允许的最大时长 ({maxDurationSec}秒)，请缩短视频后再发布
                                    </p>
                                </div>
                            )}
                            {creatorInfoError && (
                                <div className="mt-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                    <p className="text-xs text-amber-400 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                        无法获取创作者信息：{creatorInfoError}
                                    </p>
                                </div>
                            )}

                            {/* ===== 用户同意声明 ===== */}
                            <div className="mt-4 px-3 py-2 bg-black/20 rounded-lg border border-white/5">
                                <p className="text-[11px] text-gray-500 leading-relaxed">
                                    By posting, you agree to TikTok&apos;s{' '}
                                    {brandedContent && (
                                        <>
                                            <a
                                                href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 inline-flex items-center gap-0.5"
                                            >
                                                Branded Content Policy
                                                <ExternalLink className="w-2.5 h-2.5" />
                                            </a>
                                            {' and '}
                                        </>
                                    )}
                                    <a
                                        href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 inline-flex items-center gap-0.5"
                                    >
                                        Music Usage Confirmation
                                        <ExternalLink className="w-2.5 h-2.5" />
                                    </a>
                                </p>
                            </div>
                        </div >
                    </section >

                    {/* Step 3: Schedule */}
                    < section className="bg-white/5 rounded-2xl border border-white/10 p-6" >
                        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-sm text-cyan-400">4</div>
                            发布时间
                        </h2>

                        <div className="space-y-4">
                            {/* Publish Mode - Segmented Control */}
                            <div className="bg-black/40 p-1.5 rounded-xl inline-flex gap-1">
                                {[
                                    { id: 'now' as const, label: '立即发布', Icon: Rocket, activeColor: 'cyan' },
                                    { id: 'scheduled' as const, label: '预约发布', Icon: Calendar, activeColor: 'pink' },
                                ].map(({ id, label, Icon, activeColor }) => {
                                    const isActive = publishMode === id
                                    const colorClass = activeColor === 'cyan'
                                        ? 'text-cyan-400'
                                        : 'text-pink-400'
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => setPublishMode(id)}
                                            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 ${isActive
                                                ? 'bg-white/10 text-white shadow-lg shadow-black/20 ring-1 ring-white/10'
                                                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                                                }`}
                                        >
                                            <Icon className={`w-4 h-4 ${isActive ? colorClass : ''}`} />
                                            <span>{label}</span>
                                        </button>
                                    )
                                })}
                            </div>

                            {publishMode === 'scheduled' && (
                                <div className="space-y-3">
                                    <div className="flex gap-4 flex-wrap items-end">
                                        <div>
                                            <label className="block text-sm text-gray-400 mb-1">日期</label>
                                            <input
                                                type="date"
                                                value={scheduledDate}
                                                onChange={(e) => setScheduledDate(e.target.value)}
                                                min={format(new Date(), 'yyyy-MM-dd')}
                                                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm text-gray-400 mb-1">时间</label>
                                            <input
                                                type="time"
                                                value={scheduledTime}
                                                onChange={(e) => setScheduledTime(e.target.value)}
                                                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500">* 以上时间均为北京时间 (UTC+8)</p>
                                </div>
                            )}

                            {/* Publish Interval - Always show for multiple videos */}
                            {selectedVideos.length > 1 && (
                                <div className="space-y-3 p-4 bg-white/5 rounded-xl border border-white/10">
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-5 h-5 text-cyan-400" />
                                        <div>
                                            <p className="text-sm font-medium">发布间隔</p>
                                            <p className="text-xs text-gray-400">多视频发布时，各视频间隔发布避免被限流</p>
                                        </div>
                                    </div>

                                    {/* Interval Preset Buttons */}
                                    <div className="flex flex-wrap gap-2">
                                        {[
                                            { value: '0', label: '不间隔' },
                                            { value: '3', label: '3分钟' },
                                            { value: '5', label: '5分钟' },
                                            { value: '10', label: '10分钟' },
                                            { value: '30', label: '30分钟' },
                                            { value: '60', label: '1小时' },
                                            { value: '120', label: '2小时' },
                                            { value: '360', label: '6小时' },
                                            { value: '720', label: '12小时' },
                                            { value: '1440', label: '24小时' },
                                        ].map(({ value, label }) => (
                                            <button
                                                key={value}
                                                type="button"
                                                onClick={() => setIntervalMode(value as typeof intervalMode)}
                                                className={`px-3 py-1.5 rounded-lg text-xs transition-all ${intervalMode === value
                                                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                                                    : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                                                    }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setIntervalMode('custom')}
                                            className={`px-3 py-1.5 rounded-lg text-xs transition-all ${intervalMode === 'custom'
                                                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                                                : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                                                }`}
                                        >
                                            ⚙️ 自定义
                                        </button>
                                    </div>

                                    {/* Custom Interval Input */}
                                    {intervalMode === 'custom' && (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                value={customInterval}
                                                onChange={(e) => setCustomInterval(Math.max(1, Math.min(1440, parseInt(e.target.value) || 1)))}
                                                min={1}
                                                max={1440}
                                                className="w-20 px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-center text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                            />
                                            <span className="text-gray-400 text-sm">分钟 (最长24小时)</span>
                                        </div>
                                    )}

                                    {/* Publish Time Preview */}
                                    {publishMode === 'scheduled' && scheduledDate && (
                                        <div className="mt-3 p-3 bg-white/5 rounded-lg">
                                            <p className="text-xs text-gray-400 mb-2">📊 发布时间预览：</p>
                                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                                {selectedVideos.slice(0, 10).map((video, index) => {
                                                    const effectiveInterval = intervalMode === 'custom' ? customInterval : parseInt(intervalMode)
                                                    const baseTime = new Date(`${scheduledDate}T${scheduledTime}`)
                                                    const publishTime = addMinutes(baseTime, index * effectiveInterval)
                                                    return (
                                                        <div key={video.id} className="flex items-center gap-2 text-xs">
                                                            <span className="text-gray-500">视频{index + 1}:</span>
                                                            <span className="text-cyan-400">{format(publishTime, 'MM月dd日 HH:mm')}</span>
                                                        </div>
                                                    )
                                                })}
                                                {selectedVideos.length > 10 && (
                                                    <p className="text-xs text-gray-500">... 更多 {selectedVideos.length - 10} 个视频</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </section >

                    {/* Task Preview & Submit - Premium Glass Bar */}
                    <div className="sticky bottom-4 z-10 mt-6">
                        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl p-1.5 flex items-center justify-between">
                            {/* Left: Info Sections */}
                            <div className="flex items-center h-16">
                                {/* Video Count */}
                                <div className="flex flex-col justify-center px-5 border-r border-white/5 h-full">
                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">视频</span>
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-2xl font-bold text-white font-mono">{selectedVideos.length}</span>
                                        <span className="text-xs text-gray-500">个</span>
                                    </div>
                                </div>

                                {/* Account Info */}
                                <div className="flex items-center gap-3 px-5 border-r border-white/5 h-full">
                                    {selectedAccounts.length > 0 ? (
                                        <>
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
                                                {accounts.find(a => a.id === selectedAccounts[0])?.display_name?.charAt(0).toUpperCase() || 'T'}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">账号</span>
                                                <span className="text-sm font-medium text-white truncate max-w-[100px]">
                                                    @{accounts.find(a => a.id === selectedAccounts[0])?.display_name || '未选择'}
                                                </span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">账号</span>
                                            <span className="text-sm text-gray-400">未选择</span>
                                        </div>
                                    )}
                                </div>

                                {/* Schedule Info */}
                                <div className="hidden md:flex flex-col justify-center px-5 h-full">
                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">发布时间</span>
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        {publishMode === 'now' ? (
                                            <>
                                                <Rocket className="w-3.5 h-3.5 text-cyan-400" />
                                                <span className="text-cyan-400">立即发布</span>
                                            </>
                                        ) : (
                                            <>
                                                <Calendar className="w-3.5 h-3.5 text-pink-400" />
                                                <span className="text-pink-400">{scheduledDate} {scheduledTime}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Right: Action Buttons */}
                            <div className="flex items-center gap-2 pr-1.5">
                                {publishError && (
                                    <p className="text-xs text-red-400 flex items-center gap-1 mr-2">
                                        <XCircle className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">{publishError}</span>
                                    </p>
                                )}

                                <button
                                    onClick={() => {
                                        setSelectedVideos([])
                                        setSelectedAccounts([])
                                        setCaption('')
                                    }}
                                    className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-400 hover:bg-white/5 transition-colors text-sm"
                                >
                                    取消
                                </button>

                                <button
                                    onClick={handlePublish}
                                    disabled={!canPublish}
                                    className="relative overflow-hidden group h-12 px-6 rounded-xl bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(0,242,234,0.5)] active:scale-[0.98] transition-all duration-500 disabled:opacity-50 disabled:hover:scale-100"
                                >
                                    {/* Glass shine - top highlight */}
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent pointer-events-none" />
                                    {/* Secondary shine band */}
                                    <div className="absolute top-[10%] left-0 right-0 h-[40%] bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-xl" />
                                    {/* Shimmer on hover */}
                                    <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.5),transparent)] bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-300 pointer-events-none" />

                                    <div className="relative z-10 flex items-center gap-2 text-black font-bold">
                                        {isPublishing ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span>创建中...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span>创建任务</span>
                                                <Zap className="w-4 h-4" />
                                            </>
                                        )}
                                    </div>
                                </button>

                                {/* 1.10 处理耗时提示 */}
                                {isPublishing && (
                                    <p className="text-xs text-gray-500 mt-1">
                                        TikTok 视频处理通常需要 1-2 分钟
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div >
            )
            }

            {/* Task Manager Tab */}
            {
                activeTab === 'tasks' && (
                    <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
                        <TaskManager />
                    </div>
                )
            }

            {/* Asset Selector Modal (成品库选择器) */}
            {
                showAssetModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                        <div className="bg-gray-900 rounded-2xl border border-white/10 w-full max-w-4xl max-h-[80vh] overflow-hidden shadow-2xl">
                            <div className="flex items-center justify-between p-4 border-b border-white/10">
                                <div>
                                    <h3 className="text-lg font-semibold">从成品库选择视频</h3>
                                    <p className="text-xs text-gray-400 mt-1">💡 单击多选，双击快速选择单个视频</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowAssetModal(false)
                                        setSelectedAssetIds([])
                                    }}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-4 overflow-y-auto max-h-[60vh]">
                                {loadingAssets ? (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                                    </div>
                                ) : assets.length === 0 ? (
                                    <div className="text-center py-12">
                                        <Video className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                                        <p className="text-gray-400 mb-2">成品库暂无视频</p>
                                        <p className="text-sm text-gray-500">请先在快速生成或批量工坊生成视频</p>
                                        <button
                                            onClick={() => {
                                                setShowAssetModal(false)
                                                router.push('/quick-gen')
                                            }}
                                            className="mt-4 px-4 py-2 bg-gradient-to-r from-cyan-500 to-pink-500 rounded-lg font-medium hover:opacity-90 transition-opacity"
                                        >
                                            去生成视频
                                        </button>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                        {assets.map(asset => {
                                            const isAlreadyAdded = selectedVideos.some(v => v.id === asset.id)
                                            const isSelectedInModal = selectedAssetIds.includes(asset.id)
                                            return (
                                                <button
                                                    key={asset.id}
                                                    onClick={() => {
                                                        if (isAlreadyAdded) return
                                                        // Toggle selection for multi-select
                                                        setSelectedAssetIds(prev =>
                                                            prev.includes(asset.id)
                                                                ? prev.filter(id => id !== asset.id)
                                                                : [...prev, asset.id]
                                                        )
                                                    }}
                                                    onDoubleClick={() => {
                                                        if (isAlreadyAdded) return
                                                        // Double-click: select and close immediately
                                                        addVideoFromAsset(asset)
                                                        setShowAssetModal(false)
                                                        setSelectedAssetIds([])
                                                    }}
                                                    disabled={isAlreadyAdded}
                                                    className={`relative aspect-[9/16] rounded-xl overflow-hidden border-2 transition-all ${isAlreadyAdded
                                                        ? 'border-gray-500 opacity-30 cursor-not-allowed'
                                                        : isSelectedInModal
                                                            ? 'border-cyan-500 ring-2 ring-cyan-500/30'
                                                            : 'border-transparent hover:border-cyan-500/50'
                                                        }`}
                                                >
                                                    {asset.thumbnailUrl ? (
                                                        <img
                                                            src={asset.thumbnailUrl}
                                                            alt={asset.prompt || '视频'}
                                                            className="absolute inset-0 w-full h-full object-cover"
                                                            onError={(e) => {
                                                                // If thumbnail fails, hide image to show video fallback
                                                                e.currentTarget.style.display = 'none'
                                                            }}
                                                        />
                                                    ) : null}
                                                    {/* Always show video for frame capture, hide if thumbnail loaded */}
                                                    {asset.resultUrl && (
                                                        <video
                                                            src={`${asset.resultUrl}#t=0.1`}
                                                            className={`absolute inset-0 w-full h-full object-cover ${asset.thumbnailUrl ? 'opacity-0' : ''}`}
                                                            muted
                                                            playsInline
                                                            preload="auto"
                                                            onMouseEnter={(e) => e.currentTarget.play()}
                                                            onMouseLeave={(e) => {
                                                                e.currentTarget.pause()
                                                                e.currentTarget.currentTime = 0.1
                                                            }}
                                                            onLoadedData={(e) => {
                                                                // Show video once first frame is loaded
                                                                e.currentTarget.classList.remove('opacity-0')
                                                            }}
                                                        />
                                                    )}
                                                    {!asset.resultUrl && !asset.thumbnailUrl && (
                                                        <div className="absolute inset-0 bg-white/5 flex items-center justify-center">
                                                            <Play className="w-8 h-8 text-gray-500" />
                                                        </div>
                                                    )}
                                                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                                        <p className="text-xs truncate">{asset.prompt?.slice(0, 20) || '视频'}</p>
                                                        <p className="text-[10px] text-gray-400">{format(new Date(asset.createdAt), 'MM/dd', { locale: zhCN })}</p>
                                                    </div>
                                                    {/* Already added indicator */}
                                                    {isAlreadyAdded && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                                            <span className="text-xs text-gray-300">已添加</span>
                                                        </div>
                                                    )}
                                                    {/* Selection checkbox indicator */}
                                                    {!isAlreadyAdded && !transferringAssets.has(asset.id) && (
                                                        <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelectedInModal
                                                            ? 'bg-cyan-500 border-cyan-500'
                                                            : 'border-white/50 bg-black/30'
                                                            }`}>
                                                            {isSelectedInModal && <Check className="w-3 h-3 text-white" />}
                                                        </div>
                                                    )}
                                                    {/* Transfer progress overlay */}
                                                    {transferringAssets.has(asset.id) && (
                                                        <div className="absolute inset-0 z-30 bg-black/80 flex flex-col items-center justify-center">
                                                            <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mb-2" />
                                                            <span className="text-xs text-cyan-400 font-medium">转存中...</span>
                                                            <span className="text-[10px] text-gray-400 mt-1">请稍候</span>
                                                        </div>
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                            {/* Batch Transfer Progress */}
                            {batchTransfer.isTransferring && (
                                <div className="p-4 bg-cyan-500/10 border-t border-cyan-500/30">
                                    <div className="flex items-center gap-3 mb-2">
                                        <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                                        <span className="text-sm text-cyan-400 font-medium">
                                            正在转存 {batchTransfer.completed}/{batchTransfer.total}
                                        </span>
                                        {batchTransfer.failed > 0 && (
                                            <span className="text-xs text-red-400">
                                                ({batchTransfer.failed} 失败)
                                            </span>
                                        )}
                                    </div>
                                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-cyan-500 to-pink-500 transition-all duration-300"
                                            style={{ width: `${batchTransfer.total > 0 ? (batchTransfer.completed / batchTransfer.total) * 100 : 0}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                        每次同时处理 {CONCURRENT_TRANSFER_LIMIT} 个视频，请耐心等待...
                                    </p>
                                </div>
                            )}

                            {/* Footer */}
                            <div className="flex items-center justify-between p-4 border-t border-white/10 bg-white/5">
                                <p className="text-sm text-gray-400">
                                    已选择 <span className="text-cyan-400 font-semibold">{selectedAssetIds.length}</span> 个视频
                                    {selectedVideos.filter(v => v.type === 'asset').length > 0 && (
                                        <span className="text-gray-500 ml-2">（已添加 {selectedVideos.filter(v => v.type === 'asset').length} 个）</span>
                                    )}
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            if (!batchTransfer.isTransferring) {
                                                setShowAssetModal(false)
                                                setSelectedAssetIds([])
                                            }
                                        }}
                                        disabled={batchTransfer.isTransferring}
                                        className="px-4 py-2 rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {batchTransfer.isTransferring ? '请等待...' : '取消'}
                                    </button>
                                    <button
                                        onClick={() => startBatchTransfer(selectedAssetIds)}
                                        disabled={selectedAssetIds.length === 0 || batchTransfer.isTransferring}
                                        className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-pink-500 rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {batchTransfer.isTransferring
                                            ? `转存中 (${batchTransfer.completed}/${batchTransfer.total})`
                                            : `确认添加 (${selectedAssetIds.length})`}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Clear Task Confirmation Dialog */}
            {
                showClearConfirm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                        <div className="bg-gray-900 rounded-2xl border border-white/10 p-6 w-full max-w-md shadow-2xl">
                            <div className="text-center">
                                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-orange-500/20 flex items-center justify-center">
                                    <Trash2 className="w-6 h-6 text-orange-400" />
                                </div>
                                <h3 className="text-lg font-semibold mb-2">确认清空任务？</h3>
                                <div className="text-gray-400 mb-6 text-sm text-left bg-white/5 rounded-lg p-3">
                                    <p className="mb-2">这将清空以下内容：</p>
                                    <ul className="list-disc list-inside space-y-1 text-gray-500">
                                        <li>{selectedVideos.length} 个已选视频</li>
                                        <li>任务组名称</li>
                                        <li>视频标题</li>
                                        <li>发布时间设置</li>
                                    </ul>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowClearConfirm(false)}
                                        className="flex-1 px-4 py-2 rounded-xl border border-white/10 text-gray-400 hover:bg-white/5 transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={clearAllTask}
                                        className="flex-1 px-4 py-2 rounded-xl bg-orange-500 text-white hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        确认清空
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }


            {/* AI Title Assistant Modal */}
            {
                showTitleAssistant && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4">
                        <div className="bg-gray-900/95 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-[0_20px_60px_-15px_rgba(168,85,247,0.3)] w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                            {/* Header */}
                            <div className="flex items-center justify-between p-4 border-b border-white/10">
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    <Sparkles className="w-5 h-5 text-purple-400" />
                                    AI 标题助手
                                </h3>
                                <button
                                    onClick={() => {
                                        setShowTitleAssistant(false)
                                        setGeneratedTitles([])
                                    }}
                                    className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Body */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {/* Input Section */}
                                {generatedTitles.length === 0 && !generatingTitles && (
                                    <>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                                📝 描述你的视频内容
                                            </label>
                                            <textarea
                                                value={titleDescription}
                                                onChange={(e) => setTitleDescription(e.target.value)}
                                                placeholder="例如：美妆教程，分享适合夏天的清爽淡妆技巧，针对年轻女性群体，强调快速上手和日常实用性..."
                                                rows={4}
                                                className="w-full px-4 py-3 bg-black/40 border-0 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:shadow-[0_0_20px_rgba(168,85,247,0.15)] transition-all resize-none"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                                🌐 输出语言
                                            </label>
                                            <div className="flex gap-3">
                                                <button
                                                    onClick={() => setTitleLanguage('zh')}
                                                    className={`flex-1 p-4 rounded-xl border-2 transition-all duration-300 ${titleLanguage === 'zh'
                                                        ? 'border-purple-500/50 bg-gradient-to-br from-purple-500/10 to-pink-500/10 text-white shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                                                        : 'border-white/5 bg-white/5 text-gray-500 hover:text-gray-300 hover:border-white/10 grayscale hover:grayscale-0'
                                                        }`}
                                                >
                                                    <div className="text-2xl mb-1">🇨🇳</div>
                                                    <div className="text-sm font-semibold">中文</div>
                                                </button>
                                                <button
                                                    onClick={() => setTitleLanguage('en')}
                                                    className={`flex-1 p-4 rounded-xl border-2 transition-all duration-300 ${titleLanguage === 'en'
                                                        ? 'border-purple-500/50 bg-gradient-to-br from-purple-500/10 to-pink-500/10 text-white shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                                                        : 'border-white/5 bg-white/5 text-gray-500 hover:text-gray-300 hover:border-white/10 grayscale hover:grayscale-0'
                                                        }`}
                                                >
                                                    <div className="text-2xl mb-1">🇺🇸</div>
                                                    <div className="text-sm font-semibold">English</div>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="bg-white/5 rounded-lg p-3 text-sm text-gray-400">
                                            📊 将为 <span className="text-purple-400 font-semibold">{selectedVideos.length}</span> 个视频生成标题
                                        </div>
                                    </>
                                )}

                                {/* Generating State */}
                                {generatingTitles && (
                                    <div className="py-12 text-center">
                                        <Loader2 className="w-12 h-12 animate-spin text-purple-400 mx-auto mb-4" />
                                        <p className="text-gray-300 mb-2">AI 正在生成标题...</p>
                                        <p className="text-xs text-gray-500">正在为 {selectedVideos.length} 个视频生成标题</p>
                                    </div>
                                )}

                                {/* Results Section */}
                                {generatedTitles.length > 0 && !generatingTitles && (
                                    <>
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm text-gray-300">
                                                ✅ 已生成 <span className="text-purple-400 font-semibold">{generatedTitles.length}</span> 条标题
                                            </p>
                                            <button
                                                onClick={() => {
                                                    setGeneratedTitles([])
                                                }}
                                                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                                            >
                                                <RefreshCw className="w-3 h-3" />
                                                全部重新生成
                                            </button>
                                        </div>

                                        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                                            {generatedTitles.map((title, index) => (
                                                <div
                                                    key={index}
                                                    className={`p-3 rounded-xl border transition-all ${title.selected
                                                        ? 'border-purple-500/30 bg-purple-500/5'
                                                        : 'border-white/10 bg-white/5 opacity-60'
                                                        }`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        {/* Checkbox */}
                                                        <button
                                                            onClick={() => toggleTitleSelection(index)}
                                                            className={`flex-shrink-0 w-5 h-5 rounded border transition-all mt-2 ${title.selected
                                                                ? 'bg-purple-500 border-purple-500'
                                                                : 'border-white/30 hover:border-white/50'
                                                                }`}
                                                        >
                                                            {title.selected && <Check className="w-4 h-4 text-white" />}
                                                        </button>

                                                        {/* Title Input */}
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="text-xs text-gray-500">视频 {index + 1}</span>
                                                            </div>
                                                            <textarea
                                                                value={title.content}
                                                                onChange={(e) => updateTitleContent(index, e.target.value)}
                                                                rows={2}
                                                                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-purple-500/50 resize-none"
                                                            />
                                                        </div>

                                                        {/* Regenerate Button */}
                                                        <button
                                                            onClick={() => regenerateSingleTitle(index)}
                                                            disabled={regeneratingIndex !== null}
                                                            className="flex-shrink-0 p-2 text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors mt-1"
                                                            title="重新生成"
                                                        >
                                                            {regeneratingIndex === index ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <RefreshCw className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <p className="text-xs text-gray-500">
                                            💡 点击标题可直接编辑 | 勾选满意的标题 | 🔄 重新生成不满意的
                                        </p>
                                    </>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="p-4 border-t border-white/10 flex items-center justify-between">
                                {generatedTitles.length === 0 ? (
                                    <>
                                        <button
                                            onClick={() => {
                                                setShowTitleAssistant(false)
                                                setGeneratedTitles([])
                                            }}
                                            className="px-4 py-2 rounded-xl border border-white/10 text-gray-400 hover:bg-white/5 transition-colors"
                                        >
                                            取消
                                        </button>
                                        <button
                                            onClick={generateAllTitles}
                                            disabled={!titleDescription.trim() || generatingTitles}
                                            className="px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            开始生成
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-2">
                                            {generatedTitles.filter(t => !t.selected).length > 0 && (
                                                <button
                                                    onClick={async () => {
                                                        const unselectedIndices = generatedTitles
                                                            .map((t, i) => !t.selected ? i : -1)
                                                            .filter(i => i !== -1)
                                                        for (const idx of unselectedIndices) {
                                                            await regenerateSingleTitle(idx)
                                                        }
                                                    }}
                                                    disabled={regeneratingIndex !== null}
                                                    className="px-3 py-2 rounded-xl border border-white/10 text-gray-400 hover:bg-white/5 transition-colors text-sm flex items-center gap-1"
                                                >
                                                    <RefreshCw className="w-3 h-3" />
                                                    重新生成未选中 ({generatedTitles.filter(t => !t.selected).length})
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => {
                                                    setShowTitleAssistant(false)
                                                    setGeneratedTitles([])
                                                }}
                                                className="px-4 py-2 rounded-xl border border-white/10 text-gray-400 hover:bg-white/5 transition-colors"
                                            >
                                                取消
                                            </button>
                                            <button
                                                onClick={applySelectedTitles}
                                                disabled={generatedTitles.filter(t => t.selected).length === 0}
                                                className="px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                <Check className="w-4 h-4" />
                                                应用选中标题 ({generatedTitles.filter(t => t.selected).length})
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Hidden file input for cover upload */}
            <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                onChange={handleCoverUpload}
                className="hidden"
            />

            {/* Cover Selection Modal - Fixed Position Overlay */}
            <Dialog open={!!expandedVideoId} onOpenChange={(open) => !open && setExpandedVideoId(null)}>
                <DialogContent className="sm:max-w-4xl bg-[#0f0f12] border-white/10 text-white p-0 overflow-hidden shadow-2xl shadow-black/50 gap-0 block">
                    <DialogHeader className="p-5 border-b border-white/10 bg-white/5">
                        <DialogTitle className="flex items-center gap-2 text-lg">
                            <ImageIcon className="w-5 h-5 text-pink-400" />
                            编辑视频封面
                            {expandedVideoId && selectedVideos.find(v => v.id === expandedVideoId) && (
                                <span className="text-sm font-normal text-gray-400 ml-2 truncate max-w-[300px] opacity-70">
                                    {selectedVideos.find(v => v.id === expandedVideoId)?.name}
                                </span>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="p-6">
                        {expandedVideoId && selectedVideos.find(v => v.id === expandedVideoId) && (() => {
                            const video = selectedVideos.find(v => v.id === expandedVideoId)!
                            return (
                                <div className="space-y-4">
                                    {/* Video preview and timeline */}
                                    {video.url ? (
                                        <div className="space-y-6">
                                            {/* Video preview */}
                                            <div className="flex flex-col md:flex-row gap-8 items-start">
                                                {/* Left: Video Player */}
                                                <div className="mx-auto md:mx-0 w-[240px] aspect-[9/16] rounded-xl overflow-hidden bg-black flex-shrink-0 relative shadow-2xl border border-white/10 ring-1 ring-white/5">
                                                    <video
                                                        id={`cover-video-${video.id}-modal`}
                                                        src={video.localUrl || video.url}
                                                        crossOrigin="anonymous"
                                                        className="w-full h-full object-cover"
                                                        muted
                                                        playsInline
                                                        preload="auto"
                                                        onLoadedData={(e) => {
                                                            // Seek to first frame once video data is loaded
                                                            console.log('[Cover] Video loaded, seeking to 0.1')
                                                            e.currentTarget.currentTime = 0.1
                                                        }}
                                                        onSeeked={(e) => {
                                                            console.log('[Cover] Video seeked to:', e.currentTarget.currentTime.toFixed(2))
                                                        }}
                                                        onError={(e) => {
                                                            console.error('[Cover] Video error:', e)
                                                        }}
                                                    />
                                                    <div className="absolute bottom-3 left-3 right-3 bg-black/70 backdrop-blur-md rounded-lg px-2 py-1.5 border border-white/10">
                                                        <p className="text-[10px] text-center text-gray-200 font-medium tracking-wide">当前预览帧</p>
                                                    </div>
                                                </div>

                                                {/* Right: Controls */}
                                                <div className="flex-1 space-y-6 w-full pt-2">
                                                    <div className="space-y-2">
                                                        <h4 className="text-base font-medium text-white flex items-center gap-2">
                                                            <Sliders className="w-4 h-4 text-cyan-400" />
                                                            选择封面帧
                                                        </h4>
                                                        <p className="text-sm text-gray-400 leading-relaxed">
                                                            拖动下方滑块精确选择视频中的精彩瞬间作为封面。
                                                        </p>
                                                    </div>

                                                    {/* Timeline slider */}
                                                    <div className="space-y-4 p-5 bg-white/5 rounded-xl border border-white/10">
                                                        <div className="flex justify-between text-xs text-gray-400 font-medium uppercase tracking-wider">
                                                            <span>0:00</span>
                                                            <span>视频进度</span>
                                                            <span>END</span>
                                                        </div>
                                                        <div className="relative h-6 flex items-center">
                                                            <input
                                                                type="range"
                                                                min="0"
                                                                max="100"
                                                                defaultValue="1"
                                                                onInput={(e) => {
                                                                    const videoEl = document.getElementById(`cover-video-${video.id}-modal`) as HTMLVideoElement
                                                                    if (!videoEl) return

                                                                    // Check if video has loaded enough
                                                                    if (!videoEl.duration || isNaN(videoEl.duration)) {
                                                                        console.log('[Cover] Video duration not ready yet')
                                                                        return
                                                                    }

                                                                    const targetTime = (parseInt((e.target as HTMLInputElement).value) / 100) * videoEl.duration
                                                                    console.log('[Cover] Seeking to:', targetTime.toFixed(2), 'of', videoEl.duration.toFixed(2))

                                                                    // Set time and wait for seeked event
                                                                    videoEl.currentTime = targetTime
                                                                }}
                                                                className="w-full h-2 bg-gray-700/50 rounded-full appearance-none cursor-pointer accent-pink-500 hover:accent-pink-400 transition-colors [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-tr [&::-webkit-slider-thumb]:from-pink-500 [&::-webkit-slider-thumb]:to-purple-500 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
                                                            />
                                                        </div>
                                                        <p className="text-xs text-gray-500 text-center">拖动滑块后稍等片刻，视频会自动更新到选定位置</p>
                                                    </div>

                                                    {/* Action buttons */}
                                                    <div className="grid grid-cols-1 gap-3 pt-2">
                                                        <button
                                                            onClick={async () => {
                                                                console.log('[Cover] Button clicked, starting capture...')
                                                                const videoEl = document.getElementById(`cover-video-${video.id}-modal`) as HTMLVideoElement
                                                                const sliderEl = document.querySelector(`input[type="range"]`) as HTMLInputElement
                                                                console.log('[Cover] Video element:', videoEl ? 'found' : 'NOT FOUND')
                                                                console.log('[Cover] Slider element:', sliderEl ? 'found' : 'NOT FOUND')

                                                                if (videoEl && sliderEl) {
                                                                    console.log('[Cover] readyState:', videoEl.readyState, 'duration:', videoEl.duration, 'currentTime:', videoEl.currentTime)
                                                                    console.log('[Cover] dimensions:', videoEl.videoWidth, 'x', videoEl.videoHeight)
                                                                    console.log('[Cover] src:', videoEl.src?.substring(0, 80))
                                                                    console.log('[Cover] Slider value:', sliderEl.value)

                                                                    try {
                                                                        // Check if video is ready
                                                                        if (videoEl.readyState < 2) {
                                                                            console.log('[Cover] FAILED: readyState < 2')
                                                                            toast({ variant: "destructive", title: "视频未就绪", description: "请等待视频加载完成后再选择封面" })
                                                                            return
                                                                        }

                                                                        // Check if video has actual dimensions
                                                                        if (!videoEl.videoWidth || !videoEl.videoHeight) {
                                                                            console.log('[Cover] FAILED: no dimensions')
                                                                            toast({ variant: "destructive", title: "视频未加载", description: "视频帧未加载，请稍后重试或刷新页面后重试" })
                                                                            return
                                                                        }

                                                                        // Calculate target time from slider value
                                                                        const sliderValue = parseInt(sliderEl.value) || 1
                                                                        const targetTime = (sliderValue / 100) * videoEl.duration
                                                                        console.log('[Cover] Target time from slider:', targetTime.toFixed(2))

                                                                        // Seek to target time and wait for seeked event
                                                                        await new Promise<void>((resolve, reject) => {
                                                                            const timeout = setTimeout(() => {
                                                                                console.log('[Cover] Seek timeout, proceeding anyway')
                                                                                resolve()
                                                                            }, 2000) // 2 second timeout

                                                                            const onSeeked = () => {
                                                                                clearTimeout(timeout)
                                                                                console.log('[Cover] Seek completed, currentTime:', videoEl.currentTime.toFixed(2))
                                                                                videoEl.removeEventListener('seeked', onSeeked)
                                                                                resolve()
                                                                            }

                                                                            videoEl.addEventListener('seeked', onSeeked)

                                                                            // If already at target time, resolve immediately
                                                                            if (Math.abs(videoEl.currentTime - targetTime) < 0.1) {
                                                                                clearTimeout(timeout)
                                                                                videoEl.removeEventListener('seeked', onSeeked)
                                                                                console.log('[Cover] Already at target time')
                                                                                resolve()
                                                                            } else {
                                                                                console.log('[Cover] Seeking to:', targetTime.toFixed(2))
                                                                                videoEl.currentTime = targetTime
                                                                            }
                                                                        })

                                                                        // Small delay to ensure frame is rendered
                                                                        await new Promise(resolve => setTimeout(resolve, 100))

                                                                        console.log('[Cover] After seek, currentTime:', videoEl.currentTime.toFixed(2))

                                                                        console.log('[Cover] Creating canvas...')
                                                                        const canvas = document.createElement('canvas')
                                                                        canvas.width = videoEl.videoWidth
                                                                        canvas.height = videoEl.videoHeight
                                                                        const ctx = canvas.getContext('2d')
                                                                        if (ctx) {
                                                                            console.log('[Cover] Drawing video to canvas...')
                                                                            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)

                                                                            console.log('[Cover] Getting image data to check content...')
                                                                            // Check if canvas actually has content (not just black)
                                                                            const imageData = ctx.getImageData(0, 0, 10, 10)
                                                                            const hasContent = imageData.data.some((val, idx) => idx % 4 !== 3 && val > 0)
                                                                            console.log('[Cover] hasContent:', hasContent)

                                                                            if (!hasContent) {
                                                                                // Canvas is black - likely CORS issue or video not loaded
                                                                                console.log('[Cover] FAILED: canvas is black')
                                                                                toast({
                                                                                    variant: "destructive",
                                                                                    title: "封面提取失败",
                                                                                    description: "无法提取视频帧。请刷新页面或稍后重试（清空浏览器缓存可能有帮助）"
                                                                                })
                                                                                return
                                                                            }

                                                                            console.log('[Cover] Converting to dataURL...')
                                                                            const frameData = canvas.toDataURL('image/jpeg', 0.9)
                                                                            const timestampMs = Math.round(videoEl.currentTime * 1000)
                                                                            console.log('[Cover] SUCCESS! Updating cover, frameData length:', frameData.length, 'at time:', timestampMs, 'ms')
                                                                            updateVideoCover(video.id, frameData, timestampMs)
                                                                            setExpandedVideoId(null)
                                                                            toast({ title: "封面已更新", description: "✅ 已成功设置选定帧为视频封面" })
                                                                        } else {
                                                                            console.log('[Cover] FAILED: no canvas context')
                                                                        }
                                                                    } catch (error) {
                                                                        console.error('Failed to capture frame:', error)
                                                                        // More specific error for CORS
                                                                        if (error instanceof DOMException && error.name === 'SecurityError') {
                                                                            toast({
                                                                                variant: "destructive",
                                                                                title: "跨域安全限制",
                                                                                description: "视频来源受跨域限制，请刷新页面或使用上传功能重新添加视频"
                                                                            })
                                                                        } else {
                                                                            toast({
                                                                                variant: "destructive",
                                                                                title: "封面提取失败",
                                                                                description: "无法提取帧，请重试或刷新页面"
                                                                            })
                                                                        }
                                                                    }
                                                                }
                                                            }}
                                                            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-cyan-500 to-pink-500 rounded-xl font-bold text-white hover:opacity-90 hover:shadow-lg hover:shadow-cyan-500/25 transition-all active:scale-[0.98]"
                                                        >
                                                            <Check className="w-5 h-5" />
                                                            确认使用当前帧
                                                        </button>


                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center py-20 bg-white/5 rounded-xl border border-white/10 border-dashed">
                                            <Loader2 className="w-10 h-10 mx-auto text-cyan-500/50 animate-spin mb-4" />
                                            <p className="text-base text-gray-400 font-medium">视频资源加载中，请稍候...</p>
                                        </div>
                                    )}
                                </div>
                            )
                        })()}
                    </div>
                </DialogContent>
            </Dialog>
        </div >
    )
}
