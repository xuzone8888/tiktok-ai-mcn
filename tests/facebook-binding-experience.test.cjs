const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const root = process.cwd()

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function loadFacebookOAuth() {
  const filename = path.join(root, 'src/lib/facebook/oauth.ts')
  const output = ts.transpileModule(read('src/lib/facebook/oauth.ts'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(output, {
    Buffer,
    URLSearchParams,
    crypto,
    exports: loadedModule.exports,
    module: loadedModule,
    process: {
      env: {
        FACEBOOK_CLIENT_ID: 'facebook-client',
        FACEBOOK_CLIENT_SECRET: 'facebook-secret',
        FACEBOOK_REDIRECT_URI: 'https://app.example.test/api/facebook/auth/callback',
        FACEBOOK_PAGE_LOGIN_CONFIG_ID: 'facebook-page-config',
      },
    },
    require(id) {
      if (id === '@/lib/oauth-broker/client') {
        return { callBroker() {}, isBrokerEnabled: () => false }
      }
      return require(id)
    },
  }, { filename })
  return loadedModule.exports
}

test('Facebook authorization keeps the provider URL stable while state tracks the app language', () => {
  const oauth = loadFacebookOAuth()
  const english = oauth.buildFacebookAuthorizationUrl('user-1', 'en_US')
  const chinese = oauth.buildFacebookAuthorizationUrl('user-1', 'zh_CN')
  const englishUrl = new URL(english.authUrl)
  const chineseUrl = new URL(chinese.authUrl)

  assert.equal(englishUrl.searchParams.get('config_id'), 'facebook-page-config')
  assert.equal(englishUrl.searchParams.get('auth_type'), 'rerequest')
  assert.equal(englishUrl.searchParams.has('locale'), false)
  assert.equal(chineseUrl.searchParams.has('locale'), false)
  assert.equal(oauth.getFacebookUiLocaleFromState(english.state), 'en_US')
  assert.equal(oauth.getFacebookUiLocaleFromState(chinese.state), 'zh_CN')
})

test('Facebook surfaces use the Facebook brand icon instead of the generic share icon', () => {
  const sidebar = read('src/components/layout/sidebar.tsx')
  const accounts = read('src/app/(main)/facebook-publish/accounts/page.tsx')
  const publish = read('src/app/(main)/facebook-publish/page.tsx')
  const comments = read('src/components/social-comments/SocialCommentsClient.tsx')
  const privacy = read('src/app/(landing)/privacy/page.tsx')
  const terms = read('src/app/(landing)/terms/page.tsx')
  const deletion = read('src/app/(landing)/facebook-data-deletion/page.tsx')

  assert.match(sidebar, /Facebook Account Management[\s\S]*?icon: FacebookBrandIcon/)
  assert.match(sidebar, /Facebook Video Management[\s\S]*?icon: FacebookBrandIcon/)
  assert.match(accounts, /FacebookBrandIcon/)
  assert.doesNotMatch(accounts, /Share2/)
  assert.doesNotMatch(accounts, /<Link/)
  assert.match(accounts, /FacebookBrandIcon className="h-8 w-8"/)
  assert.match(publish, /FacebookBrandIcon/)
  assert.doesNotMatch(publish, /Share2/)
  assert.doesNotMatch(publish, /<Link/)
  assert.match(publish, /FacebookBrandIcon className="h-8 w-8"/)
  assert.match(comments, /platform === "facebook"\) return <FacebookBrandIcon/)
  assert.match(privacy, /Facebook Platform Data[\s\S]*?<FacebookBrandIcon/)
  assert.match(terms, /Facebook Platform Integration Terms[\s\S]*?<FacebookBrandIcon/)
  assert.match(deletion, /<FacebookBrandIcon/)
})

test('Facebook publish header aligns its description with the title text', () => {
  const publishShell = read('src/components/publish/platform/PlatformPublishPage.tsx')

  assert.match(publishShell, /config\.platform === 'facebook' \? 'ml-\[44px\]' : 'ml-\[19px\]'/)
})

test('Facebook account binding sends language and callback messages remain localizable', () => {
  const accountPage = read('src/app/(main)/facebook-publish/accounts/page.tsx')
  const accountsShell = read('src/components/publish/platform/PlatformAccountsPage.tsx')
  const platformConfig = read('src/lib/publish/platform-config.ts')
  const authUrlRoute = read('src/app/api/facebook/auth/url/route.ts')
  const callback = read('src/app/api/facebook/auth/callback/route.ts')

  assert.match(accountPage, /passLanguageToAuth: true/)
  assert.match(accountPage, /showAuthCallbackWarning: true/)
  assert.match(accountsShell, /JSON\.stringify\(\{ locale: isEnglish \? 'en_US' : 'zh_CN' \}\)/)
  assert.match(accountsShell, /config\.showAuthCallbackWarning \? params\.get\('warning'\) : null/)
  assert.match(accountsShell, /account connected with a warning/)
  assert.match(accountsShell, /config\.providerLanguageNotice/)
  assert.match(accountsShell, /config\.providerLanguageSettingsUrl/)
  assert.match(accountsShell, /closeLabel=\{config\.localizeLegalDialogClose \? t\(isEnglish, '关闭', 'Close'\) : undefined\}/)
  assert.match(platformConfig, /Meta 授权页面由 Facebook 托管/)
  assert.match(platformConfig, /Meta hosts the authorization screens/)
  assert.match(platformConfig, /facebook\.com\/settings\/\?tab=language_and_region/)
  assert.match(platformConfig, /localizeLegalDialogClose: true/)
  assert.match(authUrlRoute, /buildFacebookAuthorizationUrl\(user\.id, locale\)/)
  assert.match(authUrlRoute, /isEnglish && \/\[\\u3400-\\u9fff\]\/\.test\(message\)/)
  assert.match(callback, /getFacebookUiLocaleFromState\(state\)/)
  assert.match(callback, /discoverMyFacebookPages\(longLivedToken\.access_token\)/)
  assert.match(callback, /Facebook authorization could not be completed/)
  assert.match(callback, /Meta 暂时无法验证全部已选择的 Facebook Page/)
  assert.match(callback, /Facebook 授权服务正在更新/)
  assert.match(callback, /localizedMetaError = localizeFacebookCallbackError/)
  assert.match(callback, /error_message: localizedMetaError/)
  assert.match(callback, /error: localizedMetaError/)
  assert.match(callback, /isEnglish[\s\S]*?Page\$\{savedCount === 1 \? '' : 's'\}[\s\S]*?\$\{savedCount\} 个 Page/)
})
