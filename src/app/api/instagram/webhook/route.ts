import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function getInstagramWebhookVerifyToken() {
  return process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || ''
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
  const body = await request.json().catch(() => null) as any

  console.info('Instagram webhook received:', {
    object: body?.object || null,
    entryCount: Array.isArray(body?.entry) ? body.entry.length : 0,
  })

  return NextResponse.json({ received: true })
}
