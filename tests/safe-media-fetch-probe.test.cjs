const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function createTransport(responseSpecs, calls) {
  return function request(url, options, callback) {
    calls.push({
      url: url.toString(),
      method: options.method,
      headers: { ...options.headers },
    })

    const request = new EventEmitter()
    let requestClosed = false
    const closeRequest = () => {
      if (requestClosed) return
      requestClosed = true
      request.emit('close')
    }

    request.destroy = (error) => {
      if (error) queueMicrotask(() => request.emit('error', error))
      queueMicrotask(closeRequest)
    }
    request.end = () => {
      const spec = responseSpecs.shift()
      if (!spec) {
        queueMicrotask(() => request.emit('error', new Error('Missing fake response')))
        queueMicrotask(closeRequest)
        return
      }

      const response = new EventEmitter()
      let responseClosed = false
      const closeResponse = () => {
        if (responseClosed) return
        responseClosed = true
        response.emit('close')
      }
      response.statusCode = spec.status
      response.headers = { ...(spec.headers || {}) }
      response.resume = () => queueMicrotask(closeResponse)
      response.destroy = () => queueMicrotask(closeResponse)

      callback(response)
      queueMicrotask(closeRequest)
    }

    return request
  }
}

function loadSafeMediaFetch({
  responses = [],
  addresses = [{ address: '93.184.216.34', family: 4 }],
} = {}) {
  const filename = path.join(process.cwd(), 'src/lib/safe-media-fetch.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const calls = []
  const transport = createTransport([...responses], calls)
  const loadedModule = { exports: {} }
  const localRequire = (request) => {
    if (request === 'node:dns/promises') {
      return {
        lookup: async () => addresses.map((address) => ({ ...address })),
      }
    }
    if (request === 'node:http' || request === 'node:https') {
      return { request: transport }
    }
    return require(request)
  }

  vm.runInNewContext(output, {
    AbortSignal,
    Buffer,
    URL,
    clearTimeout,
    console,
    exports: loadedModule.exports,
    module: loadedModule,
    process,
    require: localRequire,
    setTimeout,
  }, { filename })

  return { safeMediaFetch: loadedModule.exports, calls }
}

test('marks only representation-bearing media responses as accessible', async () => {
  const cases = [
    [200, true],
    [203, true],
    [206, true],
    [201, false],
    [202, false],
    [204, false],
    [205, false],
    [207, false],
    [208, false],
    [226, false],
  ]

  for (const [status, accessible] of cases) {
    const { safeMediaFetch } = loadSafeMediaFetch({
      responses: [{ status }],
    })
    const result = await safeMediaFetch.probeExternalMediaUrl(
      'https://media.example.test/asset.mp4'
    )

    assert.equal(result.status, status)
    assert.equal(
      result.accessible,
      accessible,
      `HTTP ${status} accessibility`
    )
  }
})

test('continues to reject non-2xx responses with their HTTP status', async () => {
  for (const status of [400, 404, 410, 429, 500, 503]) {
    const { safeMediaFetch } = loadSafeMediaFetch({
      responses: [{ status }],
    })

    await assert.rejects(
      safeMediaFetch.probeExternalMediaUrl(
        'https://media.example.test/missing.mp4'
      ),
      (error) =>
        error?.name === 'ExternalMediaFetchError' &&
        error?.statusCode === status
    )
  }
})

test('allows a public redirect while stripping cross-origin credentials', async () => {
  const { safeMediaFetch, calls } = loadSafeMediaFetch({
    responses: [
      {
        status: 302,
        headers: { location: 'https://cdn.example.test/final.mp4' },
      },
      { status: 206, headers: { 'content-type': 'video/mp4' } },
    ],
  })

  const result = await safeMediaFetch.probeExternalMediaUrl(
    'https://media.example.test/asset.mp4',
    {
      headers: {
        Authorization: 'Bearer private',
        Cookie: 'session=private',
        'Proxy-Authorization': 'Basic private',
        'X-Request-ID': 'probe-1',
      },
    }
  )

  assert.equal(result.accessible, true)
  assert.equal(result.status, 206)
  assert.equal(result.finalUrl, 'https://cdn.example.test/final.mp4')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].method, 'HEAD')
  assert.equal(calls[0].headers.authorization, 'Bearer private')
  assert.equal(calls[1].headers.authorization, undefined)
  assert.equal(calls[1].headers.cookie, undefined)
  assert.equal(calls[1].headers['proxy-authorization'], undefined)
  assert.equal(calls[1].headers['x-request-id'], 'probe-1')
})

test('rejects a redirect to a private address before making the second request', async () => {
  const { safeMediaFetch, calls } = loadSafeMediaFetch({
    responses: [
      {
        status: 302,
        headers: { location: 'http://127.0.0.1/internal.mp4' },
      },
    ],
  })

  await assert.rejects(
    safeMediaFetch.probeExternalMediaUrl(
      'https://media.example.test/asset.mp4'
    ),
    (error) => error?.name === 'ExternalMediaFetchError'
  )
  assert.equal(calls.length, 1)
})

test('rejects mixed public/private DNS answers before opening a connection', async () => {
  const { safeMediaFetch, calls } = loadSafeMediaFetch({
    responses: [{ status: 200 }],
    addresses: [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
  })

  await assert.rejects(
    safeMediaFetch.probeExternalMediaUrl(
      'https://media.example.test/asset.mp4'
    ),
    (error) => error?.name === 'ExternalMediaFetchError'
  )
  assert.equal(calls.length, 0)
})
