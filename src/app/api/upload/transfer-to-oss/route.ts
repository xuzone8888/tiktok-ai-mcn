/**
 * 视频转存 OSS API
 * 
 * 将成品库的视频（第三方临时 URL）下载并上传到我们的 OSS
 * 返回永久可用的 OSS URL，可用于封面选择和 TikTok 发布
 * 
 * POST /api/upload/transfer-to-oss
 * Body: { sourceUrl: string, filename?: string }
 * Returns: { success: boolean, data: { url: string, key: string } }
 */

import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS = require('ali-oss')

// OSS configuration
const ossConfig = {
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
    endpoint: process.env.ALIYUN_OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com',
    secure: true,
    timeout: 300000, // 5 minutes for large video downloads
}

const CUSTOM_DOMAIN = process.env.ALIYUN_OSS_CUSTOM_DOMAIN || 'media.toryxai.com'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes timeout

export async function POST(request: NextRequest) {
    try {
        // Authenticate user
        const supabase = await createServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json(
                { success: false, error: "请先登录" },
                { status: 401 }
            )
        }

        // Parse request body
        const body = await request.json()
        const { sourceUrl, filename } = body

        if (!sourceUrl) {
            return NextResponse.json(
                { success: false, error: "缺少源视频 URL" },
                { status: 400 }
            )
        }

        // Validate URL
        try {
            new URL(sourceUrl)
        } catch {
            return NextResponse.json(
                { success: false, error: "无效的视频 URL" },
                { status: 400 }
            )
        }

        // Check OSS config
        if (!ossConfig.accessKeyId || !ossConfig.accessKeySecret) {
            console.error('[Transfer OSS] OSS not configured')
            return NextResponse.json(
                { success: false, error: "存储服务未配置" },
                { status: 500 }
            )
        }

        console.log('[Transfer OSS] Starting transfer:', {
            userId: user.id,
            sourceUrl: sourceUrl.substring(0, 100) + '...',
        })

        // Step 1: Fetch video stream (not buffer!)
        const downloadResponse = await fetch(sourceUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        })

        if (!downloadResponse.ok) {
            console.error('[Transfer OSS] Download failed:', downloadResponse.status, sourceUrl)

            // Provide specific error messages based on status code
            let errorMessage = '下载视频失败'
            if (downloadResponse.status === 403) {
                errorMessage = '视频已过期或无访问权限 (403)'
            } else if (downloadResponse.status === 404) {
                errorMessage = '视频不存在 (404)'
            } else if (downloadResponse.status === 410) {
                errorMessage = '视频已被删除 (410)'
            } else if (downloadResponse.status >= 500) {
                errorMessage = '源服务器错误，请稍后重试'
            } else {
                errorMessage = `下载失败 (HTTP ${downloadResponse.status})`
            }

            return NextResponse.json(
                { success: false, error: errorMessage, expired: downloadResponse.status === 403 || downloadResponse.status === 404 || downloadResponse.status === 410 },
                { status: 502 }
            )
        }

        const contentType = downloadResponse.headers.get('content-type') || 'video/mp4'
        const contentLength = downloadResponse.headers.get('content-length')

        console.log('[Transfer OSS] Starting stream transfer:', {
            contentType,
            contentLength: contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB` : 'unknown',
        })

        // Step 2: Generate unique file path
        const timestamp = Date.now()
        const randomStr = Math.random().toString(36).substring(2, 8)
        const ext = contentType.includes('webm') ? 'webm' : 'mp4'
        const safeFilename = filename
            ? filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 50)
            : 'video'
        const key = `videos/${user.id}/${timestamp}-${randomStr}-${safeFilename}.${ext}`

        // Step 3: Download and upload to OSS
        // Note: Using arrayBuffer instead of stream due to Next.js bundling compatibility
        const client = new OSS(ossConfig)

        const videoBuffer = await downloadResponse.arrayBuffer()

        console.log('[Transfer OSS] Downloaded buffer:', {
            size: `${(videoBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`,
        })

        const result = await client.put(key, Buffer.from(videoBuffer), {
            mime: contentType,
            headers: {
                'Content-Type': contentType,
                'x-oss-storage-class': 'Standard',
            },
        })

        if (!result || !result.name) {
            console.error('[Transfer OSS] Upload failed:', result)
            return NextResponse.json(
                { success: false, error: "上传到 OSS 失败" },
                { status: 500 }
            )
        }

        // Generate public URL with custom domain
        const publicUrl = `https://${CUSTOM_DOMAIN}/${key}`

        console.log('[Transfer OSS] Stream transfer complete:', {
            userId: user.id,
            key,
            url: publicUrl,
            size: contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB` : 'unknown',
        })

        return NextResponse.json({
            success: true,
            data: {
                url: publicUrl,
                key,
                size: contentLength ? parseInt(contentLength) : 0,
            }
        })

    } catch (error) {
        // Enhanced diagnostic logging
        const errorDetails = {
            type: 'UNKNOWN',
            message: '',
            code: '',
        }

        if (error instanceof Error) {
            errorDetails.message = error.message

            // Classify error type
            if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
                errorDetails.type = 'TIMEOUT'
            } else if (error.message.includes('ECONNRESET') || error.message.includes('ECONNREFUSED')) {
                errorDetails.type = 'CONNECTION_ERROR'
            } else if (error.message.includes('memory') || error.message.includes('heap')) {
                errorDetails.type = 'MEMORY_ERROR'
            } else if (error.message.includes('stream') || error.message.includes('pipe')) {
                errorDetails.type = 'STREAM_ERROR'
            } else if (error.message.includes('OSS') || error.message.includes('oss')) {
                errorDetails.type = 'OSS_ERROR'
            }

            // Extract error code if available
            if ('code' in error) {
                errorDetails.code = String((error as NodeJS.ErrnoException).code)
            }
        }

        console.error('[Transfer OSS] DIAGNOSTIC ERROR:', {
            errorType: errorDetails.type,
            errorMessage: errorDetails.message,
            errorCode: errorDetails.code,
            timestamp: new Date().toISOString(),
            stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined,
        })

        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "视频转存失败", errorType: errorDetails.type },
            { status: 500 }
        )
    }
}
