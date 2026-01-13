/**
 * 检查今天卡住的任务
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
          resolve({ parseError: true, raw: data.substring(0, 200) });
        }
      });
    });
    
    req.on('error', (e) => resolve({ networkError: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ timeout: true });
    });
    
    req.end();
  });
}

async function checkTodayStuck() {
  console.log('='.repeat(70));
  console.log('检查今天卡住的任务（等待超过 15 分钟）');
  console.log('='.repeat(70));

  // 今天开始时间
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  // 15 分钟前
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  
  const { data: stuckTasks, error } = await supabase
    .from('generations')
    .select('task_id, created_at, user_id, status, prompt')
    .eq('type', 'video')
    .eq('status', 'processing')
    .gte('created_at', todayISO)
    .lt('created_at', fifteenMinAgo)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error('查询错误:', error.message);
    return;
  }

  console.log(`\n今天创建且超过 15 分钟未完成的任务: ${stuckTasks.length} 条`);

  if (stuckTasks.length === 0) {
    console.log('没有卡住的任务！');
    return;
  }

  const statusSummary = { completed: 0, failed: 0, queued: 0, in_progress: 0, not_found: 0, error: 0 };
  const updatedTasks = [];

  console.log('\n检查 Sora API 真实状态：');
  console.log('-'.repeat(70));

  for (let i = 0; i < stuckTasks.length; i++) {
    const task = stuckTasks[i];
    const waitMinutes = Math.round((Date.now() - new Date(task.created_at)) / 60000);
    
    process.stdout.write(`\r检查进度: ${i + 1}/${stuckTasks.length}`);
    
    const soraResult = await querySoraStatus(task.task_id);
    
    if (soraResult.networkError || soraResult.timeout || soraResult.parseError) {
      statusSummary.error++;
    } else if (soraResult.video_url) {
      statusSummary.completed++;
      updatedTasks.push({ task, action: 'completed', url: soraResult.video_url });
    } else if (soraResult.status === 'failed' || soraResult.code === 'NOT_FOUND' || soraResult.error) {
      statusSummary.failed++;
      const errMsg = soraResult.error?.message || soraResult.message || '任务在API端不存在或已过期';
      updatedTasks.push({ task, action: 'failed', error: errMsg });
    } else if (soraResult.status === 'queued') {
      statusSummary.queued++;
    } else if (soraResult.status === 'in_progress') {
      statusSummary.in_progress++;
    } else {
      // 未知响应，可能是任务不存在
      statusSummary.not_found++;
      updatedTasks.push({ task, action: 'failed', error: '任务状态无法确认' });
    }
  }

  console.log('\n\n' + '='.repeat(70));
  console.log('Sora API 状态统计:');
  console.log('='.repeat(70));
  console.log(`  ✅ 已完成（数据库未同步）: ${statusSummary.completed}`);
  console.log(`  ❌ 已失败/不存在: ${statusSummary.failed + statusSummary.not_found}`);
  console.log(`  ⏳ 排队中 (queued): ${statusSummary.queued}`);
  console.log(`  🔄 处理中 (in_progress): ${statusSummary.in_progress}`);
  console.log(`  ⚠️ 查询错误: ${statusSummary.error}`);

  // 同步数据库
  if (updatedTasks.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('同步数据库状态:');
    console.log('='.repeat(70));

    for (const { task, action, url, error } of updatedTasks) {
      if (action === 'completed') {
        await supabase
          .from('generations')
          .update({
            status: 'completed',
            video_url: url,
            result_url: url,
            completed_at: new Date().toISOString(),
          })
          .eq('task_id', task.task_id);
        console.log(`  ✅ ${task.task_id} -> completed`);
      } else if (action === 'failed') {
        await supabase
          .from('generations')
          .update({
            status: 'failed',
            error_message: error,
          })
          .eq('task_id', task.task_id);
        console.log(`  ❌ ${task.task_id} -> failed: ${error.substring(0, 50)}`);
      }
    }

    console.log(`\n同步完成: ${updatedTasks.length} 条任务状态已更新`);
  }

  // 分析结论
  console.log('\n' + '='.repeat(70));
  console.log('📊 结论:');
  console.log('='.repeat(70));
  
  if (statusSummary.queued > 0) {
    console.log(`\n⚠️ 有 ${statusSummary.queued} 条任务在 Sora API 排队中`);
    console.log('   原因: API 服务繁忙或达到并发限制');
    console.log('   建议: 等待或减少同时提交的任务数量');
  }
  
  if (statusSummary.in_progress > 0) {
    console.log(`\n🔄 有 ${statusSummary.in_progress} 条任务正在 Sora API 处理中`);
    console.log('   说明: 这些任务正常，只是生成时间较长');
  }
  
  if (statusSummary.completed > 0 || statusSummary.failed > 0 || statusSummary.not_found > 0) {
    console.log(`\n✅ 已同步 ${updatedTasks.length} 条任务的数据库状态`);
  }
}

checkTodayStuck().catch(console.error);
