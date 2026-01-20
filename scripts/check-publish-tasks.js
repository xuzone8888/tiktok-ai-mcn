require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTasks() {
    // 查询最近的任务
    const { data: tasks, error: taskError } = await supabase
        .from('publish_tasks')
        .select('id, name, status, scheduled_at, pending_count, published_count, failed_count')
        .order('created_at', { ascending: false })
        .limit(5);

    console.log('=== 最近的任务 ===');
    console.log(JSON.stringify(tasks, null, 2));

    // 查询最近的任务项
    const { data: items, error: itemError } = await supabase
        .from('publish_task_items')
        .select('id, task_id, status, scheduled_at')
        .order('created_at', { ascending: false })
        .limit(10);

    console.log('\n=== 最近的任务项 ===');
    console.log(JSON.stringify(items, null, 2));

    // 查询 scheduled 状态且已到期的任务项
    const now = new Date().toISOString();
    const { data: scheduledItems } = await supabase
        .from('publish_task_items')
        .select('id, task_id, status, scheduled_at')
        .eq('status', 'scheduled')
        .lte('scheduled_at', now);

    console.log('\n=== 到期的 scheduled 任务项 ===');
    console.log(JSON.stringify(scheduledItems, null, 2));
}

checkTasks().catch(console.error);
