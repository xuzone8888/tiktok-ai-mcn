import type { TikTokVideoMimeType } from './content-posting'

export const TIKTOK_MAX_LOCAL_FILE_BYTES = 4 * 1024 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, TikTokVideoMimeType> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
}

export function resolveTikTokLocalVideoMimeType(options: {
    filename: string
    reportedMimeType: string
    sizeBytes: number
}): TikTokVideoMimeType | null {
    if (
        !Number.isSafeInteger(options.sizeBytes)
        || options.sizeBytes <= 0
        || options.sizeBytes > TIKTOK_MAX_LOCAL_FILE_BYTES
    ) {
        return null
    }

    const dotIndex = options.filename.lastIndexOf('.')
    const extension = dotIndex >= 0 ? options.filename.slice(dotIndex).toLowerCase() : ''
    const expectedMimeType = MIME_BY_EXTENSION[extension]
    if (!expectedMimeType) return null

    const reportedMimeType = options.reportedMimeType.trim().toLowerCase()
    if (reportedMimeType && reportedMimeType !== expectedMimeType) return null
    return expectedMimeType
}
