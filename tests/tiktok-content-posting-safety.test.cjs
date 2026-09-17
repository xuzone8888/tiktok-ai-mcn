/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ts = require('typescript')

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function loadTsModule(relativePath, stubs = {}, globals = {}) {
  const filename = path.join(process.cwd(), relativePath)
  const output = ts.transpileModule(read(relativePath), {
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
      if (Object.hasOwn(stubs, request)) return stubs[request]
      if (request === '@/lib/publish/task-presentation') return loadTsModule('src/lib/publish/task-presentation.ts')
      return require(request)
    },
    AbortSignal,
    Date,
    Error,
    JSON,
    Promise,
    Response,
    setTimeout,
    URL,
    console,
    process,
    ...globals,
  }, { filename })
  return loadedModule.exports
}

function providerResponse(status, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload
    },
  }
}

const fileUploadContract = loadTsModule('src/lib/tiktok/file-upload-contract.ts')

function loadContentPosting(fetchImpl, capturedLogs = []) {
  const safeConsole = {
    log(...args) {
      capturedLogs.push(['log', ...args])
    },
    warn(...args) {
      capturedLogs.push(['warn', ...args])
    },
    error(...args) {
      capturedLogs.push(['error', ...args])
    },
  }
  return loadTsModule('src/lib/tiktok/content-posting.ts', {
    './test-mock': {
      isTikTokMockCredential: () => false,
      isTikTokTestMockEnabled: () => false,
    },
    './file-upload-contract': fileUploadContract,
  }, { fetch: fetchImpl, console: safeConsole })
}

function loadFileUploadClient() {
  return loadTsModule('src/lib/tiktok/file-upload-client.ts', {
    './file-upload-contract': fileUploadContract,
  })
}

const postInfo = {
  title: 'Sandbox test',
  privacyLevel: 'SELF_ONLY',
  disableDuet: true,
  disableComment: false,
  disableStitch: true,
  brandContentToggle: true,
  brandOrganicToggle: true,
  isAigc: true,
}

test('policy rejection keeps the stable provider code without logging raw body or media URL', async () => {
  const mediaUrl = 'https://media.example.test/videos/private-object.mp4?signature=secret'
  const rawMessage = 'Review https://developers.example.test/private-policy?debug=secret'
  const logs = []
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    return providerResponse(403, {
      error: {
        code: 'unaudited_client_can_only_post_to_private_accounts',
        message: rawMessage,
      },
    })
  }, logs)

  let caught
  try {
    await contentPosting.initVideoPublishFromUrl('access-token', mediaUrl, postInfo)
  } catch (error) {
    caught = error
  }

  assert.equal(providerCalls, 1)
  assert.equal(contentPosting.isTikTokPublishingError(caught), true)
  assert.equal(caught.providerCode, 'unaudited_client_can_only_post_to_private_accounts')
  assert.equal(caught.httpStatus, 403)
  assert.equal(caught.operation, 'video_init')
  assert.equal(caught.outcome, 'rejected')
  assert.equal(caught.message, 'TikTok 未审核应用只能向私密账号发布仅自己可见的内容')

  const serializedLogs = JSON.stringify(logs)
  assert.equal(serializedLogs.includes(mediaUrl), false)
  assert.equal(serializedLogs.includes('private-object.mp4'), false)
  assert.equal(serializedLogs.includes(rawMessage), false)
  assert.equal(serializedLogs.includes('debug=secret'), false)
})

test('ambiguous init response is never retried and is classified as unknown', async () => {
  const logs = []
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    return providerResponse(503, {
      error: {
        code: 'server_error',
        message: 'temporary failure with https://internal.example.test/secret',
      },
    })
  }, logs)

  await assert.rejects(
    contentPosting.initVideoPublishFromUrl('access-token', 'https://media.example.test/videos/test.mp4', postInfo),
    (error) => {
      assert.equal(error.outcome, 'unknown')
      assert.equal(error.httpStatus, 503)
      assert.equal(error.providerCode, 'server_error')
      return true
    },
  )
  assert.equal(providerCalls, 1)
  assert.equal(JSON.stringify(logs).includes('internal.example.test'), false)
})

test('malformed successful init response fails closed as an unknown outcome', async () => {
  for (const payload of [
    { data: { publish_id: 'id-without-success-envelope' } },
    { data: { publish_id: '   ' }, error: { code: 'ok', message: '' } },
    { data: { publish_id: 'x'.repeat(65) }, error: { code: 'ok', message: '' } },
    { data: {}, error: { code: 'ok', message: '' } },
  ]) {
    const contentPosting = loadContentPosting(async () => providerResponse(200, payload))
    await assert.rejects(
      contentPosting.initVideoPublishFromUrl(
        'access-token',
        'https://media.example.test/videos/test.mp4',
        postInfo,
      ),
      (error) => {
        assert.equal(error.providerCode, 'invalid_response')
        assert.equal(error.outcome, 'unknown')
        return true
      },
    )
  }
})

test('FILE_UPLOAD init uses the official chunk plan and validates the returned upload URL', async () => {
  const requests = []
  const contentPosting = loadContentPosting(async (url, options) => {
    requests.push({ url, options })
    return providerResponse(200, {
      data: {
        publish_id: 'publish-file-1',
        upload_url: 'https://upload.us.tiktokapis.com/video/?upload_id=one&upload_token=two',
      },
      error: { code: 'ok', message: '' },
    })
  })
  const size = (70 * 1024 * 1024) + 123
  const initialized = await contentPosting.initVideoPublishFromFile('access-token', size, postInfo)

  assert.equal(requests.length, 1)
  const body = JSON.parse(requests[0].options.body)
  assert.equal(body.source_info.source, 'FILE_UPLOAD')
  assert.equal(body.source_info.video_size, size)
  assert.equal(body.source_info.chunk_size, 10 * 1024 * 1024)
  assert.equal(body.source_info.total_chunk_count, 7)
  assert.equal(body.source_info.video_url, undefined)
  assert.equal(initialized.publishId, 'publish-file-1')
  assert.equal(initialized.chunkSize, 10 * 1024 * 1024)
  assert.equal(initialized.totalChunkCount, 7)
})

test('upload URL trust boundary accepts only exact observed or documented TikTok hosts', () => {
  for (const hostname of [
    'open-upload.tiktokapis.com',
    'open-upload.tiktokapis.us',
    'upload.us.tiktokapis.com',
  ]) {
    assert.equal(
      fileUploadContract.isTrustedTikTokUploadUrl(`https://${hostname}/video/?upload_token=secret`),
      true,
    )
  }
  for (const url of [
    'https://open-upload.tiktokapis.com.evil.test/video/?upload_token=secret',
    'https://open-upload.tiktokapis.us.evil.test/video/?upload_token=secret',
    'https://upload.us.tiktokapis.com.evil.test/video/?upload_token=secret',
    'https://user@open-upload.tiktokapis.com/video/?upload_token=secret',
    'https://open-upload.tiktokapis.com/video/?upload_token=secret#fragment',
  ]) {
    assert.equal(fileUploadContract.isTrustedTikTokUploadUrl(url), false)
  }

  const longSignedUrl = `https://open-upload.tiktokapis.com/video/?upload_token=${'a'.repeat(512)}`
  assert.equal(longSignedUrl.length > 256, true)
  assert.equal(fileUploadContract.isTrustedTikTokUploadUrl(longSignedUrl), true)
  assert.equal(
    fileUploadContract.isTrustedTikTokUploadUrl(
      `https://open-upload.tiktokapis.com/video/?upload_token=${'a'.repeat(8192)}`,
    ),
    false,
  )
})

test('local FILE_UPLOAD derives blank MIME types from extension and rejects empty or mismatched files', () => {
  const localFile = loadTsModule('src/lib/tiktok/local-file.ts')
  assert.equal(localFile.resolveTikTokLocalVideoMimeType({
    filename: 'clip.mov', reportedMimeType: '', sizeBytes: 1024,
  }), 'video/quicktime')
  assert.equal(localFile.resolveTikTokLocalVideoMimeType({
    filename: 'clip.webm', reportedMimeType: '', sizeBytes: 1024,
  }), 'video/webm')
  assert.equal(localFile.resolveTikTokLocalVideoMimeType({
    filename: 'clip.mov', reportedMimeType: 'video/mp4', sizeBytes: 1024,
  }), null)
  assert.equal(localFile.resolveTikTokLocalVideoMimeType({
    filename: 'clip.mp4', reportedMimeType: 'video/mp4', sizeBytes: 0,
  }), null)
})

test('FILE_UPLOAD init rejects malformed success envelopes and untrusted upload URLs', async () => {
  for (const [payload, expectedReason] of [
    [{
      error: { code: 'ok', message: '' },
    }, 'missing_success_data'],
    [{
      data: {},
      error: { code: 'ok', message: '' },
    }, 'invalid_publish_id'],
    [{
      data: { publish_id: 'publish-file-1' },
      error: { code: 'ok', message: '' },
    }, 'invalid_upload_url'],
    [{
      data: {
        publish_id: 'publish-file-1',
        upload_url: 'https://evil.example.test/video/?upload_token=secret',
      },
      error: { code: 'ok', message: '' },
    }, 'invalid_upload_url'],
    [{
      data: {
        publish_id: 'publish-file-1',
        upload_url: 'http://open-upload.tiktokapis.com/video/?upload_token=secret',
      },
      error: { code: 'ok', message: '' },
    }, 'invalid_upload_url'],
    [{
      data: {
        publish_id: 'publish-file-1',
        upload_url: 'https://other.tiktokapis.com/video/?upload_token=secret',
      },
      error: { code: 'ok', message: '' },
    }, 'invalid_upload_url'],
  ]) {
    const logs = []
    const contentPosting = loadContentPosting(async () => providerResponse(200, payload), logs)
    await assert.rejects(
      contentPosting.initVideoPublishFromFile('access-token', 4 * 1024 * 1024, postInfo),
      (error) => {
        assert.equal(error.providerCode, 'invalid_response')
        assert.equal(error.outcome, 'unknown')
        assert.equal(JSON.stringify(error).includes('upload_token'), false)
        return true
      },
    )
    const serializedLogs = JSON.stringify(logs)
    assert.equal(serializedLogs.includes(`\"reason\":\"${expectedReason}\"`), true)
    if (expectedReason === 'invalid_upload_url') {
      assert.equal(serializedLogs.includes('uploadUrlPresent'), true)
      assert.equal(serializedLogs.includes('uploadUrlLength'), true)
    }
    assert.equal(serializedLogs.includes('upload_token'), false)
    assert.equal(serializedLogs.includes('secret'), false)
  }
})

test('invalid upload URL diagnostics expose only the hostname and structural flags', async () => {
  const logs = []
  const sensitiveUrl = 'https://regional-upload.external.example/video/private-path?upload_token=do-not-log'
  const contentPosting = loadContentPosting(async () => providerResponse(200, {
    data: {
      publish_id: 'publish-file-1',
      upload_url: sensitiveUrl,
    },
    error: { code: 'ok', message: '' },
  }), logs)

  await assert.rejects(
    contentPosting.initVideoPublishFromFile('access-token', 4 * 1024 * 1024, postInfo),
    (error) => error.providerCode === 'invalid_response' && error.outcome === 'unknown',
  )

  const serializedLogs = JSON.stringify(logs)
  assert.equal(serializedLogs.includes('regional-upload.external.example'), true)
  assert.equal(serializedLogs.includes('private-path'), false)
  assert.equal(serializedLogs.includes('upload_token'), false)
  assert.equal(serializedLogs.includes('do-not-log'), false)
})

test('browser FILE_UPLOAD sends sequential ranges and requires 206 then 201', async () => {
  const transfer = loadFileUploadClient()
  const size = (70 * 1024 * 1024) + 123
  const calls = []
  const file = {
    size,
    slice(start, end, mimeType) {
      return { start, end, mimeType, size: end - start }
    },
  }
  const progress = []

  await transfer.uploadFileDirectlyToTikTok({
    uploadUrl: 'https://open-upload.tiktokapis.com/video/?upload_id=one&upload_token=two',
    file,
    mimeType: 'video/mp4',
    chunkSize: 10 * 1024 * 1024,
    totalChunkCount: 7,
    onProgress(value) { progress.push(value) },
    async fetchImpl(_url, options) {
      calls.push(options)
      return { status: calls.length === 7 ? 201 : 206 }
    },
  })

  assert.equal(calls.length, 7)
  assert.equal(calls[0].headers['Content-Range'], `bytes 0-${(10 * 1024 * 1024) - 1}/${size}`)
  assert.equal(calls[6].headers['Content-Range'], `bytes ${60 * 1024 * 1024}-${size - 1}/${size}`)
  assert.equal(Object.hasOwn(calls[0].headers, 'Content-Length'), false)
  assert.equal(calls[0].credentials, 'omit')
  assert.equal(calls[0].redirect, 'error')
  assert.equal(calls[0].referrerPolicy, 'no-referrer')
  assert.deepEqual(progress.at(-1), 100)
})

test('browser FILE_UPLOAD rejects an oversized one-part plan before network access', async () => {
  const transfer = loadFileUploadClient()
  const size = 65 * 1024 * 1024
  let providerCalls = 0

  await assert.rejects(
    transfer.uploadFileDirectlyToTikTok({
      uploadUrl: 'https://open-upload.tiktokapis.com/video/?upload_id=one&upload_token=two',
      file: {
        size,
        slice() { throw new Error('slice must not run') },
      },
      mimeType: 'video/mp4',
      chunkSize: size,
      totalChunkCount: 1,
      async fetchImpl() {
        providerCalls += 1
        return { status: 201 }
      },
    }),
    (error) => {
      assert.equal(error.code, 'invalid_upload_plan')
      return true
    },
  )
  assert.equal(providerCalls, 0)
})

test('browser FILE_UPLOAD retries only an ambiguous chunk and preserves the final outcome class', async () => {
  const transfer = loadFileUploadClient()
  const file = {
    size: 4 * 1024 * 1024,
    slice(start, end, mimeType) { return { start, end, mimeType } },
  }
  let retryCalls = 0
  await transfer.uploadFileDirectlyToTikTok({
    uploadUrl: 'https://open-upload.tiktokapis.com/video/?upload_id=one&upload_token=two',
    file,
    mimeType: 'video/mp4',
    chunkSize: file.size,
    totalChunkCount: 1,
    async fetchImpl() {
      retryCalls += 1
      return { status: retryCalls === 1 ? 503 : 201 }
    },
  })
  assert.equal(retryCalls, 2)

  let rejectedCalls = 0
  await assert.rejects(
    transfer.uploadFileDirectlyToTikTok({
      uploadUrl: 'https://open-upload.tiktokapis.com/video/?upload_id=one&upload_token=two',
      file,
      mimeType: 'video/mp4',
      chunkSize: file.size,
      totalChunkCount: 1,
      async fetchImpl() {
        rejectedCalls += 1
        return { status: 400 }
      },
    }),
    (error) => error.code === 'upload_rejected' && error.httpStatus === 400,
  )
  assert.equal(rejectedCalls, 1)

  let unknownCalls = 0
  await assert.rejects(
    transfer.uploadFileDirectlyToTikTok({
      uploadUrl: 'https://open-upload.tiktokapis.com/video/?upload_id=one&upload_token=two',
      file,
      mimeType: 'video/mp4',
      chunkSize: file.size,
      totalChunkCount: 1,
      async fetchImpl() {
        unknownCalls += 1
        throw new Error('response lost')
      },
    }),
    (error) => error.code === 'upload_outcome_unknown' && error.httpStatus === null,
  )
  assert.equal(unknownCalls, 3)
})

test('an ambiguous PUT attempt cannot be downgraded by a later rejection or unexpected 2xx', async () => {
  const transfer = loadFileUploadClient()
  const file = {
    size: 4 * 1024 * 1024,
    slice(start, end, mimeType) { return { start, end, mimeType } },
  }

  let calls = 0
  await assert.rejects(
    transfer.uploadFileDirectlyToTikTok({
      uploadUrl: 'https://open-upload.tiktokapis.com/video/?upload_id=one&upload_token=two',
      file,
      mimeType: 'video/mp4',
      chunkSize: file.size,
      totalChunkCount: 1,
      async fetchImpl() {
        calls += 1
        if (calls === 1) throw new Error('final response lost')
        return { status: 400 }
      },
    }),
    (error) => error.code === 'upload_outcome_unknown' && error.httpStatus === 400,
  )
  assert.equal(calls, 2)

  await assert.rejects(
    transfer.uploadFileDirectlyToTikTok({
      uploadUrl: 'https://open-upload.tiktokapis.com/video/?upload_id=one&upload_token=two',
      file,
      mimeType: 'video/mp4',
      chunkSize: file.size,
      totalChunkCount: 1,
      async fetchImpl() { return { status: 200 } },
    }),
    (error) => error.code === 'upload_outcome_unknown' && error.httpStatus === 200,
  )
})

test('status responses require an ok envelope and a known status', async () => {
  for (const payload of [
    { data: { status: 'PUBLISH_COMPLETE' } },
    { data: { status: 'SOMETHING_NEW' }, error: { code: 'ok', message: '' } },
    { data: {}, error: { code: 'ok', message: '' } },
  ]) {
    let providerCalls = 0
    const contentPosting = loadContentPosting(async () => {
      providerCalls += 1
      return providerResponse(200, payload)
    })
    await assert.rejects(
      contentPosting.waitForPublishComplete('access-token', 'publish-id', 100, 1),
      (error) => {
        assert.equal(error.operation, 'status_fetch')
        assert.equal(error.providerCode, 'invalid_response')
        assert.equal(error.outcome, 'unknown')
        return true
      },
    )
    assert.equal(providerCalls, 1)
  }
})

test('numeric TikTok post ids never downgrade a known terminal publish status', async () => {
  for (const [postIds, expectedPostId] of [
    [[123456789], '123456789'],
    [[Number.MAX_SAFE_INTEGER + 1], undefined],
    [[{ unexpected: true }], undefined],
  ]) {
    const contentPosting = loadContentPosting(async () => providerResponse(200, {
      data: {
        status: 'PUBLISH_COMPLETE',
        publicaly_available_post_id: postIds,
      },
      error: { code: 'ok', message: '' },
    }))
    const status = await contentPosting.checkPublishStatus('access-token', 'publish-id')
    assert.equal(status.status, 'PUBLISH_COMPLETE')
    assert.equal(status.postId, expectedPostId)
  }
})

test('provider FAILED text cannot be mistaken for a local polling timeout', async () => {
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    return providerResponse(200, {
      data: {
        status: 'FAILED',
        fail_reason: 'timeout https://provider.example.test/private-detail',
      },
      error: { code: 'ok', message: '' },
    })
  })

  const result = await contentPosting.waitForPublishComplete('access-token', 'publish-id', 100, 1)
  assert.equal(providerCalls, 1)
  assert.equal(result.success, false)
  assert.equal(result.timedOut, false)
  assert.equal(result.error, 'TikTok reported that publishing failed')
  assert.equal(JSON.stringify(result).includes('provider.example.test'), false)
})

test('publish processor prioritizes typed provider metadata over message contents', async () => {
  const contentPosting = loadContentPosting(async () => providerResponse(403, {
    error: {
      code: 'unaudited_client_can_only_post_to_private_accounts',
      message: 'See https://developers.example.test/guidelines',
    },
  }))
  let providerError
  try {
    await contentPosting.initVideoPublishFromUrl(
      'access-token',
      'https://media.example.test/videos/test.mp4',
      postInfo,
    )
  } catch (error) {
    providerError = error
  }

  const processor = loadTsModule('src/lib/publish-processor.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => ({}) },
    '@/lib/tiktok/account-authorization': { isNormalTikTokAccountOwnedBy: () => true },
    '@/lib/tiktok/content-posting': contentPosting,
    '@/lib/tiktok/token-manager': {
      getTikTokAccountTokens: async () => new Map(),
      getValidTikTokAccessToken: async () => '',
    },
  })
  const failure = processor.getPublishFailureDetails(providerError)

  assert.equal(failure.errorCode, 'TIKTOK_UNAUDITED_PRIVATE_ONLY')
  assert.equal(failure.message, 'TikTok 未审核应用只能向私密账号发布仅自己可见的内容')
  assert.notEqual(failure.errorCode, 'VIDEO_URL_UNAVAILABLE')
  assert.equal(JSON.stringify(failure).includes('developers.example.test'), false)
})

function createPublishStateSupabase(row, hooks = {}) {
  const task = { id: row.task_id, user_id: 'user-1', workflow: 'single', status: 'running' }
  const account = {
    id: row.account_id,
    user_id: 'user-1',
    account_type: 'normal',
    status: 'active',
    ...(hooks.account || {}),
  }
  const writes = []

  function makeQuery(table) {
    let operation = 'select'
    let selectColumns = ''
    let updatePayload = null
    const equals = new Map()

    const query = {
      select(columns = '') {
        selectColumns = columns
        return query
      },
      update(payload) {
        operation = 'update'
        updatePayload = payload
        return query
      },
      eq(column, value) {
        equals.set(column, value)
        return query
      },
      is(column, value) {
        equals.set(column, value)
        return query
      },
      in() { return query },
      lte() { return query },
      order() { return query },
      limit() { return query },
      maybeSingle() {
        return execute().then((result) => ({ ...result, data: result.data?.[0] ?? result.data ?? null }))
      },
      single() {
        return execute().then((result) => ({ ...result, data: result.data?.[0] ?? result.data ?? null }))
      },
      then(resolve, reject) {
        return execute().then(resolve, reject)
      },
    }

    async function execute() {
      if (operation === 'update') {
        const target = table === 'publish_task_items' ? row : task
        const matches = [...equals].every(([column, value]) => target[column] === value)
        const injected = hooks.beforeUpdate?.({ table, payload: updatePayload, equals, target, matches })
        if (injected) return injected
        if (matches) {
          Object.assign(target, updatePayload)
          writes.push({ table, payload: { ...updatePayload } })
        }
        return { data: matches ? [{ ...target }] : [], error: null }
      }

      if (table === 'publish_task_items') {
        return { data: [row], error: null }
      }
      if (table === 'publish_tasks') {
        if (selectColumns.trim() === 'status') return { data: [{ status: task.status }], error: null }
        return {
          data: [{ id: task.id, user_id: task.user_id, workflow: task.workflow }],
          error: null,
        }
      }
      if (table === 'tiktok_accounts') {
        const matches = [...equals].every(([column, value]) => account[column] === value)
        return { data: matches ? [account] : [], error: null }
      }
      throw new Error(`Unexpected table: ${table}`)
    }

    return query
  }

  return {
    client: { from: makeQuery },
    row,
    task,
    writes,
  }
}

test('a transient status failure preserves uploading and later recovery completes the same publish id', async () => {
  const transientFailures = [
    providerResponse(503, {
      error: { code: 'server_error', message: 'temporary' },
    }),
    new Error('network failure with https://internal.example.test/secret'),
    providerResponse(200, {
      data: { status: 'UNKNOWN_PROVIDER_STATUS' },
      error: { code: 'ok', message: '' },
    }),
  ]

  for (const transientFailure of transientFailures) {
    const responses = [
      providerResponse(200, {
        data: { publish_id: 'publish-1' },
        error: { code: 'ok', message: '', log_id: 'log-1' },
      }),
      transientFailure,
      providerResponse(200, {
        data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['video-1'] },
        error: { code: 'ok', message: '', log_id: 'log-2' },
      }),
    ]
    let providerCalls = 0
    const contentPosting = loadContentPosting(async () => {
      providerCalls += 1
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response
    })
    const token = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      access_token_expires_at: '2099-01-01T00:00:00.000Z',
      refresh_token_expires_at: '2099-01-01T00:00:00.000Z',
    }
    const processor = loadTsModule('src/lib/publish-processor.ts', {
      '@/lib/supabase/admin': { createAdminClient: () => ({}) },
      '@/lib/tiktok/account-authorization': { isNormalTikTokAccountOwnedBy: () => true },
      '@/lib/tiktok/content-posting': contentPosting,
      '@/lib/tiktok/token-manager': {
        getTikTokAccountTokens: async () => new Map([['account-1', token]]),
        getValidTikTokAccessToken: async () => 'access-token',
      },
    })
    const state = createPublishStateSupabase({
      id: 'item-1',
      task_id: 'task-1',
      account_id: 'account-1',
      video_url: 'https://media.example.test/videos/test.mp4',
      title: 'test',
      scheduled_at: '2020-01-01T00:00:00.000Z',
      status: 'processing',
      tiktok_publish_id: null,
      processing_started_at: '2020-01-01T00:00:00.000Z',
      publish_init_started_at: null,
      last_status_check_at: null,
      publish_attempt_count: 1,
      publish_tasks: {
        user_id: 'user-1',
        privacy_level: 'SELF_ONLY',
        allow_comment: false,
        allow_duet: false,
        allow_stitch: false,
        brand_content_toggle: true,
        brand_organic_toggle: true,
        is_aigc: true,
      },
    })
    const accounts = new Map([['account-1', {
      id: 'account-1',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token,
    }]])

    const firstOutcome = await processor.publishItem(state.client, state.row, accounts)
    assert.equal(firstOutcome, 'confirming')
    assert.equal(state.row.status, 'uploading')
    assert.equal(state.row.tiktok_publish_id, 'publish-1')
    assert.equal(state.row.error_code, 'TIKTOK_STATUS_CHECK_PENDING')
    assert.equal(state.writes.some((write) => write.payload.status === 'failed'), false)

    state.row.last_status_check_at = '2020-01-01T00:00:00.000Z'
    const recovery = await processor.recoverInterruptedTikTokItems(state.client, false)
    assert.equal(recovery.success, 1)
    assert.equal(state.row.status, 'published')
    assert.equal(state.row.tiktok_publish_id, 'publish-1')
    assert.equal(state.row.tiktok_video_id, 'video-1')
    assert.equal(providerCalls, 3)
  }
})

function makePublishItem(overrides = {}) {
  return {
    id: 'item-1',
    task_id: 'task-1',
    account_id: 'account-1',
    video_url: 'https://media.example.test/videos/test.mp4',
    title: 'test',
    scheduled_at: '2020-01-01T00:00:00.000Z',
    status: 'processing',
    tiktok_publish_id: null,
    processing_started_at: '2020-01-01T00:00:00.000Z',
    publish_init_started_at: null,
    last_status_check_at: null,
    publish_attempt_count: 1,
    publish_tasks: {
      user_id: 'user-1',
      privacy_level: 'SELF_ONLY',
      allow_comment: false,
      allow_duet: false,
      allow_stitch: false,
      brand_content_toggle: true,
      brand_organic_toggle: true,
      is_aigc: true,
    },
    ...overrides,
  }
}

function makePublishAccounts() {
  const token = {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    access_token_expires_at: '2099-01-01T00:00:00.000Z',
    refresh_token_expires_at: '2099-01-01T00:00:00.000Z',
  }
  return new Map([['account-1', {
    id: 'account-1',
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token,
  }]])
}

function loadPublishProcessor(contentPosting, tokenMap = new Map()) {
  return loadTsModule('src/lib/publish-processor.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => ({}) },
    '@/lib/tiktok/account-authorization': { isNormalTikTokAccountOwnedBy: () => true },
    '@/lib/tiktok/content-posting': contentPosting,
    '@/lib/tiktok/token-manager': {
      getTikTokAccountTokens: async () => tokenMap,
      getValidTikTokAccessToken: async () => 'access-token',
    },
  })
}

test('FILE_UPLOAD provider init is fenced and publish id is durable before upload URL is returned', async () => {
  const token = makePublishAccounts().get('account-1').token
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    return providerResponse(200, {
      data: {
        publish_id: 'publish-file-1',
        upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=one&upload_token=two',
      },
      error: { code: 'ok', message: '' },
    })
  })
  const processor = loadPublishProcessor(contentPosting, new Map([['account-1', token]]))
  const row = makePublishItem({
    status: 'pending',
    publish_attempt_count: 0,
    video_url: 'file-upload://upload-one',
    tiktok_transfer_method: 'FILE_UPLOAD',
    source_video_size_bytes: 4 * 1024 * 1024,
    source_video_mime_type: 'video/mp4',
    tiktok_upload_outcome: null,
    tiktok_upload_reported_at: null,
  })
  const state = createPublishStateSupabase(row)

  const prepared = await processor.prepareTikTokFileUpload(
    state.client,
    'user-1',
    'task-1',
    'item-1',
  )

  assert.equal(providerCalls, 1)
  assert.equal(prepared.attempt, 1)
  assert.equal(prepared.chunkSize, 4 * 1024 * 1024)
  assert.equal(row.status, 'uploading')
  assert.equal(row.publish_attempt_count, 1)
  assert.equal(row.tiktok_publish_id, 'publish-file-1')
  assert.ok(row.publish_init_started_at)
  assert.equal(JSON.stringify(state.writes).includes('upload_token'), false)
  assert.equal(JSON.stringify(state.writes).includes('uploadUrl'), false)
})

test('FILE_UPLOAD marker failure never returns an upload URL or calls provider init', async () => {
  const token = makePublishAccounts().get('account-1').token
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    throw new Error('provider should not be called')
  })
  const processor = loadPublishProcessor(contentPosting, new Map([['account-1', token]]))
  const row = makePublishItem({
    status: 'pending',
    publish_attempt_count: 0,
    video_url: 'file-upload://upload-one',
    tiktok_transfer_method: 'FILE_UPLOAD',
    source_video_size_bytes: 4 * 1024 * 1024,
    source_video_mime_type: 'video/mp4',
    tiktok_upload_outcome: null,
    tiktok_upload_reported_at: null,
  })
  const state = createPublishStateSupabase(row, {
    beforeUpdate({ table, payload }) {
      if (table === 'publish_task_items' && payload.publish_init_started_at) {
        return { data: [], error: null }
      }
      return null
    },
  })

  await assert.rejects(
    processor.prepareTikTokFileUpload(state.client, 'user-1', 'task-1', 'item-1'),
  )
  assert.equal(providerCalls, 0)
  assert.equal(row.tiktok_publish_id, null)
})

test('inactive normal accounts stop FILE_UPLOAD before token or provider access', async () => {
  let tokenCalls = 0
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    throw new Error('provider must not be called')
  })
  const processor = loadTsModule('src/lib/publish-processor.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => ({}) },
    '@/lib/tiktok/account-authorization': { isNormalTikTokAccountOwnedBy: () => true },
    '@/lib/tiktok/content-posting': contentPosting,
    '@/lib/tiktok/token-manager': {
      getTikTokAccountTokens: async () => {
        tokenCalls += 1
        return new Map()
      },
      getValidTikTokAccessToken: async () => {
        tokenCalls += 1
        return 'access-token'
      },
    },
  })
  const row = makePublishItem({
    status: 'pending',
    publish_attempt_count: 0,
    video_url: 'file-upload://upload-one',
    tiktok_transfer_method: 'FILE_UPLOAD',
    source_video_size_bytes: 4 * 1024 * 1024,
    source_video_mime_type: 'video/mp4',
  })
  const state = createPublishStateSupabase(row, {
    account: { status: 'revoked' },
  })

  await assert.rejects(
    processor.prepareTikTokFileUpload(state.client, 'user-1', 'task-1', 'item-1'),
  )
  assert.equal(tokenCalls, 0)
  assert.equal(providerCalls, 0)
  assert.equal(row.status, 'pending')
})

test('ambiguous FILE_UPLOAD completion reconciles the same publish id without a new init', async () => {
  const token = makePublishAccounts().get('account-1').token
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    return providerResponse(200, {
      data: {
        status: 'PUBLISH_COMPLETE',
        publicaly_available_post_id: ['video-file-1'],
      },
      error: { code: 'ok', message: '' },
    })
  })
  const processor = loadPublishProcessor(contentPosting, new Map([['account-1', token]]))
  const row = makePublishItem({
    status: 'uploading',
    tiktok_publish_id: 'publish-file-1',
    publish_init_started_at: '2026-09-08T00:00:00.000Z',
    tiktok_transfer_method: 'FILE_UPLOAD',
    source_video_size_bytes: 4 * 1024 * 1024,
    source_video_mime_type: 'video/mp4',
    tiktok_upload_outcome: null,
    tiktok_upload_reported_at: null,
  })
  const state = createPublishStateSupabase(row)

  const outcome = await processor.confirmTikTokFileUpload(
    state.client,
    'user-1',
    'task-1',
    'item-1',
    1,
    'unknown',
  )

  assert.equal(outcome, 'success')
  assert.equal(providerCalls, 1)
  assert.equal(row.tiktok_upload_outcome, 'unknown')
  assert.ok(row.tiktok_upload_reported_at)
  assert.equal(row.status, 'published')
  assert.equal(row.tiktok_publish_id, 'publish-file-1')
  assert.equal(row.tiktok_video_id, 'video-file-1')
})

test('rejected FILE_UPLOAD completion fails the fenced item without a status call', async () => {
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    throw new Error('status must not be queried')
  })
  const processor = loadPublishProcessor(contentPosting)
  const row = makePublishItem({
    status: 'uploading',
    tiktok_publish_id: 'publish-file-1',
    publish_init_started_at: '2026-09-08T00:00:00.000Z',
    tiktok_transfer_method: 'FILE_UPLOAD',
    source_video_size_bytes: 4 * 1024 * 1024,
    source_video_mime_type: 'video/mp4',
    tiktok_upload_outcome: null,
    tiktok_upload_reported_at: null,
  })
  const state = createPublishStateSupabase(row)

  const outcome = await processor.confirmTikTokFileUpload(
    state.client,
    'user-1',
    'task-1',
    'item-1',
    1,
    'rejected',
  )

  assert.equal(outcome, 'failed')
  assert.equal(providerCalls, 0)
  assert.equal(row.tiktok_upload_outcome, 'rejected')
  assert.equal(row.status, 'failed')
})

test('FILE_UPLOAD recovery can confirm a remote post after the browser closes before reporting', async () => {
  const token = makePublishAccounts().get('account-1').token
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    return providerResponse(200, {
      data: {
        status: 'PUBLISH_COMPLETE',
        publicaly_available_post_id: ['video-file-1'],
      },
      error: { code: 'ok', message: '' },
    })
  })
  const processor = loadPublishProcessor(contentPosting, new Map([['account-1', token]]))
  const row = makePublishItem({
    status: 'uploading',
    tiktok_publish_id: 'publish-file-1',
    processing_started_at: '2026-09-08T00:00:00.000Z',
    publish_init_started_at: '2026-09-08T00:00:00.000Z',
    last_status_check_at: '2026-09-08T00:00:00.000Z',
    tiktok_transfer_method: 'FILE_UPLOAD',
    source_video_size_bytes: 4 * 1024 * 1024,
    source_video_mime_type: 'video/mp4',
    tiktok_upload_outcome: null,
    tiktok_upload_reported_at: null,
  })
  const state = createPublishStateSupabase(row)

  const recovery = await processor.recoverInterruptedTikTokItems(state.client, false)

  assert.equal(recovery.success, 1)
  assert.equal(providerCalls, 1)
  assert.equal(row.status, 'published')
  assert.equal(row.tiktok_publish_id, 'publish-file-1')
  assert.equal(row.tiktok_video_id, 'video-file-1')
})

test('ambiguous post-init FILE_UPLOAD recovery ages into manual review instead of a resendable failure', async () => {
  const token = makePublishAccounts().get('account-1').token
  for (const providerResult of [
    providerResponse(200, {
      data: { status: 'PROCESSING_UPLOAD' },
      error: { code: 'ok', message: '' },
    }),
    providerResponse(503, {
      error: { code: 'server_error', message: 'temporary' },
    }),
  ]) {
    const contentPosting = loadContentPosting(async () => providerResult)
    const processor = loadPublishProcessor(contentPosting, new Map([['account-1', token]]))
    const row = makePublishItem({
      status: 'uploading',
      tiktok_publish_id: 'publish-file-ambiguous',
      processing_started_at: '2020-01-01T00:00:00.000Z',
      publish_init_started_at: '2020-01-01T00:00:00.000Z',
      last_status_check_at: '2020-01-01T00:00:00.000Z',
      tiktok_transfer_method: 'FILE_UPLOAD',
      tiktok_upload_outcome: 'accepted',
      tiktok_upload_reported_at: '2020-01-01T00:00:00.000Z',
    })
    const state = createPublishStateSupabase(row)

    const recovery = await processor.recoverInterruptedTikTokItems(state.client, false)

    assert.equal(recovery.failed, 1)
    assert.equal(row.status, 'failed')
    assert.equal(row.error_code, 'WORKER_INTERRUPTED_NEEDS_REVIEW')
    assert.equal(row.tiktok_publish_id, 'publish-file-ambiguous')
  }
})

test('an explicit TikTok FAILED status remains a safe FILE_UPLOAD failure', async () => {
  const token = makePublishAccounts().get('account-1').token
  const contentPosting = loadContentPosting(async () => providerResponse(200, {
    data: { status: 'FAILED', fail_reason: 'provider rejected content' },
    error: { code: 'ok', message: '' },
  }))
  const processor = loadPublishProcessor(contentPosting, new Map([['account-1', token]]))
  const row = makePublishItem({
    status: 'uploading',
    tiktok_publish_id: 'publish-file-failed',
    processing_started_at: '2020-01-01T00:00:00.000Z',
    publish_init_started_at: '2020-01-01T00:00:00.000Z',
    last_status_check_at: '2020-01-01T00:00:00.000Z',
    tiktok_transfer_method: 'FILE_UPLOAD',
    tiktok_upload_outcome: 'accepted',
  })
  const state = createPublishStateSupabase(row)

  await processor.recoverInterruptedTikTokItems(state.client, false)

  assert.equal(row.status, 'failed')
  assert.equal(row.error_code, 'TIKTOK_STATUS_FAILED')
})

test('dispatch marker errors, zero rows, and stale attempts never call publish init', async () => {
  for (const scenario of ['error', 'zero-row', 'stale-attempt']) {
    let providerCalls = 0
    const contentPosting = loadContentPosting(async () => {
      providerCalls += 1
      return providerResponse(200, {
        data: { publish_id: 'publish-1' },
        error: { code: 'ok', message: '' },
      })
    })
    const processor = loadPublishProcessor(contentPosting)
    const workerItem = makePublishItem()
    const durableRow = makePublishItem(
      scenario === 'stale-attempt' ? { publish_attempt_count: 2 } : {}
    )
    const state = createPublishStateSupabase(durableRow, {
      beforeUpdate({ table, payload }) {
        if (table !== 'publish_task_items' || !payload.publish_init_started_at) return null
        if (scenario === 'error') return { data: null, error: { message: 'database unavailable' } }
        if (scenario === 'zero-row') return { data: [], error: null }
        return null
      },
    })

    const outcome = await processor.publishItem(state.client, workerItem, makePublishAccounts())
    assert.equal(outcome, 'failed')
    assert.equal(providerCalls, 0)
    assert.equal(durableRow.tiktok_publish_id, null)
  }
})

test('publish id persistence failure never polls status or reports confirming', async () => {
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    return providerResponse(200, {
      data: { publish_id: 'publish-1' },
      error: { code: 'ok', message: '' },
    })
  })
  const processor = loadPublishProcessor(contentPosting)
  const row = makePublishItem()
  const state = createPublishStateSupabase(row, {
    beforeUpdate({ table, payload }) {
      if (table === 'publish_task_items' && payload.status === 'uploading') {
        return { data: null, error: { message: 'database unavailable' } }
      }
      return null
    },
  })

  const outcome = await processor.publishItem(state.client, row, makePublishAccounts())
  assert.equal(outcome, 'failed')
  assert.equal(providerCalls, 1)
  assert.equal(row.status, 'processing')
  assert.equal(row.tiktok_publish_id, null)
  assert.ok(row.publish_init_started_at)
  assert.equal(state.writes.some((write) => write.payload.status === 'failed'), false)
})

test('status defer zero-row accepts a published winner while database errors are not confirming', async () => {
  for (const scenario of ['published-winner', 'database-error']) {
    let providerCalls = 0
    const responses = [
      providerResponse(200, {
        data: { publish_id: 'publish-1' },
        error: { code: 'ok', message: '' },
      }),
      providerResponse(503, {
        error: { code: 'server_error', message: 'temporary' },
      }),
    ]
    const contentPosting = loadContentPosting(async () => {
      providerCalls += 1
      return responses.shift()
    })
    const processor = loadPublishProcessor(contentPosting)
    const row = makePublishItem()
    const state = createPublishStateSupabase(row, {
      beforeUpdate({ table, payload, target }) {
        if (table !== 'publish_task_items' || payload.error_code !== 'TIKTOK_STATUS_CHECK_PENDING') {
          return null
        }
        if (scenario === 'published-winner') {
          Object.assign(target, { status: 'published', tiktok_video_id: 'video-1' })
          return { data: [], error: null }
        }
        return { data: null, error: { message: 'database unavailable' } }
      },
    })

    const outcome = await processor.publishItem(state.client, row, makePublishAccounts())
    assert.equal(outcome, scenario === 'published-winner' ? 'success' : 'failed')
    assert.equal(providerCalls, 2)
    assert.notEqual(outcome, 'confirming')
  }
})

test('recovery database errors do not count an unpersisted deferral as confirming', async () => {
  let providerCalls = 0
  const contentPosting = loadContentPosting(async () => {
    providerCalls += 1
    return providerResponse(503, {
      error: { code: 'server_error', message: 'temporary' },
    })
  })
  const token = makePublishAccounts().get('account-1').token
  const processor = loadPublishProcessor(contentPosting, new Map([['account-1', token]]))
  const row = makePublishItem({
    status: 'uploading',
    tiktok_publish_id: 'publish-1',
    processing_started_at: new Date().toISOString(),
    publish_init_started_at: new Date().toISOString(),
    last_status_check_at: '2020-01-01T00:00:02.000Z',
  })
  const state = createPublishStateSupabase(row, {
    beforeUpdate({ table, payload }) {
      if (table === 'publish_task_items' && payload.error_code === 'TIKTOK_STATUS_CHECK_PENDING') {
        return { data: null, error: { message: 'database unavailable' } }
      }
      return null
    },
  })

  const recovery = await processor.recoverInterruptedTikTokItems(state.client, false)
  assert.equal(providerCalls, 1)
  assert.equal(recovery.confirming, 0)
  assert.equal(row.status, 'uploading')
  assert.equal(row.tiktok_publish_id, 'publish-1')
})

test('ambiguous init outcomes cannot be reset through the generic retry route', async () => {
  let accountQueries = 0
  let updates = 0
  const taskQuery = {
    select() { return taskQuery },
    eq() { return taskQuery },
    async single() {
      return {
        data: {
          id: 'task-1',
          status: 'failed',
          items: [{
            id: 'item-1',
            status: 'failed',
            account_id: 'account-1',
            error_code: 'TIKTOK_INIT_OUTCOME_UNKNOWN',
          }],
        },
        error: null,
      }
    },
  }
  const route = loadTsModule('src/app/api/publish/tasks/[id]/retry/route.ts', {
    'next/server': {
      NextRequest: class NextRequest {},
      NextResponse: {
        json(body, init = {}) {
          return { body, status: init.status ?? 200 }
        },
      },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
        },
        from(table) {
          if (table === 'publish_tasks') return taskQuery
          if (table === 'tiktok_accounts') accountQueries += 1
          return {
            select() { return this },
            update() { updates += 1; return this },
          }
        },
      }),
    },
  })

  const response = await route.POST({}, { params: Promise.resolve({ id: 'task-1' }) })
  assert.equal(response.status, 409)
  assert.equal(response.body.requires_manual_review, true)
  assert.equal(accountQueries, 0)
  assert.equal(updates, 0)
})

test('failed FILE_UPLOAD items require browser file reselection before account or queue access', async () => {
  let accountQueries = 0
  let updates = 0
  const taskQuery = {
    select() { return taskQuery },
    eq() { return taskQuery },
    async single() {
      return {
        data: {
          id: 'task-1',
          status: 'failed',
          items: [{
            id: 'item-1',
            status: 'failed',
            account_id: 'account-1',
            error_code: 'TIKTOK_FILE_UPLOAD_INCOMPLETE',
            tiktok_transfer_method: 'FILE_UPLOAD',
          }],
        },
        error: null,
      }
    },
  }
  const route = loadTsModule('src/app/api/publish/tasks/[id]/retry/route.ts', {
    'next/server': {
      NextRequest: class NextRequest {},
      NextResponse: {
        json(body, init = {}) { return { body, status: init.status ?? 200 } },
      },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
        },
        from(table) {
          if (table === 'publish_tasks') return taskQuery
          if (table === 'tiktok_accounts') accountQueries += 1
          return {
            select() { return this },
            update() { updates += 1; return this },
          }
        },
      }),
    },
  })

  const response = await route.POST({}, { params: Promise.resolve({ id: 'task-1' }) })
  assert.equal(response.status, 409)
  assert.equal(response.body.requires_file_reselection, true)
  assert.equal(accountQueries, 0)
  assert.equal(updates, 0)
})

test('ambiguous publish records cannot be deleted to bypass the retry fence', async () => {
  let parentDeletes = 0
  const parentQuery = {
    select() { return parentQuery },
    eq() { return parentQuery },
    delete() { parentDeletes += 1; return parentQuery },
    async single() {
      return {
        data: {
          id: 'task-1',
          status: 'failed',
          items: [{
            status: 'failed',
            error_code: null,
            tiktok_publish_id: null,
            tiktok_transfer_method: 'FILE_UPLOAD',
            tiktok_upload_outcome: null,
            publish_init_started_at: '2026-09-08T00:00:00.000Z',
          }],
        },
        error: null,
      }
    },
  }
  const parentRoute = loadTsModule('src/app/api/publish/tasks/[id]/route.ts', {
    'next/server': {
      NextRequest: class NextRequest {},
      NextResponse: {
        json(body, init = {}) { return { body, status: init.status ?? 200 } },
      },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
        from() { return parentQuery },
      }),
    },
  })
  const parentResponse = await parentRoute.DELETE({}, {
    params: Promise.resolve({ id: 'task-1' }),
  })
  assert.equal(parentResponse.status, 409)
  assert.equal(parentResponse.body.requires_manual_review, true)
  assert.equal(parentDeletes, 0)

  let itemDeletes = 0
  const itemQuery = {
    select() { return itemQuery },
    eq() { return itemQuery },
    delete() { itemDeletes += 1; return itemQuery },
    async single() {
      return {
        data: {
          id: 'item-1',
          task_id: 'task-1',
          account_id: 'account-1',
          status: 'failed',
          error_code: 'WORKER_INTERRUPTED_NEEDS_REVIEW',
          tiktok_publish_id: 'publish-1',
          tiktok_transfer_method: 'FILE_UPLOAD',
          tiktok_upload_outcome: 'unknown',
          tiktok_share_id: null,
          publish_tasks: { user_id: 'user-1' },
        },
        error: null,
      }
    },
  }
  const itemRoute = loadTsModule('src/app/api/publish/tasks/[id]/items/[itemId]/route.ts', {
    'next/server': {
      NextRequest: class NextRequest {},
      NextResponse: {
        json(body, init = {}) { return { body, status: init.status ?? 200 } },
      },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
        from() { return itemQuery },
      }),
    },
    '@/lib/supabase/admin': {
      createAdminClient() { throw new Error('admin access must not run') },
    },
    '@/lib/tiktok/token-manager': {
      getValidTikTokAccessToken() { throw new Error('token access must not run') },
    },
  })
  const itemResponse = await itemRoute.DELETE({}, {
    params: Promise.resolve({ id: 'task-1', itemId: 'item-1' }),
  })
  assert.equal(itemResponse.status, 409)
  assert.equal(itemResponse.body.requires_manual_review, true)
  assert.equal(itemDeletes, 0)
})

function createOrdinaryTaskRouteHarness(options = {}) {
  const state = {
    tasks: [],
    items: [],
    taskInsertCalls: 0,
    itemInsertCalls: 0,
    queueCalls: 0,
    accountTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    failItemInsertOnce: Boolean(options.failItemInsertOnce),
    itemInsertReturnsZeroRowsOnce: Boolean(options.itemInsertReturnsZeroRowsOnce),
  }

  function makeQuery(table) {
    let operation = 'select'
    let values = null
    const equals = new Map()
    const inValues = new Map()
    const query = {
      select() { return query },
      insert(nextValues) { operation = 'insert'; values = nextValues; return query },
      delete() { operation = 'delete'; return query },
      eq(column, value) { equals.set(column, value); return query },
      in(column, nextValues) { inValues.set(column, nextValues); return query },
      maybeSingle() {
        return execute().then((result) => ({
          ...result,
          data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
        }))
      },
      single() {
        return execute().then((result) => ({
          ...result,
          data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
        }))
      },
      then(resolve, reject) { return execute().then(resolve, reject) },
    }

    async function execute() {
      if (table === 'tiktok_accounts') {
        return {
          data: [{
            id: 'account-1',
            open_id: 'open-1',
            token_expires_at: state.accountTokenExpiresAt,
            user_id: 'user-1',
            account_type: 'normal',
          }].filter((account) => (
            (!equals.has('user_id') || equals.get('user_id') === account.user_id)
            && (!equals.has('account_type') || equals.get('account_type') === account.account_type)
            && (!inValues.has('id') || inValues.get('id').includes(account.id))
          )),
          error: null,
        }
      }

      if (table === 'publish_tasks') {
        if (operation === 'insert') {
          state.taskInsertCalls += 1
          const existing = state.tasks.find((task) => (
            task.user_id === values.user_id
            && task.idempotency_key
            && task.idempotency_key === values.idempotency_key
          ))
          if (existing) return { data: null, error: { code: '23505', message: 'unique violation' } }
          const task = { id: `task-${state.tasks.length + 1}`, ...values }
          state.tasks.push(task)
          return { data: [task], error: null }
        }
        if (operation === 'delete') {
          state.tasks = state.tasks.filter((task) => (
            [...equals].some(([column, value]) => task[column] !== value)
          ))
          return { data: [], error: null }
        }
        return {
          data: state.tasks.filter((task) => [...equals].every(([column, value]) => task[column] === value)),
          error: null,
        }
      }

      if (table === 'publish_task_items') {
        if (operation === 'insert') {
          state.itemInsertCalls += 1
          if (state.failItemInsertOnce) {
            state.failItemInsertOnce = false
            return { data: null, error: { code: '08006', message: 'response lost' } }
          }
          const rows = Array.isArray(values) ? values : [values]
          if (rows.some((row) => state.items.some((item) => (
            item.task_id === row.task_id && item.dedupe_key === row.dedupe_key
          )))) {
            return { data: null, error: { code: '23505', message: 'unique violation' } }
          }
          const inserted = rows.map((row) => ({
            id: `item-${state.items.length + 1}`,
            ...row,
          }))
          state.items.push(...inserted)
          if (state.itemInsertReturnsZeroRowsOnce) {
            state.itemInsertReturnsZeroRowsOnce = false
            return { data: [], error: null }
          }
          return { data: inserted, error: null }
        }
        return {
          data: state.items.filter((item) => [...equals].every(([column, value]) => item[column] === value)),
          error: null,
        }
      }

      throw new Error(`Unexpected table ${table}`)
    }
    return query
  }

  const route = loadTsModule('src/app/api/publish/tasks/route.ts', {
    'next/server': {
      NextRequest: class NextRequest {},
      NextResponse: {
        json(body, init = {}) { return { body, status: init.status ?? 200 } },
      },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
        },
        from: makeQuery,
      }),
    },
    '@/lib/publish-processor': {
      processPublishQueue: async () => { state.queueCalls += 1 },
    },
  })

  return { route, state }
}

function makeFileUploadTaskRequest(overrides = {}, pathname) {
  const body = {
    idempotency_key: 'ordinary-file-request-0001',
    name: 'FILE upload test',
    videos: [{
      id: 'local-video-1',
      type: 'upload',
      name: 'clip.mp4',
      sizeBytes: 4 * 1024 * 1024,
      mimeType: 'video/mp4',
    }],
    account_ids: ['account-1'],
    caption: 'test {n} {date}',
    privacy_level: 'SELF_ONLY',
    allow_comment: false,
    allow_duet: false,
    allow_stitch: false,
    brand_content_toggle: false,
    brand_organic_toggle: false,
    is_ai_generated: true,
    publish_mode: 'now',
    scheduled_at: null,
    batch_interval: 5,
    transfer_method: 'FILE_UPLOAD',
    ...overrides,
  }
  return {
    nextUrl: {
      pathname: pathname || (body.transfer_method === 'FILE_UPLOAD'
        ? '/api/publish/file-tasks'
        : '/api/publish/tasks'),
    },
    json: async () => body,
  }
}

test('ordinary FILE_UPLOAD task creation converges concurrent calls and response-loss replays', async () => {
  const { route, state } = createOrdinaryTaskRouteHarness()
  const [first, concurrent] = await Promise.all([
    route.POST(makeFileUploadTaskRequest()),
    route.POST(makeFileUploadTaskRequest()),
  ])
  const replay = await route.POST(makeFileUploadTaskRequest())

  assert.equal(first.status, 200)
  assert.equal(concurrent.status, 200)
  assert.equal(replay.status, 200)
  assert.equal(first.body.task.id, concurrent.body.task.id)
  assert.equal(first.body.task.id, replay.body.task.id)
  assert.equal(state.tasks.length, 1)
  assert.equal(state.items.length, 1)
  assert.equal(state.queueCalls, 0)
  assert.equal(JSON.stringify(first.body).includes('ordinary_create'), false)
  assert.equal(JSON.stringify(first.body).includes('ordinary-file-request-0001'), false)
  assert.equal(JSON.stringify(first.body).includes('dedupe_key'), false)
})

test('a matching task replay remains reachable after account authorization expires', async () => {
  const { route, state } = createOrdinaryTaskRouteHarness()
  const first = await route.POST(makeFileUploadTaskRequest())
  state.accountTokenExpiresAt = '2020-01-01T00:00:00.000Z'
  const replay = await route.POST(makeFileUploadTaskRequest())

  assert.equal(first.status, 200)
  assert.equal(replay.status, 200)
  assert.equal(replay.body.task.id, first.body.task.id)
  assert.equal(state.tasks.length, 1)
})

test('ordinary task idempotency key rejects a changed request without creating another task', async () => {
  const { route, state } = createOrdinaryTaskRouteHarness()
  const first = await route.POST(makeFileUploadTaskRequest())
  const changed = await route.POST(makeFileUploadTaskRequest({ caption: 'different content' }))

  assert.equal(first.status, 200)
  assert.equal(changed.status, 409)
  assert.equal(state.tasks.length, 1)
  assert.equal(state.items.length, 1)
})

test('ordinary task replay repairs an item insert failure and confirms a committed zero-row insert', async () => {
  const interrupted = createOrdinaryTaskRouteHarness({ failItemInsertOnce: true })
  const failed = await interrupted.route.POST(makeFileUploadTaskRequest())
  const repaired = await interrupted.route.POST(makeFileUploadTaskRequest())
  assert.equal(failed.status, 500)
  assert.equal(repaired.status, 200)
  assert.equal(interrupted.state.tasks.length, 1)
  assert.equal(interrupted.state.items.length, 1)

  const zeroRow = createOrdinaryTaskRouteHarness({ itemInsertReturnsZeroRowsOnce: true })
  const confirmed = await zeroRow.route.POST(makeFileUploadTaskRequest())
  assert.equal(confirmed.status, 200)
  assert.equal(zeroRow.state.tasks.length, 1)
  assert.equal(zeroRow.state.items.length, 1)
})

test('legacy PULL_FROM_URL task creation remains compatible without an idempotency key', async () => {
  const { route, state } = createOrdinaryTaskRouteHarness()
  const response = await route.POST(makeFileUploadTaskRequest({
    idempotency_key: undefined,
    videos: [{
      id: 'asset-video-1',
      type: 'asset',
      name: 'asset.mp4',
      url: 'https://media.example.test/asset.mp4',
    }],
    transfer_method: 'PULL_FROM_URL',
  }))

  assert.equal(response.status, 200)
  assert.equal(response.body.upload_items.length, 0)
  assert.equal(state.tasks.length, 1)
  assert.equal(state.items.length, 1)
  assert.equal(state.queueCalls, 1)
})

test('ordinary task creation binds FILE_UPLOAD and PULL_FROM_URL to separate endpoints', async () => {
  const fileThroughGeneric = createOrdinaryTaskRouteHarness()
  const rejectedFile = await fileThroughGeneric.route.POST(makeFileUploadTaskRequest(
    {},
    '/api/publish/tasks',
  ))
  assert.equal(rejectedFile.status, 400)
  assert.equal(fileThroughGeneric.state.tasks.length, 0)
  assert.equal(fileThroughGeneric.state.items.length, 0)

  const urlThroughFile = createOrdinaryTaskRouteHarness()
  const rejectedUrl = await urlThroughFile.route.POST(makeFileUploadTaskRequest({
    idempotency_key: undefined,
    videos: [{
      id: 'asset-video-1',
      type: 'asset',
      name: 'asset.mp4',
      url: 'https://media.example.test/asset.mp4',
    }],
    transfer_method: 'PULL_FROM_URL',
  }, '/api/publish/file-tasks'))
  assert.equal(rejectedUrl.status, 400)
  assert.equal(urlThroughFile.state.tasks.length, 0)
  assert.equal(urlThroughFile.state.items.length, 0)

  const prefixedRoute = createOrdinaryTaskRouteHarness()
  const rejectedPrefixedRoute = await prefixedRoute.route.POST(makeFileUploadTaskRequest(
    {},
    '/unexpected/api/publish/file-tasks',
  ))
  assert.equal(rejectedPrefixedRoute.status, 400)
  assert.equal(prefixedRoute.state.tasks.length, 0)
  assert.equal(prefixedRoute.state.items.length, 0)
})

test('ordinary task validation rejects malformed and oversized requests before any write', async () => {
  const malformedCases = [
    { batch_interval: 'bad' },
    { idempotency_key: 123 },
    { caption: { unexpected: true } },
    { videos: [{
      id: 'local-video-1',
      type: 'upload',
      name: 'clip.mp4',
      title: 123,
      sizeBytes: 4 * 1024 * 1024,
      mimeType: 'video/mp4',
    }] },
    { videos: Array.from({ length: 41 }, (_, index) => ({
      id: `local-video-${index}`,
      type: 'upload',
      name: `clip-${index}.mp4`,
      sizeBytes: 4 * 1024 * 1024,
      mimeType: 'video/mp4',
    })) },
    { account_ids: Array.from({ length: 21 }, (_, index) => `account-${index}`) },
  ]

  for (const overrides of malformedCases) {
    const harness = createOrdinaryTaskRouteHarness()
    const response = await harness.route.POST(makeFileUploadTaskRequest(overrides))
    assert.equal(response.status, 400)
    assert.equal(harness.state.taskInsertCalls, 0)
    assert.equal(harness.state.itemInsertCalls, 0)
    assert.equal(harness.state.tasks.length, 0)
    assert.equal(harness.state.items.length, 0)
  }
})

test('ordinary task validation preserves legitimate multiline captions', async () => {
  const harness = createOrdinaryTaskRouteHarness()
  const response = await harness.route.POST(makeFileUploadTaskRequest({
    caption: 'first line\nsecond line',
  }))
  assert.equal(response.status, 200)
  assert.equal(harness.state.tasks.length, 1)
  assert.equal(harness.state.items.length, 1)
})

test('FILE_UPLOAD migration keeps URL publishing compatible and binds browser reports to file items', () => {
  const migration = read('supabase/migrations/20260908_tiktok_content_posting_file_upload.sql')
  assert.match(migration, /tiktok_transfer_method TEXT NOT NULL DEFAULT 'PULL_FROM_URL'/)
  assert.match(migration, /tiktok_transfer_method IN \('PULL_FROM_URL', 'FILE_UPLOAD'\)/)
  assert.match(migration, /source_video_size_bytes BETWEEN 1 AND 4294967296/)
  assert.match(migration, /source_video_mime_type IN \('video\/mp4', 'video\/quicktime', 'video\/webm'\)/)
  assert.match(migration, /tiktok_upload_outcome IN \('accepted', 'unknown', 'rejected'\)/)
  assert.match(migration, /tiktok_transfer_method = 'FILE_UPLOAD'/)
  assert.match(migration, /tiktok_upload_reported_at IS NOT NULL/)
  assert.match(migration, /FILE_UPLOAD items are server-managed/)
  assert.match(migration, /AS RESTRICTIVE\s+FOR UPDATE\s+TO authenticated/)
  assert.match(migration, /Ambiguous FILE_UPLOAD items cannot be deleted/)
  assert.match(migration, /publish_init_started_at IS NOT NULL/)
  assert.match(migration, /Tasks with ambiguous FILE_UPLOAD items cannot be deleted/)
  assert.equal((migration.match(/DROP POLICY IF EXISTS/g) || []).length, 3)
})

test('FILE_UPLOAD creation fails closed on old backends and preserves the same browser retry', async () => {
  const forwardedRequest = { contract: 'file-upload-v1' }
  let observedRequest = null
  const route = loadTsModule('src/app/api/publish/file-tasks/route.ts', {
    '../tasks/route': {
      async POST(request) {
        observedRequest = request
        return { status: 200, forwarded: true }
      },
    },
  })

  const forwarded = await route.POST(forwardedRequest)
  assert.equal(observedRequest, forwardedRequest)
  assert.deepEqual(forwarded, { status: 200, forwarded: true })

  const page = read('src/app/(main)/publish/page.tsx')
  assert.match(
    page,
    /directFileUpload \? '\/api\/publish\/file-tasks' : '\/api\/publish\/tasks'/,
  )
  assert.match(page, /response\.status === 404 \|\| response\.status === 405/)
  assert.match(page, /initResponse\.status === 404 \|\| initResponse\.status === 405/)

  const retryBranch = page.slice(
    page.indexOf('if (backendUpgradePending)'),
    page.indexOf('if (failedUploads > 0)'),
  )
  assert.match(retryBranch, /原文件和发布请求已保留/)
  assert.match(retryBranch, /return/)
  assert.doesNotMatch(retryBranch, /publishIdempotencyKeyRef\.current = null/)
  assert.doesNotMatch(retryBranch, /setSelectedVideos\(\[\]\)/)

  const unavailableCatch = page.slice(
    page.indexOf('if (error instanceof PublishBackendUpgradePendingError)'),
    page.indexOf('if (taskCreated)'),
  )
  assert.match(unavailableCatch, /原文件和发布请求已保留/)
  assert.match(unavailableCatch, /return/)
  assert.doesNotMatch(unavailableCatch, /publishIdempotencyKeyRef\.current = null/)
  assert.doesNotMatch(unavailableCatch, /setSelectedVideos\(\[\]\)/)
})

test('upload failures remain visible with details and an explicit reselect path', () => {
  for (const relativePath of [
    'src/app/(main)/publish/page.tsx',
    'src/components/publish/platform/PlatformPublishPage.tsx',
  ]) {
    const source = read(relativePath)
    assert.match(source, /file\.status === 'error' && file\.error/)
    assert.match(source, /重新选择|Select again/)
    assert.match(source, relativePath.includes('(main)/publish/page.tsx')
      ? /preparedFiles\.every/
      : /uploadResults\.every/)
    assert.doesNotMatch(
      source,
      /await Promise\.all\([^\n]+\)\s*\n\s*\/\/ Clear upload status after delay\s*\n\s*setTimeout/,
    )
  }

  const credentialsRoute = read('src/app/api/upload/oss-credentials/route.ts')
  assert.doesNotMatch(credentialsRoute, /Generated upload URL/)
  assert.doesNotMatch(credentialsRoute, /userId:\s*user\.id/)
  assert.doesNotMatch(credentialsRoute, /console\.error\([^\n]+error/)
  assert.match(credentialsRoute, /Failed to generate upload credentials/)

  const tiktokPage = read('src/app/(main)/publish/page.tsx')
  const localPreparation = tiktokPage.slice(
    tiktokPage.indexOf('const handleFileUpload'),
    tiktokPage.indexOf('// Generate cover options'),
  )
  assert.doesNotMatch(localPreparation, /oss-credentials|XMLHttpRequest/)
  assert.match(localPreparation, /transferMethod: 'FILE_UPLOAD'/)
  assert.match(tiktokPage, /uploadFileDirectlyToTikTok/)
  assert.match(tiktokPage, /let taskCreated = false/)
  assert.match(tiktokPage, /publishSubmissionInFlightRef\.current/)
  assert.match(tiktokPage, /idempotency_key: idempotencyKey/)
  assert.match(tiktokPage, /selectedVideoBlobUrlsRef\.current\.clear\(\)/)
  assert.match(tiktokPage, /resolveTikTokLocalVideoMimeType/)
  assert.match(tiktokPage, /任务已经创建，但后续处理未完成。请勿重复创建/)
})

test('multi-account FILE_UPLOAD progress is isolated by publish item', () => {
  const page = read('src/app/(main)/publish/page.tsx')
  const directUploadProgress = page.slice(
    page.indexOf('setUploadingFiles(uploadItems.map'),
    page.indexOf('if (backendUpgradePending)'),
  )

  assert.match(directUploadProgress, /id: uploadItem\.id/)
  assert.match(directUploadProgress, /status: 'pending'/)
  assert.match(
    directUploadProgress,
    /file\.id === uploadItem\.id[\s\S]*status: 'uploading',[\s\S]*progress: 0/,
  )
  assert.equal((directUploadProgress.match(/file\.id === uploadItem\.id/g) || []).length >= 4, true)
  assert.doesNotMatch(directUploadProgress, /file\.id === video\.id/)
  assert.match(page, /正在准备或直传 \{uploadingFiles\.length\} 个发布项/)
})
