import { NextRequest, NextResponse } from 'next/server'

import { isWhatsAppInboxEnabledServer, WHATSAPP_INBOX_DISABLED_MESSAGE } from '@/lib/feature-flags'
import {
  getWhatsAppWebhookSignatureConfig,
  getWhatsAppWebhookVerificationConfig,
  verifyWhatsAppSignature,
} from '@/lib/whatsapp/cloud-api'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/inbox'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    if (!isWhatsAppInboxEnabledServer()) {
      console.info('[WhatsApp Webhook] Verification skipped because WhatsApp Inbox is disabled.')
      return NextResponse.json({ error: WHATSAPP_INBOX_DISABLED_MESSAGE, disabled: true }, { status: 503 })
    }

    const mode = request.nextUrl.searchParams.get('hub.mode')
    const token = request.nextUrl.searchParams.get('hub.verify_token')
    const challenge = request.nextUrl.searchParams.get('hub.challenge')
    console.info('[WhatsApp Webhook] Verification request received:', { mode, hasChallenge: Boolean(challenge) })
    const config = getWhatsAppWebhookVerificationConfig()

    if (mode === 'subscribe' && token === config.verifyToken && challenge) {
      return new NextResponse(challenge, { status: 200 })
    }

    console.warn('[WhatsApp Webhook] Verification failed:', { mode, tokenMatched: token === config.verifyToken })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } catch (error) {
    console.error('[WhatsApp Webhook] Verification error:', error)
    return NextResponse.json({ error: 'Webhook verification failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!isWhatsAppInboxEnabledServer()) {
    console.info('[WhatsApp Webhook] Payload rejected because WhatsApp Inbox is disabled.')
    return NextResponse.json({ error: WHATSAPP_INBOX_DISABLED_MESSAGE, disabled: true }, { status: 503 })
  }

  const rawBody = await request.text()

  try {
    const config = getWhatsAppWebhookSignatureConfig()
    const signature = request.headers.get('x-hub-signature-256')
    if (!verifyWhatsAppSignature(rawBody, signature, config.appSecret)) {
      console.warn('[WhatsApp Webhook] Invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody)
    console.info('[WhatsApp Webhook] Payload received:', {
      object: payload?.object,
      entries: Array.isArray(payload?.entry) ? payload.entry.length : 0,
    })

    const result = await processWhatsAppWebhookPayload(payload)
    console.info('[WhatsApp Webhook] Payload processed:', result)
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('[WhatsApp Webhook] Processing error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'WhatsApp webhook processing failed' },
      { status: 500 }
    )
  }
}
