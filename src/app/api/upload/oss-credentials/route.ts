/**
 * OSS Direct Upload Credentials API
 *
 * Returns signed URLs for browser-direct uploads to OSS
 * Bypasses server, supports unlimited concurrent uploads.
 *
 * POST /api/upload/oss-credentials
 * Body: { filename: string, contentType: string }
 * Returns: { uploadUrl: string, publicUrl: string, key: string }
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
}

const CUSTOM_DOMAIN = process.env.ALIYUN_OSS_CUSTOM_DOMAIN || 'media.toryxai.com'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
    try {
        // Authenticate user
        const supabase = await createServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json(
                { success: false, error: "Authentication required. Please log in first." },
                { status: 401 }
            )
        }

        // Parse request body
        const body = await request.json()
        const { filename, contentType } = body

        if (!filename) {
            return NextResponse.json(
                { success: false, error: "Missing filename parameter" },
                { status: 400 }
            )
        }

        // Validate content type
        const validTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo']
        const mimeType = contentType || 'video/mp4'

        if (!validTypes.includes(mimeType)) {
            return NextResponse.json(
                { success: false, error: "Unsupported video format" },
                { status: 400 }
            )
        }

        // Check OSS config
        if (!ossConfig.accessKeyId || !ossConfig.accessKeySecret) {
            console.error('[OSS Credentials] OSS not configured')
            return NextResponse.json(
                { success: false, error: "Storage service not configured" },
                { status: 500 }
            )
        }

        // Generate unique file path
        const timestamp = Date.now()
        const randomStr = Math.random().toString(36).substring(2, 8)
        const ext = filename.split('.').pop() || 'mp4'
        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 50)
        const key = `videos/${user.id}/${timestamp}-${randomStr}-${safeFilename}`

        // Create OSS client
        const client = new OSS(ossConfig)

        // Generate signed PUT URL (valid for 15 minutes)
        const expiration = 15 * 60 // 15 minutes in seconds
        const uploadUrl = client.signatureUrl(key, {
            method: 'PUT',
            expires: expiration,
            'Content-Type': mimeType,
        })

        // Generate public URL using custom domain
        const publicUrl = `https://${CUSTOM_DOMAIN}/${key}`

        console.log('[OSS Credentials] Generated upload URL:', {
            userId: user.id,
            key,
            expiration: `${expiration}s`,
        })

        return NextResponse.json({
            success: true,
            data: {
                uploadUrl,    // Browser uses this to PUT the file directly
                publicUrl,    // Final URL after upload completes
                key,          // OSS object key
                expiresIn: expiration,
            }
        })

    } catch (error) {
        console.error('[OSS Credentials] Error:', error)
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Failed to generate upload credentials" },
            { status: 500 }
        )
    }
}
