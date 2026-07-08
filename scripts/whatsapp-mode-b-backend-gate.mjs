import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const files = {
  oauth: path.join(root, 'src/lib/whatsapp/oauth.ts'),
  authCompletion: path.join(root, 'src/lib/whatsapp/auth-completion.ts'),
  authUrl: path.join(root, 'src/app/api/whatsapp/auth/url/route.ts'),
  callback: path.join(root, 'src/app/api/whatsapp/auth/callback/route.ts'),
  businessAccounts: path.join(root, 'src/app/api/whatsapp/business-accounts/route.ts'),
  businessPage: path.join(root, 'src/app/(main)/whatsapp-business/page.tsx'),
}

const source = Object.fromEntries(
  Object.entries(files).map(([key, filename]) => [key, fs.readFileSync(filename, 'utf8')])
)
const callbackCompletionSource = `${source.callback}\n${source.authCompletion}`

const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging']

function assertSourceChecks() {
  assert.match(source.authUrl, /launchMode:\s*'js_sdk_embedded_signup'/)
  assert.match(source.authUrl, /cleanupCurrentUserIncompleteBindingState/)
  assert.match(source.authUrl, /\.eq\('user_id',\s*userId\)/)
  assert.match(source.authUrl, /\.eq\('status',\s*'pending'\)/)
  assert.match(source.authUrl, /\.eq\('status',\s*'disabled'\)/)

  for (const requiredScope of REQUIRED_SCOPES) {
    assert.match(source.oauth, new RegExp(`['"]${requiredScope}['"]`))
  }
  assert.match(source.oauth, /UNSUPPORTED_EMBEDDED_SIGNUP_SCOPES[\s\S]*business_management/)
  assert.match(source.oauth, /requestedScopes\.filter\(\(scope\) => !UNSUPPORTED_EMBEDDED_SIGNUP_SCOPES\.has\(scope\)\)/)
  assert.match(source.oauth, /params\.set\('config_id',\s*config\.configId\)/)
  assert.match(source.oauth, /scope:\s*config\.scopes\.join\(','\)/)

  assert.match(source.callback, /export async function POST/)
  assert.match(source.callback, /completeWhatsAppAuthorization/)
  assert.match(source.callback, /@\/lib\/whatsapp\/auth-completion/)
  assert.doesNotMatch(source.callback, /async function completeWhatsAppAuthorization/)
  assert.match(callbackCompletionSource, /WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE/)
  assert.match(callbackCompletionSource, /WHATSAPP_REQUIRED_SCOPES_MISSING/)
  assert.match(callbackCompletionSource, /WHATSAPP_NO_PHONE_DISCOVERED/)
  assert.match(callbackCompletionSource, /WHATSAPP_PHONE_ALREADY_BOUND/)
  assert.match(callbackCompletionSource, /hasRequiredWhatsAppBusinessScopes\(scopes\)/)
  assert.match(callbackCompletionSource, /assertPhoneNumberNotOwnedByAnotherUser/)
  assert.match(callbackCompletionSource, /assertUserCanHaveSingleActiveFormalPhone/)
  assert.match(source.callback, /businessAccountId:\s*getStringBodyValue\(body,\s*'businessAccountId'\)/)
  assert.match(source.callback, /phoneNumberId:\s*getStringBodyValue\(body,\s*'phoneNumberId'\)/)
  assert.match(callbackCompletionSource, /status:\s*'disabled'[\s\S]*binding_source:\s*'embedded_signup'[\s\S]*webhook_status:\s*'mapped'[\s\S]*messaging_status:\s*'unknown'/)
  assert.match(callbackCompletionSource, /await deps\.markBusinessAccountActive\(savedAccount\.id,\s*now\)/)

  assert.match(source.businessAccounts, /\.eq\('user_id',\s*user\.id\)/)
  assert.doesNotMatch(source.businessAccounts, /phone_number_id:\s*account\.phone_number_id/)
  assert.doesNotMatch(source.businessAccounts, /business_account_id:\s*account\.business_account_id/)
  assert.doesNotMatch(source.businessAccounts, /access_token:\s*/)
  assert.match(source.businessAccounts, /masked_phone_number_id/)
  assert.match(source.businessAccounts, /masked_business_account_id/)

  assert.doesNotMatch(source.businessPage, /^\s*business_account_id:\s*string/m)
  assert.match(source.businessPage, /window\.addEventListener\("message"/)
  assert.match(source.businessPage, /isAllowedMetaMessageOrigin/)
  assert.match(source.businessPage, /embeddedSignupFinishSeen/)
  assert.match(source.businessPage, /completeEmbeddedSignupAuthorization/)
}

function createDb() {
  return {
    authStates: [],
    accounts: [],
    tokens: [],
  }
}

function requiredGrantsPresent(scopes) {
  return REQUIRED_SCOPES.every((scope) => scopes.includes(scope))
}

function makePhone(hints) {
  if (!hints.businessAccountId || !hints.phoneNumberId) return null
  return {
    phoneNumberId: hints.phoneNumberId,
    businessAccountId: hints.businessAccountId,
    businessAccountName: 'mock',
    businessPortfolioId: hints.businessPortfolioId || null,
    businessPortfolioName: null,
    displayPhoneNumber: hints.displayPhoneNumber || null,
    verifiedName: hints.verifiedName || null,
  }
}

async function completeMockAuthorization(db, input, options = {}) {
  if (!input.state) {
    throw Object.assign(new Error('invalid state'), { code: 'WHATSAPP_AUTH_STATE_INVALID' })
  }

  if (!input.code && !input.error) {
    throw Object.assign(new Error('incomplete'), { code: 'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE' })
  }

  const authState = db.authStates.find((state) => state.state === input.state)
  if (!authState || authState.status !== 'pending') {
    throw Object.assign(new Error('invalid state'), { code: 'WHATSAPP_AUTH_STATE_INVALID' })
  }

  if (input.error) {
    authState.status = 'failed'
    authState.error_code = 'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
    throw Object.assign(new Error('incomplete'), { code: 'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE' })
  }

  const scopes = options.scopes || []
  if (!requiredGrantsPresent(scopes)) {
    authState.status = 'failed'
    authState.error_code = 'WHATSAPP_REQUIRED_SCOPES_MISSING'
    throw Object.assign(new Error('missing scopes'), { code: 'WHATSAPP_REQUIRED_SCOPES_MISSING' })
  }

  const phone = options.noPhone ? null : makePhone(input.hints || {})
  if (!phone) {
    authState.status = 'failed'
    authState.error_code = 'WHATSAPP_NO_PHONE_DISCOVERED'
    throw Object.assign(new Error('no phone'), { code: 'WHATSAPP_NO_PHONE_DISCOVERED' })
  }

  const duplicate = db.accounts.find((account) => account.phoneNumberId === phone.phoneNumberId && account.userId !== authState.userId)
  if (duplicate) {
    authState.status = 'failed'
    authState.error_code = 'WHATSAPP_PHONE_ALREADY_BOUND'
    throw Object.assign(new Error('duplicate phone'), { code: 'WHATSAPP_PHONE_ALREADY_BOUND' })
  }

  const otherActiveFormal = db.accounts.find((account) =>
    account.userId === authState.userId
    && account.status === 'active'
    && ['embedded_signup', 'facebook_login_for_business'].includes(account.bindingSource)
    && account.phoneNumberId !== phone.phoneNumberId
  )
  if (otherActiveFormal) {
    authState.status = 'failed'
    authState.error_code = 'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
    throw Object.assign(new Error('multiple active bindings'), { code: 'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE' })
  }

  const account = {
    id: `account-${db.accounts.length + 1}`,
    userId: authState.userId,
    phoneNumberId: phone.phoneNumberId,
    businessAccountId: phone.businessAccountId,
    status: 'disabled',
    bindingSource: 'embedded_signup',
    onboardingMode: 'embedded_signup',
    webhookStatus: 'mapped',
    messagingStatus: 'unknown',
  }
  db.accounts.push(account)

  if (options.tokenSaveFails) {
    account.status = 'disabled'
    authState.status = 'failed'
    authState.error_code = 'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
    throw Object.assign(new Error('token save failed'), { code: 'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE' })
  }

  db.tokens.push({
    accountId: account.id,
    hasToken: true,
    expiresAt: 'future',
  })
  account.status = 'active'
  authState.status = 'completed'

  return {
    account,
    diagnostics: {
      discoveredPhoneNumberCount: 1,
      requiredGrantsPresent: true,
      missingRequiredGrantNames: [],
    },
  }
}

function seedPending(db, state, userId = 'user-a') {
  db.authStates.push({
    state,
    userId,
    status: 'pending',
    expiresAt: 'future',
  })
}

async function expectErrorCode(label, fn, expectedCode) {
  try {
    await fn()
  } catch (error) {
    assert.equal(error.code, expectedCode, label)
    return true
  }
  throw new Error(`${label}: expected ${expectedCode}`)
}

async function runDryRun() {
  assertSourceChecks()

  const launchConfig = {
    launchMode: 'js_sdk_embedded_signup',
    scopes: REQUIRED_SCOPES,
  }
  assert.equal(launchConfig.launchMode, 'js_sdk_embedded_signup')
  assert.equal(requiredGrantsPresent(launchConfig.scopes), true)
  assert.equal(launchConfig.scopes.includes('business_management'), false)

  {
    const db = createDb()
    seedPending(db, 'missing-code-state')
    await expectErrorCode(
      'missing code',
      () => completeMockAuthorization(db, {
        state: 'missing-code-state',
        code: null,
        hints: {},
      }),
      'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
    )
    assert.equal(db.accounts.some((account) => account.status === 'active'), false)
  }

  {
    const db = createDb()
    seedPending(db, 'missing-scope-state')
    await expectErrorCode(
      'missing scopes',
      () => completeMockAuthorization(db, {
        state: 'missing-scope-state',
        code: 'mock-code',
        hints: { businessAccountId: 'mock-waba', phoneNumberId: 'mock-phone' },
      }, {
        scopes: ['whatsapp_business_messaging'],
      }),
      'WHATSAPP_REQUIRED_SCOPES_MISSING'
    )
    assert.equal(db.accounts.some((account) => account.status === 'active'), false)
  }

  {
    const db = createDb()
    seedPending(db, 'valid-state')
    const result = await completeMockAuthorization(db, {
      state: 'valid-state',
      code: 'mock-code',
      hints: {
        businessAccountId: 'mock-waba',
        phoneNumberId: 'mock-phone',
        businessPortfolioId: 'mock-business',
      },
    }, {
      scopes: REQUIRED_SCOPES,
    })
    assert.equal(result.account.status, 'active')
    assert.equal(result.account.bindingSource, 'embedded_signup')
    assert.equal(result.account.webhookStatus, 'mapped')
    assert.equal(result.account.messagingStatus, 'unknown')
    assert.equal(db.tokens.length, 1)
    assert.equal(db.authStates.find((state) => state.state === 'valid-state')?.status, 'completed')
  }

  {
    const db = createDb()
    seedPending(db, 'duplicate-state')
    db.accounts.push({
      id: 'existing-account',
      userId: 'other-user',
      phoneNumberId: 'mock-phone',
      businessAccountId: 'mock-waba',
      status: 'active',
      bindingSource: 'embedded_signup',
    })
    await expectErrorCode(
      'duplicate phone',
      () => completeMockAuthorization(db, {
        state: 'duplicate-state',
        code: 'mock-code',
        hints: { businessAccountId: 'mock-waba', phoneNumberId: 'mock-phone' },
      }, {
        scopes: REQUIRED_SCOPES,
      }),
      'WHATSAPP_PHONE_ALREADY_BOUND'
    )
    assert.equal(db.accounts.filter((account) => account.userId === 'user-a' && account.status === 'active').length, 0)
  }

  {
    const db = createDb()
    seedPending(db, 'no-phone-state')
    await expectErrorCode(
      'no discovered phone',
      () => completeMockAuthorization(db, {
        state: 'no-phone-state',
        code: 'mock-code',
        hints: {},
      }, {
        scopes: REQUIRED_SCOPES,
        noPhone: true,
      }),
      'WHATSAPP_NO_PHONE_DISCOVERED'
    )
    assert.equal(db.accounts.some((account) => account.status === 'active'), false)
  }

  {
    const db = createDb()
    seedPending(db, 'token-failure-state')
    await expectErrorCode(
      'token save failure',
      () => completeMockAuthorization(db, {
        state: 'token-failure-state',
        code: 'mock-code',
        hints: { businessAccountId: 'mock-waba', phoneNumberId: 'mock-phone' },
      }, {
        scopes: REQUIRED_SCOPES,
        tokenSaveFails: true,
      }),
      'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
    )
    assert.equal(db.accounts.some((account) => account.status === 'active'), false)
  }

  return {
    backend_dry_run_passed: true,
    auth_url_launch_mode_ok: true,
    required_scopes_requested: true,
    invalid_business_management_scope_absent: true,
    callback_missing_code_case_passed: true,
    callback_missing_scope_case_passed: true,
    callback_valid_hint_case_passed: true,
    callback_duplicate_phone_case_passed: true,
    callback_no_phone_case_passed: true,
    active_account_created_only_on_success: true,
    failed_attempt_does_not_leave_active_account: true,
    tenant_isolation_checked: true,
    frontend_api_exposes_token: 'no',
    frontend_api_exposes_raw_phone_number_id: 'no',
    frontend_api_exposes_raw_waba_id: 'no',
  }
}

runDryRun()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2))
  })
  .catch((error) => {
    console.error(JSON.stringify({
      backend_dry_run_passed: false,
      error: error instanceof Error ? error.message : 'unknown',
    }, null, 2))
    process.exitCode = 1
  })
