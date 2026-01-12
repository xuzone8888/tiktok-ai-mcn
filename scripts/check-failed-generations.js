/**
 * 检查失败的生成任务
 * 
 * 用法: node scripts/check-failed-generations.js
 * 
 * 需要环境变量:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 手动读取 .env.local 文件
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
        // 去除引号
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

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('错误: 缺少 Supabase 配置');
  console.error('请确保 .env.local 文件中有以下配置:');
  console.error('- NEXT_PUBLIC_SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY');
  console.error('\n当前值:');
  console.error('- NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '已设置' : '未设置');
  console.error('- SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '已设置' : '未设置');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkFailedGenerations() {
  console.log('========================================');
  console.log('🔍 检查失败的生成任务');
  console.log('========================================\n');

  // 获取今天的日期范围
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  console.log(`📅 检查时间范围: ${today.toLocaleDateString()} - ${tomorrow.toLocaleDateString()}\n`);

  try {
    // 1. 查询今天所有的生成任务
    const { data: allTasks, error: allError } = await supabase
      .from('generations')
      .select('*')
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString())
      .order('created_at', { ascending: false });

    if (allError) {
      console.error('查询失败:', allError.message);
      return;
    }

    if (!allTasks || allTasks.length === 0) {
      console.log('📭 今天没有生成任务记录');
      return;
    }

    // 统计各状态数量
    const stats = {
      total: allTasks.length,
      pending: allTasks.filter(t => t.status === 'pending').length,
      processing: allTasks.filter(t => t.status === 'processing').length,
      completed: allTasks.filter(t => t.status === 'completed').length,
      failed: allTasks.filter(t => t.status === 'failed').length,
    };

    console.log('📊 今日任务统计:');
    console.log(`   总数: ${stats.total}`);
    console.log(`   待处理: ${stats.pending}`);
    console.log(`   处理中: ${stats.processing}`);
    console.log(`   已完成: ${stats.completed} ✅`);
    console.log(`   失败: ${stats.failed} ❌`);
    console.log(`   成功率: ${((stats.completed / stats.total) * 100).toFixed(1)}%\n`);

    // 2. 显示失败任务详情
    const failedTasks = allTasks.filter(t => t.status === 'failed');
    
    if (failedTasks.length === 0) {
      console.log('🎉 今天没有失败的任务!');
      return;
    }

    console.log('========================================');
    console.log('❌ 失败任务详情:');
    console.log('========================================\n');

    // 按错误类型分组统计
    const errorGroups = {};

    failedTasks.forEach((task, index) => {
      const errorMsg = task.error_message || '未知错误';
      
      // 统计错误类型
      if (!errorGroups[errorMsg]) {
        errorGroups[errorMsg] = [];
      }
      errorGroups[errorMsg].push(task);

      console.log(`--- 任务 ${index + 1} ---`);
      console.log(`  ID: ${task.id}`);
      console.log(`  Task ID: ${task.task_id || 'N/A'}`);
      console.log(`  类型: ${task.type}`);
      console.log(`  来源: ${task.source}`);
      console.log(`  模型: ${task.model || 'N/A'}`);
      console.log(`  时长: ${task.duration || 'N/A'}秒`);
      console.log(`  比例: ${task.aspect_ratio || 'N/A'}`);
      console.log(`  积分消耗: ${task.credit_cost || 0}`);
      console.log(`  创建时间: ${new Date(task.created_at).toLocaleString()}`);
      console.log(`  错误信息: ${errorMsg}`);
      console.log(`  提示词: ${(task.prompt || '').substring(0, 100)}...`);
      console.log('');
    });

    // 3. 错误类型汇总
    console.log('========================================');
    console.log('📋 错误类型汇总:');
    console.log('========================================\n');

    Object.entries(errorGroups).forEach(([error, tasks]) => {
      console.log(`❌ ${error}`);
      console.log(`   数量: ${tasks.length} 个任务`);
      console.log(`   模型分布: ${[...new Set(tasks.map(t => t.model))].join(', ')}`);
      console.log('');
    });

    // 4. 检查是否有长时间处于 processing 状态的任务（可能卡住）
    const processingTasks = allTasks.filter(t => t.status === 'processing');
    const stuckTasks = processingTasks.filter(t => {
      const created = new Date(t.created_at);
      const now = new Date();
      const diffMinutes = (now - created) / 1000 / 60;
      return diffMinutes > 30; // 超过30分钟认为可能卡住
    });

    if (stuckTasks.length > 0) {
      console.log('========================================');
      console.log('⚠️ 可能卡住的任务 (处理超过30分钟):');
      console.log('========================================\n');

      stuckTasks.forEach((task, index) => {
        const created = new Date(task.created_at);
        const now = new Date();
        const diffMinutes = Math.round((now - created) / 1000 / 60);

        console.log(`--- 任务 ${index + 1} ---`);
        console.log(`  ID: ${task.id}`);
        console.log(`  Task ID: ${task.task_id || 'N/A'}`);
        console.log(`  类型: ${task.type}`);
        console.log(`  模型: ${task.model || 'N/A'}`);
        console.log(`  已处理: ${diffMinutes} 分钟`);
        console.log('');
      });
    }

    // 5. 建议
    console.log('========================================');
    console.log('💡 可能的原因和建议:');
    console.log('========================================\n');

    const hasApiError = Object.keys(errorGroups).some(e => 
      e.includes('API') || e.includes('timeout') || e.includes('网络')
    );
    const hasServerError = Object.keys(errorGroups).some(e => 
      e.includes('500') || e.includes('502') || e.includes('503') || e.includes('服务')
    );
    const hasRateLimit = Object.keys(errorGroups).some(e => 
      e.includes('429') || e.includes('rate') || e.includes('限制')
    );

    if (hasApiError) {
      console.log('🔗 API 连接问题:');
      console.log('   - 检查 SORA2_API_KEY 是否有效');
      console.log('   - 检查 SORA2_API_ENDPOINT 是否正确');
      console.log('   - 检查服务器网络连接');
      console.log('');
    }

    if (hasServerError) {
      console.log('🖥️ 上游服务器问题:');
      console.log('   - 第三方 API 服务可能不稳定');
      console.log('   - 建议稍后重试');
      console.log('');
    }

    if (hasRateLimit) {
      console.log('⏱️ 速率限制问题:');
      console.log('   - 可能请求过于频繁');
      console.log('   - 建议增加请求间隔');
      console.log('');
    }

    console.log('📝 通用建议:');
    console.log('   - 检查服务器日志: pm2 logs');
    console.log('   - 检查 API 余额');
    console.log('   - 尝试手动测试 API 接口');

  } catch (error) {
    console.error('执行出错:', error);
  }
}

// 运行检查
checkFailedGenerations().then(() => {
  console.log('\n✅ 检查完成');
  process.exit(0);
}).catch(err => {
  console.error('检查失败:', err);
  process.exit(1);
});
