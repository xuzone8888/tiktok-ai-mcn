/* eslint-disable @typescript-eslint/no-require-imports, import/order */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function read(relativePath) {
  return fs.readFileSync(relativePath, 'utf8')
}

function loadTypeScriptModule(relativePath, mocks = {}) {
  const filename = path.join(process.cwd(), relativePath)
  const source = read(relativePath)
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
      if (Object.hasOwn(mocks, request)) return mocks[request]
      return require(request)
    },
    URL,
    URLSearchParams,
  }, { filename })

  return loadedModule.exports
}

const tiktokRoutes = loadTypeScriptModule('src/lib/tiktok/routes.ts')
const publishTabs = loadTypeScriptModule('src/hooks/use-persisted-publish-tab.ts', {
  react: {
    useCallback: () => {},
    useEffect: () => {},
    useState: () => {},
  },
})

test('TikTok navigation uses management names and canonical routes', () => {
  const sidebar = read('src/components/layout/sidebar.tsx')
  const publishPage = read('src/app/(main)/publish/page.tsx')
  const accountsPage = read('src/app/(main)/publish/accounts/page.tsx')

  assert.match(sidebar, /TikTok Account Management/)
  assert.match(sidebar, /TikTok 账号管理/)
  assert.match(sidebar, /href: TIKTOK_ACCOUNTS_PATH/)
  assert.match(sidebar, /TikTok Video Management/)
  assert.match(sidebar, /TikTok 视频管理/)
  assert.match(sidebar, /href: TIKTOK_PUBLISH_PATH/)
  assert.match(publishPage, />TikTok 视频管理</)
  assert.match(accountsPage, />TikTok 账号管理</)
})

test('TikTok sidebar maps canonical, legacy, and comments paths to the correct item', () => {
  const isActive = tiktokRoutes.isSidebarNavItemActive
  const accounts = tiktokRoutes.TIKTOK_ACCOUNTS_PATH
  const videos = tiktokRoutes.TIKTOK_PUBLISH_PATH

  assert.equal(isActive('/tiktok-publish/accounts', accounts), true)
  assert.equal(isActive('/publish/accounts', accounts), true)
  assert.equal(isActive('/tiktok-publish', videos), true)
  assert.equal(isActive('/tiktok-publish/comments', videos), true)
  assert.equal(isActive('/publish', videos), true)
  assert.equal(isActive('/tiktok-publish/accounts', videos), false)
  assert.equal(isActive('/youtube-publish', '/youtube-publish'), true)
  assert.equal(isActive('/youtube-publish/accounts', '/youtube-publish'), false)
})

test('TikTok OAuth return URLs always use the canonical accounts path', () => {
  const callbackRoute = read('src/app/api/tiktok/auth/callback/route.ts')
  const authUrlRoute = read('src/app/api/tiktok/auth/url/route.ts')
  const redirect = new URL(tiktokRoutes.buildTikTokAccountsUrl('https://app.example.test', {
    success: 'true',
    name: 'Creator & Team',
  }))

  assert.equal(redirect.pathname, '/tiktok-publish/accounts')
  assert.equal(redirect.searchParams.get('success'), 'true')
  assert.equal(redirect.searchParams.get('name'), 'Creator & Team')
  assert.match(callbackRoute, /buildTikTokAccountsUrl/)
  assert.match(authUrlRoute, /`\$\{TIKTOK_ACCOUNTS_PATH\}\?demo=1`/)
  assert.doesNotMatch(callbackRoute, /\/publish\/accounts/)
  assert.doesNotMatch(authUrlRoute, /\/publish\/accounts/)
})

test('canonical TikTok routes reuse the legacy implementations without copying them', () => {
  const publishRoute = read('src/app/(main)/tiktok-publish/page.tsx')
  const accountsRoute = read('src/app/(main)/tiktok-publish/accounts/page.tsx')
  const commentsRoute = read('src/app/(main)/tiktok-publish/comments/page.tsx')

  assert.match(publishRoute, /export \{ default \} from "\.\.\/publish\/page"/)
  assert.match(accountsRoute, /export \{ default \} from "\.\.\/\.\.\/publish\/accounts\/page"/)
  assert.match(commentsRoute, /SocialCommentsClient/)
  assert.match(commentsRoute, /platformLock="tiktok"/)
})

test('TikTok management shell persists its three primary tabs in the URL', () => {
  const publishPage = read('src/app/(main)/publish/page.tsx')

  assert.match(publishPage, /usePersistedPublishTab\(true\)/)
  assert.match(publishPage, /label: '创建发布'/)
  assert.match(publishPage, /label: '视频列表'/)
  assert.match(publishPage, /label: '评论管理'/)
})

test('publish tab helpers normalize invalid states and preserve unrelated URL state', () => {
  assert.equal(publishTabs.resolvePublishPageTab(null, true), 'create')
  assert.equal(publishTabs.resolvePublishPageTab('invalid', true), 'create')
  assert.equal(publishTabs.resolvePublishPageTab('tasks', true), 'tasks')
  assert.equal(publishTabs.resolvePublishPageTab('comments', true), 'comments')
  assert.equal(publishTabs.resolvePublishPageTab('comments', false), 'create')

  assert.equal(
    publishTabs.buildPublishPageTabUrl('https://app.example.test/tiktok-publish?from=sidebar#form', 'tasks'),
    '/tiktok-publish?from=sidebar&tab=tasks#form'
  )
  assert.equal(
    publishTabs.buildPublishPageTabUrl('https://app.example.test/tiktok-publish?from=sidebar&tab=comments#form', 'create'),
    '/tiktok-publish?from=sidebar#form'
  )
})

test('multi-task publishing remains available as a create mode', () => {
  const publishPage = read('src/app/(main)/publish/page.tsx')

  assert.match(publishPage, /type CreateMode = 'single' \| 'multiTask'/)
  assert.match(publishPage, /label: '单次发布'/)
  assert.match(publishPage, /label: '多任务发布'/)
  assert.match(publishPage, /createMode === 'single'/)
  assert.match(publishPage, /<MultiTaskPublisher onCreated=\{\(\) => setActiveTab\('tasks'\)\} \/>/)
  assert.doesNotMatch(publishPage, /activeTab === 'multiTask'/)
})

test('TikTok comments keep an explicit rollout gate and use the shared client only when enabled', () => {
  const publishPage = read('src/app/(main)/publish/page.tsx')
  const unavailable = read('src/components/publish/tiktok/TikTokCommentsUnavailable.tsx')
  const commentsRoute = read('src/app/(main)/tiktok-publish/comments/page.tsx')

  assert.match(publishPage, /NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED/)
  assert.match(publishPage, /<SocialCommentsClient[\s\S]*platformLock="tiktok"[\s\S]*embedded[\s\S]*tiktokReplyEnabled=/)
  assert.match(publishPage, /<TikTokCommentsUnavailable embedded \/>/)
  assert.match(commentsRoute, /isTikTokCommentsPageEnabled/)
  assert.match(commentsRoute, /notFound\(\)/)
  assert.match(unavailable, /Business OAuth/)
  assert.doesNotMatch(unavailable, /fetch\(/)
})

test('YouTube, Facebook, and Instagram use the same create-tab label', () => {
  const youtube = read('src/app/(main)/youtube-publish/YouTubePublishClient.tsx')
  const platformPage = read('src/components/publish/platform/PlatformPublishPage.tsx')

  assert.match(youtube, /label: isEnglish \? "Create Post" : "创建发布"/)
  assert.match(platformPage, /label: isEnglish \? 'Create Post' : '创建发布'/)
})
