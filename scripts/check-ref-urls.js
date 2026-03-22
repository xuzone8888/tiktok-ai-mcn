// 使用 anon key 查询 reference_sheet_url
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
  // 查询自建角色
  const { data, error } = await supabase
    .from('ai_models')
    .select('id, name, reference_sheet_url, reference_status, avatar_url, created_at')
    .eq('source', 'user_created')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) { console.error('查询失败:', error.message); return; }
  console.log('共找到', (data || []).length, '个自建角色\n');

  for (const c of data || []) {
    const url = c.reference_sheet_url || '(无)';
    let type = 'NONE';
    if (url.includes('media.toryxai.com')) type = 'OSS_PERMANENT';
    else if (url.includes('xas231')) type = 'TEMP_XAS231';
    else if (url !== '(无)') {
      try { type = 'OTHER: ' + new URL(url).hostname; } catch { type = 'OTHER'; }
    }
    console.log('[' + c.name + '] ' + type + ' | status=' + c.reference_status + ' | ' + url.substring(0, 120));
  }

  console.log('\n--- 验证 reference_sheet_url 可访问性 ---');
  for (const c of data || []) {
    if (!c.reference_sheet_url) { console.log(c.name + ' → 无URL'); continue; }
    try {
      const r = await fetch(c.reference_sheet_url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      const ct = r.headers.get('content-type') || '?';
      const cl = r.headers.get('content-length') || '?';
      console.log(c.name + ' → ' + (r.ok ? 'OK' : 'FAIL') + ' ' + r.status + ' | ' + ct + ' | ' + cl + ' bytes');
    } catch (e) {
      console.log(c.name + ' → ERROR: ' + e.message);
    }
  }
}

main().catch(console.error);
