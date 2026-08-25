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
  vm.runInNewContext(output, {
    Buffer,
    Headers,
    Response,
    URL,
    URLSearchParams,
    console,
    exports: loadedModule.exports,
    fetch: context.fetch || fetch,
    module: loadedModule,
    process: { env: context.env || {} },
    require(id) {
      return Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id)
    },
  }, { filename })
  return loadedModule.exports
}

function createSignedRequest(payload, secret) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${signature}.${encodedPayload}`
}

test('Meta signed requests require a valid signature, algorithm, user, and recent timestamp', () => {
  const { verifyFacebookSignedRequest } = loadTypeScriptModule('src/lib/facebook/signed-request.ts')
  const secret = 'synthetic-app-secret'
  const now = 1_800_000_000
  const signedRequest = createSignedRequest({
    algorithm: 'HMAC-SHA256',
    issued_at: now - 60,
    user_id: 'facebook-user-1',
  }, secret)

  assert.equal(verifyFacebookSignedRequest(signedRequest, secret, now).user_id, 'facebook-user-1')
  assert.throws(
    () => verifyFacebookSignedRequest(signedRequest, 'different-secret', now),
    /invalid_signed_request_signature/,
  )
  assert.throws(
    () => verifyFacebookSignedRequest(createSignedRequest({
      algorithm: 'HMAC-SHA1',
      issued_at: now,
      user_id: 'facebook-user-1',
    }, secret), secret, now),
    /invalid_signed_request_algorithm/,
  )
  assert.throws(
    () => verifyFacebookSignedRequest(createSignedRequest({
      algorithm: 'HMAC-SHA256',
      issued_at: now - (25 * 60 * 60),
      user_id: 'facebook-user-1',
    }, secret), secret, now),
    /expired_signed_request/,
  )
  assert.throws(
    () => verifyFacebookSignedRequest(createSignedRequest({
      algorithm: 'HMAC-SHA256',
      issued_at: now,
    }, secret), secret, now),
    /missing_signed_request_user/,
  )
})

test('Facebook Page webhook subscription lifecycle does not put tokens in the URL', async () => {
  const calls = []
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
    async fetch(input, init) {
      calls.push({ input: String(input), init })
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  await oauth.subscribeFacebookPageToWebhooks('page/unsafe', 'synthetic-page-token')
  assert.equal(calls.length, 1)
  assert.match(calls[0].input, /\/v25\.0\/page%2Funsafe\/subscribed_apps$/)
  assert.doesNotMatch(calls[0].input, /synthetic-page-token/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-page-token')
  const body = new URLSearchParams(calls[0].init.body)
  assert.equal(body.get('subscribed_fields'), 'feed')
  assert.ok(body.get('appsecret_proof'))

  await oauth.unsubscribeFacebookPageFromWebhooks('page/unsafe', 'synthetic-page-token')
  assert.equal(calls.length, 2)
  assert.match(calls[1].input, /\/page%2Funsafe\/subscribed_apps$/)
  assert.doesNotMatch(calls[1].input, /synthetic-page-token/)
  assert.equal(calls[1].init.method, 'DELETE')
  assert.equal(calls[1].init.headers.Authorization, 'Bearer synthetic-page-token')
})

test('Facebook Page authorization fails closed when any review permission is missing', () => {
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
  })

  const granted = oauth.FACEBOOK_PAGE_SCOPES.map((permission) => ({
    permission,
    status: 'granted',
  }))
  assert.doesNotThrow(() => oauth.assertFacebookRequiredPageScopes(granted))

  const partial = granted.map((entry) => entry.permission === 'pages_manage_engagement'
    ? { ...entry, status: 'declined' }
    : entry)
  assert.deepEqual(
    Array.from(oauth.getMissingFacebookPageScopes(partial)),
    ['pages_manage_engagement'],
  )
  assert.throws(
    () => oauth.assertFacebookRequiredPageScopes(partial),
    /pages_manage_engagement/,
  )
})

test('Facebook user identity lookup keeps the user token out of the URL', async () => {
  let request = null
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
    async fetch(input, init) {
      request = { url: String(input), init }
      return new Response(JSON.stringify({ id: 'facebook-user-1' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  const user = await oauth.getFacebookUserInfo('synthetic-user-token')
  assert.equal(user.id, 'facebook-user-1')
  assert.doesNotMatch(request.url, /synthetic-user-token|access_token=/)
  assert.equal(request.init.headers.Authorization, 'Bearer synthetic-user-token')
})

test('Facebook permission lookup stores only permissions Meta actually granted', async () => {
  let request = null
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
    async fetch(input, init) {
      request = { url: String(input), init }
      return new Response(JSON.stringify({
        data: [
          { permission: 'pages_manage_posts', status: 'granted' },
          { permission: 'pages_manage_engagement', status: 'declined' },
          { permission: 'pages_manage_posts', status: 'granted' },
        ],
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  const permissions = await oauth.getFacebookGrantedPermissions('synthetic-user-token')
  assert.deepEqual(
    Array.from(oauth.getGrantedFacebookScopes(permissions)),
    ['pages_manage_posts'],
  )
  assert.doesNotMatch(request.url, /synthetic-user-token|access_token=/)
  assert.equal(request.init.headers.Authorization, 'Bearer synthetic-user-token')
})

test('Facebook Page discovery recovers every selected granular target when the accounts edge is partial', async () => {
  const calls = []
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
    async fetch(input) {
      const url = String(input)
      calls.push(url)
      if (url.includes('/me/accounts?')) {
        return new Response(JSON.stringify({
          data: [{
            id: 'page-1',
            name: 'First Page',
            access_token: 'page-token-1',
            tasks: ['CREATE_CONTENT'],
          }],
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/debug_token?')) {
        return new Response(JSON.stringify({
          data: {
            is_valid: true,
            granular_scopes: [{
              scope: 'pages_manage_posts',
              target_ids: ['page-1', 'page-2'],
            }],
          },
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/page-2?')) {
        return new Response(JSON.stringify({
          id: 'page-2',
          name: 'Second Page',
          access_token: 'page-token-2',
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`Unexpected Facebook request: ${url}`)
    },
  })

  const pages = await oauth.getMyFacebookPages('synthetic-user-token')

  assert.deepEqual(Array.from(pages, (page) => page.pageId), ['page-1', 'page-2'])
  assert.deepEqual(Array.from(pages[1].tasks), ['CREATE_CONTENT'])
  assert.equal(calls.filter((url) => url.includes('/page-1?')).length, 0)
  assert.equal(calls.filter((url) => url.includes('/page-2?')).length, 1)
})

test('Facebook Page discovery reports an unrecoverable selected target without dropping available Pages', async () => {
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
    async fetch(input) {
      const url = String(input)
      if (url.includes('/me/accounts?')) {
        return new Response(JSON.stringify({
          data: [{
            id: 'page-1',
            name: 'First Page',
            access_token: 'page-token-1',
            tasks: ['CREATE_CONTENT'],
          }],
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/debug_token?')) {
        return new Response(JSON.stringify({
          data: {
            is_valid: true,
            granular_scopes: [{
              scope: 'pages_manage_posts',
              target_ids: ['page-1', 'page-2'],
            }],
          },
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/page-2?')) {
        return new Response(JSON.stringify({ error: { message: 'Page is unavailable' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected Facebook request: ${url}`)
    },
  })

  const discovery = await oauth.discoverMyFacebookPages('synthetic-user-token')

  assert.deepEqual(Array.from(discovery.pages, (page) => page.pageId), ['page-1'])
  assert.deepEqual(
    Array.from(discovery.warnings, (warning) => ({ code: warning.code, count: warning.count })),
    [{ code: 'selected_pages_unavailable', count: 1 }],
  )
  assert.doesNotMatch(JSON.stringify(discovery.warnings), /page-2/)
})

test('Facebook Page discovery keeps available Pages when selection diagnostics are temporarily unavailable', async () => {
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
    async fetch(input) {
      const url = String(input)
      if (url.includes('/me/accounts?')) {
        return new Response(JSON.stringify({
          data: [{
            id: 'page-1',
            name: 'First Page',
            access_token: 'page-token-1',
            tasks: ['CREATE_CONTENT'],
          }],
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/debug_token?')) {
        return new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected Facebook request: ${url}`)
    },
  })

  const discovery = await oauth.discoverMyFacebookPages('synthetic-user-token')

  assert.deepEqual(Array.from(discovery.pages, (page) => page.pageId), ['page-1'])
  assert.deepEqual(Array.from(discovery.warnings, (warning) => warning.code), [
    'selection_diagnostics_unavailable',
  ])
})

test('Facebook Page discovery keeps Meta rate limits and server failures fatal', async () => {
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
    async fetch(input) {
      const url = String(input)
      if (url.includes('/me/accounts?')) {
        return new Response(JSON.stringify({
          data: [{
            id: 'page-1',
            name: 'First Page',
            access_token: 'page-token-1',
            tasks: ['CREATE_CONTENT'],
          }],
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/debug_token?')) {
        return new Response(JSON.stringify({
          data: {
            is_valid: true,
            granular_scopes: [{
              scope: 'pages_manage_posts',
              target_ids: ['page-1', 'page-2'],
            }],
          },
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/page-2?')) {
        return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected Facebook request: ${url}`)
    },
  })

  await assert.rejects(
    oauth.discoverMyFacebookPages('synthetic-user-token'),
    /temporarily unavailable/,
  )
})

test('Facebook binding saves every publishable Page and localizes skipped Page warnings', () => {
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
  })
  const page = (pageId, name, tasks) => ({
    pageId,
    name,
    category: null,
    thumbnailUrl: null,
    followerCount: 0,
    fanCount: 0,
    link: null,
    tasks,
    accessToken: `token-${pageId}`,
  })
  const discovery = {
    contractVersion: 2,
    pages: [
      page('page-1', 'First Page', ['CREATE_CONTENT']),
      page('page-2', 'Second Page', ['CREATE_CONTENT']),
      page('page-3', 'Third Page', ['CREATE_CONTENT']),
      page('page-4', 'Fourth Page', ['CREATE_CONTENT']),
      page('page-5-private', 'Read Only Page', ['ANALYZE']),
    ],
    warnings: [{ code: 'selected_pages_unavailable', count: 1 }],
  }

  const english = oauth.planFacebookPageBinding(discovery, 'en_US')
  const chinese = oauth.planFacebookPageBinding(discovery, 'zh_CN')

  assert.deepEqual(Array.from(english.pagesToSave, (item) => item.pageId), [
    'page-1', 'page-2', 'page-3', 'page-4',
  ])
  assert.match(english.warning, /Read Only Page/)
  assert.match(english.warning, /1 selected Page could not be connected/)
  assert.doesNotMatch(english.warning, /page-5-private/)
  assert.match(chinese.warning, /已跳过/)
  assert.match(chinese.warning, /另有 1 个已选择的 Page/)
})

test('Facebook binding still fails when no selected Page can publish', () => {
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
  })

  assert.throws(
    () => oauth.planFacebookPageBinding({
      contractVersion: 2,
      pages: [{
        pageId: 'read-only-page',
        name: 'Read Only Page',
        category: null,
        thumbnailUrl: null,
        followerCount: 0,
        fanCount: 0,
        link: null,
        tasks: ['ANALYZE'],
        accessToken: 'read-only-token',
      }],
      warnings: [],
    }, 'en_US'),
    /does not have permission to publish content/,
  )
})

test('Facebook Page discovery uses a versioned broker contract in production mode', async () => {
  let brokerRequest = null
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      async callBroker(platform, op, args, options) {
        brokerRequest = { platform, op, args, options }
        return { contractVersion: 2, pages: [], warnings: [] }
      },
      isBrokerEnabled: () => true,
    },
  })

  const result = await oauth.discoverMyFacebookPages('synthetic-user-token')

  assert.equal(result.contractVersion, 2)
  assert.equal(brokerRequest.platform, 'facebook')
  assert.equal(brokerRequest.op, 'discoverMyFacebookPages')
  assert.equal(brokerRequest.args.userAccessToken, 'synthetic-user-token')
  assert.equal(brokerRequest.options.timeoutMs, 30_000)
})

test('Facebook Page discovery rejects a stale broker response instead of running half-updated behavior', async () => {
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      async callBroker() {
        return [{ pageId: 'legacy-page' }]
      },
      isBrokerEnabled: () => true,
    },
  })

  await assert.rejects(
    oauth.discoverMyFacebookPages('synthetic-user-token'),
    /broker is out of date/,
  )
})

test('Facebook Page discovery localizes the HTTP 400 returned by an older broker whitelist', async () => {
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      async callBroker() {
        throw new Error('OAuth broker returned transport status 400')
      },
      isBrokerEnabled: () => true,
    },
  })

  await assert.rejects(
    oauth.discoverMyFacebookPages('synthetic-user-token'),
    /broker is out of date/,
  )
})

test('Facebook Page refresh does not depend on diagnostics for a target already returned by the accounts edge', async () => {
  const oauth = loadTypeScriptModule('src/lib/facebook/oauth.ts', {
    '@/lib/oauth-broker/client': {
      callBroker() {
        throw new Error('broker should not be called')
      },
      isBrokerEnabled: () => false,
    },
  }, {
    env: {
      FACEBOOK_CLIENT_ID: 'synthetic-client',
      FACEBOOK_CLIENT_SECRET: 'synthetic-secret',
      FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
    },
    async fetch(input) {
      const url = String(input)
      if (url.includes('/oauth/access_token?')) {
        return new Response(JSON.stringify({
          access_token: 'long-lived-user-token',
          expires_in: 3600,
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/me/accounts?')) {
        return new Response(JSON.stringify({
          data: [{
            id: 'page-1',
            name: 'First Page',
            access_token: 'page-token-1',
            tasks: ['CREATE_CONTENT'],
          }],
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/debug_token?')) {
        throw new Error('refresh should not call debug_token when its target Page is already available')
      }
      throw new Error(`Unexpected Facebook request: ${url}`)
    },
  })

  const refreshed = await oauth.refreshFacebookPageAccessToken('existing-user-token', 'page-1')

  assert.equal(refreshed.page.pageId, 'page-1')
  assert.equal(refreshed.access_token, 'page-token-1')
})

test('review callbacks, user controls, and service-role deletion primitives stay wired together', () => {
  const callback = fs.readFileSync(path.join(process.cwd(), 'src/app/api/facebook/auth/callback/route.ts'), 'utf8')
  const broker = fs.readFileSync(path.join(process.cwd(), 'src/app/api/oauth-broker/call/route.ts'), 'utf8')
  const dataRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/facebook/data/route.ts'), 'utf8')
  const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260728_facebook_review_compliance.sql'), 'utf8')
  const privacy = fs.readFileSync(path.join(process.cwd(), 'src/app/(landing)/privacy/page.tsx'), 'utf8')
  const platformConfig = fs.readFileSync(path.join(process.cwd(), 'src/lib/publish/platform-config.ts'), 'utf8')
  const platformApi = fs.readFileSync(path.join(process.cwd(), 'src/lib/social-comments/platform-api.ts'), 'utf8')
  const publishTasks = fs.readFileSync(path.join(process.cwd(), 'src/app/api/facebook/publish/tasks/route.ts'), 'utf8')
  const supabaseConfig = fs.readFileSync(path.join(process.cwd(), 'supabase/config.toml'), 'utf8')

  assert.match(callback, /getFacebookUserInfo/)
  assert.match(callback, /assertFacebookRequiredPageScopes\(permissions\)/)
  assert.match(callback, /planFacebookPageBinding\(pageDiscovery, locale\)/)
  assert.match(callback, /redirectParams\.warning = bindingPlan\.warning/)
  assert.match(callback, /getGrantedFacebookScopes/)
  assert.match(callback, /subscribeFacebookPageToWebhooks/)
  assert.match(callback, /authorized_by_facebook_user_id/)
  assert.match(broker, /getFacebookUserInfo/)
  assert.match(broker, /discoverMyFacebookPages/)
  assert.match(broker, /subscribeFacebookPageToWebhooks/)
  assert.match(broker, /unsubscribeFacebookPageFromWebhooks/)
  assert.match(platformConfig, /deleteAllDataEndpoint:\s*'\/api\/facebook\/data'/)
  assert.match(platformConfig, /pages_read_user_content/)
  assert.match(platformConfig, /pages_manage_engagement/)
  assert.match(supabaseConfig, /\[functions\.facebook-comments-webhook\]\s*verify_jwt = false/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.delete_facebook_user_data\(UUID\) FROM PUBLIC/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.delete_facebook_authorization_data\(TEXT\) TO service_role/)
  assert.ok(
    dataRoute.indexOf("admin.rpc('delete_facebook_user_data'") <
      dataRoute.indexOf('unsubscribeFacebookPageFromWebhooks(pageId, pageToken)'),
    'local Facebook deletion must happen before best-effort remote cleanup',
  )
  assert.match(publishTasks, /isPrivateOrLoopbackHostname/)
  assert.match(privacy, /10\. YouTube API Services and Google User Data/)
  assert.doesNotMatch(privacy, /11\. YouTube API Services and Google User Data/)
  assert.match(
    platformApi,
    /const INSTAGRAM_API_VERSION = process\.env\.INSTAGRAM_API_VERSION \|\| 'v20\.0'/,
  )
})
