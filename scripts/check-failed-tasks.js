/**
 * 检查失败的视频生成任务
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

async function checkFailedTasks() {
  console.log('='.repeat(60));
  console.log('检查失败的视频生成任务');
  console.log('='.repeat(60));

  // 1. 查找管理员用户
  const { data: admins, error: adminError } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .in('role', ['admin', 'super_admin']);
  
  if (adminError) {
    console.error('查询管理员失败:', adminError.message);
    return;
  }
  
  console.log('\n管理员用户:');
  admins.forEach(a => console.log(`  - ${a.name || a.email} (${a.role}): ${a.id}`));

  // 2. 查询最近所有失败的生成任务（不限制用户）
  const { data: allFailed, error: allError } = await supabase
    .from('generations')
    .select('*')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (allError) {
    console.error('\n查询失败任务出错:', allError.message);
  } else {
    console.log('\n\n最近10条失败的生成任务:');
    console.log('-'.repeat(60));
    
    if (allFailed && allFailed.length > 0) {
      allFailed.forEach((task, i) => {
        console.log(`\n[${i + 1}] 任务 ID: ${task.id}`);
        console.log(`    用户 ID: ${task.user_id}`);
        console.log(`    类型: ${task.type}`);
        console.log(`    状态: ${task.status}`);
        console.log(`    创建时间: ${task.created_at}`);
        console.log(`    错误信息: ${task.error_message || '无'}`);
        console.log(`    输入参数: ${JSON.stringify(task.input_params || {}).substring(0, 200)}...`);
        console.log(`    元数据: ${JSON.stringify(task.metadata || {}).substring(0, 200)}...`);
      });
    } else {
      console.log('  没有找到失败的任务');
    }
  }

  // 3. 查询管理员的失败任务
  for (const admin of admins) {
    const { data: adminFailed, error: afError } = await supabase
      .from('generations')
      .select('*')
      .eq('user_id', admin.id)
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(3);
    
    if (afError) {
      console.error(`\n查询 ${admin.name} 的失败任务出错:`, afError.message);
    } else if (adminFailed && adminFailed.length > 0) {
      console.log(`\n\n${admin.name || admin.email} 的最近3条失败任务:`);
      console.log('-'.repeat(60));
      
      adminFailed.forEach((task, i) => {
        console.log(`\n[${i + 1}] 任务 ID: ${task.id}`);
        console.log(`    类型: ${task.type}`);
        console.log(`    创建时间: ${task.created_at}`);
        console.log(`    错误信息: ${task.error_message || '无'}`);
        if (task.input_params) {
          console.log(`    图片数量: ${task.input_params.images?.length || 0}`);
          console.log(`    模特ID: ${task.input_params.modelId || '无'}`);
          console.log(`    提示词: ${(task.input_params.prompt || '').substring(0, 100)}...`);
        }
      });
    } else {
      console.log(`\n${admin.name || admin.email} 没有失败的任务`);
    }
  }

  // 4. 检查最近的视频批量任务日志
  console.log('\n\n检查服务器日志中的错误:');
  console.log('-'.repeat(60));
}

checkFailedTasks().catch(console.error);
