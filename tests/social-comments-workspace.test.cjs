const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const client = fs.readFileSync(path.join(root, 'src/components/social-comments/SocialCommentsClient.tsx'), 'utf8')
const service = fs.readFileSync(path.join(root, 'src/lib/social-comments/service.ts'), 'utf8')
const types = fs.readFileSync(path.join(root, 'src/lib/social-comments/types.ts'), 'utf8')
const youtubeClient = fs.readFileSync(path.join(root, 'src/app/(main)/youtube-publish/YouTubePublishClient.tsx'), 'utf8')
const youtubeCommentsPage = fs.readFileSync(path.join(root, 'src/app/(main)/youtube-publish/comments/page.tsx'), 'utf8')
const facebookCommentsPage = fs.readFileSync(path.join(root, 'src/app/(main)/facebook-publish/comments/page.tsx'), 'utf8')
const accountsRoute = fs.readFileSync(path.join(root, 'src/app/api/social-comments/accounts/route.ts'), 'utf8')
const facebookBootstrapRoute = fs.readFileSync(path.join(root, 'src/app/api/social-comments/facebook-bootstrap/route.ts'), 'utf8')
const platformPublishPage = fs.readFileSync(path.join(root, 'src/components/publish/platform/PlatformPublishPage.tsx'), 'utf8')
const guardSource = fs.readFileSync(path.join(root, 'src/components/social-comments/workspace-request-guard.ts'), 'utf8')
const guardModule = new Module('workspace-request-guard')
guardModule._compile(ts.transpileModule(guardSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, 'workspace-request-guard.js')
const { createWorkspaceRequestGuard } = guardModule.exports

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('account changes clear stale detail and synchronously restore only account-keyed caches', () => {
  assert.match(client, /const changeAccount = \(nextAccountId: string\) =>/)
  assert.match(client, /contentAbortRef\.current\?\.abort\(\)/)
  assert.match(client, /commentsAbortRef\.current\.get\(key\)\?\.abort\(\)/)
  assert.match(client, /setSelectedCommentId\(null\)/)
  assert.match(client, /setDetailComments\(\[\]\)/)
  assert.match(client, /contentCacheRef\.current\.get\(key\)/)
  assert.match(client, /commentsCacheRef\.current\.get\(key\)/)
})

test('A completion after switching to B updates only A cache and cannot replace B visible state', async () => {
  const guard = createWorkspaceRequestGuard('instagram:A')
  const aToken = guard.capture()
  const aDone = deferred()
  const cache = new Map()
  let visible = 'A initial'

  const aWorkflow = (async () => {
    const value = await aDone.promise
    cache.set('instagram:A', value)
    if (guard.isActive(aToken)) visible = value
  })()

  guard.activate('instagram:B')
  visible = 'B visible'
  aDone.resolve('A refreshed')
  await aWorkflow

  assert.equal(cache.get('instagram:A'), 'A refreshed')
  assert.equal(visible, 'B visible')
})

test('an old finally cannot close the loading state owned by a newer workspace request', async () => {
  const guard = createWorkspaceRequestGuard('youtube:A')
  const aToken = guard.capture()
  const aDone = deferred()
  let loadingOwner = aToken

  const aWorkflow = (async () => {
    await aDone.promise
    if (guard.isActive(aToken) && loadingOwner === aToken) loadingOwner = null
  })()

  const bToken = guard.activate('youtube:B')
  loadingOwner = bToken
  aDone.resolve()
  await aWorkflow

  assert.deepEqual(loadingOwner, bToken)
})

test('content lookup is bounded by returned published rows rather than all historical tasks', () => {
  assert.doesNotMatch(service, /OWNED_TASK_PAGE_SIZE|TASK_ITEM_CHUNK_SIZE|getOwnedTaskNameMap/)
  assert.match(service, /\.in\('account_id', accountIds\)[\s\S]*\.eq\('status', 'published'\)[\s\S]*\.limit\(limit\)/)
  assert.match(service, /queryPublishedContentItems\([\s\S]*accountIdList,[\s\S]*filters\.limit/)
  assert.match(service, /\.eq\('user_id', userId\)[\s\S]*\.in\('id', taskIds\)/)
})

test('content lookup falls back when an optional platform thumbnail column is not deployed', () => {
  assert.match(service, /function contentItemSelect\(config: PlatformContentConfig, includeThumbnail = true\)/)
  assert.match(service, /isMissingOptionalContentColumn\(error, config\.thumbnailKey\)/)
  assert.match(service, /queryPublishedContentItems\([\s\S]*filters\.limit,[\s\S]*false[\s\S]*\)/)
  assert.match(service, /thumbnail_url: thumbnailKey \? row\[thumbnailKey\] \|\| null : null/)
})

test('sync ownership lookup selects only fields required to identify published content', () => {
  const lookupStart = service.indexOf('async function queryPublishedTaskItemsByField')
  const lookupEnd = service.indexOf('async function findOwnedPublishedContent', lookupStart)
  const lookup = service.slice(lookupStart, lookupEnd)
  assert.match(lookup, /const ownershipSelect = `id, task_id, account_id, title, source_video_name/)
  assert.match(lookup, /\.select\(ownershipSelect\)/)
  assert.doesNotMatch(lookup, /contentItemSelect|thumbnailKey|previewKey/)
})

test('workspace loads detail by the selected comment external content id', () => {
  assert.match(client, /contentId: comment\.external_content_id/)
  assert.match(client, /limit: 200/)
  assert.match(client, /xl:grid-cols-\[240px_390px_minmax\(0,1fr\)\]/)
  assert.match(client, /selectedDetailContent\?\.preview_url/)
  assert.doesNotMatch(client, /<div className="hidden">\s*<section/)
})

test('content preview fields are platform-neutral and Instagram reply remains gated', () => {
  assert.match(types, /preview_url: string \| null/)
  assert.match(types, /thumbnail_url: string \| null/)
  assert.match(client, /getSocialCommentPlatformCapabilities\(comment\.platform\)/)
  assert.match(client, /comment\.platform === "instagram" && instagramReplyEnabled/)
})

test('reply controls live in the comment list while detail stays display-only', () => {
  assert.match(client, /inboxComments\.map\(\(comment\) =>/)
  assert.match(client, /onClick=\{\(\) => toggleReplies\(comment\.id\)\}/)
  assert.match(client, /value=\{drafts\[comment\.id\] \|\| ""\}/)
  assert.match(client, /All cached comments for this content/)
  assert.doesNotMatch(client, /selectedComment\.direction === "inbound" \? <div className="grid gap-2/)
})

test('batch replies select replyable comments and send one message sequentially', () => {
  assert.match(client, /const \[selectedReplyIds, setSelectedReplyIds\]/)
  assert.match(client, /const targets = inboxComments\.filter/)
  assert.match(client, /for \(const comment of targets\)/)
  assert.match(client, /await postReply\(comment, message\)/)
  assert.match(client, /successfulIds\.add\(comment\.id\)/)
  assert.match(client, /setSelectedReplyIds\(allReplyableSelected \? new Set\(\)/)
})

test('YouTube comment surfaces sync recent content once when opened', () => {
  assert.match(youtubeClient, /platformLock="youtube"[\s\S]*initialSyncEnabled/)
  assert.match(youtubeCommentsPage, /platformLock="youtube"[\s\S]*initialSyncEnabled/)
  assert.match(client, /initialSyncAttemptedTargets\.current\.has\(initialSyncTargetKey\)/)
  assert.match(client, /selectedPlatformCapabilities\?\.recent_sync/)
  assert.match(client, /idempotencyKey = `initial:\$\{syncPlatform\}:\$\{accountId\}:/)
})

test('Facebook comment reads use the v25-compatible video object instead of a singular status id', () => {
  const configStart = service.indexOf('facebook: {', service.indexOf('const PLATFORM_CONTENT_CONFIG'))
  const configEnd = service.indexOf('\n  },', configStart)
  const facebookConfig = service.slice(configStart, configEnd)
  assert.match(facebookConfig, /externalIdKey: 'facebook_video_id'/)
  assert.doesNotMatch(facebookConfig, /commentContentIdKey: 'facebook_post_id'/)
  assert.match(service, /listFacebookComments\(token, content\.provider_comment_content_id\)/)
})

test('Facebook comment management renders cached originals before background sync and translation', () => {
  assert.match(facebookCommentsPage, /platformLock="facebook"/)
  assert.match(facebookCommentsPage, /backgroundInitialSync/)
  assert.match(facebookCommentsPage, /initialSyncDelayMs=\{5000\}/)
  assert.match(facebookCommentsPage, /translationStartDelayMs=\{800\}/)
  assert.match(platformPublishPage, /backgroundInitialSync=\{config\.platform === 'facebook'\}/)
  assert.match(platformPublishPage, /initialSyncDelayMs=\{config\.platform === 'facebook' \? 5000 : 0\}/)
  assert.match(platformPublishPage, /initialAccounts=\{facebookCommentAccounts\}/)
  assert.match(platformPublishPage, /translationStartDelayMs=\{config\.platform === 'facebook' \? 800 : 0\}/)
  assert.match(client, /platform: platformLock/)
  assert.match(accountsRoute, /requestedPlatform[\s\S]*\[requestedPlatform\]/)
  assert.match(client, /if \(!state \|\| state\.sourceText !== comment\.message\) return null/)
  assert.match(client, /window\.setTimeout\(startTranslation, translationStartDelayMs\)/)
  assert.match(client, /source !== "initial" \|\| !backgroundInitialSync/)
  assert.match(client, /isFacebookLocked && workspaceGuardRef\.current\.currentKey\(\) !== visibleWorkspaceKey/)
  assert.match(client, /\/api\/social-comments\/facebook-bootstrap/)
  assert.match(client, /commentsCacheRef\.current\.set\(`facebook:\$\{account\.id\}`/)
  assert.match(facebookBootstrapRoute, /Promise\.all\(\[/)
  assert.match(facebookBootstrapRoute, /getSocialCommentAccounts\(user\.id, \['facebook'\]\)/)
  assert.match(facebookBootstrapRoute, /getSavedSocialComments\(user\.id/)
})

test('saved comments remain ordered newest first after automatic sync', () => {
  assert.match(service, /\.order\('remote_created_at', \{ ascending: false, nullsFirst: false \}\)/)
  assert.match(service, /\.order\('created_at', \{ ascending: false \}\)/)
})
