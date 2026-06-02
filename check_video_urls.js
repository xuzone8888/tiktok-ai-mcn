require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    // Get latest failed items
    const {data} = await s
        .from('publish_task_items')
        .select('id, video_url, status, error_message, tiktok_publish_id, account_id')
        .eq('status', 'failed')
        .order('created_at', {ascending: false})
        .limit(3);

    if (!data || data.length === 0) { console.log('No failed items'); return; }

    for (const d of data) {
        console.log('=== Item:', d.id, '===');
        console.log('publish_id:', d.tiktok_publish_id || 'NOT SET (init failed!)');
        console.log('video_url:', d.video_url);
        console.log('error:', d.error_message);
    }

    // If we have a publish_id, check TikTok status directly
    const item = data[0];
    if (item.tiktok_publish_id) {
        // Get account token
        const {data: acct} = await s
            .from('publish_accounts')
            .select('access_token')
            .eq('id', item.account_id)
            .single();

        if (acct) {
            console.log('\n--- Checking TikTok status for', item.tiktok_publish_id, '---');
            const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + acct.access_token,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ publish_id: item.tiktok_publish_id }),
            });
            const json = await res.json();
            console.log('TikTok response:', JSON.stringify(json, null, 2));
        }
    }
}
main();
