const path = require('path')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

const requiredEnv = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FACEBOOK_CLIENT_ID',
  'FACEBOOK_CLIENT_SECRET',
  'FACEBOOK_REDIRECT_URI',
]

const tablePrimaryKeys = {
  facebook_account_tokens: 'account_id',
}

async function checkTable(supabase, table) {
  const selectColumn = tablePrimaryKeys[table] || 'id'
  const { error } = await supabase.from(table).select(selectColumn, { count: 'exact', head: true }).limit(0)
  return {
    table,
    ok: !error,
    error: error?.message || null,
  }
}

async function main() {
  const missing = requiredEnv.filter((key) => !process.env[key])
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI || ''
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  const expectedRedirect = appUrl
    ? `${appUrl}/api/facebook/auth/callback`
    : 'http://localhost:3000/api/facebook/auth/callback'
  const localRedirect = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):3000\/api\/facebook\/auth\/callback$/.test(redirectUri)
  const redirectUriOk = redirectUri === expectedRedirect || localRedirect

  const result = {
    env: {
      ok: missing.length === 0,
      missing,
      expectedRedirect,
      redirectUri,
      redirectUriOk,
    },
    database: {
      ok: false,
      tables: [],
    },
  }

  if (missing.includes('NEXT_PUBLIC_SUPABASE_URL') || missing.includes('SUPABASE_SERVICE_ROLE_KEY')) {
    console.log(JSON.stringify(result, null, 2))
    process.exit(1)
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const tables = [
    'facebook_auth_states',
    'facebook_accounts',
    'facebook_account_tokens',
    'facebook_publish_tasks',
    'facebook_publish_task_items',
  ]

  result.database.tables = await Promise.all(tables.map((table) => checkTable(supabase, table)))
  result.database.ok = result.database.tables.every((table) => table.ok)

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.env.ok && result.env.redirectUriOk && result.database.ok ? 0 : 1)
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2))
  process.exit(1)
})
