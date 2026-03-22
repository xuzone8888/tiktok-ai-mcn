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
import { submitSora2 } from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";

const SORA2_CHARACTER_VIDEO_COST = 20; // 积分消耗（与标准视频一致）

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

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    // 扣除积分
    const supabase = createAdminClient();
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
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

    const { error: deductError } = await supabase
      .from("profiles")
      .update({ credits: profile.credits - SORA2_CHARACTER_VIDEO_COST })
      .eq("id", userId);

    if (deductError) {
      console.error("[Sora2-CharVideo] Failed to deduct credits:", deductError);
      return NextResponse.json(
        { success: false, error: "扣除积分失败" },
        { status: 500 }
      );
    }

    console.log("[Sora2-CharVideo] Credits deducted:", {
      userId,
      cost: SORA2_CHARACTER_VIDEO_COST,
      before: profile.credits,
      after: profile.credits - SORA2_CHARACTER_VIDEO_COST,
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
      // 退还积分
      try {
        await supabase
          .from("profiles")
          .update({ credits: profile.credits })
          .eq("id", userId);
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
