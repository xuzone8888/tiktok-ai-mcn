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
}

const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'

function isAllowedVideoUrl(videoUrl: string): boolean {
  try {
    const url = new URL(videoUrl)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false

    const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    return (
      isLocalHost &&
      url.pathname.startsWith('/api/youtube/upload/local-video/') &&
      url.searchParams.has('expires') &&
      url.searchParams.has('token')
    )
  } catch {
    return false
  }
}

function trimText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function normalizeTags(tags: string[] | undefined): string[] {
  return (tags || [])
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 30)
}

async function readGoogleApiError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as any
  return data?.error?.message || data?.error_description || data?.error || response.statusText
}

async function fetchVideoStream(videoUrl: string): Promise<{
  body: ReadableStream<Uint8Array>
  contentType: string
  contentLength: string | null
}> {
  if (!isAllowedVideoUrl(videoUrl)) {
    throw new Error('YouTube 发布要求视频 URL 使用 HTTPS，或使用本地测试上传生成的签名地址')
  }

  const response = await fetch(videoUrl)
  if (!response.ok) {
    throw new Error(`无法读取视频文件: ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || 'video/mp4'
  const contentLength = response.headers.get('content-length')
  if (contentLength === '0') {
    throw new Error('视频文件为空')
  }
  if (!response.body) {
    throw new Error('无法读取视频文件流')
  }

  return { body: response.body, contentType, contentLength }
}

export async function uploadYouTubeVideoFromUrl(
  accessToken: string,
  videoUrl: string,
  options: UploadYouTubeVideoOptions
): Promise<YouTubeVideoUploadResult> {
  const { body, contentType, contentLength } = await fetchVideoStream(videoUrl)
  const uploadParams = new URLSearchParams({
    uploadType: 'resumable',
    part: 'snippet,status',
    notifySubscribers: String(options.notifySubscribers ?? false),
  })

  const metadata = {
    snippet: {
      title: trimText(options.title || 'Untitled video', 100),
      description: trimText(options.description || '', 5000),
      tags: normalizeTags(options.tags),
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
  })

  if (!initResponse.ok) {
    throw new Error(`YouTube 初始化上传失败: ${await readGoogleApiError(initResponse)}`)
  }

  const uploadLocation = initResponse.headers.get('location')
  if (!uploadLocation) {
    throw new Error('YouTube 没有返回 resumable upload 地址')
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
  } as RequestInit & { duplex: 'half' })

  if (!uploadResponse.ok) {
    throw new Error(`YouTube 上传失败: ${await readGoogleApiError(uploadResponse)}`)
  }

  const data = await uploadResponse.json().catch(() => null) as any
  if (!data?.id) {
    throw new Error('YouTube 上传成功但未返回视频 ID')
  }

  return {
    videoId: data.id,
    watchUrl: `https://www.youtube.com/watch?v=${data.id}`,
  }
}
