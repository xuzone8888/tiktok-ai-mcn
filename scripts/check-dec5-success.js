/**
 * 检查 2025-12-05 成功的有图片任务
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
  console.log('='.repeat(70));
  console.log('检查 2025-12-05 成功的有图片任务');
  console.log('='.repeat(70));

  // 查找 HUPLUS 用户
  const { data: user } = await supabase
    .from('profiles')
    .select('id')
    .ilike('name', '%HUPLUS%')
    .single();

  // 查询 2025-12-05 的成功任务
  const { data: tasks } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'video')
    .eq('status', 'completed')
    .gte('created_at', '2025-12-05T00:00:00')
    .lt('created_at', '2025-12-06T00:00:00')
    .not('source_image_url', 'is', null)
    .order('created_at', { ascending: true });

  console.log(`\n2025-12-05 成功的有图片任务: ${tasks?.length || 0} 条`);

  if (tasks && tasks.length > 0) {
    // 输出图片 URL
    const imageUrls = new Set();
    tasks.forEach(t => {
      if (t.source_image_url) imageUrls.add(t.source_image_url);
    });

    console.log(`\n唯一图片数: ${imageUrls.size}`);
    console.log('\n成功的图片 URL:');
    console.log('-'.repeat(70));
    
    let i = 0;
    for (const url of imageUrls) {
      i++;
      console.log(`\n[${i}] ${url}`);
    }

    // 查看任务详情
    console.log('\n\n' + '='.repeat(70));
    console.log('任务详情:');
    console.log('='.repeat(70));

    for (let i = 0; i < Math.min(5, tasks.length); i++) {
      const task = tasks[i];
      console.log(`\n[${i + 1}] 任务 ID: ${task.task_id || task.id}`);
      console.log(`    创建时间: ${task.created_at}`);
      console.log(`    完成时间: ${task.completed_at}`);
      console.log(`    图片: ${task.source_image_url}`);
      console.log(`    有模特: ${task.prompt?.includes('[AI MODEL:') ? '是' : '否'}`);
      console.log(`    提示词预览: ${task.prompt?.substring(0, 150)}...`);
    }
  }

  // 也检查最近失败的任务使用的图片
  console.log('\n\n' + '='.repeat(70));
  console.log('对比：最近失败的任务使用的图片');
  console.log('='.repeat(70));

  const { data: failedTasks } = await supabase
    .from('generations')
    .select('source_image_url, created_at')
    .eq('user_id', user.id)
    .eq('type', 'video')
    .eq('status', 'failed')
    .not('source_image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (failedTasks && failedTasks.length > 0) {
    const failedUrls = new Set();
    failedTasks.forEach(t => {
      if (t.source_image_url) failedUrls.add(t.source_image_url);
    });

    console.log(`\n失败的唯一图片数: ${failedUrls.size}`);
    console.log('\n失败的图片 URL:');
    
    let j = 0;
    for (const url of failedUrls) {
      j++;
      console.log(`\n[${j}] ${url}`);
    }
  }
}

check().catch(console.error);
