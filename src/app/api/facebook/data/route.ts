import { NextRequest, NextResponse } from 'next/server'

import {
  revokeFacebookToken,
  unsubscribeFacebookPageFromWebhooks,
} from '@/lib/facebook/oauth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient() as any
    const { data: accounts, error: accountsError } = await admin
      .from('facebook_accounts')
      .select('id, channel_id')
      .eq('user_id', user.id)
    if (accountsError) {
      return NextResponse.json({ error: '读取 Facebook 账号失败' }, { status: 500 })
    }

    const accountIds = (accounts || [])
      .map((account: { id?: unknown }) => typeof account.id === 'string' ? account.id : null)
      .filter(Boolean) as string[]
    const webhookSubscriptions: Array<{ pageId: string; pageToken: string }> = []
    const userTokens = new Set<string>()

    if (accountIds.length > 0) {
      const { data: tokens, error: tokensError } = await admin
        .from('facebook_account_tokens')
        .select('account_id, access_token, refresh_token')
        .in('account_id', accountIds)
      if (tokensError) {
        return NextResponse.json({ error: '读取 Facebook 授权令牌失败' }, { status: 500 })
      }
      const pageIdByAccountId = new Map<string, string>(
        (accounts || []).flatMap((account: { id?: unknown; channel_id?: unknown }) =>
          typeof account.id === 'string' && typeof account.channel_id === 'string'
            ? [[account.id, account.channel_id] as const]
            : []
        )
      )
      for (const row of (tokens || []) as Array<{
        account_id?: unknown
        access_token?: unknown
        refresh_token?: unknown
      }>) {
        const accountId = typeof row.account_id === 'string' ? row.account_id : ''
        const pageId = pageIdByAccountId.get(accountId)
        const pageToken = typeof row.access_token === 'string' ? row.access_token : ''
        if (pageId && pageToken) webhookSubscriptions.push({ pageId, pageToken })
        if (typeof row.refresh_token === 'string' && row.refresh_token) {
          userTokens.add(row.refresh_token)
        }
      }
    }

    // Delete local data transactionally before remote cleanup. Remote webhook
    // removal or token revocation must not prevent fulfillment of a user's
    // local deletion request when Meta is temporarily unavailable.
    const { data: deletion, error } = await admin.rpc('delete_facebook_user_data', {
      p_user_id: user.id,
    })
    if (error) {
      console.error('Facebook user data deletion failed:', {
        code: error.code,
        message: error.message,
      })
      return NextResponse.json({ error: '删除 Facebook 数据失败' }, { status: 500 })
    }

    const remoteCleanup = await Promise.allSettled([
      ...webhookSubscriptions.map(({ pageId, pageToken }) =>
        unsubscribeFacebookPageFromWebhooks(pageId, pageToken)
      ),
      ...[...userTokens].map(revokeFacebookToken),
    ])
    const remoteCleanupFailed = remoteCleanup.filter((result) => result.status === 'rejected').length
    if (remoteCleanupFailed > 0) {
      console.warn('Facebook local data deleted but remote cleanup was incomplete:', {
        failed_operations: remoteCleanupFailed,
      })
    }

    return NextResponse.json({
      success: true,
      deletion,
      remote_cleanup_complete: remoteCleanupFailed === 0,
    })
  } catch (error) {
    console.error('Delete all Facebook data error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
