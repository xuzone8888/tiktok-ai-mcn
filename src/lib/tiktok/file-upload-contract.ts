const TIKTOK_UPLOAD_HOSTS = new Set([
    'open-upload.tiktokapis.com',
    'open-upload.tiktokapis.us',
    'upload.us.tiktokapis.com',
])
const MAX_TIKTOK_UPLOAD_URL_LENGTH = 8 * 1024

export function isTrustedTikTokUploadUrl(uploadUrl: string): boolean {
    if (!uploadUrl || uploadUrl.length > MAX_TIKTOK_UPLOAD_URL_LENGTH) return false

    try {
        const parsed = new URL(uploadUrl)
        return parsed.protocol === 'https:'
            && !parsed.username
            && !parsed.password
            && (!parsed.port || parsed.port === '443')
            && TIKTOK_UPLOAD_HOSTS.has(parsed.hostname)
            && Boolean(parsed.search)
            && !parsed.hash
    } catch {
        return false
    }
}
