import { NextRequest, NextResponse } from 'next/server'

import { isLinkedInPublishEnabledServer } from '@/lib/feature-flags'
import { revokeLinkedInToken } from '@/lib/linkedin/oauth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isLinkedInPublishEnabledServer()) {
      return NextResponse.json({ error: 'LinkedIn 发布功能已暂停', disabled: true }, { status: 403 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: account, error: accountError } = await (supabase as any)
      .from('linkedin_accounts')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (accountError || !account) {
      return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
    }

    const adminSupabase = createAdminClient() as any
    const { data: tokenRecord } = await adminSupabase
      .from('linkedin_account_tokens')
      .select('access_token, refresh_token')
      .eq('account_id', account.id)
      .maybeSingle()

    const tokensToRevoke = [
      tokenRecord?.refresh_token,
      tokenRecord?.access_token,
    ].filter((token, index, tokens): token is string => Boolean(token) && tokens.indexOf(token) === index)

    for (const token of tokensToRevoke) {
      await revokeLinkedInToken(token).catch((error) => {
        console.warn('Failed to revoke LinkedIn token before account delete:', error)
      })
    }

    const { error: deleteError } = await adminSupabase
      .from('linkedin_accounts')
      .delete()
      .eq('id', account.id)
      .eq('user_id', user.id)

    if (deleteError) {
      return NextResponse.json({ error: '解绑 LinkedIn 账号失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete LinkedIn account error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '解绑 LinkedIn 账号失败' },
      { status: 500 }
    )
  }
}
