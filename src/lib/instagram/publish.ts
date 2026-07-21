import { instagramGraphHeaders } from '@/lib/instagram/graph-auth'

export interface UploadInstagramVideoOptions {
  accountId: string
  title: string
  description?: string
  caption?: string
  published?: boolean
  existingContainerId?: string
  deferOnContainerProcessing?: boolean
  pollIntervalMs?: number
  maxStatusChecks?: number
  beforeContainerCreate?: () => void | Promise<void>
  beforeStatusCheck?: () => void | Promise<void>
  onBeforeMediaPublish?: (containerId: string) => void | Promise<void>
  onContainerCreated?: (containerId: string) => void | Promise<void>
  onMediaPublished?: (mediaId: string) => void | Promise<void>
}

export interface InstagramVideoUploadResult {
  videoId: string
  containerId: string
  watchUrl: string | null
  published: boolean
  warningCode?: 'INSTAGRAM_PERMALINK_UNAVAILABLE'
  warningMessage?: string
}

export interface PublishInstagramExistingContainerOptions {
  accountId: string
  creationId: string
  pollIntervalMs?: number
  maxStatusChecks?: number
  deferOnContainerProcessing?: boolean
  beforeStatusCheck?: () => void | Promise<void>
  onBeforeMediaPublish?: (containerId: string) => void | Promise<void>
  onMediaPublished?: (mediaId: string) => void | Promise<void>
}

const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_API_VERSION || process.env.FACEBOOK_API_VERSION || 'v20.0'
const INSTAGRAM_GRAPH_URL = process.env.INSTAGRAM_AUTH_MODE === 'instagram'
  ? `https://graph.instagram.com/${INSTAGRAM_API_VERSION}`
  : `https://graph.facebook.com/${INSTAGRAM_API_VERSION}`
const DEFAULT_CONTAINER_POLL_INTERVAL_MS = 60 * 1000
const DEFAULT_CONTAINER_MAX_STATUS_CHECKS = 5
const INSTAGRAM_GRAPH_WRITE_TIMEOUT_MS = 30 * 1000
const INSTAGRAM_GRAPH_READ_TIMEOUT_MS = 15 * 1000

class InstagramGraphRequestTimeoutError extends Error {
  constructor() {
    super('Instagram API 请求超时')
    this.name = 'InstagramGraphRequestTimeoutError'
  }
}

export class InstagramMediaPublishOutcomeUnknownError extends Error {
  containerId: string

  constructor(containerId: string) {
    super('Instagram 发布请求结果未知，需要人工核对平台状态')
    this.name = 'InstagramMediaPublishOutcomeUnknownError'
    this.containerId = containerId
  }
}

export class InstagramMediaPublishRejectedError extends Error {
  containerId: string
  httpStatus: number

  constructor(containerId: string, httpStatus: number) {
    super(`Instagram 发布请求被平台拒绝 (${httpStatus})`)
    this.name = 'InstagramMediaPublishRejectedError'
    this.containerId = containerId
    this.httpStatus = httpStatus
  }
}

export class InstagramMediaContainerOutcomeUnknownError extends Error {
  constructor() {
    super('Instagram 发布容器创建结果未知，需要人工核对平台状态')
    this.name = 'InstagramMediaContainerOutcomeUnknownError'
  }
}

export class InstagramMediaContainerRejectedError extends Error {
  httpStatus: number

  constructor(httpStatus: number) {
    super(`Instagram 创建发布容器被平台拒绝 (${httpStatus})`)
    this.name = 'InstagramMediaContainerRejectedError'
    this.httpStatus = httpStatus
  }
}

export class InstagramContainerProcessingError extends Error {
  containerId: string
  statusCode: string
  statusDetail?: string

  constructor(containerId: string, statusCode: string, statusDetail?: string) {
    const safeDetail = sanitizeInstagramStatusDetail(statusDetail)
    const detail = safeDetail ? `: ${safeDetail}` : ''
    super(`Instagram 发布容器仍在处理 (${statusCode})${detail}`)
    this.name = 'InstagramContainerProcessingError'
    this.containerId = containerId
    this.statusCode = statusCode
    this.statusDetail = safeDetail
  }
}

export class InstagramContainerTerminalError extends Error {
  containerId: string
  statusCode: 'ERROR' | 'EXPIRED'
  statusDetail?: string

  constructor(containerId: string, statusCode: 'ERROR' | 'EXPIRED', statusDetail?: string) {
    const safeDetail = sanitizeInstagramStatusDetail(statusDetail)
    const detail = safeDetail ? `: ${safeDetail}` : ''
    super(`Instagram 发布容器处理失败 (${statusCode})${detail}`)
    this.name = 'InstagramContainerTerminalError'
    this.containerId = containerId
    this.statusCode = statusCode
    this.statusDetail = safeDetail
  }
}

export class InstagramPostPublishPersistenceError extends Error {
  mediaId: string

  constructor(mediaId: string) {
    super('Instagram 已发布，但保存最终媒体状态失败')
    this.name = 'InstagramPostPublishPersistenceError'
    this.mediaId = mediaId
  }
}

export class InstagramContainerAlreadyPublishedError extends Error {
  containerId: string

  constructor(containerId: string) {
    super('Instagram 发布容器已完成发布，需要人工核对最终媒体状态')
    this.name = 'InstagramContainerAlreadyPublishedError'
    this.containerId = containerId
  }
}

interface InstagramContainerStatus {
  id?: string
  status_code?: string
  status?: string
}

function isAllowedVideoUrl(videoUrl: string): boolean {
  try {
    const url = new URL(videoUrl)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

function trimText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeInstagramStatusDetail(value: string | undefined) {
  if (!value) return undefined
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(access_token|token|secret|code)=\S+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 240) || undefined
}

async function readInstagramApiError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as any
  return sanitizeInstagramStatusDetail(data?.error?.message || data?.error_description || data?.error || response.statusText)
    || 'Instagram request failed.'
}

async function fetchInstagramGraph(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new InstagramGraphRequestTimeoutError()
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createInstagramMediaContainer(
  accessToken: string,
  videoUrl: string,
  options: UploadInstagramVideoOptions
): Promise<string> {
  if (!isAllowedVideoUrl(videoUrl)) {
    throw new Error('Instagram 发布要求视频 URL 是可由 Meta 服务器访问的 HTTPS 地址')
  }

  const fallbackCaptionParts = [options.title, options.description].map((value) => value?.trim()).filter(Boolean)
  const caption = options.caption?.trim() || fallbackCaptionParts.join('\n\n')
  const body = new URLSearchParams({
    media_type: 'REELS',
    video_url: videoUrl,
    caption: trimText(caption, 2200),
  })

  await options.beforeContainerCreate?.()
  let response: Response
  try {
    response = await fetchInstagramGraph(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(options.accountId)}/media`, {
      method: 'POST',
      cache: 'no-store',
      headers: instagramGraphHeaders(accessToken, {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      body,
    }, INSTAGRAM_GRAPH_WRITE_TIMEOUT_MS)
  } catch {
    throw new InstagramMediaContainerOutcomeUnknownError()
  }

  if (response.status >= 500) {
    throw new InstagramMediaContainerOutcomeUnknownError()
  }
  if (!response.ok) {
    throw new InstagramMediaContainerRejectedError(response.status)
  }

  const data = await response.json().catch(() => null) as any
  if (!data?.id) {
    throw new InstagramMediaContainerOutcomeUnknownError()
  }

  return data.id
}

async function getInstagramMediaContainerStatus(
  accessToken: string,
  creationId: string
): Promise<InstagramContainerStatus> {
  const params = new URLSearchParams({
    fields: 'status_code,status',
  })

  const response = await fetchInstagramGraph(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(creationId)}?${params.toString()}`, {
    cache: 'no-store',
    headers: instagramGraphHeaders(accessToken),
  }, INSTAGRAM_GRAPH_READ_TIMEOUT_MS)
  if (!response.ok) {
    throw new Error(`Instagram 查询发布容器状态失败: ${await readInstagramApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as InstagramContainerStatus | null
  if (!data || typeof data !== 'object') {
    throw new Error('Instagram 查询发布容器状态返回无效响应')
  }

  return data
}

async function waitForInstagramMediaContainerReady(
  accessToken: string,
  creationId: string,
  options: UploadInstagramVideoOptions
): Promise<InstagramContainerStatus> {
  const pollIntervalMs = Math.max(1000, options.pollIntervalMs ?? DEFAULT_CONTAINER_POLL_INTERVAL_MS)
  const maxStatusChecks = Math.max(1, options.maxStatusChecks ?? DEFAULT_CONTAINER_MAX_STATUS_CHECKS)
  let lastStatus: InstagramContainerStatus | null = null

  for (let attempt = 0; attempt < maxStatusChecks; attempt++) {
    await options.beforeStatusCheck?.()
    lastStatus = await getInstagramMediaContainerStatus(accessToken, creationId)
    const statusCode = lastStatus.status_code

    if (statusCode === 'FINISHED') {
      return lastStatus
    }

    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new InstagramContainerTerminalError(creationId, statusCode, lastStatus.status)
    }

    if (statusCode === 'PUBLISHED') {
      throw new InstagramContainerAlreadyPublishedError(creationId)
    }

    if (attempt < maxStatusChecks - 1) {
      await sleep(pollIntervalMs)
    }
  }

  const statusCode = lastStatus?.status_code || 'UNKNOWN'
  const detail = lastStatus?.status ? `: ${lastStatus.status}` : ''
  if (options.deferOnContainerProcessing) {
    throw new InstagramContainerProcessingError(creationId, statusCode, lastStatus?.status)
  }
  throw new Error(`Instagram 发布容器处理超时 (${statusCode})${detail}`)
}

async function publishInstagramMediaContainer(
  accessToken: string,
  accountId: string,
  creationId: string,
  onBeforeMediaPublish?: (containerId: string) => void | Promise<void>
): Promise<string> {
  const body = new URLSearchParams({
    creation_id: creationId,
  })

  await onBeforeMediaPublish?.(creationId)
  let response: Response
  try {
    response = await fetchInstagramGraph(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(accountId)}/media_publish`, {
      method: 'POST',
      cache: 'no-store',
      headers: instagramGraphHeaders(accessToken, {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      body,
    }, INSTAGRAM_GRAPH_WRITE_TIMEOUT_MS)
  } catch {
    throw new InstagramMediaPublishOutcomeUnknownError(creationId)
  }

  if (response.status >= 500) {
    throw new InstagramMediaPublishOutcomeUnknownError(creationId)
  }
  if (!response.ok) {
    throw new InstagramMediaPublishRejectedError(creationId, response.status)
  }

  const data = await response.json().catch(() => null) as any
  if (!data?.id) {
    throw new InstagramMediaPublishOutcomeUnknownError(creationId)
  }

  return data.id
}

async function getInstagramMediaPermalink(accessToken: string, mediaId: string): Promise<string | null> {
  const params = new URLSearchParams({
    fields: 'permalink',
  })

  const response = await fetchInstagramGraph(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(mediaId)}?${params.toString()}`, {
    cache: 'no-store',
    headers: instagramGraphHeaders(accessToken),
  }, INSTAGRAM_GRAPH_READ_TIMEOUT_MS)
  if (!response.ok) {
    throw new Error(`Instagram 查询发布链接失败: ${await readInstagramApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as { permalink?: string } | null
  return typeof data?.permalink === 'string' && data.permalink ? data.permalink : null
}

async function notifyInstagramMediaPublished(
  mediaId: string,
  callback: ((mediaId: string) => void | Promise<void>) | undefined
) {
  if (!callback) return
  try {
    await callback(mediaId)
  } catch {
    throw new InstagramPostPublishPersistenceError(mediaId)
  }
}

async function readInstagramPublishedPermalink(accessToken: string, mediaId: string) {
  try {
    const permalink = await getInstagramMediaPermalink(accessToken, mediaId)
    if (permalink) {
      return { permalink, warningCode: undefined, warningMessage: undefined }
    }
  } catch {
    // The media is already published. A missing permalink must not roll back that fact.
  }
  return {
    permalink: null,
    warningCode: 'INSTAGRAM_PERMALINK_UNAVAILABLE' as const,
    warningMessage: 'Instagram 已发布，但暂时无法获取 permalink',
  }
}

export async function uploadInstagramVideoFromUrl(
  accessToken: string,
  videoUrl: string,
  options: UploadInstagramVideoOptions
): Promise<InstagramVideoUploadResult> {
  let creationId = options.existingContainerId
  if (!creationId) {
    creationId = await createInstagramMediaContainer(accessToken, videoUrl, options)
    await options.onContainerCreated?.(creationId)
  }

  if (options.published === false) {
    return {
      videoId: creationId,
      containerId: creationId,
      watchUrl: null,
      published: false,
    }
  }

  await waitForInstagramMediaContainerReady(accessToken, creationId, options)
  const mediaId = await publishInstagramMediaContainer(
    accessToken,
    options.accountId,
    creationId,
    options.onBeforeMediaPublish
  )
  await notifyInstagramMediaPublished(mediaId, options.onMediaPublished)
  const permalinkResult = await readInstagramPublishedPermalink(accessToken, mediaId)

  return {
    videoId: mediaId,
    containerId: creationId,
    watchUrl: permalinkResult.permalink,
    published: true,
    warningCode: permalinkResult.warningCode,
    warningMessage: permalinkResult.warningMessage,
  }
}

export async function publishInstagramExistingContainer(
  accessToken: string,
  options: PublishInstagramExistingContainerOptions
): Promise<InstagramVideoUploadResult> {
  await waitForInstagramMediaContainerReady(accessToken, options.creationId, {
    accountId: options.accountId,
    title: '',
    published: true,
    existingContainerId: options.creationId,
    deferOnContainerProcessing: options.deferOnContainerProcessing,
    pollIntervalMs: options.pollIntervalMs,
    maxStatusChecks: options.maxStatusChecks,
    beforeStatusCheck: options.beforeStatusCheck,
  })
  const mediaId = await publishInstagramMediaContainer(
    accessToken,
    options.accountId,
    options.creationId,
    options.onBeforeMediaPublish
  )
  await notifyInstagramMediaPublished(mediaId, options.onMediaPublished)
  const permalinkResult = await readInstagramPublishedPermalink(accessToken, mediaId)

  return {
    videoId: mediaId,
    containerId: options.creationId,
    watchUrl: permalinkResult.permalink,
    published: true,
    warningCode: permalinkResult.warningCode,
    warningMessage: permalinkResult.warningMessage,
  }
}
