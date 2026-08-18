/**
 * 执行 Studio 地基迁移(S0.1)—— 20260702_studio_foundation.sql
 * 用法:node scripts/run-studio-foundation-migration.js [--force]
 *
 * 与 run-viral-clone-migration.js 同机制(exec_sql RPC),但增加漂移预检:
 * 生产库 generations.source 的实际取值必须是新枚举的子集,否则中止(--force 跳过)。
 * 背景:migration 008 的 valid_source 枚举与生产实际写入已漂移(link_video/viral_clone/
 * ecom_factory 在代码中写入但不在 008 枚举),本迁移用 NOT VALID 重建约束。
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials (.env.local)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const FORCE = process.argv.includes('--force');

// 与 20260702_studio_foundation.sql 中 valid_source 约束保持一致:
// 基础枚举 + batch_video% 前缀通配(写入端按模型半动态拼接)
const SOURCE_ENUM = new Set([
  'quick_gen', 'batch_image',
  'image_factory', 'pro_studio',
  'link_video', 'viral_clone', 'ecom_factory',
  'studio', 'slideshow', 'photo_post',
]);
const sourceAllowed = (s) => SOURCE_ENUM.has(s) || s.startsWith('batch_video');

async function preflightSourceDrift() {
  console.log('🔎 预检:比对 generations.source 实际取值 vs 新枚举...');
  const seen = new Set();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('generations')
      .select('source')
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('❌ 预检查询失败:', error.message);
      process.exit(1);
    }
    for (const row of data) if (row.source) seen.add(row.source);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const unknown = [...seen].filter((s) => !sourceAllowed(s));
  console.log(`   实际取值(${seen.size} 种): ${[...seen].sort().join(', ') || '(空表)'}`);
  if (unknown.length > 0) {
    console.error(`\n⚠️ 发现枚举外取值: ${unknown.join(', ')}`);
    console.error('   历史行不受影响(约束为 NOT VALID),但若这些值仍在被写入,新插入将失败。');
    console.error('   请把这些值补进迁移 SQL 与本脚本的 SOURCE_ENUM 后重跑;或 --force 强行继续。');
    if (!FORCE) process.exit(1);
    console.error('   --force 已指定,继续执行。\n');
  } else {
    console.log('   ✅ 全部在枚举内,无漂移风险。\n');
  }
}

async function runMigration() {
  console.log('🚀 Studio 地基迁移(20260702_studio_foundation.sql)\n');

  await preflightSourceDrift();

  const sqlPath = path.join(__dirname, '../supabase/migrations/20260702_studio_foundation.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  const statements = sqlContent
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && !s.startsWith('--'));

  console.log(`📝 共 ${statements.length} 条语句\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const match = stmt.match(
      /(CREATE TABLE|CREATE INDEX|CREATE POLICY|DROP POLICY|ALTER TABLE|COMMENT ON|NOTIFY)\s+(?:IF NOT EXISTS\s+)?(?:EXISTS\s+)?["']?([\w."]+)/i
    );
    const label = match ? `${match[1]}: ${match[2]}` : `statement ${i + 1}`;
    process.stdout.write(`  ⏳ [${i + 1}/${statements.length}] ${label} ...`);

    const { error } = await supabase.rpc('exec_sql', { sql_query: stmt + ';' });
    if (error) {
      if (error.message?.includes('already exists')) {
        console.log(' ✅ 已存在,跳过');
        success++;
      } else {
        console.log(` ❌ ${error.message}`);
        failed++;
      }
    } else {
      console.log(' ✅');
      success++;
    }
  }

  console.log(`\n完成:${success} 成功,${failed} 失败`);
  if (failed > 0) {
    console.error('❌ 存在失败语句,请检查后重跑(迁移幂等,可重复执行)。');
    process.exit(1);
  }
  console.log('✅ Studio 地基迁移全部完成。');
}

runMigration().catch((e) => {
  console.error('❌ 迁移异常:', e);
  process.exit(1);
});
