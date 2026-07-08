import dns from 'node:dns/promises'
import net from 'node:net'

import {
  appendLinkedInTags,
  normalizeLinkedInTags,
  validateLinkedInDescription,
  validateLinkedInTags,
  validateLinkedInTitle,
} from '@/lib/linkedin/metadata-rules'
import { getLinkedInRestHeaders } from '@/lib/linkedin/oauth'
import { isPrivateOrLoopbackHostname } from '@/lib/publish/url-safety'

const LINKEDIN_VIDEOS_URL = 'https://api.linkedin.com/rest/videos'
const LINKEDIN_POSTS_URL = 'https://api.linkedin.com/rest/posts'
const MAX_UPLOAD_ATTEMPTS = 3
const MAX_REDIRECTS = 5
const UPLOAD_RETRY_DELAYS_MS = [1_000, 3_000]
const LINKEDIN_VIDEO_MIN_BYTES = 75 * 1024
const LINKEDIN_VIDEO_MAX_BYTES = 200 * 1024 * 1024
const DEFAULT_TRUSTED_VIDEO_HOST = 'media.toryxai.com'

export interface UploadLinkedInVideoOptions {
  ownerUrn: string
  title: string
  description?: string
  tags?: string[]
}

export interface LinkedInVideoUploadResult {
  postUrn: string
  shareUrl: string
  assetUrn: string
  attempts: number
}

export interface LinkedInFinalizedVideoUploadResult {
  assetUrn: string
  attempts: number
}

export interface LinkedInVideoPostResult {
  postUrn: string
  shareUrl: string
}

interface LinkedInVideoFile {
  bytes: Uint8Array
  contentType: string
  contentLength: number
  finalUrl: string
}

interface LinkedInUploadInstruction {
  uploadUrl: string
  firstByte: number
  lastByte: number
}

interface LinkedInInitializedUpload {
  videoUrn: string
  uploadToken: string | null
  uploadInstructions: LinkedInUploadInstruction[]
}

class LinkedInUploadError extends Error {
  retryable: boolean
  attempts?: number

  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'LinkedInUploadError'
    this.retryable = retryable
  }
}

export class LinkedInVideoStillProcessingError extends Error {
  status: string
  retryable = true

  constructor(status: string) {
    super('LinkedIn 视频仍在转码处理中')
    this.name = 'LinkedInVideoStillProcessingError'
    this.status = status
  }
}

export class LinkedInVideoProcessingFailedError extends Error {
  status: string
  retryable = false

  constructor(status: string) {
    super(`LinkedIn 视频处理失败: ${status}`)
    this.name = 'LinkedInVideoProcessingFailedError'
    this.status = status
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getRetryDelayMs(attempt: number) {
  const baseDelay = UPLOAD_RETRY_DELAYS_MS[Math.min(attempt - 1, UPLOAD_RETRY_DELAYS_MS.length - 1)] || 3_000
  const jitter = Math.floor(Math.random() * 400)
  return baseDelay + jitter
}

function isRetryableHttpStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function isRetryableUploadError(error: unknown) {
  if (error instanceof LinkedInUploadError) return error.retryable
  return error instanceof Error && /fetch failed|network|timeout|ECONNRESET|ETIMEDOUT/i.test(error.message)
}

function normalizeTrustedHost(host: string) {
  return host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
}

function getTrustedVideoHostRules() {
  const configuredHosts = (process.env.LINKEDIN_TRUSTED_VIDEO_HOSTS || '')
    .split(',')
    .map(normalizeTrustedHost)
    .filter(Boolean)

  const ossCustomDomain = normalizeTrustedHost(process.env.ALIYUN_OSS_CUSTOM_DOMAIN || DEFAULT_TRUSTED_VIDEO_HOST)
  return [...new Set([ossCustomDomain, DEFAULT_TRUSTED_VIDEO_HOST, ...configuredHosts])]
}

function isTrustedVideoHostname(hostname: string) {
  const host = hostname.toLowerCase()
  return getTrustedVideoHostRules().some((rule) => {
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1)
      return host.endsWith(suffix) && host.length > suffix.length
    }
    if (rule.startsWith('.')) {
      return host.endsWith(rule) && host.length > rule.length
    }
    return host === rule
  })
}

export function isTrustedLinkedInVideoUrl(videoUrl: string | undefined) {
  if (!videoUrl) return false

  try {
    const url = new URL(videoUrl)
    return url.protocol === 'https:' && isTrustedVideoHostname(url.hostname)
  } catch {
    return false
  }
}

function formatFetchError(error: unknown) {
  if (!(error instanceof Error)) return '未知网络错误'
  const cause = error.cause instanceof Error ? error.cause.message : String(error.cause || '')
  return cause ? `${error.message}: ${cause}` : error.message
}

async function readLinkedInApiError(response: Response): Promise<string> {
  const data = await response.clone().json().catch(() => null) as any
  if (data?.message || data?.error_description || data?.error) {
    return data.message || data.error_description || data.error
  }

  const text = await response.text().catch(() => '')
  return text || response.statusText
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isPrivateIPv4(ip: string) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }

  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateIPv6(ip: string) {
  const value = ip.toLowerCase()
  if (value === '::' || value === '::1') return true
  if (value.startsWith('fe80:')) return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true

  const dotMapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (dotMapped) return isPrivateIPv4(dotMapped[1])

  const hexMapped = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16)
    const low = parseInt(hexMapped[2], 16)
    return isPrivateIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }

  return false
}

function isPrivateResolvedAddress(address: string) {
  const family = net.isIP(address)
  if (family === 4) return isPrivateIPv4(address)
  if (family === 6) return isPrivateIPv6(address)
  return true
}

async function assertSafePublicHttpsUrl(url: URL) {
  if (url.protocol !== 'https:') {
    throw new LinkedInUploadError('LinkedIn 发布要求视频 URL 使用公网 HTTPS 地址')
  }

  if (!isTrustedVideoHostname(url.hostname)) {
    throw new LinkedInUploadError('LinkedIn 视频 URL 仅允许可信 OSS/CDN 域名')
  }

  if (isPrivateOrLoopbackHostname(url.hostname)) {
    throw new LinkedInUploadError('LinkedIn 视频 URL 不能指向私网、localhost 或链路本地地址')
  }

  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true, verbatim: false }).catch((error) => {
      throw new LinkedInUploadError(`无法解析视频 URL 域名: ${formatFetchError(error)}`, true)
    })

  if (addresses.length === 0) {
    throw new LinkedInUploadError('无法解析视频 URL 域名', true)
  }

  const privateAddress = addresses.find((entry) => isPrivateResolvedAddress(entry.address))
  if (privateAddress) {
    throw new LinkedInUploadError('LinkedIn 视频 URL DNS 解析到私网、localhost 或链路本地地址')
  }
}

async function safeFetchVideoUrl(videoUrl: string): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl: URL
  try {
    currentUrl = new URL(videoUrl)
  } catch {
    throw new LinkedInUploadError('LinkedIn 视频 URL 格式无效')
  }

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await assertSafePublicHttpsUrl(currentUrl)

    const response = await fetch(currentUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'StarGaze LinkedIn Publisher/1.0',
      },
    }).catch((error) => {
      throw new LinkedInUploadError(`无法读取视频文件: ${formatFetchError(error)}`, true)
    })

    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: currentUrl.toString() }
    }

    const location = response.headers.get('location')
    if (!location) {
      throw new LinkedInUploadError('视频 URL 重定向缺少 Location 响应头')
    }

    currentUrl = new URL(location, currentUrl)
  }

  throw new LinkedInUploadError(`视频 URL 重定向超过 ${MAX_REDIRECTS} 次`)
}

function isAcceptedMp4ContentType(contentTypeHeader: string | null, finalUrl: string) {
  const contentType = (contentTypeHeader || '').split(';')[0].trim().toLowerCase()
  if (contentType === 'video/mp4' || contentType === 'application/mp4') return true

  try {
    const path = new URL(finalUrl).pathname.toLowerCase()
    return contentType === 'application/octet-stream' && path.endsWith('.mp4')
  } catch {
    return false
  }
}

function parseContentLength(value: string | null) {
  if (!value) return null
  const length = Number(value)
  return Number.isSafeInteger(length) && length >= 0 ? length : null
}

async function readResponseBodyWithLimit(response: Response, expectedLength: number | null): Promise<Uint8Array> {
  if (!response.body) {
    throw new LinkedInUploadError('无法读取视频文件流', true)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    totalBytes += value.byteLength
    if (totalBytes > LINKEDIN_VIDEO_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new LinkedInUploadError(`视频文件不能超过 ${Math.floor(LINKEDIN_VIDEO_MAX_BYTES / 1024 / 1024)}MB`)
    }
    chunks.push(value)
  }

  if (totalBytes < LINKEDIN_VIDEO_MIN_BYTES) {
    throw new LinkedInUploadError('视频文件过小，LinkedIn 发布要求至少 75KB')
  }

  if (expectedLength !== null && expectedLength !== totalBytes) {
    throw new LinkedInUploadError('视频文件读取长度与 Content-Length 不一致', true)
  }

  const buffer = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  return buffer
}

async function fetchVideoFile(videoUrl: string): Promise<LinkedInVideoFile> {
  const { response, finalUrl } = await safeFetchVideoUrl(videoUrl)

  if (!response.ok) {
    throw new LinkedInUploadError(
      `无法读取视频文件: ${response.status} ${response.statusText}`,
      isRetryableHttpStatus(response.status)
    )
  }

  const contentType = response.headers.get('content-type')
  if (!isAcceptedMp4ContentType(contentType, finalUrl)) {
    throw new LinkedInUploadError('LinkedIn 首版仅支持 MP4 视频文件')
  }

  const contentLength = parseContentLength(response.headers.get('content-length'))
  if (contentLength !== null) {
    if (contentLength < LINKEDIN_VIDEO_MIN_BYTES) {
      throw new LinkedInUploadError('视频文件过小，LinkedIn 发布要求至少 75KB')
    }
    if (contentLength > LINKEDIN_VIDEO_MAX_BYTES) {
      throw new LinkedInUploadError(`视频文件不能超过 ${Math.floor(LINKEDIN_VIDEO_MAX_BYTES / 1024 / 1024)}MB`)
    }
  }

  const bytes = await readResponseBodyWithLimit(response, contentLength)
  return {
    bytes,
    contentType: 'video/mp4',
    contentLength: bytes.byteLength,
    finalUrl,
  }
}

function normalizeUploadInstructions(value: unknown): LinkedInUploadInstruction[] {
  if (!Array.isArray(value)) return []

  return value
    .map((instruction: any) => ({
      uploadUrl: instruction?.uploadUrl,
      firstByte: Number(instruction?.firstByte),
      lastByte: Number(instruction?.lastByte),
    }))
    .filter((instruction) =>
      typeof instruction.uploadUrl === 'string' &&
      Number.isSafeInteger(instruction.firstByte) &&
      Number.isSafeInteger(instruction.lastByte) &&
      instruction.firstByte >= 0 &&
      instruction.lastByte >= instruction.firstByte
    )
}

async function initializeLinkedInVideoUpload(
  accessToken: string,
  ownerUrn: string,
  fileSizeBytes: number
): Promise<LinkedInInitializedUpload> {
  const response = await fetch(`${LINKEDIN_VIDEOS_URL}?action=initializeUpload`, {
    method: 'POST',
    headers: getLinkedInRestHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn,
        fileSizeBytes,
      },
    }),
  })

  if (!response.ok) {
    throw new LinkedInUploadError(
      `LinkedIn 初始化视频上传失败: ${await readLinkedInApiError(response)}`,
      isRetryableHttpStatus(response.status)
    )
  }

  const data = await response.json().catch(() => null) as any
  const value = data?.value
  const videoUrn = value?.video
  const uploadInstructions = normalizeUploadInstructions(value?.uploadInstructions)

  if (typeof videoUrn !== 'string' || uploadInstructions.length === 0) {
    throw new LinkedInUploadError('LinkedIn 初始化视频上传未返回 video 或 uploadInstructions', true)
  }

  return {
    videoUrn,
    uploadToken: typeof value?.uploadToken === 'string' && value.uploadToken ? value.uploadToken : null,
    uploadInstructions,
  }
}

async function uploadLinkedInVideoParts(video: LinkedInVideoFile, uploadInstructions: LinkedInUploadInstruction[]) {
  const uploadedPartIds: string[] = []

  for (const instruction of uploadInstructions) {
    if (instruction.lastByte >= video.contentLength) {
      throw new LinkedInUploadError('LinkedIn 返回的上传分片范围超过视频文件大小', true)
    }

    const chunk = video.bytes.slice(instruction.firstByte, instruction.lastByte + 1)
    const response = await fetch(instruction.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(chunk.byteLength),
      },
      body: chunk,
    }).catch((error) => {
      throw new LinkedInUploadError(`LinkedIn 视频分片上传请求失败: ${formatFetchError(error)}`, true)
    })

    if (!response.ok) {
      throw new LinkedInUploadError(
        `LinkedIn 视频分片上传失败: ${await readLinkedInApiError(response)}`,
        isRetryableHttpStatus(response.status)
      )
    }

    const partId = response.headers.get('etag') || response.headers.get('ETag')
    if (!partId) {
      throw new LinkedInUploadError('LinkedIn 视频分片上传成功但未返回 ETag', true)
    }

    uploadedPartIds.push(partId.replace(/^"|"$/g, ''))
  }

  return uploadedPartIds
}

async function finalizeLinkedInVideoUpload(
  accessToken: string,
  videoUrn: string,
  uploadToken: string | null,
  uploadedPartIds: string[]
) {
  const response = await fetch(`${LINKEDIN_VIDEOS_URL}?action=finalizeUpload`, {
    method: 'POST',
    headers: getLinkedInRestHeaders(accessToken),
    body: JSON.stringify({
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken: uploadToken || '',
        uploadedPartIds,
      },
    }),
  })

  if (!response.ok) {
    throw new LinkedInUploadError(
      `LinkedIn 完成视频上传失败: ${await readLinkedInApiError(response)}`,
      isRetryableHttpStatus(response.status)
    )
  }
}

async function getLinkedInVideoStatus(accessToken: string, videoUrn: string) {
  const response = await fetch(`${LINKEDIN_VIDEOS_URL}/${encodeURIComponent(videoUrn)}`, {
    headers: getLinkedInRestHeaders(accessToken),
  })

  if (!response.ok) {
    throw new LinkedInUploadError(
      `LinkedIn 查询视频状态失败: ${await readLinkedInApiError(response)}`,
      isRetryableHttpStatus(response.status)
    )
  }

  const data = await response.json().catch(() => null) as any
  return String(data?.status || data?.value?.status || '').toUpperCase()
}

function buildShareCommentary(title: string, description: string, tags: string[]) {
  return [title.trim(), appendLinkedInTags(description || '', tags)].filter(Boolean).join('\n\n')
}

async function createLinkedInVideoPost(
  accessToken: string,
  ownerUrn: string,
  videoUrn: string,
  options: UploadLinkedInVideoOptions
) {
  const tags = normalizeLinkedInTags(options.tags)
  const title = (options.title || 'Untitled video').trim()
  const description = options.description || ''
  const titleError = validateLinkedInTitle(title)
  const descriptionError = validateLinkedInDescription(description)
  const tagsError = validateLinkedInTags(tags)

  if (titleError || descriptionError || tagsError) {
    throw new LinkedInUploadError(titleError || descriptionError || tagsError || 'LinkedIn metadata 不符合平台规则')
  }

  if (!ownerUrn.startsWith('urn:li:person:')) {
    throw new LinkedInUploadError('LinkedIn 首版仅支持个人身份发布')
  }

  const response = await fetch(LINKEDIN_POSTS_URL, {
    method: 'POST',
    headers: getLinkedInRestHeaders(accessToken),
    body: JSON.stringify({
      author: ownerUrn,
      commentary: buildShareCommentary(title, description, tags),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: {
        media: {
          id: videoUrn,
          title,
        },
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  })

  if (!response.ok) {
    throw new LinkedInUploadError(
      `LinkedIn 创建帖子失败: ${await readLinkedInApiError(response)}`,
      isRetryableHttpStatus(response.status)
    )
  }

  const data = await response.json().catch(() => null) as any
  const postUrn = response.headers.get('x-restli-id') || data?.id || data?.value?.id
  if (typeof postUrn !== 'string' || !postUrn) {
    throw new LinkedInUploadError('LinkedIn 创建帖子成功但未返回 post URN', true)
  }

  return {
    postUrn,
    shareUrl: `https://www.linkedin.com/feed/update/${postUrn}`,
  }
}

export async function uploadLinkedInVideoAssetFromUrl(
  accessToken: string,
  videoUrl: string,
  ownerUrn: string
): Promise<LinkedInFinalizedVideoUploadResult> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
    try {
      const video = await fetchVideoFile(videoUrl)
      const initialized = await initializeLinkedInVideoUpload(accessToken, ownerUrn, video.contentLength)
      const uploadedPartIds = await uploadLinkedInVideoParts(video, initialized.uploadInstructions)
      await finalizeLinkedInVideoUpload(accessToken, initialized.videoUrn, initialized.uploadToken, uploadedPartIds)

      return {
        assetUrn: initialized.videoUrn,
        attempts: attempt,
      }
    } catch (error) {
      lastError = error
      if (error instanceof LinkedInUploadError) {
        error.attempts = attempt
      }
      if (attempt >= MAX_UPLOAD_ATTEMPTS || !isRetryableUploadError(error)) break
      await sleep(getRetryDelayMs(attempt))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('LinkedIn 上传失败')
}

export async function publishLinkedInFinalizedVideo(
  accessToken: string,
  videoUrn: string,
  options: UploadLinkedInVideoOptions,
  beforeCreatePost?: () => Promise<void>
): Promise<LinkedInVideoPostResult> {
  const status = await getLinkedInVideoStatus(accessToken, videoUrn)

  if (status === 'AVAILABLE' || status === 'READY') {
    await beforeCreatePost?.()
    return createLinkedInVideoPost(accessToken, options.ownerUrn, videoUrn, options)
  }

  if (status === 'PROCESSING_FAILED' || status === 'FAILED') {
    throw new LinkedInVideoProcessingFailedError(status)
  }

  throw new LinkedInVideoStillProcessingError(status || 'PROCESSING')
}

export async function uploadLinkedInVideoFromUrl(
  accessToken: string,
  videoUrl: string,
  options: UploadLinkedInVideoOptions
): Promise<LinkedInVideoUploadResult> {
  const upload = await uploadLinkedInVideoAssetFromUrl(accessToken, videoUrl, options.ownerUrn)
  const post = await publishLinkedInFinalizedVideo(accessToken, upload.assetUrn, options)

  return {
    ...post,
    assetUrn: upload.assetUrn,
    attempts: upload.attempts,
  }
}
