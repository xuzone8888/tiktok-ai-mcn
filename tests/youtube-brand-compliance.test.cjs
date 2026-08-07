const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const USER_FACING_FILES = [
  'src/components/layout/sidebar.tsx',
  'src/app/(main)/youtube-publish/accounts/page.tsx',
  'src/app/(main)/youtube-publish/YouTubePublishClient.tsx',
  'src/components/social-comments/SocialCommentsClient.tsx',
  'src/app/(landing)/privacy/page.tsx',
  'src/app/(landing)/terms/page.tsx',
]

test('uses the unmodified official full-color YouTube icon asset', () => {
  const asset = fs.readFileSync(path.join(
    process.cwd(),
    'public/brands/youtube/yt_icon_red_digital.png',
  ))
  assert.equal(
    crypto.createHash('sha256').update(asset).digest('hex'),
    '1027b1b0517727adb9697155a270744381c3ce9b047b1c8bd8a9389dc7d07a83',
  )

  const component = read('src/components/brand/YouTubeBrandIcon.tsx')
  assert.match(component, /compact \? 44 : 48[\s\S]*compact \? 38 : 40/)
  assert.match(component, /object-contain/)
  assert.match(component, /filter: "none"/)
  assert.match(component, /transform: "none"/)
})

test('does not render lucide YouTube approximations in user-facing surfaces', () => {
  for (const relativePath of USER_FACING_FILES) {
    const source = read(relativePath)
    assert.doesNotMatch(source, /\bYoutube\b/)
  }
})

test('sizes the official mark proportionally for prominent headings', () => {
  const accounts = read('src/app/(main)/youtube-publish/accounts/page.tsx')
  const publish = read('src/app/(main)/youtube-publish/YouTubePublishClient.tsx')

  assert.match(accounts, /YouTubeBrandIcon className="h-12 w-14"/)
  assert.match(
    publish,
    /<Link href="\/youtube-publish"[^>]*>[\s\S]*?<YouTubeBrandIcon className="h-12 w-14 md:h-14 md:w-16"/,
  )
})

test('uses a compact official mark with at least 20px of visible height', () => {
  const sidebar = read('src/components/layout/sidebar.tsx')
  assert.match(sidebar, /<YouTubeBrandIcon compact className="h-\[38px\] w-11"/)
  assert.match(sidebar, /isYouTubeBrandIcon[\s\S]*?\? "h-8 w-8 bg-\[#18181b\]"/)
})

test('matches YouTube policy icons to the other platform icon containers', () => {
  for (const relativePath of [
    'src/app/(landing)/privacy/page.tsx',
    'src/app/(landing)/terms/page.tsx',
  ]) {
    const source = read(relativePath)
    assert.match(source, /className="flex h-12 w-12[^\"]*"[^>]*><YouTubeBrandIcon compact className="h-\[38px\] w-11"/)
    assert.match(source, /rounded-lg bg-white\/\[0\.04\]/)
    assert.doesNotMatch(source, /YouTube[^\n]*bg-\[#18181b\]/)
  }
})

test('uses a TikTok-appropriate glyph for the TikTok terms heading', () => {
  const terms = read('src/app/(landing)/terms/page.tsx')
  assert.match(
    terms,
    /TikTok Platform Integration Terms[\s\S]*?<Music2 className="h-6 w-6"/,
  )
})
