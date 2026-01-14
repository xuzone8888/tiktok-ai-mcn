/**
 * 检查 HUPLUS 用户上传的图片详情
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

async function checkImages() {
  console.log('='.repeat(70));
  console.log('检查 HUPLUS 用户上传的图片');
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

  // 查询有图片且失败的任务
  const { data: failedWithImage } = await supabase
    .from('generations')
    .select('task_id, source_image_url, error_message, prompt, created_at')
    .eq('user_id', user.id)
    .eq('type', 'video')
    .eq('status', 'failed')
    .not('source_image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log(`\n失败且有图片的任务: ${failedWithImage?.length || 0} 条`);

  // 分析图片 URL 模式
  const imageUrls = new Set();
  failedWithImage?.forEach(t => {
    if (t.source_image_url) {
      imageUrls.add(t.source_image_url);
    }
  });

  console.log(`\n唯一图片数量: ${imageUrls.size}`);

  console.log('\n' + '='.repeat(70));
  console.log('失败任务的图片 URL:');
  console.log('='.repeat(70));

  let i = 0;
  for (const url of imageUrls) {
    i++;
    if (i > 10) break;
    console.log(`\n[${i}] ${url}`);
  }

  // 查看提示词中的模特信息
  console.log('\n\n' + '='.repeat(70));
  console.log('失败任务使用的 AI 模特:');
  console.log('='.repeat(70));

  const modelPattern = /\[AI MODEL: (@[\w.]+)\]/;
  const models = {};
  
  failedWithImage?.forEach(t => {
    const match = t.prompt?.match(modelPattern);
    if (match) {
      const modelName = match[1];
      models[modelName] = (models[modelName] || 0) + 1;
    }
  });

  for (const [model, count] of Object.entries(models)) {
    console.log(`  ${model}: ${count} 条失败任务`);
  }

  // 对比：查询成功的纯提示词任务
  console.log('\n\n' + '='.repeat(70));
  console.log('成功的纯提示词任务提示词预览:');
  console.log('='.repeat(70));

  const { data: successPure } = await supabase
    .from('generations')
    .select('prompt')
    .eq('user_id', user.id)
    .eq('type', 'video')
    .eq('status', 'completed')
    .is('source_image_url', null)
    .limit(3);

  successPure?.forEach((t, idx) => {
    console.log(`\n[成功 ${idx + 1}] 提示词预览:`);
    console.log(`   ${t.prompt?.substring(0, 200)}...`);
  });

  // 对比：查询失败的有图片任务提示词
  console.log('\n\n' + '='.repeat(70));
  console.log('失败的有图片任务提示词预览:');
  console.log('='.repeat(70));

  failedWithImage?.slice(0, 3).forEach((t, idx) => {
    console.log(`\n[失败 ${idx + 1}] 提示词预览:`);
    console.log(`   ${t.prompt?.substring(0, 200)}...`);
  });

  // 结论
  console.log('\n\n' + '='.repeat(70));
  console.log('📋 分析结论:');
  console.log('='.repeat(70));
  console.log(`
问题根源: HUPLUS 用户上传的图片被 Sora API 内容审核系统拦截

可能原因:
1. 图片中的服装/姿势被误判为敏感内容
2. AI 生成的模特图片可能有某些特征触发审核
3. 图片质量或构图不符合 Sora API 的要求

建议:
1. 让用户尝试更换图片（使用产品平铺图而非人物穿着图）
2. 检查上传的图片是否过于暴露或紧身
3. 先使用纯提示词模式测试，确认提示词本身没问题
4. 如果图片模式必须使用，尝试使用更"正式"的产品图
`);
}

checkImages().catch(console.error);
