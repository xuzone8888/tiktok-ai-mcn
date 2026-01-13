/**
 * 检查 CGZ979797 用户的视频生成情况
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

async function checkCGZ() {
  console.log('='.repeat(70));
  console.log('检查 CGZ979797 用户的视频生成情况');
  console.log('='.repeat(70));

  // 查找 CGZ979797 用户
  const { data: user } = await supabase
    .from('profiles')
    .select('id, name, email')
    .or('name.ilike.%CGZ%,email.ilike.%CGZ%')
    .single();

  if (!user) {
    console.log('未找到 CGZ979797 用户');
    return;
  }

  console.log(`\n用户: ${user.name || user.email} (${user.id})`);

  // 查询今天的所有视频任务
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const { data: tasks, error } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'video')
    .gte('created_at', todayISO)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('查询错误:', error.message);
    return;
  }

  console.log(`\n今天的视频任务总数: ${tasks.length}`);

  // 状态统计
  const statusCount = {};
  tasks.forEach(t => { statusCount[t.status] = (statusCount[t.status] || 0) + 1; });
  console.log('状态分布:', JSON.stringify(statusCount, null, 2));

  // 计算完成率
  const completed = statusCount['completed'] || 0;
  const failed = statusCount['failed'] || 0;
  const processing = statusCount['processing'] || 0;
  const successRate = tasks.length > 0 ? ((completed / tasks.length) * 100).toFixed(1) : 0;
  
  console.log(`\n完成: ${completed}, 失败: ${failed}, 处理中: ${processing}`);
  console.log(`成功率: ${successRate}%`);

  // 分析任务提交时间分布
  console.log('\n' + '='.repeat(70));
  console.log('任务提交时间分布 (按小时):');
  console.log('='.repeat(70));

  const hourlyDistribution = {};
  tasks.forEach(t => {
    const hour = new Date(t.created_at).getHours();
    if (!hourlyDistribution[hour]) hourlyDistribution[hour] = { total: 0, completed: 0, failed: 0, processing: 0 };
    hourlyDistribution[hour].total++;
    hourlyDistribution[hour][t.status]++;
  });

  for (const [hour, stats] of Object.entries(hourlyDistribution).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  ${hour}:00 - 总计 ${stats.total}, 完成 ${stats.completed || 0}, 失败 ${stats.failed || 0}, 处理中 ${stats.processing || 0}`);
  }

  // 分析完成任务的生成时间
  console.log('\n' + '='.repeat(70));
  console.log('已完成任务的生成耗时分析:');
  console.log('='.repeat(70));

  const completedTasks = tasks.filter(t => t.status === 'completed' && t.completed_at);
  if (completedTasks.length > 0) {
    const durations = completedTasks.map(t => {
      const created = new Date(t.created_at);
      const completed = new Date(t.completed_at);
      return (completed - created) / 60000; // 分钟
    });

    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);

    console.log(`  已完成任务数: ${completedTasks.length}`);
    console.log(`  平均耗时: ${avgDuration.toFixed(1)} 分钟`);
    console.log(`  最短耗时: ${minDuration.toFixed(1)} 分钟`);
    console.log(`  最长耗时: ${maxDuration.toFixed(1)} 分钟`);
  } else {
    console.log('  没有已完成的任务');
  }

  // 检查是否有大批量同时提交的情况
  console.log('\n' + '='.repeat(70));
  console.log('批量提交分析 (1分钟内的任务数):');
  console.log('='.repeat(70));

  const batches = {};
  tasks.forEach(t => {
    const minute = new Date(t.created_at);
    minute.setSeconds(0, 0);
    const key = minute.toISOString();
    if (!batches[key]) batches[key] = [];
    batches[key].push(t);
  });

  const largeBatches = Object.entries(batches)
    .filter(([, tasks]) => tasks.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  if (largeBatches.length > 0) {
    console.log(`\n发现 ${largeBatches.length} 个批量提交 (1分钟内 ≥3 条):`);
    
    for (const [time, batchTasks] of largeBatches.slice(0, 10)) {
      const statusCounts = {};
      batchTasks.forEach(t => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });
      console.log(`\n  时间: ${time}`);
      console.log(`    数量: ${batchTasks.length} 条`);
      console.log(`    状态: 完成 ${statusCounts.completed || 0}, 失败 ${statusCounts.failed || 0}, 处理中 ${statusCounts.processing || 0}`);
    }
  } else {
    console.log('  没有大批量同时提交的情况');
  }

  // 对比：检查 processing 状态任务是什么时候提交的
  console.log('\n' + '='.repeat(70));
  console.log('当前 processing 状态任务分析:');
  console.log('='.repeat(70));

  const processingTasks = tasks.filter(t => t.status === 'processing');
  if (processingTasks.length > 0) {
    console.log(`\n  当前处理中的任务: ${processingTasks.length} 条`);
    
    for (const task of processingTasks.slice(0, 5)) {
      const created = new Date(task.created_at);
      const waitMinutes = Math.round((Date.now() - created) / 60000);
      console.log(`\n    任务: ${task.task_id}`);
      console.log(`    创建时间: ${task.created_at}`);
      console.log(`    已等待: ${waitMinutes} 分钟`);
    }
    
    if (processingTasks.length > 5) {
      console.log(`\n    ... 还有 ${processingTasks.length - 5} 条处理中的任务`);
    }
  }
}

checkCGZ().catch(console.error);
