/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'

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
    console,
    process,
    ...globals,
  }, { filename })
  return loadedModule.exports
}

function jsonResponse(body, init = {}) {
  return { body, status: init.status || 200, headers: init.headers || {} }
}

function query(result) {
  return {
    select() { return this },
    eq() { return this },
    neq() { return this },
    async maybeSingle() { return result },
  }
}

function loadDisconnectRoute({
  rpc,
  revoke,
  accountResult = { data: { id: ACCOUNT_ID, status: 'active' }, error: null },
  tokenResult = { data: { revocation_status: 'active' }, error: null },
}) {
  const userClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1' } }, error: null }
      },
    },
    from(table) {
      assert.equal(table, 'tiktok_accounts')
      return query(accountResult)
    },
  }
  const admin = {
    rpc,
    from(table) {
      assert.equal(table, 'tiktok_account_tokens')
      return query(tokenResult)
    },
  }
  return loadTsModule(
    path.join(process.cwd(), 'src/app/api/publish/accounts/[id]/route.ts'),
    {
      'next/server': { NextResponse: { json: jsonResponse } },
      '@/lib/supabase/server': { createClient: async () => userClient },
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/tiktok/account-groups': { isUuid: () => true, mapAccountGroupError: (error) => error },
      '@/lib/tiktok/demo-account-groups': {
        isTikTokGroupsDemoMode: () => false,
        deleteDemoAccount() { throw new Error('not demo') },
      },
      '@/lib/tiktok/oauth': {
        getTikTokRevocationWriteOutcome(error) {
          return error?.providerWriteOutcome || 'unknown'
        },
        revokeAccessToken: revoke,
      },
    },
    { console: { ...console, error() {} } },
  )
}

function request(confirmUnknown = false) {
  return { nextUrl: new URL(`https://app.test/account${confirmUnknown ? '?confirmUnknown=true' : ''}`) }
}

test('normal disconnect revokes once and retains account/task history through atomic completion', async () => {
  const calls = []
  let providerCalls = 0
  const route = loadDisconnectRoute({
    rpc: async (name) => {
      calls.push(name)
      if (name === 'begin_tiktok_account_revocation') {
        return { data: [{ access_token: 'secure-token', previous_error_code: null }], error: null }
      }
      if (name === 'complete_tiktok_account_revocation') return { data: true, error: null }
      throw new Error(`unexpected rpc ${name}`)
    },
    revoke: async (token) => {
      providerCalls += 1
      assert.equal(token, 'secure-token')
    },
  })

  const response = await route.DELETE(request(), { params: Promise.resolve({ id: ACCOUNT_ID }) })
  assert.equal(response.status, 200)
  assert.equal(response.body.disconnected, true)
  assert.equal(providerCalls, 1)
  assert.deepEqual(calls, ['begin_tiktok_account_revocation', 'complete_tiktok_account_revocation'])
  assert.doesNotMatch(
    fs.readFileSync('src/app/api/publish/accounts/[id]/route.ts', 'utf8'),
    /\.from\(['"]tiktok_accounts['"]\)[\s\S]{0,120}\.delete\(\)/,
  )
})

test('Business comment authorization blocks publishing disconnect before provider access', async () => {
  let providerCalls = 0
  const route = loadDisconnectRoute({
    rpc: async () => ({
      data: null,
      error: { code: 'P0001', message: 'business_authorization_present' },
    }),
    revoke: async () => { providerCalls += 1 },
  })

  const response = await route.DELETE(request(), { params: Promise.resolve({ id: ACCOUNT_ID }) })
  assert.equal(response.status, 409)
  assert.equal(response.body.code, 'comment_authorization_must_disconnect_first')
  assert.equal(providerCalls, 0)
})

test('unfinished publishing work blocks account revocation before provider access', async () => {
  let providerCalls = 0
  const route = loadDisconnectRoute({
    rpc: async () => ({
      data: null,
      error: { code: '55000', message: 'active_publish_task' },
    }),
    revoke: async () => { providerCalls += 1 },
  })

  const response = await route.DELETE(request(), { params: Promise.resolve({ id: ACCOUNT_ID }) })
  assert.equal(response.status, 409)
  assert.equal(response.body.code, 'active_publish_task')
  assert.equal(providerCalls, 0)
})

test('foreign or Shop account fails before service-role claim and provider revoke', async () => {
  let rpcCalls = 0
  let providerCalls = 0
  const route = loadDisconnectRoute({
    accountResult: { data: null, error: null },
    rpc: async () => {
      rpcCalls += 1
      throw new Error('must not run')
    },
    revoke: async () => { providerCalls += 1 },
  })

  const response = await route.DELETE(request(), { params: Promise.resolve({ id: ACCOUNT_ID }) })
  assert.equal(response.status, 404)
  assert.equal(rpcCalls, 0)
  assert.equal(providerCalls, 0)
})

test('unknown provider outcome is durable and cannot blindly revoke twice', async () => {
  let previousErrorCode = null
  let providerCalls = 0
  const calls = []
  const route = loadDisconnectRoute({
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'begin_tiktok_account_revocation') {
        return {
          data: [{ access_token: 'secure-token', previous_error_code: previousErrorCode }],
          error: null,
        }
      }
      if (name === 'defer_tiktok_account_revocation') {
        previousErrorCode = args.p_error_code
        return { data: true, error: null }
      }
      if (name === 'complete_tiktok_account_revocation') return { data: true, error: null }
      throw new Error(`unexpected rpc ${name}`)
    },
    revoke: async () => {
      providerCalls += 1
      const error = new Error('transport secret')
      error.providerWriteOutcome = 'unknown'
      throw error
    },
  })

  const first = await route.DELETE(request(), { params: Promise.resolve({ id: ACCOUNT_ID }) })
  assert.equal(first.status, 503)
  assert.equal(providerCalls, 1)

  const retry = await route.DELETE(request(), { params: Promise.resolve({ id: ACCOUNT_ID }) })
  assert.equal(retry.status, 409)
  assert.equal(retry.body.code, 'revocation_confirmation_required')
  assert.equal(providerCalls, 1)

  const confirmed = await route.DELETE(request(true), { params: Promise.resolve({ id: ACCOUNT_ID }) })
  assert.equal(confirmed.status, 200)
  assert.equal(providerCalls, 1)
  assert.equal(calls.at(-2).args.p_manual_confirmation, true)
})

test('lost completion response converges from missing secure token without another revoke', async () => {
  let providerCalls = 0
  const route = loadDisconnectRoute({
    rpc: async (name) => {
      if (name === 'begin_tiktok_account_revocation') {
        return { data: [{ access_token: 'secure-token', previous_error_code: null }], error: null }
      }
      if (name === 'complete_tiktok_account_revocation') {
        return { data: null, error: { code: 'network', message: 'response lost' } }
      }
      if (name === 'defer_tiktok_account_revocation') return { data: false, error: null }
      throw new Error(`unexpected rpc ${name}`)
    },
    revoke: async () => { providerCalls += 1 },
    tokenResult: { data: null, error: null },
  })

  const response = await route.DELETE(request(), { params: Promise.resolve({ id: ACCOUNT_ID }) })
  assert.equal(response.status, 200)
  assert.equal(response.body.disconnected, true)
  assert.equal(providerCalls, 1)
})

test('migration retains publish evidence and fences refresh/rebind during revocation', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/20260909_tiktok_account_disconnect_hardening.sql',
    'utf8',
  )
  assert.match(sql, /SET status = 'revoked',[\s\S]+group_id = NULL/)
  assert.match(sql, /DELETE FROM public\.tiktok_account_tokens/)
  assert.doesNotMatch(sql, /DELETE FROM public\.publish_task_items/)
  assert.doesNotMatch(sql, /DELETE FROM public\.tiktok_accounts/)
  assert.match(sql, /account_row\.status = 'active'/)
  assert.match(sql, /token_row\.revocation_status = 'active'/)
  assert.match(sql, /TikTok account revocation must finish before reauthorization/)
  assert.match(sql, /business_authorization_present/)
  assert.match(sql, /guard_normal_tiktok_account_hard_delete/)
  assert.match(sql, /publishing_disconnect_completed_at = clock_timestamp\(\)/)
  assert.match(sql, /publishing_disconnect_method = CASE/)
  assert.match(sql, /clear_tiktok_disconnect_receipt_on_rebind/)
  assert.match(sql, /has_active_tiktok_group_task/)
  assert.match(sql, /RAISE EXCEPTION 'ACTIVE_GROUP_TASK'/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.validate_publish_task_item_account_owner/)
  assert.match(sql, /account_status IS DISTINCT FROM 'active'/)
  assert.match(sql, /FOR KEY SHARE/)
  assert.match(sql, /BEFORE INSERT OR UPDATE OF task_id, account_id, status/)
  assert.match(sql, /item\.status IN \('pending', 'scheduled', 'processing', 'uploading'\)/)
  assert.match(sql, /'TIKTOK_INIT_OUTCOME_UNKNOWN'/)
  assert.match(sql, /'WORKER_INTERRUPTED_NEEDS_REVIEW'/)
  assert.match(sql, /RAISE EXCEPTION 'active_publish_task'/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.guard_normal_tiktok_account_status_write/)
  assert.match(sql, /OLD\.publishing_disconnect_completed_at IS DISTINCT FROM NEW\.publishing_disconnect_completed_at/)
  assert.match(sql, /OLD\.publishing_disconnect_method IS DISTINCT FROM NEW\.publishing_disconnect_method/)
  assert.match(sql, /COALESCE\(auth\.role\(\), ''\) = 'authenticated'/)
  assert.match(sql, /RAISE EXCEPTION 'normal_tiktok_account_status_is_server_managed'/)
})

test('generic retry rejects revoked accounts before resetting failed work', () => {
  const route = fs.readFileSync('src/app/api/publish/tasks/[id]/retry/route.ts', 'utf8')
  const accountLookup = route.slice(route.indexOf(".from('tiktok_accounts')"))
  assert.match(accountLookup, /\.eq\('account_type', 'normal'\)[\s\S]{0,120}\.eq\('status', 'active'\)/)
})

test('comment account discovery hides revoked publishing tombstones', () => {
  const service = fs.readFileSync('src/lib/social-comments/service.ts', 'utf8')
  const accountDiscovery = service.slice(service.indexOf('export async function getSocialCommentAccounts'))
  const tiktokLookupStart = accountDiscovery.indexOf(".from('tiktok_accounts')")
  const tiktokLookup = accountDiscovery.slice(tiktokLookupStart, tiktokLookupStart + 500)
  assert.match(tiktokLookup, /\.eq\('account_type', 'normal'\)[\s\S]{0,120}\.eq\('status', 'active'\)/)
})

test('callback never reflects provider error_description and count sanitizer rejects malformed stats', () => {
  const callback = fs.readFileSync('src/app/api/tiktok/auth/callback/route.ts', 'utf8')
  assert.doesNotMatch(callback, /searchParams\.get\(['"]error_description['"]\)/)
  assert.match(callback, /safeProviderErrorMessage/)

  const binding = loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/account-binding.ts'),
    {
      '@/lib/tiktok/oauth': {},
      '@/lib/tiktok/types': {},
      '@/types/database': {},
    },
  )
  assert.equal(binding.safeTikTokCount(12), 12)
  assert.equal(binding.safeTikTokCount(-1), 0)
  assert.equal(binding.safeTikTokCount(Number.MAX_SAFE_INTEGER + 1), 0)
  assert.equal(binding.safeTikTokCount('12'), 0)
})

test('group mutation guard closes the active-task check/RPC race with a database trigger', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/20260909_tiktok_account_disconnect_hardening.sql',
    'utf8',
  )
  const guard = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.guard_tiktok_account_group_change'))
  assert.match(guard, /OLD\.group_id IS DISTINCT FROM NEW\.group_id/)
  assert.match(guard, /public\.has_active_tiktok_group_task\(v_guard_group_id, OLD\.user_id\)/)
  assert.match(guard, /RAISE EXCEPTION 'ACTIVE_GROUP_TASK'/)

  const groups = loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/account-groups.ts'),
  )
  assert.deepEqual(
    { ...groups.mapAccountGroupError({ message: 'ACTIVE_GROUP_TASK' }) },
    { status: 409, message: '该账号组已有未完成任务，请等待完成后再调整账号' },
  )
})

test('new account list remains readable before the disconnect migration is installed', () => {
  const route = fs.readFileSync('src/app/api/publish/accounts/route.ts', 'utf8')
  assert.match(route, /isMissingPublishingDisconnectMigration/)
  assert.match(route, /error\.code === '42703' \|\| error\.code === 'PGRST204'/)
  assert.match(route, /message\.includes\('revocation_status'\)/)
})
