const fs = require('fs')
const path = require('path')
const { Client } = require('pg')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

const migrationPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(__dirname, '..', 'supabase', 'migrations', '20260518_tiktok_multi_task_publish.sql')

async function tryRpc(sql) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    if (!url || !key) return false

    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql })
    return !error
}

async function applyWithPg(sql, databaseUrl) {
    const client = new Client({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
    })

    await client.connect()
    try {
        await client.query('begin')
        await client.query(sql)
        await client.query('commit')
    } catch (error) {
        await client.query('rollback')
        throw error
    } finally {
        await client.end()
    }
}

async function main() {
    if (!fs.existsSync(migrationPath)) {
        throw new Error(`Migration file not found: ${migrationPath}`)
    }

    const sql = fs.readFileSync(migrationPath, 'utf8')
    const databaseUrl = process.env.TEST_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL

    if (databaseUrl) {
        await applyWithPg(sql, databaseUrl)
        console.log(JSON.stringify({ ok: true, method: 'pg', migration: path.basename(migrationPath) }))
        return
    }

    const rpcOk = await tryRpc(sql)
    if (rpcOk) {
        console.log(JSON.stringify({ ok: true, method: 'exec_sql', migration: path.basename(migrationPath) }))
        return
    }

    console.log(JSON.stringify({
        ok: false,
        reason: 'missing_database_url_or_exec_sql',
        migration: migrationPath,
        next: 'Provide TEST_DATABASE_URL for the test database, or run this SQL file in the Supabase SQL Editor.',
    }, null, 2))
}

main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2))
    process.exit(1)
})
