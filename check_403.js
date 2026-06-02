require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const {data} = await s
        .from('publish_task_items')
        .select('id, error_message, error_code, video_url, created_at')
        .eq('status', 'failed')
        .order('created_at', {ascending: false})
        .limit(2);

    for (const d of data || []) {
        console.log('ID:', d.id);
        console.log('Created:', d.created_at);
        console.log('Error:', d.error_message);
        console.log('Code:', d.error_code);
        console.log('URL:', d.video_url?.substring(0, 80));
        console.log('---');
    }
}
main();
