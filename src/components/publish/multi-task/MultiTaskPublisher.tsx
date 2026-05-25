'use client'

import {
    AlertCircle,
    CalendarClock,
    Check,
    FileText,
    FolderOpen,
    Loader2,
    Plus,
    RefreshCw,
    Shuffle,
    Sparkles,
    Trash2,
    Upload,
    Users,
} from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { applyTitlesToVideos, deriveTitleFromFilename, MULTI_TASK_DEFAULT_INTERVAL_MINUTES } from '@/lib/publish/multi-task-scheduler'
import { cn } from '@/lib/utils'

const VIDEO_FORMATS = ['.mp4', '.webm', '.mov']
const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
}
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024
const MAX_VIDEOS = 40
const UPLOAD_CONCURRENCY = 3
const DEFAULT_INTERVAL_MINUTES = String(MULTI_TASK_DEFAULT_INTERVAL_MINUTES)

const intervalOptions = [
    { label: '10 分钟', value: '10' },
    { label: '1 小时', value: '60' },
    { label: '3 小时', value: '180' },
    { label: '6 小时', value: '360' },
    { label: '12 小时', value: '720' },
    { label: '24 小时', value: '1440' },
]

const privacyOptions = [
    { label: '公开', value: 'PUBLIC_TO_EVERYONE' },
    { label: '好友', value: 'MUTUAL_FOLLOW_FRIENDS' },
    { label: '粉丝', value: 'FOLLOWER_OF_CREATOR' },
    { label: '仅自己', value: 'SELF_ONLY' },
]

interface GroupAccount {
    id: string
    display_name: string | null
    username: string | null
    avatar_url: string | null
    status: string
    token_expires_at: string | null
}

interface AccountGroup {
    id: string
    name: string
    accounts_count: number
    active_count: number
    attention_count: number
    accounts: GroupAccount[]
}

interface MultiVideo {
    id: string
    name: string
    url: string | null
    source: 'upload' | 'asset' | 'url'
    assetId?: string
    title: string
    durationMs?: number | null
    progress: number
    status: 'pending' | 'uploading' | 'done' | 'error'
    error?: string
    thumbnail?: string
    file?: File
}

interface MultiTaskAsset {
    id: string
    name: string
    source_url: string
    thumbnail_url: string | null
    prompt: string | null
    model: string | null
    created_at: string
}

interface PlanPreviewItem {
    sequence: number
    videoName: string
    title: string
    accountDisplayName?: string | null
    scheduledAt: string
    planRound: number
}

interface PlanPreview {
    previewToken: string
    summary: {
        videoCount: number
        accountCount: number
        minPerAccount: number
        maxPerAccount: number
        firstScheduledAt: string
        lastScheduledAt: string
        intervalMinutes: number
        accountSpacingMinutes: number
        jitterEnabled: boolean
        assignmentStrategy: 'round_robin' | 'random_balanced'
    }
    items: PlanPreviewItem[]
}

interface CapabilitySummary {
    ready_count: number
    blocked_count: number
    privacy_level_options: string[]
    comment_disabled: boolean
    duet_disabled: boolean
    stitch_disabled: boolean
    max_video_post_duration_sec: number
    defaults: {
        allow_comment: boolean
        allow_duet: boolean
        allow_stitch: boolean
        brand_content_toggle: boolean
        brand_organic_toggle: boolean
        is_ai_generated: boolean
        cover_timestamp_ms: number
    }
    warnings: string[]
}

interface CapabilityResponse {
    accounts: Array<{
        id: string
        status: 'ready' | 'blocked'
        error?: string
    }>
    summary: CapabilitySummary
}

interface MultiTaskPublisherProps {
    onCreated?: () => void
}

function isAccountAuthorized(account: GroupAccount) {
    return account.status === 'active' && !!account.token_expires_at && new Date(account.token_expires_at) > new Date()
}

function formatDateTime(value: string | null | undefined) {
    if (!value) return '-'
    return new Date(value).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function getLocalDateTimeValue(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function validateFile(file: File) {
    const ext = `.${file.name.split('.').pop()?.toLowerCase()}`
    if (!VIDEO_FORMATS.includes(ext)) {
        return `不支持 ${ext} 格式`
    }
    if (file.size > MAX_FILE_SIZE) {
        return '单个视频不能超过 4GB'
    }
    return null
}

function getFileContentType(file: File) {
    const ext = `.${file.name.split('.').pop()?.toLowerCase()}`
    return file.type || VIDEO_MIME_BY_EXTENSION[ext] || 'video/mp4'
}

function makePlanSeed() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `seed-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readVideoMetadata(file: File): Promise<{ thumbnail: string; durationMs: number | null }> {
    return new Promise((resolve) => {
        const video = document.createElement('video')
        const url = URL.createObjectURL(file)
        let durationMs: number | null = null
        let settled = false

        const finish = (thumbnail: string) => {
            if (settled) return
            settled = true
            URL.revokeObjectURL(url)
            resolve({ thumbnail, durationMs })
        }

        video.src = url
        video.muted = true
        video.preload = 'metadata'
        video.playsInline = true

        video.onloadedmetadata = () => {
            durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null
            video.currentTime = Math.min(1, video.duration / 2 || 0)
        }

        video.onseeked = () => {
            const canvas = document.createElement('canvas')
            canvas.width = video.videoWidth || 180
            canvas.height = video.videoHeight || 320
            const ctx = canvas.getContext('2d')
            if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                finish(canvas.toDataURL('image/jpeg', 0.72))
            } else {
                finish('')
            }
        }

        video.onerror = () => finish('')
        setTimeout(() => finish(''), 12000)
    })
}

function putFileToOss(file: File, uploadUrl: string, contentType: string, onProgress: (progress: number) => void) {
    return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return
            onProgress(Math.round((event.loaded / event.total) * 100))
        }
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve()
            } else {
                reject(new Error(`OSS 上传失败 (${xhr.status})`))
            }
        }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.ontimeout = () => reject(new Error('上传超时'))
        xhr.open('PUT', uploadUrl)
        xhr.timeout = 600000
        xhr.setRequestHeader('Content-Type', contentType)
        xhr.send(file)
    })
}

export function MultiTaskPublisher({ onCreated }: MultiTaskPublisherProps) {
    const { toast } = useToast()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const planSeedRef = useRef('')
    const [groups, setGroups] = useState<AccountGroup[]>([])
    const [loadingGroups, setLoadingGroups] = useState(false)
    const [selectedGroupId, setSelectedGroupId] = useState('')
    const [videos, setVideos] = useState<MultiVideo[]>([])
    const [taskName, setTaskName] = useState('')
    const [privacyLevel, setPrivacyLevel] = useState('')
    const [assignmentStrategy, setAssignmentStrategy] = useState<'round_robin' | 'random_balanced'>('round_robin')
    const [timingMode, setTimingMode] = useState<'now' | 'scheduled'>('now')
    const [startAt, setStartAt] = useState(() => getLocalDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)))
    const [intervalMinutes, setIntervalMinutes] = useState(DEFAULT_INTERVAL_MINUTES)
    const [jitterEnabled, setJitterEnabled] = useState(false)
    const [quickDialogOpen, setQuickDialogOpen] = useState(false)
    const [quickMode, setQuickMode] = useState<'same' | 'different'>('same')
    const [quickText, setQuickText] = useState('')
    const [aiDialogOpen, setAiDialogOpen] = useState(false)
    const [aiPrompt, setAiPrompt] = useState('')
    const [aiLanguage, setAiLanguage] = useState<'zh' | 'en'>('en')
    const [aiLoading, setAiLoading] = useState(false)
    const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null)
    const [capabilityLoading, setCapabilityLoading] = useState(false)
    const [capabilityError, setCapabilityError] = useState<string | null>(null)
    const [assetDialogOpen, setAssetDialogOpen] = useState(false)
    const [assets, setAssets] = useState<MultiTaskAsset[]>([])
    const [loadingAssets, setLoadingAssets] = useState(false)
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
    const [transferringAssets, setTransferringAssets] = useState(false)
    const [preview, setPreview] = useState<PlanPreview | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [creating, setCreating] = useState(false)

    if (!planSeedRef.current) {
        planSeedRef.current = makePlanSeed()
    }

    const selectedGroup = useMemo(
        () => groups.find((group) => group.id === selectedGroupId) || null,
        [groups, selectedGroupId]
    )

    const activeAccounts = useMemo(
        () => selectedGroup?.accounts.filter(isAccountAuthorized) || [],
        [selectedGroup]
    )

    const readyVideos = videos.filter((video) => video.status === 'done' && video.url)
    const hasUploading = videos.some((video) => video.status === 'uploading' || video.status === 'pending')
    const capabilitySummary = capabilities?.summary || null
    const availablePrivacyOptions = capabilitySummary
        ? capabilitySummary.privacy_level_options
        : privacyOptions.map((option) => option.value)
    const displayedPrivacyOptions = privacyOptions.filter((option) => availablePrivacyOptions.includes(option.value))
    const privacyLevelAllowed = !!privacyLevel && availablePrivacyOptions.includes(privacyLevel)
    const overDurationVideos = capabilitySummary?.max_video_post_duration_sec
        ? readyVideos.filter((video) => Number(video.durationMs || 0) > capabilitySummary.max_video_post_duration_sec * 1000)
        : []
    const capabilityReady = !!capabilitySummary
        && !capabilityLoading
        && !capabilityError
        && capabilitySummary.blocked_count === 0
        && capabilitySummary.ready_count === activeAccounts.length
        && overDurationVideos.length === 0
    const allTitlesReady = readyVideos.length > 0 && readyVideos.every((video) => video.title.trim().length > 0)
    const formReady = readyVideos.length > 0
        && !!selectedGroupId
        && activeAccounts.length > 0
        && readyVideos.length >= activeAccounts.length
        && !!taskName.trim()
        && privacyLevelAllowed
        && allTitlesReady
        && capabilityReady
        && !hasUploading
    const canPreview = formReady && !creating
    const canCreate = formReady && !!preview?.previewToken && !creating

    const fetchGroups = useCallback(async () => {
        setLoadingGroups(true)
        try {
            const res = await fetch('/api/publish/account-groups')
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || '获取账号分组失败')
            setGroups(data.groups || [])
        } catch (error) {
            toast({
                title: '加载失败',
                description: error instanceof Error ? error.message : '无法获取账号分组',
                variant: 'destructive',
            })
        } finally {
            setLoadingGroups(false)
        }
    }, [toast])

    useEffect(() => {
        fetchGroups()
    }, [fetchGroups])

    useEffect(() => {
        setPreview(null)
    }, [videos, selectedGroupId, assignmentStrategy, privacyLevel, timingMode, startAt, intervalMinutes, jitterEnabled])

    useEffect(() => {
        setCapabilities(null)
        setCapabilityError(null)
        setPreview(null)

        if (!selectedGroupId) return

        const controller = new AbortController()
        async function fetchCapabilities() {
            setCapabilityLoading(true)
            try {
                const res = await fetch('/api/publish/multi-task/creator-capabilities', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ account_group_id: selectedGroupId }),
                    signal: controller.signal,
                })
                const data = await res.json()
                if (!res.ok || !data.success) throw new Error(data.error || '获取账号能力失败')

                const nextCapabilities = data as CapabilityResponse
                setCapabilities(nextCapabilities)
                setPrivacyLevel((current) => (
                    current && nextCapabilities.summary.privacy_level_options.includes(current)
                        ? current
                        : ''
                ))
            } catch (error) {
                if ((error as Error).name === 'AbortError') return
                const message = error instanceof Error ? error.message : '获取账号能力失败'
                setCapabilityError(message)
                toast({ title: '账号能力检查失败', description: message, variant: 'destructive' })
            } finally {
                if (!controller.signal.aborted) {
                    setCapabilityLoading(false)
                }
            }
        }

        fetchCapabilities()
        return () => controller.abort()
    }, [selectedGroupId, toast])

    function updateVideo(id: string, patch: Partial<MultiVideo>) {
        setVideos((current) => current.map((video) => video.id === id ? { ...video, ...patch } : video))
    }

    function toVideoInputs(targetVideos: MultiVideo[]) {
        return targetVideos.map((video) => ({
            id: video.id,
            name: video.name,
            url: video.url || '',
            source: video.source,
            title: video.title,
        }))
    }

    function applyTitlesByVideoId(updatedVideos: Array<{ id: string; title?: string }>) {
        const titleById = new Map(
            updatedVideos
                .filter((video) => typeof video.title === 'string')
                .map((video) => [video.id, video.title || ''])
        )

        setVideos((current) => current.map((video) => (
            titleById.has(video.id)
                ? { ...video, title: titleById.get(video.id) || video.title }
                : video
        )))
    }

    async function requestUploadCredential(video: MultiVideo) {
        if (!video.file) {
            throw new Error('视频文件不存在')
        }

        const credentialsRes = await fetch('/api/publish/multi-task/upload-credentials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [{
                    id: video.id,
                    filename: video.name,
                    contentType: getFileContentType(video.file),
                    size: video.file.size,
                }],
            }),
        })
        const credentialsData = await credentialsRes.json()
        if (!credentialsRes.ok || !credentialsData.success) {
            throw new Error(credentialsData.error || '获取上传地址失败')
        }

        const upload = credentialsData.uploads?.[0] as { id: string; uploadUrl: string; publicUrl: string } | undefined
        if (!upload?.uploadUrl || !upload.publicUrl) {
            throw new Error('上传地址无效')
        }

        return upload
    }

    async function handleFiles(files: FileList | null) {
        if (!files?.length) return

        const incoming = Array.from(files)
        if (videos.length + incoming.length > MAX_VIDEOS) {
            toast({ title: '数量过多', description: `一次最多选择 ${MAX_VIDEOS} 个视频`, variant: 'destructive' })
            return
        }

        const valid: MultiVideo[] = []
        for (const file of incoming) {
            const error = validateFile(file)
            if (error) {
                toast({ title: file.name, description: error, variant: 'destructive' })
                continue
            }
            valid.push({
                id: `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: file.name,
                url: null,
                source: 'upload',
                title: deriveTitleFromFilename(file.name),
                progress: 0,
                status: 'pending',
                file,
            })
        }

        if (!valid.length) return
        setVideos((current) => [...current, ...valid])

        try {
            let cursor = 0

            async function worker() {
                while (cursor < valid.length) {
                    const item = valid[cursor++]
                    if (!item.file) continue

                    updateVideo(item.id, { status: 'uploading', progress: 3 })
                    try {
                        const upload = await requestUploadCredential(item)
                        const metadataPromise = readVideoMetadata(item.file)
                        await putFileToOss(item.file, upload.uploadUrl, getFileContentType(item.file), (progress) => {
                            updateVideo(item.id, { progress: Math.max(3, Math.min(98, progress)) })
                        })
                        const { thumbnail, durationMs } = await metadataPromise
                        updateVideo(item.id, {
                            url: upload.publicUrl,
                            thumbnail,
                            durationMs,
                            progress: 100,
                            status: 'done',
                            file: undefined,
                        })
                    } catch (error) {
                        updateVideo(item.id, {
                            status: 'error',
                            progress: 0,
                            error: error instanceof Error ? error.message : '上传失败',
                        })
                    }
                }
            }

            await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, valid.length) }, worker))
        } catch (error) {
            const message = error instanceof Error ? error.message : '上传失败'
            setVideos((current) => current.map((video) => (
                valid.some((item) => item.id === video.id) && video.status !== 'done'
                    ? { ...video, status: 'error', error: message }
                    : video
            )))
            toast({ title: '上传失败', description: message, variant: 'destructive' })
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    async function fetchAssets() {
        setLoadingAssets(true)
        try {
            const res = await fetch('/api/publish/multi-task/assets')
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || '获取制作区视频失败')
            setAssets(data.assets || [])
        } catch (error) {
            toast({
                title: '加载失败',
                description: error instanceof Error ? error.message : '无法获取制作区视频',
                variant: 'destructive',
            })
        } finally {
            setLoadingAssets(false)
        }
    }

    async function openAssetDialog() {
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

    async function transferAsset(asset: MultiTaskAsset) {
        const res = await fetch('/api/publish/multi-task/asset-transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_url: asset.source_url,
                filename: asset.name || asset.prompt || 'video',
            }),
        })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || '转存视频失败')
        return data.data as { url: string; size?: number }
    }

    async function addSelectedAssets() {
        if (selectedAssetIds.length === 0) return

        const selectedAssets = assets.filter((asset) => selectedAssetIds.includes(asset.id))
        const existingAssetIds = new Set(videos.map((video) => video.assetId).filter(Boolean))
        const uniqueAssets = selectedAssets.filter((asset) => !existingAssetIds.has(asset.id))

        if (uniqueAssets.length === 0) {
            toast({ title: '无需重复添加', description: '选择的视频已经在任务中。' })
            return
        }

        if (videos.length + uniqueAssets.length > MAX_VIDEOS) {
            toast({
                title: '数量过多',
                description: `最多保留 ${MAX_VIDEOS} 个视频，请减少选择数量。`,
                variant: 'destructive',
            })
            return
        }

        const createdAt = Date.now()
        const nextVideos: MultiVideo[] = uniqueAssets.map((asset, index) => ({
            id: `asset-${asset.id}-${createdAt}-${index}`,
            name: asset.name || `制作区视频 ${index + 1}`,
            url: null,
            source: 'asset',
            assetId: asset.id,
            title: deriveTitleFromFilename(asset.name || asset.prompt || `video-${index + 1}`),
            progress: 5,
            status: 'uploading',
            thumbnail: asset.thumbnail_url || undefined,
        }))

        setVideos((current) => [...current, ...nextVideos])
        setTransferringAssets(true)

        try {
            let cursor = 0
            async function worker() {
                while (cursor < uniqueAssets.length) {
                    const asset = uniqueAssets[cursor]
                    const video = nextVideos[cursor]
                    cursor += 1

                    updateVideo(video.id, { status: 'uploading', progress: 10 })
                    try {
                        const transferred = await transferAsset(asset)
                        updateVideo(video.id, {
                            url: transferred.url,
                            progress: 100,
                            status: 'done',
                        })
                    } catch (error) {
                        updateVideo(video.id, {
                            status: 'error',
                            progress: 0,
                            error: error instanceof Error ? error.message : '转存失败',
                        })
                    }
                }
            }

            await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, uniqueAssets.length) }, worker))
            setSelectedAssetIds([])
            setAssetDialogOpen(false)
        } finally {
            setTransferringAssets(false)
        }
    }

    function removeVideo(id: string) {
        setVideos((current) => current.filter((video) => video.id !== id))
    }

    function applyQuickTitles() {
        const targetVideos = readyVideos
        const titles = quickText.split('\n').map((line) => line.trim()).filter(Boolean)

        if (targetVideos.length === 0) {
            toast({ title: '请先完成视频上传', variant: 'destructive' })
            return
        }

        if (quickMode === 'same' && titles.length < 1) {
            toast({ title: '请输入标题', variant: 'destructive' })
            return
        }

        if (quickMode === 'different' && titles.length !== targetVideos.length) {
            toast({
                title: '数量不一致',
                description: `需要 ${targetVideos.length} 行标题，当前 ${titles.length} 行`,
                variant: 'destructive',
            })
            return
        }

        const updated = applyTitlesToVideos(
            toVideoInputs(targetVideos),
            titles,
            quickMode
        )
        applyTitlesByVideoId(updated)
        setQuickDialogOpen(false)
        setQuickText('')
    }

    function applyFilenameTitles() {
        if (readyVideos.length === 0) {
            toast({ title: '请先完成视频上传', variant: 'destructive' })
            return
        }

        const updated = applyTitlesToVideos(toVideoInputs(readyVideos), [], 'filename')
        applyTitlesByVideoId(updated)
    }

    async function generateAiTitles() {
        const targetVideos = readyVideos
        if (!aiPrompt.trim() || targetVideos.length === 0) return
        setAiLoading(true)
        try {
            const res = await fetch('/api/publish/generate-titles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: aiPrompt,
                    count: targetVideos.length,
                    language: aiLanguage,
                }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || '生成失败')
            const titles = (data.titles || []).map((item: { combined?: string }) => item.combined || '').filter(Boolean)
            applyTitlesByVideoId(targetVideos.map((video, index) => ({ id: video.id, title: titles[index] || video.title })))
            setAiDialogOpen(false)
            setAiPrompt('')
        } catch (error) {
            toast({
                title: 'AI 写标题失败',
                description: error instanceof Error ? error.message : '请稍后再试',
                variant: 'destructive',
            })
        } finally {
            setAiLoading(false)
        }
    }

    function buildPayload() {
        return {
            account_group_id: selectedGroupId,
            seed: planSeedRef.current,
            videos: readyVideos.map((video) => ({
                id: video.id,
                name: video.name,
                url: video.url,
                source: video.source,
                title: video.title.trim(),
                duration_ms: video.durationMs || null,
            })),
            assignment_strategy: assignmentStrategy,
            privacy_level: privacyLevel,
            timing: {
                mode: timingMode,
                start_at: timingMode === 'scheduled' ? new Date(startAt).toISOString() : null,
                interval_minutes: Number(intervalMinutes),
                jitter_enabled: jitterEnabled,
                jitter_min_seconds: 60,
                jitter_max_seconds: 300,
            },
        }
    }

    async function refreshPreview() {
        setPreviewLoading(true)
        try {
            const res = await fetch('/api/publish/multi-task/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildPayload()),
            })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || '预览失败')
            if (data.seed) planSeedRef.current = data.seed
            setPreview({ ...data.plan, previewToken: data.previewToken || data.plan?.previewToken || '' })
        } catch (error) {
            toast({
                title: '预览失败',
                description: error instanceof Error ? error.message : '请检查视频、标题和账号分组',
                variant: 'destructive',
            })
        } finally {
            setPreviewLoading(false)
        }
    }

    async function createTask() {
        if (!canCreate) return
        setCreating(true)
        try {
            const payload = {
                ...buildPayload(),
                preview_token: preview?.previewToken,
                idempotency_key: makePlanSeed(),
                name: taskName.trim(),
            }
            const res = await fetch('/api/publish/multi-task/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || '创建任务失败')

            toast({ title: '任务已创建', description: '可在任务管理查看执行进度' })
            setVideos([])
            setTaskName('')
            setPreview(null)
            planSeedRef.current = makePlanSeed()
            onCreated?.()
        } catch (error) {
            toast({
                title: '创建失败',
                description: error instanceof Error ? error.message : '请稍后再试',
                variant: 'destructive',
            })
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className="space-y-6">
            <input
                ref={fileInputRef}
                type="file"
                accept={VIDEO_FORMATS.join(',')}
                multiple
                className="hidden"
                onChange={(event) => handleFiles(event.target.files)}
            />

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                            <Upload className="h-5 w-5 text-cyan-300" />
                            上传视频
                        </h2>
                        <p className="mt-1 text-sm text-white/50">最多 {MAX_VIDEOS} 个，上传完成后每个视频只会分配给一个账号。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="mermaid-ghost" onClick={openAssetDialog} disabled={hasUploading || transferringAssets}>
                            <FolderOpen className="h-4 w-4" />
                            从视频制作区选择
                        </Button>
                        <Button variant="mermaid" onClick={() => fileInputRef.current?.click()} disabled={hasUploading || transferringAssets}>
                            <Plus className="h-4 w-4" />
                            选择视频
                        </Button>
                    </div>
                </div>

                {videos.length === 0 ? (
                    <div className="grid min-h-[220px] grid-cols-1 gap-3 md:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20 text-white/45 transition hover:border-cyan-300/50 hover:text-cyan-200"
                        >
                            <Upload className="mb-3 h-9 w-9" />
                            <span className="text-sm">本地选择 .mp4 .webm .mov</span>
                        </button>
                        <button
                            type="button"
                            onClick={openAssetDialog}
                            className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20 text-white/45 transition hover:border-cyan-300/50 hover:text-cyan-200"
                        >
                            <FolderOpen className="mb-3 h-9 w-9" />
                            <span className="text-sm">从视频制作区选择</span>
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {videos.map((video, index) => (
                            <div key={video.id} className="flex gap-3 rounded-xl border border-white/10 bg-black/25 p-3">
                                <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-900">
                                    {video.thumbnail ? (
                                        <Image
                                            src={video.thumbnail}
                                            alt=""
                                            fill
                                            sizes="64px"
                                            unoptimized
                                            className="object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-white/30">
                                            <FileText className="h-5 w-5" />
                                        </div>
                                    )}
                                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/70">{index + 1}</span>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start gap-2">
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium text-white" title={video.name}>{video.name}</p>
                                            <div className="mt-1 flex items-center gap-2 text-xs">
                                                {video.status === 'done' && <span className="text-emerald-300">已上传</span>}
                                                {video.status === 'uploading' && <span className="text-cyan-300">上传中 {video.progress}%</span>}
                                                {video.status === 'pending' && <span className="text-white/45">等待上传</span>}
                                                {video.status === 'error' && <span className="text-rose-300">{video.error || '失败'}</span>}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeVideo(video.id)}
                                            className="rounded-md p-1 text-white/35 hover:bg-rose-500/10 hover:text-rose-300"
                                            title="移除"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                    {video.status === 'uploading' && (
                                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                                            <div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${video.progress}%` }} />
                                        </div>
                                    )}
                                    <Input
                                        value={video.title}
                                        onChange={(event) => updateVideo(video.id, { title: event.target.value.slice(0, 2200) })}
                                        placeholder="填写标题"
                                        className="mt-3 h-9 border-white/10 bg-white/[0.04] text-sm text-white"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                            <Users className="h-5 w-5 text-cyan-300" />
                            选择账号分组
                        </h2>
                        <p className="mt-1 text-sm text-white/50">视频数量必须不少于分组内可用账号数量。</p>
                    </div>
                    <Button variant="mermaid-ghost" onClick={fetchGroups} disabled={loadingGroups}>
                        <RefreshCw className={cn('h-4 w-4', loadingGroups && 'animate-spin')} />
                        刷新
                    </Button>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {groups.map((group) => {
                        const activeCount = group.accounts.filter(isAccountAuthorized).length
                        const selected = selectedGroupId === group.id
                        return (
                            <button
                                key={group.id}
                                type="button"
                                onClick={() => setSelectedGroupId(group.id)}
                                className={cn(
                                    'rounded-xl border p-4 text-left transition',
                                    selected
                                        ? 'border-cyan-300/60 bg-cyan-300/10 shadow-[0_0_20px_rgba(34,211,238,0.12)]'
                                        : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.06]'
                                )}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="font-medium text-white">{group.name}</p>
                                        <p className="mt-1 text-xs text-white/50">
                                            可用 {activeCount} / 共 {group.accounts_count || group.accounts.length} 个账号
                                        </p>
                                    </div>
                                    <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border', selected ? 'border-cyan-300 bg-cyan-300 text-black' : 'border-white/20')}>
                                        {selected && <Check className="h-3.5 w-3.5" />}
                                    </span>
                                </div>
                            </button>
                        )
                    })}
                </div>

                {selectedGroup && (
                    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
                        {capabilityLoading && (
                            <div className="flex items-center gap-2 text-white/55">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                正在检查账号发布能力
                            </div>
                        )}
                        {!capabilityLoading && capabilityError && (
                            <div className="flex items-start gap-2 text-rose-300">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{capabilityError}</span>
                            </div>
                        )}
                        {!capabilityLoading && capabilitySummary && (
                            <div className="space-y-2 text-white/60">
                                <p>
                                    可发布账号 {capabilitySummary.ready_count} 个
                                    {capabilitySummary.blocked_count > 0 ? `，需处理 ${capabilitySummary.blocked_count} 个账号` : ''}
                                </p>
                                <p>
                                    可见范围：{displayedPrivacyOptions.map((option) => option.label).join('、') || '暂无可用选项'}
                                    {capabilitySummary.max_video_post_duration_sec > 0
                                        ? ` · 最长 ${capabilitySummary.max_video_post_duration_sec} 秒`
                                        : ''}
                                </p>
                                {capabilitySummary.warnings.length > 0 && (
                                    <div className="space-y-1 text-amber-300">
                                        {capabilitySummary.warnings.map((warning) => (
                                            <p key={warning}>{warning}</p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {!loadingGroups && groups.length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-white/45">
                        还没有账号分组，请先到账号管理创建分组。
                    </div>
                )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                            <Sparkles className="h-5 w-5 text-pink-300" />
                            视频标题
                        </h2>
                        <p className="mt-1 text-sm text-white/50">每个视频需要一条独立标题。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="mermaid-ghost" size="sm" onClick={() => { setQuickMode('same'); setQuickDialogOpen(true) }}>
                            相同内容
                        </Button>
                        <Button variant="mermaid-ghost" size="sm" onClick={applyFilenameTitles}>
                            按文件名
                        </Button>
                        <Button variant="mermaid-ghost" size="sm" onClick={() => { setQuickMode('different'); setQuickDialogOpen(true) }}>
                            不同内容
                        </Button>
                        <Button variant="mermaid-ghost" size="sm" onClick={() => setAiDialogOpen(true)}>
                            <Sparkles className="h-3.5 w-3.5" />
                            AI 写标题
                        </Button>
                    </div>
                </div>

                {readyVideos.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-white/45">
                        上传完成后可编辑标题。
                    </div>
                ) : (
                    <div className="space-y-2">
                        {readyVideos.map((video, index) => (
                            <div key={video.id} className="flex flex-col gap-2 rounded-xl bg-black/20 p-3 md:flex-row md:items-center">
                                <div className="w-full text-sm text-white/65 md:w-56">
                                    {index + 1}. <span className="line-clamp-1 inline align-bottom">{video.name}</span>
                                </div>
                                <Input
                                    value={video.title}
                                    onChange={(event) => updateVideo(video.id, { title: event.target.value.slice(0, 2200) })}
                                    className="border-white/10 bg-white/[0.04] text-white"
                                />
                                <span className="text-xs text-white/35 md:w-16 md:text-right">{video.title.length}/2200</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-white">
                    <CalendarClock className="h-5 w-5 text-cyan-300" />
                    发布设置
                </h2>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                        <label className="mb-2 block text-sm text-white/70">任务名称</label>
                        <Input
                            value={taskName}
                            onChange={(event) => setTaskName(event.target.value.slice(0, 100))}
                            placeholder="请输入任务名称"
                            className="border-white/10 bg-white/[0.04] text-white"
                        />
                    </div>
                    <div>
                        <label className="mb-2 block text-sm text-white/70">可见范围</label>
                        <Select value={privacyLevel} onValueChange={setPrivacyLevel}>
                            <SelectTrigger className="border-white/10 bg-white/[0.04] text-white">
                                <SelectValue placeholder="请选择" />
                            </SelectTrigger>
                            <SelectContent>
                                {displayedPrivacyOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {capabilitySummary && !privacyLevelAllowed && (
                            <p className="mt-2 text-xs text-amber-300">请选择当前账号组支持的可见范围。</p>
                        )}
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <div>
                        <label className="mb-2 block text-sm text-white/70">分配方式</label>
                        <div className="grid grid-cols-2 gap-2 rounded-xl bg-black/25 p-1">
                            <button
                                type="button"
                                onClick={() => setAssignmentStrategy('round_robin')}
                                className={cn('rounded-lg px-3 py-2 text-sm transition', assignmentStrategy === 'round_robin' ? 'bg-white text-black' : 'text-white/55 hover:bg-white/10')}
                            >
                                顺序轮换
                            </button>
                            <button
                                type="button"
                                onClick={() => setAssignmentStrategy('random_balanced')}
                                className={cn('rounded-lg px-3 py-2 text-sm transition', assignmentStrategy === 'random_balanced' ? 'bg-white text-black' : 'text-white/55 hover:bg-white/10')}
                            >
                                随机均衡
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-sm text-white/70">发布时间</label>
                        <div className="grid grid-cols-2 gap-2 rounded-xl bg-black/25 p-1">
                            <button
                                type="button"
                                onClick={() => setTimingMode('now')}
                                className={cn('rounded-lg px-3 py-2 text-sm transition', timingMode === 'now' ? 'bg-white text-black' : 'text-white/55 hover:bg-white/10')}
                            >
                                立即发布
                            </button>
                            <button
                                type="button"
                                onClick={() => setTimingMode('scheduled')}
                                className={cn('rounded-lg px-3 py-2 text-sm transition', timingMode === 'scheduled' ? 'bg-white text-black' : 'text-white/55 hover:bg-white/10')}
                            >
                                定时发布
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-sm text-white/70">同账号间隔</label>
                        <Select value={intervalMinutes} onValueChange={setIntervalMinutes}>
                            <SelectTrigger className="border-white/10 bg-white/[0.04] text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {intervalOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {timingMode === 'scheduled' && (
                    <div className="mt-5 max-w-sm">
                        <label className="mb-2 block text-sm text-white/70">开始时间</label>
                        <Input
                            type="datetime-local"
                            value={startAt}
                            onChange={(event) => setStartAt(event.target.value)}
                            className="border-white/10 bg-white/[0.04] text-white"
                        />
                    </div>
                )}

                <div className="mt-5 flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
                    <Switch checked={jitterEnabled} onCheckedChange={setJitterEnabled} className="mt-1" />
                    <div>
                        <p className="text-sm font-medium text-white">追加随机时间</p>
                        <p className="mt-1 text-sm text-white/50">开启后每条任务会增加 1 到 5 分钟延迟，让节奏更自然。</p>
                    </div>
                </div>

                <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
                    <p>
                        默认参数：{capabilitySummary?.defaults.allow_comment === false ? '关闭评论' : '允许评论'}、
                        关闭合拍、{capabilitySummary?.defaults.allow_stitch === false ? '关闭引用' : '开启引用'}、
                        关闭商业内容、开启 AI 标识、封面使用首帧。
                    </p>
                </div>

                {overDurationVideos.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-200">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                            {overDurationVideos[0].name} 超过当前账号组允许的视频时长，请更换视频或账号组。
                        </span>
                    </div>
                )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                            <Shuffle className="h-5 w-5 text-cyan-300" />
                            计划预览
                        </h2>
                        {preview && (
                            <p className="mt-1 text-sm text-white/50">
                                {preview.summary.videoCount} 个视频 · {preview.summary.accountCount} 个账号 · 每个账号 {preview.summary.minPerAccount}
                                {preview.summary.minPerAccount !== preview.summary.maxPerAccount ? `-${preview.summary.maxPerAccount}` : ''} 条
                            </p>
                        )}
                    </div>
                    <Button variant="mermaid-ghost" onClick={refreshPreview} disabled={previewLoading || !canPreview}>
                        {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        生成预览
                    </Button>
                </div>

                {!preview ? (
                    <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-white/45">
                        完成视频、分组、标题与时间设置后生成预览。
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-white/10">
                        <div className="grid grid-cols-[64px_1.1fr_1fr_1fr] bg-white/[0.06] px-4 py-2 text-xs text-white/45">
                            <span>序号</span>
                            <span>视频</span>
                            <span>账号</span>
                            <span>时间</span>
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                            {preview.items.map((item) => (
                                <div key={`${item.sequence}-${item.videoName}`} className="grid grid-cols-[64px_1.1fr_1fr_1fr] border-t border-white/5 px-4 py-3 text-sm">
                                    <span className="text-white/35">{item.sequence + 1}</span>
                                    <span className="min-w-0">
                                        <span className="block truncate text-white/80">{item.videoName}</span>
                                        <span className="mt-0.5 block truncate text-xs text-white/35">{item.title}</span>
                                    </span>
                                    <span className="truncate text-white/60">{item.accountDisplayName || '账号'}</span>
                                    <span className="text-white/60">{formatDateTime(item.scheduledAt)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/50 backdrop-blur">
                <div className="flex items-center gap-2 text-sm text-white/50">
                    {!canCreate && <AlertCircle className="h-4 w-4 text-amber-300" />}
                    {readyVideos.length}/{MAX_VIDEOS} 个视频
                    {selectedGroup && <span>· {activeAccounts.length} 个可用账号</span>}
                    {formReady && !preview && <span>· 请先生成预览</span>}
                </div>
                <div className="flex gap-2">
                    <Button variant="mermaid-ghost" onClick={() => { setVideos([]); setPreview(null) }} disabled={creating || hasUploading}>
                        清空
                    </Button>
                    <Button variant="mermaid" onClick={createTask} disabled={!canCreate}>
                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        创建任务
                    </Button>
                </div>
            </div>

            <Dialog
                open={assetDialogOpen}
                onOpenChange={(open) => {
                    if (transferringAssets) return
                    setAssetDialogOpen(open)
                }}
            >
                <DialogContent className="border-white/10 bg-zinc-950 text-white sm:max-w-5xl">
                    <DialogHeader>
                        <DialogTitle>从视频制作区选择</DialogTitle>
                    </DialogHeader>

                    <div className="flex items-center justify-between gap-3 text-sm text-white/50">
                        <span>已选择 {selectedAssetIds.length} 个视频</span>
                        <Button variant="mermaid-ghost" size="sm" onClick={fetchAssets} disabled={loadingAssets || transferringAssets}>
                            <RefreshCw className={cn('h-3.5 w-3.5', loadingAssets && 'animate-spin')} />
                            刷新
                        </Button>
                    </div>

                    <div className="max-h-[58vh] overflow-y-auto pr-1">
                        {loadingAssets && (
                            <div className="flex min-h-56 items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-white/45">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                正在加载视频
                            </div>
                        )}
                        {!loadingAssets && assets.length === 0 && (
                            <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-white/10 text-white/45">
                                暂无可用视频
                            </div>
                        )}
                        {!loadingAssets && assets.length > 0 && (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {assets.map((asset) => {
                                    const selected = selectedAssetIds.includes(asset.id)
                                    const alreadyAdded = videos.some((video) => video.assetId === asset.id)
                                    return (
                                        <button
                                            key={asset.id}
                                            type="button"
                                            disabled={transferringAssets || alreadyAdded}
                                            onClick={() => toggleAssetSelection(asset.id)}
                                            className={cn(
                                                'group flex gap-3 rounded-xl border p-3 text-left transition',
                                                selected
                                                    ? 'border-cyan-300/70 bg-cyan-300/10'
                                                    : 'border-white/10 bg-black/25 hover:border-white/25 hover:bg-white/[0.05]',
                                                alreadyAdded && 'cursor-not-allowed opacity-55'
                                            )}
                                        >
                                            <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-900">
                                                {asset.thumbnail_url ? (
                                                    <div
                                                        className="h-full w-full bg-cover bg-center"
                                                        style={{ backgroundImage: `url("${asset.thumbnail_url.replace(/"/g, '%22')}")` }}
                                                    />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center text-white/30">
                                                        <FileText className="h-5 w-5" />
                                                    </div>
                                                )}
                                                {(selected || alreadyAdded) && (
                                                    <span className={cn(
                                                        'absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full',
                                                        alreadyAdded ? 'bg-white/20 text-white/60' : 'bg-cyan-300 text-black'
                                                    )}>
                                                        <Check className="h-3.5 w-3.5" />
                                                    </span>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="line-clamp-2 text-sm font-medium text-white">{asset.name}</p>
                                                <p className="mt-1 text-xs text-white/40">{formatDateTime(asset.created_at)}</p>
                                                {asset.model && <p className="mt-1 truncate text-xs text-white/35">{asset.model}</p>}
                                                {alreadyAdded && <p className="mt-2 text-xs text-cyan-200">已加入任务</p>}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="mermaid-ghost" onClick={() => setAssetDialogOpen(false)} disabled={transferringAssets}>取消</Button>
                        <Button variant="mermaid" onClick={addSelectedAssets} disabled={selectedAssetIds.length === 0 || transferringAssets}>
                            {transferringAssets ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            添加到任务
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={quickDialogOpen} onOpenChange={setQuickDialogOpen}>
                <DialogContent className="border-white/10 bg-zinc-950 text-white sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{quickMode === 'same' ? '插入相同内容' : '插入不同内容'}</DialogTitle>
                    </DialogHeader>
                    <Textarea
                        value={quickText}
                        onChange={(event) => setQuickText(event.target.value)}
                        placeholder={quickMode === 'same' ? '输入一条标题，应用到全部视频' : '每行一条标题，按视频顺序插入'}
                        className="min-h-44 border-white/10 bg-white/[0.04] text-white"
                    />
                    <DialogFooter>
                        <Button variant="mermaid-ghost" onClick={() => setQuickDialogOpen(false)}>取消</Button>
                        <Button variant="mermaid" onClick={applyQuickTitles}>确认插入</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
                <DialogContent className="border-white/10 bg-zinc-950 text-white sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>AI 写标题</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Textarea
                            value={aiPrompt}
                            onChange={(event) => setAiPrompt(event.target.value)}
                            placeholder="描述视频主题、受众和想要的风格"
                            className="min-h-36 border-white/10 bg-white/[0.04] text-white"
                        />
                        <Select value={aiLanguage} onValueChange={(value) => setAiLanguage(value as 'zh' | 'en')}>
                            <SelectTrigger className="w-40 border-white/10 bg-white/[0.04] text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="en">英文</SelectItem>
                                <SelectItem value="zh">中文</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="mermaid-ghost" onClick={() => setAiDialogOpen(false)}>取消</Button>
                        <Button variant="mermaid" onClick={generateAiTitles} disabled={aiLoading || readyVideos.length === 0}>
                            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            生成并插入
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
