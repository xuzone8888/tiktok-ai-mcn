const path = require('path')
const { Client } = require('pg')
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') })

const args = process.argv.slice(2)
const userIdArg = args.find((arg) => arg.startsWith('--user-id='))?.split('=')[1]
const countArg = Number(args.find((arg) => arg.startsWith('--count='))?.split('=')[1] || 20)
const accountCount = Math.max(1, Math.min(20, countArg))
const groupName = args.find((arg) => arg.startsWith('--group='))?.split('=')[1] || '多任务测试组'
const groupSlug = groupName
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'default'

const databaseUrl = process.env.TEST_DATABASE_URL

if (!databaseUrl) {
    console.error(JSON.stringify({ ok: false, error: 'missing_TEST_DATABASE_URL' }, null, 2))
    process.exit(1)
}

function shouldUseSsl(connectionString) {
    const value = connectionString.toLowerCase()
    return value.includes('supabase.co') || value.includes('sslmode=require')
}

const client = new Client({
    connectionString: databaseUrl,
    ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
})

async function resolveUserId() {
    if (userIdArg) return userIdArg

    const accountResult = await client.query(
        'select user_id from public.tiktok_accounts order by created_at asc limit 1'
    )
    if (accountResult.rows[0]?.user_id) return accountResult.rows[0].user_id

    const userResult = await client.query(
        'select id from auth.users order by created_at asc limit 1'
    )
    if (userResult.rows[0]?.id) return userResult.rows[0].id

    throw new Error('No user found. Pass --user-id=<uuid>.')
}

async function upsertGroup(userId) {
    const existing = await client.query(
        `
        select id, name
        from public.tiktok_account_groups
        where user_id = $1
          and lower(btrim(name)) = lower(btrim($2))
        limit 1
        `,
        [userId, groupName]
    )

    if (existing.rows[0]) return existing.rows[0]

    const created = await client.query(
        `
        insert into public.tiktok_account_groups (user_id, name, sort_order)
        values ($1, $2, 999)
        returning id, name
        `,
        [userId, groupName]
    )

    return created.rows[0]
}

async function seedAccounts(userId, groupId) {
    const now = new Date()
    const tokenExpiresAt = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString()
    const rows = []

    for (let index = 0; index < accountCount; index++) {
        const n = index + 1
        const openId = `multi_task_seed_${groupSlug}_${n}`
        const displayName = `Test Account ${String(n).padStart(2, '0')}`
        const username = `multi_task_seed_${groupSlug}_${n}`

        const result = await client.query(
            `
            insert into public.tiktok_accounts (
                user_id,
                group_id,
                open_id,
                union_id,
                display_name,
                username,
                avatar_url,
                follower_count,
                following_count,
                likes_count,
                video_count,
                access_token,
                refresh_token,
                token_expires_at,
                refresh_token_expires_at,
                scopes,
                account_type,
                status
            )
            values (
                $1, $2, $3, null, $4, $5, null, $6, 10, $7, $8,
                $9, $10, $11, $11, $12::jsonb, 'normal', 'active'
            )
            on conflict (user_id, open_id)
            do update set
                group_id = excluded.group_id,
                display_name = excluded.display_name,
                username = excluded.username,
                follower_count = excluded.follower_count,
                following_count = excluded.following_count,
                likes_count = excluded.likes_count,
                video_count = excluded.video_count,
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                token_expires_at = excluded.token_expires_at,
                refresh_token_expires_at = excluded.refresh_token_expires_at,
                scopes = excluded.scopes,
                account_type = excluded.account_type,
                status = excluded.status,
                updated_at = now()
            returning id, display_name, group_id
            `,
            [
                userId,
                groupId,
                openId,
                displayName,
                username,
                100 + n,
                1000 + n,
                n,
                `seed-access-${n}`,
                `seed-refresh-${n}`,
                tokenExpiresAt,
                JSON.stringify(['user.info.basic', 'video.upload', 'video.publish']),
            ]
        )
        rows.push(result.rows[0])
    }

    return rows
}

async function main() {
    await client.connect()
    try {
        const userId = await resolveUserId()
        const group = await upsertGroup(userId)
        const accounts = await seedAccounts(userId, group.id)

        console.log(JSON.stringify({
            ok: true,
            method: 'pg',
            database: 'TEST_DATABASE_URL',
            userId,
            group,
            accounts: accounts.length,
            note: 'Seeded accounts are only for UI and scheduling checks.',
        }, null, 2))
    } finally {
        await client.end()
    }
}

main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2))
    process.exit(1)
})
