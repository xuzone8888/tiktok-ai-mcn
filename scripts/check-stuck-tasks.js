/**
 * 检查卡住的任务（等待超过 30 分钟的 processing 任务）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

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
  return new Promise((resolve) => {
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
      timeout: 15000,
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

async function checkStuckTasks() {
  console.log('='.repeat(70));
  console.log('检查卡住的任务（等待超过 30 分钟）');
  console.log('='.repeat(70));

  // 获取所有 processing 状态且创建时间超过 30 分钟的任务
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  
  const { data: stuckTasks, error } = await supabase
    .from('generations')
    .select('task_id, created_at, user_id, status')
    .eq('type', 'video')
    .eq('status', 'processing')
    .lt('created_at', thirtyMinAgo)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('查询错误:', error.message);
    return;
  }

  console.log(`\n找到 ${stuckTasks.length} 条卡住的任务（超过 30 分钟未完成）`);

  if (stuckTasks.length === 0) return;

  // 抽样检查 10 条任务的 Sora API 真实状态
  console.log('\n抽样检查 Sora API 真实状态（前 10 条）：');
  console.log('-'.repeat(70));

  const statusSummary = { completed: 0, failed: 0, queued: 0, in_progress: 0, error: 0 };

  for (let i = 0; i < Math.min(10, stuckTasks.length); i++) {
    const task = stuckTasks[i];
    const waitMinutes = Math.round((Date.now() - new Date(task.created_at)) / 60000);
    
    console.log(`\n[${i + 1}] 任务: ${task.task_id}`);
    console.log(`    等待时间: ${waitMinutes} 分钟`);
    
    const soraResult = await querySoraStatus(task.task_id);
    
    if (soraResult.error) {
      console.log(`    Sora API: ❌ ${soraResult.error}`);
      statusSummary.error++;
    } else if (soraResult.video_url) {
      console.log(`    Sora API: ✅ 已完成！视频URL存在`);
      statusSummary.completed++;
      
      // 更新数据库
      await supabase
        .from('generations')
        .update({
          status: 'completed',
          video_url: soraResult.video_url,
          result_url: soraResult.video_url,
          completed_at: new Date().toISOString(),
        })
        .eq('task_id', task.task_id);
      console.log(`    已更新数据库状态为 completed`);
    } else if (soraResult.status === 'failed') {
      console.log(`    Sora API: ❌ 已失败 - ${soraResult.error?.message || 'unknown'}`);
      statusSummary.failed++;
      
      // 更新数据库
      await supabase
        .from('generations')
        .update({
          status: 'failed',
          error_message: soraResult.error?.message || 'API 返回失败状态',
        })
        .eq('task_id', task.task_id);
      console.log(`    已更新数据库状态为 failed`);
    } else if (soraResult.status === 'queued') {
      console.log(`    Sora API: ⏳ 排队中 (queued)`);
      statusSummary.queued++;
    } else if (soraResult.status === 'in_progress') {
      console.log(`    Sora API: 🔄 处理中 (${soraResult.progress || 0}%)`);
      statusSummary.in_progress++;
    } else {
      console.log(`    Sora API: ❓ 未知状态 - ${JSON.stringify(soraResult).substring(0, 100)}`);
      statusSummary.error++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('抽样统计:');
  console.log('='.repeat(70));
  console.log(`  已完成（需同步）: ${statusSummary.completed}`);
  console.log(`  已失败（需同步）: ${statusSummary.failed}`);
  console.log(`  排队中: ${statusSummary.queued}`);
  console.log(`  处理中: ${statusSummary.in_progress}`);
  console.log(`  查询错误: ${statusSummary.error}`);
  
  if (statusSummary.queued > 0) {
    console.log('\n⚠️ 有任务仍在 Sora API 排队中，说明 API 服务可能繁忙或有并发限制');
  }
  
  if (statusSummary.completed > 0 || statusSummary.failed > 0) {
    console.log('\n✅ 已自动同步数据库状态');
  }
}

checkStuckTasks().catch(console.error);
