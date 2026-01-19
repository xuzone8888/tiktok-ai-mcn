/**
 * Aliyun OSS Utility for Media Storage
 * 
 * This module provides functions to upload videos, images, and other media
 * to Aliyun OSS and return publicly accessible HTTPS URLs.
 * 
 * StorageFolders:
 *   - videos/{userId}/ - User uploaded videos for TikTok publishing
 *   - quick-gen/{userId}/ - AI generated videos from Quick Gen
 *   - images/{userId}/ - User uploaded images
 *   - products/{userId}/ - Product images
 *   - avatars/{userId}/ - User avatars (if needed)
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
    timeout: 300000, // 5 minutes timeout for large file uploads
}

// Custom domain for public URLs
const CUSTOM_DOMAIN = process.env.ALIYUN_OSS_CUSTOM_DOMAIN || 'media.tokfactoryai.com'

// Supported media types
export type MediaType = 'video' | 'image' | 'audio'

export type StorageFolder =
    | 'videos'
    | 'quick-gen'
    | 'images'
    | 'products'
    | 'avatars'
    | 'model-avatars'    // AI 模特头像
    | 'model-demos'      // AI 模特演示视频
    | 'user-uploads'     // 用户上传
    | 'misc'

/**
 * Check if OSS is properly configured
 */
export function isOSSConfigured(): boolean {
    return !!(ossConfig.accessKeyId && ossConfig.accessKeySecret)
}

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
 * Generate a unique file path for any media upload
 * Format: {folder}/{userId}/{timestamp}-{randomId}.{ext}
 */
export function generateMediaPath(
    folder: StorageFolder,
    userId: string,
    fileName: string
): string {
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 10)
    const ext = fileName.split('.').pop()?.toLowerCase() || 'bin'
    return `${folder}/${userId}/${timestamp}-${randomId}.${ext}`
}

/**
 * Generate a unique file path for video upload
 * Format: videos/{userId}/{timestamp}-{randomId}.{ext}
 */
export function generateVideoPath(userId: string, fileName: string): string {
    return generateMediaPath('videos', userId, fileName)
}

/**
 * Generate a unique file path for image upload
 * Format: images/{userId}/{timestamp}-{randomId}.{ext}
 */
export function generateImagePath(userId: string, fileName: string): string {
    return generateMediaPath('images', userId, fileName)
}

/**
 * Generate a unique file path for Quick Gen videos
 * Format: quick-gen/{userId}/{timestamp}-{randomId}.{ext}
 */
export function generateQuickGenPath(userId: string, fileName: string): string {
    return generateMediaPath('quick-gen', userId, fileName)
}

/**
 * Generate a unique file path for product images
 * Format: products/{userId}/{timestamp}-{randomId}.{ext}
 */
export function generateProductPath(userId: string, fileName: string): string {
    return generateMediaPath('products', userId, fileName)
}

/**
 * Get public HTTPS URL for an OSS object
 */
export function getPublicUrl(objectPath: string): string {
    return `https://${CUSTOM_DOMAIN}/${objectPath}`
}

/**
 * Upload any buffer to OSS
 * @param buffer - File buffer
 * @param objectPath - OSS object path
 * @param contentType - MIME type
 * @returns Public HTTPS URL
 */
export async function uploadBuffer(
    buffer: Buffer | ArrayBuffer | Uint8Array,
    objectPath: string,
    contentType: string
): Promise<string> {
    const client = createOSSClient()

    // Convert to Buffer if necessary
    let uploadBuffer: Buffer
    if (buffer instanceof Buffer) {
        uploadBuffer = buffer
    } else if (buffer instanceof Uint8Array) {
        uploadBuffer = Buffer.from(buffer)
    } else {
        // ArrayBuffer case
        uploadBuffer = Buffer.from(new Uint8Array(buffer))
    }

    const result = await client.put(objectPath, uploadBuffer, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'max-age=31536000', // Cache for 1 year
        },
    })

    if (!result.name) {
        throw new Error('Failed to upload file to OSS')
    }

    return getPublicUrl(objectPath)
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
    return uploadBuffer(buffer, objectPath, contentType)
}

/**
 * Upload image buffer to OSS
 * @param buffer - Image file buffer
 * @param objectPath - OSS object path (use generateImagePath)
 * @param contentType - MIME type of the image
 * @returns Public HTTPS URL of the uploaded image
 */
export async function uploadImageBuffer(
    buffer: Buffer | ArrayBuffer | Uint8Array,
    objectPath: string,
    contentType: string = 'image/jpeg'
): Promise<string> {
    return uploadBuffer(buffer, objectPath, contentType)
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
 * Delete a file from OSS
 * @param objectPath - OSS object path
 */
export async function deleteFile(objectPath: string): Promise<void> {
    const client = createOSSClient()
    await client.delete(objectPath)
}

/**
 * Delete a video from OSS (alias for deleteFile)
 * @param objectPath - OSS object path
 */
export async function deleteVideo(objectPath: string): Promise<void> {
    return deleteFile(objectPath)
}

/**
 * Check if file exists in OSS
 * @param objectPath - OSS object path
 */
export async function fileExists(objectPath: string): Promise<boolean> {
    const client = createOSSClient()
    try {
        await client.head(objectPath)
        return true
    } catch {
        return false
    }
}

/**
 * Check if video exists in OSS (alias for fileExists)
 * @param objectPath - OSS object path
 */
export async function videoExists(objectPath: string): Promise<boolean> {
    return fileExists(objectPath)
}

/**
 * Get file metadata from OSS
 * @param objectPath - OSS object path
 */
export async function getFileMetadata(objectPath: string): Promise<{
    size: number
    contentType: string
    lastModified: Date
} | null> {
    const client = createOSSClient()
    try {
        const result = await client.head(objectPath)
        return {
            size: parseInt(result.res.headers['content-length'] || '0'),
            contentType: result.res.headers['content-type'] || 'application/octet-stream',
            lastModified: new Date(result.res.headers['last-modified'] || Date.now()),
        }
    } catch {
        return null
    }
}

/**
 * Get video metadata from OSS (alias for getFileMetadata)
 * @param objectPath - OSS object path
 */
export async function getVideoMetadata(objectPath: string): Promise<{
    size: number
    contentType: string
    lastModified: Date
} | null> {
    return getFileMetadata(objectPath)
}

/**
 * Validate URL is from our OSS
 */
export function isOSSUrl(url: string): boolean {
    return url.startsWith(`https://${CUSTOM_DOMAIN}/`) ||
        url.includes('.aliyuncs.com/')
}

/**
 * Validate video URL is from our OSS (alias for isOSSUrl)
 */
export function isOSSVideoUrl(url: string): boolean {
    return isOSSUrl(url)
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

/**
 * Get content type based on file extension
 */
export function getContentType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
        // Video
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mov': 'video/quicktime',
        'avi': 'video/x-msvideo',
        // Image
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        // Audio
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
    }
    return mimeTypes[ext || ''] || 'application/octet-stream'
}

export default {
    // Configuration
    isOSSConfigured,
    // Path generation
    generateMediaPath,
    generateVideoPath,
    generateImagePath,
    generateQuickGenPath,
    generateProductPath,
    // URL helpers
    getPublicUrl,
    isOSSUrl,
    isOSSVideoUrl,
    extractObjectPath,
    getContentType,
    // Upload functions
    uploadBuffer,
    uploadVideoBuffer,
    uploadImageBuffer,
    uploadVideoStream,
    // Delete functions
    deleteFile,
    deleteVideo,
    // Check functions
    fileExists,
    videoExists,
    getFileMetadata,
    getVideoMetadata,
}
