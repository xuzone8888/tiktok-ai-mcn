/**
 * Aliyun OSS Utility for Video Upload
 * 
 * This module provides functions to upload videos to Aliyun OSS
 * and return publicly accessible HTTPS URLs for TikTok publishing.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS = require('ali-oss')

// OSS client configuration
const ossConfig = {
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
    endpoint: process.env.ALIYUN_OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com',
    secure: true, // Use HTTPS
}

// Custom domain for public URLs
const CUSTOM_DOMAIN = process.env.ALIYUN_OSS_CUSTOM_DOMAIN || 'media.tokfactoryai.com'

/**
 * Create OSS client instance
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createOSSClient(): any {
    if (!ossConfig.accessKeyId || !ossConfig.accessKeySecret) {
        throw new Error('OSS credentials not configured')
    }
    return new OSS(ossConfig)
}

/**
 * Generate a unique file path for video upload
 * Format: videos/{userId}/{timestamp}-{randomId}.{ext}
 */
export function generateVideoPath(userId: string, fileName: string): string {
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 10)
    const ext = fileName.split('.').pop()?.toLowerCase() || 'mp4'
    return `videos/${userId}/${timestamp}-${randomId}.${ext}`
}

/**
 * Get public HTTPS URL for an OSS object
 */
export function getPublicUrl(objectPath: string): string {
    return `https://${CUSTOM_DOMAIN}/${objectPath}`
}

/**
 * Upload video buffer to OSS
 * @param buffer - Video file buffer
 * @param objectPath - OSS object path (use generateVideoPath)
 * @param contentType - MIME type of the video
 * @returns Public HTTPS URL of the uploaded video
 */
export async function uploadVideoBuffer(
    buffer: Buffer,
    objectPath: string,
    contentType: string = 'video/mp4'
): Promise<string> {
    const client = createOSSClient()

    const result = await client.put(objectPath, buffer, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'max-age=31536000', // Cache for 1 year
        },
    })

    if (!result.name) {
        throw new Error('Failed to upload video to OSS')
    }

    return getPublicUrl(objectPath)
}

/**
 * Upload video from stream to OSS
 * @param stream - Readable stream of video data
 * @param objectPath - OSS object path
 * @param contentType - MIME type
 * @returns Public HTTPS URL
 */
export async function uploadVideoStream(
    stream: NodeJS.ReadableStream,
    objectPath: string,
    contentType: string = 'video/mp4'
): Promise<string> {
    const client = createOSSClient()

    const result = await client.putStream(objectPath, stream, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'max-age=31536000',
        },
    })

    if (!result.name) {
        throw new Error('Failed to upload video stream to OSS')
    }

    return getPublicUrl(objectPath)
}

/**
 * Delete a video from OSS
 * @param objectPath - OSS object path
 */
export async function deleteVideo(objectPath: string): Promise<void> {
    const client = createOSSClient()
    await client.delete(objectPath)
}

/**
 * Check if video exists in OSS
 * @param objectPath - OSS object path
 */
export async function videoExists(objectPath: string): Promise<boolean> {
    const client = createOSSClient()
    try {
        await client.head(objectPath)
        return true
    } catch {
        return false
    }
}

/**
 * Get video metadata from OSS
 * @param objectPath - OSS object path
 */
export async function getVideoMetadata(objectPath: string): Promise<{
    size: number
    contentType: string
    lastModified: Date
} | null> {
    const client = createOSSClient()
    try {
        const result = await client.head(objectPath)
        return {
            size: parseInt(result.res.headers['content-length'] || '0'),
            contentType: result.res.headers['content-type'] || 'video/mp4',
            lastModified: new Date(result.res.headers['last-modified'] || Date.now()),
        }
    } catch {
        return null
    }
}

/**
 * Validate video URL is from our OSS
 */
export function isOSSVideoUrl(url: string): boolean {
    return url.startsWith(`https://${CUSTOM_DOMAIN}/`) ||
        url.includes('.aliyuncs.com/')
}

/**
 * Extract object path from OSS URL
 */
export function extractObjectPath(url: string): string | null {
    try {
        const urlObj = new URL(url)
        if (urlObj.hostname === CUSTOM_DOMAIN) {
            return urlObj.pathname.slice(1) // Remove leading /
        }
        // Handle default OSS domain
        if (urlObj.hostname.includes('.aliyuncs.com')) {
            return urlObj.pathname.slice(1)
        }
        return null
    } catch {
        return null
    }
}

export default {
    generateVideoPath,
    getPublicUrl,
    uploadVideoBuffer,
    uploadVideoStream,
    deleteVideo,
    videoExists,
    getVideoMetadata,
    isOSSVideoUrl,
    extractObjectPath,
}
