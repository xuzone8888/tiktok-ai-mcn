import crypto from 'crypto'

import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EXPIRES_SECONDS = 24 * 60 * 60
const ALLOWED_MIME_BY_EXTENSION: Record<string, string[]> = {
  mp4: ['video/mp4'],
  webm: ['video/webm'],
  mov: ['video/quicktime', 'video/mp4'],
}

function getRequestOrigin(request: NextRequest) {
  const host = request.headers.get('host') || request.nextUrl.host
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'http'
  return `${protocol.split(',')[0].trim()}://${host.split(',')[0].trim()}`
}

function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin)
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function getSigningSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.YOUTUBE_CLIENT_SECRET
  if (secret) return secret

  if (process.env.NODE_ENV === 'production' || process.env.YOUTUBE_LOCAL_UPLOAD_FALLBACK === 'true') {
    throw new Error('YouTube local upload signing secret is not configured')
  }

  return 'youtube-local-upload-dev-secret'
}

function signUpload(id: string, expiresAt: number) {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${id}.${expiresAt}`)
    .digest('base64url')
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

export async function POST(request: NextRequest) {
  const origin = getRequestOrigin(request)
  if (!isLocalOrigin(origin) && process.env.YOUTUBE_LOCAL_UPLOAD_FALLBACK !== 'true') {
    return NextResponse.json(
      { success: false, error: 'YouTube local upload fallback is only available on localhost.' },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const filename = typeof body.filename === 'string' ? body.filename : ''
  const contentType = typeof body.contentType === 'string' ? body.contentType : 'video/mp4'
  const ext = getExtension(filename)
  const allowedTypes = ALLOWED_MIME_BY_EXTENSION[ext]

  if (!filename || !allowedTypes || !allowedTypes.includes(contentType)) {
    return NextResponse.json({ success: false, error: '不支持的视频格式' }, { status: 400 })
  }

  const id = `${crypto.randomUUID()}-${safeFileName(filename)}`
  const expiresAt = Math.floor(Date.now() / 1000) + EXPIRES_SECONDS
  let token: string
  try {
    token = signUpload(id, expiresAt)
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '本地上传签名配置缺失' },
      { status: 500 }
    )
  }
  const url = new URL(`/api/youtube/upload/local-video/${encodeURIComponent(id)}`, origin)
  url.searchParams.set('expires', String(expiresAt))
  url.searchParams.set('token', token)

  return NextResponse.json({
    success: true,
    data: {
      uploadUrl: url.toString(),
      publicUrl: url.toString(),
      key: id,
      expiresIn: EXPIRES_SECONDS,
      storage: 'local',
    },
  })
}
