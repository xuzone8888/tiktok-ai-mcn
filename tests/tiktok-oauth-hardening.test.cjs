/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ts = require('typescript')

function loadTsModule(filename, stubs = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(output, {
    exports: loadedModule.exports,
    module: loadedModule,
    require(request) {
      if (request in stubs) return stubs[request]
      return require(request)
    },
    AbortSignal,
    Date,
    Error,
    Map,
    Number,
    Promise,
    Set,
    URL,
    URLSearchParams,
    console,
    process,
    ...globals,
  }, { filename })
  return loadedModule.exports
}

function withLoginEnv(run) {
  const previous = {
    key: process.env.TIKTOK_CLIENT_KEY,
    secret: process.env.TIKTOK_CLIENT_SECRET,
    redirect: process.env.TIKTOK_REDIRECT_URI,
  }
  process.env.TIKTOK_CLIENT_KEY = 'login-key'
  process.env.TIKTOK_CLIENT_SECRET = 'login-secret'
  process.env.TIKTOK_REDIRECT_URI = 'https://app.stargaze.cn/api/tiktok/auth/callback'
  const restore = () => {
    if (previous.key === undefined) delete process.env.TIKTOK_CLIENT_KEY
    else process.env.TIKTOK_CLIENT_KEY = previous.key
    if (previous.secret === undefined) delete process.env.TIKTOK_CLIENT_SECRET
    else process.env.TIKTOK_CLIENT_SECRET = previous.secret
    if (previous.redirect === undefined) delete process.env.TIKTOK_REDIRECT_URI
    else process.env.TIKTOK_REDIRECT_URI = previous.redirect
  }
  try {
    const result = run()
    if (result && typeof result.finally === 'function') return result.finally(restore)
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (payload instanceof Error) throw payload
      return payload
    },
  }
}

function loadOauth(fetchImpl) {
  return loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/oauth.ts'),
    {
      './test-mock': {
        isTikTokMockCredential: () => false,
        isTikTokTestMockEnabled: () => false,
      },
      './video-list-rollout': {
        getTikTokOAuthScopes: () => [
          'user.info.basic',
          'video.publish',
          'video.upload',
          'user.info.stats',
        ],
      },
    },
    { fetch: fetchImpl },
  )
}

test('ordinary OAuth sends bounded requests and accepts only complete Bearer token payloads', async () => {
  await withLoginEnv(async () => {
    const calls = []
    const oauth = loadOauth(async (_url, options) => {
      calls.push(options)
      return response(200, {
        access_token: ' access ',
        refresh_token: ' refresh ',
        open_id: ' open ',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_expires_in: 86400,
        scope: 'user.info.basic',
      })
    })
    const token = await oauth.exchangeCodeForToken('code', 'verifier')
    assert.equal(token.access_token, 'access')
    assert.equal(token.refresh_token, 'refresh')
    assert.equal(token.open_id, 'open')
    assert.equal(token.token_type, 'Bearer')
    assert.ok(calls[0].signal)
  })
})

test('malformed successful token and user payloads fail closed without echoing credentials', async () => {
  await withLoginEnv(async () => {
    for (const payload of [
      {},
      { access_token: ' ', refresh_token: 'r', open_id: 'o', token_type: 'Bearer', expires_in: 1, refresh_expires_in: 1 },
      { access_token: 'secret-a', refresh_token: 'secret-r', open_id: 'o', token_type: 'MAC', expires_in: 1, refresh_expires_in: 1 },
      { access_token: 'a', refresh_token: 'r', open_id: 'o', token_type: 'Bearer', expires_in: 0, refresh_expires_in: 1 },
      { access_token: 'a', refresh_token: 'r', open_id: 'o', token_type: 'Bearer', expires_in: Number.NaN, refresh_expires_in: 1 },
    ]) {
      const oauth = loadOauth(async () => response(200, payload))
      await assert.rejects(
        oauth.exchangeCodeForToken('code', 'verifier'),
        (error) => !error.message.includes('secret-a') && !error.message.includes('secret-r'),
      )
    }

    const oauth = loadOauth(async () => response(200, {
      data: { user: { open_id: ' ' } },
      error: { code: 'ok', message: '', log_id: 'log' },
    }))
    await assert.rejects(oauth.getUserInfo('access'), /invalid response/)
  })
})

test('refresh invalidation is explicit and sanitized while transient failures preserve status eligibility', async () => {
  await withLoginEnv(async () => {
    const invalid = loadOauth(async () => response(400, {
      error: 'invalid_grant',
      error_description: 'refresh_token: super-secret',
    }))
    await assert.rejects(
      invalid.refreshAccessToken('super-secret'),
      (error) => {
        assert.equal(invalid.isTikTokRefreshCredentialInvalid(error), true)
        assert.equal(error.message.includes('super-secret'), false)
        return true
      },
    )

    const transient = loadOauth(async () => response(503, {
      error: 'temporarily_unavailable',
      error_description: 'access_token: secret',
    }))
    await assert.rejects(
      transient.refreshAccessToken('secret'),
      (error) => transient.isTikTokRefreshCredentialInvalid(error) === false,
    )
    assert.equal(transient.isTikTokRefreshCredentialInvalid(new Error('profile timeout')), false)
    assert.equal(transient.isTikTokRefreshCredentialInvalid(new Error('database update failed')), false)
  })
})

test('refresh route preserves account status for profile and database failures', () => {
  const route = fs.readFileSync('src/app/api/publish/accounts/[id]/refresh/route.ts', 'utf8')
  const catchBlock = route.slice(route.indexOf('} catch (error) {'))
  assert.match(catchBlock, /if \(isTikTokRefreshCredentialInvalid\(error\)\)/)
  assert.match(catchBlock, /update\(\{ status: 'expired' \}\)/)
  assert.ok(
    catchBlock.indexOf("update({ status: 'expired' })")
      > catchBlock.indexOf('if (isTikTokRefreshCredentialInvalid(error))'),
  )
})

test('URLSearchParams percent text is displayed once without a second decode', () => {
  const providerText = new URLSearchParams('?error=rate%25limit%20failed').get('error')
  assert.equal(providerText, 'rate%limit failed')
  assert.throws(() => decodeURIComponent(providerText), URIError)
  const page = fs.readFileSync('src/app/(main)/publish/accounts/page.tsx', 'utf8')
  assert.match(page, /description: error,/)
  assert.doesNotMatch(page, /decodeURIComponent\(error\)/)
})

function createAuthStateRpc() {
  const states = new Map([
    ['web-state', {
      state: 'web-state', flow: 'web', userId: 'user-1', status: 'pending',
      token: null, leaseValid: false, code_verifier: 'pkce',
    }],
    ['qr-state', {
      state: 'qr-state', flow: 'qr', userId: 'user-1', status: 'pending',
      token: null, leaseValid: false, client_ticket: 'ticket',
    }],
  ])
  return {
    states,
    async rpc(name, args) {
      const row = states.get(args.p_state)
      if (name === 'claim_tiktok_auth_state') {
        if (
          !row || row.status !== 'pending' || row.flow !== args.p_flow_type
          || (args.p_user_id && row.userId !== args.p_user_id)
        ) return { data: [], error: null }
        row.status = 'processing'
        row.token = args.p_processing_token
        row.leaseValid = true
        return {
          data: [{
            user_id: row.userId,
            code_verifier: row.code_verifier || null,
            client_ticket: row.client_ticket || null,
            qr_token: null,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          }],
          error: null,
        }
      }
      if (name === 'complete_tiktok_auth_state') {
        const wins = row && row.status === 'processing'
          && row.token === args.p_processing_token && row.leaseValid
        if (wins) row.status = 'completed'
        return { data: Boolean(wins), error: null }
      }
      if (name === 'fail_tiktok_auth_state') {
        const wins = row && row.status === 'processing' && row.token === args.p_processing_token
        if (wins) row.status = 'failed'
        return { data: Boolean(wins), error: null }
      }
      return { data: false, error: null }
    },
  }
}

test('Web and QR concurrent attempts call the token provider once and terminal states are fenced', async () => {
  const authState = loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/auth-state.ts'),
    {},
  )
  const database = createAuthStateRpc()
  let providerCalls = 0
  const run = async (state, flowType, userId) => {
    const token = authState.newTikTokAuthProcessingToken()
    const claimed = await authState.claimTikTokAuthState(database, {
      state, flowType, userId, processingToken: token,
    })
    if (!claimed) return false
    providerCalls += 1
    return authState.completeTikTokAuthState(database, {
      state, flowType, userId, processingToken: token,
    })
  }
  const web = await Promise.all([
    run('web-state', 'web', null),
    run('web-state', 'web', null),
  ])
  assert.deepEqual(web.sort(), [false, true])
  assert.equal(providerCalls, 1)

  const qr = await Promise.all([
    run('qr-state', 'qr', 'user-1'),
    run('qr-state', 'qr', 'user-1'),
  ])
  assert.deepEqual(qr.sort(), [false, true])
  assert.equal(providerCalls, 2)

  const row = database.states.get('qr-state')
  row.leaseValid = false
  assert.equal(await authState.failTikTokAuthState(database, {
    state: 'qr-state',
    flowType: 'qr',
    userId: 'user-1',
    processingToken: row.token,
    errorCode: 'late',
    errorMessage: 'late failure',
  }), false)
  assert.equal(row.status, 'completed')
})

function loadAtomicBinding(userInfo) {
  return loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/account-binding.ts'),
    {
      '@/lib/tiktok/oauth': {
        calculateTokenExpiration(seconds) {
          return new Date(Date.UTC(2030, 0, 1) + seconds * 1000)
        },
        async getUserInfo() {
          return userInfo
        },
      },
    },
  )
}

function createAtomicCommitDatabase({ existing = true, leaseValid = true, failCommit = false } = {}) {
  const state = {
    auth: { status: 'processing', token: 'attempt-1', leaseValid },
    account: existing ? { id: 'account-1', access_token: 'old-access', refresh_token: 'old-refresh' } : null,
    secure: existing ? { access_token: 'old-access', refresh_token: 'old-refresh' } : null,
  }
  return {
    state,
    async rpc(name, args) {
      assert.equal(name, 'commit_tiktok_auth_account')
      if (failCommit) return { data: null, error: { code: '40001' } }
      if (
        state.auth.status !== 'processing'
        || state.auth.token !== args.p_processing_token
        || !state.auth.leaseValid
      ) return { data: null, error: null }

      // Model one PostgreSQL transaction: prepare a copy, then publish all
      // parent/trigger/state changes at one commit point.
      const nextAccount = {
        id: state.account?.id || 'account-new',
        access_token: args.p_access_token,
        refresh_token: args.p_refresh_token,
      }
      const nextSecure = {
        access_token: args.p_access_token,
        refresh_token: args.p_refresh_token,
      }
      state.account = nextAccount
      state.secure = nextSecure
      state.auth.status = 'completed'
      return { data: nextAccount.id, error: null }
    },
  }
}

test('atomic OAuth commit keeps parent, secure token, and state all-or-nothing', async () => {
  const binding = loadAtomicBinding({
    open_id: 'open-1',
    display_name: 'Test account',
    follower_count: 10,
  })
  const tokenResponse = {
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    open_id: 'open-1',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_expires_in: 7200,
    scope: 'video.list',
  }

  for (const database of [
    createAtomicCommitDatabase({ leaseValid: false }),
    createAtomicCommitDatabase({ failCommit: true }),
  ]) {
    await assert.rejects(binding.commitTikTokAccountFromAuthState(database, {
      state: 'web-state',
      flowType: 'web',
      userId: 'user-1',
      processingToken: 'attempt-1',
      tokenResponse,
    }))
    assert.equal(database.state.account.access_token, 'old-access')
    assert.equal(database.state.secure.access_token, 'old-access')
    assert.equal(database.state.auth.status, 'processing')
  }

  for (const existing of [true, false]) {
    const database = createAtomicCommitDatabase({ existing })
    const result = await binding.commitTikTokAccountFromAuthState(database, {
      state: existing ? 'web-state' : 'qr-state',
      flowType: existing ? 'web' : 'qr',
      userId: 'user-1',
      processingToken: 'attempt-1',
      tokenResponse,
    })
    assert.ok(result.accountId)
    assert.equal(database.state.account.access_token, 'new-access')
    assert.equal(database.state.secure.access_token, 'new-access')
    assert.equal(database.state.auth.status, 'completed')
  }
})

test('ordinary OAuth migration and routes keep every terminal transition behind the attempt fence', () => {
  const migration = fs.readFileSync('supabase/migrations/20260728_tiktok_oauth_state_fencing.sql', 'utf8')
  const web = fs.readFileSync('src/app/api/tiktok/auth/callback/route.ts', 'utf8')
  const qr = fs.readFileSync('src/app/api/tiktok/auth/qr/status/route.ts', 'utf8')
  const page = fs.readFileSync('src/app/(main)/publish/accounts/page.tsx', 'utf8')
  assert.match(migration, /status = 'processing'[\s\S]*status = 'pending'/)
  assert.match(migration, /processing_token = p_processing_token/)
  assert.match(migration, /processing_expires_at > clock_timestamp\(\)/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_tiktok_auth_state/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.commit_tiktok_auth_account/)
  assert.match(migration, /FOR UPDATE[\s\S]*UPDATE public\.tiktok_accounts[\s\S]*UPDATE public\.tiktok_auth_states/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.commit_tiktok_auth_account/)
  assert.match(web, /claimTikTokAuthState[\s\S]*exchangeCodeForToken[\s\S]*commitTikTokAccountFromAuthState/)
  assert.match(qr, /claimTikTokAuthState[\s\S]*exchangeQrCodeForToken[\s\S]*commitTikTokAccountFromAuthState/)
  assert.doesNotMatch(web, /saveTikTokAccountFromToken/)
  assert.doesNotMatch(qr, /saveTikTokAccountFromToken/)
  assert.doesNotMatch(page, /setInterval\(poll/)
  assert.doesNotMatch(page, /decodeURIComponent\(error\)/)
})
