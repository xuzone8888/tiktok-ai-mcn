const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadFacebookPublish(fetch, delays) {
  const filename = path.join(process.cwd(), 'src/lib/facebook/publish.ts')
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
      return require(request)
    },
    Blob,
    FormData,
    Headers,
    Response,
    URL,
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
      return new Response(JSON.stringify({ id: 'video-1' }), { headers: { 'Content-Type': 'application/json' } })
    }
    identityCalls += 1
    return new Response(JSON.stringify({
      id: 'video-1',
      permalink_url: '/reel/video-1/',
      ...(identityCalls >= 3 ? { post_id: 'page-1_post-1' } : {}),
    }), { headers: { 'Content-Type': 'application/json' } })
  }, delays)

  const result = await publish.uploadFacebookVideoFromUrl('test-token', 'https://cdn.example.test/video.mp4', {
    pageId: 'page-1',
    title: 'video',
  })

  assert.equal(uploadCalls, 1)
  assert.equal(identityCalls, 3)
  assert.deepEqual(delays, [750, 1500])
  assert.equal(result.videoId, 'video-1')
  assert.equal(result.postId, 'page-1_post-1')
  assert.equal(result.watchUrl, '/reel/video-1/')
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
      return new Response(JSON.stringify({ id: 'video-2' }), { headers: { 'Content-Type': 'application/json' } })
    }
    identityCalls += 1
    return new Response(JSON.stringify({ id: 'video-2' }), { headers: { 'Content-Type': 'application/json' } })
  }, delays)

  const result = await publish.uploadFacebookVideoFromUrl('test-token', 'https://cdn.example.test/video.mp4', {
    pageId: 'page-1',
    title: 'video',
  })

  assert.equal(uploadCalls, 1)
  assert.equal(identityCalls, 4)
  assert.deepEqual(delays, [750, 1500, 3000])
  assert.equal(result.postId, null)
})
