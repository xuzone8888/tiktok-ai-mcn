/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, stubs = {}, env = process.env) {
  const filename = path.join(process.cwd(), relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  const localRequire = id => Object.hasOwn(stubs, id) ? stubs[id] : require(id)
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname, process) { ${output}\n})`,
    { filename },
  )
  wrapper(loadedModule.exports, localRequire, loadedModule, filename, path.dirname(filename), { env })
  return loadedModule.exports
}

function loadAuthCallback() {
  return loadTypeScriptModule('src/lib/supabase/auth-callback.ts')
}

function createAuthClient(overrides = {}) {
  return {
    async exchangeCodeForSession() {
      throw new Error('unexpected exchangeCodeForSession call')
    },
    async verifyOtp() {
      throw new Error('unexpected verifyOtp call')
    },
    async setSession() {
      throw new Error('unexpected setSession call')
    },
    ...overrides,
  }
}

test('PKCE scrubs the URL before client creation and accepts only the exchange response', async () => {
  const { restoreSupabaseAuthCallback } = loadAuthCallback()
  const session = { access_token: 'new-session' }
  const calls = []
  let visibleUrl = '/auth/login?code=controlled-code&redirect=%2Fcanvas#stale'
  const result = await restoreSupabaseAuthCallback(
    () => {
      calls.push('create')
      assert.equal(visibleUrl, '/auth/login?redirect=%2Fcanvas')
      return createAuthClient({
        async exchangeCodeForSession(code) {
          calls.push(`exchange:${code}`)
          return { data: { session }, error: null }
        },
        async getSession() {
          throw new Error('an old session must never be consulted')
        },
      })
    },
    '?code=controlled-code&redirect=%2Fcanvas',
    '#stale',
    '/auth/login',
    (scrubbedPath) => {
      calls.push('scrub')
      visibleUrl = scrubbedPath
    },
  )

  assert.deepEqual(calls, ['scrub', 'create', 'exchange:controlled-code'])
  assert.equal(result.handled, true)
  assert.equal(result.session, session)
  assert.equal(result.error, null)
  assert.equal(result.scrubbedPath, '/auth/login?redirect=%2Fcanvas')
})

test('PKCE never falls back to an existing session when verifier exchange fails or returns no session', async () => {
  const { restoreSupabaseAuthCallback } = loadAuthCallback()
  const cases = [
    async () => ({ data: { session: null }, error: new Error('missing verifier') }),
    async () => ({ data: { session: null }, error: null }),
    async () => { throw new Error('controlled exchange failure') },
  ]

  for (const exchangeCodeForSession of cases) {
    let oldSessionReads = 0
    const result = await restoreSupabaseAuthCallback(
      () => createAuthClient({
        exchangeCodeForSession,
        async getSession() {
          oldSessionReads += 1
          return { data: { session: { access_token: 'old-session' } }, error: null }
        },
      }),
      '?code=controlled-code',
      '',
      '/auth/login',
      () => {},
    )

    assert.equal(result.handled, true)
    assert.equal(result.session, null)
    assert.ok(result.error)
    assert.equal(oldSessionReads, 0)
  }
})

test('token_hash verifies each allowlisted Supabase email OTP type and requires a new session', async () => {
  const { restoreSupabaseAuthCallback } = loadAuthCallback()
  const allowedTypes = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

  for (const type of allowedTypes) {
    const session = { access_token: `session-${type}` }
    const calls = []
    const result = await restoreSupabaseAuthCallback(
      () => createAuthClient({
        async verifyOtp(params) {
          calls.push(params)
          return { data: { session }, error: null }
        },
      }),
      `?token_hash=hash-${type}&type=${type}`,
      '',
      '/auth/login',
      () => {},
    )

    assert.deepEqual(calls, [{ token_hash: `hash-${type}`, type }])
    assert.equal(result.session, session)
    assert.equal(result.error, null)
  }

  for (const response of [
    { data: { session: null }, error: new Error('expired token hash') },
    { data: { session: null }, error: null },
  ]) {
    const result = await restoreSupabaseAuthCallback(
      () => createAuthClient({ async verifyOtp() { return response } }),
      '?token_hash=controlled-hash&type=signup',
      '',
      '/auth/login',
      () => {},
    )
    assert.equal(result.session, null)
    assert.ok(result.error)
  }

  const thrown = await restoreSupabaseAuthCallback(
    () => createAuthClient({ async verifyOtp() { throw new Error('controlled verify failure') } }),
    '?token_hash=controlled-hash&type=signup',
    '',
    '/auth/login',
    () => {},
  )
  assert.equal(thrown.session, null)
  assert.ok(thrown.error)
})

test('strict parser rejects invalid, duplicate, and ambiguous callback parameters without touching auth', async () => {
  const { restoreSupabaseAuthCallback } = loadAuthCallback()
  const cases = [
    ['?code=', ''],
    ['?code=one&code=two', ''],
    ['?code=&token_hash=hash&type=signup', ''],
    ['?code=code&token_hash=hash&type=signup', ''],
    ['?token_hash=one&token_hash=two&type=signup', ''],
    ['?token_hash=hash&type=signup&type=invite', ''],
    ['?token_hash=hash', ''],
    ['?type=signup', ''],
    ['?token_hash=hash&type=SIGNUP', ''],
    ['?token_hash=hash&type=phone_change', ''],
    ['?error=access_denied&code=code', ''],
    ['?code=code', '#access_token=access&refresh_token=refresh'],
    ['', '#access_token=one&access_token=two&refresh_token=refresh'],
    ['', '#access_token=access'],
  ]

  for (const [search, hash] of cases) {
    let clients = 0
    let scrubs = 0
    const result = await restoreSupabaseAuthCallback(
      () => {
        clients += 1
        return createAuthClient()
      },
      search,
      hash,
      '/auth/login',
      () => { scrubs += 1 },
    )
    assert.equal(result.handled, true, `${search}${hash}`)
    assert.equal(result.session, null, `${search}${hash}`)
    assert.ok(result.error, `${search}${hash}`)
    assert.equal(clients, 0, `${search}${hash}`)
    assert.equal(scrubs, 1, `${search}${hash}`)
  }
})

test('provider errors are scrubbed and returned without constructing an auth client', async () => {
  const { restoreSupabaseAuthCallback } = loadAuthCallback()
  for (const [search, hash] of [
    ['?error=access_denied&error_code=otp_expired&error_description=expired', ''],
    ['', '#error=access_denied&error_description=expired'],
  ]) {
    let created = false
    let scrubbedPath = null
    const result = await restoreSupabaseAuthCallback(
      () => {
        created = true
        return createAuthClient()
      },
      search,
      hash,
      '/auth/login',
      path => { scrubbedPath = path },
    )
    assert.equal(created, false)
    assert.equal(result.handled, true)
    assert.equal(result.session, null)
    assert.ok(result.error)
    assert.equal(scrubbedPath, '/auth/login')
  }
})

test('legacy hash is scrubbed before client creation and restored only through setSession', async () => {
  const { restoreSupabaseAuthCallback } = loadAuthCallback()
  const session = { access_token: 'legacy-session' }
  const calls = []
  let visibleUrl = '/auth/login?redirect=%2Fmodels#access_token=access&refresh_token=refresh'
  const result = await restoreSupabaseAuthCallback(
    () => {
      calls.push('create')
      assert.equal(visibleUrl, '/auth/login?redirect=%2Fmodels')
      return createAuthClient({
        async setSession(params) {
          calls.push(params)
          return { data: { session }, error: null }
        },
      })
    },
    '?redirect=%2Fmodels',
    '#access_token=access&refresh_token=refresh&type=bearer',
    '/auth/login',
    path => {
      calls.push('scrub')
      visibleUrl = path
    },
  )

  assert.deepEqual(calls, [
    'scrub',
    'create',
    { access_token: 'access', refresh_token: 'refresh' },
  ])
  assert.equal(result.session, session)
  assert.equal(result.error, null)

  for (const setSession of [
    async () => ({ data: { session: null }, error: new Error('legacy session rejected') }),
    async () => ({ data: { session: null }, error: null }),
    async () => { throw new Error('controlled legacy failure') },
  ]) {
    const failed = await restoreSupabaseAuthCallback(
      () => createAuthClient({ setSession }),
      '',
      '#access_token=access&refresh_token=refresh',
      '/auth/login',
      () => {},
    )
    assert.equal(failed.session, null)
    assert.ok(failed.error)
  }
})

test('ordinary URLs and fragments do not create a client or mutate history', async () => {
  const { restoreSupabaseAuthCallback } = loadAuthCallback()
  let created = false
  let scrubbed = false
  const result = await restoreSupabaseAuthCallback(
    () => {
      created = true
      return createAuthClient()
    },
    '?redirect=%2Fmodels',
    '#section',
    '/auth/login',
    () => { scrubbed = true },
  )
  assert.deepEqual(result, { handled: false, session: null, error: null, scrubbedPath: null })
  assert.equal(created, false)
  assert.equal(scrubbed, false)
})

test('scrubbed paths remove every auth field and normalize redirects to same-site paths', () => {
  const { getScrubbedAuthCallbackPath } = loadAuthCallback()
  const scrubbed = getScrubbedAuthCallbackPath(
    '/auth/login',
    '?keep=1&code=secret&token_hash=secret&type=signup&error=x&error_code=y&error_description=z&redirect=%2Fcanvas%3Fproject%3D1%23node',
  )
  assert.equal(scrubbed, '/auth/login?keep=1&redirect=%2Fcanvas%3Fproject%3D1%23node')
  assert.doesNotMatch(scrubbed, /secret|code=|token_hash|type=|error|#|https?:/)
  assert.equal(
    getScrubbedAuthCallbackPath('/auth/login', '?code=secret&redirect=https%3A%2F%2Fattacker.invalid'),
    '/auth/login?redirect=%2Fmodels',
  )
  assert.equal(getScrubbedAuthCallbackPath('/auth/login', '?code=secret'), '/auth/login')
})

function createNextResponseStub() {
  return class NextResponseStub {
    constructor(kind, status = 200, location = null) {
      this.kind = kind
      this.status = status
      this.location = location
      this.cookies = { set() {} }
    }
    static next() { return new NextResponseStub('next') }
    static json() { return new NextResponseStub('json') }
    static redirect(url) { return new NextResponseStub('redirect', 307, url.toString()) }
    static rewrite(url) { return new NextResponseStub('rewrite', 200, url.toString()) }
  }
}

function createRequest(pathname, search = '') {
  return {
    method: 'GET',
    headers: new Headers(),
    nextUrl: { pathname, search },
    url: `https://www.toryxai.com${pathname}${search}`,
    cookies: { get() { return undefined }, set() {} },
  }
}

function loadAuthenticatedMiddleware() {
  let clientCreations = 0
  const loaded = loadTypeScriptModule('src/middleware.ts', {
    'next/server': { NextResponse: createNextResponseStub() },
    '@supabase/ssr': {
      createServerClient() {
        clientCreations += 1
        return {
          auth: {
            async getUser() {
              return { data: { user: { id: 'controlled-user' } }, error: null }
            },
          },
        }
      },
    },
    '@/lib/feature-flags': {
      IMAGE_FACTORY_UPGRADING_MESSAGE: 'unavailable',
      isImageFactoryEnabled: () => true,
    },
    '@/lib/instagram/webhook-acceptance': {
      getInstagramWebhookAcceptanceDecision: () => 'disabled',
    },
  }, {
    NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://controlled.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'controlled-anon-key',
  })
  return {
    middleware: loaded.middleware,
    getClientCreations: () => clientCreations,
  }
}

test('middleware always leaves /auth/login to the client callback sink, including legacy hash requests', async () => {
  const harness = loadAuthenticatedMiddleware()
  for (const search of [
    '',
    '?code=controlled-code',
    '?token_hash=controlled-hash&type=signup',
    '?error=access_denied&error_description=expired',
    '?type=signup',
  ]) {
    const response = await harness.middleware(createRequest('/auth/login', search))
    assert.equal(response.kind, 'next', search)
  }
  // URL fragments never reach middleware; a plain /auth/login request must
  // therefore also pass so #access_token callbacks cannot be swallowed.
  const legacyHashTransport = await harness.middleware(createRequest('/auth/login'))
  assert.equal(legacyHashTransport.kind, 'next')
  assert.equal(harness.getClientCreations(), 0)
})

test('middleware keeps authenticated-entry redirects for only home and registration', async () => {
  const harness = loadAuthenticatedMiddleware()
  for (const pathname of ['/', '/auth/register']) {
    for (const search of ['', '?code=controlled-code', '?token_hash=hash&type=signup']) {
      const response = await harness.middleware(createRequest(pathname, search))
      assert.equal(response.kind, 'redirect', `${pathname}${search}`)
      assert.equal(response.location, 'https://www.toryxai.com/models')
    }
  }
  assert.equal(harness.getClientCreations(), 6)
})
