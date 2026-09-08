/* eslint-disable @typescript-eslint/no-require-imports, import/order */

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
      if (request === '@/lib/social-comments/feature-flag') {
        return {
          isSocialCommentsApiEnabled: () => true,
          isSocialCommentPlatformEnabled: () => true,
        }
      }
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

function withBusinessEnv(run) {
  const previous = {
    clientId: process.env.TIKTOK_BUSINESS_CLIENT_ID,
    clientSecret: process.env.TIKTOK_BUSINESS_CLIENT_SECRET,
    redirectUri: process.env.TIKTOK_BUSINESS_REDIRECT_URI,
  }
  process.env.TIKTOK_BUSINESS_CLIENT_ID = 'business-client-id'
  process.env.TIKTOK_BUSINESS_CLIENT_SECRET = 'business-client-secret'
  process.env.TIKTOK_BUSINESS_REDIRECT_URI = 'https://app.example.test/api/tiktok/business-auth/callback/'
  function restore() {
    if (previous.clientId === undefined) delete process.env.TIKTOK_BUSINESS_CLIENT_ID
    else process.env.TIKTOK_BUSINESS_CLIENT_ID = previous.clientId
    if (previous.clientSecret === undefined) delete process.env.TIKTOK_BUSINESS_CLIENT_SECRET
    else process.env.TIKTOK_BUSINESS_CLIENT_SECRET = previous.clientSecret
    if (previous.redirectUri === undefined) delete process.env.TIKTOK_BUSINESS_REDIRECT_URI
    else process.env.TIKTOK_BUSINESS_REDIRECT_URI = previous.redirectUri
  }
  try {
    const result = run()
    if (result && typeof result.finally === 'function') {
      return result.finally(restore)
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

function loadBusinessOauth(fetchImpl, broker = {}) {
  return loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/business-oauth.ts'),
    {
      '@/lib/oauth-broker/client': {
        isBrokerEnabled: () => broker.enabled === true,
        callBroker: broker.call || (() => {
          throw new Error('broker should not be called')
        }),
      },
    },
    { fetch: fetchImpl },
  )
}

test('Business OAuth URL requests independent comment scopes for the configured callback', () => {
  withBusinessEnv(() => {
    const oauth = loadBusinessOauth(async () => {
      throw new Error('fetch should not run')
    })
    const url = new URL(oauth.buildTikTokBusinessAuthorizationUrl('csrf-state'))

    assert.equal(url.origin, 'https://business-api.tiktok.com')
    assert.equal(url.pathname, '/portal/auth')
    assert.equal(url.searchParams.get('app_id'), 'business-client-id')
    assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.test/api/tiktok/business-auth/callback/')
    assert.equal(url.searchParams.get('state'), 'csrf-state')
    const scopes = url.searchParams.get('scope').split(',')
    assert.deepEqual(
      scopes,
      ['comment.list', 'comment.list.manage'],
    )
    assert.equal(scopes.includes('video.publish'), false)
  })
})

test('Next keeps the registered trailing-slash Business callback free of URI rewrites', () => {
  const nextConfig = fs.readFileSync('next.config.mjs', 'utf8')
  assert.match(nextConfig, /skipTrailingSlashRedirect:\s*true/)
})

test('Business code exchange uses the tt_user JSON endpoint and validates the token payload', async () => {
  await withBusinessEnv(async () => {
    const calls = []
    const oauth = loadBusinessOauth(async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 0,
            message: 'OK',
            data: {
              access_token: 'business-access',
              refresh_token: 'business-refresh',
              expires_in: 86400,
              refresh_token_expires_in: 31536000,
              open_id: 'business-open-id',
              scope: 'comment.list,comment.list.manage',
              token_type: 'Bearer',
            },
          }
        },
      }
    })

    const token = await oauth.exchangeTikTokBusinessCodeForToken('one-time-code')
    assert.equal(token.open_id, 'business-open-id')
    assert.equal(calls.length, 1)
    assert.equal(
      calls[0].url,
      'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/',
    )
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      client_id: 'business-client-id',
      client_secret: 'business-client-secret',
      grant_type: 'authorization_code',
      auth_code: 'one-time-code',
      redirect_uri: 'https://app.example.test/api/tiktok/business-auth/callback/',
    })
  })
})

test('Business token responses reject non-Bearer and blank credential fields', async () => {
  const valid = {
    access_token: 'business-access',
    refresh_token: 'business-refresh',
    expires_in: 86400,
    refresh_token_expires_in: 31536000,
    open_id: 'business-open',
    scope: 'comment.list,comment.list.manage',
    token_type: 'Bearer',
  }
  const malformed = [
    { ...valid, token_type: 'bearer' },
    { ...valid, token_type: undefined },
    { ...valid, access_token: '   ' },
    { ...valid, refresh_token: '\t' },
    { ...valid, open_id: '\n' },
  ]

  for (const payload of malformed) {
    const oauth = loadBusinessOauth(
      async () => {
        throw new Error('direct fetch must remain disabled')
      },
      {
        enabled: true,
        async call() {
          return payload
        },
      },
    )
    await assert.rejects(
      oauth.exchangeTikTokBusinessCodeForToken('code'),
      /invalid token response/,
    )
  }
})

test('Business OAuth delegates sensitive token exchange through the TikTok broker whitelist', async () => {
  const brokerCalls = []
  const oauth = loadBusinessOauth(
    async () => {
      throw new Error('direct fetch must remain disabled')
    },
    {
      enabled: true,
      async call(platform, op, args) {
        brokerCalls.push({ platform, op, args })
        return {
          access_token: 'broker-access',
          refresh_token: 'broker-refresh',
          expires_in: 86400,
          refresh_token_expires_in: 31536000,
          open_id: 'broker-open',
          scope: 'comment.list,comment.list.manage',
          token_type: 'Bearer',
        }
      },
    },
  )

  const token = await oauth.exchangeTikTokBusinessCodeForToken('broker-code')
  assert.equal(token.open_id, 'broker-open')
  assert.deepEqual(JSON.parse(JSON.stringify(brokerCalls)), [{
    platform: 'tiktok',
    op: 'exchangeTikTokBusinessCodeForToken',
    args: { authCode: 'broker-code' },
  }])
})

test('Business token revoke uses the fixed v1.3 endpoint and a credential-free URL', async () => {
  await withBusinessEnv(async () => {
    const calls = []
    const oauth = loadBusinessOauth(async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        async json() { return { code: 0, message: 'OK', data: {} } },
      }
    })

    await oauth.revokeTikTokBusinessAccessToken('business-access-token')
    assert.equal(
      calls[0].url,
      'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/revoke/',
    )
    assert.equal(calls[0].url.includes('business-access-token'), false)
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      client_id: 'business-client-id',
      client_secret: 'business-client-secret',
      access_token: 'business-access-token',
    })
  })
})

test('Business token revoke delegates through the closed broker operation', async () => {
  const calls = []
  const oauth = loadBusinessOauth(async () => {
    throw new Error('direct provider must not run')
  }, {
    enabled: true,
    call: async (...args) => {
      calls.push(args)
    },
  })
  await oauth.revokeTikTokBusinessAccessToken('business-access-token')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'tiktok')
  assert.equal(calls[0][1], 'revokeTikTokBusinessAccessToken')
})

test('Business callback atomically claims state and links the token to the selected account', async () => {
  const calls = []
  const admin = {
    async rpc(name, args) {
      calls.push({ kind: 'rpc', name, args })
      if (name === 'claim_tiktok_business_auth_state') {
        return {
          data: [{ user_id: 'user-1', account_id: 'account-1' }],
          error: null,
        }
      }
      if (name === 'complete_tiktok_business_auth_state') {
        return { data: true, error: null }
      }
      return { data: false, error: null }
    },
  }
  const callback = loadTsModule(
    path.join(process.cwd(), 'src/app/api/tiktok/business-auth/callback/route.ts'),
    {
      'next/server': {
        NextResponse: {
          redirect(url) {
            return { url: String(url) }
          },
        },
      },
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/tiktok/business-oauth': {
        calculateTikTokBusinessExpiration: (seconds) => `expiry-${seconds}`,
        parseTikTokBusinessScopes: (scope) => scope.split(','),
        async exchangeTikTokBusinessCodeForToken(code) {
          calls.push({ kind: 'exchange', code })
          return {
            access_token: 'access',
            refresh_token: 'refresh',
            expires_in: 86400,
            refresh_token_expires_in: 31536000,
            open_id: 'business-open',
            scope: 'comment.list,comment.list.manage',
            token_type: 'Bearer',
          }
        },
      },
      '@/lib/tiktok/routes': {
        buildTikTokAccountsUrl(baseUrl, params) {
          const url = new URL('/tiktok-publish/accounts', baseUrl)
          Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
          return url
        },
      },
    },
    { console: { ...console, error() {} } },
  )

  const response = await callback.GET({
    nextUrl: new URL(
      'https://app.example.test/api/tiktok/business-auth/callback/?auth_code=provider-code&state=csrf-state',
    ),
  })

  assert.match(response.url, /business_success=true/)
  assert.equal(calls[0].name, 'claim_tiktok_business_auth_state')
  assert.equal(calls[0].args.p_state, 'csrf-state')
  assert.equal(calls[0].args.p_lease_seconds, 60)
  assert.match(calls[0].args.p_processing_token, /^[0-9a-f-]{36}$/)
  assert.equal(calls.filter((call) => call.kind === 'exchange').length, 1)
  const complete = calls.find((call) => call.name === 'complete_tiktok_business_auth_state')
  assert.ok(complete)
  assert.equal(complete.args.p_processing_token, calls[0].args.p_processing_token)
  assert.equal(complete.args.p_business_open_id, 'business-open')
  assert.equal(complete.args.p_access_token, 'access')
  assert.deepEqual(
    JSON.parse(JSON.stringify(complete.args.p_scopes)),
    ['comment.list', 'comment.list.manage'],
  )
})

test('Business callback rejects expired or replayed state before token exchange', async () => {
  let exchanged = false
  const callback = loadTsModule(
    path.join(process.cwd(), 'src/app/api/tiktok/business-auth/callback/route.ts'),
    {
      'next/server': {
        NextResponse: { redirect: (url) => ({ url: String(url) }) },
      },
      '@/lib/supabase/admin': {
        createAdminClient: () => ({
          rpc: async () => ({ data: [], error: null }),
        }),
      },
      '@/lib/social-comments/feature-flag': {
        isSocialCommentsApiEnabled: () => true,
        isSocialCommentPlatformEnabled: () => true,
      },
      '@/lib/tiktok/business-oauth': {
        async exchangeTikTokBusinessCodeForToken() {
          exchanged = true
        },
      },
      '@/lib/tiktok/routes': {
        buildTikTokAccountsUrl(baseUrl, params) {
          const url = new URL('/tiktok-publish/accounts', baseUrl)
          Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
          return url
        },
      },
    },
  )

  const response = await callback.GET({
    nextUrl: new URL(
      'https://app.example.test/api/tiktok/business-auth/callback/?auth_code=provider-code&state=replayed',
    ),
  })
  assert.match(response.url, /business_error=/)
  assert.equal(exchanged, false)
})

test('Business callback reports failure when the atomic completion fence is lost', async () => {
  const rpcCalls = []
  const admin = {
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      if (name === 'claim_tiktok_business_auth_state') {
        return {
          data: [{ user_id: 'user-1', account_id: 'account-1' }],
          error: null,
        }
      }
      if (name === 'complete_tiktok_business_auth_state') {
        return { data: false, error: null }
      }
      if (name === 'fail_tiktok_business_auth_state') {
        return { data: true, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  }
  const callback = loadTsModule(
    path.join(process.cwd(), 'src/app/api/tiktok/business-auth/callback/route.ts'),
    {
      'next/server': {
        NextResponse: { redirect: (url) => ({ url: String(url) }) },
      },
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/tiktok/business-oauth': {
        calculateTikTokBusinessExpiration: (seconds) => `expiry-${seconds}`,
        parseTikTokBusinessScopes: (scope) => scope.split(','),
        async exchangeTikTokBusinessCodeForToken() {
          return {
            access_token: 'access',
            refresh_token: 'refresh',
            expires_in: 86400,
            refresh_token_expires_in: 31536000,
            open_id: 'business-open',
            scope: 'comment.list,comment.list.manage',
            token_type: 'Bearer',
          }
        },
      },
      '@/lib/tiktok/routes': {
        buildTikTokAccountsUrl(baseUrl, params) {
          const url = new URL('/tiktok-publish/accounts', baseUrl)
          Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
          return url
        },
      },
    },
    { console: { ...console, error() {} } },
  )

  const response = await callback.GET({
    nextUrl: new URL(
      'https://app.example.test/api/tiktok/business-auth/callback/?auth_code=code&state=state',
    ),
  })
  assert.match(response.url, /business_error=/)
  assert.doesNotMatch(response.url, /business_success/)
  assert.ok(rpcCalls.some((call) => call.name === 'fail_tiktok_business_auth_state'))
  const claim = rpcCalls.find((call) => call.name === 'claim_tiktok_business_auth_state')
  const complete = rpcCalls.find((call) => call.name === 'complete_tiktok_business_auth_state')
  const fail = rpcCalls.find((call) => call.name === 'fail_tiktok_business_auth_state')
  assert.equal(complete.args.p_processing_token, claim.args.p_processing_token)
  assert.equal(fail.args.p_processing_token, claim.args.p_processing_token)
})

test('Business callback maps database lock timeout to a stable fenced error', async () => {
  const rpcCalls = []
  const logged = []
  let providerCalls = 0
  const admin = {
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      if (name === 'claim_tiktok_business_auth_state') {
        return { data: [{ user_id: 'user-1', account_id: 'account-1' }], error: null }
      }
      if (name === 'complete_tiktok_business_auth_state') {
        return {
          data: null,
          error: { code: '57014', message: 'canceling statement due to statement timeout' },
        }
      }
      if (name === 'fail_tiktok_business_auth_state') {
        return { data: true, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  }
  const callback = loadTsModule(
    path.join(process.cwd(), 'src/app/api/tiktok/business-auth/callback/route.ts'),
    {
      'next/server': {
        NextResponse: { redirect: (url) => ({ url: String(url) }) },
      },
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/tiktok/business-oauth': {
        calculateTikTokBusinessExpiration: (seconds) => `expiry-${seconds}`,
        parseTikTokBusinessScopes: (scope) => scope.split(','),
        async exchangeTikTokBusinessCodeForToken() {
          providerCalls += 1
          return {
            access_token: 'access',
            refresh_token: 'refresh',
            expires_in: 86400,
            refresh_token_expires_in: 31536000,
            open_id: 'business-open',
            scope: 'comment.list,comment.list.manage',
            token_type: 'Bearer',
          }
        },
      },
      '@/lib/tiktok/routes': {
        buildTikTokAccountsUrl(baseUrl, params) {
          const url = new URL('/tiktok-publish/accounts', baseUrl)
          Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
          return url
        },
      },
    },
    { console: { ...console, error(...args) { logged.push(args.join(' ')) } } },
  )

  const response = await callback.GET({
    nextUrl: new URL(
      'https://app.example.test/api/tiktok/business-auth/callback/?auth_code=code&state=state',
    ),
  })

  assert.equal(providerCalls, 1)
  assert.match(response.url, /business_error_code=authorization_conflict_retry/)
  assert.doesNotMatch(response.url, /canceling|statement|57014/)
  assert.doesNotMatch(response.url, /business_success/)
  const claim = rpcCalls.find((call) => call.name === 'claim_tiktok_business_auth_state')
  const fail = rpcCalls.find((call) => call.name === 'fail_tiktok_business_auth_state')
  assert.equal(fail.args.p_processing_token, claim.args.p_processing_token)
  assert.equal(fail.args.p_error_code, 'authorization_conflict_retry')
  assert.doesNotMatch(fail.args.p_error_message, /canceling|statement|57014/)
  assert.equal(logged.some((entry) => /canceling|statement timeout/.test(entry)), false)
})

test('Business token migration is service-role-only and enforces normal-account linkage', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20260725_tiktok_business_oauth.sql',
    'utf8',
  )
  assert.match(migration, /tiktok_business_account_tokens/)
  assert.match(migration, /parent_type IS DISTINCT FROM 'normal'/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.tiktok_business_account_tokens FROM PUBLIC, anon, authenticated/,
  )
  assert.match(
    migration,
    /GRANT ALL ON TABLE public\.tiktok_business_account_tokens TO service_role/,
  )
  assert.match(migration, /status = 'pending'[\s\S]*expires_at > NOW\(\)/)
  assert.match(migration, /processing_expires_at = NOW\(\)[\s\S]*make_interval/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.complete_tiktok_business_auth_state/)
  assert.match(migration, /FOR UPDATE[\s\S]*locked_processing_token IS DISTINCT FROM p_processing_token/)
  assert.match(migration, /INSERT INTO public\.tiktok_business_account_tokens[\s\S]*SET status = 'completed'/)
  assert.match(migration, /existing_business_open_id IS DISTINCT FROM p_business_open_id/)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.complete_tiktok_business_auth_state[\s\S]*GRANT EXECUTE ON FUNCTION public\.complete_tiktok_business_auth_state/,
  )
})

test('URL route expires pending and processing flows against different deadlines', () => {
  const route = fs.readFileSync(
    'src/app/api/tiktok/business-auth/url/route.ts',
    'utf8',
  )
  assert.match(route, /\.eq\('status', 'pending'\)\s*\.lt\('expires_at', now\)/)
  assert.match(route, /\.eq\('status', 'processing'\)\s*\.lt\('processing_expires_at', now\)/)
  assert.doesNotMatch(
    route,
    /\.in\('status', \['pending', 'processing'\]\)\s*\.lt\('expires_at'/,
  )
})

test('URL route validates Business OAuth configuration before writing auth state', async () => {
  let adminClientCalls = 0
  const accountQuery = {
    select() {
      return this
    },
    eq() {
      return this
    },
    async maybeSingle() {
      return { data: { id: 'account-1' }, error: null }
    },
  }
  const route = loadTsModule(
    path.join(process.cwd(), 'src/app/api/tiktok/business-auth/url/route.ts'),
    {
      'next/server': {
        NextResponse: {
          json(body, init = {}) {
            return { body, status: init.status || 200 }
          },
        },
      },
      '@/lib/supabase/server': {
        async createClient() {
          return {
            auth: {
              async getUser() {
                return { data: { user: { id: 'user-1' } }, error: null }
              },
            },
            from(table) {
              assert.equal(table, 'tiktok_accounts')
              return accountQuery
            },
          }
        },
      },
      '@/lib/supabase/admin': {
        createAdminClient() {
          adminClientCalls += 1
          throw new Error('admin client must not be created when configuration is invalid')
        },
      },
      '@/lib/tiktok/business-oauth': {
        generateTikTokBusinessState: () => 'fresh-state',
        buildTikTokBusinessAuthorizationUrl(state) {
          assert.equal(state, 'fresh-state')
          throw new Error('TikTok Business OAuth configuration is incomplete.')
        },
      },
    },
    { console: { ...console, error() {} } },
  )

  const response = await route.POST({
    async json() {
      return { accountId: 'account-1' }
    },
  })

  assert.equal(response.status, 500)
  assert.equal(
    response.body.error,
    'TikTok Business OAuth configuration is incomplete.',
  )
  assert.equal(adminClientCalls, 0)
})

function loadBusinessUrlRouteForGeneration({ tokenStatus = 'active' } = {}) {
  const insertedStates = []
  let stateWrites = 0
  const terminalQuery = {
    update() { stateWrites += 1; return this },
    insert(value) { insertedStates.push(value); stateWrites += 1; return this },
    eq() { return this },
    lt() { return this },
    then(resolve) { return Promise.resolve(resolve({ error: null })) },
  }
  const admin = {
    from(table) {
      if (table === 'tiktok_accounts') {
        return {
          select() { return this },
          eq() { return this },
          async maybeSingle() {
            return {
              data: { business_comment_auth_generation: 'account-generation-1' },
              error: null,
            }
          },
        }
      }
      if (table === 'tiktok_business_account_tokens') {
        return {
          select() { return this },
          eq() { return this },
          async maybeSingle() {
            return { data: { status: tokenStatus }, error: null }
          },
        }
      }
      if (table === 'tiktok_business_auth_states') return terminalQuery
      throw new Error(`unexpected table: ${table}`)
    },
  }
  const accountQuery = {
    select() { return this },
    eq() { return this },
    async maybeSingle() { return { data: { id: 'account-1' }, error: null } },
  }
  const route = loadTsModule(
    path.join(process.cwd(), 'src/app/api/tiktok/business-auth/url/route.ts'),
    {
      'next/server': {
        NextResponse: {
          json(body, init = {}) { return { body, status: init.status || 200 } },
        },
      },
      '@/lib/supabase/server': {
        async createClient() {
          return {
            auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
            from() { return accountQuery },
          }
        },
      },
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/tiktok/business-oauth': {
        generateTikTokBusinessState: () => 'fresh-state',
        buildTikTokBusinessAuthorizationUrl: () => 'https://business.example.test/auth',
      },
    },
    { console: { ...console, error() {} } },
  )
  return { route, insertedStates, getStateWrites: () => stateWrites }
}

test('URL route snapshots the account authorization generation into the pending state', async () => {
  const fixture = loadBusinessUrlRouteForGeneration()
  const response = await fixture.route.POST({ json: async () => ({ accountId: 'account-1' }) })
  assert.equal(response.status, 200)
  assert.equal(fixture.insertedStates.length, 1)
  assert.equal(fixture.insertedStates[0].account_generation, 'account-generation-1')
})

test('URL route blocks reauthorization while an independent comment revoke is pending', async () => {
  const fixture = loadBusinessUrlRouteForGeneration({ tokenStatus: 'revocation_pending' })
  const response = await fixture.route.POST({ json: async () => ({ accountId: 'account-1' }) })
  assert.equal(response.status, 409)
  assert.equal(fixture.getStateWrites(), 0)
})

test('account API exposes only Business authorization metadata, never Business credentials', () => {
  const route = fs.readFileSync('src/app/api/publish/accounts/route.ts', 'utf8')
  const businessSelect = route.match(
    /\.from\('tiktok_business_account_tokens'\)\s*\.select\(([^)]+)\)/,
  )
  assert.ok(businessSelect)
  assert.doesNotMatch(businessSelect[1], /\baccess_token\b/)
  assert.doesNotMatch(businessSelect[1], /\brefresh_token\b/)
  assert.match(route, /comment_authorization_status/)
  assert.match(route, /comment_scopes/)
})
