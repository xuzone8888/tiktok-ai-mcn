import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const routeFile = path.join(root, 'src/app/api/whatsapp/auth/callback/route.ts')
const helperFile = path.join(root, 'src/lib/whatsapp/auth-completion.ts')
const routeSource = fs.readFileSync(routeFile, 'utf8')

const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging']
const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  throw new Error('Unexpected real network call during WhatsApp Mode B Level 2 backend gate.')
}

function loadTsModule(filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  })
  const mod = new Module(filename)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(outputText, filename)
  return mod.exports
}

const {
  completeWhatsAppAuthorization,
  getAuthErrorDetails,
  markAuthStateFailedAfterError,
} = loadTsModule(helperFile)

function routeUsesCompletionHelper() {
  return routeSource.includes('@/lib/whatsapp/auth-completion')
    && /completeWhatsAppAuthorization\(deps,\s*input\)/.test(routeSource)
    && !/async function completeWhatsAppAuthorization/.test(routeSource)
}

function uniqueScopes(values) {
  return Array.from(new Set(values.flatMap((value) => String(value || '').split(/[,\s]+/)).filter(Boolean)))
}

function missingRequired(scopes) {
  return REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope))
}

function createDb() {
  return {
    authStates: [],
    accounts: [],
    tokens: [],
  }
}

function seedPending(db, state, options = {}) {
  db.authStates.push({
    state,
    user_id: options.userId || 'user-a',
    code_verifier: 'verifier',
    expires_at: options.expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    status: 'pending',
  })
}

function makePhone(hints) {
  if (!hints.businessAccountId || !hints.phoneNumberId) return null
  return {
    phoneNumberId: hints.phoneNumberId,
    businessAccountId: hints.businessAccountId,
    businessAccountName: null,
    businessPortfolioId: hints.businessPortfolioId || null,
    businessPortfolioName: hints.businessPortfolioName || null,
    displayPhoneNumber: hints.displayPhoneNumber || null,
    verifiedName: hints.verifiedName || null,
  }
}

function createMockDeps(db, options = {}) {
  return {
    async getAuthState(state) {
      return {
        data: db.authStates.find((row) => row.state === state) || null,
        error: null,
      }
    },
    async updateAuthState(state, values, context) {
      if (options.failCompletedAuthStateUpdate && values.status === 'completed') {
        throw new Error(`${context}: mocked completed state failure`)
      }
      const row = db.authStates.find((authState) => authState.state === state)
      if (!row) {
        throw new Error(`${context}: missing auth state`)
      }
      Object.assign(row, values)
    },
    async tryUpdateAuthState(state, values) {
      const row = db.authStates.find((authState) => authState.state === state)
      if (!row) return false
      Object.assign(row, values)
      return true
    },
    async findAccountByPhoneNumber(phoneNumberId) {
      return db.accounts.find((account) => account.phone_number_id === phoneNumberId) || null
    },
    async listActiveAccountsForUser(userId) {
      return db.accounts.filter((account) => account.user_id === userId && account.status === 'active')
    },
    async upsertBusinessAccount(values) {
      let account = db.accounts.find((row) => row.phone_number_id === values.phone_number_id)
      if (account) {
        Object.assign(account, values)
      } else {
        account = {
          id: `account-${db.accounts.length + 1}`,
          ...values,
        }
        db.accounts.push(account)
      }
      return {
        id: account.id,
        display_phone_number: account.display_phone_number || null,
        verified_name: account.verified_name || null,
      }
    },
    async markBusinessAccountDisabled(accountId, now) {
      const account = db.accounts.find((row) => row.id === accountId)
      if (!account) throw new Error('missing account')
      account.status = 'disabled'
      account.updated_at = now
    },
    async markBusinessAccountActive(accountId, now) {
      const account = db.accounts.find((row) => row.id === accountId)
      if (!account) throw new Error('missing account')
      account.status = 'active'
      account.updated_at = now
    },
    async upsertToken(values) {
      if (options.failTokenSave) {
        throw new Error('mocked token save failure')
      }
      const existing = db.tokens.find((token) => token.account_id === values.account_id)
      if (existing) {
        Object.assign(existing, values)
      } else {
        db.tokens.push({ ...values })
      }
    },
    async exchangeCodeForToken() {
      return {
        access_token: 'mock-short-token',
        expires_in: 3600,
        scope: options.shortTokenScope || '',
        token_type: 'bearer',
      }
    },
    async exchangeLongLivedToken() {
      if (options.longTokenFails) {
        throw new Error('mocked long token failure')
      }
      return {
        access_token: 'mock-long-token',
        expires_in: 7200,
        scope: options.longTokenScope || '',
        token_type: 'bearer',
      }
    },
    async resolveGrantedScopes(_accessToken, ...scopeValues) {
      const scopes = options.scopes || uniqueScopes(scopeValues)
      const missingRequiredGrantNames = missingRequired(scopes)
      return {
        scopes,
        diagnostics: {
          hasTokenResponseScopes: scopes.length > 0,
          hasDebugTokenScopes: Boolean(options.hasDebugTokenScopes),
          hasGranularScopes: Boolean(options.hasGranularScopes),
          requiredGrantsPresent: missingRequiredGrantNames.length === 0,
          missingRequiredGrantNames,
        },
      }
    },
    calculateTokenExpiration(expiresIn) {
      return expiresIn ? new Date(Date.now() + expiresIn * 1000) : null
    },
    async discoverPhoneNumbers(_accessToken, hints) {
      if (options.noPhone) return []
      if (options.phones) return options.phones
      const hintedPhone = makePhone(hints)
      return hintedPhone ? [hintedPhone] : []
    },
    logInfo() {},
    logError() {},
  }
}

async function runRouteWrappedCompletion(deps, input) {
  try {
    return await completeWhatsAppAuthorization(deps, input)
  } catch (error) {
    const { authErrorCode, authErrorMessage } = getAuthErrorDetails(error)
    await markAuthStateFailedAfterError(deps, input.state, authErrorCode, authErrorMessage)
    throw Object.assign(error, { authErrorCode })
  }
}

async function expectErrorCode(label, fn, expectedCode) {
  try {
    await fn()
  } catch (error) {
    assert.equal(error.authErrorCode || error.code, expectedCode, label)
    return true
  }
  throw new Error(`${label}: expected ${expectedCode}`)
}

async function assertMissingCodeCase() {
  const db = createDb()
  seedPending(db, 'missing-code-state')
  await expectErrorCode(
    'missing code',
    () => runRouteWrappedCompletion(createMockDeps(db), {
      state: 'missing-code-state',
      code: null,
      hints: {},
    }),
    'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
  )
  assert.equal(db.authStates[0].status, 'failed')
  assert.equal(db.accounts.some((account) => account.status === 'active'), false)
}

async function assertInvalidStateCase() {
  const db = createDb()
  await expectErrorCode(
    'invalid state',
    () => runRouteWrappedCompletion(createMockDeps(db), {
      state: 'unknown-state',
      code: 'mock-code',
      hints: {},
    }),
    'WHATSAPP_AUTH_STATE_INVALID'
  )
  assert.equal(db.accounts.length, 0)
}

async function assertExpiredStateCase() {
  const db = createDb()
  seedPending(db, 'expired-state', {
    expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
  })
  await expectErrorCode(
    'expired state',
    () => runRouteWrappedCompletion(createMockDeps(db), {
      state: 'expired-state',
      code: 'mock-code',
      hints: {},
    }),
    'WHATSAPP_AUTH_STATE_EXPIRED'
  )
  assert.equal(db.authStates[0].status, 'expired')
  assert.equal(db.accounts.length, 0)
}

async function assertMissingScopesCase() {
  const db = createDb()
  seedPending(db, 'missing-scope-state')
  await expectErrorCode(
    'missing required scopes',
    () => runRouteWrappedCompletion(createMockDeps(db, {
      scopes: ['whatsapp_business_messaging'],
    }), {
      state: 'missing-scope-state',
      code: 'mock-code',
      hints: {
        businessAccountId: 'mock-waba',
        phoneNumberId: 'mock-phone',
      },
    }),
    'WHATSAPP_REQUIRED_SCOPES_MISSING'
  )
  assert.equal(db.authStates[0].status, 'failed')
  assert.equal(db.accounts.some((account) => account.status === 'active'), false)
}

async function assertValidHintCase() {
  const db = createDb()
  seedPending(db, 'valid-state')
  const result = await runRouteWrappedCompletion(createMockDeps(db, {
    scopes: REQUIRED_SCOPES,
  }), {
    state: 'valid-state',
    code: 'mock-code',
    hints: {
      businessAccountId: 'mock-waba',
      businessPortfolioId: 'mock-business',
      phoneNumberId: 'mock-phone',
    },
  })
  assert.equal(result.discoveredPhoneNumberCount, 1)
  assert.equal(db.authStates[0].status, 'completed')
  assert.equal(db.accounts.length, 1)
  assert.equal(db.accounts[0].status, 'active')
  assert.equal(db.accounts[0].binding_source, 'embedded_signup')
  assert.equal(db.accounts[0].onboarding_mode, 'embedded_signup')
  assert.equal(db.accounts[0].webhook_status, 'mapped')
  assert.equal(db.accounts[0].messaging_status, 'unknown')
  assert.equal(db.tokens.length, 1)
}

async function assertDuplicatePhoneCase() {
  const db = createDb()
  seedPending(db, 'duplicate-state')
  db.accounts.push({
    id: 'existing-account',
    user_id: 'other-user',
    phone_number_id: 'mock-phone',
    binding_source: 'embedded_signup',
    status: 'active',
    display_phone_number: null,
    verified_name: null,
  })
  await expectErrorCode(
    'duplicate phone',
    () => runRouteWrappedCompletion(createMockDeps(db, {
      scopes: REQUIRED_SCOPES,
    }), {
      state: 'duplicate-state',
      code: 'mock-code',
      hints: {
        businessAccountId: 'mock-waba',
        phoneNumberId: 'mock-phone',
      },
    }),
    'WHATSAPP_PHONE_ALREADY_BOUND'
  )
  assert.equal(db.accounts.filter((account) => account.user_id === 'user-a' && account.status === 'active').length, 0)
}

async function assertNoPhoneCase() {
  const db = createDb()
  seedPending(db, 'no-phone-state')
  await expectErrorCode(
    'no discovered phone',
    () => runRouteWrappedCompletion(createMockDeps(db, {
      scopes: REQUIRED_SCOPES,
      noPhone: true,
    }), {
      state: 'no-phone-state',
      code: 'mock-code',
      hints: {},
    }),
    'WHATSAPP_NO_PHONE_DISCOVERED'
  )
  assert.equal(db.authStates[0].status, 'failed')
  assert.equal(db.accounts.some((account) => account.status === 'active'), false)
}

async function assertTokenSaveFailureCase() {
  const db = createDb()
  seedPending(db, 'token-failure-state')
  await expectErrorCode(
    'token save failure',
    () => runRouteWrappedCompletion(createMockDeps(db, {
      scopes: REQUIRED_SCOPES,
      failTokenSave: true,
    }), {
      state: 'token-failure-state',
      code: 'mock-code',
      hints: {
        businessAccountId: 'mock-waba',
        phoneNumberId: 'mock-phone',
      },
    }),
    'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
  )
  assert.equal(db.authStates[0].status, 'failed')
  assert.equal(db.accounts.length, 1)
  assert.equal(db.accounts[0].status, 'disabled')
  assert.equal(db.tokens.length, 0)
}

async function assertCompletedStateFailureCase() {
  const db = createDb()
  seedPending(db, 'complete-failure-state')
  await expectErrorCode(
    'completed auth_state update failure',
    () => runRouteWrappedCompletion(createMockDeps(db, {
      scopes: REQUIRED_SCOPES,
      failCompletedAuthStateUpdate: true,
    }), {
      state: 'complete-failure-state',
      code: 'mock-code',
      hints: {
        businessAccountId: 'mock-waba',
        phoneNumberId: 'mock-phone',
      },
    }),
    'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
  )
  assert.equal(db.authStates[0].status, 'failed')
  assert.equal(db.accounts.length, 1)
  assert.equal(db.accounts[0].status, 'disabled')
  assert.equal(db.tokens.length, 1)
}

async function assertExistingActiveFormalBindingCase() {
  const db = createDb()
  seedPending(db, 'second-active-state')
  db.accounts.push({
    id: 'current-user-existing-account',
    user_id: 'user-a',
    phone_number_id: 'other-mock-phone',
    binding_source: 'embedded_signup',
    status: 'active',
    display_phone_number: null,
    verified_name: null,
  })
  await expectErrorCode(
    'current user already has another active formal phone',
    () => runRouteWrappedCompletion(createMockDeps(db, {
      scopes: REQUIRED_SCOPES,
    }), {
      state: 'second-active-state',
      code: 'mock-code',
      hints: {
        businessAccountId: 'mock-waba',
        phoneNumberId: 'mock-phone',
      },
    }),
    'WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE'
  )
  assert.equal(db.accounts.filter((account) => account.user_id === 'user-a' && account.status === 'active').length, 1)
  assert.equal(db.accounts.some((account) => account.phone_number_id === 'mock-phone'), false)
}

async function runLevel2() {
  assert.equal(typeof completeWhatsAppAuthorization, 'function')
  assert.equal(routeUsesCompletionHelper(), true)

  await assertMissingCodeCase()
  await assertInvalidStateCase()
  await assertExpiredStateCase()
  await assertMissingScopesCase()
  await assertValidHintCase()
  await assertDuplicatePhoneCase()
  await assertNoPhoneCase()
  await assertTokenSaveFailureCase()
  await assertCompletedStateFailureCase()
  await assertExistingActiveFormalBindingCase()

  return {
    backend_dry_run_level2_passed: true,
    actual_completion_helper_executed: true,
    route_uses_completion_helper: true,
    mocked_graph_only: true,
    real_meta_called: 'no',
    send_message_called: 'no',
    callback_missing_code_case_passed: true,
    callback_invalid_state_case_passed: true,
    callback_expired_state_case_passed: true,
    callback_missing_scope_case_passed: true,
    callback_valid_hint_case_passed: true,
    callback_duplicate_phone_case_passed: true,
    callback_no_phone_case_passed: true,
    callback_token_save_failure_case_passed: true,
    callback_completed_state_failure_case_passed: true,
    callback_existing_active_formal_binding_case_passed: true,
    active_account_created_only_on_success: true,
    failed_attempt_does_not_leave_active_account: true,
  }
}

runLevel2()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2))
  })
  .catch((error) => {
    console.error(JSON.stringify({
      backend_dry_run_level2_passed: false,
      error: error instanceof Error ? error.message : 'unknown',
    }, null, 2))
    process.exitCode = 1
  })
  .finally(() => {
    globalThis.fetch = originalFetch
  })
