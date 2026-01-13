/**
 * 直接查询 Sora API 获取任务真实状态
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

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

const SORA2_API_BASE = env.SORA2_API_ENDPOINT || "https://api.scd666.com";
const SORA2_API_KEY = env.SORA2_API_KEY || "";

async function querySoraStatus(taskId) {
  return new Promise((resolve, reject) => {
    const endpoint = `${SORA2_API_BASE}/v1/videos/${taskId}`;
    const url = new URL(endpoint);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'GET',
      family: 4,
      headers: {
        'Authorization': `Bearer ${SORA2_API_KEY}`,
        'Accept': 'application/json',
      },
      timeout: 30000,
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Parse error', raw: data.substring(0, 200) });
        }
      });
    });
    
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'Timeout' });
    });
    
    req.end();
  });
}

async function checkProcessingTasks() {
  console.log('='.repeat(60));
  console.log('检查 processing 状态任务的 Sora API 真实状态');
  console.log('='.repeat(60));

  // 获取 processing 状态的任务
  const { data: tasks } = await supabase
    .from('generations')
    .select('*')
    .eq('status', 'processing')
    .eq('type', 'video')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!tasks || tasks.length === 0) {
    console.log('\n没有 processing 状态的任务');
    return;
  }

  console.log(`\n找到 ${tasks.length} 条 processing 状态的任务\n`);

  for (const task of tasks) {
    console.log('-'.repeat(60));
    console.log(`任务 ID: ${task.task_id}`);
    console.log(`数据库状态: ${task.status}`);
    console.log(`创建时间: ${task.created_at}`);
    
    // 查询 Sora API 真实状态
    const soraStatus = await querySoraStatus(task.task_id);
    console.log(`\nSora API 响应:`);
    console.log(`  状态: ${soraStatus.status || soraStatus.error || 'unknown'}`);
    console.log(`  进度: ${soraStatus.progress || 0}%`);
    
    if (soraStatus.video_url) {
      console.log(`  视频URL: 已生成!`);
      console.log(`  需要更新数据库状态为 completed`);
      
      // 更新数据库
      const { error: updateError } = await supabase
        .from('generations')
        .update({
          status: 'completed',
          video_url: soraStatus.video_url,
          result_url: soraStatus.video_url,
          completed_at: new Date().toISOString(),
        })
        .eq('task_id', task.task_id);
      
      if (updateError) {
        console.log(`  ❌ 更新失败: ${updateError.message}`);
      } else {
        console.log(`  ✅ 已更新数据库状态为 completed`);
      }
    } else if (soraStatus.status === 'failed') {
      console.log(`  错误信息: ${soraStatus.error?.message || 'unknown'}`);
      console.log(`  需要更新数据库状态为 failed`);
      
      // 更新数据库
      const { error: updateError } = await supabase
        .from('generations')
        .update({
          status: 'failed',
          error_message: soraStatus.error?.message || 'API 返回失败状态',
        })
        .eq('task_id', task.task_id);
      
      if (updateError) {
        console.log(`  ❌ 更新失败: ${updateError.message}`);
      } else {
        console.log(`  ✅ 已更新数据库状态为 failed`);
      }
    } else {
      console.log(`  任务仍在处理中...`);
    }
    
    console.log('');
  }
}

checkProcessingTasks().catch(console.error);
