const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, stubs = {}, env = {}) {
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
  const localRequire = id => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id)
  vm.runInNewContext(output, {
    Headers,
    URL,
    console,
    exports: loadedModule.exports,
    module: loadedModule,
    process: { env },
    require: localRequire,
  }, { filename })
  return loadedModule.exports
}

function createNextResponseStub() {
  return class NextResponseStub {
    constructor(body = null, init = {}) {
      this.body = body
      this.status = init.status || 200
      this.cookies = { set() {} }
    }

    static next() {
      return new NextResponseStub(null, { status: 200 })
    }

    static json(body, init = {}) {
      return new NextResponseStub(body, init)
    }

    static redirect() {
      return new NextResponseStub(null, { status: 307 })
    }

    static rewrite() {
      return new NextResponseStub(null, { status: 200 })
    }
  }
}

function createRequest(pathname, method = 'GET') {
  return {
    method,
    headers: new Headers(),
    nextUrl: { pathname, search: '' },
    url: `https://acceptance.invalid${pathname}`,
    cookies: {
      get() { return undefined },
      set() {},
    },
  }
}

function loadGate() {
  return loadTypeScriptModule('src/lib/instagram/webhook-acceptance.ts')
}

function loadMiddleware(flagValue) {
  const gate = loadGate()
  let supabaseClientCreations = 0
  const env = { NODE_ENV: 'test' }
  if (flagValue !== undefined) env.INSTAGRAM_WEBHOOK_ACCEPTANCE_ONLY = flagValue

  const loaded = loadTypeScriptModule('src/middleware.ts', {
    'next/server': { NextResponse: createNextResponseStub() },
    '@supabase/ssr': {
      createServerClient() {
        supabaseClientCreations += 1
        throw new Error('Supabase must not be reached by the acceptance gate tests.')
      },
    },
    '@/lib/feature-flags': {
      IMAGE_FACTORY_UPGRADING_MESSAGE: 'unavailable',
      isImageFactoryEnabled: () => true,
    },
    '@/lib/instagram/webhook-acceptance': gate,
  }, env)

  return {
    middleware: loaded.middleware,
    getSupabaseClientCreations: () => supabaseClientCreations,
  }
}

test('acceptance flag is exact and only allows the exact webhook pathname', () => {
  const { getInstagramWebhookAcceptanceDecision } = loadGate()

  assert.equal(getInstagramWebhookAcceptanceDecision('true', '/api/instagram/webhook'), 'allow')
  assert.equal(getInstagramWebhookAcceptanceDecision('true', '/api/instagram/webhook/'), 'not_found')
  assert.equal(getInstagramWebhookAcceptanceDecision('TRUE', '/api/instagram/webhook'), 'disabled')
  assert.equal(getInstagramWebhookAcceptanceDecision(' true', '/api/instagram/webhook'), 'disabled')
  assert.equal(getInstagramWebhookAcceptanceDecision(undefined, '/api/instagram/webhook'), 'disabled')
})

test('acceptance mode allows exact webhook GET and POST without Supabase auth', async () => {
  const harness = loadMiddleware('true')

  for (const method of ['GET', 'POST']) {
    const response = await harness.middleware(createRequest('/api/instagram/webhook', method))
    assert.equal(response.status, 200)
  }
  assert.equal(harness.getSupabaseClientCreations(), 0)
})

test('acceptance mode returns 404 for pages, APIs, refund, and spoofed webhook paths', async () => {
  const harness = loadMiddleware('true')
  const rejectedPaths = [
    '/',
    '/dashboard',
    '/ordinary-page',
    '/api/arbitrary',
    '/api/user/credits/refund',
    '/api/instagram/webhook/',
    '/api/instagram/webhook-extra',
    '/prefix/api/instagram/webhook',
  ]

  for (const pathname of rejectedPaths) {
    const response = await harness.middleware(createRequest(pathname))
    assert.equal(response.status, 404, pathname)
  }
  assert.equal(harness.getSupabaseClientCreations(), 0)
})

test('missing or false acceptance flag preserves the existing API pass-through', async () => {
  for (const flagValue of [undefined, 'false', 'TRUE']) {
    const harness = loadMiddleware(flagValue)
    const webhookResponse = await harness.middleware(createRequest('/api/instagram/webhook'))
    const refundResponse = await harness.middleware(createRequest('/api/user/credits/refund', 'POST'))

    assert.equal(webhookResponse.status, 200)
    assert.equal(refundResponse.status, 200)
    assert.equal(harness.getSupabaseClientCreations(), 0)
  }
})

test('middleware gate is wired before response and Supabase setup', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/middleware.ts'), 'utf8')
  const decisionIndex = source.indexOf('getInstagramWebhookAcceptanceDecision(')
  const nextResponseIndex = source.indexOf('NextResponse.next(')
  const supabaseIndex = source.indexOf('createServerClient(')

  assert.ok(decisionIndex >= 0)
  assert.ok(nextResponseIndex > decisionIndex)
  assert.ok(supabaseIndex > decisionIndex)
  assert.match(source, /webhookAcceptanceDecision === "not_found"/)
})

test('webhook route explicitly uses the Node.js runtime', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/instagram/webhook/route.ts'),
    'utf8'
  )
  assert.match(source, /export const runtime = ['"]nodejs['"]/)
})

test('environment templates document the server-only gate as disabled by default', () => {
  for (const filename of ['env.example', 'env.template']) {
    const source = fs.readFileSync(path.join(process.cwd(), filename), 'utf8')
    assert.match(source, /^INSTAGRAM_WEBHOOK_ACCEPTANCE_ONLY=false$/m)
    assert.doesNotMatch(source, /^NEXT_PUBLIC_INSTAGRAM_WEBHOOK_ACCEPTANCE_ONLY=/m)
  }
})
