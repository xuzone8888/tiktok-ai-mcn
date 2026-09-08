/* eslint-disable @typescript-eslint/no-require-imports, import/order */

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTsModule(filename, stubs = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
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
      if (request in stubs) return stubs[request]
      if (request === '@/lib/tiktok/comment-text') {
        return {
          TIKTOK_COMMENT_REPLY_MAX_CODE_POINTS: 1200,
          countUnicodeCodePoints: (value) => Array.from(value).length,
          isTikTokCommentReplyWithinLimit: (value) => Array.from(value).length <= 1200,
        }
      }
      if (request === '@/lib/tiktok/business-comment-limits') {
        return {
          getTikTokCommentReadLimits: () => ({
            perEndpointRequestsPerMinute: 20,
            topLevelRequestBudget: 5,
            replyRequestBudget: 15,
          }),
        }
      }
      return require(request)
    },
    AbortSignal,
    Date,
    Error,
    Map,
    Number,
    Promise,
    Set,
    URL,
    URLSearchParams,
    setTimeout,
    console,
    process,
    ...globals,
  }, { filename })
  return loadedModule.exports
}

function response(payload, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    statusText: options.statusText || 'OK',
    headers: { get: () => null },
    async json() { return payload },
  }
}

function loadPlatformApi(fetchImpl, broker = {}) {
  class BrokerTransportError extends Error {}
  return loadTsModule(
    path.join(process.cwd(), 'src/lib/social-comments/platform-api.ts'),
    {
      '@/lib/facebook/oauth': { getFacebookAppSecretProof: () => 'proof' },
      '@/lib/instagram/graph-auth': { instagramGraphHeaders: () => ({}) },
      '@/lib/instagram/oauth': { getInstagramAuthMode: () => 'instagram' },
      '@/lib/oauth-broker/client': {
        BrokerTransportError,
        isBrokerEnabled: () => broker.enabled === true,
        callBroker: broker.call || (() => { throw new Error('broker should not run') }),
      },
    },
    { fetch: fetchImpl },
  )
}

const token = {
  accessToken: 'business-access-token',
  accountExternalId: 'business-open-id',
  accountName: 'Creator',
}

test('TikTok Business comment sync paginates top-level comments and replies read-only', async () => {
  const calls = []
  const api = loadPlatformApi(async (rawUrl, init) => {
    const url = new URL(rawUrl)
    calls.push({ url, init })
    const cursor = url.searchParams.get('cursor')
    const parent = url.searchParams.get('comment_id')

    if (parent === 'comment-1') {
      return response({
        code: 0,
        data: {
          reply_list: [{
            comment_id: 'reply-1',
            parent_comment_id: 'comment-1',
            text: 'Thanks',
            user_id: 'business-open-id',
            owner: true,
            likes: 1,
            replies: 0,
            create_time: '2026-07-23 09:02:00',
          }],
          cursor: 0,
          has_more: false,
        },
      })
    }

    if (cursor === '0') {
      return response({
        code: 0,
        data: {
          comments: [{
            comment_id: 'comment-1',
            text: 'First',
            user_id: 'viewer-1',
            display_name: 'Viewer',
            likes: 2,
            replies: 1,
            create_time: '2026-07-23 09:00:00',
          }],
          cursor: 20,
          has_more: true,
        },
      })
    }

    return response({
      code: 0,
      data: {
        comments: [{
          comment_id: 'comment-2',
          text: 'Second',
          user_id: 'viewer-2',
          likes: 0,
          replies: 0,
          create_time: '2026-07-23T09:01:00Z',
        }],
        cursor: 20,
        has_more: false,
      },
    })
  })

  const result = await api.listTikTokComments(token, 'video-1')
  assert.equal(result.thread_completeness, 'complete')
  assert.equal(result.replies_fetched, true)
  assert.equal(result.truncated, false)
  assert.deepEqual(
    Array.from(result.comments, (comment) => comment.external_comment_id),
    ['comment-1', 'comment-2', 'reply-1'],
  )
  assert.equal(result.comments[0].can_reply, true)
  assert.equal(result.comments[2].parent_external_comment_id, 'comment-1')
  assert.equal(result.comments[2].is_from_account, true)
  assert.equal(calls.length, 3)
  for (const call of calls) {
    assert.equal(call.init.method, 'GET')
    assert.equal(call.init.headers['Access-Token'], 'business-access-token')
    assert.equal(call.url.origin, 'https://business-api.tiktok.com')
    assert.equal(call.url.searchParams.get('business_id'), 'business-open-id')
    assert.equal(call.url.searchParams.get('video_id'), 'video-1')
    assert.equal(call.url.searchParams.get('max_count'), '20')
  }
})

test('TikTok Business pagination stops and reports truncation when cursor does not advance', async () => {
  let calls = 0
  const api = loadPlatformApi(async () => {
    calls += 1
    return response({
      code: 0,
      data: {
        comments: [{ comment_id: 'comment-1', text: 'Visible', replies: 0 }],
        cursor: 0,
        has_more: true,
      },
    })
  })

  const result = await api.listTikTokComments(token, 'video-1')
  assert.equal(calls, 1)
  assert.equal(result.truncated, true)
  assert.equal(result.thread_completeness, 'truncated')
})

test('TikTok read budget persists a provider cursor and resumes from that cursor', async () => {
  const cursors = []
  const api = loadPlatformApi(async (rawUrl) => {
    const url = new URL(rawUrl)
    const cursor = Number(url.searchParams.get('cursor'))
    cursors.push(cursor)
    return response({
      code: 0,
      data: {
        comments: [{
          comment_id: `comment-${cursor}`,
          text: 'Comment',
          user_id: 'viewer',
          replies: 0,
          create_time: '2026-07-23 09:00:00',
        }],
        cursor: cursor + 20,
        has_more: true,
      },
    })
  })

  const first = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 1,
    replyRequests: 1,
  })
  assert.equal(first.truncated, true)
  assert.equal(first.provider_resume_cursor, 20)

  const second = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 2,
    replyRequests: 1,
    resumeCursor: first.provider_resume_cursor,
  })
  assert.equal(second.provider_resume_cursor, 40)
  assert.deepEqual(cursors, [0, 0, 20])
})

test('TikTok resumed reads always refresh the newest page before continuing backlog', async () => {
  const cursors = []
  const api = loadPlatformApi(async (rawUrl) => {
    const cursor = Number(new URL(rawUrl).searchParams.get('cursor'))
    cursors.push(cursor)
    return response({
      code: 0,
      data: {
        comments: [{
          comment_id: cursor === 0 ? 'new-comment' : 'backlog-comment',
          text: cursor === 0 ? 'Newest' : 'Older',
          user_id: 'viewer',
          replies: 0,
          create_time: '2026-08-08 09:00:00',
        }],
        cursor: cursor === 0 ? 20 : 40,
        has_more: true,
      },
    })
  })

  const result = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 2,
    replyRequests: 1,
    resumeCursor: 20,
  })
  assert.deepEqual(cursors, [0, 20])
  assert.equal(
    result.comments.map((comment) => comment.external_comment_id).join(','),
    'new-comment,backlog-comment',
  )
  assert.equal(result.provider_resume_cursor, 40)
})

test('TikTok reply backlog resumes later parents across syncs without treating replies as parents', async () => {
  const replyParents = []
  const api = loadPlatformApi(async (rawUrl) => {
    const url = new URL(rawUrl)
    if (url.pathname.endsWith('/business/comment/list/')) {
      return response({
        code: 0,
        data: {
          comments: Array.from({ length: 4 }, (_, index) => ({
            comment_id: `parent-${index + 1}`,
            text: 'Parent',
            user_id: 'viewer',
            replies: 1,
          })),
          cursor: 0,
          has_more: false,
        },
      })
    }
    const parentId = url.searchParams.get('comment_id')
    replyParents.push(parentId)
    return response({
      code: 0,
      data: {
        reply_list: [{
          comment_id: `reply-for-${parentId}`,
          text: 'Reply',
          user_id: 'viewer',
          replies: 1,
        }],
        cursor: 0,
        has_more: false,
      },
    })
  })

  const first = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 1,
    replyRequests: 2,
  })
  assert.deepEqual(Array.from(first.provider_reply_resume.parent_ids), ['parent-3', 'parent-4'])
  assert.deepEqual(
    Array.from(first.provider_reply_resume.observed_parent_ids),
    ['parent-1', 'parent-2', 'parent-3', 'parent-4'],
  )
  assert.equal(first.provider_reply_resume.cursor, null)
  assert.equal(first.replies_fetched, false)

  const second = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 1,
    replyRequests: 2,
    replyResume: first.provider_reply_resume,
  })
  assert.equal(second.provider_reply_resume, null)
  assert.equal(second.replies_fetched, true)
  assert.deepEqual(replyParents, ['parent-1', 'parent-2', 'parent-3', 'parent-4'])
})

test('TikTok reply resume queues parents first observed while an older backlog is finishing', async () => {
  let topLevelCall = 0
  const replyParents = []
  const api = loadPlatformApi(async (rawUrl) => {
    const url = new URL(rawUrl)
    if (url.pathname.endsWith('/business/comment/list/')) {
      topLevelCall += 1
      const parentCount = topLevelCall === 1 ? 2 : 3
      return response({
        code: 0,
        data: {
          comments: Array.from({ length: parentCount }, (_, index) => ({
            comment_id: `parent-${index + 1}`,
            text: 'Parent',
            replies: 1,
          })),
          cursor: 0,
          has_more: false,
        },
      })
    }
    const parentId = url.searchParams.get('comment_id')
    replyParents.push(parentId)
    return response({
      code: 0,
      data: {
        reply_list: [{ comment_id: `reply-${parentId}`, text: 'Reply', replies: 0 }],
        cursor: 0,
        has_more: false,
      },
    })
  })

  const first = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 1,
    replyRequests: 1,
  })
  assert.deepEqual(Array.from(first.provider_reply_resume.parent_ids), ['parent-2'])

  const second = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 1,
    replyRequests: 1,
    replyResume: first.provider_reply_resume,
  })
  assert.equal(second.replies_fetched, false)
  assert.equal(second.thread_completeness, 'truncated')
  assert.deepEqual(Array.from(second.provider_reply_resume.parent_ids), ['parent-3'])

  const third = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 1,
    replyRequests: 1,
    replyResume: second.provider_reply_resume,
  })
  assert.equal(third.provider_reply_resume, null)
  assert.equal(third.replies_fetched, true)
  assert.deepEqual(replyParents, ['parent-1', 'parent-2', 'parent-3'])
})

test('TikTok reply backlog resumes the provider cursor for an unfinished parent', async () => {
  const replyCursors = []
  const api = loadPlatformApi(async (rawUrl) => {
    const url = new URL(rawUrl)
    if (url.pathname.endsWith('/business/comment/list/')) {
      return response({
        code: 0,
        data: {
          comments: [{ comment_id: 'parent-1', text: 'Parent', replies: 2 }],
          cursor: 0,
          has_more: false,
        },
      })
    }
    const cursor = Number(url.searchParams.get('cursor'))
    replyCursors.push(cursor)
    return response({
      code: 0,
      data: {
        reply_list: [{ comment_id: `reply-${cursor}`, text: 'Reply', replies: 0 }],
        cursor: cursor + 20,
        has_more: cursor === 0,
      },
    })
  })

  const first = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 1,
    replyRequests: 1,
  })
  assert.deepEqual(Array.from(first.provider_reply_resume.parent_ids), ['parent-1'])
  assert.deepEqual(Array.from(first.provider_reply_resume.observed_parent_ids), ['parent-1'])
  assert.equal(first.provider_reply_resume.cursor, 20)

  const second = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 1,
    replyRequests: 1,
    replyResume: first.provider_reply_resume,
  })
  assert.equal(second.provider_reply_resume, null)
  assert.deepEqual(replyCursors, [0, 20])
})

test('TikTok GET comment reads retry within budget but reply creation is never auto-retried', async () => {
  let readCalls = 0
  const api = loadPlatformApi(async (rawUrl) => {
    const url = new URL(rawUrl)
    if (url.pathname.endsWith('/business/comment/list/')) {
      readCalls += 1
      if (readCalls === 1) return response({ code: 50001 }, { ok: false, status: 503 })
      return response({ code: 0, data: { comments: [], cursor: 0, has_more: false } })
    }
    throw new Error('unexpected provider call')
  })
  const result = await api.listTikTokComments(token, 'video-1', {
    topLevelRequests: 2,
    replyRequests: 1,
  })
  assert.equal(readCalls, 2)
  assert.equal(result.truncated, false)
})

test('TikTok Business treats malformed successful comment pages as provider errors', async () => {
  const malformedPayloads = [
    { code: 0, data: {} },
    { code: 0, data: { comments: {}, has_more: false } },
    { code: 0, data: { comments: [], has_more: true } },
    { code: 0, data: { comments: [], has_more: true, cursor: -1 } },
    { code: 0, data: { comments: [], has_more: true, cursor: null } },
    { code: 0, data: { comments: [], has_more: true, cursor: '' } },
    { code: 0, data: { comments: [], has_more: true, cursor: ' ' } },
    { code: 0, data: { comments: [], has_more: true, cursor: false } },
    { code: 0, data: { comments: [], has_more: true, cursor: [] } },
  ]

  for (const payload of malformedPayloads) {
    const api = loadPlatformApi(async () => response(payload))
    await assert.rejects(
      () => api.listTikTokComments(token, 'video-1'),
      (error) => {
        assert.equal(error.code, 'invalid_response')
        assert.equal(error.httpStatus, 502)
        return true
      },
    )
  }
})

test('TikTok comment reads delegate through the closed broker operation when configured', async () => {
  const calls = []
  const expected = {
    comments: [],
    replies_fetched: true,
    truncated: false,
    thread_completeness: 'complete',
  }
  const api = loadPlatformApi(
    async () => { throw new Error('direct fetch should not run') },
    {
      enabled: true,
      call: async (...args) => {
        calls.push(args)
        return expected
      },
    },
  )

  const result = await api.listTikTokComments(token, 'video-1')
  assert.equal(result, expected)
  assert.equal(calls[0][0], 'tiktok')
  assert.equal(calls[0][1], 'listTikTokComments')
  assert.equal(calls[0][2].externalContentId, 'video-1')
})

test('TikTok replies remain fail-closed unless the Stage 6 rollout flag is enabled', () => {
  const capabilities = loadTsModule(
    path.join(process.cwd(), 'src/lib/social-comments/platform-capabilities.ts'),
  )
  const capability = capabilities.getSocialCommentPlatformCapabilities('tiktok')
  assert.equal(capability.read, 'supported')
  assert.equal(capability.sync, 'supported')
  assert.equal(capability.reply, 'feature_flag')
  assert.equal(capability.requires_explicit_content, true)
  assert.equal(capabilities.isSocialCommentOperationSupported('tiktok', 'reply'), false)
  assert.equal(
    capabilities.isSocialCommentOperationSupported('tiktok', 'reply', { tiktokReplyEnabled: true }),
    true,
  )

  const broker = fs.readFileSync('src/app/api/oauth-broker/call/route.ts', 'utf8')
  const service = fs.readFileSync('src/lib/social-comments/service.ts', 'utf8')
  assert.match(broker, /listTikTokComments/)
  assert.match(broker, /replyToTikTokComment/)
  assert.match(service, /await listTikTokComments\(token, content\.external_content_id, \{/)
  assert.match(service, /getTikTokBusinessCommentToken/)
  assert.match(service, /replyToTikTokComment\([\s\S]*parentExternalCommentId[\s\S]*comment\.external_content_id/)
})

test('TikTok Business reply uses the fixed create endpoint and maps the outbound reply', async () => {
  const calls = []
  const api = loadPlatformApi(async (rawUrl, init) => {
    calls.push({ rawUrl, init })
    return response({
      code: 0,
      data: {
        comment: {
          comment_id: 'reply-1',
          parent_comment_id: 'comment-1',
          text: 'Manual reply',
          create_time: '2026-07-23 10:00:00',
        },
      },
    })
  })

  const result = await api.replyToTikTokComment(token, 'comment-1', 'video-1', 'Manual reply')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].rawUrl, 'https://business-api.tiktok.com/open_api/v1.3/business/comment/reply/create/')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['Access-Token'], 'business-access-token')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    business_id: 'business-open-id',
    video_id: 'video-1',
    comment_id: 'comment-1',
    text: 'Manual reply',
  })
  assert.equal(result.external_comment_id, 'reply-1')
  assert.equal(result.external_content_id, 'video-1')
  assert.equal(result.parent_external_comment_id, 'comment-1')
  assert.equal(result.thread_external_id, 'comment-1')
  assert.equal(result.message, 'Manual reply')
  assert.equal(result.is_from_account, true)
  assert.equal(result.can_reply, false)
})

test('TikTok Business reply fails closed on provider errors and malformed success payloads', async () => {
  for (const [payload, expectedOutcome] of [
    [{ code: 40001, message: 'permission denied' }, 'rejected'],
    [{ code: 40002, message: 'Access-Token: direct-secret "access_token":"json-secret"' }, 'rejected'],
    [{ code: 0, data: {} }, 'unknown'],
    [{ code: 0, data: { comment: { text: 'missing id' } } }, 'unknown'],
  ]) {
    const api = loadPlatformApi(async () => response(payload))
    await assert.rejects(
      () => api.replyToTikTokComment(token, 'comment-1', 'video-1', 'Manual reply'),
      (error) => {
        assert.equal(error.platform, 'tiktok')
        assert.equal(error.httpStatus, 502)
        assert.equal(error.providerWriteOutcome, expectedOutcome)
        assert.equal(error.message.includes('direct-secret'), false)
        assert.equal(error.message.includes('json-secret'), false)
        return true
      },
    )
  }

  const api = loadPlatformApi(async () => response(
    { code: 50001, message: 'temporary provider failure' },
    { ok: false, status: 500 },
  ))
  await assert.rejects(
    () => api.replyToTikTokComment(token, 'comment-1', 'video-1', 'Manual reply'),
    (error) => error.providerWriteOutcome === 'unknown',
  )

  const timeoutApi = loadPlatformApi(async () => response(
    { message: 'request timeout' },
    { ok: false, status: 408 },
  ))
  await assert.rejects(
    () => timeoutApi.replyToTikTokComment(token, 'comment-1', 'video-1', 'Manual reply'),
    (error) => error.httpStatus === 408 && error.providerWriteOutcome === 'unknown',
  )
})

test('TikTok Business replies delegate through the closed broker operation when configured', async () => {
  const calls = []
  const expected = {
    external_comment_id: 'reply-1',
    external_content_id: 'video-1',
    parent_external_comment_id: 'comment-1',
    thread_external_id: 'comment-1',
    message: 'Manual reply',
    can_reply: false,
    is_from_account: true,
  }
  const api = loadPlatformApi(
    async () => { throw new Error('direct fetch should not run') },
    {
      enabled: true,
      call: async (...args) => {
        calls.push(args)
        return expected
      },
    },
  )

  const result = await api.replyToTikTokComment(token, 'comment-1', 'video-1', 'Manual reply')
  assert.equal(result, expected)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'tiktok')
  assert.equal(calls[0][1], 'replyToTikTokComment')
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), {
    token,
    parentExternalCommentId: 'comment-1',
    externalContentId: 'video-1',
    message: 'Manual reply',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][3])), { timeoutMs: 25_000 })
})

test('Stage 6 wires TikTok into the shared ownership, idempotency, throttle, log, persistence, and batch paths', () => {
  const service = fs.readFileSync('src/lib/social-comments/service.ts', 'utf8')
  const route = fs.readFileSync('src/app/api/social-comments/[id]/reply/route.ts', 'utf8')
  const client = fs.readFileSync('src/components/social-comments/SocialCommentsClient.tsx', 'utf8')
  const page = fs.readFileSync('src/app/(main)/tiktok-publish/comments/page.tsx', 'utf8')

  const ownership = service.indexOf('const ownedContent = await assertCommentReplyTargetOwned')
  const actionLog = service.indexOf('const action = await startReplyActionLog')
  const token = service.indexOf('token = await getPlatformToken', actionLog)
  const provider = service.indexOf('externalReply = await replyToTikTokComment')
  const receipt = service.indexOf('const receiptPersisted = await transitionTikTokReplyAction', provider)
  const persistence = service.indexOf('return await finalizeSocialCommentReply', provider)
  assert.ok(ownership >= 0 && ownership < actionLog)
  assert.ok(actionLog < token && token < provider)
  assert.ok(provider < receipt && receipt < persistence)
  assert.match(service, /REPLY_THROTTLE_MS = 10_000/)
  assert.match(service, /token\.scopes\.includes\('comment\.list\.manage'\)/)
  assert.match(service, /providerReplyFromActionLog/)
  assert.match(service, /providerOutcomeUnknown[\s\S]*'unknown'/)
  assert.match(service, /provider_dispatch_started_at/)
  assert.match(service, /abandon_stale_tiktok_reply_dispatch/)
  assert.match(route, /tiktokReplyEnabled: isTikTokCommentsReplyEnabled\(\)/)
  assert.match(client, /targets = inboxComments\.filter\([\s\S]*selectedReplyIds[\s\S]*canReplyToComment/)
  assert.match(client, /comment\.platform === "tiktok" && tiktokReplyEnabled/)
  assert.match(client, /replyAttemptKeysRef[\s\S]*getReplyAttempt/)
  assert.match(page, /tiktokReplyEnabled=\{isTikTokCommentsReplyEnabled\(\)\}/)
})

test('reply finalization migration is service-role-only, root-parent locked, and atomic', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20260727_social_comment_reply_finalize.sql',
    'utf8',
  )
  assert.match(migration, /status IN \('running', 'sent', 'completed', 'failed', 'unsupported', 'unknown'\)/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_tiktok_unresolved_comment_reply/)
  assert.match(migration, /COALESCE\(metadata->>'parent_external_comment_id', external_comment_id\)/)
  assert.match(migration, /ADD CONSTRAINT tiktok_reply_provider_target_required[\s\S]*metadata->>'parent_external_comment_id'/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.abandon_stale_tiktok_reply_dispatch/)
  assert.match(migration, /status = 'running'[\s\S]*provider_dispatch_started_at[\s\S]*created_at <= clock_timestamp\(\) - INTERVAL '2 minutes'/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.abandon_stale_tiktok_reply_dispatch[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.abandon_stale_tiktok_reply_dispatch[\s\S]*TO service_role/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mark_tiktok_reply_dispatch_started/)
  assert.match(migration, /metadata->>'reply_attempt_token' = p_reply_attempt_token::TEXT[\s\S]*provider_dispatch_started_at/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.mark_tiktok_reply_dispatch_started[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.mark_tiktok_reply_dispatch_started[\s\S]*TO service_role/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.transition_tiktok_reply_action/)
  assert.match(migration, /status = ANY\(p_from_statuses\)[\s\S]*reply_attempt_token' = p_reply_attempt_token::TEXT/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.transition_tiktok_reply_action[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.transition_tiktok_reply_action[\s\S]*TO service_role/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mark_stale_tiktok_reply_dispatch_unknown/)
  assert.match(migration, /reply_attempt_token' = p_reply_attempt_token::TEXT[\s\S]*provider_dispatch_started_at[\s\S]*INTERVAL '60 seconds'/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.mark_stale_tiktok_reply_dispatch_unknown[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.mark_stale_tiktok_reply_dispatch_unknown[\s\S]*TO service_role/)
  assert.match(migration, /platform = 'tiktok'[\s\S]*action_type = 'reply'[\s\S]*status IN \('running', 'sent', 'unknown'\)/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.finalize_social_comment_reply/)
  assert.match(migration, /reply action attempt mismatch/)
  assert.match(migration, /FROM public\.social_comment_action_logs[\s\S]*FOR UPDATE/)
  assert.match(migration, /IF action_row\.status = 'completed' THEN[\s\S]*RETURN reply_row/)
  assert.match(migration, /external_comment_id = p_parent_external_comment_id[\s\S]*FOR UPDATE/)
  assert.match(migration, /ON CONFLICT \(user_id, platform, account_id, external_comment_id\)[\s\S]*DO NOTHING[\s\S]*RETURNING \* INTO reply_row/)
  assert.match(migration, /inserted_reply := FOUND/)
  assert.match(migration, /IF inserted_reply THEN[\s\S]*reply_count = reply_count \+ 1/)
  assert.match(migration, /reply_to_comment_id = parent_row\.id/)
  assert.match(migration, /status = 'completed'/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.finalize_social_comment_reply[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.finalize_social_comment_reply[\s\S]*TO service_role/)
})

test('TikTok reply feature flags default closed and only enable the TikTok reply capability explicitly', () => {
  const featureFlags = loadTsModule(
    path.join(process.cwd(), 'src/lib/social-comments/feature-flag.ts'),
    { '@/lib/social-comments/types': { SOCIAL_PLATFORMS: ['youtube', 'tiktok', 'instagram', 'facebook'] } },
  )
  const replyPolicy = loadTsModule(
    path.join(process.cwd(), 'src/lib/social-comments/reply-policy.ts'),
    { '@/lib/social-comments/platform-capabilities': loadTsModule(
      path.join(process.cwd(), 'src/lib/social-comments/platform-capabilities.ts'),
    ) },
  )
  const previous = process.env.TIKTOK_COMMENTS_REPLY_ENABLED
  delete process.env.TIKTOK_COMMENTS_REPLY_ENABLED
  assert.equal(featureFlags.isTikTokCommentsReplyEnabled(), false)
  process.env.TIKTOK_COMMENTS_REPLY_ENABLED = 'true'
  assert.equal(featureFlags.isTikTokCommentsReplyEnabled(), true)
  if (previous === undefined) delete process.env.TIKTOK_COMMENTS_REPLY_ENABLED
  else process.env.TIKTOK_COMMENTS_REPLY_ENABLED = previous

  assert.equal(replyPolicy.isSocialCommentReplyPlatformEnabled('tiktok', false), false)
  assert.equal(replyPolicy.isSocialCommentReplyPlatformEnabled('tiktok', false, true), true)
  assert.equal(replyPolicy.isSocialCommentReplyPlatformEnabled('instagram', true, false), true)
  assert.equal(replyPolicy.isSocialCommentReplyPlatformEnabled('youtube', false, false), true)
})

test('Business refresh migration is service-role-only and uses parent-to-token fencing', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20260726_tiktok_business_comment_read.sql',
    'utf8',
  )
  assert.match(migration, /refresh_lease_token UUID/)
  assert.match(migration, /credential_generation UUID NOT NULL DEFAULT gen_random_uuid\(\)/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_tiktok_business_token_refresh/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.commit_tiktok_business_token_refresh/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.release_tiktok_business_token_refresh/)
  assert.match(migration, /CREATE TRIGGER fence_tiktok_business_token_replacement/)
  assert.match(migration, /NEW\.credential_generation := gen_random_uuid\(\)[\s\S]*NEW\.refresh_lease_token := NULL/)
  assert.match(migration, /BEFORE UPDATE OF[\s\S]*access_token_expires_at[\s\S]*refresh_token_expires_at[\s\S]*scopes[\s\S]*status/)
  assert.match(migration, /FROM public\.tiktok_accounts[\s\S]*FOR UPDATE[\s\S]*FROM public\.tiktok_business_account_tokens[\s\S]*FOR UPDATE/)
  assert.match(migration, /locked_refresh_lease_token IS DISTINCT FROM p_refresh_lease_token/)
  assert.match(migration, /locked_credential_generation IS DISTINCT FROM p_expected_credential_generation/)
  assert.match(migration, /parent_status IS DISTINCT FROM 'active'/)
  assert.match(migration, /locked_status IS DISTINCT FROM 'active'/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.commit_tiktok_business_token_refresh[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.commit_tiktok_business_token_refresh[\s\S]*TO service_role/)

  const manager = fs.readFileSync('src/lib/tiktok/business-token-manager.ts', 'utf8')
  assert.doesNotMatch(manager, /\.(?:eq|match)\([^\\n]*(?:access_token|refresh_token)/)
})

function createBusinessTokenAdmin(state, rpcImpl) {
  return {
    from(table) {
      const filters = {}
      return {
        select() { return this },
        eq(field, value) {
          filters[field] = value
          return this
        },
        async single() {
          if (table === 'tiktok_accounts') {
            const account = state.account
            const matches = account
              && account.id === filters.id
              && account.user_id === filters.user_id
              && account.account_type === filters.account_type
            return matches ? { data: { ...account }, error: null } : { data: null, error: { message: 'not found' } }
          }
          if (table === 'tiktok_business_account_tokens') {
            return state.token && state.account.id === filters.account_id
              ? { data: { ...state.token }, error: null }
              : { data: null, error: { message: 'not found' } }
          }
          throw new Error(`unexpected table ${table}`)
        },
      }
    },
    rpc(name, args) {
      return rpcImpl(name, args)
    },
  }
}

function loadBusinessTokenManager(refreshImpl) {
  return loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/business-token-manager.ts'),
    {
      '@/lib/tiktok/business-oauth': {
        calculateTikTokBusinessExpiration: (seconds) => new Date(Date.now() + seconds * 1000).toISOString(),
        hasTikTokBusinessCommentScopes: (scopes) => scopes.includes('comment.list') && scopes.includes('comment.list.manage'),
        parseTikTokBusinessScopes: (scope) => scope.split(',').map((item) => item.trim()).filter(Boolean),
        refreshTikTokBusinessAccessToken: refreshImpl,
      },
    },
  )
}

test('Business token manager refreshes with a lease and commits only the matching identity', async () => {
  const state = {
    account: {
      id: 'account-1',
      user_id: 'user-1',
      account_type: 'normal',
      status: 'active',
      display_name: 'Creator',
      username: 'creator',
    },
    token: {
      credential_generation: '11111111-1111-4111-8111-111111111111',
      business_open_id: 'business-open-id',
      access_token: 'expired-access',
      refresh_token: 'refresh-1',
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: ['comment.list', 'comment.list.manage'],
      status: 'active',
    },
  }
  const calls = []
  const admin = createBusinessTokenAdmin(state, async (name, args) => {
    calls.push({ name, args })
    if (name === 'claim_tiktok_business_token_refresh') return { data: true, error: null }
    if (name === 'commit_tiktok_business_token_refresh') {
      state.token = {
        ...state.token,
        access_token: args.p_access_token,
        refresh_token: args.p_refresh_token,
        access_token_expires_at: args.p_access_token_expires_at,
        refresh_token_expires_at: args.p_refresh_token_expires_at,
        scopes: args.p_scopes,
      }
      return { data: true, error: null }
    }
    if (name === 'release_tiktok_business_token_refresh') return { data: true, error: null }
    throw new Error(`unexpected RPC ${name}`)
  })
  const manager = loadBusinessTokenManager(async (refreshToken) => {
    assert.equal(refreshToken, 'refresh-1')
    return {
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      open_id: 'business-open-id',
      scope: 'comment.list,comment.list.manage',
      token_type: 'Bearer',
    }
  })

  const result = await manager.getTikTokBusinessCommentToken(admin, 'user-1', 'account-1')
  assert.equal(result.accessToken, 'access-2')
  assert.equal(result.businessOpenId, 'business-open-id')
  assert.deepEqual(calls.map((call) => call.name), [
    'claim_tiktok_business_token_refresh',
    'commit_tiktok_business_token_refresh',
  ])
  assert.equal(
    calls[0].args.p_refresh_lease_token,
    calls[1].args.p_refresh_lease_token,
  )
  assert.equal(calls[1].args.p_refresh_token, 'refresh-2')
})

test('Business token manager rejects a refreshed token for a different identity and releases its lease', async () => {
  const state = {
    account: {
      id: 'account-1',
      user_id: 'user-1',
      account_type: 'normal',
      status: 'active',
      display_name: 'Creator',
    },
    token: {
      credential_generation: '11111111-1111-4111-8111-111111111111',
      business_open_id: 'business-open-id',
      access_token: 'expired-access',
      refresh_token: 'refresh-1',
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: ['comment.list', 'comment.list.manage'],
      status: 'active',
    },
  }
  const calls = []
  const admin = createBusinessTokenAdmin(state, async (name, args) => {
    calls.push({ name, args })
    if (name === 'claim_tiktok_business_token_refresh') return { data: true, error: null }
    if (name === 'release_tiktok_business_token_refresh') return { data: true, error: null }
    throw new Error('commit must not run')
  })
  const manager = loadBusinessTokenManager(async () => ({
    access_token: 'other-access',
    refresh_token: 'other-refresh',
    expires_in: 3600,
    refresh_token_expires_in: 7200,
    open_id: 'different-business-open-id',
    scope: 'comment.list,comment.list.manage',
    token_type: 'Bearer',
  }))

  await assert.rejects(
    () => manager.getTikTokBusinessCommentToken(admin, 'user-1', 'account-1'),
    /unexpected Business identity/,
  )
  assert.deepEqual(calls.map((call) => call.name), [
    'claim_tiktok_business_token_refresh',
    'release_tiktok_business_token_refresh',
  ])
  assert.equal(
    calls[0].args.p_refresh_lease_token,
    calls[1].args.p_refresh_lease_token,
  )
})

test('reauthorization between initial read and claim wins by credential generation CAS', async () => {
  const state = {
    account: {
      id: 'account-1',
      user_id: 'user-1',
      account_type: 'normal',
      status: 'active',
      display_name: 'Creator',
    },
    token: {
      credential_generation: '11111111-1111-4111-8111-111111111111',
      business_open_id: 'business-open-id',
      access_token: 'old-expired-access',
      refresh_token: 'old-refresh',
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: ['comment.list', 'comment.list.manage'],
      status: 'active',
    },
  }
  let providerCalls = 0
  const rpcCalls = []
  const admin = createBusinessTokenAdmin(state, async (name, args) => {
    rpcCalls.push({ name, args })
    if (name !== 'claim_tiktok_business_token_refresh') {
      throw new Error(`unexpected RPC ${name}`)
    }

    state.token = {
      ...state.token,
      credential_generation: '22222222-2222-4222-8222-222222222222',
      access_token: 'reauthorized-access',
      refresh_token: 'reauthorized-refresh',
      access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }
    const generationStillMatches =
      args.p_expected_credential_generation === state.token.credential_generation
    return { data: generationStillMatches, error: null }
  })
  const manager = loadBusinessTokenManager(async () => {
    providerCalls += 1
    throw new Error('stale refresh token must never reach provider')
  })

  const result = await manager.getTikTokBusinessCommentToken(admin, 'user-1', 'account-1')
  assert.equal(result.accessToken, 'reauthorized-access')
  assert.equal(providerCalls, 0)
  assert.equal(rpcCalls.length, 1)
  assert.equal(
    rpcCalls[0].args.p_expected_credential_generation,
    '11111111-1111-4111-8111-111111111111',
  )
})

test('same-token OAuth renewal after claim advances generation and rejects the old commit', () => {
  const state = {
    accessToken: 'same-access',
    refreshToken: 'same-refresh',
    expiresAt: '2026-07-23T01:00:00.000Z',
    scopes: ['comment.list', 'comment.list.manage'],
    generation: 'generation-1',
    lease: null,
  }
  const expectedGeneration = state.generation
  state.lease = 'lease-1'

  // Models the unconditional BEFORE UPDATE OF authorization-material trigger:
  // provider may reuse A/R, but expiry/scope renewal still starts generation 2.
  state.expiresAt = '2026-07-24T01:00:00.000Z'
  state.scopes = [...state.scopes, 'user.info.basic']
  state.generation = 'generation-2'
  state.lease = null

  const oldCommitCanWin =
    state.generation === expectedGeneration
    && state.lease === 'lease-1'
  assert.equal(oldCommitCanWin, false)

  const migration = fs.readFileSync(
    'supabase/migrations/20260726_tiktok_business_comment_read.sql',
    'utf8',
  )
  assert.match(
    migration,
    /NEW\.credential_generation := gen_random_uuid\(\)[\s\S]*NEW\.refresh_lease_token := NULL[\s\S]*BEFORE UPDATE OF[\s\S]*access_token_expires_at[\s\S]*scopes/,
  )
})

test('manager cannot return a refresh winner after the parent account is deactivated', async () => {
  const state = {
    account: {
      id: 'account-1',
      user_id: 'user-1',
      account_type: 'normal',
      status: 'active',
      display_name: 'Creator',
    },
    token: {
      credential_generation: '11111111-1111-4111-8111-111111111111',
      business_open_id: 'business-open-id',
      access_token: 'old-expired-access',
      refresh_token: 'old-refresh',
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: ['comment.list', 'comment.list.manage'],
      status: 'active',
    },
  }
  const admin = createBusinessTokenAdmin(state, async (name) => {
    if (name === 'claim_tiktok_business_token_refresh') {
      state.account.status = 'revoked'
      state.token = {
        ...state.token,
        credential_generation: '22222222-2222-4222-8222-222222222222',
        access_token: 'other-winner-access',
        access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }
      return { data: false, error: null }
    }
    throw new Error(`unexpected RPC ${name}`)
  })
  const manager = loadBusinessTokenManager(async () => {
    throw new Error('provider must not run')
  })

  await assert.rejects(
    () => manager.getTikTokBusinessCommentToken(admin, 'user-1', 'account-1'),
    (error) => {
      assert.equal(error.code, 'account_not_active')
      assert.equal(error.httpStatus, 403)
      return true
    },
  )
})

test('Shop account IDs fail before Business token lookup, refresh, or provider access', async () => {
  const state = {
    account: {
      id: 'shop-account',
      user_id: 'user-1',
      account_type: 'shop_creator',
      status: 'active',
      display_name: 'Shop',
    },
    token: null,
  }
  let rpcCalls = 0
  let providerCalls = 0
  const admin = createBusinessTokenAdmin(state, async () => {
    rpcCalls += 1
    throw new Error('RPC must not run')
  })
  const manager = loadBusinessTokenManager(async () => {
    providerCalls += 1
    throw new Error('provider must not run')
  })

  await assert.rejects(
    () => manager.getTikTokBusinessCommentToken(admin, 'user-1', 'shop-account'),
    (error) => {
      assert.equal(error.code, 'account_not_found')
      assert.equal(error.httpStatus, 404)
      return true
    },
  )
  assert.equal(rpcCalls, 0)
  assert.equal(providerCalls, 0)
})

test('foreign normal account IDs fail before Business token lookup or provider access', async () => {
  const state = {
    account: {
      id: 'foreign-account',
      user_id: 'other-user',
      account_type: 'normal',
      status: 'active',
      display_name: 'Other Creator',
    },
    token: null,
  }
  let rpcCalls = 0
  let providerCalls = 0
  const admin = createBusinessTokenAdmin(state, async () => {
    rpcCalls += 1
    throw new Error('RPC must not run')
  })
  const manager = loadBusinessTokenManager(async () => {
    providerCalls += 1
    throw new Error('provider must not run')
  })

  await assert.rejects(
    () => manager.getTikTokBusinessCommentToken(admin, 'user-1', 'foreign-account'),
    (error) => {
      assert.equal(error.code, 'account_not_found')
      assert.equal(error.httpStatus, 404)
      return true
    },
  )
  assert.equal(rpcCalls, 0)
  assert.equal(providerCalls, 0)
})

test('TikTok reply requests stop at the disabled server gate before token or provider access', async () => {
  const capabilities = loadTsModule(
    path.join(process.cwd(), 'src/lib/social-comments/platform-capabilities.ts'),
  )
  const platformApi = loadPlatformApi(async () => {
    throw new Error('provider must not run')
  })
  let tokenLookups = 0
  const comment = {
    id: 'saved-comment',
    user_id: 'user-1',
    platform: 'tiktok',
    account_id: 'account-1',
    task_item_id: 'item-1',
    external_comment_id: 'comment-1',
    external_content_id: 'video-1',
    parent_external_comment_id: null,
    thread_external_id: 'comment-1',
    direction: 'inbound',
    author_id: 'viewer-1',
    author_name: 'Viewer',
    author_avatar_url: null,
    message: 'Hello',
    like_count: 0,
    reply_count: 0,
    can_reply: false,
    is_from_account: false,
    permalink: null,
    status: 'synced',
    metadata: {},
    remote_created_at: null,
    local_error_code: null,
    local_error_message: null,
    reply_to_comment_id: null,
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  }
  const admin = {
    from(table) {
      assert.equal(table, 'social_comments')
      const query = {
        select() { return query },
        eq() { return query },
        async single() { return { data: comment, error: null } },
      }
      return query
    },
  }
  class TikTokBusinessTokenAccessError extends Error {}
  const service = loadTsModule(
    path.join(process.cwd(), 'src/lib/social-comments/service.ts'),
    {
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/social-comments/action-log': {
        mergeActionLogMetadata: (initial, terminal) => ({ ...initial, ...terminal }),
      },
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
      '@/lib/social-comments/reply-policy': {
        isSocialCommentReplyPlatformEnabled: () => false,
      },
      '@/lib/social-comments/platform-capabilities': capabilities,
      '@/lib/social-comments/persistence-policy': {
        resolveSocialCommentPersistence: () => { throw new Error('unexpected persistence') },
      },
      '@/lib/tiktok/business-token-manager': {
        TikTokBusinessTokenAccessError,
        getTikTokBusinessCommentToken: async () => {
          tokenLookups += 1
          throw new Error('token lookup must not run')
        },
      },
    },
  )

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'saved-comment',
      'reply',
      'tiktok-read-only-123',
      { enabledPlatforms: ['tiktok'] },
    ),
    (error) => {
      assert.equal(error.platform, 'tiktok')
      assert.equal(error.code, 'reply_disabled')
      assert.equal(error.httpStatus, 403)
      return true
    },
  )
  assert.equal(tokenLookups, 0)
})

function createReplyServiceHarness({
  providerError = null,
  failFirstFinalize = false,
  failFirstReceiptWrite = false,
  holdProvider = false,
  providerFailures = 0,
  includeNestedComment = false,
  beforeAbandonRpc = null,
  holdFirstMarker = false,
  holdFirstTokenLookup = false,
  failFirstTokenLookup = false,
  beforeStaleUnknownRpc = null,
} = {}) {
  const parent = {
    id: 'parent-row',
    user_id: 'user-1',
    platform: 'tiktok',
    account_id: 'account-1',
    task_item_id: 'item-1',
    external_comment_id: 'comment-1',
    external_content_id: 'video-1',
    parent_external_comment_id: null,
    thread_external_id: 'comment-1',
    direction: 'inbound',
    author_id: 'viewer-1',
    author_name: 'Viewer',
    author_avatar_url: null,
    message: 'Hello',
    like_count: 0,
    reply_count: 0,
    can_reply: true,
    is_from_account: false,
    permalink: null,
    status: 'synced',
    metadata: {},
    remote_created_at: null,
    local_error_code: null,
    local_error_message: null,
    reply_to_comment_id: null,
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  }
  const nestedComment = {
    ...parent,
    id: 'child-row',
    external_comment_id: 'child-comment-1',
    parent_external_comment_id: 'comment-1',
    thread_external_id: 'comment-1',
    reply_to_comment_id: 'parent-row',
    message: 'Nested hello',
  }
  const state = {
    actionLogs: [],
    savedReply: null,
    providerCalls: 0,
    finalizeCalls: 0,
    receiptWriteFailuresRemaining: failFirstReceiptWrite ? 1 : 0,
    releaseProvider: null,
    providerFailuresRemaining: providerFailures,
    markerCalls: 0,
    releaseFirstMarker: null,
    tokenLookups: 0,
    releaseFirstTokenLookup: null,
  }
  const providerBarrier = holdProvider
    ? new Promise((resolve) => { state.releaseProvider = resolve })
    : null
  const firstMarkerBarrier = holdFirstMarker
    ? new Promise((resolve) => { state.releaseFirstMarker = resolve })
    : null
  const firstTokenBarrier = holdFirstTokenLookup
    ? new Promise((resolve) => { state.releaseFirstTokenLookup = resolve })
    : null

  function filteredRows(table, filters) {
    let rows
    if (table === 'social_comments') {
      rows = [
        parent,
        ...(includeNestedComment ? [nestedComment] : []),
        ...(state.savedReply ? [state.savedReply] : []),
      ]
    } else if (table === 'tiktok_accounts') {
      rows = [{ id: 'account-1', user_id: 'user-1' }]
    } else if (table === 'publish_task_items') {
      rows = [{
        id: 'item-1',
        task_id: 'task-1',
        account_id: 'account-1',
        title: 'Video',
        source_video_name: null,
        tiktok_video_id: 'video-1',
        status: 'published',
      }]
    } else if (table === 'publish_tasks') {
      rows = [{ id: 'task-1', user_id: 'user-1', task_name: 'Task' }]
    } else if (table === 'social_comment_action_logs') {
      rows = state.actionLogs
    } else {
      throw new Error(`unexpected table ${table}`)
    }
    return rows.filter((row) => Object.entries(filters).every(([field, value]) => row[field] === value))
  }

  const admin = {
    from(table) {
      const filters = {}
      const notEqualFilters = {}
      const inFilters = {}
      let insertPayload = null
      let updatePayload = null
      const query = {
        select() { return query },
        eq(field, value) {
          filters[field] = value
          return query
        },
        in(field, values) {
          inFilters[field] = values
          return query
        },
        gte() { return query },
        neq(field, value) {
          notEqualFilters[field] = value
          return query
        },
        not() { return query },
        limit() { return query },
        insert(payload) {
          insertPayload = payload
          return query
        },
        update(payload) {
          updatePayload = payload
          return query
        },
        async single() {
          if (insertPayload) {
            const duplicate = state.actionLogs.find((row) =>
              (
                row.user_id === insertPayload.user_id
                && row.action_type === insertPayload.action_type
                && row.idempotency_key === insertPayload.idempotency_key
              )
              || (
                insertPayload.platform === 'tiktok'
                && insertPayload.action_type === 'reply'
                && ['running', 'sent', 'unknown'].includes(row.status)
                && row.user_id === insertPayload.user_id
                && row.platform === insertPayload.platform
                && row.account_id === insertPayload.account_id
                && (row.metadata?.parent_external_comment_id || row.external_comment_id)
                  === (insertPayload.metadata?.parent_external_comment_id || insertPayload.external_comment_id)
              ))
            if (duplicate) return { data: null, error: { code: '23505', message: 'duplicate' } }
            const row = { id: `log-${state.actionLogs.length + 1}`, created_at: new Date().toISOString(), ...insertPayload }
            state.actionLogs.push(row)
            return { data: { ...row }, error: null }
          }
          const row = filteredRows(table, filters)
            .filter((item) => Object.entries(notEqualFilters).every(([field, value]) => item[field] !== value))
            .filter((item) => Object.entries(inFilters).every(([field, values]) => values.includes(item[field])))[0] || null
          return { data: row ? { ...row } : null, error: row ? null : { message: 'not found' } }
        },
        async maybeSingle() {
          const rows = filteredRows(table, filters)
            .filter((item) => Object.entries(notEqualFilters).every(([field, value]) => item[field] !== value))
            .filter((item) => Object.entries(inFilters).every(([field, values]) => values.includes(item[field])))
          if (updatePayload) {
            for (const item of rows) Object.assign(item, updatePayload)
          }
          const row = rows[0] || null
          return { data: row ? { ...row } : null, error: null }
        },
        then(resolve) {
          if (updatePayload) {
            const rows = filteredRows(table, filters)
              .filter((item) => Object.entries(notEqualFilters).every(([field, value]) => item[field] !== value))
              .filter((item) => Object.entries(inFilters).every(([field, values]) => values.includes(item[field])))
            if (
              table === 'social_comment_action_logs'
              && updatePayload.status === 'sent'
              && state.receiptWriteFailuresRemaining > 0
            ) {
              state.receiptWriteFailuresRemaining -= 1
              return Promise.resolve({
                data: null,
                error: { message: 'temporary receipt write failure' },
              }).then(resolve)
            }
            for (const row of rows) Object.assign(row, updatePayload)
            return Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null }).then(resolve)
          }
          return Promise.resolve({
            data: filteredRows(table, filters)
              .filter((item) => Object.entries(notEqualFilters).every(([field, value]) => item[field] !== value))
              .filter((item) => Object.entries(inFilters).every(([field, values]) => values.includes(item[field])))
              .map((row) => ({ ...row })),
            error: null,
          }).then(resolve)
        },
      }
      return query
    },
    async rpc(name, args) {
      if (name === 'mark_tiktok_reply_dispatch_started') {
        state.markerCalls += 1
        if (firstMarkerBarrier && state.markerCalls === 1) await firstMarkerBarrier
        const log = state.actionLogs.find((row) =>
          row.id === args.p_action_log_id
          && row.user_id === args.p_user_id
          && row.platform === 'tiktok'
          && row.action_type === 'reply'
          && row.status === 'running'
          && row.metadata?.reply_attempt_token === args.p_reply_attempt_token
          && !String(row.metadata?.provider_dispatch_started_at || '').trim()
        )
        if (!log) return { data: false, error: null }
        log.metadata = {
          ...(log.metadata || {}),
          provider_dispatch_started_at: new Date().toISOString(),
        }
        return { data: true, error: null }
      }
      if (name === 'abandon_stale_tiktok_reply_dispatch') {
        if (beforeAbandonRpc) await beforeAbandonRpc(state)
        const log = state.actionLogs.find((row) =>
          row.id === args.p_action_log_id
          && row.user_id === args.p_user_id
          && row.platform === 'tiktok'
          && row.action_type === 'reply'
          && row.status === 'running'
          && row.metadata?.reply_attempt_token === args.p_reply_attempt_token
          && !String(row.metadata?.provider_dispatch_started_at || '').trim()
          && new Date(row.created_at).getTime() <= Date.now() - 2 * 60_000)
        if (!log) return { data: false, error: null }
        log.status = 'failed'
        log.error_code = 'reply_dispatch_abandoned'
        log.error_message = 'TikTok reply dispatch did not start.'
        log.metadata = {
          ...(log.metadata || {}),
          provider_dispatch_started: false,
          stale_predispatch_detected_at: new Date().toISOString(),
        }
        log.completed_at = new Date().toISOString()
        return { data: true, error: null }
      }
      if (name === 'transition_tiktok_reply_action') {
        if (
          args.p_to_status === 'sent'
          && state.receiptWriteFailuresRemaining > 0
        ) {
          state.receiptWriteFailuresRemaining -= 1
          return { data: null, error: { message: 'temporary receipt write failure' } }
        }
        const log = state.actionLogs.find((row) =>
          row.id === args.p_action_log_id
          && row.user_id === args.p_user_id
          && row.platform === 'tiktok'
          && row.action_type === 'reply'
          && args.p_from_statuses.includes(row.status)
          && row.metadata?.reply_attempt_token === args.p_reply_attempt_token
        )
        if (!log) return { data: false, error: null }
        log.status = args.p_to_status
        log.error_code = args.p_error_code
        log.error_message = args.p_error_message
        log.metadata = { ...(log.metadata || {}), ...(args.p_metadata || {}) }
        log.completed_at = new Date().toISOString()
        return { data: true, error: null }
      }
      if (name === 'mark_stale_tiktok_reply_dispatch_unknown') {
        if (beforeStaleUnknownRpc) await beforeStaleUnknownRpc(state)
        const log = state.actionLogs.find((row) =>
          row.id === args.p_action_log_id
          && row.user_id === args.p_user_id
          && row.platform === 'tiktok'
          && row.action_type === 'reply'
          && row.status === 'running'
          && row.metadata?.reply_attempt_token === args.p_reply_attempt_token
          && String(row.metadata?.provider_dispatch_started_at || '').trim()
          && new Date(row.metadata.provider_dispatch_started_at).getTime()
            <= Date.now() - 60_000
        )
        if (!log) return { data: false, error: null }
        log.status = 'unknown'
        log.error_code = 'reply_outcome_unknown'
        log.error_message = 'TikTok reply dispatch did not record a provider receipt.'
        log.metadata = {
          ...(log.metadata || {}),
          provider_outcome_unknown: true,
          stale_dispatch_detected_at: new Date().toISOString(),
        }
        log.completed_at = new Date().toISOString()
        return { data: true, error: null }
      }
      assert.equal(name, 'finalize_social_comment_reply')
      state.finalizeCalls += 1
      if (failFirstFinalize && state.finalizeCalls === 1) {
        return { data: null, error: { message: 'temporary local finalization failure' } }
      }
      const log = state.actionLogs.find((row) => row.id === args.p_action_log_id)
      if (
        !log
        || !['running', 'sent', 'unknown', 'completed'].includes(log.status)
        || log.metadata?.reply_attempt_token !== args.p_reply_attempt_token
      ) {
        return { data: null, error: { message: 'reply action is not finalizable' } }
      }
      if (log.status === 'completed' && state.savedReply) {
        return { data: { ...state.savedReply }, error: null }
      }
      const reply = {
        id: 'saved-reply',
        user_id: 'user-1',
        platform: 'tiktok',
        account_id: 'account-1',
        task_item_id: 'item-1',
        ...args.p_reply,
        direction: 'outbound',
        status: 'sent',
        can_reply: false,
        is_from_account: true,
        reply_to_comment_id: 'parent-row',
        local_error_code: null,
        local_error_message: null,
        created_at: '2026-07-23T00:01:00.000Z',
        updated_at: '2026-07-23T00:01:00.000Z',
      }
      state.savedReply = reply
      if (log) {
        log.status = 'completed'
        log.metadata = { ...log.metadata, reply_comment_id: reply.id }
      }
      return { data: { ...reply }, error: null }
    },
  }

  class SocialCommentApiError extends Error {
    constructor(
      platform,
      code,
      message,
      httpStatus = 500,
      retryable = false,
      retryAfter = null,
      providerWriteOutcome = null,
    ) {
      super(message)
      this.platform = platform
      this.code = code
      this.httpStatus = httpStatus
      this.retryable = retryable
      this.retryAfter = retryAfter
      this.providerWriteOutcome = providerWriteOutcome
    }
  }
  class SocialCommentUnsupportedError extends SocialCommentApiError {}
  class TikTokBusinessTokenAccessError extends Error {}
  const platformApi = {
    SocialCommentApiError,
    SocialCommentUnsupportedError,
    listFacebookComments: async () => [],
    listInstagramComments: async () => [],
    listTikTokComments: async () => ({ comments: [] }),
    listYouTubeComments: async () => ({ comments: [] }),
    replyToFacebookComment: async () => { throw new Error('unexpected Facebook reply') },
    replyToInstagramComment: async () => { throw new Error('unexpected Instagram reply') },
    replyToYouTubeComment: async () => { throw new Error('unexpected YouTube reply') },
    replyToTikTokComment: async () => {
      state.providerCalls += 1
      if (providerBarrier) await providerBarrier
      if (providerError && (providerFailures === 0 || state.providerFailuresRemaining > 0)) {
        if (state.providerFailuresRemaining > 0) state.providerFailuresRemaining -= 1
        throw providerError(SocialCommentApiError)
      }
      return {
        external_comment_id: 'provider-reply-1',
        external_content_id: 'video-1',
        parent_external_comment_id: 'comment-1',
        thread_external_id: 'comment-1',
        author_id: 'business-open-id',
        author_name: 'Creator',
        author_avatar_url: null,
        message: 'Manual reply',
        like_count: 0,
        reply_count: 0,
        can_reply: false,
        is_from_account: true,
        permalink: null,
        remote_created_at: null,
        metadata: {},
      }
    },
  }
  const service = loadTsModule(
    path.join(process.cwd(), 'src/lib/social-comments/service.ts'),
    {
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/social-comments/action-log': {
        mergeActionLogMetadata: (initial, terminal) => ({ ...(initial || {}), ...(terminal || {}) }),
      },
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
      '@/lib/social-comments/reply-policy': {
        isSocialCommentReplyPlatformEnabled: () => true,
      },
      '@/lib/social-comments/platform-capabilities': {
        getSocialCommentPlatformCapabilities: () => ({
          read: 'supported',
          sync: 'supported',
          reply: 'feature_flag',
          requires_explicit_content: true,
          recent_sync: false,
          auto_sync: false,
        }),
        isSocialCommentOperationSupported: () => true,
      },
      '@/lib/social-comments/persistence-policy': {
        resolveSocialCommentPersistence: () => { throw new Error('legacy reply persistence must not run') },
      },
      '@/lib/tiktok/business-token-manager': {
        TikTokBusinessTokenAccessError,
        getTikTokBusinessCommentToken: async () => {
          state.tokenLookups += 1
          const lookupNumber = state.tokenLookups
          if (firstTokenBarrier && lookupNumber === 1) await firstTokenBarrier
          if (failFirstTokenLookup && lookupNumber === 1) {
            throw new SocialCommentApiError(
              'tiktok',
              'missing_comment_scope',
              'TikTok comment management permission is missing.',
              403,
            )
          }
          return {
            accountId: 'account-1',
            businessOpenId: 'business-open-id',
            accountName: 'Creator',
            accessToken: 'secure-token',
            scopes: ['comment.list', 'comment.list.manage'],
          }
        },
      },
    },
  )
  return { service, state, admin }
}

test('TikTok 1200-code-point reply limit runs before action log and provider dispatch', async () => {
  const overLimit = createReplyServiceHarness()
  await assert.rejects(
    () => overLimit.service.replyToSocialComment(
      'user-1',
      'parent-row',
      '😀'.repeat(1201),
      'unicode-over-limit-key',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'reply_too_long' && error.platform === 'tiktok',
  )
  assert.equal(overLimit.state.actionLogs.length, 0)
  assert.equal(overLimit.state.providerCalls, 0)

  const atLimit = createReplyServiceHarness()
  const saved = await atLimit.service.replyToSocialComment(
    'user-1',
    'parent-row',
    '😀'.repeat(1200),
    'unicode-at-limit-key',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  )
  assert.equal(saved.id, 'saved-reply')
  assert.equal(atLimit.state.providerCalls, 1)
})

test('provider success followed by local failure resumes the same receipt without a second TikTok reply', async () => {
  const { service, state } = createReplyServiceHarness({ failFirstFinalize: true })
  const args = [
    'user-1',
    'parent-row',
    'Manual reply',
    'stable-reply-key-123',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  ]

  await assert.rejects(() => service.replyToSocialComment(...args), /temporary local finalization failure/)
  assert.equal(state.providerCalls, 1)
  assert.equal(state.actionLogs[0].status, 'sent')
  assert.equal(state.actionLogs[0].metadata.provider_reply.external_comment_id, 'provider-reply-1')

  const saved = await service.replyToSocialComment(...args)
  assert.equal(saved.id, 'saved-reply')
  assert.equal(saved.reply_to_comment_id, 'parent-row')
  assert.equal(state.providerCalls, 1)
  assert.equal(state.finalizeCalls, 2)
  assert.equal(state.actionLogs[0].status, 'completed')
})

test('a transient provider-receipt log failure is retried as sent and never repeats the provider write', async () => {
  const { service, state } = createReplyServiceHarness({ failFirstReceiptWrite: true })
  const args = [
    'user-1',
    'parent-row',
    'Manual reply',
    'receipt-retry-key-123',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  ]

  await assert.rejects(
    () => service.replyToSocialComment(...args),
    (error) => error?.message === 'temporary receipt write failure',
  )
  assert.equal(state.providerCalls, 1)
  assert.equal(state.actionLogs[0].status, 'sent')
  assert.equal(state.actionLogs[0].metadata.provider_reply.external_comment_id, 'provider-reply-1')

  const saved = await service.replyToSocialComment(...args)
  assert.equal(saved.id, 'saved-reply')
  assert.equal(state.providerCalls, 1)
  assert.equal(state.actionLogs[0].status, 'completed')
})

test('ambiguous TikTok transport failure becomes unknown and blocks every retry before provider access', async () => {
  const { service, state } = createReplyServiceHarness({
    providerError: (SocialCommentApiError) => new SocialCommentApiError(
      'tiktok',
      'provider_unreachable',
      'TikTok Business comment service is temporarily unreachable.',
      503,
      true,
    ),
  })

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Manual reply',
      'unknown-reply-key-123',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'provider_unreachable',
  )
  assert.equal(state.providerCalls, 1)
  assert.equal(state.actionLogs[0].status, 'unknown')

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Manual reply',
      'different-reply-key-456',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'reply_outcome_unknown',
  )
  assert.equal(state.providerCalls, 1)
})

test('TikTok 5xx after dispatch is unknown and keeps the cross-key provider fence', async () => {
  const { service, state } = createReplyServiceHarness({
    providerError: (SocialCommentApiError) => new SocialCommentApiError(
      'tiktok',
      '500',
      'TikTok Business comment request failed.',
      500,
      true,
      null,
      'unknown',
    ),
  })

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Manual reply',
      'unknown-5xx-key-123',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === '500',
  )
  assert.equal(state.actionLogs[0].status, 'unknown')

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Manual reply',
      'unknown-5xx-different-key-456',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'reply_outcome_unknown',
  )
  assert.equal(state.providerCalls, 1)
})

test('TikTok HTTP 408 after dispatch is unknown and keeps the cross-key provider fence', async () => {
  const { service, state } = createReplyServiceHarness({
    providerError: (SocialCommentApiError) => new SocialCommentApiError(
      'tiktok',
      '408',
      'TikTok Business comment request timed out.',
      408,
      true,
      null,
      'unknown',
    ),
  })

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Manual reply',
      'unknown-408-key-123',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === '408',
  )
  assert.equal(state.actionLogs[0].status, 'unknown')

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Manual reply',
      'unknown-408-different-key-456',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'reply_outcome_unknown',
  )
  assert.equal(state.providerCalls, 1)
})

test('a synchronization winner cannot be downgraded by the original in-flight request catch', async () => {
  const { service, state, admin } = createReplyServiceHarness({
    holdProvider: true,
    providerError: (SocialCommentApiError) => new SocialCommentApiError(
      'tiktok',
      'provider_unreachable',
      'TikTok Business comment service is temporarily unreachable.',
      503,
      true,
      null,
      'unknown',
    ),
  })
  const request = service.replyToSocialComment(
    'user-1',
    'parent-row',
    'Manual reply',
    'sync-winner-key-123',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  )
  while (state.providerCalls === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }

  await admin.rpc('finalize_social_comment_reply', {
    p_user_id: 'user-1',
    p_action_log_id: state.actionLogs[0].id,
    p_reply_attempt_token: state.actionLogs[0].metadata.reply_attempt_token,
    p_parent_external_comment_id: 'comment-1',
    p_task_item_id: 'item-1',
    p_reply: reconciledProviderReply('sync-winner-reply', new Date().toISOString()),
  })
  state.releaseProvider()

  const saved = await request
  assert.equal(saved.external_comment_id, 'sync-winner-reply')
  assert.equal(state.actionLogs[0].status, 'completed')
  assert.equal(state.providerCalls, 1)
})

test('a definite provider rejection can restart the same stable key after the condition is fixed', async () => {
  const { service, state } = createReplyServiceHarness({
    providerFailures: 1,
    providerError: (SocialCommentApiError) => new SocialCommentApiError(
      'tiktok',
      'invalid_request',
      'TikTok Business comment request failed.',
      400,
      false,
    ),
  })
  const args = [
    'user-1',
    'parent-row',
    'Manual reply',
    'fixed-condition-key-123',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  ]

  await assert.rejects(() => service.replyToSocialComment(...args), (error) => error.code === 'invalid_request')
  assert.equal(state.providerCalls, 1)
  assert.equal(state.actionLogs[0].status, 'failed')

  const saved = await service.replyToSocialComment(...args)
  assert.equal(saved.id, 'saved-reply')
  assert.equal(state.providerCalls, 2)
  assert.equal(state.actionLogs[0].status, 'completed')
})

test('comment sync reconciles an unknown TikTok reply by target, account author, message hash, and time', async () => {
  const { service, state, admin } = createReplyServiceHarness({
    providerError: (SocialCommentApiError) => new SocialCommentApiError(
      'tiktok',
      'provider_unreachable',
      'TikTok Business comment service is temporarily unreachable.',
      503,
      true,
    ),
  })
  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Manual reply',
      'reconcile-unknown-key-123',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'provider_unreachable',
  )
  assert.equal(state.actionLogs[0].status, 'unknown')

  const remoteCreatedAt = new Date(Date.now() + 1000).toISOString()
  await service.reconcileUnknownTikTokReplies(
    admin,
    'user-1',
    'account-1',
    'item-1',
    'video-1',
    [{
      external_comment_id: 'provider-reply-reconciled',
      external_content_id: 'video-1',
      parent_external_comment_id: 'comment-1',
      thread_external_id: 'comment-1',
      author_id: 'business-open-id',
      author_name: 'Creator',
      author_avatar_url: null,
      message: 'Manual reply',
      like_count: 0,
      reply_count: 0,
      can_reply: false,
      is_from_account: true,
      permalink: null,
      remote_created_at: remoteCreatedAt,
      metadata: {},
    }],
  )

  assert.equal(state.actionLogs[0].status, 'completed')
  assert.equal(state.savedReply.external_comment_id, 'provider-reply-reconciled')
  assert.equal(state.savedReply.metadata.reconciled_from_unknown, true)
})

test('different keys cannot bypass the unresolved TikTok target fence while the provider call is in flight', async () => {
  const { service, state } = createReplyServiceHarness({ holdProvider: true })
  const first = service.replyToSocialComment(
    'user-1',
    'parent-row',
    'Manual reply',
    'concurrent-reply-key-1',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  )
  while (state.providerCalls === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Different manual reply',
      'concurrent-reply-key-2',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'duplicate_request_running',
  )
  assert.equal(state.providerCalls, 1)
  state.releaseProvider()
  const saved = await first
  assert.equal(saved.id, 'saved-reply')
  assert.equal(state.providerCalls, 1)
})

test('root and nested comment selections share one unresolved TikTok provider-parent fence', async () => {
  const { service, state } = createReplyServiceHarness({
    holdProvider: true,
    includeNestedComment: true,
  })
  const first = service.replyToSocialComment(
    'user-1',
    'parent-row',
    'Manual reply',
    'root-reply-key-1',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  )
  while (state.providerCalls === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'child-row',
      'Nested reply using the same provider target',
      'child-reply-key-2',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'duplicate_request_running',
  )
  assert.equal(state.providerCalls, 1)
  state.releaseProvider()
  await first
  assert.equal(state.providerCalls, 1)
})

function reconciledProviderReply(externalCommentId, remoteCreatedAt) {
  return {
    external_comment_id: externalCommentId,
    external_content_id: 'video-1',
    parent_external_comment_id: 'comment-1',
    thread_external_id: 'comment-1',
    author_id: 'business-open-id',
    author_name: 'Creator',
    author_avatar_url: null,
    message: 'Manual reply',
    like_count: 0,
    reply_count: 0,
    can_reply: false,
    is_from_account: true,
    permalink: null,
    remote_created_at: remoteCreatedAt,
    metadata: {},
  }
}

test('stale running TikTok dispatch becomes unknown and enters the reconciliation path', async () => {
  const { service, state, admin } = createReplyServiceHarness()
  const dispatchStartedAt = new Date(Date.now() - 90_000).toISOString()
  state.actionLogs.push({
    id: 'stale-running-log',
    user_id: 'user-1',
    platform: 'tiktok',
    account_id: 'account-1',
    external_content_id: 'video-1',
    external_comment_id: 'comment-1',
    action_type: 'reply',
    status: 'running',
    idempotency_key: 'stale-running-key',
    metadata: {
      parent_external_comment_id: 'comment-1',
      provider_dispatch_started_at: dispatchStartedAt,
      reply_attempt_token: '33333333-3333-4333-8333-333333333333',
      reply_message_hash: createHash('sha256').update('Manual reply').digest('hex'),
    },
    created_at: dispatchStartedAt,
  })

  await service.reconcileUnknownTikTokReplies(
    admin,
    'user-1',
    'account-1',
    'item-1',
    'video-1',
    [reconciledProviderReply('stale-running-provider-reply', dispatchStartedAt)],
  )

  assert.equal(state.actionLogs[0].status, 'completed')
  assert.equal(state.savedReply.external_comment_id, 'stale-running-provider-reply')
})

test('stale-dispatch sync snapshot cannot overwrite a restarted same-key attempt', async () => {
  let serviceRef
  let restartedAttempt
  const args = [
    'user-1',
    'parent-row',
    'Manual reply',
    'stale-dispatch-aba-key',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  ]
  const harness = createReplyServiceHarness({
    holdProvider: true,
    async beforeStaleUnknownRpc(currentState) {
      currentState.actionLogs[0].status = 'failed'
      currentState.actionLogs[0].error_code = 'provider_rejected'
      restartedAttempt = serviceRef.replyToSocialComment(...args)
      while (currentState.providerCalls === 0) {
        await new Promise((resolve) => setImmediate(resolve))
      }
    },
  })
  serviceRef = harness.service
  const { service, state, admin } = harness
  const dispatchStartedAt = new Date(Date.now() - 90_000).toISOString()
  const oldToken = '44444444-4444-4444-8444-444444444444'
  state.actionLogs.push({
    id: 'stale-dispatch-aba-log',
    user_id: 'user-1',
    platform: 'tiktok',
    account_id: 'account-1',
    external_content_id: 'video-1',
    external_comment_id: 'comment-1',
    action_type: 'reply',
    status: 'running',
    idempotency_key: 'stale-dispatch-aba-key',
    metadata: {
      parent_external_comment_id: 'comment-1',
      provider_dispatch_started_at: dispatchStartedAt,
      reply_attempt_token: oldToken,
      reply_message_hash: createHash('sha256').update('Manual reply').digest('hex'),
    },
    created_at: dispatchStartedAt,
  })

  await service.reconcileUnknownTikTokReplies(
    admin,
    'user-1',
    'account-1',
    'item-1',
    'video-1',
    [],
  )

  const newToken = state.actionLogs[0].metadata.reply_attempt_token
  assert.notEqual(newToken, oldToken)
  assert.equal(state.actionLogs[0].status, 'running')
  assert.equal(state.actionLogs[0].metadata.provider_outcome_unknown, undefined)
  assert.equal(state.providerCalls, 1)

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Third attempt must stay fenced',
      'third-key-during-stale-sync-aba',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'duplicate_request_running',
  )
  assert.equal(state.providerCalls, 1)

  state.releaseProvider()
  const saved = await restartedAttempt
  assert.equal(saved.id, 'saved-reply')
  assert.equal(state.actionLogs[0].status, 'completed')
  assert.equal(state.providerCalls, 1)
})

test('stale running action that never began provider dispatch is released as a definite failure', async () => {
  const { service, state, admin } = createReplyServiceHarness()
  const createdAt = new Date(Date.now() - 3 * 60_000).toISOString()
  state.actionLogs.push({
    id: 'stale-predispatch-log',
    user_id: 'user-1',
    platform: 'tiktok',
    account_id: 'account-1',
    external_content_id: 'video-1',
    external_comment_id: 'comment-1',
    action_type: 'reply',
    status: 'running',
    idempotency_key: 'stale-predispatch-key',
    metadata: {
      parent_external_comment_id: 'comment-1',
      reply_attempt_token: '11111111-1111-4111-8111-111111111111',
      reply_message_hash: createHash('sha256').update('Manual reply').digest('hex'),
    },
    created_at: createdAt,
  })

  await service.reconcileUnknownTikTokReplies(
    admin,
    'user-1',
    'account-1',
    'item-1',
    'video-1',
    [],
  )

  assert.equal(state.actionLogs[0].status, 'failed')
  assert.equal(state.actionLogs[0].error_code, 'reply_dispatch_abandoned')
  const { data: lateMarker } = await admin.rpc('mark_tiktok_reply_dispatch_started', {
    p_user_id: 'user-1',
    p_action_log_id: 'stale-predispatch-log',
    p_reply_attempt_token: '11111111-1111-4111-8111-111111111111',
  })
  assert.equal(lateMarker, false)

  const saved = await service.replyToSocialComment(
    'user-1',
    'parent-row',
    'Manual reply',
    'fresh-after-abandoned-key',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  )
  assert.equal(saved.id, 'saved-reply')
  assert.equal(state.providerCalls, 1)
})

test('dispatch marker winning the database race prevents stale predispatch abandonment', async () => {
  const markerTime = new Date().toISOString()
  const { service, state, admin } = createReplyServiceHarness({
    beforeAbandonRpc(currentState) {
      currentState.actionLogs[0].metadata = {
        ...currentState.actionLogs[0].metadata,
        provider_dispatch_started_at: markerTime,
      }
    },
  })
  const createdAt = new Date(Date.now() - 3 * 60_000).toISOString()
  state.actionLogs.push({
    id: 'marker-winner-log',
    user_id: 'user-1',
    platform: 'tiktok',
    account_id: 'account-1',
    external_content_id: 'video-1',
    external_comment_id: 'comment-1',
    action_type: 'reply',
    status: 'running',
    idempotency_key: 'marker-winner-key',
    metadata: {
      parent_external_comment_id: 'comment-1',
      reply_attempt_token: '22222222-2222-4222-8222-222222222222',
      reply_message_hash: createHash('sha256').update('Manual reply').digest('hex'),
    },
    created_at: createdAt,
  })

  await service.reconcileUnknownTikTokReplies(
    admin,
    'user-1',
    'account-1',
    'item-1',
    'video-1',
    [],
  )

  assert.equal(state.actionLogs[0].status, 'running')
  assert.equal(state.actionLogs[0].metadata.provider_dispatch_started_at, markerTime)
  assert.equal(state.actionLogs[0].error_code, undefined)
})

test('same-key restart rotates the attempt fence so a delayed old worker cannot dispatch', async () => {
  const { service, state, admin } = createReplyServiceHarness({
    holdFirstMarker: true,
    holdProvider: true,
  })
  const args = [
    'user-1',
    'parent-row',
    'Manual reply',
    'stable-aba-key-123',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  ]
  const oldAttempt = service.replyToSocialComment(...args)
  while (state.markerCalls === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const oldToken = state.actionLogs[0].metadata.reply_attempt_token
  state.actionLogs[0].created_at = new Date(Date.now() - 3 * 60_000).toISOString()

  await service.reconcileUnknownTikTokReplies(
    admin,
    'user-1',
    'account-1',
    'item-1',
    'video-1',
    [],
  )
  assert.equal(state.actionLogs[0].status, 'failed')

  const newAttempt = service.replyToSocialComment(...args)
  while (state.providerCalls === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const newToken = state.actionLogs[0].metadata.reply_attempt_token
  assert.notEqual(newToken, oldToken)
  assert.equal(state.markerCalls, 2)
  assert.equal(state.providerCalls, 1)

  state.releaseFirstMarker()
  await assert.rejects(
    () => oldAttempt,
    (error) => error.code === 'duplicate_request_running',
  )
  assert.equal(state.actionLogs[0].status, 'running')
  assert.equal(state.actionLogs[0].metadata.reply_attempt_token, newToken)
  assert.equal(state.providerCalls, 1)
  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Third attempt must stay fenced',
      'third-key-during-aba',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'duplicate_request_running',
  )
  assert.equal(state.providerCalls, 1)

  state.releaseProvider()
  const saved = await newAttempt
  assert.equal(saved.id, 'saved-reply')
  assert.equal(state.providerCalls, 1)
})

test('a delayed pre-marker token failure cannot overwrite the restarted same-key attempt', async () => {
  const { service, state, admin } = createReplyServiceHarness({
    holdFirstTokenLookup: true,
    failFirstTokenLookup: true,
    holdProvider: true,
  })
  const args = [
    'user-1',
    'parent-row',
    'Manual reply',
    'stable-token-lookup-aba-key',
    { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
  ]
  const oldAttempt = service.replyToSocialComment(...args)
  while (state.tokenLookups === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const oldToken = state.actionLogs[0].metadata.reply_attempt_token
  state.actionLogs[0].created_at = new Date(Date.now() - 3 * 60_000).toISOString()

  await service.reconcileUnknownTikTokReplies(
    admin,
    'user-1',
    'account-1',
    'item-1',
    'video-1',
    [],
  )
  assert.equal(state.actionLogs[0].status, 'failed')

  const newAttempt = service.replyToSocialComment(...args)
  while (state.providerCalls === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  const newToken = state.actionLogs[0].metadata.reply_attempt_token
  assert.notEqual(newToken, oldToken)

  state.releaseFirstTokenLookup()
  await assert.rejects(
    () => oldAttempt,
    (error) => error.code === 'missing_comment_authorization',
  )
  assert.equal(state.actionLogs[0].status, 'running')
  assert.equal(state.actionLogs[0].metadata.reply_attempt_token, newToken)
  assert.equal(state.providerCalls, 1)

  await assert.rejects(
    () => service.replyToSocialComment(
      'user-1',
      'parent-row',
      'Third attempt must stay fenced',
      'third-key-during-token-aba',
      { enabledPlatforms: ['tiktok'], tiktokReplyEnabled: true },
    ),
    (error) => error.code === 'duplicate_request_running',
  )
  assert.equal(state.providerCalls, 1)

  state.releaseProvider()
  const saved = await newAttempt
  assert.equal(saved.id, 'saved-reply')
  assert.equal(state.actionLogs[0].status, 'completed')
  assert.equal(state.providerCalls, 1)
})

test('reconciliation keeps the fence when the only same-text reply is outside the dispatch window', async () => {
  const { service, state, admin } = createReplyServiceHarness()
  const dispatchStartedAt = new Date(Date.now() - 10 * 60_000).toISOString()
  state.actionLogs.push({
    id: 'late-candidate-log',
    user_id: 'user-1',
    platform: 'tiktok',
    account_id: 'account-1',
    external_content_id: 'video-1',
    external_comment_id: 'comment-1',
    action_type: 'reply',
    status: 'unknown',
    idempotency_key: 'late-candidate-key',
    metadata: {
      parent_external_comment_id: 'comment-1',
      provider_dispatch_started_at: dispatchStartedAt,
      reply_message_hash: createHash('sha256').update('Manual reply').digest('hex'),
    },
    created_at: dispatchStartedAt,
  })

  await service.reconcileUnknownTikTokReplies(
    admin,
    'user-1',
    'account-1',
    'item-1',
    'video-1',
    [reconciledProviderReply('late-unrelated-reply', new Date().toISOString())],
  )

  assert.equal(state.actionLogs[0].status, 'unknown')
  assert.equal(state.savedReply, null)
})

test('reconciliation keeps the fence when multiple provider replies match the dispatch', async () => {
  const { service, state, admin } = createReplyServiceHarness()
  const dispatchStartedAt = new Date().toISOString()
  state.actionLogs.push({
    id: 'ambiguous-candidates-log',
    user_id: 'user-1',
    platform: 'tiktok',
    account_id: 'account-1',
    external_content_id: 'video-1',
    external_comment_id: 'comment-1',
    action_type: 'reply',
    status: 'unknown',
    idempotency_key: 'ambiguous-candidates-key',
    metadata: {
      parent_external_comment_id: 'comment-1',
      provider_dispatch_started_at: dispatchStartedAt,
      reply_message_hash: createHash('sha256').update('Manual reply').digest('hex'),
    },
    created_at: dispatchStartedAt,
  })

  await service.reconcileUnknownTikTokReplies(
    admin,
    'user-1',
    'account-1',
    'item-1',
    'video-1',
    [
      reconciledProviderReply('ambiguous-provider-reply-1', dispatchStartedAt),
      reconciledProviderReply('ambiguous-provider-reply-2', dispatchStartedAt),
    ],
  )

  assert.equal(state.actionLogs[0].status, 'unknown')
  assert.equal(state.savedReply, null)
})
