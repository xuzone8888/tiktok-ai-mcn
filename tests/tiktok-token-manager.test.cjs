const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const refreshCalls = []
let refreshHandler = async () => {
  throw new Error('refresh handler was not configured')
}

function transpileModule(filename, stubs = {}) {
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
    exports: loadedModule.exports,
    module: loadedModule,
    require(request) {
      if (request in stubs) return stubs[request]
      return require(request)
    },
    console,
    Date,
    Map,
    Set,
    WeakSet,
    Promise,
    setTimeout,
    clearTimeout,
  }, { filename })
  return loadedModule.exports
}

function loadTokenManager() {
  return transpileModule(
    path.join(process.cwd(), 'src/lib/tiktok/token-manager.ts'),
    {
      '@/lib/tiktok/oauth': {
        calculateTokenExpiration(seconds) {
          return new Date(Date.UTC(2030, 0, 1) + seconds * 1000)
        },
        async refreshAccessToken(refreshToken) {
          refreshCalls.push(refreshToken)
          return refreshHandler(refreshToken)
        },
      },
    }
  )
}

function createStatefulSupabase({
  accounts = [],
  tokens = [],
  tokenSelectError = null,
  commitError = null,
  claimError = null,
  missingRpcNames = [],
  syncTrigger = true,
} = {}) {
  const state = {
    accounts: accounts.map((row) => ({ ...row })),
    tokens: tokens.map((row) => ({ ...row })),
    leases: new Map(),
    nowMs: Date.UTC(2030, 0, 1),
  }
  const calls = []

  function matches(row, filters) {
    return filters.every((filter) => {
      if (filter.kind === 'eq') return row[filter.column] === filter.value
      if (filter.kind === 'in') return filter.values.includes(row[filter.column])
      return true
    })
  }

  function syncAccountToken(account) {
    const tokenIndex = state.tokens.findIndex((row) => row.account_id === account.id)
    if (account.account_type !== 'normal') {
      if (tokenIndex >= 0) state.tokens.splice(tokenIndex, 1)
      state.leases.delete(account.id)
      return
    }
    const existingToken = tokenIndex >= 0 ? state.tokens[tokenIndex] : null
    const mirrored = {
      account_id: account.id,
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      access_token_expires_at: account.access_token_expires_at ?? null,
      refresh_token_expires_at:
        account.token_expires_at ?? account.refresh_token_expires_at ?? null,
      updated_at: account.updated_at ?? null,
      managed_writes_only: existingToken?.managed_writes_only ?? false,
      compatibility_write_key:
        existingToken?.compatibility_write_key ?? `compatibility-${account.id}`,
    }
    if (tokenIndex >= 0) state.tokens[tokenIndex] = mirrored
    else state.tokens.push(mirrored)
    state.leases.delete(account.id)
  }

  class Query {
    constructor(table) {
      this.table = table
      this.operation = 'select'
      this.filters = []
      this.payload = null
      this.returning = false
    }

    select(fields) {
      calls.push({ operation: 'select', table: this.table, fields })
      this.returning = this.operation === 'update'
      return this
    }

    update(payload) {
      calls.push({ operation: 'update', table: this.table, payload })
      this.operation = 'update'
      this.payload = payload
      return this
    }

    eq(column, value) {
      calls.push({ operation: 'eq', table: this.table, column, value })
      this.filters.push({ kind: 'eq', column, value })
      return this
    }

    in(column, values) {
      calls.push({ operation: 'in', table: this.table, column, values: [...values] })
      this.filters.push({ kind: 'in', column, values: [...values] })
      return this
    }

    is(column, value) {
      calls.push({ operation: 'is', table: this.table, column, value })
      this.filters.push({ kind: 'eq', column, value })
      return this
    }

    maybeSingle() {
      return this.execute(true)
    }

    execute(single = false) {
      if (this.operation === 'select') {
        if (this.table === 'tiktok_account_tokens' && tokenSelectError) {
          return Promise.resolve({ data: null, error: tokenSelectError })
        }
        const rows = this.table === 'tiktok_accounts' ? state.accounts : state.tokens
        const result = rows.filter((row) => matches(row, this.filters)).map((row) => ({ ...row }))
        return Promise.resolve({ data: single ? result[0] ?? null : result, error: null })
      }

      if (this.table !== 'tiktok_accounts') {
        throw new Error(`Unexpected update table: ${this.table}`)
      }
      const updated = []
      for (const account of state.accounts) {
        if (!matches(account, this.filters)) continue
        const token = state.tokens.find((row) => row.account_id === account.id)
        if (
          syncTrigger
          && Object.hasOwn(this.payload, 'account_type')
          && this.payload.account_type !== account.account_type
        ) {
          return Promise.resolve({
            data: null,
            error: {
              code: '23514',
              message: 'TikTok account type cannot be changed after binding',
            },
          })
        }
        const writeFence = this.payload.token_write_fence
        if (
          syncTrigger
          && token?.managed_writes_only
          && (
            !writeFence
            || (
              writeFence !== token.compatibility_write_key
              && writeFence !== state.leases.get(account.id)?.token
            )
          )
        ) {
          return Promise.resolve({
            data: null,
            error: { code: '40001', message: 'unfenced legacy TikTok token write rejected' },
          })
        }
        if (token && writeFence === token.compatibility_write_key) {
          token.managed_writes_only = true
        }
        const persistedPayload = { ...this.payload }
        delete persistedPayload.token_write_fence
        Object.assign(account, persistedPayload, { token_write_fence: null })
        updated.push({ id: account.id })
        if (syncTrigger) syncAccountToken(account)
      }
      return Promise.resolve({
        data: single ? updated[0] ?? null : (this.returning ? updated : null),
        error: null,
      })
    }

    then(resolve, reject) {
      return this.execute().then(resolve, reject)
    }
  }

  const supabase = {
    calls,
    state,
    from(table) {
      return new Query(table)
    },
    async rpc(name, args) {
      calls.push({ operation: 'rpc', name, args })
      if (missingRpcNames.includes(name)) {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: `Could not find the function public.${name} in the schema cache`,
          },
        }
      }
      if (name === 'claim_tiktok_token_refresh') {
        if (claimError) return { data: null, error: claimError }
        const account = state.accounts.find((row) => row.id === args.p_account_id)
        const token = state.tokens.find((row) => row.account_id === args.p_account_id)
        const activeLease = state.leases.get(args.p_account_id)
        if (
          !account
          || account.account_type !== 'normal'
          || !token
          || token.refresh_token !== args.p_expected_refresh_token
          || activeLease?.expiresAt > state.nowMs
        ) {
          return { data: false, error: null }
        }
        state.leases.set(args.p_account_id, {
          token: args.p_lease_token,
          expiresAt: state.nowMs + args.p_lease_seconds * 1000,
        })
        token.managed_writes_only = true
        return { data: true, error: null }
      }
      if (name === 'release_tiktok_token_refresh') {
        const released = state.leases.get(args.p_account_id)?.token === args.p_lease_token
        if (released) state.leases.delete(args.p_account_id)
        return { data: released, error: null }
      }
      if (name === 'commit_tiktok_token_refresh') {
        if (commitError) return { data: null, error: commitError }
        const account = state.accounts.find((row) => row.id === args.p_account_id)
        const token = state.tokens.find((row) => row.account_id === args.p_account_id)
        const ownsLease = state.leases.get(args.p_account_id)?.token === args.p_lease_token
        if (
          !account
          || account.account_type !== 'normal'
          || !token
          || account.refresh_token !== args.p_expected_refresh_token
          || token.refresh_token !== args.p_expected_refresh_token
          || !ownsLease
        ) {
          return { data: false, error: null }
        }
        Object.assign(account, {
          access_token: args.p_access_token,
          refresh_token: args.p_refresh_token,
          access_token_expires_at: args.p_access_token_expires_at,
          token_expires_at: args.p_refresh_token_expires_at,
          refresh_token_expires_at: args.p_refresh_token_expires_at,
          updated_at: args.p_updated_at,
        })
        if (syncTrigger) syncAccountToken(account)
        return { data: true, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
    legacyWrite(accountId, patch) {
      const account = state.accounts.find((row) => row.id === accountId)
      const token = state.tokens.find((row) => row.account_id === accountId)
      if (token?.managed_writes_only) return false
      Object.assign(account, patch)
      if (syncTrigger) syncAccountToken(account)
      return true
    },
    advanceTime(ms) {
      state.nowMs += ms
    },
  }

  return supabase
}

function normalAccount(id, overrides = {}) {
  return {
    id,
    account_type: 'normal',
    access_token: `legacy-access-${id}`,
    refresh_token: `legacy-refresh-${id}`,
    access_token_expires_at: '2020-01-01T00:00:00.000Z',
    token_expires_at: '2099-01-01T00:00:00.000Z',
    refresh_token_expires_at: null,
    updated_at: '2030-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function tokenRow(id, overrides = {}) {
  return {
    account_id: id,
    access_token: `secure-access-${id}`,
    refresh_token: `secure-refresh-${id}`,
    access_token_expires_at: '2020-01-01T00:00:00.000Z',
    refresh_token_expires_at: '2099-01-01T00:00:00.000Z',
    updated_at: '2030-01-01T00:00:00.000Z',
    managed_writes_only: false,
    compatibility_write_key: `compatibility-${id}`,
    ...overrides,
  }
}

function refreshedResponse(suffix = 'new') {
  return {
    access_token: `access-${suffix}`,
    refresh_token: `refresh-${suffix}`,
    expires_in: 3600,
    refresh_expires_in: 7200,
    open_id: 'open-1',
    scope: 'video.publish',
    token_type: 'Bearer',
  }
}

test('normal parent validation runs before service-only token lookup and secure storage wins', async () => {
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-1')],
    tokens: [tokenRow('account-1')],
  })

  const token = await manager.getTikTokAccountToken(supabase, 'account-1')

  assert.equal(token.access_token, 'secure-access-account-1')
  const selects = supabase.calls.filter((call) => call.operation === 'select')
  assert.equal(selects[0].table, 'tiktok_accounts')
  assert.equal(selects[0].fields, 'id, account_type')
  assert.equal(selects[1].table, 'tiktok_account_tokens')
  assert.equal(selects.length, 2)
})

test('missing secure row or pre-migration table falls back to validated normal legacy row', async () => {
  const manager = loadTokenManager()
  for (const tokenSelectError of [
    null,
    { code: 'PGRST205', message: "Could not find tiktok_account_tokens in the schema cache" },
  ]) {
    const supabase = createStatefulSupabase({
      accounts: [normalAccount('account-2')],
      tokenSelectError,
    })
    const token = await manager.getTikTokAccountToken(supabase, 'account-2')
    assert.equal(token.access_token, 'legacy-access-account-2')
  }
})

test('Shop account IDs fail closed before secure storage reads or writes', async () => {
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('shop-1', { account_type: 'shop' })],
    tokens: [tokenRow('shop-1')],
  })

  await assert.rejects(
    manager.getTikTokAccountToken(supabase, 'shop-1'),
    /Normal TikTok account token not found/
  )
  await assert.rejects(
    manager.persistTikTokAccountToken(
      supabase,
      'shop-1',
      refreshedResponse('shop'),
      {
        expectedAccessToken: 'legacy-access-shop-1',
        expectedRefreshToken: 'legacy-refresh-shop-1',
        compatibilityWriteKey: 'compatibility-shop-1',
        leaseToken: 'shop-lease',
      }
    ),
    /lost its database lease/
  )
  assert.equal(
    supabase.calls.some((call) => call.operation === 'select' && call.table === 'tiktok_account_tokens'),
    false
  )
  assert.equal(supabase.state.tokens[0].access_token, 'secure-access-shop-1')
})

test('one legacy update is atomically mirrored and a later read cannot select stale secure data', async () => {
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-3', {
      access_token: 'secure-access-account-3',
      refresh_token: 'secure-refresh-account-3',
    })],
    tokens: [tokenRow('account-3')],
  })

  const leaseToken = '00000000-0000-4000-8000-000000000003'
  const claim = await supabase.rpc('claim_tiktok_token_refresh', {
    p_account_id: 'account-3',
    p_expected_refresh_token: 'secure-refresh-account-3',
    p_lease_token: leaseToken,
    p_lease_seconds: 30,
  })
  assert.equal(claim.data, true)
  const persisted = await manager.persistTikTokAccountToken(
    supabase,
    'account-3',
    refreshedResponse('rotated'),
    {
      expectedAccessToken: 'secure-access-account-3',
      expectedRefreshToken: 'secure-refresh-account-3',
      compatibilityWriteKey: 'compatibility-account-3',
      leaseToken,
    }
  )
  const loaded = await manager.getTikTokAccountToken(supabase, 'account-3')

  assert.equal(persisted.refresh_token, 'refresh-rotated')
  assert.equal(loaded.refresh_token, 'refresh-rotated')
  assert.equal(supabase.state.accounts[0].refresh_token, 'refresh-rotated')
  assert.equal(supabase.state.tokens[0].refresh_token, 'refresh-rotated')
  assert.equal(
    supabase.calls.some((call) => call.operation === 'upsert'),
    false
  )
})

test('failed compatibility update leaves both token copies unchanged', async () => {
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-4')],
    tokens: [tokenRow('account-4')],
    commitError: { code: '42501', message: 'permission denied' },
  })

  await assert.rejects(
    manager.persistTikTokAccountToken(
      supabase,
      'account-4',
      refreshedResponse('failed'),
      {
        expectedAccessToken: 'secure-access-account-4',
        expectedRefreshToken: 'secure-refresh-account-4',
        compatibilityWriteKey: 'compatibility-account-4',
        leaseToken: '00000000-0000-4000-8000-000000000004',
      }
    ),
    /Failed to persist TikTok token/
  )
  assert.equal(supabase.state.accounts[0].refresh_token, 'legacy-refresh-account-4')
  assert.equal(supabase.state.tokens[0].refresh_token, 'secure-refresh-account-4')
  const loaded = await manager.getTikTokAccountToken(supabase, 'account-4')
  assert.equal(loaded.refresh_token, 'secure-refresh-account-4')
})

test('an old application legacy write after backfill is transactionally visible to new readers', async () => {
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-5')],
    tokens: [tokenRow('account-5')],
  })

  const accepted = supabase.legacyWrite('account-5', {
    access_token: 'old-instance-access',
    refresh_token: 'old-instance-refresh',
  })

  assert.equal(accepted, true)
  const loaded = await manager.getTikTokAccountToken(supabase, 'account-5')
  assert.equal(loaded.access_token, 'old-instance-access')
  assert.equal(loaded.refresh_token, 'old-instance-refresh')
})

test('a delayed unfenced old-instance write cannot overwrite a managed refresh winner', async () => {
  refreshCalls.length = 0
  refreshHandler = async () => refreshedResponse('managed-winner')
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-managed', {
      access_token: 'starting-access',
      refresh_token: 'starting-refresh',
    })],
    tokens: [tokenRow('account-managed', {
      access_token: 'starting-access',
      refresh_token: 'starting-refresh',
    })],
  })

  const winnerAccess = await manager.getValidTikTokAccessToken(supabase, 'account-managed')
  const { error: oldWriteError } = await supabase
    .from('tiktok_accounts')
    .update({
      access_token: 'delayed-old-access',
      refresh_token: 'delayed-old-refresh',
      updated_at: '2030-01-01T00:00:40.000Z',
    })
    .eq('id', 'account-managed')
    .select('id')
    .maybeSingle()

  assert.equal(winnerAccess, 'access-managed-winner')
  assert.equal(oldWriteError?.code, '40001')
  assert.equal(supabase.state.accounts[0].access_token, 'access-managed-winner')
  assert.equal(supabase.state.tokens[0].refresh_token, 'refresh-managed-winner')
})

test('a delayed unfenced old-instance OAuth binding cannot replace a managed credential pair', async () => {
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-old-binding', {
      access_token: 'managed-access',
      refresh_token: 'managed-refresh',
    })],
    tokens: [tokenRow('account-old-binding', {
      access_token: 'managed-access',
      refresh_token: 'managed-refresh',
      managed_writes_only: true,
    })],
  })

  const { data, error } = await supabase
    .from('tiktok_accounts')
    .update({
      display_name: 'Delayed old binding',
      access_token: 'old-binding-access',
      refresh_token: 'old-binding-refresh',
      access_token_expires_at: '2030-01-01T01:00:00.000Z',
      token_expires_at: '2031-01-01T01:00:00.000Z',
      updated_at: '2030-01-01T00:02:00.000Z',
    })
    .eq('id', 'account-old-binding')
    .select('id')
    .maybeSingle()

  assert.equal(data, null)
  assert.equal(error?.code, '40001')
  assert.equal(supabase.state.accounts[0].display_name, undefined)
  assert.equal(supabase.state.accounts[0].access_token, 'managed-access')
  assert.equal(supabase.state.tokens[0].refresh_token, 'managed-refresh')
})

test('an owner cannot reset a managed fence through a two-step account type conversion', async () => {
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-type-reset', {
      access_token: 'managed-access',
      refresh_token: 'managed-refresh',
    })],
    tokens: [tokenRow('account-type-reset', {
      access_token: 'managed-access',
      refresh_token: 'managed-refresh',
      managed_writes_only: true,
    })],
  })

  const leaveNormal = await supabase
    .from('tiktok_accounts')
    .update({ account_type: 'business' })
    .eq('id', 'account-type-reset')
    .select('id')
    .maybeSingle()

  assert.equal(leaveNormal.data, null)
  assert.equal(leaveNormal.error?.code, '23514')
  assert.equal(supabase.state.accounts[0].account_type, 'normal')
  assert.equal(supabase.state.tokens[0].managed_writes_only, true)

  const overwriteAfterFailedReset = await supabase
    .from('tiktok_accounts')
    .update({
      access_token: 'attacker-access',
      refresh_token: 'attacker-refresh',
    })
    .eq('id', 'account-type-reset')
    .select('id')
    .maybeSingle()

  assert.equal(overwriteAfterFailedReset.data, null)
  assert.equal(overwriteAfterFailedReset.error?.code, '40001')
  assert.equal(supabase.state.tokens[0].refresh_token, 'managed-refresh')
})

test('an owner cannot convert a Shop account into the normal token path', async () => {
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('shop-type-conversion', {
      account_type: 'shop_creator',
      access_token: 'shop-access',
      refresh_token: 'shop-refresh',
    })],
  })

  const conversion = await supabase
    .from('tiktok_accounts')
    .update({ account_type: 'normal' })
    .eq('id', 'shop-type-conversion')
    .select('id')
    .maybeSingle()

  assert.equal(conversion.data, null)
  assert.equal(conversion.error?.code, '23514')
  assert.equal(supabase.state.accounts[0].account_type, 'shop_creator')
  assert.equal(supabase.state.tokens.length, 0)
})

test('a server-fenced OAuth binding can replace a managed credential pair', async () => {
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-binding-fence', {
      access_token: 'managed-access',
      refresh_token: 'managed-refresh',
    })],
    tokens: [tokenRow('account-binding-fence', {
      access_token: 'managed-access',
      refresh_token: 'managed-refresh',
      managed_writes_only: false,
    })],
  })

  const { data, error } = await supabase
    .from('tiktok_accounts')
    .update({
      access_token: 'binding-access',
      refresh_token: 'binding-refresh',
      token_write_fence: 'compatibility-account-binding-fence',
      updated_at: '2030-01-01T00:01:00.000Z',
    })
    .eq('id', 'account-binding-fence')
    .select('id')
    .maybeSingle()

  assert.equal(error, null)
  assert.equal(data.id, 'account-binding-fence')
  assert.equal(supabase.state.accounts[0].token_write_fence, null)
  assert.equal(supabase.state.tokens[0].refresh_token, 'binding-refresh')
  assert.equal(supabase.state.tokens[0].managed_writes_only, true)
})

test('two independent manager instances coordinate refresh and call TikTok only once', async () => {
  refreshCalls.length = 0
  let releaseProvider
  refreshHandler = () => new Promise((resolve) => {
    releaseProvider = () => resolve(refreshedResponse('winner'))
  })

  const managerA = loadTokenManager()
  const managerB = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-6', {
      access_token: 'expired-access',
      refresh_token: 'shared-refresh',
    })],
    tokens: [tokenRow('account-6', {
      access_token: 'expired-access',
      refresh_token: 'shared-refresh',
    })],
  })

  const first = managerA.getValidTikTokAccessToken(supabase, 'account-6')
  await new Promise((resolve) => setTimeout(resolve, 10))
  const second = managerB.getValidTikTokAccessToken(supabase, 'account-6')
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.deepEqual(refreshCalls, ['shared-refresh'])
  releaseProvider()
  const [firstAccess, secondAccess] = await Promise.all([first, second])
  assert.equal(firstAccess, 'access-winner')
  assert.equal(secondAccess, 'access-winner')
  assert.deepEqual(refreshCalls, ['shared-refresh'])
})

test('a provider response that crosses lease expiry still commits when its fence was not taken', async () => {
  refreshCalls.length = 0
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-expiry', {
      access_token: 'expired-access',
      refresh_token: 'expiry-refresh',
    })],
    tokens: [tokenRow('account-expiry', {
      access_token: 'expired-access',
      refresh_token: 'expiry-refresh',
    })],
  })
  refreshHandler = async () => {
    supabase.advanceTime(31_000)
    return refreshedResponse('after-expiry')
  }

  const accessToken = await manager.getValidTikTokAccessToken(supabase, 'account-expiry')

  assert.equal(accessToken, 'access-after-expiry')
  assert.equal(supabase.state.tokens[0].refresh_token, 'refresh-after-expiry')
})

test('an expired lease claimant that wins the row fence prevents the old worker from overwriting it', async () => {
  refreshCalls.length = 0
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-fence', {
      access_token: 'starting-access',
      refresh_token: 'starting-refresh',
    })],
    tokens: [tokenRow('account-fence', {
      access_token: 'starting-access',
      refresh_token: 'starting-refresh',
    })],
  })
  refreshHandler = async () => {
    supabase.advanceTime(31_000)
    const competitorLease = '00000000-0000-4000-8000-000000000099'
    const claim = await supabase.rpc('claim_tiktok_token_refresh', {
      p_account_id: 'account-fence',
      p_expected_refresh_token: 'starting-refresh',
      p_lease_token: competitorLease,
      p_lease_seconds: 30,
    })
    assert.equal(claim.data, true)
    const commit = await supabase.rpc('commit_tiktok_token_refresh', {
      p_account_id: 'account-fence',
      p_expected_refresh_token: 'starting-refresh',
      p_lease_token: competitorLease,
      p_access_token: 'competitor-access',
      p_refresh_token: 'competitor-refresh',
      p_access_token_expires_at: '2099-01-01T00:00:00.000Z',
      p_refresh_token_expires_at: '2099-02-01T00:00:00.000Z',
      p_updated_at: '2030-01-01T00:00:31.000Z',
    })
    assert.equal(commit.data, true)
    return refreshedResponse('stale-owner')
  }

  const accessToken = await manager.getValidTikTokAccessToken(supabase, 'account-fence')

  assert.equal(accessToken, 'competitor-access')
  assert.equal(supabase.state.tokens[0].refresh_token, 'competitor-refresh')
})

test('missing migration RPCs use only the legacy CAS compatibility path', async () => {
  refreshCalls.length = 0
  refreshHandler = async () => refreshedResponse('legacy-fallback')
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-legacy')],
    tokenSelectError: {
      code: 'PGRST205',
      message: "Could not find tiktok_account_tokens in the schema cache",
    },
    missingRpcNames: ['claim_tiktok_token_refresh'],
    syncTrigger: false,
  })

  const accessToken = await manager.getValidTikTokAccessToken(supabase, 'account-legacy')

  assert.equal(accessToken, 'access-legacy-fallback')
  assert.equal(supabase.state.accounts[0].refresh_token, 'refresh-legacy-fallback')
  assert.equal(supabase.state.tokens.length, 0)
  assert.deepEqual(refreshCalls, ['legacy-refresh-account-legacy'])
  const legacyUpdate = supabase.calls.find(
    (call) => call.operation === 'update' && call.table === 'tiktok_accounts'
  )
  assert.equal(
    Object.hasOwn(legacyUpdate.payload, 'token_write_fence'),
    false,
    'pre-migration fallback must not send a column that does not exist yet'
  )
})

test('a missing commit RPC after claim falls back to one trigger-backed legacy CAS update', async () => {
  refreshCalls.length = 0
  refreshHandler = async () => refreshedResponse('commit-cache-fallback')
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-commit-cache', {
      access_token: 'starting-access',
      refresh_token: 'starting-refresh',
    })],
    tokens: [tokenRow('account-commit-cache', {
      access_token: 'starting-access',
      refresh_token: 'starting-refresh',
    })],
    missingRpcNames: ['commit_tiktok_token_refresh'],
  })

  const accessToken = await manager.getValidTikTokAccessToken(supabase, 'account-commit-cache')

  assert.equal(accessToken, 'access-commit-cache-fallback')
  assert.equal(supabase.state.tokens[0].refresh_token, 'refresh-commit-cache-fallback')
})

test('legacy fallback CAS rejects a concurrent loser when refresh token stays unchanged', async () => {
  refreshCalls.length = 0
  const providerResolvers = []
  refreshHandler = () => new Promise((resolve) => providerResolvers.push(resolve))
  const managerA = loadTokenManager()
  const managerB = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-same-refresh', {
      access_token: 'starting-access',
      refresh_token: 'same-refresh',
    })],
    tokenSelectError: {
      code: 'PGRST205',
      message: "Could not find tiktok_account_tokens in the schema cache",
    },
    missingRpcNames: ['claim_tiktok_token_refresh'],
    syncTrigger: false,
  })

  const first = managerA.getValidTikTokAccessToken(supabase, 'account-same-refresh')
  const second = managerB.getValidTikTokAccessToken(supabase, 'account-same-refresh')
  while (providerResolvers.length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }

  providerResolvers[0]({
    ...refreshedResponse('winner-same-refresh'),
    refresh_token: 'same-refresh',
  })
  const firstAccess = await first
  providerResolvers[1]({
    ...refreshedResponse('loser-same-refresh'),
    refresh_token: 'same-refresh',
  })
  const secondAccess = await second

  assert.equal(firstAccess, 'access-winner-same-refresh')
  assert.equal(secondAccess, 'access-winner-same-refresh')
  assert.equal(supabase.state.accounts[0].access_token, 'access-winner-same-refresh')
  assert.equal(supabase.state.accounts[0].refresh_token, 'same-refresh')
  const credentialValues = new Set([
    'starting-access',
    'same-refresh',
    'access-winner-same-refresh',
    'access-loser-same-refresh',
  ])
  assert.equal(
    supabase.calls.some(
      (call) => call.operation === 'eq' && credentialValues.has(call.value)
    ),
    false,
    'OAuth credentials must never be serialized into PostgREST filters'
  )
})

test('unrelated missing relation or function errors do not enable compatibility refresh', async () => {
  for (const claimError of [
    { code: '42P01', message: 'relation public.unrelated_table does not exist' },
    { code: '42883', message: 'function public.unrelated_helper() does not exist' },
    { code: 'PGRST202', message: 'Could not find public.unrelated_rpc in the schema cache' },
  ]) {
    refreshCalls.length = 0
    refreshHandler = async () => refreshedResponse('must-not-run')
    const manager = loadTokenManager()
    const supabase = createStatefulSupabase({
      accounts: [normalAccount(`account-error-${claimError.code}`)],
      tokens: [tokenRow(`account-error-${claimError.code}`)],
      claimError,
    })

    await assert.rejects(
      manager.getValidTikTokAccessToken(supabase, `account-error-${claimError.code}`),
      /Failed to coordinate TikTok token refresh/
    )
    assert.deepEqual(refreshCalls, [])
  }
})

test('refresh coordination errors fail before calling the provider', async () => {
  refreshCalls.length = 0
  refreshHandler = async () => refreshedResponse('unexpected')
  const manager = loadTokenManager()
  const supabase = createStatefulSupabase({
    accounts: [normalAccount('account-7')],
    tokens: [tokenRow('account-7')],
    claimError: { code: '42501', message: 'permission denied' },
  })

  await assert.rejects(
    manager.getValidTikTokAccessToken(supabase, 'account-7'),
    /Failed to coordinate TikTok token refresh/
  )
  assert.deepEqual(refreshCalls, [])
})

test('migration installs atomic normal-only sync, refresh lease, NULL-safe backfill, and tenant invariant', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20260723_tiktok_account_tokens.sql',
    'utf8'
  )

  assert.match(migration, /CREATE TRIGGER sync_tiktok_account_token_from_legacy/)
  assert.match(migration, /CREATE TRIGGER guard_tiktok_legacy_token_write/)
  assert.match(migration, /managed_writes_only = TRUE/)
  assert.match(migration, /unfenced legacy TikTok token write rejected/)
  assert.match(migration, /OLD\.account_type IS DISTINCT FROM NEW\.account_type/)
  assert.match(migration, /TikTok account type cannot be changed after binding/)
  assert.match(migration, /compatibility_write_key/)
  assert.match(
    migration,
    /NEW\.token_write_fence IS NOT DISTINCT FROM compatibility_key[\s\S]*SET managed_writes_only = TRUE/
  )
  assert.match(migration, /AFTER INSERT OR UPDATE OF[\s\S]*ON public\.tiktok_accounts/)
  assert.match(migration, /IF NEW\.account_type = 'normal'/)
  assert.match(migration, /refresh_lease_token = NULL/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_tiktok_token_refresh/)
  assert.match(migration, /token_row\.refresh_token = p_expected_refresh_token/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.commit_tiktok_token_refresh/)
  assert.match(migration, /account_row\.refresh_token = p_expected_refresh_token/)
  assert.match(migration, /FOR UPDATE/)
  assert.match(migration, /current_lease_token IS DISTINCT FROM p_lease_token/)
  const commitStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.commit_tiktok_token_refresh'
  )
  const parentLock = migration.indexOf('FROM public.tiktok_accounts', commitStart)
  const tokenLock = migration.indexOf('FROM public.tiktok_account_tokens', commitStart)
  assert.ok(parentLock > commitStart)
  assert.ok(tokenLock > parentLock, 'commit must lock parent before token')
  assert.match(migration, /COALESCE\(created_at, NOW\(\)\)/)
  assert.match(migration, /COALESCE\(updated_at, NOW\(\)\)/)
  assert.match(migration, /ON CONFLICT \(account_id\) DO NOTHING/)
  assert.match(migration, /CREATE TRIGGER validate_publish_task_item_account_owner/)
  assert.match(migration, /task_owner <> account_owner/)
  assert.match(migration, /account_kind IS DISTINCT FROM 'normal'/)
  assert.match(migration, /tiktok_accounts\.user_id = auth\.uid\(\)/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.tiktok_account_tokens FROM authenticated/)

  const oauth = fs.readFileSync('src/lib/tiktok/oauth.ts', 'utf8')
  assert.match(oauth, /TIKTOK_REFRESH_TIMEOUT_MS = 20_000/)
  assert.match(
    oauth,
    /export async function refreshAccessToken[\s\S]*signal: AbortSignal\.timeout\(TIKTOK_REFRESH_TIMEOUT_MS\)/
  )
})

test('binding relies on its single token-bearing row write and cannot match a Shop account', () => {
  const binding = fs.readFileSync('src/lib/tiktok/account-binding.ts', 'utf8')

  assert.doesNotMatch(binding, /persistTikTokAccountToken/)
  assert.match(binding, /access_token: tokenResponse\.access_token/)
  assert.match(binding, /refresh_token: tokenResponse\.refresh_token/)
  assert.match(binding, /\.eq\('account_type', 'normal'\)/)
  assert.match(binding, /\.select\('compatibility_write_key'\)/)
  assert.match(
    binding,
    /tokenWriteFence \? \{ token_write_fence: tokenWriteFence \} : \{\}/
  )
})

test('existing-account binding omits the fence column when the token migration is absent', async () => {
  const updates = []
  const missingTable = {
    code: 'PGRST205',
    message: 'Could not find tiktok_account_tokens in the schema cache',
  }
  const supabase = {
    from(table) {
      const query = {
        operation: 'select',
        select() {
          this.operation = 'select'
          return this
        },
        update(payload) {
          this.operation = 'update'
          updates.push(payload)
          return this
        },
        eq() {
          return this
        },
        maybeSingle() {
          if (table === 'tiktok_account_tokens') {
            return Promise.resolve({ data: null, error: missingTable })
          }
          return Promise.resolve({
            data: this.operation === 'select' ? { id: 'pre-migration-account' } : null,
            error: null,
          })
        },
        then(resolve, reject) {
          return Promise.resolve({ data: null, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const binding = transpileModule(
    path.join(process.cwd(), 'src/lib/tiktok/account-binding.ts'),
    {
      '@/lib/tiktok/oauth': {
        calculateTokenExpiration() {
          return new Date('2030-01-01T01:00:00.000Z')
        },
        async getUserInfo() {
          return {
            open_id: 'open-pre-migration',
            display_name: 'Pre-migration user',
          }
        },
      },
    }
  )

  await binding.saveTikTokAccountFromToken(supabase, 'user-1', {
    access_token: 'binding-access',
    refresh_token: 'binding-refresh',
    expires_in: 3600,
    refresh_expires_in: 7200,
    scope: 'video.publish',
  })

  assert.equal(updates.length, 1)
  assert.equal(Object.hasOwn(updates[0], 'token_write_fence'), false)
})

test('ownership predicate rejects foreign and Shop accounts', () => {
  const authorization = transpileModule(
    path.join(process.cwd(), 'src/lib/tiktok/account-authorization.ts')
  )

  assert.equal(
    authorization.isNormalTikTokAccountOwnedBy(
      { user_id: 'user-1', account_type: 'normal' },
      'user-1'
    ),
    true
  )
  assert.equal(
    authorization.isNormalTikTokAccountOwnedBy(
      { user_id: 'user-2', account_type: 'normal' },
      'user-1'
    ),
    false
  )
  assert.equal(
    authorization.isNormalTikTokAccountOwnedBy(
      { user_id: 'user-1', account_type: 'shop' },
      'user-1'
    ),
    false
  )
})

test('service-role token callers establish ownership/type before lookup and processor marks mismatches', () => {
  const deleteRoute = fs.readFileSync(
    'src/app/api/publish/tasks/[id]/items/[itemId]/route.ts',
    'utf8'
  )
  const processor = fs.readFileSync('src/lib/publish-processor.ts', 'utf8')
  const normalRoutes = [
    'src/app/api/publish/accounts/[id]/route.ts',
    'src/app/api/publish/accounts/[id]/refresh/route.ts',
    'src/app/api/publish/creator-info/route.ts',
    'src/app/api/publish/tasks/route.ts',
    'src/app/api/studio/photo-post/publish/route.ts',
  ]

  const ownershipCheck = deleteRoute.indexOf(".eq('account_type', 'normal')")
  const adminLookup = deleteRoute.indexOf('getValidTikTokAccessToken(')
  assert.ok(ownershipCheck >= 0 && ownershipCheck < adminLookup)
  assert.match(deleteRoute, /\.eq\('user_id', user\.id\)/)
  assert.match(processor, /isNormalTikTokAccountOwnedBy/)
  assert.match(processor, /ACCOUNT_OWNERSHIP_MISMATCH/)

  for (const file of normalRoutes) {
    assert.match(fs.readFileSync(file, 'utf8'), /account_type['"], ['"]normal/)
  }
})

test('normal TikTok server flows no longer select legacy token columns directly', () => {
  const files = [
    'src/lib/publish-processor.ts',
    'src/app/api/publish/accounts/[id]/route.ts',
    'src/app/api/publish/accounts/[id]/refresh/route.ts',
    'src/app/api/publish/creator-info/route.ts',
    'src/app/api/publish/multi-task/creator-capabilities/route.ts',
    'src/app/api/publish/multi-task/preview/route.ts',
    'src/app/api/publish/multi-task/tasks/route.ts',
    'src/app/api/publish/tasks/[id]/items/[itemId]/route.ts',
    'src/app/api/publish/tasks/[id]/sync-stats/route.ts',
    'src/app/api/studio/photo-post/publish/route.ts',
  ]

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(
      source,
      /\.from\(['"]tiktok_accounts['"]\)[\s\S]{0,220}\.select\([^)]*(access_token|refresh_token)/,
      file
    )
  }

  const managerSource = fs.readFileSync('src/lib/tiktok/token-manager.ts', 'utf8')
  assert.doesNotMatch(managerSource, /\.eq\(['"](?:access_token|refresh_token)['"]/)
  assert.doesNotMatch(managerSource, /\.match\([^)]*(?:access_token|refresh_token)/)
})
