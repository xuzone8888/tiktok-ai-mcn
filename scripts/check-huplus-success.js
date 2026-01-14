/**
 * 检查 HUPLUS 成功的任务详情
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

async function checkSuccess() {
  console.log('='.repeat(70));
  console.log('检查 HUPLUS 成功的视频任务');
  console.log('='.repeat(70));

  // 查找 HUPLUS 用户
  const { data: user } = await supabase
    .from('profiles')
    .select('id, name')
    .ilike('name', '%HUPLUS%')
    .single();

  if (!user) {
    console.log('未找到用户');
    return;
  }

  console.log(`\n用户: ${user.name} (${user.id})`);

  // 查询所有成功的视频任务
  const { data: successTasks, error } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'video')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('查询错误:', error.message);
    return;
  }

  console.log(`\n成功的视频任务总数: ${successTasks.length}`);

  // 分类
  const withImage = successTasks.filter(t => t.source_image_url);
  const withoutImage = successTasks.filter(t => !t.source_image_url);

  console.log(`\n  有图片的成功任务: ${withImage.length}`);
  console.log(`  无图片的成功任务: ${withoutImage.length}`);

  // 详细查看有图片的成功任务
  if (withImage.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('有图片且成功的任务详情:');
    console.log('='.repeat(70));

    const imageUrls = new Set();
    withImage.forEach(t => {
      if (t.source_image_url) imageUrls.add(t.source_image_url);
    });

    console.log(`\n成功的唯一图片数: ${imageUrls.size}`);

    for (let i = 0; i < Math.min(10, withImage.length); i++) {
      const task = withImage[i];
      console.log(`\n[${i + 1}] 成功任务:`);
      console.log(`    创建时间: ${task.created_at}`);
      console.log(`    完成时间: ${task.completed_at}`);
      console.log(`    图片URL: ${task.source_image_url}`);
      console.log(`    有模特: ${task.prompt && task.prompt.includes('[AI MODEL:') ? '是' : '否'}`);
      if (task.prompt && task.prompt.includes('[AI MODEL:')) {
        const match = task.prompt.match(/\[AI MODEL: (@[\w.]+)\]/);
        if (match) console.log(`    模特: ${match[1]}`);
      }
    }

    // 输出成功的图片URL供参考
    console.log('\n' + '='.repeat(70));
    console.log('成功的图片 URL 列表 (可用于参考):');
    console.log('='.repeat(70));
    
    let idx = 0;
    for (const url of imageUrls) {
      idx++;
      console.log(`\n[${idx}] ${url}`);
    }
  } else {
    console.log('\n⚠️ 没有找到有图片且成功的任务！');
    console.log('   所有成功的任务都是纯提示词模式。');
  }

  // 对比时间线
  console.log('\n\n' + '='.repeat(70));
  console.log('任务时间线分析:');
  console.log('='.repeat(70));

  // 最早的成功任务
  if (successTasks.length > 0) {
    const earliest = successTasks[successTasks.length - 1];
    const latest = successTasks[0];
    
    console.log(`\n最早成功的任务: ${earliest.created_at}`);
    console.log(`最近成功的任务: ${latest.created_at}`);
    console.log(`最早的有图片: ${earliest.source_image_url ? '是' : '否'}`);
    console.log(`最近的有图片: ${latest.source_image_url ? '是' : '否'}`);
  }

  // 查看用户所有任务的历史
  const { data: allTasks } = await supabase
    .from('generations')
    .select('status, source_image_url, created_at')
    .eq('user_id', user.id)
    .eq('type', 'video')
    .order('created_at', { ascending: true });

  if (allTasks && allTasks.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('历史任务概览 (按时间):');
    console.log('='.repeat(70));

    // 按天统计
    const dailyStats = {};
    allTasks.forEach(t => {
      const date = t.created_at.split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { 
          total: 0, 
          completed: 0, 
          failed: 0, 
          processing: 0,
          withImage: 0,
          withImageSuccess: 0
        };
      }
      dailyStats[date].total++;
      dailyStats[date][t.status]++;
      if (t.source_image_url) {
        dailyStats[date].withImage++;
        if (t.status === 'completed') dailyStats[date].withImageSuccess++;
      }
    });

    console.log('\n日期 | 总数 | 成功 | 失败 | 有图 | 有图成功');
    console.log('-'.repeat(60));
    for (const [date, stats] of Object.entries(dailyStats)) {
      console.log(`${date} | ${stats.total} | ${stats.completed} | ${stats.failed} | ${stats.withImage} | ${stats.withImageSuccess}`);
    }
  }
}

checkSuccess().catch(console.error);
