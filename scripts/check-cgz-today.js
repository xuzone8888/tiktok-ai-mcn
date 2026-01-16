/**
 * 检查用户 CGZ979797 今天的视频生成情况
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
    // 移除值中的引号
    let value = valueParts.join('=').trim();
    value = value.replace(/^["']|["']$/g, '');
    envVars[key.trim()] = value;
  }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('Supabase URL:', supabaseUrl);

async function checkCGZToday() {
  console.log('🔍 检查用户 CGZ979797 今天的视频生成情况...\n');
  
  // 获取今天的日期范围
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.toISOString();
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayEnd = tomorrow.toISOString();
  
  console.log(`📅 查询时间范围: ${todayStart} ~ ${todayEnd}\n`);
  
  // 1. 先找到用户
  const userResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?or=(name.ilike.*CGZ*,email.ilike.*cgz*)&select=id,name,email`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    }
  );
  
  const users = await userResponse.json();
  console.log('👤 匹配到的用户:', users);
  
  if (!users || users.length === 0) {
    console.log('❌ 未找到用户 CGZ979797');
    return;
  }
  
  const userId = users[0].id;
  console.log(`\n✅ 用户ID: ${userId}\n`);
  
  // 2. 查询今天的所有生成记录
  const generationsResponse = await fetch(
    `${supabaseUrl}/rest/v1/generations?user_id=eq.${userId}&created_at=gte.${todayStart}&created_at=lt.${todayEnd}&order=created_at.desc&select=*`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    }
  );
  
  const generations = await generationsResponse.json();
  
  console.log(`📊 今天总任务数: ${generations.length}\n`);
  
  if (generations.length === 0) {
    console.log('今天没有生成记录');
    return;
  }
  
  // 3. 统计各状态
  const statusCount = {};
  const errorReasons = {};
  const failedTasks = [];
  const processingTasks = [];
  
  generations.forEach(g => {
    statusCount[g.status] = (statusCount[g.status] || 0) + 1;
    
    if (g.status === 'failed') {
      const reason = g.error_message || '未知错误';
      errorReasons[reason] = (errorReasons[reason] || 0) + 1;
      failedTasks.push(g);
    }
    
    if (g.status === 'processing') {
      processingTasks.push(g);
    }
  });
  
  console.log('📈 状态统计:');
  console.log('─'.repeat(50));
  Object.entries(statusCount).forEach(([status, count]) => {
    const percent = ((count / generations.length) * 100).toFixed(1);
    const emoji = status === 'completed' ? '✅' : status === 'failed' ? '❌' : status === 'processing' ? '⏳' : '📋';
    console.log(`  ${emoji} ${status}: ${count} (${percent}%)`);
  });
  
  // 4. 失败原因分析
  if (Object.keys(errorReasons).length > 0) {
    console.log('\n❌ 失败原因分析:');
    console.log('─'.repeat(50));
    Object.entries(errorReasons)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => {
        console.log(`  [${count}次] ${reason.substring(0, 80)}${reason.length > 80 ? '...' : ''}`);
      });
  }
  
  // 5. 显示最近的失败任务详情
  if (failedTasks.length > 0) {
    console.log('\n📋 最近失败任务详情 (最多显示10条):');
    console.log('─'.repeat(50));
    failedTasks.slice(0, 10).forEach((task, i) => {
      console.log(`\n${i + 1}. Task ID: ${task.task_id || task.id}`);
      console.log(`   创建时间: ${task.created_at}`);
      console.log(`   类型: ${task.type || 'video'}`);
      console.log(`   错误: ${task.error_message || '未知'}`);
      if (task.prompt) {
        console.log(`   提示词: ${task.prompt.substring(0, 50)}...`);
      }
      if (task.metadata) {
        const meta = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : task.metadata;
        if (meta.imageUrl) console.log(`   图片: 有`);
        if (meta.modelId) console.log(`   模特: ${meta.modelId}`);
      }
    });
  }
  
  // 6. 检查正在处理中的任务
  if (processingTasks.length > 0) {
    console.log('\n⏳ 正在处理中的任务:');
    console.log('─'.repeat(50));
    processingTasks.forEach((task, i) => {
      const createdAt = new Date(task.created_at);
      const now = new Date();
      const waitMinutes = Math.round((now - createdAt) / 1000 / 60);
      console.log(`${i + 1}. ${task.task_id || task.id} - 已等待 ${waitMinutes} 分钟`);
    });
  }
  
  // 7. 时间分布分析
  console.log('\n⏰ 今日任务时间分布:');
  console.log('─'.repeat(50));
  const hourlyCount = {};
  generations.forEach(g => {
    const hour = new Date(g.created_at).getHours();
    hourlyCount[hour] = (hourlyCount[hour] || 0) + 1;
  });
  Object.entries(hourlyCount)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .forEach(([hour, count]) => {
      console.log(`  ${hour.padStart(2, '0')}:00 - ${count} 个任务`);
    });
  
  // 8. 检查是否有特定模式
  console.log('\n🔎 失败任务特征分析:');
  console.log('─'.repeat(50));
  
  let withImage = 0, withoutImage = 0;
  let withModel = 0, withoutModel = 0;
  
  failedTasks.forEach(task => {
    const meta = task.metadata ? (typeof task.metadata === 'string' ? JSON.parse(task.metadata) : task.metadata) : {};
    if (meta.imageUrl) withImage++; else withoutImage++;
    if (meta.modelId) withModel++; else withoutModel++;
  });
  
  console.log(`  带图片的失败: ${withImage}`);
  console.log(`  不带图片的失败: ${withoutImage}`);
  console.log(`  带模特的失败: ${withModel}`);
  console.log(`  不带模特的失败: ${withoutModel}`);
}

checkCGZToday().catch(console.error);
