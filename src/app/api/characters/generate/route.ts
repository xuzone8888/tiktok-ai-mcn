/**
 * 角色图片生成 API
 *
 * POST /api/characters/generate — 提交角色多角度参考图生成任务
 * GET  /api/characters/generate?taskId=xxx — 查询生成任务状态
 *
 * 复用 suchuang-api.ts 的 submitNanoBanana() + queryNanoBananaResult()
 */

import { NextResponse } from "next/server";
import {
  submitNanoBanana,
  queryNanoBananaResult,
} from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GenerateCharacterRequest } from "@/types/character";

// 审查报告第 2 条：必须声明超时，生图耗时 5-20 秒
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ============================================================================
// 积分配置
// ============================================================================

const CHARACTER_GENERATE_CREDITS = 10; // 角色生成 = 10 积分/次

// ============================================================================
// 多角度生成结构模板
// ============================================================================

const MULTI_ANGLE_TEMPLATE = `

Generate a single composite image showing this exact CHARACTER from 7 different camera angles arranged in a clean grid layout on a pure white background:

Row 1 (full body, natural standing pose, 4 panels):
front view | left 3/4 profile | right 3/4 profile | back view

Row 2 (close-up headshot, 3 panels centered):
front face | left profile face | right profile face

Critical requirements:
- Every panel must show the SAME CHARACTER with identical features, design, colors, and overall aesthetic
- Consistent proportions across all views
- Clean separation between panels
- Professional character sheet / model sheet layout
- High quality, detailed rendering`;

// ============================================================================
// POST — 提交角色图片生成任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const body: GenerateCharacterRequest = await request.json();

    const { prompt, sourceImageUrl, userId } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { success: false, error: "提示词不能为空" },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "userId is required" },
        { status: 400 }
      );
    }

    // ============================================
    // 积分检查与扣除（复用乐观锁模式）
    // ============================================
    const supabase = createAdminClient();

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profileData) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const currentCredits = (profileData as { credits: number }).credits;

    if (currentCredits < CHARACTER_GENERATE_CREDITS) {
      return NextResponse.json(
        {
          success: false,
          error: `积分不足！需要 ${CHARACTER_GENERATE_CREDITS} 积分，当前余额 ${currentCredits}`,
        },
        { status: 400 }
      );
    }

    // 乐观锁扣费（带重试）
    let deductSuccess = false;
    let deductAttempts = 0;
    const maxAttempts = 3;

    while (!deductSuccess && deductAttempts < maxAttempts) {
      deductAttempts++;

      const { data: latestProfile } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .single();

      const latestCredits =
        (latestProfile as unknown as { credits: number })?.credits || 0;

      if (latestCredits < CHARACTER_GENERATE_CREDITS) {
        return NextResponse.json(
          {
            success: false,
            error: `积分不足！需要 ${CHARACTER_GENERATE_CREDITS} 积分，当前余额 ${latestCredits}`,
          },
          { status: 400 }
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deductError } = await (supabase as any)
        .from("profiles")
        .update({ credits: latestCredits - CHARACTER_GENERATE_CREDITS })
        .eq("id", userId)
        .eq("credits", latestCredits); // 乐观锁

      if (!deductError) {
        deductSuccess = true;
      } else if (deductAttempts < maxAttempts) {
        console.log(
          `[Character Generate] Credits deduct retry ${deductAttempts}/${maxAttempts}`
        );
        await new Promise((r) => setTimeout(r, 100 * deductAttempts));
      }
    }

    if (!deductSuccess) {
      console.error(
        "[Character Generate] Failed to deduct credits after retries"
      );
      return NextResponse.json(
        { success: false, error: "扣费失败，请重试" },
        { status: 500 }
      );
    }

    console.log("[Character Generate] Credits deducted:", {
      userId,
      cost: CHARACTER_GENERATE_CREDITS,
      before: currentCredits,
      after: currentCredits - CHARACTER_GENERATE_CREDITS,
    });

    // ============================================
    // 拼接终极提示词并提交生成任务
    // ============================================
    const finalPrompt = `${prompt.trim()}.${MULTI_ANGLE_TEMPLATE}`;

    console.log("[Character Generate] Submitting task:", {
      promptLength: finalPrompt.length,
      promptPreview: prompt.substring(0, 80),
      hasSourceImage: !!sourceImageUrl,
    });

    const result = await submitNanoBanana(
      {
        model: "nano-banana",
        prompt: finalPrompt,
        img_url: sourceImageUrl || undefined,
        aspectRatio: "16:9",
      }
    );

    if (!result.success || !result.taskId) {
      console.error("[Character Generate] Submit failed:", result.error);

      // 生成失败，尝试退还积分
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("profiles")
        .update({ credits: currentCredits })
        .eq("id", userId);

      return NextResponse.json(
        {
          success: false,
          error: result.error || "角色图片生成失败，积分已退还",
        },
        { status: 500 }
      );
    }

    console.log("[Character Generate] Task submitted:", result.taskId);

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
    });
  } catch (error) {
    console.error("[Character Generate] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET — 查询生成任务状态（轮询）
// ============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    const result = await queryNanoBananaResult(taskId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "查询失败" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      task: result.task,
    });
  } catch (error) {
    console.error("[Character Generate] Query error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
