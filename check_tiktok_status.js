require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    // Get latest failed item
    const {data: items, error: e1} = await s
        .from('publish_task_items')
        .select('id, tiktok_publish_id, account_id')
        .eq('status', 'failed')
        .not('tiktok_publish_id', 'is', null)
        .order('created_at', {ascending: false})
        .limit(1);

    if (e1) { console.log('Items error:', JSON.stringify(e1)); return; }
    if (!items || !items[0]) { console.log('No failed items'); return; }
    const item = items[0];
    console.log('Item:', item.id);
    console.log('Account ID:', item.account_id);
    console.log('Publish ID:', item.tiktok_publish_id);

    // Get account - try different table names
    let token = null;

    // Try tiktok_accounts
    let {data: accts, error: e2} = await s
        .from('tiktok_accounts')
        .select('id, access_token, username')
        .limit(5);

    if (e2) {
        console.log('tiktok_accounts error:', e2.message);
        // Try publish_accounts
        const r = await s.from('publish_accounts').select('id, access_token').limit(5);
        if (r.error) console.log('publish_accounts error:', r.error.message);
        accts = r.data;
    }

    if (accts) {
        console.log('Accounts found:', accts.length);
        for (const a of accts) {
            if (a.id === item.account_id) {
                token = a.access_token;
                console.log('Found matching account!');
            }
        }
    }

    if (!token) { console.log('No token found'); return; }

    // Query TikTok status
    console.log('\n--- TikTok Status ---');
    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ publish_id: item.tiktok_publish_id }),
    });
    console.log('HTTP:', res.status);
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
}
main();
