export const DEFAULT_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'] as const
export const INSTAGRAM_VIDEO_EXTENSIONS = ['.mp4', '.mov'] as const
export const INSTAGRAM_MAX_VIDEO_FILE_SIZE_BYTES = 1024 * 1024 * 1024

const INSTAGRAM_MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  '.mp4': ['video/mp4'],
  '.mov': ['video/quicktime', 'video/mp4'],
}

export type InstagramMediaValidationError =
  | 'unsupported_format'
  | 'invalid_file_size'
  | 'file_too_large'

const INSTAGRAM_UPLOAD_ERROR_EN: Record<string, string> = {
  unsupported_media_type: 'Use an MP4 or MOV file with a supported video MIME type.',
  empty_file: 'The video file is empty.',
  file_too_large: 'The video must be 1 GB or smaller.',
  media_not_supported: 'The video does not meet Instagram Reels media requirements.',
  media_unreadable: 'The video file is damaged or could not be read.',
  probe_unavailable: 'Video validation is temporarily unavailable on the server.',
  probe_timeout: 'Server-side video validation timed out. Try again later.',
  probe_failed: 'The server could not inspect the video media.',
  probe_invalid_output: 'The server returned invalid video inspection data.',
  local_upload_failed: 'The local Instagram upload failed.',
}

function normalizeExtension(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return ''
  return normalized.startsWith('.') ? normalized : `.${normalized}`
}

export function getVideoFileExtension(filename: string) {
  const extension = filename.split('.').pop()
  return extension ? normalizeExtension(extension) : ''
}

export function normalizeMediaContentType(value: string | null | undefined) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || ''
}

export function isInstagramMediaTypeAllowed(filename: string, contentType: string | null | undefined) {
  const extension = getVideoFileExtension(filename)
  const allowedMimeTypes = INSTAGRAM_MIME_BY_EXTENSION[extension]
  return Boolean(allowedMimeTypes?.includes(normalizeMediaContentType(contentType)))
}

export function getInstagramUploadErrorMessage(input: {
  code?: string
  serverMessage?: string
  status: number
  isEnglish: boolean
}) {
  if (input.isEnglish) {
    return (input.code && INSTAGRAM_UPLOAD_ERROR_EN[input.code]) ||
      `Instagram upload failed (${input.status}).`
  }
  return input.serverMessage?.trim() || `Instagram 上传失败 (${input.status})`
}

export function getAcceptedVideoExtensions(configured?: readonly string[]) {
  const normalized = configured
    ?.map(normalizeExtension)
    .filter(Boolean)

  return normalized?.length ? normalized : [...DEFAULT_VIDEO_EXTENSIONS]
}

export function getVideoFormatsLabel(configured?: readonly string[], label?: string) {
  return label?.trim() || getAcceptedVideoExtensions(configured).join(' ')
}

export function isVideoSelectionAllowed(input: {
  filename: string
  fileSize: number
  acceptedExtensions?: readonly string[]
  maxFileSizeBytes: number
}) {
  const extension = getVideoFileExtension(input.filename)
  return getAcceptedVideoExtensions(input.acceptedExtensions).includes(extension) &&
    input.fileSize <= input.maxFileSizeBytes
}

export function validateInstagramMediaUpload(input: {
  filename: string
  contentType: string
  fileSize: unknown
}): InstagramMediaValidationError | null {
  if (!input.filename || !isInstagramMediaTypeAllowed(input.filename, input.contentType)) {
    return 'unsupported_format'
  }

  if (
    typeof input.fileSize !== 'number' ||
    !Number.isFinite(input.fileSize) ||
    !Number.isInteger(input.fileSize) ||
    input.fileSize <= 0
  ) {
    return 'invalid_file_size'
  }

  if (input.fileSize > INSTAGRAM_MAX_VIDEO_FILE_SIZE_BYTES) {
    return 'file_too_large'
  }

  return null
}
