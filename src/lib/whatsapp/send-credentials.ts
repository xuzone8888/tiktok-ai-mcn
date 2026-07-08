import { getWhatsAppCloudConfig, getWhatsAppGraphApiVersion } from '@/lib/whatsapp/cloud-api'

type SupabaseError = { message: string }

interface WhatsAppBusinessAccountRow {
  id: string
  phone_number_id: string
  binding_source: string
  status: string
}

interface WhatsAppBusinessTokenRow {
  account_id: string
  access_token: string | null
  access_token_expires_at: string | null
}

interface SupabaseQueryBuilder<T> {
  select(columns: string): SupabaseQueryBuilder<T>
  eq(column: string, value: unknown): SupabaseQueryBuilder<T>
  maybeSingle(): Promise<{ data: T | null; error: SupabaseError | null }>
  order(column: string, options: { ascending: boolean }): Promise<{ data: T[] | null; error: SupabaseError | null }>
}

export interface WhatsAppSendCredentialClient {
  from(table: 'whatsapp_business_accounts'): SupabaseQueryBuilder<WhatsAppBusinessAccountRow>
  from(table: 'whatsapp_business_account_tokens'): SupabaseQueryBuilder<WhatsAppBusinessTokenRow>
}

export interface WhatsAppSendCredentials {
  source: 'formal_binding' | 'local_env'
  accountId: string | null
  accessToken: string
  phoneNumberId: string
  apiVersion: string
}

export interface WhatsAppSendCredentialOptions {
  allowLocalEnvFallback?: boolean
}

export class WhatsAppSendCredentialError extends Error {
  code: string
  httpStatus: number

  constructor(message: string, code: string, httpStatus = 409) {
    super(message)
    this.name = 'WhatsAppSendCredentialError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

function isFormalBinding(account: WhatsAppBusinessAccountRow) {
  return account.status === 'active'
    && (account.binding_source === 'embedded_signup' || account.binding_source === 'facebook_login_for_business')
}

function isTokenExpired(expiresAt: string | null) {
  if (!expiresAt) return false
  const timestamp = new Date(expiresAt).getTime()
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

function resolveEnvFallbackCredentials(): WhatsAppSendCredentials {
  const config = getWhatsAppCloudConfig()
  return {
    source: 'local_env',
    accountId: null,
    accessToken: config.accessToken,
    phoneNumberId: config.phoneNumberId,
    apiVersion: config.apiVersion,
  }
}

export async function resolveWhatsAppSendCredentials(
  supabase: WhatsAppSendCredentialClient,
  userId: string,
  options: WhatsAppSendCredentialOptions = {}
): Promise<WhatsAppSendCredentials> {
  const { data: accounts, error: accountsError } = await supabase
    .from('whatsapp_business_accounts')
    .select('id, phone_number_id, binding_source, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (accountsError) {
    throw new WhatsAppSendCredentialError(
      `查询 WhatsApp Business 绑定失败: ${accountsError.message}`,
      'WHATSAPP_BINDING_LOOKUP_FAILED',
      500
    )
  }

  const formalAccounts = (accounts || []).filter(isFormalBinding)

  if (formalAccounts.length === 0) {
    if (options.allowLocalEnvFallback) {
      return resolveEnvFallbackCredentials()
    }

    throw new WhatsAppSendCredentialError(
      '当前账号没有 active WhatsApp Business 正式绑定，已阻止 env fallback 以避免错号发送。',
      'WHATSAPP_FORMAL_BINDING_REQUIRED',
      409
    )
  }

  if (formalAccounts.length > 1) {
    throw new WhatsAppSendCredentialError(
      '当前账号存在多个 active WhatsApp Business 号码，首版暂不支持多号码发送。请先保留一个 active 绑定，避免错号发送。',
      'WHATSAPP_MULTIPLE_FORMAL_BINDINGS',
      409
    )
  }

  const account = formalAccounts[0]
  const { data: token, error: tokenError } = await supabase
    .from('whatsapp_business_account_tokens')
    .select('account_id, access_token, access_token_expires_at')
    .eq('account_id', account.id)
    .maybeSingle()

  if (tokenError) {
    throw new WhatsAppSendCredentialError(
      `查询 WhatsApp Business token 失败: ${tokenError.message}`,
      'WHATSAPP_TOKEN_LOOKUP_FAILED',
      500
    )
  }

  if (!token?.access_token) {
    throw new WhatsAppSendCredentialError(
      '当前 WhatsApp Business 正式绑定缺少可用 token，已阻止 env fallback 以避免错号发送。',
      'WHATSAPP_FORMAL_TOKEN_MISSING',
      409
    )
  }

  if (isTokenExpired(token.access_token_expires_at)) {
    throw new WhatsAppSendCredentialError(
      '当前 WhatsApp Business 正式绑定 token 已过期，已阻止 env fallback 以避免错号发送。',
      'WHATSAPP_FORMAL_TOKEN_EXPIRED',
      409
    )
  }

  return {
    source: 'formal_binding',
    accountId: account.id,
    accessToken: token.access_token,
    phoneNumberId: account.phone_number_id,
    apiVersion: getWhatsAppGraphApiVersion(),
  }
}
