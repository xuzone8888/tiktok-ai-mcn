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

const migration = read('supabase/migrations/20260723120000_youtube_data_retention_cleanup.sql')
const claimCompatibilityMigration = read('supabase/migrations/20260729120000_youtube_revocation_claim_fencing_compat.sql')
const accountRoute = read('src/app/api/youtube/accounts/[id]/route.ts')
const dataRoute = read('src/app/api/youtube/data/route.ts')
const retentionRoute = read('src/app/api/youtube/data-retention/route.ts')
const accountRefreshRoute = read('src/app/api/youtube/accounts/[id]/refresh/route.ts')
const commentService = read('src/lib/social-comments/service.ts')
const processor = read('src/lib/youtube/processor.ts')
const governance = read('src/lib/youtube/data-governance.ts')
const oauth = read('src/lib/youtube/oauth.ts')
const accountsPage = read('src/app/(main)/youtube-publish/accounts/page.tsx')
const platformAccountsPage = read('src/components/publish/platform/PlatformAccountsPage.tsx')
const langContext = read('src/contexts/LangContext.tsx')
const privacyPage = read('src/app/(landing)/privacy/page.tsx')
const termsPage = read('src/app/(landing)/terms/page.tsx')
const reviewScript = read('docs/youtube-comments-review-script.md')
const acceptanceChecklist = read('docs/youtube-comments-acceptance-checklist.md')
const cronSetup = read('scripts/cron_setup.sh')
const retentionRunner = read('run-youtube-data-retention.sh')
const registerPage = read('src/app/auth/register/page.tsx')
const loginPage = read('src/app/auth/login/page.tsx')
const authCallback = read('src/lib/supabase/auth-callback.ts')

function loadAccountDeleteRoute({ createClient, createAdminClient, processYouTubeRevocationJobs }) {
  const filename = path.join(process.cwd(), 'src/app/api/youtube/accounts/[id]/route.ts')
  const compiled = ts.transpileModule(accountRoute, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText
  const routeModule = { exports: {} }
  const dependencyMocks = {
    'next/server': {
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            headers: { 'content-type': 'application/json' },
            status: init.status || 200,
          })
        },
      },
    },
    '@/lib/supabase/admin': { createAdminClient },
    '@/lib/supabase/server': { createClient },
    '@/lib/youtube/data-governance': { processYouTubeRevocationJobs },
  }
  const localRequire = (specifier) => {
    if (Object.hasOwn(dependencyMocks, specifier)) return dependencyMocks[specifier]
    return require(specifier)
  }
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) { ${compiled}\n})`,
    { filename },
  )
  wrapper(routeModule.exports, localRequire, routeModule, filename, path.dirname(filename))
  return routeModule.exports.DELETE
}

function loadAuthCallbackModule() {
  const filename = path.join(process.cwd(), 'src/lib/supabase/auth-callback.ts')
  const compiled = ts.transpileModule(authCallback, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText
  const callbackModule = { exports: {} }
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) { ${compiled}\n})`,
    { filename },
  )
  wrapper(callbackModule.exports, require, callbackModule, filename, path.dirname(filename))
  return callbackModule.exports
}

test('keeps YouTube governance tables and functions service-role-only', () => {
  assert.match(migration, /ALTER TABLE public\.youtube_revocation_jobs ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.youtube_revocation_jobs FROM PUBLIC, anon, authenticated/)
  for (const signature of [
    'public.mark_youtube_authorization_invalid(UUID, UUID)',
    'public.queue_youtube_account_deletion(UUID, UUID)',
    'public.delete_youtube_user_data(UUID)',
    'public.cleanup_stale_youtube_api_data(INTEGER)',
  ]) {
    const escaped = signature.replace(/[()]/g, '\\$&')
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION ${escaped} FROM PUBLIC, anon, authenticated`))
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION ${escaped} TO service_role`))
  }
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/)
  assert.equal((migration.match(/SET search_path = ''/g) || []).length, 5)
})

test('uses a durable revocation queue as the local deletion commit point', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.youtube_revocation_jobs/)
  assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL DEFAULT \(NOW\(\) \+ INTERVAL '6 days 22 hours'\)/)
  assert.match(migration, /CHECK \(expires_at <= created_at \+ INTERVAL '7 days'\)/)
  assert.match(migration, /INSERT INTO public\.youtube_revocation_jobs[\s\S]*DELETE FROM public\.youtube_accounts/)
  assert.match(accountRoute, /\.rpc\('queue_youtube_account_deletion'/)
  assert.match(accountRoute, /processYouTubeRevocationJobs/)
  assert.doesNotMatch(accountRoute, /revokeYouTubeToken/)
  assert.match(governance, /\.gt\('expires_at'/)
  assert.match(governance, /claimed_at/)
  assert.match(governance, /\.is\('claimed_at', null\)/)
  assert.match(governance, /\.lt\('claimed_at', staleClaim\)/)
  assert.doesNotMatch(governance, /\.or\(`claimed_at/)
  assert.match(governance, /last_error_code === 'revoked'/)
  assert.match(governance, /\.delete\(\)[\s\S]*\.from\('youtube_revocation_jobs'\)|\.from\('youtube_revocation_jobs'\)[\s\S]*\.delete\(\)/)
})

test('keeps an already-completed disconnect successful when immediate revocation processing fails', () => {
  assert.match(
    claimCompatibilityMigration,
    /ALTER TABLE public\.youtube_revocation_jobs\s+ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ/,
  )
  assert.match(
    accountRoute,
    /try \{[\s\S]*processYouTubeRevocationJobs[\s\S]*\} catch \(revocationError\) \{[\s\S]*deferred: 1/,
  )
  assert.match(accountRoute, /return NextResponse\.json\(\{ success: true, deletion, revocation \}\)/)
})

test('returns HTTP 200 and leaves the durable job queued when the immediate processor throws', async () => {
  const queuedJobs = new Map()
  const accountFilters = []
  const processorCalls = []
  let processorAttempts = 0
  const accountQuery = {
    select() {
      return this
    },
    eq(column, value) {
      accountFilters.push([column, value])
      return this
    },
    async single() {
      return { data: { id: 'account-1' }, error: null }
    },
  }
  const userClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1' } }, error: null }
      },
    },
    from(table) {
      assert.equal(table, 'youtube_accounts')
      return accountQuery
    },
  }
  const adminClient = {
    async rpc(name, args) {
      assert.equal(name, 'queue_youtube_account_deletion')
      queuedJobs.set('revocation-job-1', {
        accountId: args.p_account_id,
        userId: args.p_user_id,
      })
      return {
        data: { revocation_job_id: 'revocation-job-1', deleted_account_id: args.p_account_id },
        error: null,
      }
    },
  }
  const processQueuedRevocation = async (...args) => {
    processorCalls.push(args)
    processorAttempts += 1
    if (processorAttempts === 1) {
      throw new Error('controlled provider 503')
    }
    queuedJobs.delete(args[1].jobId)
    return { attempted: 1, completed: 1, deferred: 0 }
  }
  const DELETE = loadAccountDeleteRoute({
    createClient: async () => userClient,
    createAdminClient: () => adminClient,
    processYouTubeRevocationJobs: processQueuedRevocation,
  })
  const loggedErrors = []
  const originalConsoleError = console.error
  console.error = (...args) => loggedErrors.push(args)
  let response
  try {
    response = await DELETE(new Request('https://www.toryxai.com/api/youtube/accounts/account-1', {
      method: 'DELETE',
    }), { params: { id: 'account-1' } })
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    success: true,
    deletion: {
      revocation_job_id: 'revocation-job-1',
      deleted_account_id: 'account-1',
    },
    revocation: { attempted: 0, completed: 0, deferred: 1 },
  })
  assert.deepEqual(accountFilters, [
    ['id', 'account-1'],
    ['user_id', 'user-1'],
  ])
  assert.equal(processorCalls.length, 1)
  assert.equal(processorCalls[0][0], adminClient)
  assert.deepEqual(processorCalls[0][1], { jobId: 'revocation-job-1', limit: 1 })
  assert.deepEqual(queuedJobs.get('revocation-job-1'), {
    accountId: 'account-1',
    userId: 'user-1',
  })
  assert.equal(loggedErrors.length, 1)

  const retry = await processQueuedRevocation(adminClient, {
    jobId: 'revocation-job-1',
    limit: 1,
  })
  assert.deepEqual(retry, { attempted: 1, completed: 1, deferred: 0 })
  assert.equal(processorCalls.length, 2)
  assert.equal(queuedJobs.has('revocation-job-1'), false)
})

test('sends signup confirmations to a login page with one strict callback restorer', () => {
  assert.match(registerPage, /emailRedirectTo: `\$\{window\.location\.origin\}\/auth\/login`/)
  assert.match(loginPage, /restoreSupabaseAuthCallback\(/)
  assert.match(loginPage, /\(scrubbedPath\) => window\.history\.replaceState\(window\.history\.state, "", scrubbedPath\)/)
  assert.match(loginPage, /const hash = window\.location\.hash/)
  assert.match(authCallback, /exchangeCodeForSession\(parsed\.code\)/)
  assert.match(authCallback, /verifyOtp\(\{ token_hash: parsed\.tokenHash, type: parsed\.type \}\)/)
  assert.match(authCallback, /setSession\(\{\s+access_token: parsed\.accessToken,\s+refresh_token: parsed\.refreshToken,/)
})

test('scrubs PKCE parameters before creating the client and accepts only the exchanged session', async () => {
  const { restoreSupabaseAuthCallback } = loadAuthCallbackModule()
  const calls = []
  const expectedSession = { access_token: 'controlled-session' }
  const result = await restoreSupabaseAuthCallback(
    () => {
      calls.push('create-client')
      return {
        async exchangeCodeForSession(code) {
          calls.push(`exchange:${code}`)
          return { data: { session: expectedSession }, error: null }
        },
      }
    },
    '?code=controlled-auth-code&redirect=%2Fcanvas',
    '',
    '/auth/login',
    (path) => calls.push(`scrub:${path}`),
  )

  assert.deepEqual(calls, [
    'scrub:/auth/login?redirect=%2Fcanvas',
    'create-client',
    'exchange:controlled-auth-code',
  ])
  assert.equal(result.handled, true)
  assert.equal(result.session, expectedSession)
  assert.equal(result.error, null)
})

test('does not create an auth client when no callback is present', async () => {
  const { restoreSupabaseAuthCallback } = loadAuthCallbackModule()
  let created = false
  const result = await restoreSupabaseAuthCallback(
    () => {
      created = true
      throw new Error('client must not be created')
    },
    '?redirect=%2Fmodels',
    '#section',
    '/auth/login',
    () => { throw new Error('ordinary URLs must not be scrubbed') },
  )

  assert.equal(created, false)
  assert.deepEqual(result, { handled: false, session: null, error: null, scrubbedPath: null })
})

test('only permits same-site paths as post-auth redirects', () => {
  const { getSafeAuthRedirect } = loadAuthCallbackModule()
  const productionOrigin = 'https://www.toryxai.com'
  assert.equal(getSafeAuthRedirect('/canvas?project=controlled#node'), '/canvas?project=controlled#node')
  assert.equal(getSafeAuthRedirect(null), '/models')
  assert.equal(getSafeAuthRedirect('https://attacker.invalid'), '/models')
  assert.equal(getSafeAuthRedirect('//attacker.invalid'), '/models')
  assert.equal(getSafeAuthRedirect('/\\attacker.invalid'), '/models')
  for (const value of [
    '/..//attacker.invalid',
    '/a/..//attacker.invalid',
    '/.//attacker.invalid',
    '/%2e%2e//attacker.invalid',
    '/%2e//attacker.invalid',
  ]) {
    const redirect = getSafeAuthRedirect(value)
    assert.equal(redirect, '/models')
    assert.equal(new URL(redirect, productionOrigin).origin, productionOrigin)
  }
  for (const encoded of ['%09', '%0a', '%0d']) {
    const decoded = new URLSearchParams(`redirect=/${encoded}/attacker.invalid`).get('redirect')
    const redirect = getSafeAuthRedirect(decoded)
    assert.equal(redirect, '/models')
    assert.equal(new URL(redirect, productionOrigin).origin, productionOrigin)
  }

  const atoms = ['.', '..', '%2e', '%2e%2e', 'a', 'attacker.invalid', '\\attacker.invalid']
  for (const left of atoms) {
    for (const separator of ['/', '//', '///']) {
      for (const right of atoms) {
        const redirect = getSafeAuthRedirect(`/${left}${separator}${right}`)
        assert.equal(new URL(redirect, productionOrigin).origin, productionOrigin)
      }
    }
  }
})

test('deletes all local YouTube data through an authenticated user control', () => {
  assert.match(dataRoute, /auth\.getUser\(\)/)
  assert.match(dataRoute, /\.rpc\('delete_youtube_user_data'/)
  for (const table of [
    'social_comment_action_logs',
    'social_comment_sync_runs',
    'social_comments',
    'youtube_publish_tasks',
    'youtube_accounts',
    'youtube_auth_states',
  ]) {
    assert.match(migration, new RegExp(`DELETE FROM public\\.${table}`))
  }
  assert.match(accountsPage, /deleteAllDataEndpoint: "\/api\/youtube\/data"/)
  assert.match(accountsPage, /YouTube 上的视频和评论不会被删除/)
  assert.doesNotMatch(dataRoute, /processYouTubeRevocationJobs/)
})

test('verifies active authorizations every 28 days with an Aliyun 29-day hourly backstop', () => {
  assert.match(retentionRoute, /if \(!cronSecret\) return false/)
  assert.match(retentionRoute, /28 \* 24 \* 60 \* 60 \* 1000/)
  assert.match(retentionRoute, /refreshYouTubeAccessToken/)
  assert.match(retentionRoute, /getMyYouTubeChannel/)
  assert.match(retentionRoute, /last_authorization_verified_at: now/)
  assert.match(retentionRoute, /\.rpc\('cleanup_stale_youtube_api_data'/)
  assert.match(retentionRoute, /p_retention_days: 29/)
  assert.ok(
    retentionRoute.indexOf(".rpc('cleanup_stale_youtube_api_data'") <
      retentionRoute.indexOf('refreshYouTubeAccessToken('),
    'hard cleanup must execute before provider verification',
  )
  assert.match(migration, /p_retention_days IS NULL/)
  assert.match(migration, /p_retention_days > 29/)
  assert.match(cronSetup, /17 \* \* \* \* \$APP_DIR\/run-youtube-data-retention\.sh/)
  assert.match(cronSetup, /\* \* \* \* \* \$APP_DIR\/run-scheduler\.sh/)
  assert.match(retentionRunner, /\/api\/youtube\/data-retention/)
  assert.match(retentionRunner, /x-cron-secret: \$\{CRON_SECRET\}/)
  assert.match(retentionRunner, /flock -n 9/)
})

test('covers cached channel, publishing, comment, and log API data', () => {
  assert.match(migration, /last_authorization_verified_at/)
  assert.match(migration, /authorization_invalidated_at = COALESCE/)
  assert.match(migration, /DELETE FROM public\.youtube_publish_task_items/)
  assert.match(migration, /youtube_api_data_observed_at <= v_cutoff/)
  assert.match(migration, /preserve_youtube_api_data_observed_at/)
  assert.match(migration, /IF TG_OP = 'INSERT' THEN\s+NEW\.youtube_api_data_observed_at := NULL/)
  assert.match(migration, /ELSE\s+NEW\.youtube_api_data_observed_at := OLD\.youtube_api_data_observed_at/)
  assert.match(migration, /OLD\.youtube_api_data_observed_at/)
  assert.doesNotMatch(migration, /DELETE FROM public\.youtube_publish_task_items\s+WHERE updated_at <= v_cutoff/)
  assert.match(migration, /status IN \('published', 'failed', 'cancelled'\)/)
  assert.match(migration, /DELETE FROM public\.social_comments/)
  assert.match(migration, /DELETE FROM public\.social_comment_sync_runs/)
  assert.match(migration, /DELETE FROM public\.social_comment_action_logs/)
})

test('records terminal authorization errors without resetting the compliance clock', () => {
  assert.match(oauth, /error\.code === 'invalid_grant'/)
  assert.match(oauth, /message\.includes\('invalid_token'\)/)
  for (const source of [accountRefreshRoute, commentService, processor]) {
    assert.match(source, /isYouTubeAuthorizationRevokedError/)
    assert.match(source, /mark_youtube_authorization_invalid|markYouTubeAuthorizationInvalid/)
  }
  assert.doesNotMatch(migration, /authorization_invalidated_at = pg_catalog\.now\(\)/)
  assert.match(processor, /\.from\('youtube_accounts'\)[\s\S]{0,120}\.select\('id, user_id'\)/)
  assert.match(processor, /\.from\('youtube_publish_task_items'\)[\s\S]{0,260}\.select\('id'\)/)
  for (const source of [commentService, processor]) {
    assert.match(source, /last_authorization_verified_at/)
    assert.match(source, /authorization_invalidated_at: null/)
  }
})

test('does not merge previously granted YouTube OAuth scopes', () => {
  assert.doesNotMatch(oauth, /include_granted_scopes/)
  assert.match(oauth, /https:\/\/www\.googleapis\.com\/auth\/youtube\.force-ssl/)
  assert.doesNotMatch(oauth, /youtube\.readonly/)
  assert.doesNotMatch(oauth, /youtube\.upload/)
})

test('publishes aligned YouTube privacy, terms, consent, and deletion disclosures', () => {
  for (const page of [privacyPage, termsPage]) {
    assert.match(page, /July 23, 2026/)
    assert.match(page, /2026年7月23日/)
    assert.match(page, /YouTube Terms|YouTube API Services/)
    assert.match(page, /Google Privacy Policy/)
    assert.match(page, /security\.google\.com\/settings\/security\/permissions/)
  }
  assert.match(privacyPage, /Limited Use requirements/)
  assert.match(privacyPage, /seven \(7\) calendar days/)
  assert.match(privacyPage, /30 calendar days/)
  assert.match(privacyPage, /service-role-only revocation queue/)
  assert.match(accountsPage, /requireLegalConsent: true/)
  assert.match(platformAccountsPage, /setLegalDialogOpen\(true\)/)
  assert.match(platformAccountsPage, /disabled=\{!legalAccepted \|\| binding\}/)
  assert.match(platformAccountsPage, /confirmLegalConsentAndBind/)
  assert.doesNotMatch(platformAccountsPage, /config\.requireLegalConsent && \(\s*<section/)
  assert.match(langContext, /isReady: mounted/)
  assert.match(platformAccountsPage, /if \(!languageReady\) return/)
})

test('keeps review documents aligned to the single force-ssl scope', () => {
  for (const document of [reviewScript, acceptanceChecklist]) {
    assert.match(document, /youtube\.force-ssl/)
    assert.doesNotMatch(document, /youtube\.readonly/)
    assert.doesNotMatch(document, /youtube\.upload/)
  }
})
