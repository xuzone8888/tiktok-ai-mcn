const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, stubs = {}, context = {}) {
  const filename = path.join(process.cwd(), relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const loadedModule = { exports: {} }
  const localRequire = (id) => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id)

  vm.runInNewContext(output, {
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    exports: loadedModule.exports,
    fetch: context.fetch || fetch,
    module: loadedModule,
    process: { env: context.env || {} },
    require: localRequire,
    Response,
    setTimeout,
  }, { filename })

  return loadedModule.exports
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const oauth = loadTypeScriptModule('src/lib/instagram/oauth.ts', {
  '@/lib/instagram/graph-auth': {
    instagramGraphHeaders: (accessToken, headers = {}) => ({
      ...headers,
      Authorization: `Bearer ${accessToken}`,
    }),
  },
  '@/lib/oauth-broker/client': {
    callBroker: () => { throw new Error('OAuth broker must not be called in this test.') },
    isBrokerEnabled: () => false,
  },
  '@/lib/instagram/oauth-transport': {
    requestSensitiveInstagramOAuthJson: () => { throw new Error('Sensitive transport must not be called in URL builder tests.') },
  },
})
const oauthState = loadTypeScriptModule('src/lib/instagram/oauth-state.ts')

test('rebuilds a Native Instagram authorization URL from a stored state', () => {
  const authUrl = oauth.buildInstagramAuthorizationUrlForConfig({
    authMode: 'instagram',
    clientId: 'native-client',
    clientSecret: 'native-secret',
    loginConfigId: null,
    nativeEmbedUrl: null,
    redirectUri: 'https://example.test/api/instagram/auth/callback',
    scopes: [
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
    ],
  }, {
    codeVerifier: null,
    state: 'stored-native-state',
  })

  const parsed = new URL(authUrl)
  assert.equal(parsed.searchParams.get('state'), 'stored-native-state')
  assert.equal(parsed.searchParams.get('response_type'), 'code')
  assert.equal(parsed.searchParams.get('code_challenge'), null)
  assert.equal(parsed.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments')
})

test('rebuilds the Facebook Login PKCE challenge from a stored verifier', () => {
  const codeVerifier = 'stored-facebook-code-verifier'
  const authUrl = oauth.buildInstagramAuthorizationUrlForConfig({
    authMode: 'facebook',
    clientId: 'facebook-client',
    clientSecret: 'facebook-secret',
    loginConfigId: null,
    nativeEmbedUrl: null,
    redirectUri: 'https://example.test/api/instagram/auth/callback',
    scopes: ['instagram_basic', 'instagram_manage_comments'],
  }, {
    codeVerifier,
    state: 'stored-facebook-state',
  })

  const parsed = new URL(authUrl)
  const expectedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  assert.equal(parsed.searchParams.get('state'), 'stored-facebook-state')
  assert.equal(parsed.searchParams.get('code_challenge'), expectedChallenge)
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256')
})

test('selects one deterministic unexpired pending state for reuse', () => {
  const nowMs = Date.parse('2026-07-10T08:00:00.000Z')
  const selected = oauthState.selectReusableInstagramAuthState([
    {
      code_verifier: null,
      created_at: '2026-07-10T07:57:00.000Z',
      expires_at: '2026-07-10T07:59:00.000Z',
      state: 'expired-state',
      status: 'pending',
    },
    {
      code_verifier: null,
      created_at: '2026-07-10T07:58:00.000Z',
      expires_at: '2026-07-10T08:08:00.000Z',
      state: 'first-valid-state',
      status: 'pending',
    },
    {
      code_verifier: null,
      created_at: '2026-07-10T07:59:00.000Z',
      expires_at: '2026-07-10T08:09:00.000Z',
      state: 'second-valid-state',
      status: 'pending',
    },
  ], nowMs)

  assert.equal(selected.state, 'first-valid-state')
})

test('recognizes a partial unique-index race for winner readback', () => {
  assert.equal(oauthState.shouldReadBackInstagramAuthStateAfterInsertError({ code: '23505' }), true)
  assert.equal(oauthState.shouldReadBackInstagramAuthStateAfterInsertError({ code: '42P01' }), false)
  assert.equal(oauthState.shouldReadBackInstagramAuthStateAfterInsertError(null), false)
})

test('uses Bearer headers for Native account discovery and token revocation', async () => {
  const requests = []
  const graphAuth = {
    instagramGraphHeaders: (accessToken, headers = {}) => ({
      ...headers,
      Authorization: `Bearer ${accessToken}`,
    }),
  }
  const nativeOauth = loadTypeScriptModule('src/lib/instagram/oauth.ts', {
    '@/lib/instagram/graph-auth': graphAuth,
    '@/lib/oauth-broker/client': {
      callBroker: () => { throw new Error('OAuth broker must not be called in this test.') },
      isBrokerEnabled: () => false,
    },
    '@/lib/instagram/oauth-transport': {
      requestSensitiveInstagramOAuthJson: () => { throw new Error('Sensitive transport must not be called in discovery tests.') },
    },
  }, {
    env: { INSTAGRAM_AUTH_MODE: 'instagram' },
    fetch: async (input, init = {}) => {
      const url = new URL(String(input))
      requests.push({
        bearerHeaderPresent: new Headers(init.headers || {}).get('Authorization')?.startsWith('Bearer ') === true,
        method: init.method || 'GET',
        urlHasAccessToken: url.searchParams.has('access_token'),
      })
      return init.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : jsonResponse({ user_id: 'account', username: 'account-name' })
    },
  })

  await nativeOauth.discoverMyInstagramAccounts('synthetic-token')
  await nativeOauth.revokeInstagramToken('synthetic-token')

  assert.equal(requests.length, 2)
  assert.equal(requests.every((request) => request.bearerHeaderPresent), true)
  assert.equal(requests.every((request) => request.urlHasAccessToken === false), true)
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'DELETE'])
})

test('routes sensitive Native token operations through the dedicated transport', async () => {
  const transportCalls = []
  let businessFetchCalls = 0
  const nativeOauth = loadTypeScriptModule('src/lib/instagram/oauth.ts', {
    '@/lib/instagram/graph-auth': {
      instagramGraphHeaders: (accessToken, headers = {}) => ({
        ...headers,
        Authorization: `Bearer ${accessToken}`,
      }),
    },
    '@/lib/oauth-broker/client': {
      callBroker: () => { throw new Error('OAuth broker must not be called in this test.') },
      isBrokerEnabled: () => false,
    },
    '@/lib/instagram/oauth-transport': {
      requestSensitiveInstagramOAuthJson: async (input) => {
        transportCalls.push({
          hostAllowed: ['api.instagram.com', 'graph.instagram.com'].includes(input.host),
          path: input.path,
          method: input.method,
          hasAccessTokenParam: Object.prototype.hasOwnProperty.call(input.params, 'access_token'),
          hasClientSecretParam: Object.prototype.hasOwnProperty.call(input.params, 'client_secret'),
          hasCodeParam: Object.prototype.hasOwnProperty.call(input.params, 'code'),
        })
        return {
          status: 200,
          json: { access_token: 'synthetic-result', expires_in: 3600 },
        }
      },
    },
  }, {
    env: {
      INSTAGRAM_AUTH_MODE: 'instagram',
      INSTAGRAM_NATIVE_CLIENT_ID: 'synthetic-client',
      INSTAGRAM_NATIVE_CLIENT_SECRET: 'synthetic-client-secret',
      INSTAGRAM_REDIRECT_URI: 'https://callback.example.test/api/instagram/auth/callback',
    },
    fetch: async (input, init = {}) => {
      businessFetchCalls += 1
      const url = new URL(String(input))
      assert.equal(url.searchParams.has('access_token'), false)
      assert.equal(new Headers(init.headers || {}).get('Authorization')?.startsWith('Bearer '), true)
      return jsonResponse({ user_id: 'account', username: 'account-name' })
    },
  })

  await nativeOauth.exchangeInstagramCodeForToken('synthetic-code')
  await nativeOauth.exchangeForLongLivedUserToken('synthetic-short-token')
  await nativeOauth.refreshInstagramAccountAccessToken('synthetic-refresh-token', 'account')

  assert.equal(transportCalls.length, 3)
  assert.equal(transportCalls.every((call) => call.hostAllowed), true)
  assert.deepEqual(transportCalls.map((call) => call.path), [
    '/oauth/access_token',
    '/access_token',
    '/refresh_access_token',
  ])
  assert.equal(transportCalls[0].method, 'POST')
  assert.equal(transportCalls[0].hasCodeParam, true)
  assert.equal(transportCalls[0].hasClientSecretParam, true)
  assert.equal(transportCalls[1].hasAccessTokenParam, true)
  assert.equal(transportCalls[2].hasAccessTokenParam, true)
  assert.equal(businessFetchCalls, 1)
})

test('broker-enabled token exchange never falls back to the local sensitive transport', async () => {
  let brokerCalls = 0
  let transportCalls = 0
  const brokerOauth = loadTypeScriptModule('src/lib/instagram/oauth.ts', {
    '@/lib/instagram/graph-auth': {
      instagramGraphHeaders: () => ({}),
    },
    '@/lib/oauth-broker/client': {
      callBroker: async () => {
        brokerCalls += 1
        return { access_token: 'synthetic-result' }
      },
      isBrokerEnabled: () => true,
    },
    '@/lib/instagram/oauth-transport': {
      requestSensitiveInstagramOAuthJson: async () => {
        transportCalls += 1
        return { status: 200, json: { access_token: 'unexpected' } }
      },
    },
  })

  await brokerOauth.exchangeForLongLivedUserToken('synthetic-input')
  assert.equal(brokerCalls, 1)
  assert.equal(transportCalls, 0)
})
