/**
 * 检查今天所有失败的视频生成任务
 */

const fs = require('fs');
const path = require('path');

// 读取环境变量
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    let value = valueParts.join('=').trim();
    value = value.replace(/^["']|["']$/g, '');
    envVars[key.trim()] = value;
  }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function checkTodayFailures() {
  console.log('🔍 检查今天所有视频生成失败情况...\n');
  
  // 获取今天的日期范围 (北京时间今天)
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  
  // 往前推12小时覆盖下午的任务
  const queryStart = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  
  console.log(`📅 查询时间范围: ${queryStart.toISOString()} 至今\n`);
  
  // 1. 查询所有用户
  const usersResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=id,name,email`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    }
  );
  
  const users = await usersResponse.json();
  const userMap = {};
  users.forEach(u => {
    userMap[u.id] = u.name || u.email || 'Unknown';
  });
  
  console.log(`👥 系统用户总数: ${users.length}`);
  console.log('用户列表:');
  users.forEach(u => {
    console.log(`  - ${u.name || '无名'} (${u.email})`);
  });
  console.log('');
  
  // 2. 查询今天失败的任务
  const failedResponse = await fetch(
    `${supabaseUrl}/rest/v1/generations?status=eq.failed&created_at=gte.${queryStart.toISOString()}&order=created_at.desc&select=*`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    }
  );
  
  const failedTasks = await failedResponse.json();
  console.log(`❌ 失败任务总数: ${failedTasks.length}\n`);
  
  if (failedTasks.length === 0) {
    console.log('没有失败的任务！');
    return;
  }
  
  // 3. 按用户分组统计
  const userFailures = {};
  const errorReasons = {};
  
  failedTasks.forEach(task => {
    const userName = userMap[task.user_id] || task.user_id;
    userFailures[userName] = (userFailures[userName] || 0) + 1;
    
    const reason = task.error_message || '未知错误';
    errorReasons[reason] = (errorReasons[reason] || 0) + 1;
  });
  
  console.log('📊 按用户统计失败数:');
  console.log('─'.repeat(50));
  Object.entries(userFailures)
    .sort((a, b) => b[1] - a[1])
    .forEach(([user, count]) => {
      console.log(`  ${user}: ${count} 次失败`);
    });
  
  console.log('\n❌ 失败原因分析:');
  console.log('─'.repeat(50));
  Object.entries(errorReasons)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      console.log(`  [${count}次] ${reason.substring(0, 100)}`);
    });
  
  // 4. 显示最近失败的任务详情
  console.log('\n📋 最近10条失败任务详情:');
  console.log('─'.repeat(50));
  failedTasks.slice(0, 10).forEach((task, i) => {
    const userName = userMap[task.user_id] || task.user_id;
    console.log(`\n${i + 1}. 用户: ${userName}`);
    console.log(`   Task ID: ${task.task_id || task.id}`);
    console.log(`   创建时间: ${task.created_at}`);
    console.log(`   错误: ${task.error_message || '未知'}`);
    if (task.prompt) {
      console.log(`   提示词: ${task.prompt.substring(0, 60)}...`);
    }
  });
  
  // 5. 查询今天成功的任务作为对比
  const successResponse = await fetch(
    `${supabaseUrl}/rest/v1/generations?status=eq.completed&created_at=gte.${queryStart.toISOString()}&select=id`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    }
  );
  
  const successTasks = await successResponse.json();
  
  // 6. 查询正在处理的任务
  const processingResponse = await fetch(
    `${supabaseUrl}/rest/v1/generations?status=eq.processing&created_at=gte.${queryStart.toISOString()}&select=id,task_id,created_at,user_id`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    }
  );
  
  const processingTasks = await processingResponse.json();
  
  console.log('\n\n📈 今日任务总览:');
  console.log('─'.repeat(50));
  console.log(`  ✅ 成功: ${successTasks.length}`);
  console.log(`  ❌ 失败: ${failedTasks.length}`);
  console.log(`  ⏳ 处理中: ${processingTasks.length}`);
  
  const total = successTasks.length + failedTasks.length;
  if (total > 0) {
    const successRate = ((successTasks.length / total) * 100).toFixed(1);
    console.log(`  📊 成功率: ${successRate}%`);
  }
  
  // 7. 检查处理中任务是否卡住
  if (processingTasks.length > 0) {
    console.log('\n⏳ 正在处理中的任务:');
    console.log('─'.repeat(50));
    processingTasks.forEach((task, i) => {
      const userName = userMap[task.user_id] || task.user_id;
      const createdAt = new Date(task.created_at);
      const waitMinutes = Math.round((now - createdAt) / 1000 / 60);
      const status = waitMinutes > 30 ? '⚠️ 可能卡住' : '正常';
      console.log(`  ${i + 1}. ${userName} - ${task.task_id || task.id} - 等待 ${waitMinutes} 分钟 ${status}`);
    });
  }
}

checkTodayFailures().catch(console.error);
