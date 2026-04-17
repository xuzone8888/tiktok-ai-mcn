/**
 * Viral Clone — Supabase 客户端
 *
 * 由于 viral_clone_* 表尚未加入主 Database 类型定义，
 * 这里使用 untyped client 避免 TypeScript 编译错误。
 *
 * TODO: 下一步将 viral_clone 表结构合并到 src/types/database.ts
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * 创建 Viral Clone 专用管理员客户端（untyped，绕过 Database 类型约束）
 */
export function createVCAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase environment variables for Viral Clone admin client.'
    );
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * 创建 Viral Clone 用户级客户端（从 cookies 读取 session）
 * 用于 API route 中验证用户身份后查询
 */
export function createVCUserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      'Missing Supabase environment variables for Viral Clone user client.'
    );
  }

  return createSupabaseClient(supabaseUrl, anonKey);
}
