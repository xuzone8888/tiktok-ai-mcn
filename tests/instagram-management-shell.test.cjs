const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

function read(relativePath) {
  return fs.readFileSync(relativePath, 'utf8')
}

test('Instagram navigation and config use account and video management language', () => {
  const sidebar = read('src/components/layout/sidebar.tsx')
  const config = read('src/lib/publish/platform-config.ts')

  assert.match(sidebar, /Instagram Account Management/)
  assert.match(sidebar, /Instagram 账号管理/)
  assert.match(sidebar, /Instagram Video Management/)
  assert.match(sidebar, /Instagram 视频管理/)
  assert.match(config, /pageTitle: 'Instagram 视频管理'/)
  assert.match(config, /pageTitleEn: 'Instagram Video Management'/)
  assert.match(config, /accountsPageTitle: 'Instagram 账号管理'/)
  assert.match(config, /accountsPageTitleEn: 'Instagram Account Management'/)
  assert.match(config, /accountManagementLabelEn: 'Account Management'/)
})

test('Instagram management page gates and embeds comments with the existing flags', () => {
  const route = read('src/app/(main)/instagram-publish/page.tsx')
  const publishPage = read('src/components/publish/platform/PlatformPublishPage.tsx')

  assert.match(route, /isInstagramCommentsPageEnabled\(\) && getInstagramAuthMode\(\) === 'instagram'/)
  assert.match(route, /instagramReplyEnabled=\{showCommentManagement && isInstagramCommentsReplyEnabled\(\)\}/)
  assert.match(publishPage, /label: isEnglish \? 'Video Publishing' : '视频发布'/)
  assert.match(publishPage, /label: isEnglish \? 'Video List' : '视频列表'/)
  assert.match(publishPage, /label: isEnglish \? 'Comment Management' : '评论管理'/)
  assert.match(publishPage, /platformLock=\{config\.platform\}/)
  assert.match(publishPage, /embedded/)
  assert.match(publishPage, /instagramReplyEnabled=\{instagramReplyEnabled\}/)
  assert.match(publishPage, /effectiveActiveTab = activeTab === 'comments' && !showCommentManagement \? 'create' : activeTab/)
  assert.match(publishPage, /effectiveActiveTab === tab\.id/)
  assert.match(publishPage, /effectiveActiveTab === 'comments'/)
})

test('Facebook uses the shared three-tab management shell', () => {
  const facebookRoute = read('src/app/(main)/facebook-publish/page.tsx')
  const publishPage = read('src/components/publish/platform/PlatformPublishPage.tsx')

  assert.match(facebookRoute, /showCommentManagement=\{isFacebookCommentsPageEnabled\(\)\}/)
  assert.match(publishPage, /\.\.\.\(showCommentManagement/)
  assert.match(publishPage, /showCommentManagement = false/)
})
