/**
 * 发布系统类型定义
 */

// TikTok 支持的视频格式
export const TIKTOK_VIDEO_FORMATS = ['.mp4', '.webm', '.mov']
export const TIKTOK_MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024 // 4GB
export const TIKTOK_MAX_DURATION = 10 * 60 * 1000 // 10 minutes in ms

// 成品库资产
export interface AssetItem {
    id: string
    type: 'video' | 'image'
    resultUrl: string | null
    thumbnailUrl: string | null
    prompt: string | null
    model: string
    createdAt: string
    source: string
}

// TikTok 账号
export interface TikTokAccount {
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

// 已选择的视频
export interface SelectedVideo {
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

// 发布任务
export interface PublishTask {
    id: string
    name?: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'scheduled' | 'partial_failed' | 'cancelled'
    video_count: number
    account_count: number
    total_items: number
    completed_items: number
    failed_items: number
    published_count?: number
    pending_count?: number
    created_at: string
    scheduled_at: string | null
}

// 文件上传状态
export interface FileUploadStatus {
    id: string
    name: string
    progress: number  // 0-100
    status: 'pending' | 'uploading' | 'done' | 'error'
    error?: string
}

// Tab 类型
export type TabType = 'create' | 'history' | 'scheduled'

// 视频来源类型
export type VideoSourceType = 'upload' | 'asset'

// 隐私级别
export type PrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'

// 发布模式
export type PublishMode = 'now' | 'scheduled'

// 标题模式
export type TitleMode = 'uniform' | 'individual'

// 间隔模式
export type IntervalMode = '0' | '3' | '5' | '10' | '30' | '60' | '120' | '360' | '720' | '1440' | 'custom'

// 批量传输状态
export interface BatchTransferState {
    isTransferring: boolean
    total: number
    completed: number
    failed: number
    currentBatch: string[]
}

// 生成的标题
export interface GeneratedTitle {
    index: number
    content: string
    selected: boolean
}
