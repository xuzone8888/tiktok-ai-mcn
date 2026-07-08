import { createAdminClient } from '@/lib/supabase/admin'
import { getWhatsAppOwnerFallbackConfig } from '@/lib/whatsapp/cloud-api'

interface WhatsAppWebhookMessage {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  image?: { id?: string; caption?: string }
  video?: { id?: string; caption?: string }
  document?: { id?: string; filename?: string; caption?: string }
  audio?: { id?: string }
  sticker?: { id?: string }
}

interface WhatsAppWebhookContact {
  wa_id?: string
  profile?: { name?: string }
}

interface WhatsAppWebhookStatus {
  id?: string
  status?: string
  timestamp?: string
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>
}

interface WhatsAppWebhookMetadata {
  phone_number_id?: string
  display_phone_number?: string
  verified_name?: string
}

interface WhatsAppWebhookValue {
  metadata?: WhatsAppWebhookMetadata
  contacts?: WhatsAppWebhookContact[]
  statuses?: WhatsAppWebhookStatus[]
  messages?: WhatsAppWebhookMessage[]
}

interface WhatsAppWebhookChange {
  value?: WhatsAppWebhookValue
}

interface WhatsAppWebhookEntry {
  changes?: WhatsAppWebhookChange[]
}

interface WhatsAppWebhookPayload {
  entry?: WhatsAppWebhookEntry[]
}

interface WhatsAppContactRow {
  id: string
}

interface WhatsAppConversationRow {
  id: string
  unread_count?: number | null
}

type SupabaseError = { message: string; code?: string }

interface SupabaseQueryBuilder<T = Record<string, unknown>> extends PromiseLike<{ data: T[] | null; error: SupabaseError | null }> {
  select(columns: string): SupabaseQueryBuilder<T>
  eq(column: string, value: unknown): SupabaseQueryBuilder<T>
  insert(values: Record<string, unknown>): SupabaseQueryBuilder<T>
  update(values: Record<string, unknown>): SupabaseQueryBuilder<T>
  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): SupabaseQueryBuilder<T>
  single(): Promise<{ data: T | null; error: SupabaseError | null }>
  maybeSingle(): Promise<{ data: T | null; error: SupabaseError | null }>
}

interface WhatsAppInboxAdminClient {
  from(table: string): SupabaseQueryBuilder
}

function getStringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

function normalizeConversationRow(value: unknown): WhatsAppConversationRow | null {
  const id = getStringValue((value as { id?: unknown } | null)?.id)
  if (!id) return null

  const unreadCount = (value as { unread_count?: unknown } | null)?.unread_count
  return {
    id,
    unread_count: typeof unreadCount === 'number' ? unreadCount : null,
  }
}

function timestampToIso(timestamp: string | undefined) {
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString()
  return new Date(seconds * 1000).toISOString()
}

function getMessageText(message: WhatsAppWebhookMessage) {
  if (message.type === 'text') return message.text?.body || ''
  if (message.type === 'image') return message.image?.caption || ''
  if (message.type === 'video') return message.video?.caption || ''
  if (message.type === 'document') return message.document?.caption || message.document?.filename || ''
  return ''
}

function getMediaId(message: WhatsAppWebhookMessage) {
  const type = message.type || ''
  if (type === 'image') return message.image?.id || null
  if (type === 'video') return message.video?.id || null
  if (type === 'document') return message.document?.id || null
  if (type === 'audio') return message.audio?.id || null
  if (type === 'sticker') return message.sticker?.id || null
  return null
}

function getPreview(messageType: string, text: string | null) {
  if (text) return text
  if (messageType === 'text') return ''
  return `[${messageType || 'message'}]`
}

function getStatusError(status: WhatsAppWebhookStatus) {
  const first = status.errors?.[0]
  if (!first) return null
  return first.message || first.error_data?.details || first.title || `WhatsApp error ${first.code || ''}`.trim()
}

function normalizeOutboundStatus(value: string | undefined) {
  if (value === 'sent' || value === 'delivered' || value === 'read' || value === 'failed') return value
  return 'sent'
}

function isUniqueViolation(error: unknown) {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string'
    ? (error as { code: string }).code
    : null
  const message = getStringValue((error as { message?: unknown } | null)?.message) || ''
  return code === '23505' || /duplicate key value violates unique constraint/i.test(message)
}

function isLocalEnvWebhookFallbackEnabled() {
  return process.env.WHATSAPP_ENABLE_LOCAL_ENV_WEBHOOK_FALLBACK === 'true'
}

export async function resolveWhatsAppOwnerUserId(
  supabase: WhatsAppInboxAdminClient,
  phoneNumberId: string,
  metadata?: WhatsAppWebhookMetadata
) {
  if (!phoneNumberId) {
    throw new Error('WhatsApp webhook metadata did not include phone_number_id.')
  }

  const { data: account, error } = await supabase
    .from('whatsapp_business_accounts')
    .select('id, user_id')
    .eq('phone_number_id', phoneNumberId)
    .eq('status', 'active')
    .maybeSingle()

  if (error) {
    throw new Error(`Resolve WhatsApp business account failed: ${error.message}`)
  }
  if (account?.user_id) return account.user_id as string

  if (!isLocalEnvWebhookFallbackEnabled()) {
    throw new Error('No active WhatsApp business account mapping for webhook phone number.')
  }

  const config = getWhatsAppOwnerFallbackConfig()
  const now = new Date().toISOString()

  const { data: upserted, error: upsertError } = await supabase
    .from('whatsapp_business_accounts')
    .upsert({
      user_id: config.ownerUserId,
      phone_number_id: phoneNumberId,
      business_account_id: config.businessAccountId,
      display_phone_number: metadata?.display_phone_number || null,
      verified_name: metadata?.verified_name || null,
      source_platform: 'whatsapp_cloud',
      status: 'active',
      binding_source: 'local_env',
      onboarding_mode: 'local_env',
      webhook_status: 'verified',
      webhook_last_verified_at: now,
      messaging_status: 'unknown',
      updated_at: now,
    }, { onConflict: 'phone_number_id' })
    .select('user_id')
    .single()

  if (upsertError || !upserted?.user_id) {
    throw new Error(`Create WhatsApp business account mapping failed: ${upsertError?.message || 'missing user_id'}`)
  }

  return upserted.user_id as string
}

async function markWebhookVerified(supabase: WhatsAppInboxAdminClient, phoneNumberId: string) {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('whatsapp_business_accounts')
    .update({
      webhook_status: 'verified',
      webhook_last_verified_at: now,
      updated_at: now,
    })
    .eq('phone_number_id', phoneNumberId)
    .eq('status', 'active')

  if (error) {
    throw new Error(`Mark WhatsApp webhook verified failed: ${error.message}`)
  }
}

async function upsertContact(
  supabase: WhatsAppInboxAdminClient,
  userId: string,
  message: WhatsAppWebhookMessage,
  contactInfo: WhatsAppWebhookContact | undefined,
  receivedAt: string
) {
  const waId = contactInfo?.wa_id || message.from
  if (!waId) {
    throw new Error('WhatsApp message did not include wa_id/from.')
  }

  const { data, error } = await supabase
    .from('whatsapp_contacts')
    .upsert({
      user_id: userId,
      phone: message.from || waId,
      wa_id: waId,
      display_name: contactInfo?.profile?.name || null,
      source_platform: 'whatsapp_cloud',
      last_message_at: receivedAt,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,wa_id' })
    .select('*')
    .single()

  const contactId = getStringValue(data?.id)
  if (error || !contactId) {
    throw new Error(`Upsert WhatsApp contact failed: ${error?.message || 'missing contact'}`)
  }

  return { id: contactId } satisfies WhatsAppContactRow
}

async function upsertConversation(
  supabase: WhatsAppInboxAdminClient,
  userId: string,
  contactId: string,
  lastMessage: string,
  lastMessageAt: string,
  incrementUnread: boolean
) {
  const updateConversation = async (conversation: { id: string; unread_count?: number | null }) => {
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .update({
        status: 'open',
        last_message: lastMessage,
        last_message_at: lastMessageAt,
        unread_count: incrementUnread ? Number(conversation.unread_count || 0) + 1 : Number(conversation.unread_count || 0),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
      .eq('user_id', userId)
      .select('*')
      .single()

    if (error || !data) {
      throw new Error(`Update WhatsApp conversation failed: ${error?.message || 'missing conversation'}`)
    }
    return normalizeConversationRow(data)
  }

  const readExistingConversation = async () => {
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('id, unread_count')
      .eq('user_id', userId)
      .eq('contact_id', contactId)
      .maybeSingle()

    if (error) {
      throw new Error(`Lookup WhatsApp conversation failed: ${error.message}`)
    }

    return data
  }

  const { data: existing, error: lookupError } = await supabase
    .from('whatsapp_conversations')
    .select('id, unread_count')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Lookup WhatsApp conversation failed: ${lookupError.message}`)
  }

  const existingConversation = normalizeConversationRow(existing)
  if (existingConversation) {
    return updateConversation(existingConversation)
  }

  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .insert({
      user_id: userId,
      contact_id: contactId,
      status: 'open',
      last_message: lastMessage,
      last_message_at: lastMessageAt,
      unread_count: incrementUnread ? 1 : 0,
    })
    .select('*')
    .single()

  if (error && isUniqueViolation(error)) {
    const racedConversation = await readExistingConversation()
    const normalizedRacedConversation = normalizeConversationRow(racedConversation)
    if (normalizedRacedConversation) {
      return updateConversation(normalizedRacedConversation)
    }
  }

  if (error || !data) {
    throw new Error(`Create WhatsApp conversation failed: ${error?.message || 'missing conversation'}`)
  }
  return data
}

async function storeInboundMessage(
  supabase: WhatsAppInboxAdminClient,
  userId: string,
  contactId: string,
  message: WhatsAppWebhookMessage,
  contactInfo: WhatsAppWebhookContact | undefined,
  value: WhatsAppWebhookValue,
  payload: unknown
) {
  if (!message.id) {
    throw new Error('WhatsApp inbound message is missing message id.')
  }

  const messageType = message.type || 'unknown'
  const text = getMessageText(message) || null
  const mediaId = getMediaId(message)
  const receivedAt = timestampToIso(message.timestamp)

  const { data, error } = await supabase
    .from('whatsapp_messages')
    .insert({
      user_id: userId,
      contact_id: contactId,
      whatsapp_message_id: message.id,
      direction: 'inbound',
      message_type: messageType,
      text,
      media_url: mediaId,
      raw_payload: {
        payload,
        value,
        contact: contactInfo || null,
        message,
      },
      status: 'received',
      received_at: receivedAt,
    })
    .select('id')
    .single()

  if (error && isUniqueViolation(error)) {
    const { data: existing, error: lookupError } = await supabase
      .from('whatsapp_messages')
      .select('id')
      .eq('user_id', userId)
      .eq('whatsapp_message_id', message.id)
      .maybeSingle()

    if (lookupError) {
      throw new Error(`Lookup duplicate WhatsApp message failed: ${lookupError.message}`)
    }

    return { id: existing?.id || null, inserted: false }
  }

  if (error || !data) {
    throw new Error(`Store WhatsApp inbound message failed: ${error?.message || 'missing message'}`)
  }

  return { id: data.id, inserted: true }
}

async function updateMessageStatus(
  supabase: WhatsAppInboxAdminClient,
  userId: string,
  status: WhatsAppWebhookStatus,
  value: WhatsAppWebhookValue,
  payload: unknown
) {
  if (!status.id) return false

  const nextStatus = normalizeOutboundStatus(status.status)
  const errorMessage = getStatusError(status)
  const timestamp = timestampToIso(status.timestamp)
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .update({
      status: nextStatus,
      error_message: errorMessage,
      raw_payload: {
        payload,
        value,
        status,
      },
      ...(nextStatus === 'failed' ? { sent_at: timestamp } : {}),
    })
    .eq('user_id', userId)
    .eq('whatsapp_message_id', status.id)
    .select('id')

  if (error) {
    throw new Error(`Update WhatsApp message status failed: ${error.message}`)
  }

  if (!data || data.length === 0) {
    return false
  }

  return true
}

export async function processWhatsAppWebhookPayload(payload: WhatsAppWebhookPayload) {
  const supabase = createAdminClient() as unknown as WhatsAppInboxAdminClient
  const entries = Array.isArray(payload?.entry) ? payload.entry : []
  let messagesStored = 0
  let statusesUpdated = 0

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const change of changes) {
      const value = change?.value || {}
      const phoneNumberId = typeof value?.metadata?.phone_number_id === 'string' ? value.metadata.phone_number_id : ''
      if (!phoneNumberId) {
        throw new Error('WhatsApp webhook metadata did not include phone_number_id.')
      }

      const userId = await resolveWhatsAppOwnerUserId(supabase, phoneNumberId, value.metadata)
      const contacts = Array.isArray(value.contacts) ? value.contacts as WhatsAppWebhookContact[] : []

      for (const status of (Array.isArray(value.statuses) ? value.statuses as WhatsAppWebhookStatus[] : [])) {
        const updated = await updateMessageStatus(supabase, userId, status, value, payload)
        if (updated) statusesUpdated++
      }

      for (const message of (Array.isArray(value.messages) ? value.messages as WhatsAppWebhookMessage[] : [])) {
        const contactInfo = contacts.find((contact) => contact.wa_id === message.from) || contacts[0]
        const receivedAt = timestampToIso(message.timestamp)
        const contact = await upsertContact(supabase, userId, message, contactInfo, receivedAt)
        const messageType = message.type || 'unknown'
        const text = getMessageText(message) || null
        const storedMessage = await storeInboundMessage(supabase, userId, contact.id, message, contactInfo, value, payload)
        await markWebhookVerified(supabase, phoneNumberId)
        if (storedMessage.inserted) {
          await upsertConversation(supabase, userId, contact.id, getPreview(messageType, text), receivedAt, true)
          messagesStored++
        }
      }
    }
  }

  return { messagesStored, statusesUpdated }
}

export async function updateConversationAfterOutbound(
  supabase: WhatsAppInboxAdminClient,
  userId: string,
  contactId: string,
  text: string,
  sentAt: string
) {
  await upsertConversation(supabase, userId, contactId, text, sentAt, false)
}
