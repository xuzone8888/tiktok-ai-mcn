/**
 * Video Upload API
 * 
 * Handles video file uploads to Aliyun OSS and returns public HTTPS URLs
 * for use in TikTok publishing.
 * 
 * POST /api/upload/video
 * - Accepts multipart form data with video file
 * - Uploads to OSS
 * - Returns public HTTPS URL
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { uploadVideoBuffer, generateVideoPath } from '@/lib/oss'

// Max file size: 500MB (TikTok limit is 4GB, but we set a reasonable limit)
const MAX_FILE_SIZE = 500 * 1024 * 1024

// Allowed video MIME types
const ALLOWED_TYPES = [
    'video/mp4',
    'video/webm',
    'video/quicktime', // .mov
    'video/x-msvideo', // .avi
]

// Allowed extensions
const ALLOWED_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi']

export async function POST(request: NextRequest) {
    try {
        // Authenticate user
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json(
                { error: '请先登录' },
                { status: 401 }
            )
        }

        // Parse form data
        const formData = await request.formData()
        const file = formData.get('file') as File | null

        if (!file) {
            return NextResponse.json(
                { error: '请选择要上传的视频文件' },
                { status: 400 }
            )
        }

        // Validate file type
        const fileType = file.type.toLowerCase()
        const fileName = file.name.toLowerCase()
        const fileExt = '.' + fileName.split('.').pop()

        if (!ALLOWED_TYPES.includes(fileType) && !ALLOWED_EXTENSIONS.includes(fileExt)) {
            return NextResponse.json(
                { error: `不支持的视频格式。支持的格式：${ALLOWED_EXTENSIONS.join(', ')}` },
                { status: 400 }
            )
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            const sizeMB = Math.round(file.size / (1024 * 1024))
            return NextResponse.json(
                { error: `视频文件过大 (${sizeMB}MB)。最大支持 500MB` },
                { status: 400 }
            )
        }

        // Generate unique path for the video
        const objectPath = generateVideoPath(user.id, file.name)

        // Convert file to buffer
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // Upload to OSS
        console.log(`Uploading video to OSS: ${objectPath}`)
        const publicUrl = await uploadVideoBuffer(buffer, objectPath, file.type || 'video/mp4')
        console.log(`Video uploaded successfully: ${publicUrl}`)

        // Return the public URL
        return NextResponse.json({
            success: true,
            url: publicUrl,
            fileName: file.name,
            fileSize: file.size,
            objectPath: objectPath,
        })

    } catch (error) {
        console.error('Video upload error:', error)

        if (error instanceof Error) {
            // Handle specific OSS errors
            if (error.message.includes('credentials')) {
                return NextResponse.json(
                    { error: 'OSS 配置错误，请联系管理员' },
                    { status: 500 }
                )
            }
        }

        return NextResponse.json(
            { error: '视频上传失败，请稍后重试' },
            { status: 500 }
        )
    }
}

// Next.js 14 route segment config for large file uploads
export const runtime = 'nodejs'
export const maxDuration = 60 // 60 seconds timeout for video upload
