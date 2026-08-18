import type { InstagramVideoUploadResult } from '@/lib/instagram/publish'

export const INSTAGRAM_RECONCILIATION_REQUIRED_CODE = 'INSTAGRAM_PUBLISHED_STATE_RECONCILIATION_REQUIRED'
export const INSTAGRAM_RECONCILIATION_REQUIRED_MESSAGE = '平台已报告发布完成，本地最终媒体状态需人工核对'
export const INSTAGRAM_MEDIA_PUBLISH_OUTCOME_UNKNOWN_CODE = 'INSTAGRAM_MEDIA_PUBLISH_OUTCOME_UNKNOWN'
export const INSTAGRAM_MEDIA_PUBLISH_OUTCOME_UNKNOWN_MESSAGE = 'Instagram 发布请求结果未知，需要人工核对平台状态'
export const INSTAGRAM_MEDIA_CREATE_OUTCOME_UNKNOWN_CODE = 'INSTAGRAM_MEDIA_CREATE_OUTCOME_UNKNOWN'
export const INSTAGRAM_MEDIA_CREATE_OUTCOME_UNKNOWN_MESSAGE = 'Instagram 发布容器创建结果未知，需要人工核对平台状态'

export function buildInstagramContainerProcessingUpdate(containerId: string, message: string, updatedAt: string) {
  return {
    status: 'processing',
    instagram_video_id: containerId,
    error_code: null,
    error_message: message,
    updated_at: updatedAt,
  }
}

export function buildInstagramActiveContainerUpdate(containerId: string, message: string, updatedAt: string) {
  return {
    status: 'uploading',
    instagram_video_id: containerId,
    error_code: null,
    error_message: message,
    updated_at: updatedAt,
  }
}

export function buildInstagramFailedItemUpdate(
  message: string,
  code: string,
  updatedAt: string,
  containerId?: string
) {
  return {
    status: 'failed',
    ...(containerId ? { instagram_video_id: containerId } : {}),
    error_code: code,
    error_message: message,
    updated_at: updatedAt,
  }
}

export function buildInstagramPublishedItemUpdate(upload: InstagramVideoUploadResult, updatedAt: string) {
  return {
    status: upload.published ? 'published' : 'container_created',
    instagram_video_id: upload.videoId,
    instagram_watch_url: upload.watchUrl,
    error_code: upload.warningCode || null,
    error_message: upload.warningMessage || null,
    published_at: upload.published ? updatedAt : null,
    updated_at: updatedAt,
  }
}

export function buildInstagramPublishedIdentityUpdate(mediaId: string, publishedAt: string) {
  return {
    status: 'published',
    instagram_video_id: mediaId,
    instagram_watch_url: null,
    error_code: null,
    error_message: null,
    published_at: publishedAt,
    updated_at: publishedAt,
  }
}

export function buildInstagramMediaPublishBarrierUpdate(containerId: string, updatedAt: string) {
  return {
    status: 'container_created',
    instagram_video_id: containerId,
    instagram_watch_url: null,
    error_code: null,
    error_message: null,
    updated_at: updatedAt,
  }
}

export function buildInstagramMediaPublishOutcomeUnknownUpdate(containerId: string, updatedAt: string) {
  return {
    status: 'container_created',
    instagram_video_id: containerId,
    instagram_watch_url: null,
    error_code: INSTAGRAM_MEDIA_PUBLISH_OUTCOME_UNKNOWN_CODE,
    error_message: INSTAGRAM_MEDIA_PUBLISH_OUTCOME_UNKNOWN_MESSAGE,
    updated_at: updatedAt,
  }
}

export function buildInstagramMediaCreateOutcomeUnknownUpdate(updatedAt: string) {
  return {
    status: 'container_created',
    instagram_watch_url: null,
    error_code: INSTAGRAM_MEDIA_CREATE_OUTCOME_UNKNOWN_CODE,
    error_message: INSTAGRAM_MEDIA_CREATE_OUTCOME_UNKNOWN_MESSAGE,
    updated_at: updatedAt,
  }
}

export function buildInstagramReconciliationUpdate(knownId: string, updatedAt: string) {
  return {
    status: 'container_created',
    instagram_video_id: knownId,
    instagram_watch_url: null,
    error_code: INSTAGRAM_RECONCILIATION_REQUIRED_CODE,
    error_message: INSTAGRAM_RECONCILIATION_REQUIRED_MESSAGE,
    updated_at: updatedAt,
  }
}
