const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTransport(httpsModule, options = {}) {
  const filename = path.join(process.cwd(), 'src/lib/instagram/oauth-transport.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(output, {
    Buffer,
    URLSearchParams,
    clearTimeout,
    exports: loadedModule.exports,
    module: loadedModule,
    require: (id) => id === 'node:https' ? httpsModule : require(id),
    setTimeout: options.maxTimerMs
      ? (callback, timeout) => setTimeout(callback, Math.min(timeout, options.maxTimerMs))
      : setTimeout,
  }, { filename })
  return loadedModule.exports
}

function loadBroker(fetchImpl, env = {}) {
  const filename = path.join(process.cwd(), 'src/lib/oauth-broker/client.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(output, {
    AbortController,
    clearTimeout,
    exports: loadedModule.exports,
    fetch: fetchImpl,
    module: loadedModule,
    process: { env },
    require,
    setTimeout,
  }, { filename })
  return loadedModule.exports
}

function createHttpsMock(scenario = {}) {
  const observation = {
    authorizationHeaderPresent: false,
    bodyHasCode: false,
    bodyHasSecretField: false,
    hostAllowed: false,
    queryHasAccessTokenField: false,
    queryIsFixedFieldsOnly: false,
    requestCount: 0,
    validationPathIsFixed: false,
  }

  return {
    observation,
    module: {
      request(options, callback) {
        observation.requestCount += 1
        observation.hostAllowed = ['api.instagram.com', 'graph.instagram.com', 'graph.facebook.com'].includes(options.hostname)
        observation.authorizationHeaderPresent = typeof options.headers?.Authorization === 'string' && options.headers.Authorization.startsWith('Bearer ')
        const parsed = new URL(`https://safe.test${options.path}`)
        observation.queryHasAccessTokenField = parsed.searchParams.has('access_token')
        observation.validationPathIsFixed = parsed.pathname === '/me'
        observation.queryIsFixedFieldsOnly = parsed.searchParams.size === 1 && parsed.searchParams.get('fields') === 'user_id'
        let body = ''
        let timeoutCallback = null
        const request = new EventEmitter()
        request.setTimeout = (_timeout, handler) => { timeoutCallback = handler }
        request.write = (chunk) => { body += String(chunk) }
        request.destroy = () => {
          if (scenario.destroyDoesNotEmit) return
          queueMicrotask(() => request.emit('error', Object.assign(new Error('synthetic low-level failure'), {
            code: scenario.destroyErrorCode || 'ECONNRESET',
          })))
        }
        request.end = () => {
          const parsedBody = new URLSearchParams(body)
          observation.bodyHasCode = parsedBody.has('code')
          observation.bodyHasSecretField = parsedBody.has('client_secret')
          queueMicrotask(() => {
            if (scenario.throwOnEnd) throw new Error('synthetic synchronous request failure')
            if (scenario.timeout) {
              timeoutCallback()
              return
            }
            if (scenario.requestErrorCode) {
              request.emit('error', Object.assign(new Error('synthetic request failure'), {
                code: scenario.requestErrorCode,
              }))
              return
            }
            const response = new EventEmitter()
            response.statusCode = scenario.status || 200
            response.setEncoding = () => undefined
            response.resume = () => undefined
            response.destroy = () => undefined
            callback(response)
            if (scenario.hangResponse) return
            response.emit('data', scenario.body === undefined ? '{"ok":true}' : scenario.body)
            response.emit('end')
          })
        }
        return request
      },
    },
  }
}

test('uses fixed HTTPS targets for query and body OAuth requests without global fetch', async () => {
  const queryMock = createHttpsMock()
  const queryTransport = loadTransport(queryMock.module)
  const queryResult = await queryTransport.requestSensitiveInstagramOAuthJson({
    host: 'graph.instagram.com',
    path: '/access_token',
    method: 'GET',
    params: { grant_type: 'ig_exchange_token', access_token: 'synthetic-input' },
  })
  assert.equal(queryResult.status, 200)
  assert.equal(queryMock.observation.requestCount, 1)
  assert.equal(queryMock.observation.hostAllowed, true)
  assert.equal(queryMock.observation.queryHasAccessTokenField, true)

  const bodyMock = createHttpsMock()
  const bodyTransport = loadTransport(bodyMock.module)
  await bodyTransport.requestSensitiveInstagramOAuthJson({
    host: 'api.instagram.com',
    path: '/oauth/access_token',
    method: 'POST',
    params: {
      client_id: 'synthetic-client',
      client_secret: 'synthetic-client-secret',
      code: 'synthetic-code',
      grant_type: 'authorization_code',
      redirect_uri: 'https://callback.example.test/callback',
    },
  })
  assert.equal(bodyMock.observation.bodyHasCode, true)
  assert.equal(bodyMock.observation.bodyHasSecretField, true)
  assert.equal(bodyMock.observation.queryHasAccessTokenField, false)

  const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/instagram/oauth-transport.ts'), 'utf8')
  assert.doesNotMatch(source, /\bfetch\s*\(/)
})

test('blocks non-allowlisted hosts, paths, methods, and redirects', async () => {
  const mock = createHttpsMock()
  const transport = loadTransport(mock.module)
  const invalidInputs = [
    { host: 'untrusted.example', path: '/access_token', method: 'GET' },
    { host: 'graph.instagram.com', path: '/other', method: 'GET' },
    { host: 'graph.instagram.com', path: '/access_token?nested=true', method: 'GET' },
    { host: 'graph.instagram.com', path: '/me', method: 'GET' },
    { host: 'api.instagram.com', path: '/oauth/access_token', method: 'GET' },
  ]
  for (const input of invalidInputs) {
    await assert.rejects(
      transport.requestSensitiveInstagramOAuthJson({ ...input, params: {} }),
      (error) => error.code === 'oauth_transport_blocked_target'
    )
  }
  assert.equal(mock.observation.requestCount, 0)

  const redirectTransport = loadTransport(createHttpsMock({ status: 302 }).module)
  await assert.rejects(
    redirectTransport.requestSensitiveInstagramOAuthJson({
      host: 'graph.instagram.com',
      path: '/access_token',
      method: 'GET',
      params: {},
    }),
    (error) => error.code === 'oauth_transport_redirect_blocked' && error.httpStatus === 302
  )
})

test('maps timeout, TLS, network, HTTP, and invalid JSON failures to safe classifications', async () => {
  const scenarios = [
    [{ timeout: true }, 'oauth_transport_timeout'],
    [{ hangResponse: true, timeoutMs: 5, destroyDoesNotEmit: true }, 'oauth_transport_timeout'],
    [{ requestErrorCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, 'oauth_transport_tls_error'],
    [{ requestErrorCode: 'ENOTFOUND' }, 'oauth_transport_network_error'],
    [{ status: 400 }, 'oauth_transport_http_4xx'],
    [{ status: 503 }, 'oauth_transport_http_5xx'],
    [{ body: 'not-json' }, 'oauth_transport_invalid_response'],
  ]

  for (const [scenario, expectedCode] of scenarios) {
    const transport = loadTransport(createHttpsMock(scenario).module)
    await assert.rejects(
      transport.requestSensitiveInstagramOAuthJson({
        host: 'graph.instagram.com',
        path: '/refresh_access_token',
        method: 'GET',
        params: { access_token: 'synthetic-input' },
        timeoutMs: scenario.timeoutMs,
      }),
      (error) => {
        assert.equal(error.code, expectedCode)
        assert.equal(error.message.includes('synthetic-input'), false)
        assert.equal(error.message.includes('https://'), false)
        return true
      }
    )
  }
})

test('Instagram sensitive OAuth functions cannot fall back to global fetch', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/instagram/oauth.ts'), 'utf8')
  const start = source.indexOf('export async function exchangeInstagramCodeForToken')
  const end = source.indexOf('export async function revokeInstagramToken')
  const sensitiveSection = source.slice(start, end)
  assert.match(sensitiveSection, /requestSensitiveInstagramOAuthJson/)
  assert.doesNotMatch(sensitiveSection, /\bfetch\s*\(/)
})

test('validates revocation through one fixed read-only Bearer request', async () => {
  const invalidMock = createHttpsMock({ status: 400, body: '{"error":{"code":190}}' })
  const invalidTransport = loadTransport(invalidMock.module)
  const invalid = await invalidTransport.classifyInstagramAccessTokenValidity('synthetic-input')
  assert.equal(invalid.invalid, true)
  assert.equal(invalid.status, 'invalid')
  assert.equal(invalid.httpClassification, '4xx_invalid_token')
  assert.equal(invalidMock.observation.authorizationHeaderPresent, true)
  assert.equal(invalidMock.observation.queryHasAccessTokenField, false)
  assert.equal(invalidMock.observation.validationPathIsFixed, true)
  assert.equal(invalidMock.observation.queryIsFixedFieldsOnly, true)
  assert.equal(invalidMock.observation.requestCount, 1)

  const validMock = createHttpsMock()
  const validTransport = loadTransport(validMock.module)
  const valid = await validTransport.classifyInstagramAccessTokenValidity('synthetic-input')
  assert.equal(valid.invalid, false)
  assert.equal(valid.status, 'still_valid')
  assert.equal(valid.httpClassification, '2xx')
  assert.equal(validMock.observation.authorizationHeaderPresent, true)
  assert.equal(validMock.observation.queryHasAccessTokenField, false)

})

test('treats non-invalid-token failures as inconclusive', async () => {
  const scenarios = [
    [{ status: 400, body: '{"error":{"code":10}}' }, '4xx_other'],
    [{ status: 401, body: '{"error":{"code":10}}' }, '4xx_other'],
    [{ status: 429, body: '{"error":{"code":4}}' }, '4xx_other'],
    [{ status: 503 }, '5xx'],
    [{ status: 302 }, '3xx_redirect'],
    [{ requestErrorCode: 'ENOTFOUND' }, 'network_error'],
    [{ requestErrorCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, 'tls_error'],
    [{ hangResponse: true, timeoutMs: 5, destroyDoesNotEmit: true }, 'timeout'],
  ]

  for (const [scenario, expectedClassification] of scenarios) {
    const transport = loadTransport(
      createHttpsMock(scenario).module,
      scenario.hangResponse ? { maxTimerMs: 5 } : {}
    )
    const result = await transport.classifyInstagramAccessTokenValidity('synthetic-input')
    assert.equal(result.invalid, false)
    assert.equal(result.status, 'inconclusive')
    assert.equal(result.httpClassification, expectedClassification)
  }
})

test('absolute deadline settles once even when destroy emits no error', async () => {
  const mock = createHttpsMock({ hangResponse: true, destroyDoesNotEmit: true })
  const transport = loadTransport(mock.module, { maxTimerMs: 5 })
  let settlements = 0
  await transport.requestSensitiveInstagramOAuthJson({
    host: 'graph.instagram.com',
    path: '/refresh_access_token',
    method: 'GET',
    params: { access_token: 'synthetic-input' },
  }).then(
    () => { settlements += 1 },
    (error) => {
      settlements += 1
      assert.equal(error.code, 'oauth_transport_timeout')
    }
  )
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(settlements, 1)
})

test('broker errors redact upstream URLs and credential-shaped values', async () => {
  const broker = loadBroker(async () => new Response(JSON.stringify({
    ok: false,
    error: 'Provider rejected https://provider.example/path?access_token=synthetic-input Bearer synthetic-input',
    httpStatus: 400,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }), {
    OAUTH_BROKER_URL: 'https://broker.example.test',
    BROKER_SECRET: 'synthetic-broker-secret',
  })

  await assert.rejects(
    broker.callBroker('instagram', 'syntheticOperation', {}),
    (error) => {
      assert.equal(error.httpStatus, 400)
      assert.equal(error.message.includes('synthetic-input'), false)
      assert.equal(error.message.includes('https://'), false)
      return true
    }
  )
})
