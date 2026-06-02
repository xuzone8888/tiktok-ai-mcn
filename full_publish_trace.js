require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    // 1. Get ALL failed items with full details
    const {data: items} = await s
        .from('publish_task_items')
        .select('id, video_url, status, error_message, tiktok_publish_id, account_id, task_id, created_at, title')
        .eq('status', 'failed')
        .order('created_at', {ascending: false})
        .limit(5);

    console.log('=== Failed Tasks ===');
    for (const d of items || []) {
        console.log('\nItem:', d.id);
        console.log('  Created:', d.created_at);
        console.log('  Title:', d.title);
        console.log('  Video URL:', d.video_url);
        console.log('  Publish ID:', d.tiktok_publish_id || 'NONE');
        console.log('  Error:', d.error_message);
    }

    // 2. Get parent task details
    if (items && items[0]) {
        const {data: task} = await s
            .from('publish_tasks')
            .select('id, privacy_level, allow_comment, allow_duet, allow_stitch, schedule_mode, status')
            .eq('id', items[0].task_id)
            .single();
        console.log('\n=== Parent Task ===');
        console.log(JSON.stringify(task, null, 2));
    }

    // 3. Check the INIT endpoint being used
    console.log('\n=== Code Config ===');
    const fs = require('fs');
    const code = fs.readFileSync('src/lib/tiktok/content-posting.ts', 'utf8');
    const initLine = code.split('\n').find(l => l.includes('TIKTOK_PUBLISH_VIDEO_INIT'));
    console.log('Endpoint:', initLine?.trim());

    // 4. Simulate what toAcceleratedUrl does with the video URL
    if (items && items[0]) {
        const url = items[0].video_url;
        try {
            const u = new URL(url);
            console.log('\n=== URL Analysis ===');
            console.log('Original hostname:', u.hostname);
            console.log('Path:', u.pathname);

            // Check if acceleration would apply
            if (u.hostname === 'media.toryxai.com' || u.hostname === 'media.tokfactoryai.com') {
                u.hostname = 'tokfactory-videos.oss-accelerate.aliyuncs.com';
                console.log('Accelerated URL:', u.toString());

                // Test accessibility
                const res = await fetch(u.toString(), { method: 'HEAD' });
                console.log('Accel accessible:', res.status);
                console.log('Content-Length:', res.headers.get('content-length'));
                console.log('Content-Type:', res.headers.get('content-type'));
            }
        } catch(e) {
            console.log('URL parse error:', e.message);
        }
    }

    // 5. Check TikTok status for all failed items
    if (items) {
        const {data: accts} = await s.from('tiktok_accounts').select('id, access_token, username').limit(10);

        for (const item of items) {
            if (!item.tiktok_publish_id) continue;
            const acct = accts?.find(a => a.id === item.account_id);
            if (!acct) continue;

            console.log('\n=== TikTok Status for', item.id, '===');
            const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + acct.access_token,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ publish_id: item.tiktok_publish_id }),
            });
            const json = await res.json();
            console.log(JSON.stringify(json, null, 2));
        }
    }
}
main();
