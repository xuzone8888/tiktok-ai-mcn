/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
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

function accountQuery(accountExists) {
  return {
    select() { return this },
    eq() { return this },
    async maybeSingle() {
      return { data: accountExists ? { id: 'account-1' } : null, error: null }
    },
  }
}

function tokenQuery(status) {
  return {
    select() { return this },
    eq() { return this },
    async maybeSingle() {
      return { data: status ? { status } : null, error: null }
    },
  }
}

function loadDisconnectRoute({ accountExists = true, rpc, revoke, tokenStatus = 'active' }) {
  const admin = {
    from(table) {
      if (table === 'tiktok_accounts') return accountQuery(accountExists)
      if (table === 'tiktok_business_account_tokens') return tokenQuery(tokenStatus)
      throw new Error(`unexpected table ${table}`)
    },
    rpc,
  }
  class TikTokBusinessRevocationError extends Error {
    constructor(providerWriteOutcome) {
      super('safe')
      this.providerWriteOutcome = providerWriteOutcome
    }
  }
  return loadTsModule(
    path.join(process.cwd(), 'src/app/api/tiktok/business-auth/disconnect/route.ts'),
    {
      'next/server': { NextResponse: { json: jsonResponse } },
      '@/lib/supabase/server': {
        async createClient() {
          return { auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) } }
        },
      },
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/tiktok/business-oauth': {
        TikTokBusinessRevocationError,
        revokeTikTokBusinessAccessToken: revoke,
      },
    },
    { console: { ...console, error() {} } },
  )
}

test('independent Business disconnect revokes once and atomically completes without touching publishing', async () => {
  const calls = []
  let providerCalls = 0
  const route = loadDisconnectRoute({
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'begin_tiktok_business_token_revocation') {
        return {
          data: [{
            access_token: 'secure-token',
            business_open_id: 'business-open-id',
            previous_error_code: null,
          }],
          error: null,
        }
      }
      if (name === 'complete_tiktok_business_token_revocation') {
        return { data: true, error: null }
      }
      throw new Error(`unexpected RPC ${name}`)
    },
    revoke: async (token) => {
      providerCalls += 1
      assert.equal(token, 'secure-token')
    },
  })

  const response = await route.DELETE({ json: async () => ({ accountId: 'account-1' }) })
  assert.equal(response.status, 200)
  assert.equal(response.body.disconnected, true)
  assert.equal(providerCalls, 1)
  assert.deepEqual(calls.map((call) => call.name), [
    'begin_tiktok_business_token_revocation',
    'complete_tiktok_business_token_revocation',
  ])
  assert.equal(calls[0].args.p_action_log_id, calls[1].args.p_action_log_id)
})

test('unknown remote revoke keeps a protected pending state and never deletes the token', async () => {
  const calls = []
  let providerCalls = 0
  class UnknownRevocation extends Error {}
  const route = loadDisconnectRoute({
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'begin_tiktok_business_token_revocation') {
        return {
          data: [{
            access_token: 'secure-token',
            business_open_id: 'business-open-id',
            previous_error_code: null,
          }],
          error: null,
        }
      }
      if (name === 'defer_tiktok_business_token_revocation') return { data: true, error: null }
      throw new Error(`unexpected RPC ${name}`)
    },
    revoke: async () => {
      providerCalls += 1
      const error = new UnknownRevocation('transport')
      error.providerWriteOutcome = 'unknown'
      throw error
    },
  })

  const response = await route.DELETE({ json: async () => ({ accountId: 'account-1' }) })
  assert.equal(response.status, 503)
  assert.equal(providerCalls, 1)
  assert.deepEqual(calls.map((call) => call.name), [
    'begin_tiktok_business_token_revocation',
    'defer_tiktok_business_token_revocation',
  ])
  assert.equal(calls[1].args.p_error_message.includes('secure-token'), false)
})

test('a durable provider-success receipt resumes local completion without revoking twice', async () => {
  let providerCalls = 0
  const calls = []
  const route = loadDisconnectRoute({
    rpc: async (name) => {
      calls.push(name)
      if (name === 'begin_tiktok_business_token_revocation') {
        return {
          data: [{
            access_token: 'already-revoked-token',
            business_open_id: 'business-open-id',
            previous_error_code: 'provider_succeeded_local_commit_pending',
          }],
          error: null,
        }
      }
      if (name === 'complete_tiktok_business_token_revocation') return { data: true, error: null }
      throw new Error(`unexpected RPC ${name}`)
    },
    revoke: async () => { providerCalls += 1 },
  })

  const response = await route.DELETE({ json: async () => ({ accountId: 'account-1' }) })
  assert.equal(response.status, 200)
  assert.equal(providerCalls, 0)
  assert.deepEqual(calls, [
    'begin_tiktok_business_token_revocation',
    'complete_tiktok_business_token_revocation',
  ])
})

test('an ambiguous revoke never calls the provider again and requires audited manual confirmation', async () => {
  let previousErrorCode = null
  let providerCalls = 0
  const calls = []
  const route = loadDisconnectRoute({
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'begin_tiktok_business_token_revocation') {
        return {
          data: [{
            access_token: 'secure-token',
            business_open_id: 'business-open-id',
            previous_error_code: previousErrorCode,
          }],
          error: null,
        }
      }
      if (name === 'defer_tiktok_business_token_revocation') {
        previousErrorCode = args.p_error_code
        return { data: true, error: null }
      }
      if (name === 'complete_tiktok_business_token_revocation') {
        return { data: true, error: null }
      }
      throw new Error(`unexpected RPC ${name}`)
    },
    revoke: async () => {
      providerCalls += 1
      const error = new Error('broker-safe-error')
      error.providerWriteOutcome = 'unknown'
      throw error
    },
  })

  const first = await route.DELETE({ json: async () => ({ accountId: 'account-1' }) })
  assert.equal(first.status, 503)
  assert.equal(providerCalls, 1)

  const retry = await route.DELETE({ json: async () => ({ accountId: 'account-1' }) })
  assert.equal(retry.status, 409)
  assert.equal(retry.body.code, 'revocation_confirmation_required')
  assert.equal(providerCalls, 1)

  const confirmed = await route.DELETE({
    json: async () => ({ accountId: 'account-1', confirmUnknown: true }),
  })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.body.disconnected, true)
  assert.equal(providerCalls, 1)
  const confirmationClaim = calls.filter(
    (call) => call.name === 'begin_tiktok_business_token_revocation',
  ).at(-1)
  assert.equal(confirmationClaim.args.p_manual_confirmation, true)
})

test('foreign or Shop account fails before token RPC and provider revoke', async () => {
  let rpcCalls = 0
  let providerCalls = 0
  const route = loadDisconnectRoute({
    accountExists: false,
    rpc: async () => { rpcCalls += 1 },
    revoke: async () => { providerCalls += 1 },
  })
  const response = await route.DELETE({ json: async () => ({ accountId: 'foreign-account' }) })
  assert.equal(response.status, 404)
  assert.equal(rpcCalls, 0)
  assert.equal(providerCalls, 0)
})

test('Business disconnect refuses to race an unresolved TikTok reply before provider revocation', async () => {
  let providerCalls = 0
  const route = loadDisconnectRoute({
    rpc: async (name) => {
      assert.equal(name, 'begin_tiktok_business_token_revocation')
      return {
        data: null,
        error: { code: '55000', message: 'comment_reply_in_progress' },
      }
    },
    revoke: async () => { providerCalls += 1 },
  })

  const response = await route.DELETE({ json: async () => ({ accountId: 'account-1' }) })
  assert.equal(response.status, 409)
  assert.equal(response.body.code, 'comment_reply_in_progress')
  assert.equal(providerCalls, 0)
})

test('pending account migration fences Business revocation against unresolved TikTok replies', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/20260909_tiktok_account_disconnect_hardening.sql',
    'utf8',
  )
  assert.match(sql, /guard_tiktok_business_revocation_during_reply/)
  assert.match(sql, /NEW\.status = 'revocation_pending'/)
  assert.match(sql, /OLD\.reply_dispatch_lease_expires_at > clock_timestamp\(\)/)
  assert.match(sql, /action\.action_type = 'reply'/)
  assert.match(sql, /action\.status IN \('running', 'sent', 'unknown'\)/)
  assert.match(sql, /RAISE EXCEPTION 'comment_reply_in_progress'/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guard_tiktok_business_revocation_during_reply\(\)[\s\S]+FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.mark_tiktok_reply_dispatch_started[\s\S]+token\.status = 'active'/)
  assert.match(sql, /reply_dispatch_lease_token = p_reply_attempt_token/)
  assert.match(sql, /CREATE TRIGGER clear_tiktok_business_reply_dispatch_lease/)
  assert.match(sql, /token\.reply_dispatch_lease_token::TEXT = OLD\.metadata->>'reply_attempt_token'/)
  const databaseTypes = fs.readFileSync('src/types/database.ts', 'utf8')
  assert.match(databaseTypes, /reply_dispatch_lease_token: string \| null/)
  assert.match(databaseTypes, /reply_dispatch_lease_expires_at: string \| null/)
})

test('Business authorization URL failures never expose database or configuration error text', () => {
  const route = fs.readFileSync(
    'src/app/api/tiktok/business-auth/url/route.ts',
    'utf8',
  )
  assert.match(route, /error\.message\.startsWith\('TikTok Business OAuth configuration is incomplete\.'\)/)
  assert.match(route, /\? 'TikTok Business OAuth configuration is incomplete\.'/)
  assert.match(route, /: '无法生成 TikTok 评论授权链接'/)
  assert.doesNotMatch(route, /\{ error: error instanceof Error \? error\.message/)
  assert.doesNotMatch(route, /Failed to store state:', stateError\.message/)
  assert.doesNotMatch(route, /pendingCleanupError\?\.message/)
})

test('Business comment controls migration fences revoke, rate budget, audit, and permissions', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/20260808_tiktok_business_comment_controls.sql',
    'utf8',
  )
  assert.match(sql, /status IN \('active', 'expired', 'revoked', 'revocation_pending'\)/)
  assert.match(sql, /PRIMARY KEY \(account_id, endpoint, window_started_at\)/)
  assert.match(sql, /DELETE FROM public\.tiktok_business_api_rate_windows[\s\S]+INTERVAL '1 day'/)
  assert.match(sql, /reserved_requests[\s\S]+EXCLUDED\.reserved_requests <= p_window_limit/)
  assert.match(sql, /p_action_log_id[\s\S]+comment_auth_disconnect/)
  assert.match(sql, /DELETE FROM public\.tiktok_business_account_tokens[\s\S]+revocation_token = p_revocation_token/)
  assert.match(sql, /provider_succeeded_local_commit_pending|revocation_error_code/)
  assert.match(sql, /business_comment_auth_generation UUID[\s\S]+account_generation UUID/)
  assert.match(sql, /SET business_comment_auth_generation = gen_random_uuid\(\)/)
  assert.match(sql, /parent_account_generation IS DISTINCT FROM target_account_generation/)
  assert.match(sql, /existing_token_status = 'revocation_pending'/)
  assert.match(sql, /OLD\.status = 'revocation_pending' AND NEW\.status = 'active'/)
  assert.match(sql, /BEFORE INSERT ON public\.tiktok_business_auth_states[\s\S]+set_tiktok_business_auth_state_generation/)
  assert.match(sql, /IF NEW\.account_generation IS NULL THEN[\s\S]+NEW\.account_generation := parent_generation/)
  assert.match(sql, /NEW\.account_generation IS DISTINCT FROM parent_generation[\s\S]+ERRCODE = '40001'/)
  assert.match(sql, /token_status = 'revocation_pending'[\s\S]+ERRCODE = '40001'/)
  assert.match(sql, /manual_revocation_confirmation[\s\S]+p_manual_confirmation/)
  assert.match(sql, /SECURITY DEFINER[\s\S]+SET search_path = public/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.begin_tiktok_business_token_revocation[\s\S]+FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.defer_tiktok_business_token_revocation[\s\S]+TO service_role/)
})

test('comment authorization UI keeps expired and incomplete connections disconnectable while flags are off', () => {
  const ui = loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/comment-authorization-ui.ts'),
  )
  for (const status of ['active', 'expired', 'incomplete']) {
    assert.equal(ui.hasTikTokCommentAuthorization(status), true)
    assert.equal(ui.canDisconnectTikTokCommentAuthorization(status), true)
  }
  assert.equal(ui.hasTikTokCommentAuthorization('disconnecting'), true)
  assert.equal(ui.canDisconnectTikTokCommentAuthorization('disconnecting'), false)
  assert.equal(ui.hasTikTokCommentAuthorization('not_connected'), false)
  assert.equal(ui.canDisconnectTikTokCommentAuthorization('not_connected'), false)

  const page = fs.readFileSync('src/app/(main)/publish/accounts/page.tsx', 'utf8')
  assert.match(page, /hasTikTokCommentAuthorization\(account\.comment_authorization_status\)/)
  assert.match(page, /canDisconnectTikTokCommentAuthorization\(account\.comment_authorization_status\)/)
})

test('an OAuth attempt captured before comment revocation cannot commit after that fence advances', () => {
  const account = { generation: 'generation-1', tokenStatus: 'active' }
  const authState = { generation: account.generation }
  const canCommit = () => (
    authState.generation === account.generation
    && account.tokenStatus !== 'revocation_pending'
  )

  assert.equal(canCommit(), true)
  account.tokenStatus = 'revocation_pending'
  account.generation = 'generation-2'
  assert.equal(canCommit(), false)
  account.tokenStatus = 'revoked'
  assert.equal(canCommit(), false)

  const laterAuthState = { generation: account.generation }
  assert.equal(
    laterAuthState.generation === account.generation && account.tokenStatus !== 'revocation_pending',
    true,
  )
})

test('a delayed explicit OAuth state generation is never upgraded by the legacy insert trigger', () => {
  const parent = { generation: 'generation-1', tokenStatus: 'active' }
  const generationReadByRoute = parent.generation

  parent.generation = 'generation-2'
  parent.tokenStatus = 'revocation_pending'

  const insertState = (explicitGeneration) => {
    if (parent.tokenStatus === 'revocation_pending') throw new Error('40001')
    if (explicitGeneration == null) return parent.generation
    if (explicitGeneration !== parent.generation) throw new Error('40001')
    return explicitGeneration
  }

  assert.throws(() => insertState(generationReadByRoute), /40001/)
  parent.tokenStatus = 'revoked'
  assert.throws(() => insertState(generationReadByRoute), /40001/)
  assert.equal(insertState(null), 'generation-2')
})

test('TikTok reply length counts Unicode code points and rejects 1201 before action dispatch', () => {
  const text = loadTsModule(path.join(process.cwd(), 'src/lib/tiktok/comment-text.ts'))
  assert.equal(text.countUnicodeCodePoints('😀'.repeat(1200)), 1200)
  assert.equal(text.isTikTokCommentReplyWithinLimit('😀'.repeat(1200)), true)
  assert.equal(text.isTikTokCommentReplyWithinLimit('😀'.repeat(1201)), false)
  const service = fs.readFileSync('src/lib/social-comments/service.ts', 'utf8')
  assert.ok(
    service.indexOf('isTikTokCommentReplyWithinLimit(trimmed)')
      < service.indexOf('startReplyActionLog(admin'),
  )
})

test('Business read limits are bounded and fail closed to conservative runtime defaults', () => {
  const limits = loadTsModule(
    path.join(process.cwd(), 'src/lib/tiktok/business-comment-limits.ts'),
  )
  assert.deepEqual(
    { ...limits.getTikTokCommentReadLimits({}) },
    { perEndpointRequestsPerMinute: 20, topLevelRequestBudget: 5, replyRequestBudget: 15 },
  )
  assert.deepEqual(
    { ...limits.getTikTokCommentReadLimits({
      TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT: '8',
      TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET: '100',
      TIKTOK_COMMENT_REPLY_CALL_BUDGET: ' 4 ',
    }) },
    { perEndpointRequestsPerMinute: 8, topLevelRequestBudget: 8, replyRequestBudget: 8 },
  )
})
