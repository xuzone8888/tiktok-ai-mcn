const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScriptModule(relativePath) {
  const filename = path.join(process.cwd(), relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(output, {
    exports: loadedModule.exports,
    module: loadedModule,
    require,
    Date,
    Set,
    Promise,
  }, { filename })
  return loadedModule.exports
}

function createClaimSupabase(initialRows) {
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]))
  return {
    rows,
    from() {
      const filters = []
      let update = null
      const query = {
        update(value) {
          update = value
          return query
        },
        eq(column, value) {
          filters.push((row) => row[column] === value)
          return query
        },
        lte(column, value) {
          filters.push((row) => row[column] <= value)
          return query
        },
        select() {
          return query
        },
        async maybeSingle() {
          const row = [...rows.values()].find((candidate) => filters.every((filter) => filter(candidate)))
          if (!row) return { data: null, error: null }
          Object.assign(row, update)
          return { data: { id: row.id }, error: null }
        },
      }
      return query
    },
  }
}

function createCandidateSupabase(initialRows) {
  const rows = initialRows.map((row) => ({ ...row }))
  return {
    from() {
      const filters = []
      const orders = []
      let limit = Number.POSITIVE_INFINITY
      const query = {
        select() {
          return query
        },
        eq(column, value) {
          filters.push((row) => row[column] === value)
          return query
        },
        lte(column, value) {
          filters.push((row) => row[column] <= value)
          return query
        },
        order(column) {
          orders.push(column)
          return query
        },
        limit(value) {
          limit = value
          return query
        },
        then(resolve) {
          const data = rows
            .filter((row) => filters.every((filter) => filter(row)))
            .sort((left, right) => {
              for (const column of orders) {
                const compared = String(left[column]).localeCompare(String(right[column]))
                if (compared !== 0) return compared
              }
              return 0
            })
            .slice(0, limit)
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    },
  }
}

const lease = loadTypeScriptModule('src/lib/instagram/publish-lease.ts')
const NOW = Date.parse('2026-07-10T12:00:00.000Z')
const DUE = new Date(NOW - 60_000).toISOString()

test('active uploading lease is longer than the full inline polling window', () => {
  assert.ok(lease.INSTAGRAM_ACTIVE_UPLOAD_LEASE_MS > lease.INSTAGRAM_INLINE_MAX_WAIT_MS)
  assert.equal(lease.isInstagramPublishItemEligible({
    id: 'item',
    status: 'uploading',
    updated_at: new Date(NOW - lease.INSTAGRAM_INLINE_MAX_WAIT_MS).toISOString(),
  }, NOW), false)
})

test('an uploading item inside the active lease cannot be claimed', async () => {
  const item = {
    id: 'item',
    status: 'uploading',
    updated_at: new Date(NOW - lease.INSTAGRAM_INLINE_MAX_WAIT_MS).toISOString(),
  }
  const supabase = createClaimSupabase([item])
  assert.equal(await lease.claimInstagramPublishItem(supabase, item, NOW), null)
})

test('deferred processing recovers on the short repoll window', () => {
  assert.equal(lease.isInstagramPublishItemEligible({
    id: 'item',
    status: 'processing',
    updated_at: new Date(NOW - lease.INSTAGRAM_DEFERRED_REPOLL_DELAY_MS - 1).toISOString(),
  }, NOW), true)
})

test('a deferred processing item is claimed only after its short repoll window', async () => {
  const fresh = {
    id: 'fresh',
    status: 'processing',
    updated_at: new Date(NOW - 1000).toISOString(),
  }
  const stale = {
    id: 'stale',
    status: 'processing',
    updated_at: new Date(NOW - lease.INSTAGRAM_DEFERRED_REPOLL_DELAY_MS - 1).toISOString(),
  }
  const supabase = createClaimSupabase([fresh, stale])
  assert.equal(await lease.claimInstagramPublishItem(supabase, fresh, NOW), null)
  assert.ok(await lease.claimInstagramPublishItem(supabase, stale, NOW))
})

test('stale uploading recovers after the longer lease and keeps its container id', async () => {
  const item = {
    id: 'item',
    status: 'uploading',
    updated_at: new Date(NOW - lease.INSTAGRAM_ACTIVE_UPLOAD_LEASE_MS - 1).toISOString(),
    instagram_video_id: 'container',
  }
  const supabase = createClaimSupabase([item])
  assert.ok(await lease.claimInstagramPublishItem(supabase, item, NOW))
  assert.equal(supabase.rows.get('item').instagram_video_id, 'container')
})

test('concurrent workers use item-level CAS so only one reaches the publish path', async () => {
  const item = {
    id: 'item',
    status: 'pending',
    updated_at: new Date(NOW - 1000).toISOString(),
  }
  const supabase = createClaimSupabase([item])
  const [first, second] = await Promise.all([
    lease.claimInstagramPublishItem(supabase, item, NOW),
    lease.claimInstagramPublishItem(supabase, item, NOW),
  ])
  assert.equal(Number(Boolean(first)) + Number(Boolean(second)), 1)
})

test('workers claim each candidate immediately before processing instead of pre-locking the batch', async () => {
  const candidates = ['a', 'b', 'c'].map((id) => ({
    id,
    status: 'pending',
    updated_at: new Date(NOW - 1000).toISOString(),
  }))
  const supabase = createClaimSupabase(candidates)
  const entered = []

  assert.ok(await lease.claimInstagramPublishItem(supabase, candidates[0], NOW))
  entered.push('a')
  assert.ok(await lease.claimInstagramPublishItem(supabase, candidates[1], NOW + 1))
  entered.push('b-worker-2')
  assert.equal(await lease.claimInstagramPublishItem(supabase, candidates[1], NOW + 2), null)
  assert.ok(await lease.claimInstagramPublishItem(supabase, candidates[2], NOW + 3))
  entered.push('c')

  assert.deepEqual(entered, ['a', 'b-worker-2', 'c'])
})

test('a worker that loses its lease is fenced before it can renew or write externally', async () => {
  const item = {
    id: 'item',
    status: 'pending',
    updated_at: new Date(NOW - 1000).toISOString(),
  }
  const supabase = createClaimSupabase([item])
  const workerA = await lease.claimInstagramPublishItem(supabase, item, NOW)
  assert.ok(workerA)
  const staleSnapshot = {
    id: item.id,
    status: 'uploading',
    updated_at: supabase.rows.get(item.id).updated_at,
  }
  const workerB = await lease.claimInstagramPublishItem(
    supabase,
    staleSnapshot,
    NOW + lease.INSTAGRAM_ACTIVE_UPLOAD_LEASE_MS + 1
  )
  assert.ok(workerB)
  assert.notEqual(workerA.token, workerB.token)
  assert.equal(await lease.renewInstagramPublishLease(
    supabase,
    item.id,
    workerA.token,
    NOW + lease.INSTAGRAM_ACTIVE_UPLOAD_LEASE_MS + 2
  ), false)
  assert.equal(await lease.renewInstagramPublishLease(
    supabase,
    item.id,
    workerB.token,
    NOW + lease.INSTAGRAM_ACTIVE_UPLOAD_LEASE_MS + 2
  ), true)
})

test('candidate queries exclude active leases before limit and preserve due/task filters', async () => {
  const activeUploading = Array.from({ length: 20 }, (_, index) => ({
    id: `active-${index}`,
    task_id: 'target',
    status: 'uploading',
    scheduled_at: DUE,
    updated_at: new Date(NOW - 30_000).toISOString(),
  }))
  const rows = [
    ...activeUploading,
    {
      id: 'pending-target',
      task_id: 'target',
      status: 'pending',
      scheduled_at: DUE,
      updated_at: DUE,
    },
    {
      id: 'future-target',
      task_id: 'target',
      status: 'pending',
      scheduled_at: new Date(NOW + 60_000).toISOString(),
      updated_at: DUE,
    },
    {
      id: 'pending-other-task',
      task_id: 'other',
      status: 'pending',
      scheduled_at: DUE,
      updated_at: DUE,
    },
  ]

  const candidates = await lease.queryInstagramPublishCandidates(
    createCandidateSupabase(rows),
    { select: '*', taskId: 'target', maxItems: 20, nowMs: NOW }
  )
  assert.deepEqual(Array.from(candidates, (item) => item.id), ['pending-target'])
})

test('candidate queues are merged fairly before applying the run limit', () => {
  const merged = lease.mergeInstagramPublishCandidateQueues([
    [{ id: 'pending-1' }, { id: 'pending-2' }],
    [{ id: 'processing-1' }, { id: 'processing-2' }],
    [{ id: 'uploading-1' }, { id: 'uploading-2' }],
  ], 4)
  assert.deepEqual(Array.from(merged, (item) => item.id), [
    'pending-1',
    'processing-1',
    'uploading-1',
    'pending-2',
  ])
})

test('processor claims inside the item loop and only finalizes touched tasks', () => {
  const processor = fs.readFileSync(path.join(process.cwd(), 'src/lib/instagram/processor.ts'), 'utf8')
  const loop = processor.indexOf('for (const item of items)')
  const claim = processor.indexOf('claimInstagramPublishItem(supabase, item)')
  const publish = processor.indexOf('await publishItem(supabase, item')
  assert.ok(loop >= 0 && claim > loop && publish > claim)
  assert.equal(processor.includes('lockInstagramPublishItems'), false)
  assert.ok(processor.includes('for (const taskId of touchedTaskIds)'))
})
