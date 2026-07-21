const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, context = {}, moduleMap = {}) {
  const filename = path.join(process.cwd(), relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const loadedModule = { exports: {} }
  const localRequire = (request) => moduleMap[request] || require(request)
  vm.runInNewContext(output, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    URL,
    URLSearchParams,
    Response,
    Headers,
    process,
    ...context,
  }, { filename })
  return loadedModule.exports
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

function loadPlatformApi(fetch, authMode = 'instagram') {
  const graphAuth = loadTypeScriptModule('src/lib/instagram/graph-auth.ts')
  return loadTypeScriptModule(
    'src/lib/social-comments/platform-api.ts',
    { fetch },
    {
      '@/lib/facebook/oauth': { getFacebookAppSecretProof: () => 'proof' },
      '@/lib/instagram/graph-auth': graphAuth,
      '@/lib/instagram/oauth': { getInstagramAuthMode: () => authMode },
    }
  )
}

const token = {
  accessToken: 'test-access-token',
  accountExternalId: 'account-external',
  accountName: 'Test account',
}
const capabilities = loadTypeScriptModule('src/lib/social-comments/platform-capabilities.ts')
const runtimeTypes = { isSocialPlatform: (value) => ['youtube', 'tiktok', 'instagram', 'facebook'].includes(value) }

test('YouTube sync recognizes comments authored by the connected channel', async () => {
  const api = loadPlatformApi(async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/commentThreads')) {
      return jsonResponse({
        items: [{
          id: 'thread-1',
          snippet: {
            totalReplyCount: 0,
            topLevelComment: {
              id: 'app-reply-1',
              snippet: {
                textOriginal: 'reply sent by app',
                authorChannelId: { value: token.accountExternalId },
                authorDisplayName: token.accountName,
                publishedAt: '2026-07-16T00:00:00Z',
              },
            },
          },
        }],
      })
    }
    throw new Error(`unexpected request: ${url.pathname}`)
  })

  const result = await api.listYouTubeComments(token, 'video-1')
  assert.equal(result.comments.length, 1)
  assert.equal(result.comments[0].is_from_account, true)
  assert.equal(result.comments[0].can_reply, false)
  assert.equal(result.thread_completeness, 'complete')
  assert.equal(result.replies_fetched, true)
  assert.equal(result.truncated, false)
})

test('sync persistence preserves an existing app-sent outbound reply', () => {
  const policy = loadTypeScriptModule('src/lib/social-comments/persistence-policy.ts')
  const merged = policy.resolveSocialCommentPersistence(
    { is_from_account: false, can_reply: true },
    'inbound',
    'synced',
    null,
    {
      direction: 'outbound',
      status: 'sent',
      reply_to_comment_id: 'local-parent-id',
      can_reply: false,
      is_from_account: true,
    }
  )

  assert.deepEqual(JSON.parse(JSON.stringify(merged)), {
    direction: 'outbound',
    status: 'sent',
    reply_to_comment_id: 'local-parent-id',
    can_reply: false,
    is_from_account: true,
  })
})

test('YouTube, Instagram, and Facebook reject inactive accounts before provider access', () => {
  const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/social-comments/service.ts'), 'utf8')
  assert.match(service, /if \(status !== 'active'\) \{\s+return 'needs_reconnect'/)
  assert.match(service, /SocialCommentApiError\('youtube', 'account_not_active'/)
  assert.match(service, /SocialCommentApiError\('instagram', 'account_not_active'/)
  assert.match(service, /SocialCommentApiError\('facebook', 'account_not_active'/)
})

test('Instagram Native comments use the official minimal fields and paginate without replies', async () => {
  const requests = []
  const api = loadPlatformApi(async (input, init = {}) => {
    const url = new URL(String(input))
    const authorization = new Headers(init.headers || {}).get('Authorization')
    requests.push({
      host: url.host,
      pathname: url.pathname,
      after: url.searchParams.get('after'),
      fields: url.searchParams.get('fields'),
      limit: url.searchParams.get('limit'),
      hasOrder: url.searchParams.has('order'),
      urlHasAccessToken: url.searchParams.has('access_token'),
      bearerHeaderPresent: Boolean(authorization?.startsWith('Bearer ') && authorization.length > 7),
    })

    if (url.searchParams.get('after') === 'comment-page-2') {
      return jsonResponse({
        data: [
          { id: 'comment-1', text: 'duplicate top level', from: { id: 'reader-id', username: 'reader' } },
          { id: 'comment-2', text: 'second comment', from: { id: 'account-external', username: 'test-account' }, timestamp: '2026-07-11T01:03:00Z' },
        ],
      })
    }

    return jsonResponse({
      data: [{
        id: 'comment-1',
        text: 'first comment',
        from: { id: 'reader-id', username: 'reader' },
      }],
      paging: { next: 'present', cursors: { after: 'comment-page-2' } },
    })
  })

  const result = await api.listInstagramComments(token, 'media-1')
  const comments = result.comments
  assert.equal(comments.map((comment) => comment.external_comment_id).join(','), 'comment-1,comment-2')
  assert.equal(comments.filter((comment) => comment.external_comment_id === 'comment-1').length, 1)
  assert.equal(comments.every((comment) => comment.metadata.replies_fetched === false), true)
  assert.equal(comments.every((comment) => comment.metadata.pagination_complete === false), true)
  assert.equal(comments.every((comment) => comment.metadata.top_level_pagination_complete === true), true)
  assert.equal(comments[0].author_id, 'reader-id')
  assert.equal(comments[0].author_name, 'reader')
  const ownComment = comments.find((comment) => comment.external_comment_id === 'comment-2')
  assert.equal(ownComment.is_from_account, true)
  assert.equal(ownComment.can_reply, false)
  assert.equal(requests.every((request) => request.host === 'graph.instagram.com'), true)
  assert.equal(requests.every((request) => request.pathname.endsWith('/media-1/comments')), true)
  assert.equal(requests.every((request) => request.fields === 'from,text'), true)
  assert.equal(requests.every((request) => request.limit === '50'), true)
  assert.equal(requests.every((request) => request.hasOrder === false), true)
  assert.equal(requests.every((request) => !request.fields.includes('hidden')), true)
  assert.equal(requests.every((request) => !request.fields.includes('like_count')), true)
  assert.equal(requests.every((request) => !request.fields.includes('replies')), true)
  assert.equal(requests.every((request) => request.urlHasAccessToken === false), true)
  assert.equal(requests.every((request) => request.bearerHeaderPresent === true), true)
  assert.equal(requests.length, 2)
  assert.equal(result.metadata.provider_raw_count, 3)
  assert.equal(result.metadata.mapped_count, 2)
  assert.equal(result.metadata.top_level_pagination_complete, true)
  assert.equal(result.metadata.replies_fetched, false)
})

test('Instagram Native maps the official id/from/text shape and reports raw versus mapped counts', async () => {
  const api = loadPlatformApi(async () => jsonResponse({
    data: [
      { id: 'comment-1', from: { id: 'reader-id', username: 'reader' }, text: 'official shape' },
      { from: { id: 'reader-2-id', username: 'reader-2' }, text: 'missing id' },
    ],
  }))

  const result = await api.listInstagramComments(token, 'media-1')
  assert.equal(result.comments.length, 1)
  assert.equal(result.comments[0].external_comment_id, 'comment-1')
  assert.equal(result.comments[0].author_id, 'reader-id')
  assert.equal(result.comments[0].author_name, 'reader')
  assert.equal(result.comments[0].message, 'official shape')
  assert.equal(result.comments[0].remote_created_at, null)
  assert.equal(result.metadata.provider_raw_count, 2)
  assert.equal(result.metadata.mapped_count, 1)
})

test('Instagram Facebook mode preserves expanded fields and embedded reply behavior', async () => {
  const requests = []
  const api = loadPlatformApi(async (input, init = {}) => {
    const url = new URL(String(input))
    requests.push({
      host: url.host,
      fields: url.searchParams.get('fields'),
      urlHasAccessToken: url.searchParams.has('access_token'),
      bearerHeaderPresent: Boolean(new Headers(init.headers || {}).get('Authorization')?.startsWith('Bearer ')),
    })

    if (url.pathname.endsWith('/comment-1/replies')) {
      assert.equal(url.searchParams.get('after'), 'reply-page-2')
      return jsonResponse({
        data: [{ id: 'reply-2', text: 'second reply', from: { id: 'reader-3-id', username: 'reader-3' } }],
      })
    }

    if (url.searchParams.get('after') === 'comment-page-2') {
      return jsonResponse({
        data: [{ id: 'comment-2', text: 'second comment', from: { id: 'reader-4-id', username: 'reader-4' } }],
      })
    }

    return jsonResponse({
      data: [{
        id: 'comment-1',
        text: 'comment',
        from: { id: 'reader-id', username: 'reader' },
        replies: {
          data: [{ id: 'reply-1', text: 'reply', from: { id: 'reader-2-id', username: 'reader-2' } }],
          paging: { next: 'present', cursors: { after: 'reply-page-2' } },
        },
      }],
      paging: { next: 'present', cursors: { after: 'comment-page-2' } },
    })
  }, 'facebook')

  const result = await api.listInstagramComments(token, 'media-1')
  assert.equal(result.comments.length, 4)
  assert.equal(requests.length, 3)
  assert.equal(requests.every((request) => request.host === 'graph.facebook.com'), true)
  assert.equal(requests.filter((request) => request.fields.includes('replies{')).length, 2)
  assert.equal(requests.every((request) => request.fields.includes('hidden')), true)
  assert.equal(requests.every((request) => request.fields.includes('like_count')), true)
  assert.equal(requests.every((request) => request.urlHasAccessToken === false), true)
  assert.equal(requests.every((request) => request.bearerHeaderPresent === true), true)
  assert.equal(result.metadata.replies_fetched, true)
  assert.equal(result.metadata.top_level_pagination_complete, true)
})

test('Instagram Native reply uses the official JSON request and maps the outbound result', async () => {
  let request = null
  const api = loadPlatformApi(async (input, init = {}) => {
    const url = new URL(String(input))
    const bodyText = typeof init.body === 'string' ? init.body : ''
    const body = JSON.parse(bodyText)
    const authorization = new Headers(init.headers || {}).get('Authorization')
    request = {
      host: url.host,
      pathname: url.pathname,
      method: init.method,
      contentType: new Headers(init.headers || {}).get('Content-Type'),
      urlHasAccessToken: url.searchParams.has('access_token'),
      rawUrlContainsAccessToken: String(input).includes('access_token'),
      bodyHasAccessToken: Object.prototype.hasOwnProperty.call(body, 'access_token') || bodyText.includes('access_token'),
      bodyKeys: Object.keys(body),
      message: body.message,
      bearerHeaderPresent: Boolean(authorization?.startsWith('Bearer ') && authorization.length > 7),
    }
    return jsonResponse({ id: 'reply-created' })
  })

  const reply = await api.replyToInstagramComment(token, 'comment/with space', 'media-1', 'manual reply')
  assert.deepEqual(request, {
    host: 'graph.instagram.com',
    pathname: '/v20.0/comment%2Fwith%20space/replies',
    method: 'POST',
    contentType: 'application/json',
    urlHasAccessToken: false,
    rawUrlContainsAccessToken: false,
    bodyHasAccessToken: false,
    bodyKeys: ['message'],
    message: 'manual reply',
    bearerHeaderPresent: true,
  })
  assert.equal(reply.external_comment_id, 'reply-created')
  assert.equal(reply.external_content_id, 'media-1')
  assert.equal(reply.parent_external_comment_id, 'comment/with space')
  assert.equal(reply.thread_external_id, 'comment/with space')
  assert.equal(reply.is_from_account, true)
  assert.equal(reply.author_id, token.accountExternalId)
  assert.equal(reply.author_name, token.accountName)
})

test('Instagram Native reply preserves stable 4xx, rate limit, and 5xx errors', async () => {
  const cases = [
    {
      status: 400,
      response: { error: { code: 100, message: 'Invalid request' } },
      expectedCode: '100',
      retryable: false,
      retryAfter: null,
    },
    {
      status: 429,
      response: { error: { code: 4, error_subcode: 2207004, message: 'Rate limited' } },
      headers: { 'Retry-After': '30' },
      expectedCode: '2207004',
      retryable: true,
      retryAfter: '30',
    },
    {
      status: 503,
      response: { error: { code: 2, message: 'Temporarily unavailable' } },
      expectedCode: '2',
      retryable: true,
      retryAfter: null,
    },
  ]

  for (const item of cases) {
    let calls = 0
    const api = loadPlatformApi(async () => {
      calls += 1
      return jsonResponse(item.response, { status: item.status, headers: item.headers })
    })
    await assert.rejects(
      api.replyToInstagramComment(token, 'comment-1', 'media-1', 'manual reply'),
      (error) => {
        assert.equal(error.platform, 'instagram')
        assert.equal(error.code, item.expectedCode)
        assert.equal(error.httpStatus, item.status)
        assert.equal(error.retryable, item.retryable)
        assert.equal(error.retryAfter, item.retryAfter)
        return true
      }
    )
    assert.equal(calls, 1)
  }
})

test('YouTube and Facebook reply request formats remain unchanged', async () => {
  const requests = []
  const api = loadPlatformApi(async (input, init = {}) => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers || {})
    requests.push({ url, init, headers })

    if (url.host === 'www.googleapis.com') {
      return jsonResponse({
        id: 'youtube-reply',
        snippet: {
          parentId: 'youtube-parent',
          textDisplay: 'youtube message',
          authorChannelId: { value: token.accountExternalId },
          authorDisplayName: token.accountName,
        },
      })
    }
    return jsonResponse({ id: 'facebook-reply' })
  })

  await api.replyToYouTubeComment(token, 'youtube-parent', 'youtube message')
  await api.replyToFacebookComment(token, 'facebook-parent', 'facebook-content', 'facebook message')

  const youtube = requests[0]
  assert.equal(youtube.url.host, 'www.googleapis.com')
  assert.equal(youtube.url.pathname, '/youtube/v3/comments')
  assert.equal(youtube.url.searchParams.get('part'), 'snippet')
  assert.equal(youtube.init.method, 'POST')
  assert.equal(youtube.headers.get('Content-Type'), 'application/json; charset=UTF-8')
  assert.equal(JSON.parse(youtube.init.body).snippet.parentId, 'youtube-parent')
  assert.equal(JSON.parse(youtube.init.body).snippet.textOriginal, 'youtube message')

  const facebook = requests[1]
  const facebookBody = facebook.init.body
  assert.equal(facebook.url.host, 'graph.facebook.com')
  assert.equal(facebook.url.pathname, '/v20.0/facebook-parent/comments')
  assert.equal(facebook.init.method, 'POST')
  assert.equal(facebook.headers.get('Content-Type'), 'application/x-www-form-urlencoded')
  assert.equal(facebookBody instanceof URLSearchParams, true)
  assert.equal(facebookBody.get('message'), 'facebook message')
  assert.equal(facebookBody.has('access_token'), false)
  assert.equal(facebookBody.get('appsecret_proof'), 'proof')
  assert.equal(facebook.headers.get('Authorization'), `Bearer ${token.accessToken}`)
})

test('Facebook marks an exact 500 top-level boundary as truncated when another page exists', async () => {
  let calls = 0
  const api = loadPlatformApi(async () => {
    calls += 1
    return jsonResponse({
      data: Array.from({ length: 500 }, (_, index) => ({
        id: `comment-${index + 1}`,
        message: `comment ${index + 1}`,
        from: { id: `author-${index + 1}`, name: `Author ${index + 1}` },
        comment_count: 0,
      })),
      paging: { next: 'present', cursors: { after: 'page-2' } },
    })
  })

  const comments = await api.listFacebookComments(token, 'facebook-post-1')
  assert.equal(calls, 1)
  assert.equal(comments.length, 500)
  assert.equal(comments.every((comment) => comment.metadata.truncated === true), true)
})

test('Facebook marks an exact 500 reply boundary as truncated without dropping other top-level comments', async () => {
  const api = loadPlatformApi(async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/parent-1/comments')) {
      return jsonResponse({
        data: Array.from({ length: 500 }, (_, index) => ({
          id: `reply-${index + 1}`,
          message: `reply ${index + 1}`,
          from: { id: `reply-author-${index + 1}`, name: `Reply author ${index + 1}` },
        })),
        paging: { next: 'present', cursors: { after: 'reply-page-2' } },
      })
    }
    return jsonResponse({
      data: [
        { id: 'parent-1', message: 'parent', from: { id: 'author-1', name: 'Author 1' }, comment_count: 500 },
        { id: 'parent-2', message: 'second parent', from: { id: 'author-2', name: 'Author 2' }, comment_count: 0 },
      ],
    })
  })

  const comments = await api.listFacebookComments(token, 'facebook-post-1')
  assert.equal(comments.length, 502)
  assert.equal(comments.some((comment) => comment.external_comment_id === 'parent-2'), true)
  assert.equal(comments.every((comment) => comment.metadata.truncated === true), true)
})

test('Instagram author mapping remains compatible with legacy top-level username responses', async () => {
  const api = loadPlatformApi(async () => jsonResponse({
    data: [{ id: 'comment-1', text: 'comment', username: 'legacy-reader' }],
  }))

  const { comments } = await api.listInstagramComments(token, 'media-1')
  assert.equal(comments[0].author_id, null)
  assert.equal(comments[0].author_name, 'legacy-reader')
})

test('Instagram reports truncation when Graph exposes next without a reusable cursor', async () => {
  const api = loadPlatformApi(async () => jsonResponse({
    data: [{ id: 'comment-1', text: 'comment', username: 'reader' }],
    paging: { next: 'present-without-cursor' },
  }))

  const result = await api.listInstagramComments(token, 'media-1')
  const { comments } = result
  assert.equal(comments.length, 1)
  assert.equal(comments[0].metadata.truncated, true)
  assert.equal(comments[0].metadata.pagination_complete, false)
  assert.equal(result.metadata.thread_completeness, 'truncated')
})

test('Instagram does not request another page when the terminal page only has an after cursor', async () => {
  let calls = 0
  const api = loadPlatformApi(async () => {
    calls += 1
    return jsonResponse({
      data: [{ id: 'comment-1', text: 'comment', username: 'reader' }],
      paging: { cursors: { after: 'terminal-cursor' } },
    })
  })

  const { comments } = await api.listInstagramComments(token, 'media-1')
  assert.equal(calls, 1)
  assert.equal(comments.length, 1)
  assert.equal(comments[0].metadata.truncated, false)
  assert.equal(comments[0].metadata.top_level_pagination_complete, true)
  assert.equal(comments[0].metadata.pagination_complete, false)
  assert.equal(comments[0].metadata.replies_fetched, false)
})

test('Instagram provider preserves retry metadata for rate limits', async () => {
  const api = loadPlatformApi(async () => jsonResponse({
    error: {
      code: 4,
      error_subcode: 2207004,
      message: 'Rate limited https://graph.example.test/path?access_token=synthetic-secret Bearer synthetic-secret',
    },
  }, {
    status: 429,
    headers: { 'Retry-After': '30' },
  }))

  await assert.rejects(
    api.listInstagramComments(token, 'media-1'),
    (error) => {
      assert.equal(error.code, '2207004')
      assert.equal(error.httpStatus, 429)
      assert.equal(error.retryable, true)
      assert.equal(error.retryAfter, '30')
      assert.equal(error.message.includes('synthetic-secret'), false)
      assert.equal(error.message.includes('https://'), false)
      return true
    }
  )
})

test('Instagram recent sync and auto sync remain unavailable', () => {
  const request = loadTypeScriptModule('src/lib/social-comments/sync-request.ts', {}, {
    '@/lib/social-comments/platform-capabilities': capabilities,
    '@/lib/social-comments/types': runtimeTypes,
  })
  assert.equal(request.isSocialCommentRecentSyncAllowed('instagram', 'manual'), false)
  assert.equal(request.isSocialCommentRecentSyncAllowed('instagram', 'auto'), false)
  assert.equal(request.isSocialCommentRecentSyncAllowed('youtube', 'manual'), true)
  assert.equal(request.isSocialCommentRecentSyncAllowed('youtube', 'auto'), false)
  assert.equal(request.isSocialCommentSyncTargetValid('instagram', 'manual', ''), false)
  assert.equal(request.isSocialCommentSyncTargetValid('instagram', 'manual', 'owned-item'), true)
  assert.equal(request.isSocialCommentSyncTargetValid('youtube', 'auto', 'owned-item'), true)
})

test('reply route and service retain shared validation, ownership, and idempotency gates', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/social-comments/[id]/reply/route.ts'), 'utf8')
  const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/social-comments/service.ts'), 'utf8')

  assert.match(route, /message\.trim\(\)/)
  assert.match(route, /message\.length > 2000/)
  assert.match(route, /idempotencyKey\.length < 12 \|\| idempotencyKey\.length > 160/)
  assert.match(route, /\^\[A-Za-z0-9\._:-\]\+\$/)
  assert.match(service, /comment\.direction !== 'inbound'/)
  assert.match(service, /\.eq\('status', 'published'\)/)
  assert.match(service, /String\(row\[config\.externalIdKey\]\) !== comment\.external_content_id/)
  assert.match(service, /error\?\.code !== '23505'/)
  assert.match(service, /existing\.status === 'sent' \|\| existing\.status === 'completed'/)
  assert.match(route, /instagramReplyEnabled: isInstagramCommentsReplyEnabled\(\)/)
  assert.match(service, /isSocialCommentReplyPlatformEnabled\(comment\.platform, options\.instagramReplyEnabled === true\)/)

  const ownershipGate = service.indexOf('const ownedContent = await assertCommentReplyTargetOwned')
  const idempotencyGate = service.indexOf('const action = await startReplyActionLog')
  const providerCall = service.indexOf('externalReply = await replyToInstagramComment')
  assert.ok(ownershipGate >= 0 && ownershipGate < providerCall)
  assert.ok(idempotencyGate >= 0 && idempotencyGate < providerCall)
})

test('Instagram UI remains manual-only and locked to selected owned content', () => {
  const client = fs.readFileSync(path.join(process.cwd(), 'src/components/social-comments/SocialCommentsClient.tsx'), 'utf8')
  assert.match(client, /isAuto && \(syncPlatform !== "youtube"/)
  assert.match(client, /selectedPlatformCapabilities\?\.requires_explicit_content && !selectedContentId/)
  assert.doesNotMatch(client, /isInstagramLocked && !selectedContentId/)
  assert.match(client, /contentId: selectedContentId/)
  assert.match(client, /comment\.platform === "instagram" && instagramReplyEnabled/)
  assert.doesNotMatch(client, /autoReply/i)
})

test('Instagram replies are fail-closed independently from supported platforms', () => {
  const policy = loadTypeScriptModule('src/lib/social-comments/reply-policy.ts', {}, {
    '@/lib/social-comments/platform-capabilities': capabilities,
  })
  assert.equal(policy.isSocialCommentReplyPlatformEnabled('instagram', false), false)
  assert.equal(policy.isSocialCommentReplyPlatformEnabled('instagram', true), true)
  assert.equal(policy.isSocialCommentReplyPlatformEnabled('youtube', false), true)
  assert.equal(policy.isSocialCommentReplyPlatformEnabled('facebook', false), true)

  const featureFlags = loadTypeScriptModule(
    'src/lib/social-comments/feature-flag.ts',
    {},
    { '@/lib/social-comments/types': { SOCIAL_PLATFORMS: ['youtube', 'tiktok', 'instagram', 'facebook'] } }
  )
  const previous = process.env.INSTAGRAM_COMMENTS_REPLY_ENABLED
  delete process.env.INSTAGRAM_COMMENTS_REPLY_ENABLED
  assert.equal(featureFlags.isInstagramCommentsReplyEnabled(), false)
  process.env.INSTAGRAM_COMMENTS_REPLY_ENABLED = 'true'
  assert.equal(featureFlags.isInstagramCommentsReplyEnabled(), true)
  if (previous === undefined) delete process.env.INSTAGRAM_COMMENTS_REPLY_ENABLED
  else process.env.INSTAGRAM_COMMENTS_REPLY_ENABLED = previous
})

test('reply route returns 403 before Instagram provider access when the server gate is disabled', async () => {
  let providerCalls = 0
  const platformApi = loadPlatformApi(async () => {
    providerCalls += 1
    throw new Error('Provider must not be called while Instagram replies are disabled.')
  })
  const replyPolicy = loadTypeScriptModule('src/lib/social-comments/reply-policy.ts', {}, {
    '@/lib/social-comments/platform-capabilities': capabilities,
  })
  const comment = {
    id: 'comment-row',
    user_id: 'owner-user',
    platform: 'instagram',
    account_id: 'account-row',
    task_item_id: 'task-item-row',
    external_comment_id: 'comment-external',
    external_content_id: 'media-external',
    parent_external_comment_id: null,
    thread_external_id: 'comment-external',
    direction: 'inbound',
    author_id: 'commenter-external',
    author_name: 'Commenter',
    author_avatar_url: null,
    message: 'Inbound comment',
    like_count: 0,
    reply_count: 0,
    can_reply: true,
    is_from_account: false,
    permalink: null,
    status: 'received',
    metadata: {},
    remote_created_at: null,
    local_error_code: null,
    local_error_message: null,
    reply_to_comment_id: null,
    created_at: '2026-07-13T00:00:00.000Z',
    updated_at: '2026-07-13T00:00:00.000Z',
  }
  let adminFromCalls = 0
  const admin = {
    from(table) {
      adminFromCalls += 1
      assert.equal(table, 'social_comments')
      const query = {
        select() { return query },
        eq() { return query },
        async single() { return { data: comment, error: null } },
      }
      return query
    },
  }
  const service = loadTypeScriptModule(
    'src/lib/social-comments/service.ts',
    {},
    {
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/social-comments/action-log': { mergeActionLogMetadata: (initial, terminal) => ({ ...initial, ...terminal }) },
      '@/lib/facebook/oauth': {
        calculateFacebookTokenExpiration: () => null,
        refreshFacebookPageAccessToken: async () => { throw new Error('unexpected refresh') },
      },
      '@/lib/instagram/oauth': {
        calculateInstagramTokenExpiration: () => null,
        refreshInstagramAccountAccessToken: async () => { throw new Error('unexpected refresh') },
      },
      '@/lib/youtube/oauth': {
        calculateYouTubeTokenExpiration: () => null,
        refreshYouTubeAccessToken: async () => { throw new Error('unexpected refresh') },
        scopesToArray: () => [],
      },
      '@/lib/social-comments/platform-api': platformApi,
      '@/lib/social-comments/types': {
        normalizeScopes: (value) => Array.isArray(value) ? value : [],
      },
      '@/lib/social-comments/sync-request': {
        isSocialCommentRecentSyncAllowed: () => false,
      },
      '@/lib/social-comments/reply-policy': replyPolicy,
      '@/lib/social-comments/platform-capabilities': capabilities,
      '@/lib/social-comments/persistence-policy': {
        resolveSocialCommentPersistence: () => { throw new Error('unexpected persistence') },
      },
    }
  )

  class FakeNextResponse extends Response {
    static json(value, init = {}) {
      return new FakeNextResponse(JSON.stringify(value), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      })
    }
  }
  const route = loadTypeScriptModule(
    'src/app/api/social-comments/[id]/reply/route.ts',
    {
      NextResponse: FakeNextResponse,
      Request,
    },
    {
      'next/server': { NextResponse: FakeNextResponse },
      '@/lib/supabase/server': {
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: { id: 'owner-user' } }, error: null }) },
        }),
      },
      '@/lib/social-comments/feature-flag': {
        getEnabledSocialCommentPlatforms: () => ['instagram'],
        isInstagramCommentsReplyEnabled: () => false,
        isSocialCommentsApiEnabled: () => true,
      },
      '@/lib/social-comments/i18n': {
        getApiMessage: (_code, fallback) => fallback,
        getRequestLang: () => 'en',
      },
      '@/lib/social-comments/service': service,
    }
  )

  const response = await route.POST(new Request('http://localhost/api/social-comments/comment-row/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'manual reply',
      idempotencyKey: 'manual-reply-key-123',
    }),
  }), { params: { id: 'comment-row' } })

  assert.equal(response.status, 403)
  assert.equal((await response.json()).code, 'reply_disabled')
  assert.equal(adminFromCalls, 1)
  assert.equal(providerCalls, 0)
})

test('Instagram sync omits account-authored comments from inbound persistence', () => {
  const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/social-comments/service.ts'), 'utf8')
  assert.match(service, /comments\.filter\(\(comment\) => !comment\.is_from_account\)/)
  assert.match(service, /from_account_omitted_count/)
  assert.match(service, /provider_raw_count: result\.metadata\.provider_raw_count/)
  assert.match(service, /mapped_count: result\.metadata\.mapped_count/)
  assert.match(service, /top_level_pagination_complete: result\.metadata\.top_level_pagination_complete/)
  assert.match(service, /replies_fetched: result\.metadata\.replies_fetched/)
})

test('action log completion merges initial and terminal metadata without secrets', () => {
  const actionLog = loadTypeScriptModule('src/lib/social-comments/action-log.ts')
  const merged = actionLog.mergeActionLogMetadata({
    sync_scope: 'target',
    client_idempotency_key: 'safe-client-key',
    sync_source: 'manual',
  }, {
    pagination_complete: true,
    truncated: false,
    sync_source: 'manual',
  })

  assert.equal(merged.sync_scope, 'target')
  assert.equal(merged.client_idempotency_key, 'safe-client-key')
  assert.equal(merged.pagination_complete, true)
  assert.equal(merged.truncated, false)
  assert.equal(JSON.stringify(merged).includes('access_token'), false)

  const failed = actionLog.mergeActionLogMetadata({
    sync_scope: 'target',
    client_idempotency_key: 'safe-client-key',
  }, {
    retryable: true,
    httpStatus: 503,
    retryAfter: '30',
  })
  assert.equal(failed.sync_scope, 'target')
  assert.equal(failed.client_idempotency_key, 'safe-client-key')
  assert.equal(failed.retryable, true)
  assert.equal(failed.httpStatus, 503)

  const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/social-comments/service.ts'), 'utf8')
  assert.match(service, /select\('metadata'\)/)
  assert.match(service, /mergeActionLogMetadata\(existing\?\.metadata, input\.metadata\)/)
})
