import { NextResponse } from 'next/server'

import { isWhatsAppInboxEnabledServer, WHATSAPP_INBOX_DISABLED_MESSAGE } from '@/lib/feature-flags'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface WhatsAppBusinessAccountRow {
  id: string
  phone_number_id: string
  business_account_id: string | null
  business_account_name: string | null
  business_portfolio_id: string | null
  business_portfolio_name: string | null
  display_phone_number: string | null
  verified_name: string | null
  source_platform: string
  status: string
  binding_source: string
  onboarding_mode: string | null
  webhook_status: string | null
  webhook_last_verified_at: string | null
  messaging_status: string | null
  channel_label: string | null
  scopes: unknown
  connected_at: string | null
  created_at: string
  updated_at: string
}

interface WhatsAppBusinessAccountTokenRow {
  account_id: string
  access_token_expires_at: string | null
}

interface SupabaseSelectBuilder<T> {
  select(columns: string): SupabaseSelectBuilder<T>
  eq(column: string, value: unknown): SupabaseSelectBuilder<T>
  in(column: string, values: unknown[]): SupabaseSelectBuilder<T>
  order(column: string, options: { ascending: boolean }): Promise<{ data: T[] | null; error: { message: string } | null }>
}

interface WhatsAppAccountsClient {
  from(table: 'whatsapp_business_accounts'): SupabaseSelectBuilder<WhatsAppBusinessAccountRow>
  from(table: 'whatsapp_business_account_tokens'): SupabaseSelectBuilder<WhatsAppBusinessAccountTokenRow>
}

function isFormalBinding(account: WhatsAppBusinessAccountRow) {
  return account.binding_source === 'embedded_signup' || account.binding_source === 'facebook_login_for_business'
}

function isTokenExpired(expiresAt: string | null) {
  if (!expiresAt) return false
  const timestamp = new Date(expiresAt).getTime()
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

function getTokenStatus(formal: boolean, token: WhatsAppBusinessAccountTokenRow | null) {
  if (!formal) return 'not_required'
  if (!token) return 'missing'
  if (isTokenExpired(token.access_token_expires_at)) return 'expired'
  return 'valid'
}

function getEffectiveAccountStatus(account: WhatsAppBusinessAccountRow, formal: boolean, tokenStatus: string) {
  if (account.status === 'active' && formal && tokenStatus !== 'valid') {
    return 'disabled'
  }
  return account.status
}

function getEffectiveWebhookStatus(account: WhatsAppBusinessAccountRow) {
  if (account.status !== 'active') return 'disabled'
  if (account.webhook_status && account.webhook_status !== 'unknown') return account.webhook_status
  return account.phone_number_id ? 'mapped' : 'unknown'
}

function getEffectiveMessagingStatus(account: WhatsAppBusinessAccountRow, effectiveStatus: string, tokenStatus: string) {
  if (effectiveStatus !== 'active') return 'disabled'
  if (isFormalBinding(account) && tokenStatus !== 'valid') return 'blocked'
  if (account.messaging_status && account.messaging_status !== 'unknown') return account.messaging_status
  return 'unknown'
}

function maskSensitiveId(value: string | null) {
  if (!value) return null
  if (value.length <= 4) return '****'
  return `${'*'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`
}

export async function GET() {
  try {
    if (!isWhatsAppInboxEnabledServer()) {
      return NextResponse.json({ error: WHATSAPP_INBOX_DISABLED_MESSAGE, disabled: true }, { status: 503 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录后再查看 WhatsApp Business 绑定' }, { status: 401 })
    }

    const whatsappSupabase = createAdminClient() as unknown as WhatsAppAccountsClient
    const { data, error } = await whatsappSupabase
      .from('whatsapp_business_accounts')
      .select(`
        id,
        phone_number_id,
        business_account_id,
        business_account_name,
        business_portfolio_id,
        business_portfolio_name,
        display_phone_number,
        verified_name,
        source_platform,
        status,
        binding_source,
        onboarding_mode,
        webhook_status,
        webhook_last_verified_at,
        messaging_status,
        channel_label,
        scopes,
        connected_at,
        created_at,
        updated_at
      `)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('[WhatsApp Business Accounts] Fetch failed:', error)
      return NextResponse.json({ error: '获取 WhatsApp Business 绑定失败' }, { status: 500 })
    }

    const accountIds = (data || []).map((account) => account.id)
    const tokenByAccountId = new Map<string, WhatsAppBusinessAccountTokenRow>()

    if (accountIds.length > 0) {
      const { data: tokenRows, error: tokenError } = await whatsappSupabase
        .from('whatsapp_business_account_tokens')
        .select('account_id, access_token_expires_at')
        .in('account_id', accountIds)
        .order('account_id', { ascending: true })

      if (tokenError) {
        console.error('[WhatsApp Business Accounts] Token metadata fetch failed:', tokenError)
        return NextResponse.json({ error: '获取 WhatsApp Business token 状态失败' }, { status: 500 })
      }

      for (const tokenRow of tokenRows || []) {
        tokenByAccountId.set(tokenRow.account_id, tokenRow)
      }
    }

    return NextResponse.json({
      accounts: (data || []).map((account) => {
        const formal = isFormalBinding(account)
        const token = tokenByAccountId.get(account.id) || null
        const tokenStatus = getTokenStatus(formal, token)
        const effectiveStatus = getEffectiveAccountStatus(account, formal, tokenStatus)
        const webhookStatus = getEffectiveWebhookStatus(account)
        const messagingStatus = getEffectiveMessagingStatus(account, effectiveStatus, tokenStatus)
        const canReceiveMessages = effectiveStatus === 'active' && webhookStatus === 'verified'
        const canSendMessages = effectiveStatus === 'active' && tokenStatus === 'valid' && messagingStatus === 'ready'

        return {
          id: account.id,
          masked_phone_number_id: maskSensitiveId(account.phone_number_id),
          masked_business_account_id: maskSensitiveId(account.business_account_id),
          masked_business_portfolio_id: maskSensitiveId(account.business_portfolio_id),
          has_phone_number_id: Boolean(account.phone_number_id),
          has_business_account_id: Boolean(account.business_account_id),
          has_business_portfolio_id: Boolean(account.business_portfolio_id),
          business_account_name: account.business_account_name,
          business_portfolio_name: account.business_portfolio_name,
          display_phone_number: account.display_phone_number,
          verified_name: account.verified_name,
          source_platform: account.source_platform,
          binding_source: account.binding_source,
          onboarding_mode: account.onboarding_mode || (formal ? 'embedded_signup' : 'local_env'),
          webhook_status: webhookStatus,
          webhook_last_verified_at: account.webhook_last_verified_at,
          messaging_status: messagingStatus,
          channel_label: account.channel_label,
          connected_at: account.connected_at,
          created_at: account.created_at,
          updated_at: account.updated_at,
          database_status: account.status,
          status: effectiveStatus,
          is_available: effectiveStatus === 'active',
          can_receive_messages: canReceiveMessages,
          can_send_messages: canSendMessages,
          token_status: tokenStatus,
          scopes: Array.isArray(account.scopes) ? account.scopes : [],
        }
      }),
    })
  } catch (error) {
    console.error('[WhatsApp Business Accounts] Error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
