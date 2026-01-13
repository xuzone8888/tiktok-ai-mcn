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

const supabase = createClient(url, key);

async function diagnose() {
  console.log('\n=== 诊断合约创建问题 ===\n');
  
  // 1. 查找 Clarasterl 模特
  const { data: models, error: modelError } = await supabase
    .from('ai_models')
    .select('id, name')
    .ilike('name', '%Clarasterl%');
  
  if (modelError) {
    console.log('查询模特失败:', modelError.message);
    return;
  }
  
  console.log('找到模特:', models);
  
  if (!models || models.length === 0) {
    console.log('未找到 Clarasterl 模特');
    return;
  }
  
  const modelId = models[0].id;
  console.log('\n模特 ID:', modelId);
  
  // 2. 查询该模特的所有合约
  const { data: contracts, error: contractError } = await supabase
    .from('contracts')
    .select('id, user_id, model_id, status, start_date, end_date, created_at')
    .eq('model_id', modelId)
    .order('created_at', { ascending: false });
  
  if (contractError) {
    console.log('查询合约失败:', contractError.message);
    return;
  }
  
  console.log('\n该模特的所有合约:');
  const now = new Date();
  contracts.forEach(c => {
    const endDate = new Date(c.end_date);
    const isExpired = endDate < now;
    console.log(`  - ID: ${c.id}`);
    console.log(`    用户: ${c.user_id}`);
    console.log(`    状态: ${c.status}`);
    console.log(`    结束日期: ${c.end_date}`);
    console.log(`    是否已过期: ${isExpired ? '✅ 已过期' : '❌ 未过期'}`);
    console.log(`    问题: ${isExpired && c.status === 'active' ? '⚠️ 已过期但状态仍为 active！' : '无'}`);
    console.log('');
  });
  
  // 3. 检查有问题的合约（已过期但状态仍为 active）
  const problematicContracts = contracts.filter(c => {
    const endDate = new Date(c.end_date);
    return endDate < now && c.status === 'active';
  });
  
  if (problematicContracts.length > 0) {
    console.log('\n=== 发现问题合约！===');
    console.log('以下合约已过期但状态仍为 active:');
    problematicContracts.forEach(c => {
      console.log(`  - ${c.id} (用户: ${c.user_id})`);
    });
    
    // 修复：将这些合约标记为 expired
    console.log('\n正在修复...');
    for (const c of problematicContracts) {
      const { error: updateError } = await supabase
        .from('contracts')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', c.id);
      
      if (updateError) {
        console.log(`  修复 ${c.id} 失败:`, updateError.message);
      } else {
        console.log(`  ✅ 已修复 ${c.id}`);
      }
    }
    
    console.log('\n修复完成！请重新尝试签约。');
  } else {
    console.log('\n没有发现状态问题的合约。');
    
    // 检查是否有其他用户持有该模特的有效合约
    const activeContracts = contracts.filter(c => {
      const endDate = new Date(c.end_date);
      return endDate > now && c.status === 'active';
    });
    
    if (activeContracts.length > 0) {
      console.log('\n⚠️ 该模特已被以下用户签约（未过期）:');
      activeContracts.forEach(c => {
        console.log(`  - 用户: ${c.user_id}, 到期: ${c.end_date}`);
      });
    }
  }
}

diagnose().catch(console.error);
