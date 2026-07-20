const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, stubs = {}) {
  const filename = path.join(process.cwd(), relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  const localRequire = (id) => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id)
  vm.runInNewContext(output, {
    Headers,
    Response,
    URL,
    URLSearchParams,
    exports: loadedModule.exports,
    fetch,
    module: loadedModule,
    process: { env: {} },
    require: localRequire,
  }, { filename })
  return loadedModule.exports
}

function createFakeAdmin(options = {}) {
  const state = {
    account: { id: 'account-row', user_id: 'user-row', channel_id: 'external-account', status: 'revoked' },
    authState: { id: 'state-row', state: 'stored-state', status: 'pending', code_verifier: 'verifier' },
    events: [],
    accountActivations: 0,
    accountUpserts: 0,
    tokenUpserts: 0,
  }

  class Query {
    constructor(table) {
      this.table = table
      this.filters = []
      this.operation = null
      this.payload = null
      this.conflict = null
    }

    upsert(payload, config) {
      this.operation = 'upsert'
      this.payload = payload
      this.conflict = config?.onConflict || null
      return this
    }

    update(payload) {
      this.operation = 'update'
      this.payload = payload
      return this
    }

    eq(column, value) {
      this.filters.push([column, value])
      return this
    }

    select() { return this }

    async single() { return this.execute() }
    async maybeSingle() { return this.execute() }
    then(resolve, reject) { return this.execute().then(resolve, reject) }

    matches(row) {
      return this.filters.every(([column, value]) => row[column] === value)
    }

    async execute() {
      if (this.table === 'instagram_accounts' && this.operation === 'upsert') {
        state.events.push('account-stage')
        state.accountUpserts += 1
        assert.equal(this.conflict, 'user_id,channel_id')
        if (options.failAccountStage) return { data: null, error: { code: 'stage_failed' } }
        state.account = { ...state.account, ...this.payload }
        return { data: { id: state.account.id }, error: null }
      }

      if (this.table === 'instagram_account_tokens' && this.operation === 'upsert') {
        state.events.push('token-upsert')
        assert.equal(this.conflict, 'account_id')
        if (options.failToken) return { data: null, error: { code: 'token_failed' } }
        state.tokenUpserts += 1
        return { data: null, error: null }
      }

      if (this.table === 'instagram_accounts' && this.operation === 'update') {
        const isActivation = this.payload.status === 'active'
        state.events.push(isActivation ? 'account-activate' : 'account-revoke')
        if (isActivation) state.accountActivations += 1
        if (isActivation && options.failActivation) {
          return { data: null, error: { code: 'activation_failed' } }
        }
        if (!this.matches(state.account)) return { data: null, error: null }
        state.account = { ...state.account, ...this.payload }
        return { data: { id: state.account.id }, error: null }
      }

      if (this.table === 'instagram_auth_states' && this.operation === 'update') {
        const isCompletion = this.payload.status === 'completed'
        state.events.push(isCompletion ? 'state-complete' : 'state-fail')
        if (isCompletion && options.failCompletion) {
          return { data: null, error: { code: 'completion_failed' } }
        }
        if (!this.matches(state.authState)) return { data: null, error: null }
        state.authState = { ...state.authState, ...this.payload }
        return { data: { id: state.authState.id }, error: null }
      }

      throw new Error('Unexpected fake query')
    }
  }

  return {
    state,
    from(table) { return new Query(table) },
  }
}

const persistence = loadTypeScriptModule('src/lib/instagram/callback-persistence.ts')
const oauth = loadTypeScriptModule('src/lib/instagram/oauth.ts', {
  '@/lib/instagram/graph-auth': {
    instagramGraphHeaders: () => ({}),
  },
  '@/lib/oauth-broker/client': {
    callBroker: () => { throw new Error('OAuth broker must not be called in scope guard tests.') },
    isBrokerEnabled: () => false,
  },
  '@/lib/instagram/oauth-transport': {
    requestSensitiveInstagramOAuthJson: () => {
      throw new Error('Sensitive transport must not be called in scope guard tests.')
    },
  },
})
const nativeRequiredScopes = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
]
const callbackInput = {
  userId: 'user-row',
  now: '2026-07-11T12:00:00.000Z',
  account: {
    channel_id: 'external-account',
    channel_title: 'Test account',
    scopes: nativeRequiredScopes,
  },
  token: {
    access_token: 'synthetic-access',
    refresh_token: 'synthetic-refresh',
    access_token_expires_at: '2026-09-01T00:00:00.000Z',
  },
}

async function runScopeGuardedCallback(admin, verifiedScopes) {
  try {
    oauth.assertInstagramRequiredScopes('instagram', verifiedScopes)
    await persistence.persistInstagramCallbackAccount(admin, {
      ...callbackInput,
      account: { ...callbackInput.account, scopes: verifiedScopes },
    })
    await persistence.completeInstagramAuthState(admin, 'stored-state', callbackInput.now)
  } catch (error) {
    await persistence.failInstagramAuthState(admin, 'stored-state', {
      code: typeof error?.code === 'string' ? error.code : 'callback_failed',
      message: 'Instagram authorization failed.',
      now: callbackInput.now,
    })
  }
}

for (const missingScope of nativeRequiredScopes) {
  test(`missing one required Native scope fails before persistence: ${missingScope}`, async () => {
    const admin = createFakeAdmin()
    await runScopeGuardedCallback(
      admin,
      nativeRequiredScopes.filter((scope) => scope !== missingScope)
    )

    assert.deepEqual(admin.state.events, ['state-fail'])
    assert.equal(admin.state.accountUpserts, 0)
    assert.equal(admin.state.accountActivations, 0)
    assert.equal(admin.state.tokenUpserts, 0)
    assert.equal(admin.state.account.status, 'revoked')
    assert.equal(admin.state.authState.status, 'failed')
    assert.equal(admin.state.authState.code_verifier, null)
    assert.equal(admin.state.authState.error_code, 'missing_required_scopes')
  })
}

test('all required Native scopes permit revoked stage, token persistence, and activation', async () => {
  const admin = createFakeAdmin()
  await runScopeGuardedCallback(admin, nativeRequiredScopes)

  assert.deepEqual(admin.state.events, [
    'account-stage',
    'token-upsert',
    'account-activate',
    'state-complete',
  ])
  assert.equal(admin.state.tokenUpserts, 1)
  assert.equal(admin.state.account.status, 'active')
  assert.equal(admin.state.authState.status, 'completed')
})

test('Facebook mode keeps its existing required scopes instead of using Native scopes', () => {
  const facebookScopes = [
    'pages_show_list',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_comments',
  ]

  assert.doesNotThrow(() => oauth.assertInstagramRequiredScopes('facebook', facebookScopes))
  assert.throws(
    () => oauth.assertInstagramRequiredScopes('facebook', nativeRequiredScopes),
    (error) => error.code === 'missing_required_scopes'
  )
})

test('stages a binding as revoked, overwrites one token row, then activates', async () => {
  const admin = createFakeAdmin()
  await persistence.persistInstagramCallbackAccount(admin, callbackInput)
  assert.deepEqual(admin.state.events, ['account-stage', 'token-upsert', 'account-activate'])
  assert.equal(admin.state.account.status, 'active')
  assert.equal(admin.state.tokenUpserts, 1)
})

test('token persistence failure leaves an existing binding revoked', async () => {
  const admin = createFakeAdmin({ failToken: true })
  await assert.rejects(
    persistence.persistInstagramCallbackAccount(admin, callbackInput),
    (error) => error.code === 'token_persistence_failed'
  )
  assert.deepEqual(admin.state.events, ['account-stage', 'token-upsert'])
  assert.equal(admin.state.account.status, 'revoked')
  assert.equal(admin.state.tokenUpserts, 0)
})

test('activation failure compensates back to revoked', async () => {
  const admin = createFakeAdmin({ failActivation: true })
  await assert.rejects(
    persistence.persistInstagramCallbackAccount(admin, callbackInput),
    (error) => error.code === 'account_activation_failed'
  )
  assert.deepEqual(admin.state.events, ['account-stage', 'token-upsert', 'account-activate', 'account-revoke'])
  assert.equal(admin.state.account.status, 'revoked')
})

test('auth state completion requires a returned pending row and clears the verifier', async () => {
  const admin = createFakeAdmin()
  await persistence.completeInstagramAuthState(admin, 'stored-state', callbackInput.now)
  assert.equal(admin.state.authState.status, 'completed')
  assert.equal(admin.state.authState.code_verifier, null)

  const failedAdmin = createFakeAdmin({ failCompletion: true })
  await assert.rejects(
    persistence.completeInstagramAuthState(failedAdmin, 'stored-state', callbackInput.now),
    (error) => error.code === 'auth_state_completion_failed'
  )
  assert.equal(failedAdmin.state.authState.status, 'pending')
})

test('callback-level compensation revokes an already activated account', async () => {
  const admin = createFakeAdmin()
  const accountId = await persistence.persistInstagramCallbackAccount(admin, callbackInput)
  assert.equal(admin.state.account.status, 'active')
  await persistence.revokeInstagramCallbackAccounts(admin, [accountId], callbackInput.userId, callbackInput.now)
  assert.equal(admin.state.account.status, 'revoked')
  assert.equal(admin.state.events.at(-1), 'account-revoke')
})

test('failed auth states clear the verifier and require a returned pending row', async () => {
  const admin = createFakeAdmin()
  await persistence.failInstagramAuthState(admin, 'stored-state', {
    code: 'callback_failed',
    message: 'Instagram authorization failed.',
    now: callbackInput.now,
  })
  assert.equal(admin.state.authState.status, 'failed')
  assert.equal(admin.state.authState.code_verifier, null)
  assert.equal(admin.state.authState.completed_at, callbackInput.now)

  await assert.rejects(
    persistence.failInstagramAuthState(admin, 'stored-state', {
      code: 'callback_failed',
      message: 'Instagram authorization failed.',
      now: callbackInput.now,
    }),
    (error) => error.code === 'auth_state_failure_persistence_failed'
  )
})

test('callback wiring compensates activated accounts and never logs raw errors', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/api/instagram/auth/callback/route.ts'), 'utf8')
  const scopeGuardIndex = source.indexOf('assertInstagramRequiredScopes(getInstagramOAuthConfig().authMode, scopes)')
  const persistenceIndex = source.indexOf('persistInstagramCallbackAccount(supabase')
  assert.notEqual(scopeGuardIndex, -1)
  assert.notEqual(persistenceIndex, -1)
  assert.equal(scopeGuardIndex < persistenceIndex, true)
  assert.match(source, /activatedAccountIds\.push\(savedAccountId\)/)
  assert.match(source, /await completeInstagramAuthState\(supabase, state, now\)/)
  assert.match(source, /await revokeInstagramCallbackAccounts\(/)
  assert.match(source, /code: typeof \(err as any\)\?\.code/)
  assert.doesNotMatch(source, /console\.error\('Instagram callback error:', err\)/)
  assert.doesNotMatch(source, /当前 App ID：\$\{config\.clientId\}/)
  assert.doesNotMatch(source, /missing.*scope.*join/i)
})
