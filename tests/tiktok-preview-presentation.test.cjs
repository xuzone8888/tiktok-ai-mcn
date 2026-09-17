const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, AbortController, ...globals })
  return exports
}

function loadAction(file, variable, globals) {
  const source = fs.readFileSync(file, 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let action
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === variable) {
      action = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(action, `missing action ${variable}`)
  const output = ts.transpileModule('const action = ' + action.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return vm.runInNewContext(output + '\naction', { URLSearchParams, Map, tr: text => text, ...globals })
}

test('polling refreshes all loaded TikTok pages without collapsing them to page one', async () => {
  const { createLatestRequestGate } = load('src/lib/publish/latest-request.ts')
  let rows = Array.from({ length: 40 }, (_, i) => ({ id: String(i) }))
  let page = 2
  let hasMore
  let requestedUrl
  const refresh = loadAction('src/components/publish/TaskManager.tsx', 'fetchTasks', {
    requestGate: createLatestRequestGate(), activeTab: 'all', dateRange: 'today',
    setLoading() {}, setSelectedTask() {}, toast() {}, console,
    setTasks: value => { rows = typeof value === 'function' ? value(rows) : value },
    setPage: value => { page = value }, setHasMore: value => { hasMore = value },
    fetch: async url => { requestedUrl = url; return { ok: true, json: async () => ({ tasks: rows.map(row => ({ ...row, status: 'completed' })) }) } },
  })
  await refresh(true, page, true)
  assert.equal(new URL(requestedUrl, 'https://test.local').searchParams.get('limit'), '40')
  assert.equal(new URL(requestedUrl, 'https://test.local').searchParams.get('offset'), '0')
  assert.equal(rows.length, 40)
  assert.equal(rows[39].status, 'completed')
  assert.equal(page, 2)
  assert.equal(hasMore, true)
})

test('external SIGNED_OUT clears stored thumbnails and notifies mounted previews', async () => {
  const cache = load('src/lib/publish/local-task-preview.ts')
  cache.rememberLocalTaskPreview('item', 'data:image/jpeg;base64,YQ==', 100, 'alice')
  let cleared = 0
  const unsubscribe = cache.onLocalTaskPreviewsCleared(() => { cleared++ })
  const file = 'src/components/layout/header.tsx'
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree).endsWith('.onAuthStateChange')) callback = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(callback)
  const output = ts.transpileModule('const callback = ' + callback.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const onAuth = vm.runInNewContext(output + '\ncallback', { clearLocalTaskPreviews: cache.clearLocalTaskPreviews, setUser() {}, fetchUser() {} })
  await onAuth('SIGNED_OUT', null)
  assert.equal(cache.getLocalTaskPreview('item', 101, 'alice'), null)
  assert.equal(cleared, 1)
  unsubscribe()
  cache.clearLocalTaskPreviews()
  assert.equal(cleared, 1)
})
const presentation = load('src/lib/publish/task-presentation.ts')

test('title prefers caption, then source filename, then a visible fallback', () => {
  assert.equal(presentation.taskVideoTitle({ title: '  Caption ', source_video_name: 'clip.mp4' }), 'Caption')
  assert.equal(presentation.taskVideoTitle({ title: ' ', source_video_name: 'clip.mp4' }), 'clip.mp4')
  assert.equal(presentation.taskVideoTitle({}), '未命名视频')
})
test('task previews never treat internal or non-HTTPS addresses as playable video', () => {
  for (const value of [null, '', 'file-upload://private', 'blob:https://site/id', 'javascript:alert(1)', 'http://site/video', 'https://user:secret@site/video']) {
    assert.equal(presentation.playableTaskVideoUrl(value), null)
  }
  assert.equal(presentation.playableTaskVideoUrl('https://media.example/video.mp4'), 'https://media.example/video.mp4')
})
test('local thumbnail cache validates type and size, expires and evicts oldest entries', () => {
  const cache = load('src/lib/publish/local-task-preview.ts')
  const image = 'data:image/jpeg;base64,YQ=='
  cache.rememberLocalTaskPreview('a', image, 100)
  assert.equal(cache.getLocalTaskPreview('a', 101), image)
  assert.equal(cache.getLocalTaskPreview('a', 3_600_100), null)
  cache.rememberLocalTaskPreview('bad', 'https://remote/image', 100)
  cache.rememberLocalTaskPreview('large', 'data:image/jpeg;base64,' + 'A'.repeat(100_000), 100)
  assert.equal(cache.getLocalTaskPreview('bad', 101), null)
  assert.equal(cache.getLocalTaskPreview('large', 101), null)
  for (let i = 0; i < 25; i++) cache.rememberLocalTaskPreview(String(i), image, 100)
  assert.equal(cache.getLocalTaskPreview('0', 101), null)
  assert.equal(cache.getLocalTaskPreview('24', 101), image)
})

test('thumbnail survives a module reload only for its owner, expires, and clears on logout', () => {
  const values = new Map()
  const sessionStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  const file = 'src/lib/publish/local-task-preview.ts'
  const globals = { window: { sessionStorage } }
  const a = load(file, globals)
  const image = 'data:image/jpeg;base64,YQ=='
  a.rememberLocalTaskPreview('item', image, 100, 'alice')
  const b = load(file, globals)
  assert.equal(b.getLocalTaskPreview('item', 101, 'alice'), image)
  assert.equal(b.getLocalTaskPreview('item', 101, 'bob'), null)
  assert.equal(b.getLocalTaskPreview('item', 3_600_100, 'alice'), null)
  assert.equal(JSON.parse([...values.values()][0]).length, 0)
  b.rememberLocalTaskPreview('item', image, 100, 'alice')
  b.clearLocalTaskPreviews()
  assert.equal(load(file, globals).getLocalTaskPreview('item', 101, 'alice'), null)
})

test('blocked storage and invalid files fail safely without affecting publishing', () => {
  const window = { get sessionStorage() { throw Error('blocked') } }
  const cache = load('src/lib/publish/local-task-preview.ts', { window })
  cache.rememberLocalTaskPreview('item', 'data:image/jpeg;base64,YQ==', 100, 'alice')
  assert.equal(cache.getLocalTaskPreview('item', 101, 'alice'), 'data:image/jpeg;base64,YQ==')
  assert.equal(cache.isLocalPreviewFile({ name: 'clip.MOV', type: '' }), true)
  assert.equal(cache.isLocalPreviewFile({ name: 'clip.mp4', type: 'text/html' }), false)
  assert.equal(cache.isLocalPreviewFile({ name: 'clip.txt', type: '' }), false)
})

test('late responses cannot commit data, errors, pagination or final loading state', async () => {
  const { createLatestRequestGate } = load('src/lib/publish/latest-request.ts')
  const gate = createLatestRequestGate()
  const commits = []
  let releaseOld
  const old = gate.begin()
  const pending = new Promise(resolve => { releaseOld = resolve }).then(() => {
    if (old.isCurrent()) commits.push('old data', 'old error', 'old page', 'old loading')
  })
  const fresh = gate.begin()
  assert.equal(old.signal.aborted, true)
  if (fresh.isCurrent()) commits.push('fresh')
  releaseOld()
  await pending
  assert.deepEqual(commits, ['fresh'])
  gate.cancel()
  assert.equal(fresh.isCurrent(), false)
  assert.equal(gate.begin().isCurrent(), true)
})
