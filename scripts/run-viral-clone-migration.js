/**
 * 执行 Viral Clone V1.5 数据库迁移
 * 使用与 run-tiktok-migration.js 相同的方式
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('🚀 Starting Viral Clone V1.5 database migration...\n');

  const sqlPath = path.join(__dirname, '../supabase/migrations/20260415_viral_clone.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  // 拆分为独立语句
  const statements = sqlContent
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 10 && !s.startsWith('--'));

  // 过滤掉 DO $$ ... $$ 块（需要特殊处理）
  const regularStatements = [];
  let inDoBlock = false;
  for (const stmt of statements) {
    if (stmt.startsWith('DO $$') || stmt.includes('DO $$')) {
      inDoBlock = true;
      continue;
    }
    if (inDoBlock) {
      if (stmt.includes('$$')) {
        inDoBlock = false;
      }
      continue;
    }
    regularStatements.push(stmt);
  }

  console.log(`📝 Found ${regularStatements.length} SQL statements to execute\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < regularStatements.length; i++) {
    const stmt = regularStatements[i];
    
    // 提取对象名称用于日志
    const match = stmt.match(/(CREATE TABLE|CREATE INDEX|CREATE POLICY|ALTER TABLE|CREATE OR REPLACE FUNCTION|CREATE TRIGGER)\s+(?:IF NOT EXISTS\s+)?["']?(\w+)["']?/i);
    const objectType = match ? match[1] : 'SQL';
    const objectName = match ? match[2] : `statement ${i + 1}`;

    process.stdout.write(`  ⏳ [${i + 1}/${regularStatements.length}] ${objectType}: ${objectName}...`);

    try {
      const { error } = await supabase.rpc('exec_sql', { sql_query: stmt + ';' });
      
      if (error) {
        if (error.message?.includes('already exists')) {
          console.log(' ✅ 已存在，跳过');
          skipped++;
        } else if (error.message?.includes('does not exist') && error.message?.includes('exec_sql')) {
          // exec_sql 函数不存在，需要先创建
          console.log(' ❌ exec_sql 函数不存在');
          console.log('\n⚠️  需要先在 Supabase Dashboard 创建 exec_sql 函数');
          console.log('请在 SQL Editor 执行:');
          console.log('');
          console.log(`CREATE OR REPLACE FUNCTION exec_sql(sql_query text)`);
          console.log(`RETURNS void AS $$`);
          console.log(`BEGIN`);
          console.log(`  EXECUTE sql_query;`);
          console.log(`END;`);
          console.log(`$$ LANGUAGE plpgsql SECURITY DEFINER;`);
          console.log('');
          console.log('或者直接在 SQL Editor 执行完整迁移文件：');
          console.log('  supabase/migrations/20260415_viral_clone.sql');
          return;
        } else {
          console.log(` ⚠️  ${error.message?.substring(0, 80)}`);
          failed++;
        }
      } else {
        console.log(' ✅');
        success++;
      }
    } catch (e) {
      console.log(` ❌ ${e.message?.substring(0, 60)}`);
      failed++;
    }
  }

  console.log(`\n📊 执行完成: ✅ ${success} 成功, ⏭️ ${skipped} 跳过, ❌ ${failed} 失败`);

  // 验证表
  console.log('\n📋 验证表...');
  const tables = ['viral_clone_assets', 'viral_clone_jobs', 'viral_clone_segments', 'viral_clone_attempts', 'viral_clone_events'];
  
  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1);
    console.log(`  ${error ? '❌' : '✅'} ${table}`);
  }
}

runMigration().catch(e => {
  console.error('❌ Fatal:', e.message);
  process.exit(1);
});
