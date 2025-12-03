/**
 * 积分退还 API
 * 
 * POST /api/user/credits/refund - 退还积分（任务失败时）
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 请求体类型
interface RefundRequest {
  userId: string;
  amount: number;       // 退还金额
  reason?: string;      // 退还原因
  taskId?: string;      // 关联任务ID
}

// ============================================================================
// POST - 退还积分
// ============================================================================

export async function POST(request: Request) {
  try {
    const body: RefundRequest = await request.json();
    const { userId, amount, reason, taskId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "用户ID不能为空" },
        { status: 400 }
      );
    }

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: "退还金额必须大于0" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 获取用户当前积分
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error("[Refund Credits] Error fetching profile:", profileError);
      return NextResponse.json(
        { success: false, error: "用户不存在" },
        { status: 404 }
      );
    }

    const currentCredits = profile.credits;
    const newCredits = currentCredits + amount;

    // 退还积分
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", userId);

    if (updateError) {
      console.error("[Refund Credits] Error updating credits:", updateError);
      return NextResponse.json(
        { success: false, error: "退还积分失败" },
        { status: 500 }
      );
    }

    console.log("[Refund Credits] Success:", {
      userId,
      amount,
      before: currentCredits,
      after: newCredits,
      reason,
      taskId,
    });

    return NextResponse.json({
      success: true,
      data: {
        before: currentCredits,
        after: newCredits,
        refunded: amount,
      },
    });
  } catch (error) {
    console.error("[Refund Credits] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

