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
  assert.match(calls[0].input, /\/page%2Funsafe\/subscribed_apps$/)
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
  assert.match(callback, /getGrantedFacebookScopes/)
  assert.match(callback, /subscribeFacebookPageToWebhooks/)
  assert.match(callback, /authorized_by_facebook_user_id/)
  assert.match(broker, /getFacebookUserInfo/)
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
