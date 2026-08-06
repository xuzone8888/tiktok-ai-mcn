import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { unsubscribeFacebookPageFromWebhooks } from '@/lib/facebook/oauth'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: account, error: fetchError } = await (supabase as any)
      .from('facebook_accounts')
      .select('id, channel_id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !account) {
      return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRecord } = await adminSupabase
      .from('facebook_account_tokens')
      .select('access_token')
      .eq('account_id', account.id)
      .maybeSingle()

    try {
      if (tokenRecord?.access_token) {
        await unsubscribeFacebookPageFromWebhooks(account.channel_id, tokenRecord.access_token)
      }
    } catch (error) {
      console.warn('Failed to remove Facebook Page webhook subscription, removing local binding anyway:', error)
    }

    const { error } = await adminSupabase
      .from('facebook_accounts')
      .delete()
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: '移除 Facebook 账号失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete Facebook account error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
