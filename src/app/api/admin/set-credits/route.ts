/**
 * Admin API - 设置用户积分 (临时调试用)
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const { email, credits } = await request.json();

    if (!email || typeof credits !== "number") {
      return NextResponse.json(
        { success: false, error: "需要提供 email 和 credits" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("profiles")
      .update({ credits })
      .eq("email", email)
      .select()
      .single();

    if (error) {
      console.error("[Set Credits] Error:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        email: data.email,
        credits: data.credits,
      },
    });
  } catch (error) {
    console.error("[Set Credits] Error:", error);
    return NextResponse.json(
      { success: false, error: "设置积分失败" },
      { status: 500 }
    );
  }
}

