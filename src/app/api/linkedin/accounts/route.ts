import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
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
      .from('linkedin_accounts')
      .select('id, owner_urn, owner_type, localized_name, vanity_name, avatar_url, follower_count, status, access_token_expires_at, scopes, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('owner_type', 'member')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching LinkedIn accounts:', error)
      return NextResponse.json({ error: '获取 LinkedIn 账号失败' }, { status: 500 })
    }

    const accountIds = (data || []).map((account: { id: string }) => account.id)
    const expiredWithoutRefresh = new Set<string>()

    if (accountIds.length > 0) {
      const adminSupabase = createAdminClient() as any
      const { data: tokenRows, error: tokenError } = await adminSupabase
        .from('linkedin_account_tokens')
        .select('account_id, refresh_token, access_token_expires_at')
        .in('account_id', accountIds)

      if (tokenError) {
        console.warn('Check LinkedIn token expiration failed:', tokenError.message)
      } else {
        for (const token of tokenRows || []) {
          const expiresAt = token.access_token_expires_at ? new Date(token.access_token_expires_at).getTime() : null
          if (!token.refresh_token && expiresAt !== null && expiresAt <= Date.now()) {
            expiredWithoutRefresh.add(token.account_id)
          }
        }

        if (expiredWithoutRefresh.size > 0) {
          await adminSupabase
            .from('linkedin_accounts')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .in('id', [...expiredWithoutRefresh])
        }
      }
    }

    const accounts = (data || []).map((account: any) => ({
      ...account,
      status: expiredWithoutRefresh.has(account.id) ? 'expired' : account.status,
      follower_count: Number(account.follower_count || 0),
      scopes: Array.isArray(account.scopes) ? account.scopes : [],
    }))

    return NextResponse.json({ accounts })
  } catch (error) {
    console.error('LinkedIn accounts API error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
