/**
 * 检查 AI 模特的 trigger_word 设置
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 读取环境变量
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim();
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = value;
      }
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkModels() {
  console.log('\n=== 检查 AI 模特 trigger_word 设置 ===\n');
  
  // 查询所有模特
  const { data: models, error } = await supabase
    .from('ai_models')
    .select('id, name, trigger_word, gender')
    .order('name');
  
  if (error) {
    console.error('查询错误:', error);
    return;
  }
  
  console.log(`共找到 ${models.length} 个模特:\n`);
  
  models.forEach((model, idx) => {
    const hasTrigger = model.trigger_word ? '✅' : '❌';
    console.log(`${idx + 1}. ${model.name}`);
    console.log(`   ID: ${model.id}`);
    console.log(`   Trigger Word: ${hasTrigger} ${model.trigger_word || '(未设置)'}`);
    console.log('');
  });
  
  // 统计
  const withTrigger = models.filter(m => m.trigger_word).length;
  const withoutTrigger = models.filter(m => !m.trigger_word).length;
  
  console.log('=== 统计 ===');
  console.log(`有 trigger_word: ${withTrigger}`);
  console.log(`无 trigger_word: ${withoutTrigger}`);
  
  // 查找 Sienna 模特
  const sienna = models.find(m => m.name.toLowerCase().includes('sienna'));
  if (sienna) {
    console.log('\n=== Sienna 模特信息 ===');
    console.log(JSON.stringify(sienna, null, 2));
  }
}

checkModels().catch(console.error);
