import crypto from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPLOAD_DIR = path.join('/private/tmp', 'stargaze-facebook-uploads')
const MAX_FILE_SIZE = 500 * 1024 * 1024
const MAX_FILE_SIZE_LABEL = '500MB'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

function getSigningSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.FACEBOOK_CLIENT_SECRET
  if (secret) return secret

  if (process.env.NODE_ENV === 'production' || process.env.FACEBOOK_LOCAL_UPLOAD_FALLBACK === 'true') {
    throw new Error('Facebook local upload signing secret is not configured')
  }

  return 'facebook-local-upload-dev-secret'
}

function signUpload(id: string, expiresAt: number) {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${id}.${expiresAt}`)
    .digest('base64url')
}

function verifyRequest(request: NextRequest, id: string) {
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

function safeId(id: string) {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)
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
        throw new Error(`视频超过 ${MAX_FILE_SIZE_LABEL}`)
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

function createWebFileStream(filePath: string, options?: { start?: number; end?: number }) {
  return Readable.toWeb(createReadStream(filePath, options)) as ReadableStream<Uint8Array>
}

function parseRangeHeader(rangeHeader: string | null, fileSize: number) {
  if (!rangeHeader) return null

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return { invalid: true as const }

  const [, startValue, endValue] = match
  let start = startValue ? Number(startValue) : 0
  let end = endValue ? Number(endValue) : fileSize - 1

  if (!startValue && endValue) {
    const suffixLength = Number(endValue)
    start = Math.max(fileSize - suffixLength, 0)
    end = fileSize - 1
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return { invalid: true as const }
  }

  return {
    invalid: false as const,
    start,
    end: Math.min(end, fileSize - 1),
  }
}

async function getVideoFile(request: NextRequest, id: string, includeBody: boolean) {
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
  const contentType = meta.contentType || 'video/mp4'
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  }

  const range = parseRangeHeader(request.headers.get('range'), fileStat.size)
  if (range?.invalid) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${fileStat.size}`,
      },
    })
  }

  if (range) {
    const contentLength = range.end - range.start + 1
    return new NextResponse(includeBody ? createWebFileStream(filePath, { start: range.start, end: range.end }) : null, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(contentLength),
        'Content-Range': `bytes ${range.start}-${range.end}/${fileStat.size}`,
      },
    })
  }

  return new NextResponse(includeBody ? createWebFileStream(filePath) : null, {
    headers: {
      ...baseHeaders,
      'Content-Length': String(fileStat.size),
    },
  })
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { id: rawId } = await params
  const id = safeId(decodeURIComponent(rawId))
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

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id: rawId } = await params
  const id = safeId(decodeURIComponent(rawId))
  return getVideoFile(request, id, true)
}

export async function HEAD(request: NextRequest, { params }: RouteContext) {
  const { id: rawId } = await params
  const id = safeId(decodeURIComponent(rawId))
  return getVideoFile(request, id, false)
}
