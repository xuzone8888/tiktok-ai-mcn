/**
 * 分析 HUPLUS 用户的视频生成问题
 * 对比：有图片/模特 vs 纯提示词 的成功率
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

async function analyzeHuplus() {
  console.log('='.repeat(70));
  console.log('分析 HUPLUS 用户的视频生成问题');
  console.log('='.repeat(70));

  // 查找 HUPLUS 用户
  const { data: user } = await supabase
    .from('profiles')
    .select('id, name, email')
    .or('name.ilike.%HUPLUS%,email.ilike.%HUPLUS%')
    .single();

  if (!user) {
    console.log('未找到 HUPLUS 用户');
    return;
  }

  console.log(`\n用户: ${user.name || user.email} (${user.id})`);

  // 查询该用户最近的视频任务
  const { data: tasks, error } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'video')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('查询错误:', error.message);
    return;
  }

  console.log(`\n查询到 ${tasks.length} 条视频任务`);

  // 分类任务
  const withImage = tasks.filter(t => t.source_image_url);
  const withModel = tasks.filter(t => t.prompt && t.prompt.includes('[AI MODEL:'));
  const withBoth = tasks.filter(t => t.source_image_url && t.prompt && t.prompt.includes('[AI MODEL:'));
  const purePrompt = tasks.filter(t => !t.source_image_url && (!t.prompt || !t.prompt.includes('[AI MODEL:')));

  console.log('\n' + '='.repeat(70));
  console.log('任务分类统计:');
  console.log('='.repeat(70));
  console.log(`  有图片的任务: ${withImage.length} 条`);
  console.log(`  有模特的任务: ${withModel.length} 条`);
  console.log(`  图片+模特都有: ${withBoth.length} 条`);
  console.log(`  纯提示词任务: ${purePrompt.length} 条`);

  // 分析各类任务的成功率
  function analyzeGroup(name, group) {
    if (group.length === 0) {
      console.log(`\n【${name}】: 无任务`);
      return;
    }
    
    const completed = group.filter(t => t.status === 'completed').length;
    const failed = group.filter(t => t.status === 'failed').length;
    const processing = group.filter(t => t.status === 'processing').length;
    const successRate = ((completed / group.length) * 100).toFixed(1);
    
    console.log(`\n【${name}】: ${group.length} 条`);
    console.log(`   ✅ 成功: ${completed} (${successRate}%)`);
    console.log(`   ❌ 失败: ${failed}`);
    console.log(`   🔄 处理中: ${processing}`);
    
    // 分析失败原因
    const failedTasks = group.filter(t => t.status === 'failed');
    if (failedTasks.length > 0) {
      const errorTypes = {};
      failedTasks.forEach(t => {
        const err = t.error_message || 'Unknown';
        let type = 'Other';
        if (err.includes('内容政策') || err.includes('E-1103')) {
          type = '内容审核 (E-1103)';
        } else if (err.includes('TIME') || err.includes('超时')) {
          type = '超时 (E-TIME)';
        } else if (err.includes('繁忙') || err.includes('E-1003')) {
          type = '线路繁忙 (E-1003)';
        }
        errorTypes[type] = (errorTypes[type] || 0) + 1;
      });
      console.log(`   失败原因分布:`);
      for (const [type, count] of Object.entries(errorTypes)) {
        console.log(`      - ${type}: ${count} 条`);
      }
    }
    
    return { completed, failed, processing, total: group.length, successRate };
  }

  console.log('\n' + '='.repeat(70));
  console.log('各类任务成功率对比:');
  console.log('='.repeat(70));

  const stats = {
    withImage: analyzeGroup('有图片', withImage),
    withModel: analyzeGroup('有模特', withModel),
    withBoth: analyzeGroup('图片+模特', withBoth),
    purePrompt: analyzeGroup('纯提示词', purePrompt),
  };

  // 详细查看失败的有图片任务
  console.log('\n\n' + '='.repeat(70));
  console.log('失败任务详细分析 (有图片的):');
  console.log('='.repeat(70));

  const failedWithImage = withImage.filter(t => t.status === 'failed').slice(0, 5);
  for (let i = 0; i < failedWithImage.length; i++) {
    const task = failedWithImage[i];
    console.log(`\n[${i + 1}] 任务 ID: ${task.task_id || task.id}`);
    console.log(`    创建时间: ${task.created_at}`);
    console.log(`    错误信息: ${task.error_message || '无'}`);
    console.log(`    图片URL: ${task.source_image_url ? task.source_image_url.substring(0, 60) + '...' : '无'}`);
    console.log(`    有模特: ${task.prompt && task.prompt.includes('[AI MODEL:') ? '是' : '否'}`);
    console.log(`    提示词长度: ${task.prompt ? task.prompt.length : 0} 字符`);
  }

  // 详细查看成功的纯提示词任务
  console.log('\n\n' + '='.repeat(70));
  console.log('成功任务详细分析 (纯提示词):');
  console.log('='.repeat(70));

  const successPurePrompt = purePrompt.filter(t => t.status === 'completed').slice(0, 5);
  for (let i = 0; i < successPurePrompt.length; i++) {
    const task = successPurePrompt[i];
    console.log(`\n[${i + 1}] 任务 ID: ${task.task_id || task.id}`);
    console.log(`    创建时间: ${task.created_at}`);
    console.log(`    完成时间: ${task.completed_at}`);
    console.log(`    图片URL: ${task.source_image_url || '无'}`);
    console.log(`    有模特: ${task.prompt && task.prompt.includes('[AI MODEL:') ? '是' : '否'}`);
    console.log(`    提示词长度: ${task.prompt ? task.prompt.length : 0} 字符`);
  }

  // 结论
  console.log('\n\n' + '='.repeat(70));
  console.log('📊 结论:');
  console.log('='.repeat(70));

  if (stats.purePrompt && stats.withImage) {
    const pureRate = parseFloat(stats.purePrompt.successRate);
    const imageRate = parseFloat(stats.withImage.successRate);
    
    if (pureRate > imageRate + 20) {
      console.log('\n⚠️ 确认问题: 纯提示词成功率明显高于有图片的任务!');
      console.log(`   纯提示词成功率: ${pureRate}%`);
      console.log(`   有图片成功率: ${imageRate}%`);
      console.log(`   差距: ${(pureRate - imageRate).toFixed(1)}%`);
      
      // 分析可能原因
      const imageFailedReasons = withImage.filter(t => t.status === 'failed').map(t => t.error_message);
      const hasContentPolicy = imageFailedReasons.some(e => e && (e.includes('内容政策') || e.includes('E-1103')));
      
      if (hasContentPolicy) {
        console.log('\n📍 可能原因: 上传的图片触发了 Sora API 的内容审核');
      }
    } else {
      console.log('\n✅ 纯提示词和有图片的任务成功率相近，问题可能是其他原因');
    }
  }
}

analyzeHuplus().catch(console.error);
