/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('shared TikTok logo preserves the official cyan, pink, and foreground layers', () => {
  const source = read('src/components/brand/TikTokLogo.tsx')

  assert.match(source, /fill="#25F4EE"/)
  assert.match(source, /fill="#FE2C55"/)
  assert.match(source, /fill="currentColor"/)
  assert.equal((source.match(/TIKTOK_GLYPH_PATH/g) || []).length, 4)
})

test('TikTok platform navigation uses the shared brand logo like YouTube and Facebook', () => {
  const sidebar = read('src/components/layout/sidebar.tsx')

  for (const title of [
    'TikTok Account Management',
    'TikTok Video Management',
    'Shop Accounts',
    'Shop Publish',
  ]) {
    const start = sidebar.indexOf(`title: t ? "${title}"`)
    assert.notEqual(start, -1, `missing sidebar item: ${title}`)
    assert.match(sidebar.slice(start, start + 260), /icon: TikTokLogo/)
  }

  assert.match(sidebar, /const isTikTokBrandIcon = Icon === TikTokLogo/)
  assert.match(sidebar, /isTikTokBrandIcon \|\| isYouTubeBrandIcon \|\| isFacebookBrandIcon/)
  assert.match(sidebar, /isTikTokBrandIcon\)[\s\S]*?<TikTokLogo className="h-7 w-7 text-white"/)
})

test('TikTok product surfaces use the shared logo instead of unrelated generic brand stand-ins', () => {
  const expectedWiring = [
    ['src/app/(main)/publish/page.tsx', /<TikTokLogo/],
    ['src/app/(main)/publish/accounts/page.tsx', /<TikTokLogo/],
    ['src/app/(main)/shop-publish/page.tsx', /<TikTokLogo/],
    ['src/app/(main)/shop-publish/accounts/page.tsx', /<TikTokLogo/],
    ['src/components/publish/tiktok/TikTokCommentsUnavailable.tsx', /<TikTokLogo/],
    ['src/components/publish/AccountSelector.tsx', /<TikTokLogo[^>]+aria-label="TikTok"/],
    ['src/app/admin/users/[id]/page.tsx', /icon: TikTokLogo/],
  ]

  for (const [file, pattern] of expectedWiring) {
    assert.match(read(file), pattern, `${file} does not use the shared TikTok logo`)
  }

  const comments = read('src/components/social-comments/SocialCommentsClient.tsx')
  assert.match(comments, /platform === "tiktok"\) return <TikTokLogo/)
  assert.doesNotMatch(comments, /platform === "tiktok"\) return <Music2/)

  const labeledLogoFiles = expectedWiring
    .map(([file]) => read(file))
    .filter((source) => /<TikTokLogo[^>]+aria-label="TikTok"/.test(source))
  assert.equal(labeledLogoFiles.length, 1, 'only the standalone account empty state should label the logo')
})

test('Privacy Policy and Terms use the TikTok logo for TikTok integration sections', () => {
  const privacy = read('src/app/(landing)/privacy/page.tsx')
  const terms = read('src/app/(landing)/terms/page.tsx')

  const privacySection = privacy.slice(
    privacy.indexOf('{/* 8. TikTok Platform Data Integration */}'),
    privacy.indexOf('{/* 9. AIGC Content Disclosure */}')
  )
  const termsSection = terms.slice(
    terms.indexOf('{/* 16. TikTok Platform Integration Terms */}'),
    terms.indexOf('{/* 17. Subscription */}')
  )

  assert.match(privacySection, /flex h-12 w-12[\s\S]*?<TikTokLogo className="h-7 w-7 text-white"/)
  assert.doesNotMatch(privacySection, /<ShoppingBag/)
  assert.match(termsSection, /flex h-12 w-12[\s\S]*?<TikTokLogo className="h-7 w-7 text-white"/)
  assert.doesNotMatch(termsSection, /<Youtube/)
})

test('TikTok account and video management headings use a prominent brand mark', () => {
  const accounts = read('src/app/(main)/publish/accounts/page.tsx')
  const publish = read('src/app/(main)/publish/page.tsx')

  assert.match(accounts, /<TikTokLogo className="h-12 w-12 shrink-0 text-white"/)
  assert.match(publish, /<TikTokLogo className="h-12 w-12 shrink-0 text-white"/)
})
