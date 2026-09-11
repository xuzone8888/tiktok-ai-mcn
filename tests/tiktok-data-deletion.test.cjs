/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const route = read('src/app/api/tiktok/data/route.ts')
const migration = read('supabase/migrations/20260911_tiktok_user_data_deletion.sql')
const accountsPage = read('src/app/(main)/publish/accounts/page.tsx')
const privacy = read('src/app/(landing)/privacy/page.tsx')
const terms = read('src/app/(landing)/terms/page.tsx')

test('TikTok deletion authenticates before service-role access and binds the RPC to that user', () => {
  assert.ok(route.indexOf('auth.getUser()') < route.indexOf('createAdminClient()'))
  assert.match(route, /admin\.rpc\('delete_tiktok_user_data',[\s\S]*p_user_id: user\.id/)
  assert.match(route, /tiktok_authorization_must_disconnect_first[\s\S]*status: 409/)
  assert.doesNotMatch(route, /error\.message\s*[,}]/)
})

test('TikTok deletion requires both remote credentials to be gone before any local erasure', () => {
  const guard = migration.indexOf('tiktok_authorization_must_disconnect_first')
  const firstDelete = migration.indexOf('DELETE FROM public.social_comment_action_logs')
  assert.ok(guard > 0 && guard < firstDelete)
  assert.match(migration, /FROM public\.tiktok_account_tokens token/)
  assert.match(migration, /FROM public\.tiktok_business_account_tokens token/)
  assert.match(migration, /account\.account_type = 'normal'/)
  assert.match(migration, /account\.status IS DISTINCT FROM 'revoked'/)
  assert.match(migration, /account\.publishing_disconnect_completed_at IS NULL/)
  assert.match(migration, /FROM auth\.users user_row[\s\S]*FOR UPDATE/)
  assert.match(migration, /FROM public\.tiktok_accounts account[\s\S]*FOR UPDATE/)
})

test('TikTok deletion is tenant-scoped, transactional, and covers ordinary local records', () => {
  assert.match(migration, /IF auth\.role\(\) IS DISTINCT FROM 'service_role'/)
  for (const table of [
    'social_comment_action_logs',
    'social_comment_sync_runs',
    'social_comments',
    'publish_task_items',
    'publish_tasks',
    'tiktok_business_auth_states',
    'tiktok_auth_states',
    'tiktok_accounts',
    'tiktok_account_groups',
  ]) {
    assert.match(migration, new RegExp(`DELETE FROM public\\.${table}`))
  }
  assert.match(migration, /WHERE user_id = p_user_id[\s\S]*platform = 'tiktok'/)
  assert.match(migration, /DELETE FROM public\.tiktok_accounts[\s\S]*user_id = p_user_id[\s\S]*account_type = 'normal'/)
  assert.match(migration, /DELETE FROM public\.publish_task_items item[\s\S]*account\.account_type = 'normal'/)
  assert.match(migration, /DELETE FROM public\.publish_tasks task[\s\S]*NOT EXISTS/)
  assert.doesNotMatch(migration, /DELETE FROM public\.shop_publish/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.delete_tiktok_user_data\(UUID\)[\s\S]*PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.delete_tiktok_user_data\(UUID\)[\s\S]*service_role/)
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/)
})

test('stale TikTok sync and reply work cannot recreate data after revocation or deletion', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.guard_tiktok_social_comment_owner\(\)/)
  assert.match(migration, /account\.id = NEW\.account_id[\s\S]*account\.user_id = NEW\.user_id/)
  assert.match(migration, /account\.account_type = 'normal'[\s\S]*account\.status = 'active'/)
  for (const trigger of [
    'guard_tiktok_social_comment_owner',
    'guard_tiktok_social_comment_sync_owner',
    'guard_tiktok_social_comment_action_owner',
  ]) {
    assert.match(migration, new RegExp(`CREATE TRIGGER ${trigger}`))
  }
})

test('task creation and delete-all serialize on the same user row and creation rechecks after waiting', () => {
  const createFence = migration.indexOf('CREATE OR REPLACE FUNCTION public.fence_tiktok_publish_task_creation()')
  const deleteRpc = migration.indexOf('CREATE OR REPLACE FUNCTION public.delete_tiktok_user_data(')
  assert.ok(createFence > 0 && createFence < deleteRpc)

  const createBody = migration.slice(createFence, deleteRpc)
  const userLock = createBody.indexOf('FROM auth.users user_row')
  const keyShareLock = createBody.indexOf('FOR KEY SHARE')
  const activeAccountCheck = createBody.indexOf('FROM public.tiktok_accounts account')
  assert.ok(userLock > 0 && userLock < keyShareLock)
  assert.ok(keyShareLock < activeAccountCheck)
  assert.match(createBody, /account\.user_id = NEW\.user_id/)
  assert.match(createBody, /account\.account_type = 'normal'/)
  assert.match(createBody, /account\.status = 'active'/)
  assert.match(createBody, /CREATE TRIGGER fence_tiktok_publish_task_creation[\s\S]*BEFORE INSERT[\s\S]*ON public\.publish_tasks/)

  const deletionBody = migration.slice(deleteRpc)
  assert.match(deletionBody, /FROM auth\.users user_row[\s\S]*WHERE user_row\.id = p_user_id[\s\S]*FOR UPDATE/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.fence_tiktok_publish_task_creation\(\)[\s\S]*PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fence_tiktok_publish_task_creation\(\)[\s\S]*service_role/)
})

test('TikTok account management exposes the deletion control with accurate boundaries', () => {
  assert.match(accountsPage, /fetch\("\/api\/tiktok\/data", \{ method: "DELETE" \}\)/)
  assert.match(accountsPage, /删除全部普通 TikTok 数据/)
  assert.match(accountsPage, /请先逐个断开评论授权与发布授权/)
  assert.match(accountsPage, /不会删除 TikTok 平台托管的视频、评论或回复/)
  assert.match(accountsPage, /不会删除独立的 TikTok Shop 数据/)
})

test('public TikTok disclosures match the implemented deletion and no-bulk behavior', () => {
  for (const source of [privacy, terms]) {
    assert.match(source, /Delete all ordinary TikTok data|删除全部普通 TikTok 数据/)
    assert.match(source, /comment and publishing authorizations|评论授权和发布授权/)
    assert.match(source, /does not automatically or bulk-send|不会自动或批量发送/)
  }
})
