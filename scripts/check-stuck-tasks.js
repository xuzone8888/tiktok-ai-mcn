/**
 * 检查并更新卡住的任务状态
 * 
 * 功能：
 * 1. 查询数据库中 status='processing' 的任务
 * 2. 通过 Sora2 API 查询真实状态
 * 3. 更新数据库状态
 * 4. 统计积分消耗情况
 * 
 * 用法: node scripts/check-stuck-tasks.js [--update] [--refund]
 *   --update: 更新数据库状态
 *   --refund: 对失败任务退还积分
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 环境变量加载
// ============================================================================

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('找不到 .env.local 文件');
    return {};
  }
  
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=');
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[key.trim()] = value;
      }
    }
  });
  
  return env;
}

const env = loadEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const sora2ApiKey = env.SORA2_API_KEY || process.env.SORA2_API_KEY;
const sora2ApiEndpoint = env.SORA2_API_ENDPOINT || process.env.SORA2_API_ENDPOINT || 'https://api.scd666.com';
const veo3ApiKey = env.VEO3_API_KEY || process.env.VEO3_API_KEY;
const veo3ApiEndpoint = env.VEO3_API_ENDPOINT || process.env.VEO3_API_ENDPOINT || 'https://api.apimart.ai';

// 参数解析
const args = process.argv.slice(2);
const shouldUpdate = args.includes('--update');
const shouldRefund = args.includes('--refund');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('错误: 缺少 Supabase 配置');
  process.exit(1);
}

if (!sora2ApiKey) {
  console.error('错误: 缺少 SORA2_API_KEY 配置');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ============================================================================
// Sora2 API 查询函数
// ============================================================================

async function querySora2Status(taskId) {
  return new Promise((resolve, reject) => {
    const endpoint = `${sora2ApiEndpoint}/v1/videos/${taskId}`;
    const url = new URL(endpoint);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'GET',
      family: 4,
      headers: {
        'Authorization': `Bearer ${sora2ApiKey}`,
        'Accept': 'application/json',
      },
      timeout: 30000,
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            success: true,
            status: json.status,
            videoUrl: json.video_url,
            error: json.error?.message,
            raw: json,
          });
        } catch (e) {
          resolve({ success: false, error: 'JSON 解析失败' });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: '请求超时' });
    });
    
    req.end();
  });
}

// ============================================================================
// VEO3 API 查询函数
// ============================================================================

async function queryVeo3Status(taskId) {
  if (!veo3ApiKey) {
    return { success: false, error: 'VEO3 API key not configured' };
  }
  
  return new Promise((resolve, reject) => {
    const endpoint = `${veo3ApiEndpoint}/v1/tasks/${taskId}`;
    const url = new URL(endpoint);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'GET',
      family: 4,
      headers: {
        'Authorization': `Bearer ${veo3ApiKey}`,
        'Accept': 'application/json',
      },
      timeout: 30000,
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          
          // VEO3 响应格式处理
          if (json.code === 200 && json.data) {
            const taskData = json.data;
            let videoUrl = null;
            
            // 从 result.videos 中提取视频 URL
            if (taskData.result?.videos?.[0]?.url?.[0]) {
              videoUrl = taskData.result.videos[0].url[0];
            }
            
            // 状态映射
            const statusMap = {
              'pending': 'pending',
              'processing': 'processing',
              'completed': 'completed',
              'failed': 'failed',
            };
            
            resolve({
              success: true,
              status: statusMap[taskData.status] || taskData.status,
              videoUrl: videoUrl,
              error: taskData.error?.message || taskData.result?.error,
              raw: json,
            });
          } else {
            resolve({ 
              success: false, 
              error: json.message || `API error: code ${json.code}` 
            });
          }
        } catch (e) {
          resolve({ success: false, error: 'JSON 解析失败' });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: '请求超时' });
    });
    
    req.end();
  });
}

// ============================================================================
// 主函数
// ============================================================================

async function checkStuckTasks() {
  console.log('========================================');
  console.log('🔍 检查卡住的任务');
  console.log('========================================\n');
  console.log(`模式: ${shouldUpdate ? '更新数据库' : '仅检查'}${shouldRefund ? ' + 退还积分' : ''}\n`);

  // 获取今天的日期范围
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    // 1. 查询所有处于 processing 状态的任务
    const { data: processingTasks, error: queryError } = await supabase
      .from('generations')
      .select('*')
      .eq('status', 'processing')
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false });

    if (queryError) {
      console.error('查询失败:', queryError.message);
      return;
    }

    if (!processingTasks || processingTasks.length === 0) {
      console.log('📭 没有处于 processing 状态的任务');
      return;
    }

    console.log(`📊 找到 ${processingTasks.length} 个处于 "processing" 状态的任务\n`);

    // 统计
    const stats = {
      total: processingTasks.length,
      actuallyProcessing: 0,  // 确实在处理中
      completed: 0,           // 实际已完成
      failed: 0,              // 实际已失败
      unknown: 0,             // 无法查询
      totalCredits: 0,        // 总积分消耗
      creditsToRefund: 0,     // 需要退还的积分
    };

    const tasksToUpdate = [];
    const tasksToRefund = [];

    // 2. 逐个检查任务状态
    console.log('正在检查每个任务的真实状态...\n');
    
    for (let i = 0; i < processingTasks.length; i++) {
      const task = processingTasks[i];
      const taskId = task.task_id;
      
      stats.totalCredits += task.credit_cost || 0;

      // 显示进度
      process.stdout.write(`\r检查进度: ${i + 1}/${processingTasks.length}`);

      // 判断任务类型：VEO3 或 Sora2
      const isVeo3Task = task.source?.includes('veo3') || taskId?.startsWith('task_');
      const isSora2Task = taskId?.startsWith('video_');
      
      if (!taskId || (!isVeo3Task && !isSora2Task)) {
        // 非视频任务或无效 task_id
        stats.unknown++;
        // 记录详情
        if (!stats.unknownDetails) stats.unknownDetails = [];
        stats.unknownDetails.push({
          id: task.id,
          taskId: taskId,
          type: task.type,
          source: task.source,
          creditCost: task.credit_cost,
        });
        continue;
      }

      let result;
      
      if (isVeo3Task) {
        // VEO3 任务
        if (!veo3ApiKey) {
          stats.unknown++;
          if (!stats.unknownDetails) stats.unknownDetails = [];
          stats.unknownDetails.push({
            id: task.id,
            taskId: taskId,
            type: task.type,
            source: task.source,
            creditCost: task.credit_cost,
            reason: 'VEO3 API key 未配置',
          });
          continue;
        }
        result = await queryVeo3Status(taskId);
      } else {
        // Sora2 任务 - 提取真实的任务 ID
        const sora2TaskId = taskId.replace('video_', '');
        result = await querySora2Status(sora2TaskId);
      }
      
      if (!result.success) {
        stats.unknown++;
        continue;
      }

      // 状态映射
      const statusMap = {
        'queued': 'processing',
        'processing': 'processing',
        'completed': 'completed',
        'failed': 'failed',
      };

      const realStatus = statusMap[result.status] || 'processing';

      if (realStatus === 'completed') {
        stats.completed++;
        tasksToUpdate.push({
          id: task.id,
          status: 'completed',
          result_url: result.videoUrl,
        });
      } else if (realStatus === 'failed') {
        stats.failed++;
        tasksToUpdate.push({
          id: task.id,
          status: 'failed',
          error_message: result.error || '第三方 API 返回失败',
        });
        // 记录需要退款的任务
        if (task.credit_cost > 0) {
          tasksToRefund.push({
            id: task.id,
            userId: task.user_id,
            creditCost: task.credit_cost,
          });
          stats.creditsToRefund += task.credit_cost;
        }
      } else {
        stats.actuallyProcessing++;
      }

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('\n\n========================================');
    console.log('📊 检查结果统计');
    console.log('========================================\n');
    
    console.log(`总任务数: ${stats.total}`);
    console.log(`实际处理中: ${stats.actuallyProcessing}`);
    console.log(`已完成 (需更新): ${stats.completed} ✅`);
    console.log(`已失败 (需更新): ${stats.failed} ❌`);
    console.log(`无法查询: ${stats.unknown}`);
    console.log('');
    console.log(`总积分消耗: ${stats.totalCredits}`);
    console.log(`需要退还积分: ${stats.creditsToRefund}`);

    // 显示无法查询的任务详情
    if (stats.unknownDetails && stats.unknownDetails.length > 0) {
      console.log('\n========================================');
      console.log('❓ 无法查询的任务详情');
      console.log('========================================\n');
      
      // 按类型分组统计
      const typeStats = {};
      const sourceStats = {};
      let unknownCredits = 0;
      
      for (const task of stats.unknownDetails) {
        typeStats[task.type] = (typeStats[task.type] || 0) + 1;
        sourceStats[task.source] = (sourceStats[task.source] || 0) + 1;
        unknownCredits += task.creditCost || 0;
      }
      
      console.log('按类型分组:');
      for (const [type, count] of Object.entries(typeStats)) {
        console.log(`  - ${type}: ${count} 个`);
      }
      
      console.log('\n按来源分组:');
      for (const [source, count] of Object.entries(sourceStats)) {
        console.log(`  - ${source}: ${count} 个`);
      }
      
      console.log(`\n无法查询任务的积分消耗: ${unknownCredits}`);
      
      // 显示几个样例
      console.log('\n样例任务:');
      stats.unknownDetails.slice(0, 5).forEach((task, i) => {
        console.log(`  ${i + 1}. ID: ${task.id.substring(0, 8)}..., TaskID: ${task.taskId || 'null'}, 类型: ${task.type}, 来源: ${task.source}${task.reason ? `, 原因: ${task.reason}` : ''}`);
      });
      
      // 如果是因为 VEO3 API key 未配置
      const veo3MissingKey = stats.unknownDetails.filter(t => t.reason?.includes('VEO3'));
      if (veo3MissingKey.length > 0) {
        console.log(`\n⚠️  ${veo3MissingKey.length} 个 VEO3 任务因 API key 未配置无法查询`);
        console.log('   请在 .env.local 中配置 VEO3_API_KEY');
      }
    }

    // 3. 更新数据库
    if (shouldUpdate && tasksToUpdate.length > 0) {
      console.log('\n========================================');
      console.log('📝 更新数据库状态');
      console.log('========================================\n');

      let updateSuccess = 0;
      let updateFailed = 0;

      for (const task of tasksToUpdate) {
        const updateData = {
          status: task.status,
        };
        
        if (task.result_url) {
          updateData.result_url = task.result_url;
        }
        if (task.error_message) {
          updateData.error_message = task.error_message;
        }

        const { error } = await supabase
          .from('generations')
          .update(updateData)
          .eq('id', task.id);

        if (error) {
          updateFailed++;
          console.error(`更新失败 ${task.id}:`, error.message);
        } else {
          updateSuccess++;
        }
      }

      console.log(`更新成功: ${updateSuccess}`);
      console.log(`更新失败: ${updateFailed}`);
    }

    // 4. 退还积分
    if (shouldRefund && tasksToRefund.length > 0) {
      console.log('\n========================================');
      console.log('💰 退还积分');
      console.log('========================================\n');

      // 按用户分组
      const refundsByUser = {};
      for (const task of tasksToRefund) {
        if (!refundsByUser[task.userId]) {
          refundsByUser[task.userId] = 0;
        }
        refundsByUser[task.userId] += task.creditCost;
      }

      let refundSuccess = 0;
      let refundFailed = 0;

      for (const [userId, amount] of Object.entries(refundsByUser)) {
        // 获取用户当前积分
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('credits')
          .eq('id', userId)
          .single();

        if (profileError || !profile) {
          refundFailed++;
          console.error(`获取用户积分失败 ${userId}`);
          continue;
        }

        // 更新积分
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ credits: profile.credits + amount })
          .eq('id', userId);

        if (updateError) {
          refundFailed++;
          console.error(`退还积分失败 ${userId}:`, updateError.message);
        } else {
          refundSuccess++;
          console.log(`✅ 用户 ${userId.substring(0, 8)}... 退还 ${amount} 积分`);
        }
      }

      console.log(`\n退还成功: ${refundSuccess} 用户`);
      console.log(`退还失败: ${refundFailed} 用户`);
      console.log(`总退还积分: ${stats.creditsToRefund}`);
    }

    // 5. 输出详细信息
    if (!shouldUpdate && tasksToUpdate.length > 0) {
      console.log('\n========================================');
      console.log('📋 需要更新的任务详情');
      console.log('========================================\n');

      console.log('【已完成但数据库未更新的任务】');
      const completedTasks = tasksToUpdate.filter(t => t.status === 'completed');
      completedTasks.slice(0, 5).forEach(t => {
        console.log(`  - ${t.id}`);
      });
      if (completedTasks.length > 5) {
        console.log(`  ... 还有 ${completedTasks.length - 5} 个`);
      }

      console.log('\n【已失败但数据库未更新的任务】');
      const failedTasks = tasksToUpdate.filter(t => t.status === 'failed');
      failedTasks.slice(0, 5).forEach(t => {
        console.log(`  - ${t.id}: ${t.error_message}`);
      });
      if (failedTasks.length > 5) {
        console.log(`  ... 还有 ${failedTasks.length - 5} 个`);
      }

      console.log('\n💡 提示: 使用 --update 参数来更新数据库状态');
      console.log('💡 提示: 使用 --refund 参数来退还失败任务的积分');
      console.log('💡 示例: node scripts/check-stuck-tasks.js --update --refund');
    }

  } catch (error) {
    console.error('执行出错:', error);
  }
}

// 运行
checkStuckTasks().then(() => {
  console.log('\n✅ 检查完成');
  process.exit(0);
}).catch(err => {
  console.error('检查失败:', err);
  process.exit(1);
});
