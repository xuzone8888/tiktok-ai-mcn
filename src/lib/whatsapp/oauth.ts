import crypto from 'crypto'

const DEFAULT_WHATSAPP_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
]

const REQUIRED_WHATSAPP_BUSINESS_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
]

const UNSUPPORTED_EMBEDDED_SIGNUP_SCOPES = new Set([
  'business_management',
])

const FACEBOOK_AUTH_URL = (apiVersion: string) => `https://www.facebook.com/${apiVersion}/dialog/oauth`
const GRAPH_API_URL = (apiVersion: string) => `https://graph.facebook.com/${apiVersion}`

export interface WhatsAppBusinessOAuthConfig {
  appId: string
  appSecret: string
  redirectUri: string
  apiVersion: string
  configId: string
  scopes: string[]
  ignoredUnsupportedScopes: string[]
  extras: string | null
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

interface WhatsAppTokenDebugInfo {
  isValid: boolean | null
  scopes: string[]
  granularScopes: Array<{
    scope: string
    targetIds: string[]
  }>
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function getRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function getNestedDataArray(value: unknown): JsonRecord[] {
  return isRecord(value) ? getRecordArray(value.data) : []
}

function splitScopes(value: string | undefined) {
  return (value || '')
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function uniqueScopes(scopes: string[]) {
  return Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean)))
}

function assertRequiredRequestedWhatsAppScopes(scopes: string[]) {
  const missingScopes = REQUIRED_WHATSAPP_BUSINESS_SCOPES.filter((scope) => !scopes.includes(scope))
  if (missingScopes.length > 0) {
    throw new Error(`WhatsApp Business binding configuration is incomplete. WHATSAPP_EMBEDDED_SIGNUP_SCOPES must include ${missingScopes.join(', ')}.`)
  }
}

export function hasRequiredWhatsAppBusinessScopes(scopes: string[]) {
  return REQUIRED_WHATSAPP_BUSINESS_SCOPES.every((scope) => scopes.includes(scope))
}

function getMissingRequiredWhatsAppBusinessScopes(scopes: string[]) {
  return REQUIRED_WHATSAPP_BUSINESS_SCOPES.filter((scope) => !scopes.includes(scope))
}

export function getWhatsAppBusinessOAuthConfig(): WhatsAppBusinessOAuthConfig {
  const appId = process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_ID
  const appSecret = process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET
  const redirectUri = process.env.WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI
  const apiVersion = process.env.WHATSAPP_API_VERSION || process.env.FACEBOOK_API_VERSION || 'v20.0'
  const configId = process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
  const envScopes = splitScopes(process.env.WHATSAPP_EMBEDDED_SIGNUP_SCOPES)

  if (!appId || !appSecret || !redirectUri || !configId) {
    throw new Error('WhatsApp Business binding configuration is incomplete. Please set WHATSAPP_EMBEDDED_SIGNUP_APP_ID, WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET, WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI, and WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID.')
  }

  const requestedScopes = uniqueScopes(envScopes.length > 0 ? envScopes : DEFAULT_WHATSAPP_SCOPES)
  const ignoredUnsupportedScopes = requestedScopes.filter((scope) => UNSUPPORTED_EMBEDDED_SIGNUP_SCOPES.has(scope))
  const scopes = requestedScopes.filter((scope) => !UNSUPPORTED_EMBEDDED_SIGNUP_SCOPES.has(scope))
  assertRequiredRequestedWhatsAppScopes(scopes)

  return {
    appId,
    appSecret,
    redirectUri,
    apiVersion,
    configId,
    scopes,
    ignoredUnsupportedScopes,
    extras: process.env.WHATSAPP_EMBEDDED_SIGNUP_EXTRAS || null,
  }
}

export function generateWhatsAppPKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

export function generateWhatsAppState(userId: string): string {
  return `${crypto.randomBytes(16).toString('hex')}_${userId}`
}

export function buildWhatsAppBusinessAuthorizationUrl(userId: string): {
  authUrl: string
  state: string
  codeVerifier: string
  diagnostics: {
    auth_url_has_config_id: boolean
    auth_url_has_scope: boolean
    launch_config_has_redirect_uri: boolean
    requested_scopes_include_business_management: boolean
    requested_scopes_include_whatsapp_business_management: boolean
    requested_scopes_include_whatsapp_business_messaging: boolean
    requested_scope_count: number
    ignoredUnsupportedScopes: string[]
  }
} {
  const config = getWhatsAppBusinessOAuthConfig()
  const { codeVerifier, codeChallenge } = generateWhatsAppPKCE()
  const state = generateWhatsAppState(userId)
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    state,
    auth_type: 'rerequest',
    return_scopes: 'true',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: config.scopes.join(','),
  })

  params.set('config_id', config.configId)

  if (config.extras) {
    params.set('extras', config.extras)
  }

  return {
    authUrl: `${FACEBOOK_AUTH_URL(config.apiVersion)}?${params.toString()}`,
    state,
    codeVerifier,
    diagnostics: {
      auth_url_has_config_id: params.has('config_id'),
      auth_url_has_scope: params.has('scope'),
      launch_config_has_redirect_uri: Boolean(config.redirectUri),
      requested_scopes_include_business_management: config.scopes.includes('business_management'),
      requested_scopes_include_whatsapp_business_management: config.scopes.includes('whatsapp_business_management'),
      requested_scopes_include_whatsapp_business_messaging: config.scopes.includes('whatsapp_business_messaging'),
      requested_scope_count: config.scopes.length,
      ignoredUnsupportedScopes: config.ignoredUnsupportedScopes,
    },
  }
}

export function buildWhatsAppEmbeddedSignupLaunchConfig(userId: string): {
  state: string
  codeVerifier: null
  launchConfig: {
    appId: string
    apiVersion: string
    configId: string
    scopes: string[]
    extras: string | null
    state: string
    redirectUri: string
  }
  diagnostics: {
    launch_mode: 'js_sdk_embedded_signup'
    auth_url_has_config_id: boolean
    auth_url_has_scope: boolean
    launch_config_has_redirect_uri: boolean
    requested_scopes_include_business_management: boolean
    requested_scopes_include_whatsapp_business_management: boolean
    requested_scopes_include_whatsapp_business_messaging: boolean
    requested_scope_count: number
    ignoredUnsupportedScopes: string[]
  }
} {
  const config = getWhatsAppBusinessOAuthConfig()
  const state = generateWhatsAppState(userId)

  return {
    state,
    codeVerifier: null,
    launchConfig: {
      appId: config.appId,
      apiVersion: config.apiVersion,
      configId: config.configId,
      scopes: config.scopes,
      extras: config.extras,
      state,
      redirectUri: config.redirectUri,
    },
    diagnostics: {
      launch_mode: 'js_sdk_embedded_signup',
      auth_url_has_config_id: Boolean(config.configId),
      auth_url_has_scope: config.scopes.length > 0,
      launch_config_has_redirect_uri: Boolean(config.redirectUri),
      requested_scopes_include_business_management: config.scopes.includes('business_management'),
      requested_scopes_include_whatsapp_business_management: config.scopes.includes('whatsapp_business_management'),
      requested_scopes_include_whatsapp_business_messaging: config.scopes.includes('whatsapp_business_messaging'),
      requested_scope_count: config.scopes.length,
      ignoredUnsupportedScopes: config.ignoredUnsupportedScopes,
    },
  }
}

export async function isWhatsAppRedirectTunnelReachable(timeoutMs = 3000): Promise<boolean> {
  const { redirectUri } = getWhatsAppBusinessOAuthConfig()
  const redirectUrl = new URL(redirectUri)

  if (!redirectUrl.hostname.endsWith('.trycloudflare.com')) {
    return true
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    await fetch(redirectUri, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function readWhatsAppBusinessApiError(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as JsonRecord | null
  const error = isRecord(data?.error) ? data.error : null
  return getStringValue(error?.message)
    || getStringValue(data?.error_description)
    || getStringValue(data?.error)
    || response.statusText
}

async function postGraphForm(apiVersion: string, path: string, params: URLSearchParams): Promise<Response> {
  return fetch(`${GRAPH_API_URL(apiVersion)}/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
}

export async function exchangeWhatsAppCodeForToken(code: string, codeVerifier?: string | null): Promise<WhatsAppBusinessTokenResponse> {
  const config = getWhatsAppBusinessOAuthConfig()
  const params = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code,
    redirect_uri: config.redirectUri,
  })

  if (codeVerifier) {
    params.set('code_verifier', codeVerifier)
  }

  const response = await postGraphForm(config.apiVersion, 'oauth/access_token', params)
  if (!response.ok) {
    throw new Error(`WhatsApp Business OAuth token exchange failed: ${await readWhatsAppBusinessApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!data || typeof data.access_token !== 'string') {
    throw new Error('WhatsApp Business OAuth token exchange returned an invalid response.')
  }

  return data as unknown as WhatsAppBusinessTokenResponse
}

export async function exchangeForLongLivedWhatsAppToken(accessToken: string): Promise<WhatsAppBusinessTokenResponse> {
  const config = getWhatsAppBusinessOAuthConfig()
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: config.appId,
    client_secret: config.appSecret,
    fb_exchange_token: accessToken,
  })

  const response = await postGraphForm(config.apiVersion, 'oauth/access_token', params)
  if (!response.ok) {
    throw new Error(`WhatsApp Business long-lived token exchange failed: ${await readWhatsAppBusinessApiError(response)}`)
  }

  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!data || typeof data.access_token !== 'string') {
    throw new Error('WhatsApp Business long-lived token exchange returned an invalid response.')
  }

  return data as unknown as WhatsAppBusinessTokenResponse
}

async function debugWhatsAppBusinessToken(accessToken: string): Promise<WhatsAppTokenDebugInfo | null> {
  const config = getWhatsAppBusinessOAuthConfig()
  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: `${config.appId}|${config.appSecret}`,
  })

  const response = await fetch(`${GRAPH_API_URL(config.apiVersion)}/debug_token?${params.toString()}`)
  if (!response.ok) {
    return null
  }

  const data = await response.json().catch(() => null)
  const tokenData = isRecord(data) && isRecord(data.data) ? data.data : {}
  const scopes = Array.isArray(tokenData.scopes) ? tokenData.scopes.map(String) : []
  const granularScopes = getRecordArray(tokenData.granular_scopes)
    .filter((entry) => typeof entry.scope === 'string')
    .map((entry) => ({
      scope: String(entry.scope),
      targetIds: Array.isArray(entry.target_ids) ? entry.target_ids.map(String) : [],
    }))

  return {
    isValid: typeof tokenData.is_valid === 'boolean' ? tokenData.is_valid : null,
    scopes,
    granularScopes,
  }
}

async function graphGet(path: string, accessToken: string, params: Record<string, string> = {}): Promise<unknown> {
  const config = getWhatsAppBusinessOAuthConfig()
  const query = new URLSearchParams(params)
  const response = await fetch(`${GRAPH_API_URL(config.apiVersion)}/${path.replace(/^\//, '')}?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!response.ok) {
    throw new Error(await readWhatsAppBusinessApiError(response))
  }
  return response.json().catch(() => null)
}

async function getPhoneNumbersForWaba(
  accessToken: string,
  wabaId: string,
  businessAccountName: string | null,
  businessPortfolioId: string | null = null,
  businessPortfolioName: string | null = null
): Promise<WhatsAppBusinessPhoneNumber[]> {
  const data = await graphGet(`${encodeURIComponent(wabaId)}/phone_numbers`, accessToken, {
    fields: 'id,display_phone_number,verified_name',
  })
  const phones = getNestedDataArray(data)
  return phones
    .filter((phone) => typeof phone.id === 'string')
    .map((phone) => ({
      phoneNumberId: String(phone.id),
      businessAccountId: wabaId,
      businessAccountName,
      businessPortfolioId,
      businessPortfolioName,
      displayPhoneNumber: getStringValue(phone.display_phone_number),
      verifiedName: getStringValue(phone.verified_name),
    }))
}

async function getPhoneNumbersForBusiness(
  accessToken: string,
  businessId: string
): Promise<WhatsAppBusinessPhoneNumber[]> {
  const data = await graphGet(businessId, accessToken, {
    fields: 'id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}},client_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}',
  })
  if (!isRecord(data)) return []

  const businessPortfolioId = getStringValue(data.id)
  const businessPortfolioName = getStringValue(data.name)
  const wabas = [
    ...getNestedDataArray(data.owned_whatsapp_business_accounts),
    ...getNestedDataArray(data.client_whatsapp_business_accounts),
  ]
  const accounts: WhatsAppBusinessPhoneNumber[] = []

  for (const waba of wabas) {
    const businessAccountId = getStringValue(waba.id) || ''
    if (!businessAccountId) continue
    const businessAccountName = getStringValue(waba.name) || businessPortfolioName
    const phones = getNestedDataArray(waba.phone_numbers)
    for (const phone of phones) {
      if (typeof phone.id !== 'string') continue
      accounts.push({
        phoneNumberId: String(phone.id),
        businessAccountId,
        businessAccountName,
        businessPortfolioId,
        businessPortfolioName,
        displayPhoneNumber: getStringValue(phone.display_phone_number),
        verifiedName: getStringValue(phone.verified_name),
      })
    }
  }

  return accounts
}

async function discoverFromBusinesses(accessToken: string): Promise<WhatsAppBusinessPhoneNumber[]> {
  const data = await graphGet('me/businesses', accessToken, {
    fields: 'id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}},client_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}',
    limit: '100',
  })
  const businesses = getNestedDataArray(data)
  const accounts: WhatsAppBusinessPhoneNumber[] = []

  for (const business of businesses) {
    const wabas = [
      ...getNestedDataArray(business.owned_whatsapp_business_accounts),
      ...getNestedDataArray(business.client_whatsapp_business_accounts),
    ]

    for (const waba of wabas) {
      const businessAccountId = getStringValue(waba.id) || ''
      if (!businessAccountId) continue
      const businessPortfolioId = getStringValue(business.id)
      const businessPortfolioName = getStringValue(business.name)
      const businessAccountName = getStringValue(waba.name) || getStringValue(business.name)
      const phones = getNestedDataArray(waba.phone_numbers)
      for (const phone of phones) {
        if (typeof phone.id !== 'string') continue
        accounts.push({
          phoneNumberId: String(phone.id),
          businessAccountId,
          businessAccountName,
          businessPortfolioId,
          businessPortfolioName,
          displayPhoneNumber: getStringValue(phone.display_phone_number),
          verifiedName: getStringValue(phone.verified_name),
        })
      }
    }
  }

  return accounts
}

function dedupePhoneNumbers(accounts: WhatsAppBusinessPhoneNumber[]) {
  const byPhoneNumberId = new Map<string, WhatsAppBusinessPhoneNumber>()

  for (const account of accounts) {
    const current = byPhoneNumberId.get(account.phoneNumberId)
    if (!current) {
      byPhoneNumberId.set(account.phoneNumberId, account)
      continue
    }

    byPhoneNumberId.set(account.phoneNumberId, {
      ...current,
      businessAccountName: current.businessAccountName || account.businessAccountName,
      businessPortfolioId: current.businessPortfolioId || account.businessPortfolioId,
      businessPortfolioName: current.businessPortfolioName || account.businessPortfolioName,
      displayPhoneNumber: current.displayPhoneNumber || account.displayPhoneNumber,
      verifiedName: current.verifiedName || account.verifiedName,
    })
  }

  return Array.from(byPhoneNumberId.values())
}

export function calculateWhatsAppTokenExpiration(expiresIn?: number): Date | null {
  if (!expiresIn) return null
  return new Date(Date.now() + expiresIn * 1000)
}

export function scopesToArray(scope: string | undefined): string[] {
  return scope ? uniqueScopes(scope.split(/[,\s]+/)) : []
}

export async function resolveWhatsAppGrantedScopes(
  accessToken: string,
  ...tokenScopeValues: Array<string | undefined>
): Promise<{
  scopes: string[]
  source: 'combined' | 'token_response' | 'debug_token' | 'unknown'
  diagnostics: {
    hasTokenResponseScopes: boolean
    hasDebugTokenScopes: boolean
    hasGranularScopes: boolean
    requiredGrantsPresent: boolean
    missingRequiredGrantNames: string[]
  }
}> {
  const tokenScopes = uniqueScopes(tokenScopeValues.flatMap((value) => scopesToArray(value)))
  const debugInfo = await debugWhatsAppBusinessToken(accessToken).catch(() => null)
  const debugDataScopes = uniqueScopes(debugInfo?.scopes || [])
  const granularScopes = uniqueScopes((debugInfo?.granularScopes || []).map((scope) => scope.scope))
  const scopes = uniqueScopes([
    ...tokenScopes,
    ...debugDataScopes,
    ...granularScopes,
  ])
  const hasTokenResponseScopes = tokenScopes.length > 0
  const hasDebugTokenScopes = debugDataScopes.length > 0
  const hasGranularScopes = granularScopes.length > 0
  const hasAnyDebugScopes = hasDebugTokenScopes || hasGranularScopes
  const missingRequiredGrantNames = getMissingRequiredWhatsAppBusinessScopes(scopes)
  const requiredGrantsPresent = missingRequiredGrantNames.length === 0
  let source: 'combined' | 'token_response' | 'debug_token' | 'unknown' = 'unknown'
  if (hasTokenResponseScopes && hasAnyDebugScopes) {
    source = 'combined'
  } else if (hasAnyDebugScopes) {
    source = 'debug_token'
  } else if (hasTokenResponseScopes) {
    source = 'token_response'
  }

  return {
    scopes,
    source,
    diagnostics: {
      hasTokenResponseScopes,
      hasDebugTokenScopes,
      hasGranularScopes,
      requiredGrantsPresent,
      missingRequiredGrantNames,
    },
  }
}

export async function discoverWhatsAppBusinessPhoneNumbers(
  accessToken: string,
  hints?: {
    businessAccountId?: string | null
    businessPortfolioId?: string | null
    businessPortfolioName?: string | null
    phoneNumberId?: string | null
    displayPhoneNumber?: string | null
    verifiedName?: string | null
  }
): Promise<WhatsAppBusinessPhoneNumber[]> {
  const accounts: WhatsAppBusinessPhoneNumber[] = []

  if (hints?.businessAccountId) {
    try {
      const phones = await getPhoneNumbersForWaba(
        accessToken,
        hints.businessAccountId,
        null,
        hints.businessPortfolioId || null,
        hints.businessPortfolioName || null
      )
      accounts.push(...(hints.phoneNumberId ? phones.filter((phone) => phone.phoneNumberId === hints.phoneNumberId) : phones))
    } catch {
      if (hints.phoneNumberId) {
        accounts.push({
          phoneNumberId: hints.phoneNumberId,
          businessAccountId: hints.businessAccountId,
          businessAccountName: null,
          businessPortfolioId: hints.businessPortfolioId || null,
          businessPortfolioName: hints.businessPortfolioName || null,
          displayPhoneNumber: hints.displayPhoneNumber || null,
          verifiedName: hints.verifiedName || null,
        })
      }
    }
  }

  const debugInfo = await debugWhatsAppBusinessToken(accessToken)
  const targetIds = new Set<string>()
  for (const granularScope of debugInfo?.granularScopes || []) {
    if (granularScope.scope.startsWith('whatsapp_') || granularScope.scope === 'business_management') {
      granularScope.targetIds.forEach((targetId) => targetIds.add(targetId))
    }
  }

  for (const targetId of targetIds) {
    try {
      accounts.push(...await getPhoneNumbersForWaba(accessToken, targetId, null))
    } catch {
      // Some target ids are businesses or phone numbers rather than WABAs.
    }

    try {
      accounts.push(...await getPhoneNumbersForBusiness(accessToken, targetId))
    } catch {
      // Business Login granular scope targets can be WABAs, businesses, or
      // other assets. Non-business ids are ignored here and handled elsewhere.
    }
  }

  try {
    accounts.push(...await discoverFromBusinesses(accessToken))
  } catch {
    // Apps configured with a Business Login configuration may not return
    // /me/businesses; callback hints or debug targets can still be sufficient.
  }

  return dedupePhoneNumbers(accounts)
}
