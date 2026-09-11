/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase/migrations/20260911_production_security_advisor_hardening.sql',
  ),
  'utf8',
)

test('public AI model view honors the querying role and underlying RLS', () => {
  assert.match(
    migration,
    /ALTER VIEW public\.ai_models_public\s+SET \(security_invoker = true\)/,
  )
})

test('browser roles cannot use DDL-style privileges on social publishing tables', () => {
  for (const table of [
    'tiktok_accounts',
    'publish_tasks',
    'publish_task_items',
    'social_comments',
    'social_comment_sync_runs',
    'social_comment_action_logs',
  ]) {
    assert.match(migration, new RegExp(`public\\.${table}`))
  }

  assert.match(migration, /REVOKE TRUNCATE, REFERENCES, TRIGGER/)
  assert.match(migration, /FROM anon, authenticated/)
  assert.doesNotMatch(migration, /REVOKE\s+(?:SELECT|INSERT|UPDATE|DELETE)/)
})

