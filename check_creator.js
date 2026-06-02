require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const {data: a} = await s
        .from('tiktok_accounts')
        .select('access_token')
        .eq('id', '22a964d4-6c83-48b4-a370-8cd13ff6e9c9')
        .single();

    const r = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + a.access_token,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    });
    const data = await r.json();
    console.log('privacy_level_options:', JSON.stringify(data.data?.privacy_level_options));
    console.log('duet_disabled:', data.data?.duet_disabled);
    console.log('stitch_disabled:', data.data?.stitch_disabled);
    console.log('comment_disabled:', data.data?.comment_disabled);
    console.log('max_video_post_duration_sec:', data.data?.max_video_post_duration_sec);
}
main();
