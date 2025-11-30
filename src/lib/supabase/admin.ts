/**
 * Supabase Admin Client
 * 
 * 使用 Service Role Key，可以绕过 RLS 策略
 * ⚠️ 仅用于服务端管理员操作，绝不能暴露给客户端
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * 创建管理员 Supabase 客户端
 * 
 * 此客户端使用 Service Role Key，拥有完全的数据库访问权限
 * 不受 RLS 策略限制
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase environment variables. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."
    );
  }

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

