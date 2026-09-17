const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadFacebookPublish(fetch, delays) {
  function loadSource(filename) {
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
      exports: loadedModule.exports,
      module: loadedModule,
      require(request) {
        if (request === '@/lib/facebook/oauth') return { getFacebookAppSecretProof: () => 'proof' }
        if (request === '@/lib/publish/url-safety') return { isPrivateOrLoopbackHostname: () => false }
        if (request === '@/lib/oauth-broker/client') return { isBrokerEnabled: () => false }
        if (request === '@/lib/facebook/post-identity') return loadSource(path.join(process.cwd(), 'src/lib/facebook/post-identity.ts'))
        return require(request)
      },
      Blob,
      FormData,
      Headers,
      Response,
      URL,
      AbortSignal,
      fetch,
      process,
      setTimeout(resolve, delay) {
        delays.push(delay)
        resolve()
        return 0
      },
    }, { filename })
    return loadedModule.exports
  }
  return loadSource(path.join(process.cwd(), 'src/lib/facebook/publish.ts'))
}

function videoResponse() {
  return new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': '3' },
  })
}

test('Facebook publish retries only identity lookup until post id becomes available', async () => {
  const delays = []
  let uploadCalls = 0
  let identityCalls = 0
  const publish = loadFacebookPublish(async (input) => {
    const url = new URL(String(input))
    if (url.host === 'cdn.example.test') return videoResponse()
    if (url.host === 'graph-video.facebook.com') {
      uploadCalls += 1
      return new Response(JSON.stringify({ id: '200' }), { headers: { 'Content-Type': 'application/json' } })
    }
    identityCalls += 1
    return new Response(JSON.stringify({
      id: '200',
      permalink_url: '/reel/200/',
      ...(identityCalls >= 3 ? { post_id: '100_300' } : {}),
    }), { headers: { 'Content-Type': 'application/json' } })
  }, delays)

  const result = await publish.uploadFacebookVideoFromUrl('test-token', 'https://cdn.example.test/video.mp4', {
    pageId: '100',
    title: 'video',
  })

  assert.equal(uploadCalls, 1)
  assert.equal(identityCalls, 3)
  assert.deepEqual(delays, [750, 1500])
  assert.equal(result.videoId, '200')
  assert.equal(result.postId, '100_300')
  assert.equal(result.watchUrl, 'https://www.facebook.com/reel/200/')
})

test('Facebook publish bounds identity compensation and never repeats the upload', async () => {
  const delays = []
  let uploadCalls = 0
  let identityCalls = 0
  const publish = loadFacebookPublish(async (input) => {
    const url = new URL(String(input))
    if (url.host === 'cdn.example.test') return videoResponse()
    if (url.host === 'graph-video.facebook.com') {
      uploadCalls += 1
      return new Response(JSON.stringify({ id: '201' }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname.endsWith('/published_posts')) return Response.json({ data: [] })
    identityCalls += 1
    return new Response(JSON.stringify({ id: '201' }), { headers: { 'Content-Type': 'application/json' } })
  }, delays)

  const result = await publish.uploadFacebookVideoFromUrl('test-token', 'https://cdn.example.test/video.mp4', {
    pageId: '100',
    title: 'video',
  })

  assert.equal(uploadCalls, 1)
  assert.equal(identityCalls, 4)
  assert.deepEqual(delays, [750, 1500, 3000])
  assert.equal(result.postId, null)
})

test('Facebook publish recovers a different backing post ID after bounded video reads', async () => {
  let uploads = 0
  let scans = 0
  const publish = loadFacebookPublish(async input => {
    const url = new URL(input)
    if (url.host === 'cdn.example.test') return videoResponse()
    if (url.host === 'graph-video.facebook.com') { uploads++; return Response.json({ id: '200' }) }
    if (url.pathname.endsWith('/100_300')) return Response.json({ id: '100_300', object_id: '200', from: { id: '100' }, status_type: 'added_video', is_published: true })
    if (url.pathname.endsWith('/published_posts')) {
      scans++
      return Response.json({ data: [{ id: '100_300', object_id: '200' }] })
    }
    return Response.json({ id: '200' })
  }, [])
  const result = await publish.uploadFacebookVideoFromUrl('token', 'https://cdn.example.test/video.mp4', { pageId: '100', title: 'video' })
  assert.equal(uploads, 1)
  assert.equal(scans, 1)
  assert.equal(result.postId, '100_300')
})
