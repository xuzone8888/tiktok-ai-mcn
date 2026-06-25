export interface UploadFacebookVideoOptions {
  pageId: string
  title: string
  description?: string
  published?: boolean
  contentCategory?: string | null
}

export interface FacebookVideoUploadResult {
  videoId: string
  watchUrl: string | null
  published: boolean
}

const FACEBOOK_API_VERSION = process.env.FACEBOOK_API_VERSION || 'v20.0'
const FACEBOOK_VIDEO_GRAPH_URL = `https://graph-video.facebook.com/${FACEBOOK_API_VERSION}`
const FACEBOOK_SINGLE_VIDEO_TEST_LIMIT_BYTES = 500 * 1024 * 1024
const FACEBOOK_CONTENT_CATEGORIES = new Set([
  'BEAUTY_FASHION',
  'BUSINESS',
  'CARS_TRUCKS',
  'COMEDY',
  'CUTE_ANIMALS',
  'ENTERTAINMENT',
  'FAMILY',
  'FOOD_HEALTH',
  'HOME',
  'LIFESTYLE',
  'MUSIC',
  'NEWS',
  'POLITICS',
  'SCIENCE',
  'SPORTS',
  'TECHNOLOGY',
  'VIDEO_GAMING',
  'OTHER',
])

function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}

function isAllowedVideoUrl(videoUrl: string): boolean {
  try {
    const url = new URL(videoUrl)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false

    const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    return (
      isLocalHost &&
      url.pathname.startsWith('/api/facebook/upload/local-video/') &&
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

async function readFacebookApiError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as any
  return data?.error?.message || data?.error_description || data?.error || response.statusText
}

async function fetchVideoBlob(videoUrl: string): Promise<Blob> {
  if (!isAllowedVideoUrl(videoUrl)) {
    throw new Error('Facebook 发布要求视频 URL 使用 HTTPS，或使用本地测试上传生成的签名地址')
  }

  const response = await fetch(videoUrl)
  if (!response.ok) {
    throw new Error(`无法读取视频文件: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength === '0') {
    throw new Error('视频文件为空')
  }
  if (contentLength) {
    const size = Number(contentLength)
    if (Number.isFinite(size) && size > FACEBOOK_SINGLE_VIDEO_TEST_LIMIT_BYTES) {
      throw new Error(`Facebook 单视频测试暂时限制为 ${formatMegabytes(FACEBOOK_SINGLE_VIDEO_TEST_LIMIT_BYTES)}，当前视频约 ${formatMegabytes(size)}。后续接入流式/分片上传后再放开更大文件。`)
    }
  }

  const contentType = response.headers.get('content-type') || 'video/mp4'
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength === 0) {
    throw new Error('视频文件为空')
  }
  if (bytes.byteLength > FACEBOOK_SINGLE_VIDEO_TEST_LIMIT_BYTES) {
    throw new Error(`Facebook 单视频测试暂时限制为 ${formatMegabytes(FACEBOOK_SINGLE_VIDEO_TEST_LIMIT_BYTES)}，当前视频约 ${formatMegabytes(bytes.byteLength)}。后续接入流式/分片上传后再放开更大文件。`)
  }

  return new Blob([bytes], { type: contentType })
}

export async function uploadFacebookVideoFromUrl(
  accessToken: string,
  videoUrl: string,
  options: UploadFacebookVideoOptions
): Promise<FacebookVideoUploadResult> {
  if ((options.published ?? true) !== true) {
    throw new Error('Facebook 当前仅支持公开发布。未发布/广告草稿需要单独接入 ADVERTISE 权限和 pages_manage_ads。')
  }
  const videoBlob = await fetchVideoBlob(videoUrl)
  const formData = new FormData()
  formData.set('access_token', accessToken)
  formData.set('source', videoBlob, 'video.mp4')
  formData.set('title', trimText(options.title || 'Untitled video', 255))
  formData.set('description', trimText(options.description || '', 63206))
  formData.set('published', 'true')
  const contentCategory = options.contentCategory || 'OTHER'
  if (FACEBOOK_CONTENT_CATEGORIES.has(contentCategory)) {
    formData.set('content_category', contentCategory)
  }

  const response = await fetch(`${FACEBOOK_VIDEO_GRAPH_URL}/${encodeURIComponent(options.pageId)}/videos`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Facebook 上传失败: ${await readFacebookApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as any
  if (!data?.id) {
    throw new Error('Facebook 上传成功但未返回视频 ID')
  }

  return {
    videoId: data.id,
    watchUrl: `https://www.facebook.com/watch/?v=${data.id}`,
    published: true,
  }
}
