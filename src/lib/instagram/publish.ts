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
}

export interface InstagramVideoUploadResult {
  videoId: string
  containerId: string
  watchUrl: string | null
  published: boolean
}

export interface PublishInstagramExistingContainerOptions {
  accountId: string
  creationId: string
  pollIntervalMs?: number
  maxStatusChecks?: number
  deferOnContainerProcessing?: boolean
}

const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_API_VERSION || process.env.FACEBOOK_API_VERSION || 'v20.0'
const INSTAGRAM_GRAPH_URL = process.env.INSTAGRAM_AUTH_MODE === 'instagram'
  ? `https://graph.instagram.com/${INSTAGRAM_API_VERSION}`
  : `https://graph.facebook.com/${INSTAGRAM_API_VERSION}`
const DEFAULT_CONTAINER_POLL_INTERVAL_MS = 60 * 1000
const DEFAULT_CONTAINER_MAX_STATUS_CHECKS = 5

export class InstagramContainerProcessingError extends Error {
  containerId: string
  statusCode: string
  statusDetail?: string

  constructor(containerId: string, statusCode: string, statusDetail?: string) {
    const detail = statusDetail ? `: ${statusDetail}` : ''
    super(`Instagram 发布容器仍在处理 (${statusCode})${detail}`)
    this.name = 'InstagramContainerProcessingError'
    this.containerId = containerId
    this.statusCode = statusCode
    this.statusDetail = statusDetail
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

async function readInstagramApiError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as any
  return data?.error?.message || data?.error_description || data?.error || response.statusText
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
    access_token: accessToken,
    media_type: 'REELS',
    video_url: videoUrl,
    caption: trimText(caption, 2200),
  })

  const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(options.accountId)}/media`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    throw new Error(`Instagram 创建发布容器失败: ${await readInstagramApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as any
  if (!data?.id) {
    throw new Error('Instagram 创建发布容器成功但未返回容器 ID')
  }

  return data.id
}

async function getInstagramMediaContainerStatus(
  accessToken: string,
  creationId: string
): Promise<InstagramContainerStatus> {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'status_code,status',
  })

  const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(creationId)}?${params.toString()}`, {
    cache: 'no-store',
  })
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
    lastStatus = await getInstagramMediaContainerStatus(accessToken, creationId)
    const statusCode = lastStatus.status_code

    if (statusCode === 'FINISHED') {
      return lastStatus
    }

    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      const detail = lastStatus.status ? `: ${lastStatus.status}` : ''
      throw new Error(`Instagram 发布容器处理失败 (${statusCode})${detail}`)
    }

    if (statusCode === 'PUBLISHED') {
      throw new Error('Instagram 发布容器已被发布，无法重复发布')
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
  creationId: string
): Promise<string> {
  const body = new URLSearchParams({
    access_token: accessToken,
    creation_id: creationId,
  })

  const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(accountId)}/media_publish`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    throw new Error(`Instagram 发布失败: ${await readInstagramApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as any
  if (!data?.id) {
    throw new Error('Instagram 发布成功但未返回媒体 ID')
  }

  return data.id
}

async function getInstagramMediaPermalink(accessToken: string, mediaId: string): Promise<string | null> {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'permalink',
  })

  const response = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(mediaId)}?${params.toString()}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Instagram 查询发布链接失败: ${await readInstagramApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as { permalink?: string } | null
  return typeof data?.permalink === 'string' && data.permalink ? data.permalink : null
}

export async function uploadInstagramVideoFromUrl(
  accessToken: string,
  videoUrl: string,
  options: UploadInstagramVideoOptions
): Promise<InstagramVideoUploadResult> {
  const creationId = options.existingContainerId || await createInstagramMediaContainer(accessToken, videoUrl, options)

  if (options.published === false) {
    return {
      videoId: creationId,
      containerId: creationId,
      watchUrl: null,
      published: false,
    }
  }

  await waitForInstagramMediaContainerReady(accessToken, creationId, options)
  const mediaId = await publishInstagramMediaContainer(accessToken, options.accountId, creationId)
  const permalink = await getInstagramMediaPermalink(accessToken, mediaId)
  if (!permalink) {
    throw new Error('Instagram 发布成功但未返回真实 permalink')
  }

  return {
    videoId: mediaId,
    containerId: creationId,
    watchUrl: permalink,
    published: true,
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
  })
  const mediaId = await publishInstagramMediaContainer(accessToken, options.accountId, options.creationId)
  const permalink = await getInstagramMediaPermalink(accessToken, mediaId)
  if (!permalink) {
    throw new Error('Instagram 发布成功但未返回真实 permalink')
  }

  return {
    videoId: mediaId,
    containerId: options.creationId,
    watchUrl: permalink,
    published: true,
  }
}
