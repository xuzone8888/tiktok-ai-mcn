export const LINKEDIN_VIDEO_FORMATS = ['.mp4']
export const LINKEDIN_MAX_FILE_SIZE = 200 * 1024 * 1024

export type LinkedInOwnerType = 'member'
export type LinkedInPublishMode = 'now' | 'scheduled'
export type LinkedInIntervalMode = '0' | '3' | '5' | '10' | '30' | '60' | '120' | '360' | '720' | '1440' | 'custom'

export interface LinkedInAccount {
  id: string
  owner_urn: string
  owner_type: LinkedInOwnerType
  localized_name: string
  vanity_name: string | null
  avatar_url: string | null
  follower_count: number
  status: string
  access_token_expires_at: string | null
  scopes: string[]
  created_at: string
  updated_at: string
}

export interface LinkedInSelectedVideo {
  id: string
  type: 'asset' | 'upload' | 'url'
  name: string
  url?: string
  localUrl?: string
  title?: string
  description?: string
}

export interface LinkedInFileUploadStatus {
  id: string
  name: string
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

export interface LinkedInPublishTask {
  id: string
  task_name: string | null
  name?: string | null
  status: 'pending' | 'scheduled' | 'processing' | 'completed' | 'partial_failed' | 'failed' | 'cancelled'
  privacy_status: 'public'
  total_items: number
  pending_count: number
  published_count: number
  failed_count: number
  video_count?: number
  account_count?: number
  created_at: string
  scheduled_at: string | null
  items?: LinkedInPublishTaskItem[]
}

export interface LinkedInPublishTaskItem {
  id: string
  task_id: string
  account_id: string
  video_url: string
  video_source: string
  source_video_name?: string | null
  title: string
  description: string | null
  linkedin_post_urn: string | null
  linkedin_share_url: string | null
  upload_asset_urn: string | null
  status: 'pending' | 'uploading' | 'processing' | 'published' | 'failed' | 'cancelled'
  error_code: string | null
  error_message: string | null
  scheduled_at: string | null
  published_at: string | null
  processing_started_at: string | null
  video_processing_started_at: string | null
  processing_poll_count: number
  last_video_status: string | null
  publish_attempt_count: number
  created_at: string
  updated_at: string
}
