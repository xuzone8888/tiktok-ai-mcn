/**
 * 初始化 Supabase 数据库
 * 
 * 使用方法:
 * node scripts/init-database.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

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
  console.error('❌ 缺少环境变量！');
  process.exit(1);
}

// 从 URL 提取项目 ID
const projectId = supabaseUrl.replace('https://', '').split('.')[0];

async function executeSQL(sql, description) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${supabaseUrl}/rest/v1/rpc/exec_sql`);
    
    // 使用 Supabase 的 PostgreSQL 连接
    const postData = JSON.stringify({ query: sql });
    
    const options = {
      hostname: `${projectId}.supabase.co`,
      port: 443,
      path: '/rest/v1/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Prefer': 'return=representation'
      }
    };

    console.log(`\n📝 ${description}...`);
    
    // 直接使用 @supabase/supabase-js 来执行
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      db: { schema: 'public' },
      auth: { persistSession: false }
    });
    
    // 执行原始 SQL
    supabase.rpc('exec_sql', { query: sql })
      .then(({ data, error }) => {
        if (error) {
          // 如果 RPC 不存在，尝试其他方法
          reject(error);
        } else {
          resolve(data);
        }
      });
  });
}

async function initDatabase() {
  console.log('🚀 开始初始化数据库...\n');
  console.log(`   Supabase URL: ${supabaseUrl}`);
  console.log(`   Project ID: ${projectId}\n`);
  
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    db: { schema: 'public' },
    auth: { persistSession: false }
  });
  
  // 检查 profiles 表是否存在
  console.log('📊 检查数据库状态...');
  const { data: tables, error: tablesError } = await supabase
    .from('profiles')
    .select('id')
    .limit(1);
  
  if (tablesError && tablesError.code === '42P01') {
    console.log('❌ profiles 表不存在，需要运行迁移脚本');
    console.log('\n⚠️  请手动在 Supabase SQL 编辑器中执行迁移脚本：');
    console.log('   1. 打开 https://supabase.com/dashboard/project/' + projectId + '/sql/new');
    console.log('   2. 在左侧 PRIVATE 列表中双击 "TikTok AI MCN Full Schema Initialization"');
    console.log('   3. 点击 Run 按钮执行');
    console.log('   4. 然后运行 "Complete Setup Migration"');
    console.log('\n   或者复制 supabase/migrations/002_complete_setup.sql 的内容到 SQL 编辑器执行');
    return;
  }
  
  if (tablesError) {
    console.log('⚠️  查询错误:', tablesError.message);
  } else {
    console.log('✅ profiles 表已存在');
  }
  
  // 查找用户
  console.log('\n👤 查找用户...');
  const userId = '4d4a5690-51d0-45c4-9275-22637c028995';
  
  const { data: user, error: userError } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('id', userId)
    .single();
  
  if (userError) {
    console.log('❌ 查找用户失败:', userError.message);
    
    // 尝试查看 auth.users
    console.log('\n🔍 尝试从 auth.users 查找...');
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) {
      console.log('❌ 无法访问 auth.users:', authError.message);
    } else if (authUsers && authUsers.users) {
      console.log(`✅ 找到 ${authUsers.users.length} 个用户:`);
      authUsers.users.forEach(u => {
        console.log(`   - ${u.email} (${u.id})`);
      });
      
      // 检查 profiles 中是否有这些用户
      if (authUsers.users.length > 0) {
        const firstUser = authUsers.users[0];
        console.log(`\n📝 尝试为用户 ${firstUser.email} 创建 profile...`);
        
        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .upsert({
            id: firstUser.id,
            email: firstUser.email,
            name: firstUser.email.split('@')[0],
            role: 'super_admin',
            credits: 10000
          }, { onConflict: 'id' })
          .select();
        
        if (insertError) {
          console.log('❌ 创建 profile 失败:', insertError.message);
        } else {
          console.log('✅ Profile 创建成功！');
          console.log('   角色已设置为: super_admin');
          console.log('   积分: 10000');
          console.log('\n🎉 请刷新浏览器，然后访问 /admin');
        }
      }
    }
    return;
  }
  
  console.log(`✅ 找到用户: ${user.email}`);
  console.log(`   当前角色: ${user.role}`);
  
  if (user.role === 'super_admin') {
    console.log('\n✅ 用户已经是 Super Admin！');
    return;
  }
  
  // 更新角色
  console.log('\n🔄 更新用户角色为 super_admin...');
  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({ role: 'super_admin' })
    .eq('id', userId)
    .select();
  
  if (updateError) {
    console.log('❌ 更新失败:', updateError.message);
    return;
  }
  
  console.log('✅ 成功！用户已提升为 Super Admin');
  console.log('\n🎉 请刷新浏览器，然后访问 /admin');
}

initDatabase().catch(console.error);





