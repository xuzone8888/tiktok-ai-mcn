const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath) {
  const filename = path.join(process.cwd(), relativePath)
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
    require,
  }, { filename })

  return loadedModule.exports
}

const media = loadTypeScriptModule('src/lib/publish/platform-media.ts')
const ONE_GB = 1024 * 1024 * 1024

test('uses the Instagram MP4 and MOV selection policy and display label', () => {
  const accepted = media.getAcceptedVideoExtensions(['.mp4', '.mov'])
  assert.deepEqual([...accepted], ['.mp4', '.mov'])
  assert.equal(media.getVideoFormatsLabel(accepted), '.mp4 .mov')
  assert.equal(media.isVideoSelectionAllowed({
    filename: 'reel.mp4',
    fileSize: ONE_GB,
    acceptedExtensions: accepted,
    maxFileSizeBytes: ONE_GB,
  }), true)
  assert.equal(media.isVideoSelectionAllowed({
    filename: 'reel.mov',
    fileSize: ONE_GB - 1,
    acceptedExtensions: accepted,
    maxFileSizeBytes: ONE_GB,
  }), true)
})

test('rejects unsupported Instagram formats and MIME types', () => {
  assert.equal(media.validateInstagramMediaUpload({
    filename: 'reel.webm',
    contentType: 'video/webm',
    fileSize: 1024,
  }), 'unsupported_format')
  assert.equal(media.validateInstagramMediaUpload({
    filename: 'reel.mp4',
    contentType: 'application/octet-stream',
    fileSize: 1024,
  }), 'unsupported_format')
})

test('rejects invalid and oversized Instagram files', () => {
  for (const fileSize of [0, Number.NaN, ONE_GB + 1]) {
    assert.notEqual(media.validateInstagramMediaUpload({
      filename: 'reel.mp4',
      contentType: 'video/mp4',
      fileSize,
    }), null)
  }
})

test('accepts MP4 and MOV Instagram files at the 1GB boundary', () => {
  assert.equal(media.validateInstagramMediaUpload({
    filename: 'reel.mp4',
    contentType: 'video/mp4',
    fileSize: ONE_GB,
  }), null)
  assert.equal(media.validateInstagramMediaUpload({
    filename: 'reel.mov',
    contentType: 'video/quicktime',
    fileSize: ONE_GB,
  }), null)
  assert.equal(media.validateInstagramMediaUpload({
    filename: 'reel.mov',
    contentType: 'video/mp4; codecs=avc1',
    fileSize: ONE_GB,
  }), null)
})

test('preserves the default Facebook and legacy selection formats', () => {
  const accepted = media.getAcceptedVideoExtensions()
  assert.deepEqual([...accepted], ['.mp4', '.webm', '.mov'])
  assert.equal(media.getVideoFormatsLabel(), '.mp4 .webm .mov')
  assert.equal(media.isVideoSelectionAllowed({
    filename: 'facebook.webm',
    fileSize: 500 * 1024 * 1024,
    maxFileSizeBytes: 500 * 1024 * 1024,
  }), true)
})

test('maps Instagram upload errors without changing other platform behavior', () => {
  assert.equal(media.getInstagramUploadErrorMessage({
    code: 'probe_unavailable',
    status: 503,
    isEnglish: true,
  }), 'Video validation is temporarily unavailable on the server.')
  assert.equal(media.getInstagramUploadErrorMessage({
    code: 'media_not_supported',
    serverMessage: '视频不符合 Instagram Reels 媒体要求',
    status: 422,
    isEnglish: false,
  }), '视频不符合 Instagram Reels 媒体要求')
})
