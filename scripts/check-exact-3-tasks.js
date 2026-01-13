/**
 * 精确查询管理员的 3 条特定任务
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

// 直接查询 Sora API
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
      timeout: 30000,
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Parse error', raw: data.substring(0, 500) });
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

async function checkExact3Tasks() {
  console.log('='.repeat(70));
  console.log('精确查询管理员账户创建的 3 条特定任务');
  console.log('='.repeat(70));

  // 获取管理员 ID
  const { data: admin } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('role', 'super_admin')
    .single();

  console.log(`\n管理员: ${admin.name} (${admin.id})`);

  // 查找提示词包含 "bodreams.gloriaener" 和 "Scene Setting" 的任务
  // 这是截图中显示的任务特征
  const { data: tasks, error } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', admin.id)
    .eq('type', 'video')
    .ilike('prompt', '%bodreams.gloriaener%')
    .ilike('prompt', '%Scene Setting%')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('查询错误:', error.message);
    return;
  }

  console.log(`\n找到 ${tasks.length} 条匹配的任务\n`);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log('='.repeat(70));
    console.log(`【任务 ${i + 1}】`);
    console.log('='.repeat(70));
    
    console.log(`\n📋 数据库信息:`);
    console.log(`   任务 ID: ${task.task_id}`);
    console.log(`   数据库状态: ${task.status}`);
    console.log(`   创建时间: ${task.created_at}`);
    console.log(`   完成时间: ${task.completed_at || '未完成'}`);
    console.log(`   模型: ${task.model}`);
    console.log(`   来源: ${task.source}`);
    console.log(`   视频URL: ${task.video_url ? '有' : '无'}`);
    console.log(`   错误信息: ${task.error_message || '无'}`);
    console.log(`   提示词: ${task.prompt.substring(0, 80)}...`);

    // 直接查询 Sora API 获取真实状态
    console.log(`\n🔍 查询 Sora API 真实状态...`);
    const soraResult = await querySoraStatus(task.task_id);
    
    console.log(`\n📡 Sora API 响应:`);
    console.log(`   API 状态: ${soraResult.status || soraResult.error || 'unknown'}`);
    console.log(`   进度: ${soraResult.progress || 0}%`);
    
    if (soraResult.video_url) {
      console.log(`   ✅ 视频已生成!`);
      console.log(`   视频URL: ${soraResult.video_url.substring(0, 80)}...`);
      
      // 如果数据库状态不是 completed，更新它
      if (task.status !== 'completed') {
        console.log(`\n   🔄 正在更新数据库状态...`);
        const { error: updateError } = await supabase
          .from('generations')
          .update({
            status: 'completed',
            video_url: soraResult.video_url,
            result_url: soraResult.video_url,
            completed_at: new Date().toISOString(),
          })
          .eq('task_id', task.task_id);
        
        if (updateError) {
          console.log(`   ❌ 更新失败: ${updateError.message}`);
        } else {
          console.log(`   ✅ 数据库已更新为 completed`);
        }
      }
    } else if (soraResult.status === 'failed') {
      console.log(`   ❌ 视频生成失败!`);
      console.log(`   失败原因: ${soraResult.error?.message || JSON.stringify(soraResult)}`);
      
      // 如果数据库状态不是 failed，更新它
      if (task.status !== 'failed') {
        console.log(`\n   🔄 正在更新数据库状态...`);
        const { error: updateError } = await supabase
          .from('generations')
          .update({
            status: 'failed',
            error_message: soraResult.error?.message || 'Sora API 返回失败状态',
          })
          .eq('task_id', task.task_id);
        
        if (updateError) {
          console.log(`   ❌ 更新失败: ${updateError.message}`);
        } else {
          console.log(`   ✅ 数据库已更新为 failed`);
        }
      }
    } else if (soraResult.status === 'in_progress' || soraResult.status === 'queued') {
      console.log(`   🔄 任务仍在处理中...`);
      console.log(`   当前状态: ${soraResult.status}`);
      console.log(`   进度: ${soraResult.progress}%`);
    } else if (soraResult.error) {
      console.log(`   ⚠️ API 查询出错: ${soraResult.error}`);
      if (soraResult.raw) {
        console.log(`   原始响应: ${soraResult.raw}`);
      }
    } else {
      console.log(`   ⚠️ 未知状态`);
      console.log(`   完整响应: ${JSON.stringify(soraResult).substring(0, 300)}`);
    }

    // 分析超时原因
    console.log(`\n📊 分析:`);
    const createdAt = new Date(task.created_at);
    const now = new Date();
    const waitMinutes = Math.round((now - createdAt) / 60000);
    console.log(`   已等待时间: ${waitMinutes} 分钟`);
    
    if (task.model.includes('pro')) {
      console.log(`   模型类型: Pro版 (预计 15-30 分钟)`);
    } else {
      console.log(`   模型类型: 标清版 (预计 3-8 分钟)`);
    }

    console.log('');
  }

  // 总结
  console.log('\n' + '='.repeat(70));
  console.log('📋 总结');
  console.log('='.repeat(70));
  
  const completed = tasks.filter(t => t.status === 'completed' || t.video_url).length;
  const processing = tasks.filter(t => t.status === 'processing' && !t.video_url).length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  
  console.log(`\n   已完成: ${completed} 条`);
  console.log(`   处理中: ${processing} 条`);
  console.log(`   失败: ${failed} 条`);
}

checkExact3Tasks().catch(console.error);
