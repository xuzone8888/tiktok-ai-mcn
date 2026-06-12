import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

async function getBearerUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;

  const tokenSupabase = createSupabaseClient<Database>(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const { data: { user } } = await tokenSupabase.auth.getUser();
  return user;
}

export async function GET(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({
        credits: 1000,
        userId: "local-demo-user",
        user_id: "local-demo-user",
      });
    }

    const supabase = await createClient();
    
    // 获取当前登录用户
    const { data: { user: cookieUser } } = await supabase.auth.getUser();
    const user = cookieUser || await getBearerUser(request);
    
    if (!user) {
      // 未登录时返回默认值
      return NextResponse.json({
        credits: 0,
        userId: null,
        user_id: null,
      });
    }

    // 服务端已通过当前登录态确认 user.id；使用 admin client 只读该用户 credits，
    // 避免测试库/旧库中的 profiles RLS admin policy 递归影响普通页面渲染。
    const adminSupabase = createAdminClient();
    const { data: profile, error } = await adminSupabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (error) {
      console.error("[Credits API] Error fetching profile:", error);
      // 如果表不存在，返回默认值
      return NextResponse.json({
        credits: 100,
        userId: user.id,
        user_id: user.id,
      });
    }

    return NextResponse.json({
      credits: profile?.credits ?? 100,
      userId: user.id,
      user_id: user.id,
    });
  } catch (error) {
    console.error("[Credits API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch credits" },
      { status: 500 }
    );
  }
}
