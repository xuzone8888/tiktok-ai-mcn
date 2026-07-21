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

const selection = loadTypeScriptModule('src/lib/publish/upload-selection.ts')

function createSuccessfulUpload() {
  return selection.createUploadedVideoSelection({
    id: 'upload-1',
    name: 'reel.mp4',
    publicUrl: 'https://media.example.test/reel.mp4?signature=required',
    thumbnail: 'data:image/jpeg;base64,preview',
    duration: 5500,
    size: 1024,
    contentType: 'video/mp4',
    title: 'reel',
  })
}

test('commits a successful PUT result to the selected videos used by publish readiness', () => {
  const uploaded = createSuccessfulUpload()
  const selected = selection.commitUploadResults([], [uploaded], 40)

  assert.equal(selected.length, 1)
  assert.equal(selected[0].url, uploaded.url)
  assert.equal(selected[0].name, 'reel.mp4')
  assert.equal(selected[0].size, 1024)
  assert.equal(selected[0].contentType, 'video/mp4')
  assert.equal(selected[0].title, 'reel')
  assert.equal(Object.hasOwn(selected[0], 'uploadUrl'), false)
  assert.equal(selection.isPlatformPublishReady({
    selectedVideoCount: selected.length,
    selectedAccountCount: 1,
    privacySelected: true,
    isPublishing: false,
  }), true)
})

test('does not select a video when credentials, probe, or PUT returns no successful result', () => {
  const selected = selection.commitUploadResults([], [null], 40)

  assert.equal(selected.length, 0)
  assert.equal(selection.isPlatformPublishReady({
    selectedVideoCount: selected.length,
    selectedAccountCount: 1,
    privacySelected: true,
    isPublishing: false,
  }), false)
})

test('removing an uploaded video resets the selected count and publish readiness', () => {
  const selected = selection.commitUploadResults([], [createSuccessfulUpload()], 40)
  const removed = selection.removeSelectedVideo(selected, 'upload-1')

  assert.equal(removed.length, 0)
  assert.equal(selection.isPlatformPublishReady({
    selectedVideoCount: removed.length,
    selectedAccountCount: 1,
    privacySelected: true,
    isPublishing: false,
  }), false)
})

test('component commits upload results once and publishes from the same selected video URL', () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), 'src/components/publish/platform/PlatformPublishPage.tsx'),
    'utf8'
  )

  assert.ok(page.includes('const uploadResults = await Promise.all(validFiles.map(uploadSingleFile))'))
  assert.ok(page.includes('commitUploadResults(current, uploadResults, MAX_VIDEOS)'))
  assert.ok(page.includes('videos: selectedVideos.map((video) => ({'))
  assert.ok(page.includes('url: video.url'))
  assert.ok(page.includes('localUrl = URL.createObjectURL(file)'))
  assert.ok(page.includes('localUrl = undefined'))
})

test('generic merge semantics preserve existing non-Instagram selections', () => {
  const existing = [{ id: 'facebook-asset', type: 'asset', url: 'https://example.test/a.mp4' }]
  const uploaded = [{ id: 'facebook-upload', type: 'upload', url: 'https://example.test/b.mp4' }]
  const selected = selection.mergeSelectedVideos(existing, uploaded, 40)

  assert.deepEqual(JSON.parse(JSON.stringify(selected)), [...existing, ...uploaded])
})
