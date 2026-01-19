const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function stats() {
    const { data, error, count } = await supabase
        .from('generations')
        .select('status', { count: 'exact' });

    if (error) {
        console.log('Error:', error.message);
        return;
    }

    const counts = { processing: 0, completed: 0, failed: 0, pending: 0 };
    data.forEach(g => {
        if (counts[g.status] !== undefined) {
            counts[g.status]++;
        }
    });

    console.log('=== 全平台视频生成统计 ===');
    console.log('处理中 (processing):', counts.processing);
    console.log('已完成 (completed):', counts.completed);
    console.log('失败 (failed):', counts.failed);
    console.log('待处理 (pending):', counts.pending);
    console.log('总计:', count);
}

stats().catch(console.error);
