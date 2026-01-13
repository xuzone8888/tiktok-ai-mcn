/**
 * 检查并发任务数量
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
});

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('='.repeat(60));
  console.log('检查并发任务情况');
  console.log('='.repeat(60));

  // 检查最近 60 分钟内创建的所有视频任务
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('generations')
    .select('status, created_at, user_id')
    .eq('type', 'video')
    .gte('created_at', hourAgo)
    .order('created_at', { ascending: false });

  console.log('\n最近 60 分钟内创建的视频任务总数:', data?.length || 0);
  
  const statusCount = {};
  data?.forEach(t => { statusCount[t.status] = (statusCount[t.status] || 0) + 1; });
  console.log('状态分布:', JSON.stringify(statusCount, null, 2));
  
  // 当前 processing 状态的任务数
  const processingCount = data?.filter(t => t.status === 'processing').length || 0;
  console.log('\n当前 processing 状态的任务数:', processingCount);
  
  if (processingCount > 10) {
    console.log('\n⚠️ 警告: 同时有大量任务在处理中！');
    console.log('   这可能导致 Sora API 排队拥堵。');
    console.log('   建议：减少同时提交的任务数量，或等待当前任务完成后再提交新任务。');
  }

  // 按用户统计
  console.log('\n按用户统计 (最近 60 分钟):');
  const userTasks = {};
  data?.forEach(t => {
    if (!userTasks[t.user_id]) userTasks[t.user_id] = { total: 0, processing: 0, completed: 0, failed: 0 };
    userTasks[t.user_id].total++;
    userTasks[t.user_id][t.status] = (userTasks[t.user_id][t.status] || 0) + 1;
  });
  
  for (const [userId, stats] of Object.entries(userTasks)) {
    console.log(`   用户 ${userId.substring(0, 8)}...: 总计 ${stats.total}, 处理中 ${stats.processing || 0}, 完成 ${stats.completed || 0}, 失败 ${stats.failed || 0}`);
  }
}

check().catch(console.error);
