import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

import { createClient } from '@/lib/supabase/server'
import { isTikTokGroupsDemoMode } from '@/lib/tiktok/demo-account-groups'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS = require('ali-oss')

const MAX_FILES = 40
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024
const SIGNATURE_EXPIRES_SECONDS = 2 * 60 * 60
const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001'
const ALLOWED_MIME_BY_EXTENSION: Record<string, string[]> = {
    mp4: ['video/mp4'],
    webm: ['video/webm'],
    mov: ['video/quicktime', 'video/mp4'],
}

const ossConfig = {
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
    endpoint: process.env.ALIYUN_OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com',
    secure: true,
}

const CUSTOM_DOMAIN = (process.env.ALIYUN_OSS_CUSTOM_DOMAIN || 'media.toryxai.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')

export const runtime = 'nodejs'

interface UploadFileRequest {
    id?: string
    filename: string
    contentType?: string
    size?: number
}

function getExtension(filename: string) {
    return filename.split('.').pop()?.toLowerCase() || 'mp4'
}

function safeFileName(filename: string) {
    const ext = getExtension(filename)
    const base = filename
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 48)
        .replace(/^_+|_+$/g, '') || 'video'

    return `${base}.${ext}`
}

function validateFile(file: UploadFileRequest) {
    if (!file.filename || typeof file.filename !== 'string') {
        throw new Error('文件名缺失')
    }

    const ext = getExtension(file.filename)
    const contentType = file.contentType || ''
    const allowedTypes = ALLOWED_MIME_BY_EXTENSION[ext]

    if (!allowedTypes) {
        throw new Error(`"${file.filename}" 格式不支持`)
    }

    if (!contentType || !allowedTypes.includes(contentType)) {
        throw new Error(`"${file.filename}" 的文件类型与后缀不一致`)
    }

    if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
        throw new Error(`"${file.filename}" 超过 4GB`)
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}))
        const files = Array.isArray(body.files) ? (body.files as UploadFileRequest[]) : []
        let userId = DEMO_USER_ID

        if (!isTikTokGroupsDemoMode()) {
            const supabase = await createClient()
            const {
                data: { user },
                error: authError,
            } = await supabase.auth.getUser()

            if (authError || !user) {
                return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 })
            }

            userId = user.id
        }

        if (files.length < 1) {
            return NextResponse.json({ success: false, error: '请先选择视频' }, { status: 400 })
        }

        if (files.length > MAX_FILES) {
            return NextResponse.json({ success: false, error: `一次最多上传 ${MAX_FILES} 个视频` }, { status: 400 })
        }

        if (!ossConfig.accessKeyId || !ossConfig.accessKeySecret) {
            console.error('[MultiTaskUpload] OSS config missing')
            return NextResponse.json({ success: false, error: '存储服务未配置' }, { status: 500 })
        }

        files.forEach(validateFile)

        const client = new OSS(ossConfig)
        const now = Date.now()
        const expires = SIGNATURE_EXPIRES_SECONDS

        const uploads = files.map((file, index) => {
            const contentType = file.contentType || 'video/mp4'
            const random = crypto.randomUUID().slice(0, 8)
            const key = `multi-task-videos/${userId}/${now}-${index}-${random}-${safeFileName(file.filename)}`
            const uploadUrl = client.signatureUrl(key, {
                method: 'PUT',
                expires,
                'Content-Type': contentType,
            })

            return {
                id: file.id || `${now}-${index}`,
                filename: file.filename,
                key,
                uploadUrl,
                publicUrl: `https://${CUSTOM_DOMAIN}/${key}`,
                expiresIn: expires,
            }
        })

        return NextResponse.json({ success: true, uploads })
    } catch (error) {
        console.error('[MultiTaskUpload] Error:', error)
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : '获取上传地址失败' },
            { status: 500 }
        )
    }
}
