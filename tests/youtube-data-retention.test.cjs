const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const migration = read('supabase/migrations/20260723120000_youtube_data_retention_cleanup.sql')
const accountRoute = read('src/app/api/youtube/accounts/[id]/route.ts')
const dataRoute = read('src/app/api/youtube/data/route.ts')
const retentionRoute = read('src/app/api/youtube/data-retention/route.ts')
const accountRefreshRoute = read('src/app/api/youtube/accounts/[id]/refresh/route.ts')
const commentService = read('src/lib/social-comments/service.ts')
const processor = read('src/lib/youtube/processor.ts')
const governance = read('src/lib/youtube/data-governance.ts')
const oauth = read('src/lib/youtube/oauth.ts')
const accountsPage = read('src/app/(main)/youtube-publish/accounts/page.tsx')
const privacyPage = read('src/app/(landing)/privacy/page.tsx')
const termsPage = read('src/app/(landing)/terms/page.tsx')
const reviewScript = read('docs/youtube-comments-review-script.md')
const acceptanceChecklist = read('docs/youtube-comments-acceptance-checklist.md')
const vercel = JSON.parse(read('vercel.json'))

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
  assert.match(governance, /last_error_code === 'revoked'/)
  assert.match(governance, /\.delete\(\)[\s\S]*\.from\('youtube_revocation_jobs'\)|\.from\('youtube_revocation_jobs'\)[\s\S]*\.delete\(\)/)
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

test('verifies active authorizations every 28 days with a 29-day hourly backstop', () => {
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
  assert.deepEqual(vercel.crons.find((cron) => cron.path === '/api/youtube/data-retention'), {
    path: '/api/youtube/data-retention',
    schedule: '17 * * * *',
  })
  for (const existingPath of [
    '/api/cron/process-image-generation',
    '/api/youtube/publish/process',
    '/api/facebook/publish/process',
    '/api/instagram/publish/process',
  ]) {
    assert.ok(vercel.crons.some((cron) => cron.path === existingPath))
  }
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
})

test('keeps review documents aligned to the single force-ssl scope', () => {
  for (const document of [reviewScript, acceptanceChecklist]) {
    assert.match(document, /youtube\.force-ssl/)
    assert.doesNotMatch(document, /youtube\.readonly/)
    assert.doesNotMatch(document, /youtube\.upload/)
  }
})
