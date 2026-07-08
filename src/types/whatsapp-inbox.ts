export type WhatsAppConversationStatus = 'open' | 'closed' | 'archived'
export type WhatsAppContactStatus = 'active' | 'blocked' | 'archived'
export type WhatsAppMessageDirection = 'inbound' | 'outbound'
export type WhatsAppMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'

export interface WhatsAppContact {
  id: string
  user_id: string
  phone: string
  wa_id: string
  display_name: string | null
  country: string | null
  source_platform: string
  last_message_at: string | null
  status: WhatsAppContactStatus
  assigned_user_id: string | null
  created_at: string
  updated_at: string
}

export interface WhatsAppConversation {
  id: string
  user_id: string
  contact_id: string
  status: WhatsAppConversationStatus
  last_message: string | null
  last_message_at: string | null
  unread_count: number
  assigned_user_id: string | null
  created_at: string
  updated_at: string
  contact?: WhatsAppContact | null
}

export interface WhatsAppMessage {
  id: string
  user_id: string
  contact_id: string
  whatsapp_message_id: string | null
  direction: WhatsAppMessageDirection
  message_type: string
  text: string | null
  media_url: string | null
  raw_payload: unknown
  status: WhatsAppMessageStatus
  error_message: string | null
  sent_at: string | null
  received_at: string | null
  created_at: string
}
