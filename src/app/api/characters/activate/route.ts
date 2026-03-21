/**
 * 角色活化视频 API — 使用 gaorui-veo-api.ts 直连高瑞 VEO3
 */

import { NextResponse } from "next/server";
import { submitVeo3Video, queryVeoResult } from "@/lib/gaorui-veo-api";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// ============================================================================
// 积分配置
// ============================================================================

const ACTIVATE_CREDITS = 10; // 角色活化视频 = 10 积分/次

// ============================================================================
// POST — 提交角色活化视频任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { referenceImageUrl, heroImageUrl, prompt, userId } = body as {
      referenceImageUrl?: string;
      heroImageUrl?: string;
      prompt: string;
      userId: string;
    };
    const imageUrl = referenceImageUrl || heroImageUrl; // 兼容旧前端

    // 参数校验
    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: "referenceImageUrl is required" },
        { status: 400 }
      );
    }

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { success: false, error: "prompt is required" },
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
    // 积分检查与扣除（乐观锁）
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

    if (currentCredits < ACTIVATE_CREDITS) {
      return NextResponse.json(
        {
          success: false,
          error: `积分不足！需要 ${ACTIVATE_CREDITS} 积分，当前余额 ${currentCredits}`,
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

      if (latestCredits < ACTIVATE_CREDITS) {
        return NextResponse.json(
          {
            success: false,
            error: `积分不足！需要 ${ACTIVATE_CREDITS} 积分，当前余额 ${latestCredits}`,
          },
          { status: 400 }
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deductError } = await (supabase as any)
        .from("profiles")
        .update({ credits: latestCredits - ACTIVATE_CREDITS })
        .eq("id", userId)
        .eq("credits", latestCredits); // 乐观锁

      if (!deductError) {
        deductSuccess = true;
      } else if (deductAttempts < maxAttempts) {
        console.log(
          `[Character Activate] Credits deduct retry ${deductAttempts}/${maxAttempts}`
        );
        await new Promise((r) => setTimeout(r, 100 * deductAttempts));
      }
    }

    if (!deductSuccess) {
      console.error(
        "[Character Activate] Failed to deduct credits after retries"
      );
      return NextResponse.json(
        { success: false, error: "扣费失败，请重试" },
        { status: 500 }
      );
    }

    console.log("[Character Activate] Credits deducted:", {
      userId,
      cost: ACTIVATE_CREDITS,
      before: currentCredits,
      after: currentCredits - ACTIVATE_CREDITS,
    });

    // ============================================
    // 提交 Veo3 图生视频任务
    // ============================================
    console.log("[Character Activate] Submitting Veo3 task:", {
      promptPreview: prompt.substring(0, 80),
      imageUrl: imageUrl.substring(0, 60) + "...",
      model: "veo_3_1-components",
    });

    const result = await submitVeo3Video({
      prompt: prompt.trim(),
      imageUrls: [imageUrl],
      aspectRatio: "9:16",
      model: "veo_3_1-components",
    });

    if (!result.success || !result.taskId) {
      console.error("[Character Activate] Veo3 submit failed:", result.error);

      // 生成失败，退还积分
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("profiles")
        .update({ credits: currentCredits })
        .eq("id", userId);

      return NextResponse.json(
        {
          success: false,
          error: result.error || "视频生成失败，积分已退还",
        },
        { status: 500 }
      );
    }

    console.log("[Character Activate] Task submitted:", result.taskId);

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
    });
  } catch (error) {
    console.error("[Character Activate] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET — 查询活化视频任务状态（轮询）
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

    const result = await queryVeoResult(taskId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "查询失败" },
        { status: 500 }
      );
    }

    // 映射字段以保持前端兼容 (videoUrl → resultUrl)
    const task = result.task;
    return NextResponse.json({
      success: true,
      task: task ? {
        taskId: task.taskId,
        status: task.status,
        resultUrl: task.videoUrl,
        errorMessage: task.errorMessage,
        progress: task.progress,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      } : undefined,
    });
  } catch (error) {
    console.error("[Character Activate] Query error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
