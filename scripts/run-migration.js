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

async function runMigration() {
  console.log('\n=== 执行数据库迁移 ===\n');
  
  // 使用 rpc 来执行 SQL (如果存在 exec_sql 函数)
  // 或者尝试直接添加字段
  
  // 方法1: 尝试使用 Supabase 的 postgres 模块（如果可用）
  // 方法2: 直接通过 REST API 添加字段（不太可能）
  
  // 由于 Supabase JS 客户端不支持直接执行 DDL，
  // 我们需要使用 Supabase Management API 或 SQL Editor
  
  // 让我们尝试检查是否能通过 rpc 执行
  const sql = `
    ALTER TABLE public.generations
    ADD COLUMN IF NOT EXISTS ai_model_id UUID REFERENCES public.ai_models(id) ON DELETE SET NULL;
    
    ALTER TABLE public.generations
    ADD COLUMN IF NOT EXISTS final_prompt TEXT;
    
    CREATE INDEX IF NOT EXISTS idx_generations_ai_model_id ON public.generations(ai_model_id);
  `;
  
  // 尝试调用自定义 rpc（如果存在）
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
  
  if (error) {
    if (error.message.includes('function') && error.message.includes('does not exist')) {
      console.log('❌ 服务器没有 exec_sql 函数');
      console.log('\n需要手动在 Supabase SQL Editor 中执行以下 SQL:\n');
      console.log('========================================');
      console.log(sql);
      console.log('========================================');
      console.log('\n打开链接: https://supabase.com/dashboard/project/hfabrifuvujpdzarlbky/sql/new');
    } else {
      console.log('执行错误:', error.message);
    }
    return;
  }
  
  console.log('✅ 迁移执行成功!');
  console.log(data);
}

runMigration().catch(console.error);
