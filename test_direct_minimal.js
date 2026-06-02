require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const {data: acct} = await s
        .from('tiktok_accounts')
        .select('access_token, display_name')
        .eq('id', '22a964d4-6c83-48b4-a370-8cd13ff6e9c9')
        .single();

    console.log('Account:', acct.display_name);

    // Test 1: Minimal Direct Post with SELF_ONLY
    console.log('\n=== Test 1: Minimal Direct Post (SELF_ONLY) ===');
    const res1 = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + acct.access_token,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
            post_info: {
                title: 'Test video',
                privacy_level: 'SELF_ONLY',
                disable_duet: false,
                disable_comment: false,
                disable_stitch: false,
            },
            source_info: {
                source: 'PULL_FROM_URL',
                video_url: 'https://tokfactory-videos.oss-accelerate.aliyuncs.com/videos/4d4a5690-51d0-45c4-9275-22637c028995/1774354052722-hplb17-_0ad31ae5ccfc31e19978b3df3062e9a2_63dbeafd-5684-451e-824b-a11a99376c86.mp4',
            },
        }),
    });
    console.log('Status:', res1.status);
    const body1 = await res1.text();
    console.log('Body:', body1);

    // Test 2: Creator Info to check available privacy levels
    console.log('\n=== Test 2: Creator Info ===');
    const res2 = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + acct.access_token,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    });
    console.log('Status:', res2.status);
    const body2 = await res2.text();
    console.log('Body:', body2);
}
main();
