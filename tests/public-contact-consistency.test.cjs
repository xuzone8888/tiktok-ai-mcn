/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const runtimeEvidenceFiles = [
  'src/app/(landing)/contact/page.tsx',
  'src/app/(landing)/privacy/page.tsx',
  'src/app/(landing)/terms/page.tsx',
  'src/app/(landing)/legal/page.tsx',
  'src/app/(landing)/facebook-data-deletion/page.tsx',
]

const activeReviewFiles = [
  'docs/facebook-review/README.md',
  'docs/facebook-review/SUBMISSION_WORKSHEET.md',
  'docs/youtube-review/website-terms-of-service-youtube-section.md',
  'docs/youtube-review/website-privacy-policy-youtube-section.md',
]

test('public evidence uses the confirmed same-domain contact address', () => {
  const brand = read('src/config/brand.ts')
  const match = brand.match(
    /contactEmail:\s*['"]([^'"]+)['"]/,
  )
  assert.ok(match, 'brand contactEmail is missing')
  const contactEmail = match[1]

  assert.equal(contactEmail, 'developer@toryxai.com')

  for (const relativePath of runtimeEvidenceFiles) {
    const source = read(relativePath)
    assert.doesNotMatch(source, /toryxai@outlook\.com|support@mcn\.ai/i, relativePath)
    assert.ok(
      source.includes(contactEmail) || source.includes('APP_BRAND.contactEmail'),
      `${relativePath} is not connected to the confirmed brand contact`,
    )
  }

  for (const relativePath of activeReviewFiles) {
    const source = read(relativePath)
    assert.doesNotMatch(source, /toryxai@outlook\.com|support@mcn\.ai/i, relativePath)
    assert.ok(source.includes(contactEmail), `${relativePath} has a different contact address`)
  }
})

test('public and review sources never reverse the confirmed contact email domain', () => {
  const sources = [...runtimeEvidenceFiles, ...activeReviewFiles]
    .map((relativePath) => read(relativePath))
    .join('\n')

  assert.doesNotMatch(sources, /toryxai@developer\.com/i)
  assert.match(sources, /developer@toryxai\.com/i)
})

test('Privacy does not claim an account-cancellation control that is not implemented', () => {
  const privacy = read('src/app/(landing)/privacy/page.tsx')

  assert.doesNotMatch(privacy, /Settings - Account Security|设置\s*-\s*账户安全/)
  assert.match(privacy, /Where an in-product account cancellation control is available/)
  assert.match(privacy, /如产品内提供账户注销功能/)
})

test('active public TikTok pages disclose comments, user-triggered replies, and deletion controls', () => {
  const privacy = read('src/app/(landing)/privacy/page.tsx')
  const terms = read('src/app/(landing)/terms/page.tsx')

  for (const source of [privacy, terms]) {
    assert.match(source, /comment\.list/)
    assert.match(source, /comment\.list\.manage/)
    assert.match(source, /does not automatically or bulk-send|不会自动或批量发送/)
    assert.match(source, /Delete all ordinary TikTok data|删除全部普通 TikTok 数据/)
  }
})

test('public policies disclose the real storage, processing, upload, and disconnection boundaries', () => {
  const privacy = read('src/app/(landing)/privacy/page.tsx')
  const terms = read('src/app/(landing)/terms/page.tsx')

  for (const source of [privacy, terms]) {
    assert.match(source, /Primary persistent storage|主要持久化存储/)
    assert.match(source, /hosted in China|托管于中国/)
    assert.match(source, /transiently process|临时处理/)
  }

  assert.match(privacy, /browser sends the selected local file directly to TikTok|浏览器会将所选本地文件直接发送至 TikTok/)
  assert.match(privacy, /does not by itself erase the retained account identity|该操作本身不会清除保留的账号身份/)
  assert.doesNotMatch(privacy, /personal information is stored and processed on servers located in the United States/)
  assert.doesNotMatch(privacy, /video files are deleted from our servers after successful upload to TikTok/)
  assert.doesNotMatch(terms, /stores and processes user data on infrastructure located in the United States/)
})

test('TikTok review support documents match the published region disclosure', () => {
  const privacySupport = read('docs/tiktok-shop-security/04-privacy-data-subject-rights-and-retention-policy.html')
  const questionnaire = read('docs/tiktok-shop-security/05-questionnaire-answer-sheet.html')

  for (const source of [privacySupport, questionnaire]) {
    assert.match(source, /United States/)
    assert.match(source, /China/)
    assert.doesNotMatch(source, /US-only/)
  }
})
