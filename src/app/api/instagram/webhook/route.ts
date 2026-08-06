import crypto from 'crypto'

import { NextRequest, NextResponse } from 'next/server'
import {
  createInstagramWebhookCommentStore,
  InstagramWebhookPayloadError,
  processInstagramCommentWebhook,
} from '@/lib/instagram/webhook-comments'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const MAX_INSTAGRAM_WEBHOOK_BODY_BYTES = 1024 * 1024

function getInstagramWebhookVerifyToken() {
  return process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || ''
}

function getMetaAppSecret() {
  // 与 getInstagramOAuthConfig 的密钥解析完全一致（按 authMode 分支），否则可能取到与签名所用 App 不符的密钥而 401。
  if (process.env.INSTAGRAM_AUTH_MODE === 'instagram') {
    return (
      process.env.INSTAGRAM_NATIVE_CLIENT_SECRET ||
      process.env.INSTAGRAM_CLIENT_SECRET ||
      process.env.FACEBOOK_CLIENT_SECRET ||
      ''
    )
  }
  return process.env.INSTAGRAM_CLIENT_SECRET || process.env.FACEBOOK_CLIENT_SECRET || ''
}

// 校验 Meta 的 X-Hub-Signature-256（对原始请求体做 HMAC-SHA256，密钥为 App Secret）。
// fail-closed：缺密钥或签名不匹配一律拒绝，避免任何人伪造 webhook 事件。
function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | null, appSecret: string): boolean {
  if (!appSecret || !signatureHeader) return false
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
  const provided = Buffer.from(signatureHeader)
  const computed = Buffer.from(expected)
  return provided.length === computed.length && crypto.timingSafeEqual(provided, computed)
}

async function readRawBodyWithinLimit(request: NextRequest): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0)

  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue

      totalBytes += value.byteLength
      if (totalBytes > MAX_INSTAGRAM_WEBHOOK_BODY_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // The response is already fail-closed as oversized.
        }
        return null
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks, totalBytes)
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')
  const verifyToken = getInstagramWebhookVerifyToken()

  if (mode === 'subscribe' && token && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return NextResponse.json({ error: 'Instagram webhook verification failed' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (!Number.isInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_INSTAGRAM_WEBHOOK_BODY_BYTES) {
      return NextResponse.json(
        { error: 'Instagram webhook payload too large', code: 'payload_too_large' },
        { status: 413 }
      )
    }
  }

  let rawBody: Buffer | null
  try {
    rawBody = await readRawBodyWithinLimit(request)
  } catch {
    return NextResponse.json(
      { error: 'Invalid Instagram webhook payload', code: 'invalid_webhook_body' },
      { status: 400 }
    )
  }
  if (!rawBody) {
    return NextResponse.json(
      { error: 'Instagram webhook payload too large', code: 'payload_too_large' },
      { status: 413 }
    )
  }
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaSignature(rawBody, signature, getMetaAppSecret())) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let rawText: string
  try {
    rawText = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
  } catch {
    return NextResponse.json(
      { error: 'Invalid Instagram webhook payload', code: 'invalid_webhook_encoding' },
      { status: 400 }
    )
  }

  let body: any = null
  try {
    body = JSON.parse(rawText)
  } catch {
    return NextResponse.json(
      { error: 'Invalid Instagram webhook payload', code: 'invalid_webhook_json' },
      { status: 400 }
    )
  }

  try {
    const metadata = await processInstagramCommentWebhook(body, createInstagramWebhookCommentStore())
    console.info('Instagram webhook processed', metadata)
    return NextResponse.json({ received: true, metadata })
  } catch (error) {
    if (error instanceof InstagramWebhookPayloadError) {
      return NextResponse.json(
        { error: 'Invalid Instagram webhook payload', code: error.code },
        { status: 400 }
      )
    }
    console.error('Instagram webhook processing failed', {
      code: 'instagram_webhook_persistence_failed',
      error_count: 1,
    })
    return NextResponse.json(
      { error: 'Instagram webhook processing failed', code: 'webhook_processing_failed' },
      { status: 500 }
    )
  }
}
