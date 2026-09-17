export const PREVIEW_POSTER_MAX = 512 * 1024
export const PREVIEW_UPLOAD_SECONDS = 15 * 60
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function previewKey(ownerId: string, uploadId: string, kind: 'video' | 'poster') {
  if (!uuid.test(ownerId) || !uuid.test(uploadId) || !['video', 'poster'].includes(kind)) throw new Error('invalid_preview_key')
  return `tiktok-previews/${ownerId}/${uploadId}/${kind}`
}

/** Only a single byte range; never forward arbitrary browser headers to storage. */
export function previewRange(header: string | null, size: number): { start: number; end: number } | null {
  if (header === null) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size < 1) throw new Error('invalid_range')
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) < 1)) throw new Error('invalid_range')
  return { start, end }
}

export function previewPostPolicy(bucket: string, key: string, type: string, size: number, expiresAt: string) {
  return {
    expiration: expiresAt,
    conditions: [
      { bucket }, ['eq', '$key', key], ['eq', '$x-oss-content-type', type],
      ['content-length-range', size, size], ['eq', '$x-oss-object-acl', 'private'],
      ['eq', '$x-oss-forbid-overwrite', 'true'], ['eq', '$success_action_status', '204'],
    ],
  }
}
