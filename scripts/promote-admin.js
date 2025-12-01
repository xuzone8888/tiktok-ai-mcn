/**
 * 将用户提升为 Super Admin
 * 
 * 使用方法:
 * node scripts/promote-admin.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 手动读取 .env.local 文件
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  return env;
}

const env = loadEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ 缺少环境变量！请确保 .env.local 中有以下配置：');
  console.error('   - NEXT_PUBLIC_SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 要提升的用户 ID（从终端日志获取）
const USER_ID = '4d4a5690-51d0-45c4-9275-22637c028995';

async function promoteToAdmin() {
  console.log('🔄 正在将用户提升为 Super Admin...');
  console.log(`   用户 ID: ${USER_ID}`);
  
  try {
    // 首先检查用户是否存在
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('id', USER_ID)
      .single();
    
    if (fetchError) {
      console.error('❌ 查询用户失败:', fetchError.message);
      return;
    }
    
    if (!user) {
      console.error('❌ 用户不存在！');
      return;
    }
    
    console.log(`   当前角色: ${user.role}`);
    console.log(`   邮箱: ${user.email}`);
    
    // 更新角色
    const { data, error } = await supabase
      .from('users')
      .update({ role: 'super_admin' })
      .eq('id', USER_ID)
      .select();
    
    if (error) {
      console.error('❌ 更新失败:', error.message);
      return;
    }
    
    console.log('✅ 成功！用户已提升为 Super Admin');
    console.log('   请刷新浏览器页面，然后访问 /admin');
    
  } catch (err) {
    console.error('❌ 发生错误:', err);
  }
}

promoteToAdmin();

