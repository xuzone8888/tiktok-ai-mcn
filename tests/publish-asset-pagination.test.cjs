const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, stubs = {}) {
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
  vm.runInNewContext(output, {
    Buffer,
    URL,
    URLSearchParams,
    console,
    exports: loadedModule.exports,
    module: loadedModule,
    require(request) {
      if (Object.hasOwn(stubs, request)) return stubs[request]
      return require(request)
    },
  }, { filename })

  return loadedModule.exports
}

const pagination = loadTypeScriptModule('src/lib/publish/asset-pagination.ts')
const cursor = loadTypeScriptModule('src/lib/publish/asset-page-cursor.ts')

function asset(id) {
  return {
    id,
    type: 'video',
    resultUrl: `https://media.example.test/${id}.mp4`,
    thumbnailUrl: null,
    prompt: id,
    model: 'test',
    createdAt: '2026-07-29T00:00:00.000Z',
    source: 'quick_gen',
  }
}

test('page URLs keep the server cursor opaque and encode it exactly once', () => {
  assert.equal(pagination.buildPublishAssetPageUrl(), '/api/publish/assets')
  assert.equal(
    pagination.buildPublishAssetPageUrl('opaque+/=cursor'),
    '/api/publish/assets?cursor=opaque%2B%2F%3Dcursor'
  )
})

test('the 51st asset is appended and duplicate boundary rows are ignored', () => {
  const firstPage = Array.from({ length: 50 }, (_, index) => asset(`asset-${index + 1}`))
  const secondPage = [asset('asset-50'), asset('asset-51')]

  const merged = pagination.mergePublishAssetPages(firstPage, secondPage)

  assert.equal(merged.length, 51)
  assert.equal(merged[50].id, 'asset-51')
  assert.equal(merged.filter((item) => item.id === 'asset-50').length, 1)
})

test('an entirely filtered 404/410 page still exposes the cursor for older assets', () => {
  const rawPage = {
    success: true,
    data: {
      assets: Array.from({ length: 50 }, (_, index) => asset(`unavailable-${index + 1}`)),
      nextCursor: 'older-page-cursor',
      hasMore: true,
    },
  }
  const parsed = pagination.parsePublishAssetPage(rawPage)
  const probeResults = new Map(parsed.assets.map((item, index) => [
    item.id,
    { accessible: false, status: index % 2 === 0 ? 404 : 410 },
  ]))
  const usableAssets = parsed.assets.filter((item) => {
    const probe = probeResults.get(item.id)
    return !(probe?.accessible === false && (probe.status === 404 || probe.status === 410))
  })

  assert.equal(usableAssets.length, 0)
  assert.equal(parsed.hasMore, true)
  assert.equal(parsed.nextCursor, 'older-page-cursor')
  assert.equal(
    pagination.buildPublishAssetPageUrl(parsed.nextCursor),
    '/api/publish/assets?cursor=older-page-cursor'
  )
})

test('hasMore cannot be accepted without a usable nextCursor', () => {
  assert.throws(
    () => pagination.parsePublishAssetPage({
      success: true,
      data: { assets: [], nextCursor: null, hasMore: true },
    }),
    /Invalid asset page response/
  )
  assert.throws(
    () => pagination.parsePublishAssetPage({
      success: true,
      data: { assets: [], nextCursor: 'cursor-1', hasMore: true },
    }, 'cursor-1'),
    /Invalid asset page response/
  )
})

test('the composite cursor preserves rows sharing the same created_at boundary', () => {
  const createdAt = '2026-07-29T00:00:00.123456+00:00'
  const id = '00000000-0000-4000-8000-000000000002'
  const token = cursor.encodePublishAssetCursor({ createdAt, id })
  const decoded = cursor.decodePublishAssetCursor(token)

  assert.equal(decoded.createdAt, createdAt)
  assert.equal(decoded.id, id)
  assert.equal(
    cursor.buildPublishAssetCursorFilter(decoded),
    `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`
  )

  assert.throws(
    () => cursor.encodePublishAssetCursor({
      createdAt: '2026-07-29T00:00:00.123456+00:00),or(user_id.neq.safe',
      id,
    }),
    /Invalid publish asset cursor/
  )
})

function generationRow(
  sequence,
  createdAt = '2026-07-29T00:00:00.123456+00:00'
) {
  const suffix = String(sequence).padStart(12, '0')
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    type: 'video',
    source: 'quick_gen',
    result_url: `https://media.example.test/${sequence}.mp4`,
    video_url: null,
    thumbnail_url: null,
    output_oss_key: null,
    prompt: `video-${sequence}`,
    model: 'test',
    created_at: createdAt,
  }
}

function createSupabasePage(rows, calls) {
  const query = {
    select(value) {
      calls.select.push(value)
      return query
    },
    eq(column, value) {
      calls.eq.push([column, value])
      return query
    },
    order(column, options) {
      calls.order.push([column, options])
      return query
    },
    limit(value) {
      calls.limit.push(value)
      return query
    },
    or(value) {
      calls.or.push(value)
      return query
    },
    then(resolve, reject) {
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
    },
  }

  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
    from(table) {
      calls.from.push(table)
      return query
    },
  }
}

test('the API reaches row 51 across tied IDs and an adjacent PostgreSQL microsecond', async () => {
  const olderMicrosecond = '2026-07-29T00:00:00.123455+00:00'
  const firstRows = Array.from(
    { length: 51 },
    (_, index) => generationRow(51 - index, index === 50 ? olderMicrosecond : undefined)
  )
  const secondRows = [generationRow(1, olderMicrosecond)]
  const callPages = [firstRows, secondRows].map(() => ({
    from: [],
    select: [],
    eq: [],
    order: [],
    limit: [],
    or: [],
  }))
  let requestCount = 0

  const route = loadTypeScriptModule('src/app/api/publish/assets/route.ts', {
    'next/server': {
      NextResponse: {
        json(body, init = {}) {
          return { body, headers: init.headers || {}, status: init.status || 200 }
        },
      },
    },
    '@/lib/oss': { getPublicUrl: (key) => `https://oss.example.test/${key}` },
    '@/lib/publish/asset-page-cursor': cursor,
    '@/lib/publish/asset-pagination': pagination,
    '@/lib/supabase/server': {
      createClient: async () => {
        const index = requestCount++
        return createSupabasePage(index === 0 ? firstRows : secondRows, callPages[index])
      },
    },
  })

  const first = await route.GET(new Request('https://app.example.test/api/publish/assets'))
  assert.equal(first.status, 200)
  assert.equal(first.body.data.assets.length, 50)
  assert.equal(first.body.data.hasMore, true)
  assert.equal(typeof first.body.data.nextCursor, 'string')
  assert.equal(first.headers['Cache-Control'], 'private, no-store')
  assert.deepEqual(callPages[0].eq, [
    ['user_id', 'user-1'],
    ['type', 'video'],
    ['status', 'completed'],
  ])
  assert.deepEqual(callPages[0].order.map(([column]) => column), ['created_at', 'id'])
  assert.deepEqual(callPages[0].limit, [pagination.PUBLISH_ASSET_PAGE_SIZE + 1])

  const boundary = cursor.decodePublishAssetCursor(first.body.data.nextCursor)
  assert.equal(boundary.id, generationRow(2).id)
  assert.equal(boundary.createdAt, '2026-07-29T00:00:00.123456+00:00')

  const second = await route.GET(new Request(
    `https://app.example.test/api/publish/assets?cursor=${encodeURIComponent(first.body.data.nextCursor)}`
  ))
  assert.equal(second.status, 200)
  assert.equal(second.body.data.assets.length, 1)
  assert.equal(second.body.data.assets[0].id, generationRow(1).id)
  assert.equal(second.body.data.assets[0].createdAt, olderMicrosecond)
  assert.equal(second.body.data.hasMore, false)
  assert.equal(second.body.data.nextCursor, null)
  assert.deepEqual(callPages[1].or, [cursor.buildPublishAssetCursorFilter(boundary)])
  assert.equal(
    callPages[1].or[0],
    'created_at.lt.2026-07-29T00:00:00.123456+00:00,' +
      `and(created_at.eq.2026-07-29T00:00:00.123456+00:00,id.lt.${generationRow(2).id})`
  )

  const invalidCursor = await route.GET(new Request(
    'https://app.example.test/api/publish/assets?cursor=not-a-valid-cursor'
  ))
  assert.equal(invalidCursor.status, 400)
  assert.equal(invalidCursor.body.error, 'Invalid pagination cursor')
})

test('all three active publish selectors load and append cursor pages without a fixed 50-row cutoff', () => {
  const selectors = [
    'src/app/(main)/publish/page.tsx',
    'src/app/(main)/youtube-publish/YouTubePublishClient.tsx',
    'src/components/publish/platform/PlatformPublishPage.tsx',
  ]
  const legacyRequest = '/api/user/tasks?type=video&status=completed&limit=50'

  for (const relativePath of selectors) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
    assert.equal(source.includes(legacyRequest), false, relativePath)
    assert.match(source, /assetRequestInFlightRef\.current/, relativePath)
    assert.match(source, /assetRequestAbortRef\.current\?\.abort\(\)/, relativePath)
    assert.match(source, /signal: controller\.signal/, relativePath)
    assert.match(source, /assetRequestAbortRef\.current !== controller/, relativePath)
    assert.match(source, /buildPublishAssetPageUrl\(cursor\)/, relativePath)
    assert.match(source, /parsePublishAssetPage</, relativePath)
    assert.match(source, /mergePublishAssetPages\(current, valid(?:Assets|Videos)\)/, relativePath)
    assert.match(source, /setNextAssetCursor\(page\.nextCursor\)/, relativePath)
    assert.match(source, /setHasMoreAssets\(page\.hasMore\)/, relativePath)
    assert.match(source, /hasMoreAssets &&/, relativePath)
    assert.match(source, /fetchAssets\(nextAssetCursor\)/, relativePath)
    assert.match(source, /if \(!isLoadingMore\) setSelectedAssetIds\(\[\]\)/, relativePath)
    assert.match(source, /status === 404 \|\| .*status === 410/, relativePath)
  }
})
