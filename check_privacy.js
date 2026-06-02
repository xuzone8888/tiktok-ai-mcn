require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    // Get latest failed item with its parent task
    const {data} = await s
        .from('publish_task_items')
        .select('id, error_message, task_id, created_at, publish_tasks(id, privacy_level, allow_comment, allow_duet, allow_stitch, is_aigc, brand_content_toggle)')
        .eq('status', 'failed')
        .order('created_at', {ascending: false})
        .limit(3);

    for (const d of data || []) {
        console.log('=== Item:', d.id, '===');
        console.log('Created:', d.created_at);
        console.log('Error:', d.error_message?.substring(0, 100));
        console.log('Task privacy_level:', d.publish_tasks?.privacy_level);
        console.log('Task allow_comment:', d.publish_tasks?.allow_comment);
        console.log('Task allow_duet:', d.publish_tasks?.allow_duet);
        console.log('Task is_aigc:', d.publish_tasks?.is_aigc);
        console.log('');
    }
}
main();
