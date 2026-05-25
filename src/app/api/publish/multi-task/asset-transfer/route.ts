import crypto from 'crypto'

import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { isTikTokGroupsDemoMode } from '@/lib/tiktok/demo-account-groups'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS = require('ali-oss')

const MAX_TRANSFER_BYTES = 1024 * 1024 * 1024
const VIDEO_MIME_TO_EXTENSION: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
}
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov']

const ossConfig = {
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
    endpoint: process.env.ALIYUN_OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com',
    secure: true,
    timeout: 300000,
}

const CUSTOM_DOMAIN = (process.env.ALIYUN_OSS_CUSTOM_DOMAIN || 'media.toryxai.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')

export const runtime = 'nodejs'
export const maxDuration = 300

function safeFileName(value: unknown) {
    const raw = typeof value === 'string' && value.trim() ? value.trim() : 'video'
    return raw
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 50)
        .replace(/^_+|_+$/g, '') || 'video'
}

function extensionFromUrl(url: URL) {
    const ext = decodeURIComponent(url.pathname).split('.').pop()?.toLowerCase() || ''
    return VIDEO_EXTENSIONS.includes(ext) ? ext : ''
}

function isBlockedHost(hostname: string) {
    const host = hostname.toLowerCase()
    if (host === 'localhost' || host === '0.0.0.0' || host === '::1') return true
    if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('169.254.')) return true
    if (/^192\.168\./.test(host)) return true
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
    return false
}

function parseSourceUrl(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('视频地址缺失')
    }

    let parsed: URL
    try {
        parsed = new URL(value)
    } catch {
        throw new Error('视频地址格式无效')
    }

    if (parsed.protocol !== 'https:') {
        throw new Error('视频地址必须使用 HTTPS')
    }

    if (isBlockedHost(parsed.hostname)) {
        throw new Error('视频地址不允许访问内网地址')
    }

    return parsed
}

function getExtension(contentType: string, sourceUrl: URL) {
    const normalizedType = contentType.split(';')[0]?.toLowerCase().trim()
    return VIDEO_MIME_TO_EXTENSION[normalizedType] || extensionFromUrl(sourceUrl) || 'mp4'
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}))
        const sourceUrl = parseSourceUrl(body.source_url || body.sourceUrl)
        const filename = safeFileName(body.filename)

        if (isTikTokGroupsDemoMode()) {
            const ext = extensionFromUrl(sourceUrl) || 'mp4'
            return NextResponse.json({
                success: true,
                data: {
                    url: `https://${CUSTOM_DOMAIN}/multi-task-demo/${filename}.${ext}`,
                    key: `multi-task-demo/${filename}.${ext}`,
                    size: 0,
                },
            })
        }

        const supabase = await createClient()
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 })
        }

        if (!ossConfig.accessKeyId || !ossConfig.accessKeySecret) {
            console.error('[MultiTaskAssetTransfer] OSS config missing')
            return NextResponse.json({ success: false, error: '存储服务未配置' }, { status: 500 })
        }

        const downloadResponse = await fetch(sourceUrl.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        })

        if (!downloadResponse.ok) {
            return NextResponse.json(
                { success: false, error: `下载视频失败 (${downloadResponse.status})` },
                { status: 502 }
            )
        }

        const contentType = downloadResponse.headers.get('content-type') || 'video/mp4'
        const contentLength = Number(downloadResponse.headers.get('content-length') || 0)
        if (contentLength > MAX_TRANSFER_BYTES) {
            return NextResponse.json({ success: false, error: '视频文件过大，请改用本地上传' }, { status: 413 })
        }

        const ext = getExtension(contentType, sourceUrl)
        if (!VIDEO_EXTENSIONS.includes(ext)) {
            return NextResponse.json({ success: false, error: '视频格式不支持' }, { status: 400 })
        }

        const videoBuffer = await downloadResponse.arrayBuffer()
        if (videoBuffer.byteLength > MAX_TRANSFER_BYTES) {
            return NextResponse.json({ success: false, error: '视频文件过大，请改用本地上传' }, { status: 413 })
        }

        const key = `multi-task-videos/${user.id}/assets/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${filename}.${ext}`
        const client = new OSS(ossConfig)
        const result = await client.put(key, Buffer.from(videoBuffer), {
            mime: contentType,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': 'inline',
                'x-oss-storage-class': 'Standard',
            },
        })

        if (!result?.name) {
            return NextResponse.json({ success: false, error: '转存到存储服务失败' }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            data: {
                url: `https://${CUSTOM_DOMAIN}/${key}`,
                key,
                size: videoBuffer.byteLength,
            },
        })
    } catch (error) {
        console.error('[MultiTaskAssetTransfer] Error:', error)
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : '转存视频失败' },
            { status: 500 }
        )
    }
}
