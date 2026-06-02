require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const {data} = await s
        .from('tiktok_accounts')
        .select('display_name, access_token')
        .eq('display_name', 'Army Artisan');

    const acct = data && data[0];
    if (!acct || !acct.access_token) {
        console.log('No account found, all accounts:', data?.map(a => a.display_name));
        return;
    }

    const r = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + acct.access_token,
            'Content-Type': 'application/json',
        },
        body: '{}',
    });
    const result = await r.json();
    console.log('privacy_level_options:', JSON.stringify(result.data?.privacy_level_options));
    console.log('duet_disabled:', result.data?.duet_disabled);
    console.log('stitch_disabled:', result.data?.stitch_disabled);
    console.log('comment_disabled:', result.data?.comment_disabled);
}
main().catch(e => console.error('ERR:', e.message));
