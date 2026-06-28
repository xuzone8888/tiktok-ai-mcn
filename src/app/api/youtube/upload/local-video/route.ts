import crypto from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { YOUTUBE_OFFICIAL_MAX_FILE_SIZE_BYTES } from '@/lib/youtube/metadata-rules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPLOAD_DIR = path.join('/private/tmp', 'stargaze-youtube-uploads')
const MAX_FILE_SIZE = YOUTUBE_OFFICIAL_MAX_FILE_SIZE_BYTES

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

function safeId(id: string) {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)
}

function getRequestId(request: NextRequest) {
  return safeId(request.nextUrl.searchParams.get('key') || '')
}

function verifyRequest(request: NextRequest, id: string) {
  if (!id) return false

  const expires = Number(request.nextUrl.searchParams.get('expires') || 0)
  const token = request.nextUrl.searchParams.get('token') || ''
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) {
    return false
  }

  let expected: string
  try {
    expected = signUpload(id, expires)
  } catch {
    return false
  }
  return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}

async function writeRequestBody(request: NextRequest, filePath: string) {
  if (!request.body) {
    throw new Error('上传内容为空')
  }

  const writer = createWriteStream(filePath)
  const reader = request.body.getReader()
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      totalBytes += value.byteLength
      if (totalBytes > MAX_FILE_SIZE) {
        writer.destroy()
        await unlink(filePath).catch(() => undefined)
        throw new Error('视频超过 256GB')
      }

      await new Promise<void>((resolve, reject) => {
        writer.write(Buffer.from(value), (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  } finally {
    reader.releaseLock()
  }

  await new Promise<void>((resolve, reject) => {
    writer.once('error', reject)
    writer.end(() => resolve())
  })

  if (totalBytes === 0) {
    await unlink(filePath).catch(() => undefined)
    throw new Error('上传内容为空')
  }
}

export async function PUT(request: NextRequest) {
  const id = getRequestId(request)
  if (!verifyRequest(request, id)) {
    return NextResponse.json({ success: false, error: '上传链接无效或已过期' }, { status: 403 })
  }

  await mkdir(UPLOAD_DIR, { recursive: true })
  const filePath = path.join(UPLOAD_DIR, id)
  const metaPath = `${filePath}.json`
  const contentType = request.headers.get('content-type') || 'video/mp4'

  try {
    await writeRequestBody(request, filePath)
    await writeFile(metaPath, JSON.stringify({ contentType, uploadedAt: new Date().toISOString() }))
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '本地上传失败' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const id = getRequestId(request)
  if (!verifyRequest(request, id)) {
    return NextResponse.json({ success: false, error: '视频链接无效或已过期' }, { status: 403 })
  }

  const filePath = path.join(UPLOAD_DIR, id)
  const metaPath = `${filePath}.json`
  const fileStat = await stat(filePath).catch(() => null)
  if (!fileStat?.isFile()) {
    return NextResponse.json({ success: false, error: '视频文件不存在' }, { status: 404 })
  }

  const meta: { contentType?: string } = await readFile(metaPath, 'utf8')
    .then((value) => JSON.parse(value) as { contentType?: string })
    .catch(() => ({}))

  return new NextResponse(createReadStream(filePath) as any, {
    headers: {
      'Content-Type': meta.contentType || 'video/mp4',
      'Content-Length': String(fileStat.size),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
