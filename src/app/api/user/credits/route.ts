import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = createClient();
    
    // 获取当前登录用户
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      // 未登录时返回默认值
      return NextResponse.json({
        credits: 0,
        userId: null,
        user_id: null,
      });
    }

    // 从 profiles 表获取积分
    const { data: profile, error } = await supabase
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



