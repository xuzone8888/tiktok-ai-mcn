/**
 * 检查管理员最近的任务状态
 */

const fs = require('fs');
const path = require('path');

// 读取环境变量
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

async function checkAdminTasks() {
  console.log('='.repeat(60));
  console.log('检查管理员账户最近的视频任务');
  console.log('='.repeat(60));

  // 查找管理员用户
  const { data: admin } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .eq('role', 'super_admin')
    .single();

  if (!admin) {
    console.log('未找到管理员账户');
    return;
  }

  console.log('\n管理员:', admin.name || admin.email, '(', admin.id, ')');

  // 查询管理员最近10条视频任务（不管状态）
  const { data: tasks, error } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', admin.id)
    .eq('type', 'video')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('查询错误:', error.message);
    return;
  }

  console.log(`\n找到 ${tasks.length} 条视频任务\n`);

  // 统计状态
  const statusCount = {};
  tasks.forEach(t => {
    statusCount[t.status] = (statusCount[t.status] || 0) + 1;
  });
  console.log('状态统计:', statusCount);

  console.log('\n' + '-'.repeat(60));
  console.log('详细任务列表:');
  console.log('-'.repeat(60));

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`\n[${i + 1}] 任务 ID: ${task.task_id || task.id}`);
    console.log(`    状态: ${task.status}`);
    console.log(`    来源: ${task.source}`);
    console.log(`    模型: ${task.model}`);
    console.log(`    创建时间: ${task.created_at}`);
    console.log(`    完成时间: ${task.completed_at || '未完成'}`);
    console.log(`    视频URL: ${task.video_url ? '有' : '无'}`);
    console.log(`    错误信息: ${task.error_message || '无'}`);
    
    // 如果有提示词，显示前100个字符
    if (task.prompt) {
      console.log(`    提示词预览: ${task.prompt.substring(0, 100)}...`);
    }
  }

  // 特别检查失败但状态可能是 processing 的任务
  console.log('\n\n' + '='.repeat(60));
  console.log('检查可能卡在 processing 状态的任务:');
  console.log('='.repeat(60));

  const processingTasks = tasks.filter(t => t.status === 'processing');
  if (processingTasks.length > 0) {
    console.log(`\n发现 ${processingTasks.length} 条 processing 状态的任务:`);
    
    for (const task of processingTasks) {
      const createdAt = new Date(task.created_at);
      const now = new Date();
      const minutes = Math.round((now - createdAt) / 60000);
      
      console.log(`\n  任务 ID: ${task.task_id}`);
      console.log(`  创建时间: ${task.created_at}`);
      console.log(`  已等待: ${minutes} 分钟`);
      
      if (minutes > 30) {
        console.log(`  ⚠️ 警告: 此任务可能已超时卡住（超过30分钟）`);
      }
    }
  } else {
    console.log('\n没有 processing 状态的任务');
  }

  // 检查最近失败的任务
  const failedTasks = tasks.filter(t => t.status === 'failed');
  if (failedTasks.length > 0) {
    console.log('\n\n' + '='.repeat(60));
    console.log('失败任务错误分析:');
    console.log('='.repeat(60));
    
    for (const task of failedTasks) {
      console.log(`\n  任务 ID: ${task.task_id || task.id}`);
      console.log(`  错误信息: ${task.error_message}`);
      
      // 分析错误类型
      const errMsg = task.error_message || '';
      if (errMsg.includes('内容政策') || errMsg.includes('E-1103')) {
        console.log(`  错误类型: 内容审核失败`);
      } else if (errMsg.includes('耗时较长') || errMsg.includes('超时')) {
        console.log(`  错误类型: 前端轮询超时（任务可能仍在后台处理）`);
      } else if (errMsg.includes('繁忙')) {
        console.log(`  错误类型: 服务繁忙`);
      } else {
        console.log(`  错误类型: 其他`);
      }
    }
  }
}

checkAdminTasks().catch(console.error);
