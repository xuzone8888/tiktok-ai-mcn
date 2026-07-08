import { NextResponse } from 'next/server'

import { isWhatsAppInboxEnabledServer, WHATSAPP_INBOX_DISABLED_MESSAGE } from '@/lib/feature-flags'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    if (!isWhatsAppInboxEnabledServer()) {
      console.info('[WhatsApp Conversations] Request rejected because WhatsApp Inbox is disabled.')
      return NextResponse.json({ error: WHATSAPP_INBOX_DISABLED_MESSAGE, disabled: true }, { status: 503 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    console.info('[WhatsApp Conversations] Fetching conversations:', { userId: user.id })
    const { data, error } = await (supabase as any)
      .from('whatsapp_conversations')
      .select(`
        id,
        user_id,
        contact_id,
        status,
        last_message,
        last_message_at,
        unread_count,
        assigned_user_id,
        created_at,
        updated_at,
        contact:whatsapp_contacts (
          id,
          user_id,
          phone,
          wa_id,
          display_name,
          country,
          source_platform,
          last_message_at,
          status,
          assigned_user_id,
          created_at,
          updated_at
        )
      `)
      .eq('user_id', user.id)
      .order('last_message_at', { ascending: false, nullsFirst: false })

    if (error) {
      console.error('[WhatsApp Conversations] Fetch failed:', error)
      return NextResponse.json({ error: '获取 WhatsApp 会话失败' }, { status: 500 })
    }

    return NextResponse.json({ conversations: data || [] })
  } catch (error) {
    console.error('[WhatsApp Conversations] Error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
