import crypto from 'crypto'

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function getInstagramWebhookVerifyToken() {
  return process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || ''
}

function getMetaAppSecret() {
  return process.env.INSTAGRAM_CLIENT_SECRET || process.env.FACEBOOK_CLIENT_SECRET || ''
}

// 校验 Meta 的 X-Hub-Signature-256（对原始请求体做 HMAC-SHA256，密钥为 App Secret）。
// fail-closed：缺密钥或签名不匹配一律拒绝，避免任何人伪造 webhook 事件。
function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!appSecret || !signatureHeader) return false
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`
  const provided = Buffer.from(signatureHeader)
  const computed = Buffer.from(expected)
  return provided.length === computed.length && crypto.timingSafeEqual(provided, computed)
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
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaSignature(rawBody, signature, getMetaAppSecret())) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: any = null
  try {
    body = JSON.parse(rawBody)
  } catch {
    body = null
  }

  console.info('Instagram webhook received:', {
    object: body?.object || null,
    entryCount: Array.isArray(body?.entry) ? body.entry.length : 0,
  })

  return NextResponse.json({ received: true })
}
