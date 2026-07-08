import { NextResponse } from 'next/server'

import { isWhatsAppInboxEnabledServer, WHATSAPP_INBOX_DISABLED_MESSAGE } from '@/lib/feature-flags'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  buildWhatsAppEmbeddedSignupLaunchConfig,
  isWhatsAppRedirectTunnelReachable,
} from '@/lib/whatsapp/oauth'

export const dynamic = 'force-dynamic'

const WHATSAPP_BUSINESS_CONFIG_INCOMPLETE_MESSAGE = 'WhatsApp Business 绑定配置不完整'

type SupabaseWriteResult = Promise<{ error: { message: string } | null }>

interface WhatsAppAuthStateTable {
  insert(values: Record<string, unknown>): SupabaseWriteResult
  update(values: Record<string, unknown>): SupabaseWriteFilterBuilder
  delete(): SupabaseWriteFilterBuilder
}

interface SupabaseWriteFilterBuilder extends PromiseLike<{ error: { message: string } | null }> {
  eq(column: string, value: unknown): SupabaseWriteFilterBuilder
  in(column: string, values: unknown[]): SupabaseWriteFilterBuilder
}

interface WhatsAppAuthAdminClient {
  from(table: 'whatsapp_auth_states'): WhatsAppAuthStateTable
  from(table: 'whatsapp_business_accounts'): WhatsAppAuthStateTable
}

async function cleanupCurrentUserIncompleteBindingState(
  adminSupabase: WhatsAppAuthAdminClient,
  userId: string
) {
  const now = new Date().toISOString()

  const { error: deleteOldTerminalError } = await adminSupabase
    .from('whatsapp_auth_states')
    .delete()
    .eq('user_id', userId)
    .in('status', ['failed', 'expired'])

  if (deleteOldTerminalError) {
    throw new Error(`归档旧 WhatsApp 授权状态失败: ${deleteOldTerminalError.message}`)
  }

  const { error: expirePendingError } = await adminSupabase
    .from('whatsapp_auth_states')
    .update({
      status: 'expired',
      error_code: 'WHATSAPP_AUTH_STATE_EXPIRED',
      error_message: 'Superseded by a new WhatsApp Embedded Signup attempt.',
      code_verifier: null,
    })
    .eq('user_id', userId)
    .eq('status', 'pending')

  if (expirePendingError) {
    throw new Error(`清理旧 WhatsApp 授权状态失败: ${expirePendingError.message}`)
  }

  const { error: archiveTemporaryAccountError } = await adminSupabase
    .from('whatsapp_business_accounts')
    .update({
      webhook_status: 'disabled',
      messaging_status: 'disabled',
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('status', 'disabled')
    .in('binding_source', ['embedded_signup', 'facebook_login_for_business'])

  if (archiveTemporaryAccountError) {
    throw new Error(`归档未完成 WhatsApp 临时账号失败: ${archiveTemporaryAccountError.message}`)
  }
}

export async function POST() {
  try {
    if (!isWhatsAppInboxEnabledServer()) {
      return NextResponse.json({ error: WHATSAPP_INBOX_DISABLED_MESSAGE, disabled: true }, { status: 503 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录后再绑定 WhatsApp Business 账号' }, { status: 401 })
    }

    const redirectTunnelReachable = await isWhatsAppRedirectTunnelReachable()
    if (!redirectTunnelReachable) {
      return NextResponse.json(
        {
          code: 'WHATSAPP_REDIRECT_TUNNEL_UNREACHABLE',
          error: 'WhatsApp Business 授权回调地址不可达，请重启本地 tunnel 后重试',
        },
        { status: 409 }
      )
    }

    const { launchConfig, state, codeVerifier, diagnostics } = buildWhatsAppEmbeddedSignupLaunchConfig(user.id)
    console.info('[WhatsApp Auth URL] Embedded Signup launch diagnostics:', diagnostics)
    const adminSupabase = createAdminClient() as unknown as WhatsAppAuthAdminClient
    await cleanupCurrentUserIncompleteBindingState(adminSupabase, user.id)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const { error } = await adminSupabase
      .from('whatsapp_auth_states')
      .insert({
        state,
        code_verifier: codeVerifier,
        user_id: user.id,
        expires_at: expiresAt,
        status: 'pending',
      })

    if (error) {
      console.error('[WhatsApp Auth URL] Store state failed:', error)
      return NextResponse.json({ error: '初始化 WhatsApp Business 授权失败' }, { status: 500 })
    }

    return NextResponse.json({
      launchMode: 'js_sdk_embedded_signup',
      launchConfig,
    })
  } catch (error) {
    console.error('[WhatsApp Auth URL] Error:', error)

    if (
      error instanceof Error
      && error.message.includes('WhatsApp Business binding configuration is incomplete')
    ) {
      return NextResponse.json(
        { error: WHATSAPP_BUSINESS_CONFIG_INCOMPLETE_MESSAGE, configIncomplete: true },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成 WhatsApp Business 授权链接失败' },
      { status: 500 }
    )
  }
}
