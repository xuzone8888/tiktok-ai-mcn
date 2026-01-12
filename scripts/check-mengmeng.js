// 检查用户萌萌的视频生成记录
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 手动读取 .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const [key, ...values] = line.split('=');
  if (key && !key.startsWith('#')) {
    let val = values.join('=').trim();
    // 去掉引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key.trim()] = val;
  }
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // 查找用户萌萌
  const { data: users, error: userError } = await supabase
    .from('profiles')
    .select('id, name, email')
    .or('name.ilike.%萌萌%,email.ilike.%mengmeng%');
  
  if (userError) {
    console.error('查询用户失败:', userError);
    return;
  }
  
  console.log('找到用户:', users);
  
  if (!users || users.length === 0) {
    // 尝试搜索所有用户
    const { data: allUsers } = await supabase
      .from('profiles')
      .select('id, name, email')
      .limit(20);
    console.log('\n所有用户（前20）:');
    allUsers?.forEach(u => console.log(`  - ${u.name || 'N/A'} (${u.email})`));
    return;
  }
  
  const userId = users[0].id;
  console.log('\n查询用户ID:', userId);
  
  // 查询该用户最近的视频生成记录
  const { data: gens, error: genError } = await supabase
    .from('generations')
    .select('*')
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
  
  // 先打印第一条记录的所有字段，了解表结构
  if (gens && gens.length > 0) {
    console.log('\n表结构（第一条记录的字段）:', Object.keys(gens[0]));
  }
  
  for (const g of gens || []) {
    // 查询模特信息 - 注意 g.model 可能是模特ID或API模型名
    let modelName = 'N/A';
    let triggerWord = 'NONE';
    const modelField = g.model || g.model_id; // 兼容不同字段名
    if (modelField) {
      // 尝试用 model 作为 ID 查询
      const { data: modelData } = await supabase
        .from('ai_models')
        .select('name, trigger_word')
        .eq('id', modelField)
        .single();
      if (modelData) {
        modelName = modelData.name;
        triggerWord = modelData.trigger_word || 'NONE';
      } else {
        modelName = modelField; // 如果不是UUID，可能是API模型名如 sora2-15s
      }
    }
    
    console.log(`\n任务: ${g.task_id}`);
    console.log(`  状态: ${g.status}`);
    console.log(`  来源: ${g.source}`);
    console.log(`  model字段: ${modelField || 'NULL'}`);
    console.log(`  模特名/触发词: ${modelName} / ${triggerWord}`);
    console.log(`  提示词: ${(g.prompt || '').substring(0, 80)}...`);
    console.log(`  创建时间: ${g.created_at}`);
    
    // 检查 prompt 是否包含 @ (trigger word)
    const hasTrigger = g.prompt && g.prompt.includes('@');
    console.log(`  提示词中是否有触发词(@): ${hasTrigger ? '是 ✓' : '否 ✗'}`);
  }
  
  // 查询该用户的模特合约
  console.log('\n\n用户的模特合约:');
  console.log('='.repeat(80));
  const { data: contracts } = await supabase
    .from('contracts')
    .select('model_id, status, end_date')
    .eq('user_id', userId);
  
  for (const c of contracts || []) {
    const { data: modelData } = await supabase
      .from('ai_models')
      .select('name, trigger_word')
      .eq('id', c.model_id)
      .single();
    console.log(`  模特ID: ${c.model_id}`);
    console.log(`    名称: ${modelData?.name || 'N/A'}`);
    console.log(`    触发词: ${modelData?.trigger_word || 'NONE'}`);
    console.log(`    合约状态: ${c.status}`);
    console.log(`    到期日: ${c.end_date}`);
    console.log('');
  }
}

async function checkVideoTasks() {
  const userId = 'a3d20885-a12b-4f76-844b-199370ecf6a9';
  
  // 检查 generations 表中所有类型的记录
  const { data: allGens } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);
  
  console.log('\n\n萌萌用户的所有 generations 记录:');
  console.log('='.repeat(80));
  if (allGens && allGens.length > 0) {
    console.log('字段:', Object.keys(allGens[0]));
    allGens.forEach(g => {
      console.log(`\n类型: ${g.type}, 来源: ${g.source}, 状态: ${g.status}`);
      console.log(`  model字段: ${g.model || 'NULL'}`);
    });
  } else {
    console.log('该用户没有任何 generations 记录');
  }
  
  // 检查 generations 表中所有 quick_gen 的 video 记录，不管用户
  const { data: quickGens } = await supabase
    .from('generations')
    .select('*')
    .eq('type', 'video')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (quickGens && quickGens.length > 0) {
    console.log('\n\n最近5条视频生成记录（全局）:');
    console.log('='.repeat(80));
    quickGens.forEach(g => {
      console.log(`\n用户ID: ${g.user_id}`);
      console.log(`  来源: ${g.source}`);
      console.log(`  model字段: ${g.model || 'NULL'}`);
      console.log(`  提示词: ${(g.prompt || '').substring(0, 100)}...`);
      const hasTrigger = g.prompt && g.prompt.includes('@');
      console.log(`  是否有触发词(@): ${hasTrigger ? '是' : '否'}`);
    });
  }
}

async function checkMengmengImages() {
  const userId = 'a3d20885-a12b-4f76-844b-199370ecf6a9';
  
  const { data: images } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', userId)
    .eq('type', 'image')
    .order('created_at', { ascending: false })
    .limit(5);
  
  console.log('\n\n萌萌用户的图片生成记录:');
  console.log('='.repeat(80));
  images?.forEach(g => {
    console.log(`\n任务ID: ${g.task_id}`);
    console.log(`  状态: ${g.status}`);
    console.log(`  model: ${g.model || 'NULL'}`);
    console.log(`  提示词: ${(g.prompt || '').substring(0, 100)}...`);
    console.log(`  创建时间: ${g.created_at}`);
  });
}

check().then(() => checkVideoTasks()).then(() => checkMengmengImages()).catch(console.error);
