/**
 * 列出所有用户
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function listUsers() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    console.log('=== 查询 profiles 表 ===');
    const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, email, role, credits')
        .limit(20);

    if (pErr) {
        console.log('profiles 错误:', pErr.message);
    } else {
        console.log('profiles 用户:');
        profiles?.forEach(p => console.log(`  ${p.email || 'no-email'} (${p.role}, ${p.credits} credits)`));
    }

    console.log('\n=== 查询 users 表 ===');
    const { data: users, error: uErr } = await supabase
        .from('users')
        .select('id, email, name, credits')
        .limit(20);

    if (uErr) {
        console.log('users 错误:', uErr.message);
    } else {
        console.log('users 用户:');
        users?.forEach(u => console.log(`  ${u.email} (${u.name}, ${u.credits} credits)`));
    }
}

listUsers().catch(console.error);
