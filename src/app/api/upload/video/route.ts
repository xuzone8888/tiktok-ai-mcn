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
                { error: 'Authentication required. Please log in first.' },
                { status: 401 }
            )
        }

        // Parse form data
        const formData = await request.formData()
        const file = formData.get('file') as File | null

        if (!file) {
            return NextResponse.json(
                { error: 'No video file selected. Please choose a file to upload.' },
                { status: 400 }
            )
        }

        // Validate file type
        const fileType = file.type.toLowerCase()
        const fileName = file.name.toLowerCase()
        const fileExt = '.' + fileName.split('.').pop()

        if (!ALLOWED_TYPES.includes(fileType) && !ALLOWED_EXTENSIONS.includes(fileExt)) {
            return NextResponse.json(
                { error: `Unsupported video format. Accepted formats: ${ALLOWED_EXTENSIONS.join(', ')}` },
                { status: 400 }
            )
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            const sizeMB = Math.round(file.size / (1024 * 1024))
            return NextResponse.json(
                { error: `File too large (${sizeMB}MB). Maximum allowed size is 500MB.` },
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
                    { error: 'Storage service configuration error. Please contact support.' },
                    { status: 500 }
                )
            }
        }

        return NextResponse.json(
            { error: 'Video upload failed. Please try again later.' },
            { status: 500 }
        )
    }
}

// Next.js 14 route segment config for large file uploads
export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes timeout for large video uploads
