const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

test('Facebook account cards prefer the Page title over Meta-localized category text', () => {
  const accountsPage = read('src/components/publish/platform/PlatformAccountsPage.tsx')
  const platformConfig = read('src/lib/publish/platform-config.ts')

  assert.match(
    accountsPage,
    /preferChannelTitle\s*\?\s*account\.channel_title\s*\|\|\s*account\.channel_handle/,
  )
  assert.match(accountsPage, /getAccountName\(account, config\.preferChannelTitle\)/)
  assert.match(platformConfig, /facebook:\s*\{[\s\S]*?preferChannelTitle:\s*true/)
})
