const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

test('global background executors share one lazy user lookup', () => {
  const source = read('src/components/background-task-manager.tsx')
  assert.equal((source.match(/fetch\("\/api\/user\/credits"/g) || []).length, 1)
  assert.match(source, /function useCurrentUserIdResolver/)
  assert.match(source, /useVideoTaskExecutor\(resolveCurrentUserId\)/)
  assert.match(source, /useImageTaskExecutor\(resolveCurrentUserId\)/)
  assert.match(source, /useQuickGenTaskExecutor\(resolveCurrentUserId\)/)
  assert.match(source, /useQuickGenImageTaskExecutor\(resolveCurrentUserId\)/)
})

test('header trusts server-provided credits on initial mount', () => {
  const source = read('src/components/layout/header.tsx')
  assert.match(source, /if \(initialUser\) \{\s+setLoading\(false\);\s+\} else \{/)
  assert.match(source, /document\.visibilityState !== "visible"/)
  assert.match(source, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/)
})

test('sidebar exposes route prefetch and immediate pending feedback', () => {
  const sidebar = read('src/components/layout/sidebar.tsx')
  const loading = read('src/app/(main)/loading.tsx')
  assert.match(sidebar, /router\.prefetch\(item\.href\)/)
  assert.match(sidebar, /setPendingHref\(item\.href\)/)
  assert.match(sidebar, /aria-busy=\{isNavigating\}/)
  assert.match(loading, /正在打开页面/)
})
