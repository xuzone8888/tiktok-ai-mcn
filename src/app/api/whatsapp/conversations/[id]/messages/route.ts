import { NextRequest, NextResponse } from 'next/server'

import { isWhatsAppInboxEnabledServer, WHATSAPP_INBOX_DISABLED_MESSAGE } from '@/lib/feature-flags'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isWhatsAppInboxEnabledServer()) {
      console.info('[WhatsApp Messages] Request rejected because WhatsApp Inbox is disabled.')
      return NextResponse.json({ error: WHATSAPP_INBOX_DISABLED_MESSAGE, disabled: true }, { status: 503 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 100)
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 200))
      : 100
    console.info('[WhatsApp Messages] Fetching messages:', { userId: user.id, conversationId: params.id, limit })

    const { data: conversation, error: conversationError } = await (supabase as any)
      .from('whatsapp_conversations')
      .select('id, contact_id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (conversationError) {
      console.error('[WhatsApp Messages] Conversation lookup failed:', conversationError)
      return NextResponse.json({ error: '查询 WhatsApp 会话失败' }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 })
    }

    const { data, error } = await (supabase as any)
      .from('whatsapp_messages')
      .select('*')
      .eq('user_id', user.id)
      .eq('contact_id', conversation.contact_id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[WhatsApp Messages] Fetch failed:', error)
      return NextResponse.json({ error: '获取 WhatsApp 消息失败' }, { status: 500 })
    }

    const { error: resetError } = await (supabase as any)
      .from('whatsapp_conversations')
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('user_id', user.id)

    if (resetError) {
      console.error('[WhatsApp Messages] Reset unread count failed:', resetError)
    }

    return NextResponse.json({ messages: (data || []).reverse() })
  } catch (error) {
    console.error('[WhatsApp Messages] Error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
