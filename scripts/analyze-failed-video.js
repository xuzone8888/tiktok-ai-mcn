/**
 * 分析视频生成失败的详细原因
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

async function analyzeFailed() {
  console.log('='.repeat(60));
  console.log('分析视频生成失败的详细原因');
  console.log('='.repeat(60));

  // 查询所有失败的视频任务，包含更多字段
  const { data: failed, error } = await supabase
    .from('generations')
    .select('*')
    .eq('status', 'failed')
    .eq('type', 'video')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('查询错误:', error.message);
    return;
  }

  console.log(`\n找到 ${failed.length} 条失败的视频任务\n`);

  // 分析错误类型
  const errorTypes = {};
  
  for (const task of failed) {
    const errorMsg = task.error_message || 'Unknown error';
    
    // 归类错误
    let category = 'Other';
    if (errorMsg.includes('内容政策') || errorMsg.includes('E-1103')) {
      category = '内容审核失败 (E-1103)';
    } else if (errorMsg.includes('timeout') || errorMsg.includes('超时')) {
      category = '超时';
    } else if (errorMsg.includes('繁忙') || errorMsg.includes('500')) {
      category = '服务繁忙';
    } else if (errorMsg.includes('积分') || errorMsg.includes('credit')) {
      category = '积分不足';
    }
    
    if (!errorTypes[category]) {
      errorTypes[category] = [];
    }
    errorTypes[category].push(task);
  }

  console.log('错误类型统计:');
  console.log('-'.repeat(40));
  for (const [category, tasks] of Object.entries(errorTypes)) {
    console.log(`  ${category}: ${tasks.length} 条`);
  }

  // 详细分析内容审核失败的任务
  const contentPolicyFailed = errorTypes['内容审核失败 (E-1103)'] || [];
  
  if (contentPolicyFailed.length > 0) {
    console.log('\n\n========================================');
    console.log('内容审核失败的详细信息:');
    console.log('========================================');
    
    for (let i = 0; i < Math.min(5, contentPolicyFailed.length); i++) {
      const task = contentPolicyFailed[i];
      console.log(`\n[${i + 1}] 任务 ID: ${task.task_id || task.id}`);
      console.log(`    用户 ID: ${task.user_id}`);
      console.log(`    创建时间: ${task.created_at}`);
      console.log(`    来源: ${task.source || 'unknown'}`);
      console.log(`    模型: ${task.model || 'unknown'}`);
      
      // 检查提示词
      const prompt = task.prompt || '';
      console.log(`    提示词长度: ${prompt.length} 字符`);
      console.log(`    提示词预览: ${prompt.substring(0, 150)}...`);
      
      // 检查是否有图片
      const hasImage = !!task.source_image_url;
      console.log(`    是否有参考图片: ${hasImage ? '是' : '否'}`);
      if (hasImage) {
        console.log(`    图片URL: ${task.source_image_url.substring(0, 80)}...`);
      }
      
      // 检查错误信息
      console.log(`    错误信息: ${task.error_message}`);
    }
    
    // 分析可能的原因
    console.log('\n\n========================================');
    console.log('可能的原因分析:');
    console.log('========================================');
    console.log(`
1. 图片内容问题:
   - AI 模特图片可能被误判为敏感内容
   - 某些服装、姿势可能触发审核
   
2. 提示词内容问题:
   - 检查 AI 模特的 trigger_word 是否包含敏感词
   - 用户输入的描述可能包含被审核的关键词
   
3. 第三方 API 审核策略:
   - Sora API 有严格的内容审核
   - 某些正常内容也可能被误判

建议:
   - 检查失败任务的图片是否过于暴露
   - 审核 AI 模特的 trigger_word 配置
   - 考虑添加前端提示词预检功能
   - 失败时自动退还积分（已实现）
`);
  }

  // 查看用户信息
  console.log('\n\n========================================');
  console.log('受影响用户统计:');
  console.log('========================================');
  
  const userIds = [...new Set(failed.map(t => t.user_id))];
  for (const userId of userIds) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email')
      .eq('id', userId)
      .single();
    
    const userTasks = failed.filter(t => t.user_id === userId);
    console.log(`  ${profile?.name || profile?.email || userId}: ${userTasks.length} 条失败任务`);
  }
}

analyzeFailed().catch(console.error);
