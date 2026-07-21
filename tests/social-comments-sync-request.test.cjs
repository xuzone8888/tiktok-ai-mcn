const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, moduleMap = {}) {
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
    require: (request) => moduleMap[request] || require(request),
  }, { filename })

  return loadedModule.exports
}

const capabilities = loadTypeScriptModule('src/lib/social-comments/platform-capabilities.ts')
const syncRequest = loadTypeScriptModule('src/lib/social-comments/sync-request.ts', {
  '@/lib/social-comments/platform-capabilities': capabilities,
  '@/lib/social-comments/types': { isSocialPlatform: (value) => ['youtube', 'tiktok', 'instagram', 'facebook'].includes(value) },
})

test('rejects Instagram manual sync without a content id', () => {
  const contentId = syncRequest.normalizeSocialCommentContentId(undefined)
  assert.equal(syncRequest.isSocialCommentSyncTargetValid('instagram', 'manual', contentId), false)
})

test('rejects Instagram manual sync with a blank content id', () => {
  const contentId = syncRequest.normalizeSocialCommentContentId('  \n\t ')
  assert.equal(contentId, '')
  assert.equal(syncRequest.isSocialCommentSyncTargetValid('instagram', 'manual', contentId), false)
})

test('allows Instagram manual sync with an explicit content id', () => {
  const contentId = syncRequest.normalizeSocialCommentContentId('  content-id  ')
  assert.equal(contentId, 'content-id')
  assert.equal(syncRequest.isSocialCommentSyncTargetValid('instagram', 'manual', contentId), true)
})

test('preserves YouTube manual recent sync and auto target rules', () => {
  assert.equal(syncRequest.isSocialCommentSyncTargetValid('youtube', 'manual', ''), true)
  assert.equal(syncRequest.isSocialCommentSyncTargetValid('youtube', 'auto', ''), false)
  assert.equal(syncRequest.isSocialCommentSyncTargetValid('youtube', 'auto', 'content-id'), true)
  assert.equal(syncRequest.isSocialCommentSyncTargetValid('instagram', 'auto', 'content-id'), false)
})
