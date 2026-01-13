const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 读取 .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const lines = envContent.split('\n');

let url = '', key = '';
for (const line of lines) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
    url = line.split('=')[1].replace(/["']/g, '').trim();
  }
  if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
    key = line.split('=')[1].replace(/["']/g, '').trim();
  }
}

console.log('Supabase URL:', url);

const supabase = createClient(url, key);

async function checkSchema() {
  console.log('\n=== 检查 generations 表结构 ===\n');
  
  // 查询一条记录看字段
  const { data: sample, error } = await supabase
    .from('generations')
    .select('*')
    .limit(1);
  
  if (error) {
    console.log('查询错误:', error.message);
    return;
  }
  
  if (sample && sample.length > 0) {
    console.log('generations 表现有字段:');
    const keys = Object.keys(sample[0]);
    keys.forEach(k => console.log(`  - ${k}: ${typeof sample[0][k]}`));
    
    // 检查关键字段
    console.log('\n=== 关键字段检查 ===');
    console.log('ai_model_id 字段:', keys.includes('ai_model_id') ? '✅ 存在' : '❌ 不存在');
    console.log('final_prompt 字段:', keys.includes('final_prompt') ? '✅ 存在' : '❌ 不存在');
    console.log('model_id 字段:', keys.includes('model_id') ? '✅ 存在' : '❌ 不存在');
    console.log('model 字段:', keys.includes('model') ? '✅ 存在' : '❌ 不存在');
  } else {
    console.log('generations 表为空');
    
    // 尝试插入一个测试记录看看有什么字段
    console.log('\n尝试检测表结构...');
    const testInsert = await supabase
      .from('generations')
      .insert({
        ai_model_id: '00000000-0000-0000-0000-000000000000',
        final_prompt: 'test'
      })
      .select();
    
    if (testInsert.error) {
      console.log('测试插入错误:', testInsert.error.message);
      if (testInsert.error.message.includes('column')) {
        console.log('\n❌ 需要执行数据库迁移来添加缺失字段');
      }
    }
  }
}

checkSchema().catch(console.error);
