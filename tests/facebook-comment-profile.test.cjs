const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function load(fetch, broker = false) {
  const source = fs.readFileSync('src/lib/social-comments/platform-api.ts', 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  const mocks = {
    '@/lib/facebook/oauth': { getFacebookAppSecretProof: () => 'test-proof' },
    '@/lib/instagram/graph-auth': {},
    '@/lib/instagram/oauth': { getInstagramAuthMode: () => 'instagram' },
    '@/lib/oauth-broker/client': { BrokerTransportError: class extends Error {}, isBrokerEnabled: () => broker,
      callBroker: async () => [{ author_name: 'Broker name', author_avatar_url: 'https://example.com/photo.jpg' }] },
  }
  vm.runInNewContext(output, { exports: mod.exports, module: mod, require: x => mocks[x] || require(x),
    fetch, URL, URLSearchParams, Response, Headers, setTimeout, clearTimeout, AbortController, process: { env: {} } })
  return mod.exports
}
const token = { accessToken: 'test-token', accountExternalId: 'page', accountName: 'Page' }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status })
const comment = (from) => ({ id: 'comment', message: 'good', from })

test('Facebook requests profile fields and maps name and picture without exposing the token', async () => {
  const api = load(async (input, init) => {
    const u = new URL(input)
    assert.match(u.searchParams.get('fields'), /from\{id,name,picture\{url,is_silhouette\}\}/)
    assert.equal(u.searchParams.has('access_token'), false)
    assert.equal(init.headers.Authorization, 'Bearer test-token')
    return json({ data: [comment({ id: 'person', name: 'Test user', picture: { data: { url: 'https://example.com/photo.jpg', is_silhouette: false } } })] })
  })
  const [c] = await api.listFacebookComments(token, 'post')
  assert.equal(c.author_name, 'Test user')
  assert.equal(c.author_avatar_url, 'https://example.com/photo.jpg')
})

test('Missing identity leaves comment readable and replyable', async () => {
  const api = load(async () => json({ data: [comment(undefined)] }))
  const [c] = await api.listFacebookComments(token, 'post')
  assert.equal(c.author_name, null)
  assert.equal(c.author_avatar_url, null)
  assert.equal(c.message, 'good')
  assert.equal(c.can_reply, true)
})

for (const picture of [undefined, { data: { url: 'https://example.com/a', is_silhouette: true } },
  { data: { url: 'javascript:alert(1)' } }, { data: { url: 'http://example.com/a' } },
  { data: { url: 'https://example.com/a?access_token=secret' } }, { data: { url: 'https://user:pass@example.com/a' } }]) {
  test('Unsafe, missing or silhouette picture falls back: ' + JSON.stringify(picture), async () => {
    const api = load(async () => json({ data: [comment({ id: 'person', name: 'Name', picture })] }))
    assert.equal((await api.listFacebookComments(token, 'post'))[0].author_avatar_url, null)
  })
}

for (const code of [10, 100, 200]) {
  test(`Profile error ${code} retries established comment fields once`, async () => {
    let calls = 0
    const api = load(async input => {
      const fields = new URL(input).searchParams.get('fields')
      if (++calls === 1) return json({ error: { code, message: 'Profile access unavailable' } }, 400)
      assert.match(fields, /,from,/)
      assert.doesNotMatch(fields, /picture/)
      return json({ data: [comment({ name: 'Still available' })] })
    })
    assert.equal((await api.listFacebookComments(token, 'post'))[0].author_name, 'Still available')
    assert.equal(calls, 2)
  })
}

for (const [code, status] of [[190, 400], [4, 429], [2, 503]]) {
  test(`Token/rate/server error ${code} is not retried as a profile failure`, async () => {
    let calls = 0
    const api = load(async () => { calls++; return json({ error: { code, message: 'Unavailable' } }, status) })
    await assert.rejects(api.listFacebookComments(token, 'post'))
    assert.equal(calls, 1)
  })
}

test('Failed fallback still raises the API error', async () => {
  let calls = 0
  const api = load(async () => { calls++; return json({ error: { code: 200, message: 'Denied' } }, 403) })
  await assert.rejects(api.listFacebookComments(token, 'post'))
  assert.equal(calls, 2)
})

test('Replies use the same profile mapping and recognize the Page author', async () => {
  const api = load(async input => new URL(input).pathname.endsWith('/post/comments')
    ? json({ data: [{ ...comment(undefined), comment_count: 1 }] })
    : json({ data: [comment({ id: 'page', name: 'Page', picture: { data: { url: 'https://example.com/page.jpg' } } })] }))
  const rows = await api.listFacebookComments(token, 'post')
  assert.equal(rows[1].author_avatar_url, 'https://example.com/page.jpg')
  assert.equal(rows[1].is_from_account, true)
  assert.equal(rows[1].can_reply, false)
})

test('Broker results retain profile fields without local Graph requests', async () => {
  const api = load(async () => { throw Error('Unexpected direct request') }, true)
  const [c] = await api.listFacebookComments(token, 'post')
  assert.equal(c.author_name, 'Broker name')
  assert.equal(c.author_avatar_url, 'https://example.com/photo.jpg')
})

const nextPage = after => ({ next: 'https://graph.facebook.com/next', cursors: { after } })

test('A three-page sync downgrades once and a new sync retries profile access', async () => {
  let requests = 0, profileFailures = 0
  const cursors = []
  const api = load(async input => {
    requests++
    const u = new URL(input)
    if (u.searchParams.get('fields').includes('picture')) {
      profileFailures++
      return json({ error: { code: 200, message: 'Profile access unavailable' } }, 403)
    }
    const page = Number(u.searchParams.get('after') || 0)
    cursors.push(page)
    return json({ data: [{ ...comment(undefined), id: 'c' + page }],
      ...(page < 2 ? { paging: nextPage(String(page + 1)) } : {}) })
  })
  for (let sync = 1; sync <= 2; sync++) {
    assert.equal((await api.listFacebookComments(token, 'post')).length, 3)
    assert.equal(requests, 4 * sync)
    assert.equal(profileFailures, sync)
  }
  assert.deepEqual(cursors, [0, 1, 2, 0, 1, 2])
})

test('A downgrade in replies applies to reply pagination and later top-level pages', async () => {
  const calls = []
  const api = load(async input => {
    const u = new URL(input)
    const expanded = u.searchParams.get('fields').includes('picture')
    const after = u.searchParams.get('after')
    const top = u.pathname.endsWith('/post/comments')
    calls.push({ top, expanded, after })
    if (top && !after) return json({ data: [{ ...comment(undefined), comment_count: 2 }], paging: nextPage('top-2') })
    if (expanded) return json({ error: { code: 100, message: 'Profile field denied' } }, 400)
    if (top) return json({ data: [{ ...comment(undefined), id: 'second' }] })
    return json({ data: [{ ...comment(undefined), id: after ? 'reply-2' : 'reply-1' }],
      ...(!after ? { paging: nextPage('reply-2') } : {}) })
  })
  const rows = await api.listFacebookComments(token, 'post')
  assert.equal(rows.length, 4)
  assert.deepEqual(calls, [
    { top: true, expanded: true, after: null },
    { top: false, expanded: true, after: null },
    { top: false, expanded: false, after: null },
    { top: false, expanded: false, after: 'reply-2' },
    { top: true, expanded: false, after: 'top-2' },
  ])
})

test('Top-level downgrade also applies to replies without another failed profile request', async () => {
  let failures = 0, calls = 0
  const api = load(async input => {
    calls++
    const u = new URL(input)
    if (u.searchParams.get('fields').includes('picture')) {
      failures++
      return json({ error: { code: 10, message: 'Denied' } }, 403)
    }
    return json({ data: u.pathname.endsWith('/post/comments')
      ? [{ ...comment(undefined), comment_count: 1 }] : [{ ...comment(undefined), id: 'reply' }] })
  })
  assert.equal((await api.listFacebookComments(token, 'post')).length, 2)
  assert.equal(calls, 3)
  assert.equal(failures, 1)
})

test('An error on a later basic-fields page is not retried', async () => {
  let calls = 0
  const api = load(async input => {
    calls++
    const u = new URL(input)
    if (u.searchParams.get('fields').includes('picture') || u.searchParams.has('after')) {
      return json({ error: { code: 200, message: 'Denied' } }, 403)
    }
    return json({ data: [comment(undefined)], paging: nextPage('2') })
  })
  await assert.rejects(api.listFacebookComments(token, 'post'))
  assert.equal(calls, 3)
})

test('Concurrent account syncs do not share profile downgrade state', async () => {
  const api = load(async (input, init) => {
    const expanded = new URL(input).searchParams.get('fields').includes('picture')
    if (init.headers.Authorization === 'Bearer denied') {
      if (expanded) return json({ error: { code: 200, message: 'Denied' } }, 403)
      return json({ data: [comment(undefined)] })
    }
    assert.equal(expanded, true)
    return json({ data: [comment({ name: 'Allowed', picture: { data: { url: 'https://example.com/a.jpg' } } })] })
  })
  const [denied, allowed] = await Promise.all([
    api.listFacebookComments({ ...token, accessToken: 'denied' }, 'post-a'),
    api.listFacebookComments({ ...token, accessToken: 'allowed' }, 'post-b'),
  ])
  assert.equal(denied[0].author_avatar_url, null)
  assert.equal(allowed[0].author_avatar_url, 'https://example.com/a.jpg')
})
