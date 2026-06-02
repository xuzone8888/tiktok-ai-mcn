require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const {data: a} = await s
        .from('tiktok_accounts')
        .select('access_token')
        .eq('id', '22a964d4-6c83-48b4-a370-8cd13ff6e9c9')
        .single();

    if (!a || !a.access_token) {
        console.log('No token found');
        return;
    }

    const r = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + a.access_token,
            'Content-Type': 'application/json',
        },
        body: '{}',
    });
    const data = await r.json();
    console.log(JSON.stringify(data, null, 2));
}
main().catch(e => console.error(e));
