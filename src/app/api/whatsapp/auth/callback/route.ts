import { NextRequest, NextResponse } from 'next/server'

import { isWhatsAppInboxEnabledServer } from '@/lib/feature-flags'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  callbackErrorStatus,
  completeWhatsAppAuthorization,
  completionDiagnostics,
  getAuthErrorDetails,
  markAuthStateFailedAfterError,
  WHATSAPP_AUTH_ERROR_MESSAGES,
  WhatsAppAuthFlowError,
  type SavedWhatsAppBusinessAccount,
  type SupabaseError,
  type WhatsAppAuthCompletionDependencies,
  type WhatsAppAuthCompletionHints,
  type WhatsAppAuthCompletionInput,
  type WhatsAppAuthStateRow,
  type WhatsAppBusinessAccountRow,
} from '@/lib/whatsapp/auth-completion'
import {
  calculateWhatsAppTokenExpiration,
  discoverWhatsAppBusinessPhoneNumbers,
  exchangeForLongLivedWhatsAppToken,
  exchangeWhatsAppCodeForToken,
  resolveWhatsAppGrantedScopes,
} from '@/lib/whatsapp/oauth'

export const dynamic = 'force-dynamic'

type SupabaseWriteResult = Promise<{ error: SupabaseError | null }>

interface SupabaseEqWriteBuilder {
  eq(column: string, value: unknown): SupabaseWriteResult
}

interface SupabaseUpsertBuilder<T> extends PromiseLike<{ data: T | null; error: SupabaseError | null }> {
  select(columns: string): SupabaseQueryBuilder<T>
}

interface SupabaseQueryBuilder<T> extends PromiseLike<{ data: T[] | null; error: SupabaseError | null }> {
  select(columns: string): SupabaseQueryBuilder<T>
  eq(column: string, value: unknown): SupabaseQueryBuilder<T>
  single(): Promise<{ data: T | null; error: SupabaseError | null }>
  maybeSingle(): Promise<{ data: T | null; error: SupabaseError | null }>
  update(values: Record<string, unknown>): SupabaseEqWriteBuilder
  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): SupabaseUpsertBuilder<T>
}

interface WhatsAppBindingAdminClient {
  from(table: 'whatsapp_auth_states'): SupabaseQueryBuilder<WhatsAppAuthStateRow>
  from(table: 'whatsapp_business_accounts'): SupabaseQueryBuilder<WhatsAppBusinessAccountRow>
  from(table: 'whatsapp_business_account_tokens'): SupabaseQueryBuilder<unknown>
}

function getRequestOrigin(request: NextRequest) {
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host') || request.nextUrl.host
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'http'
  return `${protocol.split(',')[0].trim()}://${host.split(',')[0].trim()}`
}

function getAppRedirectOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || getRequestOrigin(request)
}

function redirectToWhatsAppBusiness(origin: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params)
  const redirectUrl = new URL('/whatsapp-business', origin)
  redirectUrl.search = searchParams.toString()
  return NextResponse.redirect(redirectUrl)
}

function redirectWithWhatsAppAuthError(
  origin: string,
  code: keyof typeof WHATSAPP_AUTH_ERROR_MESSAGES,
  message: string = WHATSAPP_AUTH_ERROR_MESSAGES[code]
) {
  return redirectToWhatsAppBusiness(origin, {
    code,
    error: message,
  })
}

function getFirstParam(searchParams: URLSearchParams, names: string[]) {
  for (const name of names) {
    const value = searchParams.get(name)
    if (value) return value
  }
  return null
}

function getStringBodyValue(body: unknown, key: string) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function createCompletionDependencies(supabase: WhatsAppBindingAdminClient): WhatsAppAuthCompletionDependencies {
  return {
    async getAuthState(state) {
      return supabase
        .from('whatsapp_auth_states')
        .select('*')
        .eq('state', state)
        .single()
    },
    async updateAuthState(state, values, context) {
      const { error } = await supabase
        .from('whatsapp_auth_states')
        .update(values)
        .eq('state', state)

      if (error) {
        console.error(`[WhatsApp Auth Callback] ${context}:`, error)
        throw new Error(`${context}: ${error.message}`)
      }
    },
    async tryUpdateAuthState(state, values, context) {
      const { error } = await supabase
        .from('whatsapp_auth_states')
        .update(values)
        .eq('state', state)

      if (error) {
        console.error(`[WhatsApp Auth Callback] ${context}:`, error)
        return false
      }

      return true
    },
    async findAccountByPhoneNumber(phoneNumberId) {
      const { data, error } = await supabase
        .from('whatsapp_business_accounts')
        .select('id, user_id, phone_number_id, binding_source, status, display_phone_number, verified_name, business_portfolio_id, business_portfolio_name, onboarding_mode, webhook_status, messaging_status')
        .eq('phone_number_id', phoneNumberId)
        .maybeSingle()

      if (error) {
        throw new Error(`查询 WhatsApp 号码绑定失败: ${error.message}`)
      }

      return data
    },
    async listActiveAccountsForUser(userId) {
      const { data, error } = await supabase
        .from('whatsapp_business_accounts')
        .select('id, user_id, phone_number_id, binding_source, status, display_phone_number, verified_name, business_portfolio_id, business_portfolio_name, onboarding_mode, webhook_status, messaging_status')
        .eq('user_id', userId)
        .eq('status', 'active')

      if (error) {
        throw new Error(`查询用户 WhatsApp Business 绑定失败: ${error.message}`)
      }

      return data || []
    },
    async upsertBusinessAccount(values) {
      const { data, error } = await supabase
        .from('whatsapp_business_accounts')
        .upsert(values, {
          onConflict: 'phone_number_id',
        })
        .select('id, display_phone_number, verified_name')
        .single()

      if (error || !data?.id) {
        throw new Error(`保存 WhatsApp Business 号码失败: ${error?.message || 'missing account id'}`)
      }

      return data as SavedWhatsAppBusinessAccount
    },
    async markBusinessAccountDisabled(accountId, now, context) {
      const { error } = await supabase
        .from('whatsapp_business_accounts')
        .update({
          status: 'disabled',
          updated_at: now,
        })
        .eq('id', accountId)

      if (error) {
        console.error(`[WhatsApp Auth Callback] ${context}:`, error)
        throw new Error(`${context}: ${error.message}`)
      }
    },
    async markBusinessAccountActive(accountId, now) {
      const { error } = await supabase
        .from('whatsapp_business_accounts')
        .update({
          status: 'active',
          updated_at: now,
        })
        .eq('id', accountId)

      if (error) {
        console.error('[WhatsApp Auth Callback] Activate business account failed:', error)
        throw new Error(`激活 WhatsApp Business 号码失败: ${error.message}`)
      }
    },
    async upsertToken(values) {
      const { error } = await supabase
        .from('whatsapp_business_account_tokens')
        .upsert(values, {
          onConflict: 'account_id',
        })

      if (error) {
        throw new Error(`保存 WhatsApp Business 授权令牌失败: ${error.message}`)
      }
    },
    exchangeCodeForToken: exchangeWhatsAppCodeForToken,
    exchangeLongLivedToken: exchangeForLongLivedWhatsAppToken,
    resolveGrantedScopes: resolveWhatsAppGrantedScopes,
    calculateTokenExpiration: calculateWhatsAppTokenExpiration,
    discoverPhoneNumbers: discoverWhatsAppBusinessPhoneNumbers,
    logInfo(message, values) {
      console.info(message, values)
    },
    logError(message, values) {
      console.error(message, values)
    },
  }
}

function buildInputFromSearchParams(searchParams: URLSearchParams): WhatsAppAuthCompletionInput {
  return {
    code: searchParams.get('code'),
    state: searchParams.get('state'),
    error: searchParams.get('error'),
    errorDescription: searchParams.get('error_description'),
    callbackGrantedScopes: getFirstParam(searchParams, ['granted_scopes']),
    hints: {
      businessAccountId: getFirstParam(searchParams, ['waba_id', 'whatsapp_business_account_id', 'business_account_id']),
      businessPortfolioId: getFirstParam(searchParams, ['business_id', 'business_portfolio_id', 'customer_business_id']),
      businessPortfolioName: getFirstParam(searchParams, ['business_name', 'business_portfolio_name']),
      phoneNumberId: getFirstParam(searchParams, ['phone_number_id', 'whatsapp_phone_number_id']),
      displayPhoneNumber: getFirstParam(searchParams, ['display_phone_number']),
      verifiedName: getFirstParam(searchParams, ['verified_name']),
    },
  }
}

function buildInputFromBody(body: unknown): WhatsAppAuthCompletionInput {
  const hints: WhatsAppAuthCompletionHints = {
    businessAccountId: getStringBodyValue(body, 'businessAccountId')
      || getStringBodyValue(body, 'wabaId')
      || getStringBodyValue(body, 'whatsappBusinessAccountId'),
    businessPortfolioId: getStringBodyValue(body, 'businessPortfolioId')
      || getStringBodyValue(body, 'businessId')
      || getStringBodyValue(body, 'customerBusinessId'),
    businessPortfolioName: getStringBodyValue(body, 'businessPortfolioName')
      || getStringBodyValue(body, 'businessName'),
    phoneNumberId: getStringBodyValue(body, 'phoneNumberId')
      || getStringBodyValue(body, 'whatsappPhoneNumberId'),
    displayPhoneNumber: getStringBodyValue(body, 'displayPhoneNumber'),
    verifiedName: getStringBodyValue(body, 'verifiedName'),
  }

  return {
    code: getStringBodyValue(body, 'code'),
    state: getStringBodyValue(body, 'state'),
    callbackGrantedScopes: getStringBodyValue(body, 'grantedScopes'),
    hints,
  }
}

async function markDisabledAuthState(deps: WhatsAppAuthCompletionDependencies, state: string | null) {
  if (!state) return

  await deps.tryUpdateAuthState(
    state,
    {
      status: 'failed',
      error_code: 'disabled',
      error_message: 'WhatsApp Inbox is disabled.',
      code_verifier: null,
      completed_at: new Date().toISOString(),
    },
    'Mark disabled auth state failed'
  )
}

export async function GET(request: NextRequest) {
  const input = buildInputFromSearchParams(request.nextUrl.searchParams)
  const redirectOrigin = getAppRedirectOrigin(request)
  const supabase = createAdminClient() as unknown as WhatsAppBindingAdminClient
  const deps = createCompletionDependencies(supabase)

  if (!isWhatsAppInboxEnabledServer()) {
    await markDisabledAuthState(deps, input.state)

    return redirectToWhatsAppBusiness(redirectOrigin, {
      code: 'disabled',
      error: 'WhatsApp Inbox is disabled.',
    })
  }

  try {
    const result = await completeWhatsAppAuthorization(deps, input)
    return redirectToWhatsAppBusiness(redirectOrigin, {
      success: 'true',
      name: result.name,
    })
  } catch (err) {
    const { authErrorCode, authErrorMessage } = getAuthErrorDetails(err)
    console.error('[WhatsApp Auth Callback] Error:', {
      code: authErrorCode,
      knownFlowError: err instanceof WhatsAppAuthFlowError,
    })

    await markAuthStateFailedAfterError(deps, input.state, authErrorCode, authErrorMessage)

    return redirectWithWhatsAppAuthError(redirectOrigin, authErrorCode, authErrorMessage)
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const input = buildInputFromBody(body)
  const supabase = createAdminClient() as unknown as WhatsAppBindingAdminClient
  const deps = createCompletionDependencies(supabase)

  if (!isWhatsAppInboxEnabledServer()) {
    await markDisabledAuthState(deps, input.state)

    return NextResponse.json(
      {
        success: false,
        code: 'disabled',
        error: 'WhatsApp Inbox is disabled.',
        diagnostics: completionDiagnostics(input),
      },
      { status: 503 }
    )
  }

  try {
    const result = await completeWhatsAppAuthorization(deps, input)
    return NextResponse.json({
      success: true,
      redirectUrl: '/whatsapp-business?success=true',
      diagnostics: completionDiagnostics(input, result),
    })
  } catch (err) {
    const { authErrorCode, authErrorMessage } = getAuthErrorDetails(err)
    console.error('[WhatsApp Auth Callback] POST Error:', {
      code: authErrorCode,
      knownFlowError: err instanceof WhatsAppAuthFlowError,
    })

    await markAuthStateFailedAfterError(deps, input.state, authErrorCode, authErrorMessage)

    return NextResponse.json(
      {
        success: false,
        code: authErrorCode,
        error: authErrorMessage,
        diagnostics: completionDiagnostics(input),
      },
      { status: callbackErrorStatus(authErrorCode) }
    )
  }
}
