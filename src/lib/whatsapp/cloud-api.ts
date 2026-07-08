import crypto from 'node:crypto'

const GRAPH_API_BASE = 'https://graph.facebook.com'

export interface WhatsAppCloudConfig {
  accessToken: string
  phoneNumberId: string
  businessAccountId: string | null
  apiVersion: string
  ownerUserId: string | null
}

export interface WhatsAppWebhookVerificationConfig {
  verifyToken: string
}

export interface WhatsAppWebhookSignatureConfig {
  appSecret: string
}

export interface WhatsAppOwnerFallbackConfig {
  businessAccountId: string | null
  ownerUserId: string
}

export interface WhatsAppSendTextResult {
  messageId: string
  raw: unknown
}

export interface WhatsAppSendTextOptions {
  accessToken?: string
  phoneNumberId?: string
  apiVersion?: string
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getStringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

export function getWhatsAppGraphApiVersion() {
  return process.env.WHATSAPP_API_VERSION || process.env.FACEBOOK_API_VERSION || 'v20.0'
}

export function getWhatsAppCloudConfig(): WhatsAppCloudConfig {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const apiVersion = process.env.WHATSAPP_API_VERSION

  if (!accessToken || !phoneNumberId || !apiVersion) {
    throw new Error('WhatsApp env fallback send configuration is incomplete. Please set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_API_VERSION.')
  }

  return {
    accessToken,
    phoneNumberId,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null,
    apiVersion,
    ownerUserId: process.env.WHATSAPP_OWNER_USER_ID || process.env.WHATSAPP_DEFAULT_USER_ID || null,
  }
}

export function getWhatsAppWebhookVerificationConfig(): WhatsAppWebhookVerificationConfig {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN

  if (!verifyToken) {
    throw new Error('WhatsApp webhook verification configuration is incomplete. Please set WHATSAPP_VERIFY_TOKEN.')
  }

  return { verifyToken }
}

export function getWhatsAppWebhookSignatureConfig(): WhatsAppWebhookSignatureConfig {
  const appSecret = process.env.WHATSAPP_APP_SECRET

  if (!appSecret) {
    throw new Error('WhatsApp webhook signature configuration is incomplete. Please set WHATSAPP_APP_SECRET.')
  }

  return { appSecret }
}

export function getWhatsAppOwnerFallbackConfig(): WhatsAppOwnerFallbackConfig {
  const ownerUserId = process.env.WHATSAPP_OWNER_USER_ID || process.env.WHATSAPP_DEFAULT_USER_ID
  if (!ownerUserId) {
    throw new Error('WhatsApp webhook owner user is not configured. Set WHATSAPP_OWNER_USER_ID or create a whatsapp_business_accounts mapping.')
  }

  return {
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null,
    ownerUserId,
  }
}

export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null, appSecret?: string | null) {
  if (!appSecret) {
    if (process.env.NODE_ENV !== 'production' && process.env.WHATSAPP_SKIP_SIGNATURE_VERIFY === 'true') {
      console.warn('[WhatsApp Webhook] Signature verification skipped by WHATSAPP_SKIP_SIGNATURE_VERIFY in local development.')
      return true
    }
    throw new Error('WHATSAPP_APP_SECRET is not configured. WhatsApp webhook signature verification is required.')
  }

  if (!signatureHeader?.startsWith('sha256=')) {
    return false
  }

  const expected = `sha256=${crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex')}`

  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(signatureHeader)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
}

function readWhatsAppApiError(raw: unknown, fallback: string): string {
  if (!isRecord(raw) || !isRecord(raw.error)) return fallback
  return getStringValue(raw.error.message) || getStringValue(raw.error.error_user_msg) || fallback
}

function resolveWhatsAppSendConfig(options: WhatsAppSendTextOptions) {
  if (options.accessToken && options.phoneNumberId) {
    return {
      accessToken: options.accessToken,
      phoneNumberId: options.phoneNumberId,
      apiVersion: options.apiVersion || getWhatsAppGraphApiVersion(),
    }
  }

  const fallbackConfig = getWhatsAppCloudConfig()
  return {
    accessToken: fallbackConfig.accessToken,
    phoneNumberId: fallbackConfig.phoneNumberId,
    apiVersion: options.apiVersion || fallbackConfig.apiVersion,
  }
}

export async function sendWhatsAppTextMessage(
  to: string,
  text: string,
  options: WhatsAppSendTextOptions = {}
): Promise<WhatsAppSendTextResult> {
  const config = resolveWhatsAppSendConfig(options)
  const response = await fetch(`${GRAPH_API_BASE}/${config.apiVersion}/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    }),
  })

  const raw = await response.json().catch(() => null)
  if (!response.ok) {
    const message = readWhatsAppApiError(raw, response.statusText)
    const error = new Error(`WhatsApp message send failed: ${message}`) as Error & { raw?: unknown; httpStatus?: number }
    error.raw = raw
    error.httpStatus = response.status
    throw error
  }

  const messages = isRecord(raw) && Array.isArray(raw.messages) ? raw.messages : []
  const firstMessage = messages.find(isRecord)
  const messageId = getStringValue(firstMessage?.id)
  if (typeof messageId !== 'string' || !messageId) {
    const error = new Error('WhatsApp send response did not include a message id.') as Error & { raw?: unknown }
    error.raw = raw
    throw error
  }

  return { messageId, raw }
}
