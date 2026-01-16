'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
    Rocket,
    Video,
    Upload,
    Link as LinkIcon,
    Check,
    Plus,
    Clock,
    AlertCircle,
    ChevronRight,
    Settings,
    Globe,
    Users,
    MessageCircle,
    Sparkles,
    Calendar,
    Play,
    Trash2,
    RefreshCw,
    Send,
    CheckCircle2,
    XCircle,
    Loader2,
    History,
    Timer,
    ShoppingBag,
    Lock,
    Eye,
    EyeOff
} from 'lucide-react'
import { format, addMinutes } from 'date-fns'
import { zhCN } from 'date-fns/locale'

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
    is_verified: boolean
    access_token_expires_at: string
}

interface SelectedVideo {
    id: string
    type: 'asset' | 'upload' | 'url'
    name: string
    thumbnail: string
    url?: string
    duration?: number
}

interface PublishTask {
    id: string
    status: 'pending' | 'processing' | 'completed' | 'failed'
    video_count: number
    account_count: number
    total_items: number
    completed_items: number
    failed_items: number
    created_at: string
    scheduled_at: string | null
}

type TabType = 'create' | 'history' | 'scheduled'
type PrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY'
type VideoSourceType = 'asset' | 'upload' | 'url'

export default function PublishPage() {
    const router = useRouter()

    // Tab state
    const [activeTab, setActiveTab] = useState<TabType>('create')

    // Create publish form state
    const [publishType, setPublishType] = useState<'normal' | 'product'>('normal')
    const [videoSource, setVideoSource] = useState<VideoSourceType>('asset')
    const [selectedVideos, setSelectedVideos] = useState<SelectedVideo[]>([])
    const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
    const [accounts, setAccounts] = useState<TikTokAccount[]>([])
    const [loadingAccounts, setLoadingAccounts] = useState(true)

    // Publish settings
    const [caption, setCaption] = useState('')
    const [privacyLevel, setPrivacyLevel] = useState<PrivacyLevel>('PUBLIC_TO_EVERYONE')
    const [allowComments, setAllowComments] = useState(true)
    const [allowDuet, setAllowDuet] = useState(true)
    const [allowStitch, setAllowStitch] = useState(true)
    const [isBrandContent, setIsBrandContent] = useState(false)
    const [isAIGenerated, setIsAIGenerated] = useState(true)

    // Schedule settings
    const [publishMode, setPublishMode] = useState<'now' | 'scheduled'>('now')
    const [scheduledDate, setScheduledDate] = useState('')
    const [scheduledTime, setScheduledTime] = useState('09:00')
    const [batchInterval, setBatchInterval] = useState(5)

    // History and scheduled tasks
    const [tasks, setTasks] = useState<PublishTask[]>([])
    const [loadingTasks, setLoadingTasks] = useState(false)

    // Publishing state
    const [isPublishing, setIsPublishing] = useState(false)
    const [publishError, setPublishError] = useState<string | null>(null)

    // Fetch accounts
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
        return new Date(account.access_token_expires_at) > new Date()
    }

    // Toggle account selection
    const toggleAccountSelection = (accountId: string) => {
        setSelectedAccounts(prev =>
            prev.includes(accountId)
                ? prev.filter(id => id !== accountId)
                : [...prev, accountId]
        )
    }

    // Select all authorized accounts
    const selectAllAccounts = () => {
        const authorizedAccountIds = accounts
            .filter(isAccountAuthorized)
            .map(a => a.id)
        setSelectedAccounts(authorizedAccountIds)
    }

    // Remove selected video
    const removeVideo = (videoId: string) => {
        setSelectedVideos(prev => prev.filter(v => v.id !== videoId))
    }

    // Calculate total tasks
    const totalTasks = selectedVideos.length * selectedAccounts.length

    // Mock video data for demo (will be replaced with actual asset library integration)
    const addDemoVideo = () => {
        const newVideo: SelectedVideo = {
            id: `demo-${Date.now()}`,
            type: 'asset',
            name: `示例视频 ${selectedVideos.length + 1}`,
            thumbnail: '/placeholder-video.jpg',
            duration: 30
        }
        setSelectedVideos(prev => [...prev, newVideo])
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
                    privacy_level: privacyLevel,
                    allow_comments: allowComments,
                    allow_duet: allowDuet,
                    allow_stitch: allowStitch,
                    is_brand_content: isBrandContent,
                    is_ai_generated: isAIGenerated,
                    publish_mode: publishMode,
                    scheduled_at: publishMode === 'scheduled'
                        ? new Date(`${scheduledDate}T${scheduledTime}`).toISOString()
                        : null,
                    batch_interval: batchInterval
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
            setActiveTab('history')
            // fetchTasks()
        } catch (error) {
            setPublishError(error instanceof Error ? error.message : '创建发布任务失败')
        } finally {
            setIsPublishing(false)
        }
    }

    return (
        <div className="space-y-6 p-6 max-w-7xl mx-auto">
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
                        <p className="text-sm text-gray-400">一键发布视频到多个 TikTok 账号</p>
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
                    { id: 'history' as TabType, label: '发布记录', icon: History },
                    { id: 'scheduled' as TabType, label: '定时队列', icon: Timer }
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
                    {/* Publish Type */}
                    <section className="bg-white/5 rounded-2xl border border-white/10 p-6">
                        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <Video className="w-5 h-5 text-cyan-400" />
                            发布类型
                        </h2>
                        <div className="flex gap-4">
                            <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${publishType === 'normal'
                                    ? 'border-cyan-500 bg-cyan-500/10'
                                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                                }`}>
                                <input
                                    type="radio"
                                    name="publishType"
                                    checked={publishType === 'normal'}
                                    onChange={() => setPublishType('normal')}
                                    className="sr-only"
                                />
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${publishType === 'normal' ? 'border-cyan-400' : 'border-gray-500'
                                    }`}>
                                    {publishType === 'normal' && <div className="w-2 h-2 rounded-full bg-cyan-400" />}
                                </div>
                                <span>普通视频</span>
                            </label>

                            <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/5 opacity-50 cursor-not-allowed">
                                <div className="w-4 h-4 rounded-full border-2 border-gray-500" />
                                <span>商品视频</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-400">即将推出</span>
                            </label>
                        </div>
                    </section>

                    {/* Step 1: Select Videos */}
                    <section className="bg-white/5 rounded-2xl border border-white/10 p-6">
                        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-sm text-cyan-400">1</div>
                            选择视频
                        </h2>

                        {/* Video source tabs */}
                        <div className="flex gap-2 mb-4">
                            {[
                                { id: 'asset' as VideoSourceType, label: '从成品库选择', icon: Video },
                                { id: 'upload' as VideoSourceType, label: '本地上传', icon: Upload },
                                { id: 'url' as VideoSourceType, label: '输入视频URL', icon: LinkIcon }
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

                        {/* Selected videos grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                            {selectedVideos.map(video => (
                                <div
                                    key={video.id}
                                    className="relative group aspect-[9/16] rounded-xl bg-white/5 border border-white/10 overflow-hidden"
                                >
                                    <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                                        <Play className="w-8 h-8" />
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                        <p className="text-xs truncate">{video.name}</p>
                                    </div>
                                    <button
                                        onClick={() => removeVideo(video.id)}
                                        className="absolute top-2 right-2 p-1.5 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}

                            {/* Add video button */}
                            <button
                                onClick={addDemoVideo}
                                className="aspect-[9/16] rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-cyan-400 hover:border-cyan-500/50 transition-colors"
                            >
                                <Plus className="w-8 h-8" />
                                <span className="text-xs">添加视频</span>
                            </button>
                        </div>

                        {selectedVideos.length > 0 && (
                            <p className="mt-4 text-sm text-gray-400">
                                已选择 <span className="text-cyan-400 font-semibold">{selectedVideos.length}</span> 个视频
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
                            {accounts.length > 0 && (
                                <button
                                    onClick={selectAllAccounts}
                                    className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                                >
                                    全选已授权账号
                                </button>
                            )}
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
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => isAuthorized && toggleAccountSelection(account.id)}
                                                disabled={!isAuthorized}
                                                className="sr-only"
                                            />

                                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected
                                                    ? 'border-cyan-400 bg-cyan-500'
                                                    : 'border-gray-500'
                                                }`}>
                                                {isSelected && <Check className="w-3 h-3 text-white" />}
                                            </div>

                                            {account.avatar_url ? (
                                                <Image
                                                    src={account.avatar_url}
                                                    alt={account.display_name}
                                                    width={40}
                                                    height={40}
                                                    className="rounded-full"
                                                />
                                            ) : (
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center text-white font-bold">
                                                    {account.display_name.charAt(0).toUpperCase()}
                                                </div>
                                            )}

                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">@{account.display_name}</span>
                                                    {account.is_verified && (
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

                        <div className="space-y-6">
                            {/* Caption */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    视频描述
                                </label>
                                <textarea
                                    value={caption}
                                    onChange={(e) => setCaption(e.target.value)}
                                    placeholder="输入视频描述... 支持变量: {n} 序号, {date} 日期"
                                    rows={3}
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all resize-none"
                                />
                                <p className="mt-1 text-xs text-gray-500">
                                    支持变量: {'{n}'} 为视频序号, {'{date}'} 为当前日期
                                </p>
                            </div>

                            {/* Privacy */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    隐私设置
                                </label>
                                <div className="flex flex-wrap gap-3">
                                    {[
                                        { value: 'PUBLIC_TO_EVERYONE' as PrivacyLevel, label: '公开', icon: Globe },
                                        { value: 'MUTUAL_FOLLOW_FRIENDS' as PrivacyLevel, label: '好友可见', icon: Users },
                                        { value: 'SELF_ONLY' as PrivacyLevel, label: '仅自己', icon: Lock }
                                    ].map(option => (
                                        <label
                                            key={option.value}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${privacyLevel === option.value
                                                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                                                    : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10'
                                                }`}
                                        >
                                            <input
                                                type="radio"
                                                name="privacy"
                                                value={option.value}
                                                checked={privacyLevel === option.value}
                                                onChange={() => setPrivacyLevel(option.value)}
                                                className="sr-only"
                                            />
                                            <option.icon className="w-4 h-4" />
                                            <span className="text-sm">{option.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Interaction settings */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    互动设置
                                </label>
                                <div className="flex flex-wrap gap-4">
                                    {[
                                        { key: 'comments', label: '允许评论', checked: allowComments, onChange: setAllowComments },
                                        { key: 'duet', label: '允许合拍', checked: allowDuet, onChange: setAllowDuet },
                                        { key: 'stitch', label: '允许拼接', checked: allowStitch, onChange: setAllowStitch }
                                    ].map(option => (
                                        <label
                                            key={option.key}
                                            className="flex items-center gap-2 cursor-pointer"
                                        >
                                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${option.checked
                                                    ? 'border-cyan-400 bg-cyan-500'
                                                    : 'border-gray-500 bg-transparent'
                                                }`}>
                                                {option.checked && <Check className="w-3 h-3 text-white" />}
                                            </div>
                                            <input
                                                type="checkbox"
                                                checked={option.checked}
                                                onChange={(e) => option.onChange(e.target.checked)}
                                                className="sr-only"
                                            />
                                            <span className="text-sm text-gray-300">{option.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Content disclosure */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    内容声明
                                </label>
                                <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isBrandContent
                                                ? 'border-cyan-400 bg-cyan-500'
                                                : 'border-gray-500 bg-transparent'
                                            }`}>
                                            {isBrandContent && <Check className="w-3 h-3 text-white" />}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={isBrandContent}
                                            onChange={(e) => setIsBrandContent(e.target.checked)}
                                            className="sr-only"
                                        />
                                        <span className="text-sm text-gray-300">品牌推广内容</span>
                                    </label>

                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isAIGenerated
                                                ? 'border-cyan-400 bg-cyan-500'
                                                : 'border-gray-500 bg-transparent'
                                            }`}>
                                            {isAIGenerated && <Check className="w-3 h-3 text-white" />}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={isAIGenerated}
                                            onChange={(e) => setIsAIGenerated(e.target.checked)}
                                            className="sr-only"
                                        />
                                        <span className="text-sm text-gray-300 flex items-center gap-1">
                                            <Sparkles className="w-3 h-3" />
                                            AI 生成内容
                                        </span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Step 4: Schedule */}
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
                                    <span>定时发布</span>
                                </label>
                            </div>

                            {publishMode === 'scheduled' && (
                                <div className="flex gap-4 flex-wrap">
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
                            )}

                            {totalTasks > 1 && (
                                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/10">
                                    <Clock className="w-5 h-5 text-cyan-400" />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium">批量发布间隔</p>
                                        <p className="text-xs text-gray-400">多视频时，间隔发布避免被限流</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            value={batchInterval}
                                            onChange={(e) => setBatchInterval(Math.max(1, parseInt(e.target.value) || 1))}
                                            min={1}
                                            max={60}
                                            className="w-16 px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-center text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                        />
                                        <span className="text-gray-400">分钟</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Task Preview & Submit */}
                    <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 rounded-2xl border border-cyan-500/20 p-6">
                        <div className="flex items-center justify-between flex-wrap gap-4">
                            <div>
                                <h3 className="text-lg font-semibold mb-1">任务预览</h3>
                                <p className="text-gray-300">
                                    <span className="text-cyan-400 font-bold">{selectedVideos.length}</span> 个视频 ×
                                    <span className="text-pink-400 font-bold"> {selectedAccounts.length}</span> 个账号 =
                                    <span className="text-white font-bold"> {totalTasks}</span> 条发布任务
                                </p>
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
                                    disabled={isPublishing || totalTasks === 0}
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

            {/* History Tab */}
            {activeTab === 'history' && (
                <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-semibold">发布记录</h2>
                        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                            <RefreshCw className="w-4 h-4" />
                            刷新
                        </button>
                    </div>

                    <div className="text-center py-12">
                        <History className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                        <p className="text-gray-400 mb-2">暂无发布记录</p>
                        <p className="text-sm text-gray-500">创建发布任务后，记录将显示在这里</p>
                    </div>
                </div>
            )}

            {/* Scheduled Tab */}
            {activeTab === 'scheduled' && (
                <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-semibold">定时队列</h2>
                        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                            <RefreshCw className="w-4 h-4" />
                            刷新
                        </button>
                    </div>

                    <div className="text-center py-12">
                        <Timer className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                        <p className="text-gray-400 mb-2">暂无定时任务</p>
                        <p className="text-sm text-gray-500">设置定时发布后，任务将显示在这里</p>
                    </div>
                </div>
            )}
        </div>
    )
}
