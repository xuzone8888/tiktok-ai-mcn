import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await (supabase as any)
      .from('facebook_accounts')
      .select('id, channel_id, channel_title, channel_handle, thumbnail_url, subscriber_count, video_count, view_count, status, access_token_expires_at, scopes, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching Facebook accounts:', error)
      return NextResponse.json({ error: '获取 Facebook 账号失败' }, { status: 500 })
    }

    const accounts = (data || []).map((account: any) => ({
      ...account,
      subscriber_count: Number(account.subscriber_count || 0),
      video_count: Number(account.video_count || 0),
      view_count: Number(account.view_count || 0),
      scopes: Array.isArray(account.scopes) ? account.scopes : [],
    }))

    return NextResponse.json({ accounts })
  } catch (error) {
    console.error('Facebook accounts API error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
