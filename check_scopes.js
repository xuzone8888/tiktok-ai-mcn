require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const {data} = await s
        .from('tiktok_accounts')
        .select('id, display_name, scopes, status, token_expires_at, created_at, updated_at')
        .limit(5);

    for (const a of data || []) {
        console.log('=== Account:', a.display_name, '===');
        console.log('ID:', a.id);
        console.log('Status:', a.status);
        console.log('Scopes:', JSON.stringify(a.scopes));
        console.log('Token expires:', a.token_expires_at);
        console.log('Created:', a.created_at);
        console.log('Updated:', a.updated_at);
        console.log('');
    }
}
main();
