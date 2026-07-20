import crypto from 'crypto'

import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { validateInstagramMediaUpload } from '@/lib/publish/platform-media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EXPIRES_SECONDS = 24 * 60 * 60
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

function normalizePublicMediaBaseUrl(value: string | undefined) {
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') {
      throw new Error('INSTAGRAM_PUBLIC_MEDIA_BASE_URL must be an HTTPS URL')
    }
    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'INSTAGRAM_PUBLIC_MEDIA_BASE_URL is invalid')
  }
}

function getSigningSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.INSTAGRAM_CLIENT_SECRET || process.env.FACEBOOK_CLIENT_SECRET
  if (secret) return secret

  if (process.env.NODE_ENV === 'production' || process.env.INSTAGRAM_LOCAL_UPLOAD_FALLBACK === 'true') {
    throw new Error('Instagram local upload signing secret is not configured')
  }

  return 'instagram-local-upload-dev-secret'
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
  if (!isLocalOrigin(origin) && process.env.INSTAGRAM_LOCAL_UPLOAD_FALLBACK !== 'true') {
    return NextResponse.json(
      { success: false, error: 'Instagram local upload fallback is only available on localhost.' },
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
  const validationError = validateInstagramMediaUpload({
    filename,
    contentType,
    fileSize: body.fileSize,
  })

  if (validationError === 'unsupported_format') {
    return NextResponse.json({ success: false, error: '不支持的视频格式' }, { status: 400 })
  }
  if (validationError === 'invalid_file_size') {
    return NextResponse.json({ success: false, error: '视频大小无效' }, { status: 400 })
  }
  if (validationError === 'file_too_large') {
    return NextResponse.json({ success: false, error: '单个视频不能超过 1GB' }, { status: 400 })
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
  let publicOrigin = origin
  try {
    publicOrigin = normalizePublicMediaBaseUrl(process.env.INSTAGRAM_PUBLIC_MEDIA_BASE_URL) || origin
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Instagram 公网媒体地址配置无效' },
      { status: 500 }
    )
  }

  const uploadUrl = new URL(`/api/instagram/upload/local-video/${encodeURIComponent(id)}`, origin)
  uploadUrl.searchParams.set('expires', String(expiresAt))
  uploadUrl.searchParams.set('token', token)

  const publicUrl = new URL(`/api/instagram/upload/local-video/${encodeURIComponent(id)}`, publicOrigin)
  publicUrl.searchParams.set('expires', String(expiresAt))
  publicUrl.searchParams.set('token', token)

  return NextResponse.json({
    success: true,
    data: {
      uploadUrl: uploadUrl.toString(),
      publicUrl: publicUrl.toString(),
      key: id,
      expiresIn: EXPIRES_SECONDS,
      storage: 'local',
    },
  })
}
