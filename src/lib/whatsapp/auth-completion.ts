export type SupabaseError = { message: string }

export interface WhatsAppAuthStateRow {
  user_id: string
  code_verifier: string | null
  expires_at: string
  status: 'pending' | 'completed' | 'failed' | 'expired'
}

export interface WhatsAppBusinessAccountRow {
  id: string
  user_id: string | null
  phone_number_id: string | null
  binding_source: string | null
  status: string | null
  display_phone_number: string | null
  verified_name: string | null
  business_portfolio_id?: string | null
  business_portfolio_name?: string | null
  onboarding_mode?: string | null
  webhook_status?: string | null
  messaging_status?: string | null
}

export interface WhatsAppAuthCompletionHints {
  businessAccountId?: string | null
  businessPortfolioId?: string | null
  businessPortfolioName?: string | null
  phoneNumberId?: string | null
  displayPhoneNumber?: string | null
  verifiedName?: string | null
}

export interface WhatsAppAuthCompletionInput {
  code: string | null
  state: string | null
  error?: string | null
  errorDescription?: string | null
  callbackGrantedScopes?: string | null
  hints: WhatsAppAuthCompletionHints
}

export interface WhatsAppAuthCompletionSuccess {
  name: string
  discoveredPhoneNumberCount: number
  requiredGrantsPresent: boolean
  missingRequiredGrantNames: string[]
}

export interface WhatsAppBusinessTokenResponse {
  access_token: string
  expires_in?: number
  scope?: string
  token_type?: string
}

export interface WhatsAppBusinessPhoneNumber {
  phoneNumberId: string
  businessAccountId: string
  businessAccountName: string | null
  businessPortfolioId: string | null
  businessPortfolioName: string | null
  displayPhoneNumber: string | null
  verifiedName: string | null
}

export interface WhatsAppGrantedScopesResult {
  scopes: string[]
  diagnostics: {
    requiredGrantsPresent: boolean
    missingRequiredGrantNames: string[]
    hasTokenResponseScopes?: boolean
    hasDebugTokenScopes?: boolean
    hasGranularScopes?: boolean
  }
}

export interface SavedWhatsAppBusinessAccount {
  id: string
  display_phone_number: string | null
  verified_name: string | null
}

export interface WhatsAppAuthCompletionDependencies {
  getAuthState(state: string): Promise<{ data: WhatsAppAuthStateRow | null; error: SupabaseError | null }>
  updateAuthState(state: string, values: Record<string, unknown>, context: string): Promise<void>
  tryUpdateAuthState(state: string, values: Record<string, unknown>, context: string): Promise<boolean>
  findAccountByPhoneNumber(phoneNumberId: string): Promise<WhatsAppBusinessAccountRow | null>
  listActiveAccountsForUser(userId: string): Promise<WhatsAppBusinessAccountRow[]>
  upsertBusinessAccount(values: Record<string, unknown>): Promise<SavedWhatsAppBusinessAccount>
  markBusinessAccountDisabled(accountId: string, now: string, context: string): Promise<void>
  markBusinessAccountActive(accountId: string, now: string): Promise<void>
  upsertToken(values: Record<string, unknown>): Promise<void>
  exchangeCodeForToken(code: string, codeVerifier?: string | null): Promise<WhatsAppBusinessTokenResponse>
  exchangeLongLivedToken(accessToken: string): Promise<WhatsAppBusinessTokenResponse>
  resolveGrantedScopes(
    accessToken: string,
    ...tokenScopeValues: Array<string | undefined>
  ): Promise<WhatsAppGrantedScopesResult>
  calculateTokenExpiration(expiresIn?: number): Date | null
  discoverPhoneNumbers(accessToken: string, hints: WhatsAppAuthCompletionHints): Promise<WhatsAppBusinessPhoneNumber[]>
  logInfo(message: string, values: Record<string, unknown>): void
  logError(message: string, values: unknown): void
}

export const WHATSAPP_AUTH_ERROR_MESSAGES = {
  WHATSAPP_REQUIRED_SCOPES_MISSING: 'Meta 授权缺少 WhatsApp Business 必需权限，请重新进入绑定流程并确认授权。',
  WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE: '未完成 WhatsApp 号码绑定/验证，请重新进入 Embedded Signup 并完成全部步骤。',
  WHATSAPP_NO_PHONE_DISCOVERED: 'Meta 授权已完成，但没有完成 WhatsApp Business 号码选择/验证。请重新进入 Embedded Signup 并完成 WABA 与手机号设置。',
  WHATSAPP_PHONE_ALREADY_BOUND: '这个 WhatsApp 号码已经绑定到另一个账号，请更换号码或联系管理员解绑。',
  WHATSAPP_META_AUTH_CANCELLED: 'Meta 授权已取消，请重新进入绑定流程。',
  WHATSAPP_AUTH_STATE_INVALID: 'WhatsApp Business 授权状态无效，请重新开始绑定。',
  WHATSAPP_AUTH_STATE_EXPIRED: 'WhatsApp Business 授权已过期，请重新开始绑定。',
} as const

export type WhatsAppAuthErrorCode = keyof typeof WHATSAPP_AUTH_ERROR_MESSAGES

export class WhatsAppAuthFlowError extends Error {
  code: WhatsAppAuthErrorCode

  constructor(code: WhatsAppAuthErrorCode, message: string = WHATSAPP_AUTH_ERROR_MESSAGES[code]) {
    super(message)
    this.name = 'WhatsAppAuthFlowError'
    this.code = code
  }
}

const REQUIRED_WHATSAPP_BUSINESS_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
]

function hasRequiredWhatsAppBusinessScopes(scopes: string[]) {
  return REQUIRED_WHATSAPP_BUSINESS_SCOPES.every((scope) => scopes.includes(scope))
}

function logCallbackParameterDiagnostics(deps: WhatsAppAuthCompletionDependencies, input: WhatsAppAuthCompletionInput) {
  deps.logInfo('[WhatsApp Auth Callback] Embedded Signup callback diagnostics:', {
    hasCode: Boolean(input.code),
    hasBusinessAccountHint: Boolean(input.hints.businessAccountId),
    hasPhoneNumberHint: Boolean(input.hints.phoneNumberId),
  })
}

function logDiscoveryDiagnostics(
  deps: WhatsAppAuthCompletionDependencies,
  input: WhatsAppAuthCompletionInput,
  phoneNumberCount: number,
  grantDiagnostics: {
    requiredGrantsPresent: boolean
    missingRequiredGrantNames: string[]
  }
) {
  deps.logInfo('[WhatsApp Auth Callback] Embedded Signup discovery diagnostics:', {
    hasCode: Boolean(input.code),
    hasBusinessAccountHint: Boolean(input.hints.businessAccountId),
    hasPhoneNumberHint: Boolean(input.hints.phoneNumberId),
    discoveredPhoneNumberCount: phoneNumberCount,
    requiredGrantsPresent: grantDiagnostics.requiredGrantsPresent,
    missingRequiredGrantNames: grantDiagnostics.missingRequiredGrantNames,
  })
}

function isFormalBinding(account: WhatsAppBusinessAccountRow) {
  return account.status === 'active'
    && (account.binding_source === 'embedded_signup' || account.binding_source === 'facebook_login_for_business')
}

async function assertPhoneNumberNotOwnedByAnotherUser(
  deps: WhatsAppAuthCompletionDependencies,
  userId: string,
  phoneNumberId: string
) {
  const account = await deps.findAccountByPhoneNumber(phoneNumberId)

  if (account?.user_id && account.user_id !== userId) {
    throw new WhatsAppAuthFlowError('WHATSAPP_PHONE_ALREADY_BOUND')
  }
}

async function assertUserCanHaveSingleActiveFormalPhone(
  deps: WhatsAppAuthCompletionDependencies,
  userId: string,
  phoneNumberId: string
) {
  const activeAccounts = await deps.listActiveAccountsForUser(userId)
  const otherActiveFormalAccount = activeAccounts
    .filter(isFormalBinding)
    .find((account) => account.phone_number_id !== phoneNumberId)

  if (otherActiveFormalAccount) {
    throw new Error('首版只支持每个用户绑定一个 active WhatsApp Business 号码。请先停用现有号码后再绑定新号码。')
  }
}

export function getAuthErrorDetails(err: unknown) {
  const authErrorCode: WhatsAppAuthErrorCode = err instanceof WhatsAppAuthFlowError
    ? err.code
    : 'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
  const authErrorMessage = err instanceof WhatsAppAuthFlowError
    ? err.message
    : 'WhatsApp Business 绑定未完成，请重新进入 Embedded Signup 并完成 WABA 与手机号设置。'
  return { authErrorCode, authErrorMessage }
}

export async function markAuthStateFailedAfterError(
  deps: Pick<WhatsAppAuthCompletionDependencies, 'tryUpdateAuthState'>,
  state: string | null,
  authErrorCode: WhatsAppAuthErrorCode,
  authErrorMessage: string
) {
  if (!state) return

  await deps.tryUpdateAuthState(
    state,
    {
      status: authErrorCode === 'WHATSAPP_AUTH_STATE_EXPIRED' ? 'expired' : 'failed',
      error_code: authErrorCode,
      error_message: authErrorMessage,
      code_verifier: null,
      completed_at: new Date().toISOString(),
    },
    'Mark callback failure state failed'
  )
}

export function callbackErrorStatus(code: WhatsAppAuthErrorCode) {
  if (code === 'WHATSAPP_AUTH_STATE_INVALID' || code === 'WHATSAPP_AUTH_STATE_EXPIRED') return 400
  if (code === 'WHATSAPP_REQUIRED_SCOPES_MISSING') return 403
  if (code === 'WHATSAPP_PHONE_ALREADY_BOUND') return 409
  return 422
}

export function completionDiagnostics(input: WhatsAppAuthCompletionInput, result?: WhatsAppAuthCompletionSuccess) {
  return {
    hasCode: Boolean(input.code),
    hasBusinessAccountHint: Boolean(input.hints.businessAccountId),
    hasPhoneNumberHint: Boolean(input.hints.phoneNumberId),
    discoveredPhoneNumberCount: result?.discoveredPhoneNumberCount ?? 0,
    requiredGrantsPresent: result?.requiredGrantsPresent ?? false,
    missingRequiredGrantNames: result?.missingRequiredGrantNames ?? [],
  }
}

export async function completeWhatsAppAuthorization(
  deps: WhatsAppAuthCompletionDependencies,
  input: WhatsAppAuthCompletionInput
): Promise<WhatsAppAuthCompletionSuccess> {
  const { code, state, error, errorDescription, callbackGrantedScopes, hints } = input

  if (!state) {
    throw new WhatsAppAuthFlowError('WHATSAPP_AUTH_STATE_INVALID')
  }

  if (!code && !error) {
    throw new WhatsAppAuthFlowError('WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE')
  }

  logCallbackParameterDiagnostics(deps, input)

  const { data: authState, error: stateError } = await deps.getAuthState(state)

  if (stateError || !authState) {
    throw new WhatsAppAuthFlowError('WHATSAPP_AUTH_STATE_INVALID')
  }

  if (authState.status !== 'pending') {
    throw new WhatsAppAuthFlowError('WHATSAPP_AUTH_STATE_INVALID')
  }

  if (error) {
    await deps.updateAuthState(
      state,
      {
        status: 'failed',
        error_code: 'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE',
        error_message: errorDescription || WHATSAPP_AUTH_ERROR_MESSAGES.WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE,
        code_verifier: null,
        completed_at: new Date().toISOString(),
      },
      'Mark Meta auth error state failed'
    )

    throw new WhatsAppAuthFlowError('WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE')
  }

  if (new Date(authState.expires_at).getTime() <= Date.now()) {
    await deps.updateAuthState(
      state,
      {
        status: 'expired',
        error_code: 'WHATSAPP_AUTH_STATE_EXPIRED',
        error_message: WHATSAPP_AUTH_ERROR_MESSAGES.WHATSAPP_AUTH_STATE_EXPIRED,
        code_verifier: null,
      },
      'Mark expired auth state failed'
    )

    throw new WhatsAppAuthFlowError('WHATSAPP_AUTH_STATE_EXPIRED')
  }

  if (!code) {
    throw new WhatsAppAuthFlowError('WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE')
  }

  const shortToken = await deps.exchangeCodeForToken(code, authState.code_verifier)
  const token = await deps.exchangeLongLivedToken(shortToken.access_token).catch(() => shortToken)
  const grantedScopes = await deps.resolveGrantedScopes(
    token.access_token,
    token.scope,
    shortToken.scope,
    callbackGrantedScopes || undefined
  )
  const scopes = grantedScopes.scopes
  deps.logInfo('[WhatsApp Auth Callback] Granted scope diagnostics:', {
    ...grantedScopes.diagnostics,
    hasCallbackGrantedScopes: Boolean(callbackGrantedScopes),
  })
  if (!hasRequiredWhatsAppBusinessScopes(scopes)) {
    throw new WhatsAppAuthFlowError('WHATSAPP_REQUIRED_SCOPES_MISSING')
  }

  const expiresAt = deps.calculateTokenExpiration(token.expires_in || shortToken.expires_in)?.toISOString() || null
  const phoneNumbers = await deps.discoverPhoneNumbers(token.access_token, {
    businessAccountId: hints.businessAccountId,
    businessPortfolioId: hints.businessPortfolioId,
    businessPortfolioName: hints.businessPortfolioName,
    phoneNumberId: hints.phoneNumberId,
    displayPhoneNumber: hints.displayPhoneNumber,
    verifiedName: hints.verifiedName,
  })
  logDiscoveryDiagnostics(deps, input, phoneNumbers.length, grantedScopes.diagnostics)

  if (phoneNumbers.length === 0) {
    throw new WhatsAppAuthFlowError('WHATSAPP_NO_PHONE_DISCOVERED')
  }

  if (phoneNumbers.length > 1) {
    throw new Error('首版只支持单号码绑定。Meta 返回了多个 WhatsApp Business 号码，请先在 Meta 流程中明确选择一个号码后重试。')
  }

  const now = new Date().toISOString()
  const phone = phoneNumbers[0]

  await assertPhoneNumberNotOwnedByAnotherUser(deps, authState.user_id, phone.phoneNumberId)
  await assertUserCanHaveSingleActiveFormalPhone(deps, authState.user_id, phone.phoneNumberId)

  const savedAccount = await deps.upsertBusinessAccount({
    user_id: authState.user_id,
    phone_number_id: phone.phoneNumberId,
    business_account_id: phone.businessAccountId,
    business_account_name: phone.businessAccountName,
    business_portfolio_id: phone.businessPortfolioId,
    business_portfolio_name: phone.businessPortfolioName,
    display_phone_number: phone.displayPhoneNumber,
    verified_name: phone.verifiedName,
    source_platform: 'whatsapp_cloud',
    status: 'disabled',
    binding_source: 'embedded_signup',
    onboarding_mode: 'embedded_signup',
    webhook_status: 'mapped',
    messaging_status: 'unknown',
    scopes,
    connected_at: now,
    updated_at: now,
  })

  try {
    await deps.upsertToken({
      account_id: savedAccount.id,
      access_token: token.access_token,
      token_type: token.token_type || shortToken.token_type || null,
      scopes,
      access_token_expires_at: expiresAt,
      updated_at: now,
    })
  } catch (tokenError) {
    await deps.markBusinessAccountDisabled(savedAccount.id, now, 'Disable account after token save failure failed')
    throw tokenError
  }

  await deps.markBusinessAccountActive(savedAccount.id, now)

  try {
    await deps.updateAuthState(
      state,
      {
        status: 'completed',
        code_verifier: null,
        completed_at: now,
      },
      'Mark completed auth state failed'
    )
  } catch (stateUpdateError) {
    await deps.markBusinessAccountDisabled(
      savedAccount.id,
      now,
      'Disable account after completed state failure failed'
    ).catch((disableError) => {
      deps.logError('[WhatsApp Auth Callback] Disable account after completed state failure failed:', disableError)
    })
    throw stateUpdateError
  }

  return {
    name: savedAccount.verified_name || savedAccount.display_phone_number || 'WhatsApp Business 号码',
    discoveredPhoneNumberCount: phoneNumbers.length,
    requiredGrantsPresent: grantedScopes.diagnostics.requiredGrantsPresent,
    missingRequiredGrantNames: grantedScopes.diagnostics.missingRequiredGrantNames,
  }
}
