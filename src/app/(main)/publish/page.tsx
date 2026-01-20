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
    ListFilter
} from 'lucide-react'
import { format, addMinutes } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useToast } from '@/hooks/use-toast'
import { TaskManager } from '@/components/publish/TaskManager'

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

    // Privacy level for TikTok publishing
    const [privacyLevel, setPrivacyLevel] = useState<'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'>('SELF_ONLY')

    // Expanded video for editing (shows cover options inline)
    const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null)

    // Cover selection state (simplified)
    const coverInputRef = useRef<HTMLInputElement>(null)
    const [coverUploadVideoId, setCoverUploadVideoId] = useState<string | null>(null)

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
            setExpandedVideoId(videoId)
            // Generate cover options if not already generated
            const video = selectedVideos.find(v => v.id === videoId)
            if (video?.url && (!video.coverOptions || video.coverOptions.length === 0)) {
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

        setIsPublishing(true)
        setPublishError(null)

        try {
            const response = await fetch('/api/publish/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videos: selectedVideos,
                    account_ids: selectedAccounts,
                    caption,
                    // Privacy and interaction settings
                    privacy_level: privacyLevel,
                    allow_comments: true,
                    allow_duet: true,
                    allow_stitch: true,
                    is_brand_content: false,
                    is_ai_generated: true,  // Default to AI-generated since this is AI MCN platform
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
            setActiveTab('tasks')
        } catch (error) {
            setPublishError(error instanceof Error ? error.message : '创建发布任务失败')
        } finally {
            setIsPublishing(false)
        }
    }

    return (
        <div className="space-y-6 p-6 max-w-7xl mx-auto min-h-full pb-20">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-pink-500/20 backdrop-blur-sm border border-white/10">
                        <Rocket className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent">
                            智能分发站
                        </h1>
                    </div>
                </div>

                <button
                    onClick={() => router.push('/publish/accounts')}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                    <Settings className="w-4 h-4" />
                    <span>账号管理</span>
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
                {[
                    { id: 'create' as TabType, label: '创建发布', icon: Send },
                    { id: 'tasks' as TabType, label: '任务管理', icon: ListFilter }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all ${activeTab === tab.id
                            ? 'bg-gradient-to-r from-cyan-500 to-pink-500 text-white shadow-lg'
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        <tab.icon className="w-4 h-4" />
                        <span className="font-medium">{tab.label}</span>
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

                                {/* Default cover toggle */}
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">使用默认封面</span>
                                    <button
                                        onClick={() => setUseDefaultCover(!useDefaultCover)}
                                        className={`relative w-10 h-5 rounded-full transition-colors ${useDefaultCover ? 'bg-cyan-500' : 'bg-gray-600'
                                            }`}
                                    >
                                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${useDefaultCover ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                    </button>
                                    <span className={`text-xs ${useDefaultCover ? 'text-cyan-400' : 'text-gray-500'}`}>
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

                        {/* Video source tabs */}
                        <div className="flex gap-2 mb-4">
                            {[
                                { id: 'upload' as VideoSourceType, label: '本地上传', icon: Upload },
                                { id: 'asset' as VideoSourceType, label: '从成品库选择', icon: Video }
                            ].map(source => (
                                <button
                                    key={source.id}
                                    onClick={() => setVideoSource(source.id)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${videoSource === source.id
                                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                                        : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                                        }`}
                                >
                                    <source.icon className="w-4 h-4" />
                                    <span className="text-sm">{source.label}</span>
                                </button>
                            ))}
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



                        {/* Upload Progress List */}
                        {uploadingFiles.length > 0 && (
                            <div className="mb-4 p-4 rounded-xl bg-white/5 border border-cyan-500/30">
                                <div className="flex items-center gap-2 mb-3">
                                    <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                                    <span className="text-sm text-cyan-400">
                                        正在上传 {uploadingFiles.length} 个视频
                                        ({uploadingFiles.filter(f => f.status === 'done').length}/{uploadingFiles.length} 完成)
                                    </span>
                                    <span className="ml-auto text-sm font-medium text-cyan-400 tabular-nums transition-all duration-500">
                                        {Math.round(uploadingFiles.reduce((sum, f) => sum + f.progress, 0) / uploadingFiles.length)}%
                                    </span>
                                </div>

                                {/* Total progress bar */}
                                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-3">
                                    <div
                                        className="h-full bg-gradient-to-r from-cyan-500 to-pink-500 transition-all duration-300"
                                        style={{ width: `${uploadingFiles.reduce((sum, f) => sum + f.progress, 0) / uploadingFiles.length}%` }}
                                    />
                                </div>

                                {/* Individual file status list */}
                                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                    {uploadingFiles.map(file => (
                                        <div key={file.id} className="flex items-center gap-2 text-xs">
                                            {file.status === 'done' ? (
                                                <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                                            ) : file.status === 'error' ? (
                                                <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                                            ) : file.status === 'uploading' ? (
                                                <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin flex-shrink-0" />
                                            ) : (
                                                <Clock className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                                            )}
                                            <span className={`truncate flex-1 ${file.status === 'done' ? 'text-green-400' :
                                                file.status === 'error' ? 'text-red-400' :
                                                    file.status === 'uploading' ? 'text-white' : 'text-gray-500'
                                                }`}>
                                                {file.name}
                                            </span>
                                            <span className={`text-xs min-w-[36px] text-right ${file.status === 'done' ? 'text-green-400' :
                                                file.status === 'error' ? 'text-red-400' :
                                                    file.status === 'uploading' ? 'text-cyan-400' : 'text-gray-500'
                                                }`}>
                                                {file.status === 'done' ? '完成' :
                                                    file.status === 'error' ? '失败' :
                                                        file.status === 'uploading' ? `${file.progress}%` : '等待'}
                                            </span>
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

                        {/* Expanded video editor - timeline cover selection */}
                        {expandedVideoId && selectedVideos.find(v => v.id === expandedVideoId) && (
                            <div className="mt-4 p-4 bg-gradient-to-r from-cyan-500/5 to-pink-500/5 rounded-xl border border-white/10">
                                {(() => {
                                    const video = selectedVideos.find(v => v.id === expandedVideoId)!
                                    return (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h4 className="font-medium text-sm flex items-center gap-2">
                                                    <ImageIcon className="w-4 h-4 text-pink-400" />
                                                    选择封面: <span className="text-gray-400 font-normal truncate max-w-[200px]">{video.name}</span>
                                                </h4>
                                                <button
                                                    onClick={() => setExpandedVideoId(null)}
                                                    className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>

                                            {/* Video preview and timeline */}
                                            {video.url ? (
                                                <div className="space-y-3">
                                                    {/* Video preview */}
                                                    <div className="flex gap-4 items-start">
                                                        <div className="w-32 h-56 rounded-xl overflow-hidden bg-black flex-shrink-0 relative">
                                                            <video
                                                                id={`cover-video-${video.id}`}
                                                                src={video.localUrl || video.url}
                                                                crossOrigin="anonymous"
                                                                className="w-full h-full object-cover"
                                                                muted
                                                                playsInline
                                                                preload="metadata"
                                                                onLoadedMetadata={(e) => {
                                                                    // Seek to current cover time or 0
                                                                    e.currentTarget.currentTime = 0.1
                                                                }}
                                                            />
                                                            <div className="absolute bottom-2 left-2 right-2 bg-black/70 rounded-lg px-2 py-1">
                                                                <p className="text-[10px] text-center text-gray-300">预览帧</p>
                                                            </div>
                                                        </div>

                                                        <div className="flex-1 space-y-3">
                                                            <p className="text-xs text-gray-400">拖动滑块选择视频中的任意帧作为封面</p>

                                                            {/* Timeline slider */}
                                                            <div className="space-y-2">
                                                                <input
                                                                    type="range"
                                                                    min="0"
                                                                    max="100"
                                                                    defaultValue="1"
                                                                    onChange={(e) => {
                                                                        const videoEl = document.getElementById(`cover-video-${video.id}`) as HTMLVideoElement
                                                                        if (videoEl && videoEl.duration) {
                                                                            videoEl.currentTime = (parseInt(e.target.value) / 100) * videoEl.duration
                                                                        }
                                                                    }}
                                                                    className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-pink-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pink-500 [&::-webkit-slider-thumb]:cursor-grab"
                                                                />
                                                                <div className="flex justify-between text-[10px] text-gray-500">
                                                                    <span>0:00</span>
                                                                    <span>视频结束</span>
                                                                </div>
                                                            </div>

                                                            {/* Action buttons */}
                                                            <div className="flex gap-2">
                                                                <button
                                                                    onClick={() => {
                                                                        const videoEl = document.getElementById(`cover-video-${video.id}`) as HTMLVideoElement
                                                                        if (videoEl) {
                                                                            try {
                                                                                const canvas = document.createElement('canvas')
                                                                                canvas.width = videoEl.videoWidth || 720
                                                                                canvas.height = videoEl.videoHeight || 1280
                                                                                const ctx = canvas.getContext('2d')
                                                                                if (ctx) {
                                                                                    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
                                                                                    const frameData = canvas.toDataURL('image/jpeg', 0.9)
                                                                                    // 保存封面数据和时间戳（毫秒）
                                                                                    const timestampMs = Math.round(videoEl.currentTime * 1000)
                                                                                    updateVideoCover(video.id, frameData, timestampMs)
                                                                                    setExpandedVideoId(null)
                                                                                }
                                                                            } catch (error) {
                                                                                console.error('Failed to capture frame:', error)
                                                                                // CORS error - suggest using upload instead
                                                                                setUploadError('无法从该视频捕获帧，请重新上传视频')
                                                                            }
                                                                        }
                                                                    }}
                                                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-pink-500 rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
                                                                >
                                                                    <Check className="w-4 h-4" />
                                                                    使用当前帧
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <p className="text-[10px] text-gray-500">
                                                        💡 拖动滑块可预览不同时间点的画面，点击"使用当前帧"确认选择。
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="text-center py-8">
                                                    <p className="text-sm text-gray-400">视频加载中或不可用，请重新上传视频</p>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })()}
                            </div>
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
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-pink-500/20 border border-cyan-500/30 text-cyan-400 hover:from-cyan-500/30 hover:to-pink-500/30 transition-all text-sm"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    去绑定
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
                                    className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-pink-500 rounded-lg font-medium hover:opacity-90 transition-opacity"
                                >
                                    立即绑定账号
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {accounts.map(account => {
                                    const isAuthorized = isAccountAuthorized(account)
                                    const isSelected = selectedAccounts.includes(account.id)

                                    return (
                                        <label
                                            key={account.id}
                                            className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all ${isSelected
                                                ? 'border-cyan-500 bg-cyan-500/10'
                                                : isAuthorized
                                                    ? 'border-white/10 bg-white/5 hover:bg-white/10'
                                                    : 'border-orange-500/30 bg-orange-500/5 cursor-not-allowed'
                                                }`}
                                        >
                                            <input
                                                type="radio"
                                                name="publishAccount"
                                                checked={isSelected}
                                                onChange={() => isAuthorized && toggleAccountSelection(account.id)}
                                                disabled={!isAuthorized}
                                                className="sr-only"
                                            />

                                            {/* Radio button visual (circle) */}
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected
                                                ? 'border-cyan-400 bg-cyan-500'
                                                : 'border-gray-500'
                                                }`}>
                                                {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                                            </div>

                                            {account.avatar_url ? (
                                                <img
                                                    src={account.avatar_url}
                                                    alt={account.display_name}
                                                    width={40}
                                                    height={40}
                                                    className="w-10 h-10 rounded-full object-cover"
                                                    onError={(e) => {
                                                        // Fallback to gradient on error
                                                        e.currentTarget.style.display = 'none'
                                                        e.currentTarget.nextElementSibling?.classList.remove('hidden')
                                                    }}
                                                />
                                            ) : null}
                                            <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center text-white font-bold ${account.avatar_url ? 'hidden' : ''}`}>
                                                {account.display_name.charAt(0).toUpperCase()}
                                            </div>

                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">@{account.display_name}</span>
                                                    {account.status === 'active' && (
                                                        <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-400">
                                                    粉丝 {account.follower_count >= 1000
                                                        ? `${(account.follower_count / 1000).toFixed(1)}K`
                                                        : account.follower_count}
                                                </p>
                                            </div>

                                            {isAuthorized ? (
                                                <span className="px-2 py-1 text-xs rounded-full bg-green-500/20 text-green-400 flex items-center gap-1">
                                                    <CheckCircle2 className="w-3 h-3" />
                                                    已授权
                                                </span>
                                            ) : (
                                                <span className="px-2 py-1 text-xs rounded-full bg-orange-500/20 text-orange-400 flex items-center gap-1">
                                                    <AlertCircle className="w-3 h-3" />
                                                    需重新授权
                                                </span>
                                            )}
                                        </label>
                                    )
                                })}

                                <button
                                    onClick={() => router.push('/publish/accounts')}
                                    className="flex items-center gap-2 w-full p-4 rounded-xl border border-dashed border-white/20 text-gray-400 hover:text-cyan-400 hover:border-cyan-500/50 transition-colors"
                                >
                                    <Plus className="w-5 h-5" />
                                    <span>绑定新账号</span>
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
                                        {/* AI Title Assistant Button */}
                                        {selectedVideos.length > 0 && (
                                            <button
                                                onClick={() => setShowTitleAssistant(true)}
                                                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 text-purple-400 hover:from-purple-500/30 hover:to-pink-500/30 transition-all text-xs"
                                            >
                                                <Sparkles className="w-3.5 h-3.5" />
                                                AI助手
                                            </button>
                                        )}

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
                                    /* Uniform title - single input for all */
                                    <textarea
                                        value={caption}
                                        onChange={(e) => setCaption(e.target.value)}
                                        placeholder="输入视频标题..."
                                        rows={3}
                                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all resize-none"
                                    />
                                ) : (
                                    /* Individual titles - one input per video */
                                    <div className="space-y-3">
                                        {selectedVideos.map((video, index) => (
                                            <div key={video.id} className="flex gap-3 items-start">
                                                <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white/5 border border-white/10">
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
                                                    ) : video.url ? (
                                                        /* Use video element to show first frame if no thumbnail */
                                                        <video
                                                            src={video.url}
                                                            className="w-full h-full object-cover"
                                                            muted
                                                            playsInline
                                                            preload="metadata"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-cyan-500/20 to-pink-500/20">
                                                            <span className="text-white/50 font-medium">{index + 1}</span>
                                                        </div>
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

                            {/* Quick action buttons */}
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

                            {/* Privacy Level Selection */}
                            <div className="mt-4">
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    可见范围
                                </label>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    {[
                                        { value: 'PUBLIC_TO_EVERYONE', label: '公开', icon: '🌍', desc: '所有人可见' },
                                        { value: 'FOLLOWER_OF_CREATOR', label: '粉丝可见', icon: '👥', desc: '仅粉丝' },
                                        { value: 'MUTUAL_FOLLOW_FRIENDS', label: '好友可见', icon: '🤝', desc: '互关好友' },
                                        { value: 'SELF_ONLY', label: '仅自己', icon: '🔒', desc: '私密' },
                                    ].map(({ value, label, icon, desc }) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setPrivacyLevel(value as typeof privacyLevel)}
                                            className={`flex flex-col items-center gap-1 px-3 py-3 rounded-xl text-center transition-all ${privacyLevel === value
                                                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                                                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                                } border`}
                                        >
                                            <span className="text-lg">{icon}</span>
                                            <span className="text-sm font-medium">{label}</span>
                                            <span className="text-[10px] text-gray-500">{desc}</span>
                                        </button>
                                    ))}
                                </div>
                                {privacyLevel === 'SELF_ONLY' && (
                                    <p className="text-xs text-yellow-500/80 mt-2 flex items-center gap-1">
                                        <span>⚠️</span>
                                        沙盒测试期间建议使用"仅自己"可见，审核通过后可选择公开发布
                                    </p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Step 3: Schedule */}
                    <section className="bg-white/5 rounded-2xl border border-white/10 p-6">
                        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-sm text-cyan-400">4</div>
                            发布时间
                        </h2>

                        <div className="space-y-4">
                            <div className="flex gap-4">
                                <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${publishMode === 'now'
                                    ? 'border-cyan-500 bg-cyan-500/10'
                                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                                    }`}>
                                    <input
                                        type="radio"
                                        name="publishMode"
                                        checked={publishMode === 'now'}
                                        onChange={() => setPublishMode('now')}
                                        className="sr-only"
                                    />
                                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${publishMode === 'now' ? 'border-cyan-400' : 'border-gray-500'
                                        }`}>
                                        {publishMode === 'now' && <div className="w-2 h-2 rounded-full bg-cyan-400" />}
                                    </div>
                                    <Rocket className="w-4 h-4" />
                                    <span>立即发布</span>
                                </label>

                                <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${publishMode === 'scheduled'
                                    ? 'border-cyan-500 bg-cyan-500/10'
                                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                                    }`}>
                                    <input
                                        type="radio"
                                        name="publishMode"
                                        checked={publishMode === 'scheduled'}
                                        onChange={() => setPublishMode('scheduled')}
                                        className="sr-only"
                                    />
                                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${publishMode === 'scheduled' ? 'border-cyan-400' : 'border-gray-500'
                                        }`}>
                                        {publishMode === 'scheduled' && <div className="w-2 h-2 rounded-full bg-cyan-400" />}
                                    </div>
                                    <Calendar className="w-4 h-4" />
                                    <span>预约发布</span>
                                </label>
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
                    </section>

                    {/* Task Preview & Submit */}
                    <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 rounded-2xl border border-cyan-500/20 p-6">
                        <div className="flex items-center justify-between flex-wrap gap-4">
                            <div className="space-y-2">
                                <h3 className="text-lg font-semibold">任务预览</h3>
                                <div className="space-y-1 text-sm">
                                    <p className="flex items-center gap-2">
                                        <span className="text-gray-400">📼</span>
                                        <span className="text-cyan-400 font-bold">{selectedVideos.length}</span>
                                        <span className="text-gray-300">个视频</span>
                                        {selectedAccounts.length > 0 && (
                                            <>
                                                <span className="text-gray-500">→</span>
                                                <span className="text-pink-400 font-medium">
                                                    @{accounts.find(a => a.id === selectedAccounts[0])?.display_name || '账号'}
                                                </span>
                                            </>
                                        )}
                                    </p>
                                    <p className="flex items-center gap-2 text-xs text-gray-400">
                                        <span>⏱️</span>
                                        <span>
                                            {publishMode === 'now' ? '立即发布' : `预约发布 ${scheduledDate} ${scheduledTime}`}
                                            {selectedVideos.length > 1 && (
                                                <>, 间隔 {intervalMode === 'custom' ? customInterval : intervalMode} 分钟</>
                                            )}
                                        </span>
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                {publishError && (
                                    <p className="text-sm text-red-400 flex items-center gap-1">
                                        <XCircle className="w-4 h-4" />
                                        {publishError}
                                    </p>
                                )}
                                <button
                                    onClick={() => {
                                        setSelectedVideos([])
                                        setSelectedAccounts([])
                                        setCaption('')
                                    }}
                                    className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-400 hover:bg-white/5 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handlePublish}
                                    disabled={isPublishing || selectedVideos.length === 0 || selectedAccounts.length === 0}
                                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-pink-500 font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {isPublishing ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            创建中...
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-4 h-4" />
                                            创建发布任务
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            )}

            {/* Task Manager Tab */}
            {activeTab === 'tasks' && (
                <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
                    <TaskManager />
                </div>
            )}

            {/* Asset Selector Modal (成品库选择器) */}
            {showAssetModal && (
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
            )}

            {/* Clear Task Confirmation Dialog */}
            {showClearConfirm && (
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
            )}


            {/* AI Title Assistant Modal */}
            {showTitleAssistant && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 rounded-2xl border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
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
                                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all resize-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">
                                            🌐 输出语言
                                        </label>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => setTitleLanguage('zh')}
                                                className={`flex-1 p-3 rounded-xl border transition-all ${titleLanguage === 'zh'
                                                    ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                                                    : 'border-white/10 text-gray-400 hover:border-white/20'
                                                    }`}
                                            >
                                                <div className="text-lg mb-1">🇨🇳</div>
                                                <div className="text-sm font-medium">中文</div>
                                                <div className="text-xs text-gray-500">适合国内平台</div>
                                            </button>
                                            <button
                                                onClick={() => setTitleLanguage('en')}
                                                className={`flex-1 p-3 rounded-xl border transition-all ${titleLanguage === 'en'
                                                    ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                                                    : 'border-white/10 text-gray-400 hover:border-white/20'
                                                    }`}
                                            >
                                                <div className="text-lg mb-1">🇺🇸</div>
                                                <div className="text-sm font-medium">English</div>
                                                <div className="text-xs text-gray-500">适合TikTok海外</div>
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
            )}

            {/* Hidden file input for cover upload */}
            <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                onChange={handleCoverUpload}
                className="hidden"
            />
        </div >
    )
}
