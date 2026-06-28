import {
  validateYouTubeDescription,
  validateYouTubeTags,
  validateYouTubeTitle,
} from '@/lib/youtube/metadata-rules'
import { isPrivateOrLoopbackHostname } from '@/lib/publish/url-safety'

export interface UploadYouTubeVideoOptions {
  title: string
  description?: string
  tags?: string[]
  categoryId?: string
  privacyStatus: 'private' | 'unlisted' | 'public'
  madeForKids?: boolean
  containsSyntheticMedia?: boolean
  notifySubscribers?: boolean
}

export interface YouTubeVideoUploadResult {
  videoId: string
  watchUrl: string
  attempts: number
}

const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'
const MAX_UPLOAD_ATTEMPTS = 4
const UPLOAD_RETRY_DELAYS_MS = [1_000, 3_000, 8_000]

class YouTubeUploadError extends Error {
  retryable: boolean
  attempts?: number

  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'YouTubeUploadError'
    this.retryable = retryable
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getRetryDelayMs(attempt: number) {
  const baseDelay = UPLOAD_RETRY_DELAYS_MS[Math.min(attempt - 1, UPLOAD_RETRY_DELAYS_MS.length - 1)] || 8_000
  const jitter = Math.floor(Math.random() * 400)
  return baseDelay + jitter
}

function isRetryableHttpStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function isRetryableUploadError(error: unknown) {
  if (error instanceof YouTubeUploadError) return error.retryable
  return error instanceof Error && /fetch failed|network|timeout|ECONNRESET|ETIMEDOUT/i.test(error.message)
}

function isAllowedVideoUrl(videoUrl: string): boolean {
  try {
    const url = new URL(videoUrl)
    if (url.protocol === 'https:') {
      // 收紧 SSRF：放行公网 https，但拒绝指向私网/环回/链路本地（含云元数据 169.254.169.254）的地址。
      return !isPrivateOrLoopbackHostname(url.hostname)
    }
    if (url.protocol !== 'http:') return false

    const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    const isSignedLocalUpload =
      url.pathname.startsWith('/api/youtube/upload/local-video/') ||
      (url.pathname === '/api/youtube/upload/local-video' && url.searchParams.has('key'))

    return (
      isLocalHost &&
      isSignedLocalUpload &&
      url.searchParams.has('expires') &&
      url.searchParams.has('token')
    )
  } catch {
    return false
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  return (tags || [])
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 30)
}

async function readGoogleApiError(response: Response): Promise<{ message: string; reason: string | null }> {
  const data = await response.json().catch(() => null) as any
  const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || null
  return {
    message: data?.error?.message || data?.error_description || data?.error || response.statusText,
    reason,
  }
}

function formatFetchError(error: unknown) {
  if (!(error instanceof Error)) return '未知网络错误'

  const cause = error.cause instanceof Error ? error.cause.message : String(error.cause || '')
  return cause ? `${error.message}: ${cause}` : error.message
}

async function fetchVideoStream(videoUrl: string): Promise<{
  body: ReadableStream<Uint8Array>
  contentType: string
  contentLength: string | null
}> {
  if (!isAllowedVideoUrl(videoUrl)) {
    throw new YouTubeUploadError('YouTube 发布要求视频 URL 使用 HTTPS，或使用本地测试上传生成的签名地址')
  }

  const response = await fetch(videoUrl).catch((error) => {
    throw new YouTubeUploadError(`无法读取视频文件: ${formatFetchError(error)}`, true)
  })
  if (!response.ok) {
    throw new YouTubeUploadError(
      `无法读取视频文件: ${response.status} ${response.statusText}`,
      isRetryableHttpStatus(response.status)
    )
  }

  const contentType = response.headers.get('content-type') || 'video/mp4'
  const contentLength = response.headers.get('content-length')
  if (contentLength === '0') {
    throw new YouTubeUploadError('视频文件为空')
  }
  if (!response.body) {
    throw new YouTubeUploadError('无法读取视频文件流', true)
  }

  return { body: response.body, contentType, contentLength }
}

export async function uploadYouTubeVideoFromUrl(
  accessToken: string,
  videoUrl: string,
  options: UploadYouTubeVideoOptions
): Promise<YouTubeVideoUploadResult> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
    try {
      const { body, contentType, contentLength } = await fetchVideoStream(videoUrl)
      const title = (options.title || 'Untitled video').trim()
      const description = options.description || ''
      const tags = normalizeTags(options.tags)
      const titleError = validateYouTubeTitle(title)
      const descriptionError = validateYouTubeDescription(description)
      const tagsError = validateYouTubeTags(tags)

      if (titleError || descriptionError || tagsError) {
        throw new YouTubeUploadError(titleError || descriptionError || tagsError || 'YouTube metadata 不符合平台规则')
      }

      const uploadParams = new URLSearchParams({
        uploadType: 'resumable',
        part: 'snippet,status',
        notifySubscribers: String(options.notifySubscribers ?? false),
      })

      const metadata = {
        snippet: {
          title,
          description,
          tags,
          categoryId: options.categoryId || '22',
        },
        status: {
          privacyStatus: options.privacyStatus,
          selfDeclaredMadeForKids: options.madeForKids ?? false,
          containsSyntheticMedia: options.containsSyntheticMedia ?? true,
        },
      }

      const initResponse = await fetch(`${YOUTUBE_UPLOAD_URL}?${uploadParams.toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': contentType,
          ...(contentLength ? { 'X-Upload-Content-Length': contentLength } : {}),
        },
        body: JSON.stringify(metadata),
      }).catch((error) => {
        throw new YouTubeUploadError(`YouTube 初始化上传请求失败: ${formatFetchError(error)}`, true)
      })

      if (!initResponse.ok) {
        const apiError = await readGoogleApiError(initResponse)
        throw new YouTubeUploadError(
          `YouTube 初始化上传失败: ${apiError.message}`,
          isRetryableHttpStatus(initResponse.status)
        )
      }

      const uploadLocation = initResponse.headers.get('location')
      if (!uploadLocation) {
        throw new YouTubeUploadError('YouTube 没有返回 resumable upload 地址', true)
      }

      const uploadHeaders: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': contentType,
      }
      if (contentLength) {
        uploadHeaders['Content-Length'] = contentLength
      }

      const uploadResponse = await fetch(uploadLocation, {
        method: 'PUT',
        headers: uploadHeaders,
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }).catch((error) => {
        throw new YouTubeUploadError(`YouTube 视频上传请求失败: ${formatFetchError(error)}`, true)
      })

      if (!uploadResponse.ok) {
        const apiError = await readGoogleApiError(uploadResponse)
        throw new YouTubeUploadError(
          `YouTube 上传失败: ${apiError.message}`,
          isRetryableHttpStatus(uploadResponse.status)
        )
      }

      const data = await uploadResponse.json().catch(() => null) as any
      if (!data?.id) {
        throw new YouTubeUploadError('YouTube 上传成功但未返回视频 ID', true)
      }

      return {
        videoId: data.id,
        watchUrl: `https://www.youtube.com/watch?v=${data.id}`,
        attempts: attempt,
      }
    } catch (error) {
      lastError = error
      if (error instanceof YouTubeUploadError) {
        error.attempts = attempt
      }
      if (attempt >= MAX_UPLOAD_ATTEMPTS || !isRetryableUploadError(error)) break
      await sleep(getRetryDelayMs(attempt))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('YouTube 上传失败')
}
