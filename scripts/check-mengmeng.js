// 检查用户萌萌的视频生成记录
const { createClient } = require('@supabase/supabase-js');

// 从 .env.local 读取配置
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // 查找用户萌萌
  const { data: users, error: userError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .or('full_name.ilike.%萌萌%,email.ilike.%mengmeng%');
  
  if (userError) {
    console.error('查询用户失败:', userError);
    return;
  }
  
  console.log('找到用户:', users);
  
  if (!users || users.length === 0) {
    // 尝试搜索所有用户
    const { data: allUsers } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .limit(20);
    console.log('\n所有用户（前20）:');
    allUsers?.forEach(u => console.log(`  - ${u.full_name || 'N/A'} (${u.email})`));
    return;
  }
  
  const userId = users[0].id;
  console.log('\n查询用户ID:', userId);
  
  // 查询该用户最近的视频生成记录
  const { data: gens, error: genError } = await supabase
    .from('generations')
    .select('id, task_id, model_id, prompt, final_prompt, status, created_at, source')
    .eq('user_id', userId)
    .eq('type', 'video')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (genError) {
    console.error('查询生成记录失败:', genError);
    return;
  }
  
  console.log('\n最近10条视频生成记录:');
  console.log('='.repeat(80));
  
  for (const g of gens || []) {
    // 查询模特信息
    let modelName = 'N/A';
    if (g.model_id) {
      const { data: model } = await supabase
        .from('ai_models')
        .select('name, trigger_word')
        .eq('id', g.model_id)
        .single();
      if (model) {
        modelName = `${model.name} (trigger: ${model.trigger_word || 'NONE'})`;
      }
    }
    
    console.log(`\n任务: ${g.task_id}`);
    console.log(`  状态: ${g.status}`);
    console.log(`  来源: ${g.source}`);
    console.log(`  模特ID: ${g.model_id || 'NULL'}`);
    console.log(`  模特: ${modelName}`);
    console.log(`  原始提示词: ${(g.prompt || '').substring(0, 60)}...`);
    console.log(`  最终提示词: ${(g.final_prompt || '').substring(0, 100)}...`);
    console.log(`  创建时间: ${g.created_at}`);
    
    // 检查 final_prompt 是否包含 trigger word
    const hasTrigger = g.final_prompt && g.final_prompt.includes('@');
    console.log(`  是否注入触发词: ${hasTrigger ? '是 ✓' : '否 ✗'}`);
  }
  
  // 查询该用户的模特合约
  console.log('\n\n用户的模特合约:');
  console.log('='.repeat(80));
  const { data: contracts } = await supabase
    .from('contracts')
    .select('model_id, status, end_date, ai_models(name, trigger_word)')
    .eq('user_id', userId);
  
  contracts?.forEach(c => {
    const model = c.ai_models;
    console.log(`  模特ID: ${c.model_id}`);
    console.log(`    名称: ${model?.name || 'N/A'}`);
    console.log(`    触发词: ${model?.trigger_word || 'NONE'}`);
    console.log(`    合约状态: ${c.status}`);
    console.log(`    到期日: ${c.end_date}`);
    console.log('');
  });
}

check().catch(console.error);
