/**
 * Sora2 角色出场视频生成 API
 *
 * POST /api/characters/generate-sora-character-video
 * Body: { prompt, userId, aspectRatio? }
 * Returns: { success, taskId }
 *
 * 前端轮询复用 /api/video-batch/sora-status/[taskId]
 */

import { NextResponse } from "next/server";
import { applyTaskCreditDelta } from "@/lib/credits/atomic-task-credit";
import { submitSora2 } from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SORA2_CHARACTER_VIDEO_COST = 20; // 积分消耗（与标准视频一致）

async function getCurrentUser() {
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  return user;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prompt, userId, aspectRatio = "9:16" } = body;

    if (!prompt || prompt.trim().length < 5) {
      return NextResponse.json(
        { success: false, error: "描述词至少需要 5 个字符" },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    if (userId && userId !== user.id) {
      return NextResponse.json(
        { success: false, error: "用户身份不匹配" },
        { status: 403 }
      );
    }

    // 扣除积分
    const supabase = createAdminClient();
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: "用户不存在" },
        { status: 404 }
      );
    }

    if (profile.credits < SORA2_CHARACTER_VIDEO_COST) {
      return NextResponse.json(
        { success: false, error: `积分不足！需要 ${SORA2_CHARACTER_VIDEO_COST} 积分，当前余额 ${profile.credits}` },
        { status: 400 }
      );
    }

    const billingTaskId = crypto.randomUUID();
    let chargeResult;
    try {
      chargeResult = await applyTaskCreditDelta({
        supabase,
        userId: user.id,
        entryKind: "consume",
        amount: -SORA2_CHARACTER_VIDEO_COST,
        scope: "character-video",
        taskId: billingTaskId,
        operation: "consume",
        pricingVersion: "character-sora2-video-v1",
        description: "Sora2 角色出场视频生成",
      });
    } catch (error) {
      console.error("[Sora2-CharVideo] Failed to deduct credits:", error);
      return NextResponse.json(
        { success: false, error: "扣除积分失败" },
        { status: 500 }
      );
    }

    console.log("[Sora2-CharVideo] Credits deducted:", {
      userId: user.id,
      cost: SORA2_CHARACTER_VIDEO_COST,
      before: chargeResult.balanceBefore,
      after: chargeResult.balanceAfter,
    });

    // 提交 Sora2 视频生成（line3 无印科技，10 秒）
    const finalPrompt = `${prompt}. Cinematic, high quality, professional lighting, studio portrait video.`;

    const result = await submitSora2(
      {
        prompt: finalPrompt,
        duration: 10,
        aspectRatio: aspectRatio as "9:16" | "16:9",
      },
      undefined,
      "line3"
    );

    if (!result.success) {
      try {
        await applyTaskCreditDelta({
          supabase,
          userId: user.id,
          entryKind: "refund",
          amount: SORA2_CHARACTER_VIDEO_COST,
          scope: "character-video",
          taskId: billingTaskId,
          operation: "refund",
          pricingVersion: "character-sora2-video-v1",
          description: "Sora2 角色出场视频提交失败退款",
        });
        console.log("[Sora2-CharVideo] Credits refunded due to submit failure");
      } catch (refundErr) {
        console.error("[Sora2-CharVideo] Failed to refund credits:", refundErr);
      }

      return NextResponse.json(
        { success: false, error: result.error || "视频生成提交失败" },
        { status: 500 }
      );
    }

    console.log("[Sora2-CharVideo] Task submitted:", result.taskId);

    const { error: generationError } = await supabase.from("generations").insert({
      id: billingTaskId,
      user_id: user.id,
      task_id: result.taskId,
      type: "video",
      generation_type: "video",
      source: "character_create",
      prompt: finalPrompt,
      model: "sora2-character-video",
      duration: 10,
      aspect_ratio: aspectRatio,
      quality: "standard",
      status: "processing",
      progress: 0,
      credit_cost: SORA2_CHARACTER_VIDEO_COST,
      credits_used: SORA2_CHARACTER_VIDEO_COST,
      credits_refunded: 0,
      metadata: {
        billing_task_id: billingTaskId,
        billing_scope: "character-video",
      },
      created_at: new Date().toISOString(),
    } as any);

    if (generationError) {
      console.error("[Sora2-CharVideo] Failed to persist task:", generationError);
      await applyTaskCreditDelta({
        supabase,
        userId: user.id,
        entryKind: "refund",
        amount: SORA2_CHARACTER_VIDEO_COST,
        scope: "character-video",
        taskId: billingTaskId,
        operation: "refund",
        pricingVersion: "character-sora2-video-v1",
        description: "Sora2 角色出场视频任务记录失败退款",
      });
      return NextResponse.json(
        { success: false, error: "任务记录失败，积分已退还" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      estimatedTime: "3-5 minutes",
    });
  } catch (error) {
    console.error("[Sora2-CharVideo] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
