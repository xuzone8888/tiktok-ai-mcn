/**
 * 合约验证 API
 * 
 * POST /api/contracts/verify
 * 
 * 验证用户是否有指定模特的有效合约
 * 用于任务开始前的合约有效性检查
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface VerifyRequest {
  modelId: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: VerifyRequest = await request.json();
    const { modelId } = body;

    if (!modelId) {
      return NextResponse.json(
        { success: false, error: "请提供模特ID", valid: false },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录", valid: false },
        { status: 401 }
      );
    }

    // 检查用户是否有该模特的有效合约
    const { data: contract, error } = await supabase
      .from("contracts")
      .select(`
        id,
        end_date,
        status,
        ai_models!inner (
          id,
          name,
          trigger_word
        )
      `)
      .eq("user_id", user.id)
      .eq("model_id", modelId)
      .eq("status", "active")
      .gt("end_date", new Date().toISOString())
      .single();

    if (error || !contract) {
      return NextResponse.json({
        success: true,
        valid: false,
        reason: "合约不存在或已过期",
        modelId,
      });
    }

    const modelData = contract.ai_models as { id: string; name: string; trigger_word: string | null };
    const daysRemaining = Math.ceil(
      (new Date(contract.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    return NextResponse.json({
      success: true,
      valid: true,
      contract: {
        id: contract.id,
        endDate: contract.end_date,
        daysRemaining,
      },
      model: {
        id: modelData.id,
        name: modelData.name,
        triggerWord: modelData.trigger_word,
      },
    });
  } catch (error) {
    console.error("[Contract Verify] Error:", error);
    return NextResponse.json(
      { success: false, error: "验证失败", valid: false },
      { status: 500 }
    );
  }
}
