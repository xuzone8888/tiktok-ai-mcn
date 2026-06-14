export const YOUTUBE_VIDEO_FORMATS = ['.mp4', '.webm', '.mov']
export const YOUTUBE_MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024

export type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public'
export type YouTubePublishMode = 'now' | 'scheduled'
export type YouTubeIntervalMode = '0' | '3' | '5' | '10' | '30' | '60' | '120' | '360' | '720' | '1440' | 'custom'

export interface YouTubeAccount {
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
  scopes: string[]
  created_at: string
  updated_at: string
}

export interface YouTubeSelectedVideo {
  id: string
  type: 'asset' | 'upload' | 'url'
  name: string
  thumbnail: string
  url?: string
  localUrl?: string
  duration?: number
  title?: string
  description?: string
}

export interface YouTubeAssetItem {
  id: string
  type: 'video' | 'image'
  resultUrl: string | null
  thumbnailUrl: string | null
  prompt: string | null
  model: string
  createdAt: string
  source: string
}

export interface YouTubeFileUploadStatus {
  id: string
  name: string
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

export interface YouTubePublishTask {
  id: string
  task_name: string | null
  name?: string | null
  status: 'pending' | 'scheduled' | 'processing' | 'completed' | 'partial_failed' | 'failed' | 'cancelled'
  privacy_status: YouTubePrivacyStatus
  total_items: number
  pending_count: number
  published_count: number
  failed_count: number
  video_count?: number
  account_count?: number
  created_at: string
  scheduled_at: string | null
  items?: YouTubePublishTaskItem[]
}

export interface YouTubePublishTaskItem {
  id: string
  task_id: string
  account_id: string
  video_url: string
  video_source: string
  title: string
  description: string | null
  youtube_video_id: string | null
  youtube_watch_url: string | null
  status: 'pending' | 'uploading' | 'processing' | 'published' | 'failed' | 'cancelled'
  error_code: string | null
  error_message: string | null
  scheduled_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}
