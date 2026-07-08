import { NextRequest, NextResponse } from 'next/server'

import { isWhatsAppInboxEnabledServer, WHATSAPP_INBOX_DISABLED_MESSAGE } from '@/lib/feature-flags'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppTextMessage } from '@/lib/whatsapp/cloud-api'
import { updateConversationAfterOutbound } from '@/lib/whatsapp/inbox'
import {
  resolveWhatsAppSendCredentials,
  type WhatsAppSendCredentialClient,
} from '@/lib/whatsapp/send-credentials'

export const dynamic = 'force-dynamic'

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000
const CUSTOMER_SERVICE_WINDOW_CLOSED_CODE = 'WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED'
const CUSTOMER_SERVICE_WINDOW_CLOSED_MESSAGE = '当前会话已超出 WhatsApp 24 小时客服窗口，需使用模板消息。'

type JsonRecord = Record<string, unknown>
type SupabaseError = { message: string; code?: string }

interface SupabaseQueryBuilder<T extends JsonRecord = JsonRecord> extends PromiseLike<{ data: T[] | null; error: SupabaseError | null }> {
  select(columns: string): SupabaseQueryBuilder<T>
  eq(column: string, value: unknown): SupabaseQueryBuilder<T>
  insert(values: JsonRecord): SupabaseQueryBuilder<T>
  update(values: JsonRecord): SupabaseQueryBuilder<T>
  upsert(values: JsonRecord, options?: { onConflict?: string }): SupabaseQueryBuilder<T>
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): SupabaseQueryBuilder<T>
  limit(count: number): SupabaseQueryBuilder<T>
  single(): Promise<{ data: T | null; error: SupabaseError | null }>
  maybeSingle(): Promise<{ data: T | null; error: SupabaseError | null }>
}

interface WhatsAppAdminClient {
  from(table: string): SupabaseQueryBuilder
}

interface NormalizedWhatsAppContact {
  id: string
  wa_id: string
  status: string | null
}

class WhatsAppCustomerServiceWindowError extends Error {
  code = CUSTOMER_SERVICE_WINDOW_CLOSED_CODE
  httpStatus = 409

  constructor() {
    super(CUSTOMER_SERVICE_WINDOW_CLOSED_MESSAGE)
    this.name = 'WhatsAppCustomerServiceWindowError'
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getStringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

function getErrorMessage(error: unknown) {
  const raw = (error as { raw?: unknown } | undefined)?.raw
  const rawError = isRecord(raw) && isRecord(raw.error) ? raw.error : null
  return getStringValue(rawError?.message)
    || getStringValue(rawError?.error_user_msg)
    || (error instanceof Error ? error.message : '发送 WhatsApp 消息失败')
}

function getHttpStatus(error: unknown) {
  const status = (error as { httpStatus?: number } | undefined)?.httpStatus
  return typeof status === 'number' && status >= 400 ? status : 502
}

function getErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? code : null
}

function normalizeContact(contact: unknown): NormalizedWhatsAppContact | null {
  const candidate = Array.isArray(contact) ? contact[0] : contact
  if (!isRecord(candidate)) return null

  const id = getStringValue(candidate.id)
  const waId = getStringValue(candidate.wa_id)
  if (!id || !waId) return null

  return {
    id,
    wa_id: waId,
    status: getStringValue(candidate.status),
  }
}

async function assertCustomerServiceWindowOpen(admin: WhatsAppAdminClient, userId: string, contactId: string) {
  const { data: latestInbound, error } = await admin
    .from('whatsapp_messages')
    .select('id, received_at, created_at')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('direction', 'inbound')
    .order('received_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[WhatsApp Send] Latest inbound lookup failed:', error)
    throw new Error('查询 WhatsApp 24 小时客服窗口失败')
  }

  const receivedAt = getStringValue(latestInbound?.received_at) || getStringValue(latestInbound?.created_at)
  const timestamp = receivedAt ? new Date(receivedAt).getTime() : Number.NaN

  if (!Number.isFinite(timestamp) || Date.now() - timestamp > CUSTOMER_SERVICE_WINDOW_MS) {
    throw new WhatsAppCustomerServiceWindowError()
  }
}

async function updateBusinessAccountMessagingStatus(
  admin: WhatsAppAdminClient,
  userId: string,
  accountId: string | null,
  status: 'ready' | 'blocked'
) {
  if (!accountId) return

  const { error } = await admin
    .from('whatsapp_business_accounts')
    .update({
      messaging_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .eq('user_id', userId)

  if (error) {
    console.error('[WhatsApp Send] Update messaging status failed:', error)
  }
}

export async function POST(request: NextRequest) {
  if (!isWhatsAppInboxEnabledServer()) {
    console.info('[WhatsApp Send] Request rejected because WhatsApp Inbox is disabled.')
    return NextResponse.json({ error: WHATSAPP_INBOX_DISABLED_MESSAGE, disabled: true }, { status: 503 })
  }

  let pendingMessageId: string | null = null
  let userId: string | null = null
  let resolvedBusinessAccountId: string | null = null
  let messageText = ''
  let requestPayload: unknown = null
  const admin = createAdminClient() as unknown as WhatsAppAdminClient

  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }
    userId = user.id

    const body = await request.json().catch(() => null)
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    messageText = typeof body?.text === 'string' ? body.text.trim() : ''

    if (!conversationId) {
      return NextResponse.json({ error: '缺少会话 ID' }, { status: 400 })
    }
    if (!messageText) {
      return NextResponse.json({ error: '请输入回复内容' }, { status: 400 })
    }
    if (messageText.length > 4096) {
      return NextResponse.json({ error: 'WhatsApp 文本消息不能超过 4096 个字符' }, { status: 400 })
    }

    console.info('[WhatsApp Send] Sending manual reply:', { userId, conversationId, length: messageText.length })

    const { data: conversation, error: conversationError } = await admin
      .from('whatsapp_conversations')
      .select(`
        id,
        user_id,
        contact_id,
        contact:whatsapp_contacts (
          id,
          user_id,
          phone,
          wa_id,
          status
        )
      `)
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle()

    if (conversationError) {
      console.error('[WhatsApp Send] Conversation lookup failed:', conversationError)
      return NextResponse.json({ error: '查询 WhatsApp 会话失败' }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 })
    }

    const contact = normalizeContact(conversation.contact)
    if (!contact?.id || !contact?.wa_id) {
      return NextResponse.json({ error: 'WhatsApp 联系人信息不完整' }, { status: 400 })
    }
    if (contact.status === 'blocked') {
      return NextResponse.json({ error: '该联系人已被标记为 blocked，不能发送消息' }, { status: 409 })
    }

    const contactId = contact.id
    await assertCustomerServiceWindowOpen(admin, userId, contactId)

    const sendCredentials = await resolveWhatsAppSendCredentials(admin as unknown as WhatsAppSendCredentialClient, userId)
    resolvedBusinessAccountId = sendCredentials.accountId
    const sentAt = new Date().toISOString()
    requestPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: contact.wa_id,
      credential_source: sendCredentials.source,
      has_sender_phone_number_id: Boolean(sendCredentials.phoneNumberId),
      type: 'text',
      text: {
        preview_url: false,
        body: messageText,
      },
    }

    const { data: pendingMessage, error: insertError } = await admin
      .from('whatsapp_messages')
      .insert({
        user_id: userId,
        contact_id: contactId,
        direction: 'outbound',
        message_type: 'text',
        text: messageText,
        raw_payload: { request: requestPayload },
        status: 'pending',
        sent_at: sentAt,
      })
      .select('id')
      .single()

    const createdMessageId = getStringValue(pendingMessage?.id)
    if (insertError || !createdMessageId) {
      console.error('[WhatsApp Send] Create pending message failed:', insertError)
      return NextResponse.json({ error: '创建 WhatsApp 回复记录失败' }, { status: 500 })
    }
    pendingMessageId = createdMessageId

    const result = await sendWhatsAppTextMessage(contact.wa_id, messageText, {
      accessToken: sendCredentials.accessToken,
      phoneNumberId: sendCredentials.phoneNumberId,
      apiVersion: sendCredentials.apiVersion,
    })
    const { data: updatedMessage, error: updateError } = await admin
      .from('whatsapp_messages')
      .update({
        whatsapp_message_id: result.messageId,
        raw_payload: {
          request: requestPayload,
          response: result.raw,
        },
        status: 'sent',
        error_message: null,
        sent_at: sentAt,
      })
      .eq('id', pendingMessageId)
      .eq('user_id', userId)
      .select('id')
      .single()

    const updatedMessageId = getStringValue(updatedMessage?.id)
    if (updateError || !updatedMessageId) {
      console.error('[WhatsApp Send] Message sent but persistence failed:', updateError)
      const manualReviewMessage = 'WHATSAPP_SEND_PERSIST_FAILED: 已发送但本地保存失败，请人工核对。'
      const { data: markedMessage, error: markError } = await admin
        .from('whatsapp_messages')
        .update({
          status: 'failed',
          error_message: `${manualReviewMessage} Meta message id: ${result.messageId}`,
          raw_payload: {
            request: requestPayload,
            response: result.raw,
            meta_message_id: result.messageId,
            persistence_error: updateError?.message || 'Missing updated message row',
          },
          sent_at: sentAt,
        })
        .eq('id', pendingMessageId)
        .eq('user_id', userId)
        .select('id')
        .maybeSingle()

      const markedMessageId = getStringValue(markedMessage?.id)
      if (markError || !markedMessageId) {
        console.error('[WhatsApp Send] Mark manual-review failure failed:', markError)
      }

      return NextResponse.json(
        {
          error: 'WhatsApp 消息已发送但本地保存失败，请人工核对，不要直接重复发送。',
          code: 'WHATSAPP_SEND_PERSIST_FAILED',
          metaMessageId: result.messageId,
        },
        { status: 409 }
      )
    }

    try {
      await updateConversationAfterOutbound(admin, userId, contactId, messageText, sentAt)
    } catch (conversationUpdateError) {
      console.error('[WhatsApp Send] Conversation update after outbound failed:', conversationUpdateError)
    }

    await updateBusinessAccountMessagingStatus(admin, userId, resolvedBusinessAccountId, 'ready')

    console.info('[WhatsApp Send] Manual reply sent:', {
      userId,
      conversationId,
      messageId: result.messageId,
      credentialSource: sendCredentials.source,
    })
    return NextResponse.json({
      success: true,
      message: {
        id: pendingMessageId,
        whatsapp_message_id: result.messageId,
        status: 'sent',
        sent_at: sentAt,
      },
      sender: {
        source: sendCredentials.source,
        has_phone_number_id: Boolean(sendCredentials.phoneNumberId),
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error)
    const errorCode = getErrorCode(error)
    console.error('[WhatsApp Send] Send failed:', error)

    if (pendingMessageId && userId) {
      const { error: updateError } = await admin
        .from('whatsapp_messages')
        .update({
          status: 'failed',
          error_message: errorMessage,
          raw_payload: {
            request: requestPayload,
            error: (error as { raw?: unknown })?.raw || { message: errorMessage },
          },
          sent_at: new Date().toISOString(),
        })
        .eq('id', pendingMessageId)
        .eq('user_id', userId)

      if (updateError) {
        console.error('[WhatsApp Send] Persist send failure failed:', updateError)
      }
    }

    if (userId && resolvedBusinessAccountId) {
      await updateBusinessAccountMessagingStatus(admin, userId, resolvedBusinessAccountId, 'blocked')
    }

    return NextResponse.json(
      {
        error: errorMessage,
        ...(errorCode ? { code: errorCode } : {}),
      },
      { status: getHttpStatus(error) }
    )
  }
}
