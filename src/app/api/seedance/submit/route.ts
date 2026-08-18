/**
 * Seedance 2.0 视频生成 - 提交任务
 * 
 * POST /api/seedance/submit
 * 
 * 流程:
 * 1. 验证用户鉴权 + 积分余额
 * 2. 根据 model 映射 resolution/duration
 * 3. 扣除积分
 * 4. 调用火山方舟 API 创建任务
 * 5. 写入 generations 表
 * 6. 返回 taskId
 */

import { NextResponse } from "next/server";
import { applyTaskCreditDelta } from "@/lib/credits/atomic-task-credit";
import { submitSeedanceTask, getSeedanceParams } from "@/lib/seedance-api";
import { VIDEO_MODEL_CONFIG, type VideoModel } from "@/types/generation";
import { getNewVideoCost } from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Seedance 模型列表
const SEEDANCE_MODELS = ['seedance-5s', 'seedance-10s', 'seedance-5s-pro', 'seedance-10s-pro'];

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      prompt,
      imageUrl,
      model,           // "seedance-5s" | "seedance-10s" | "seedance-5s-pro" | "seedance-10s-pro"
      ratio = "9:16",  // "9:16" | "16:9"
      userId: requestedUserId,
    } = body;

    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "用户未登录" },
        { status: 401 }
      );
    }
    if (requestedUserId && requestedUserId !== user.id) {
      return NextResponse.json(
        { success: false, error: "用户身份不匹配" },
        { status: 403 }
      );
    }
    const userId = user.id;

    // ============================================
    // 参数验证
    // ============================================
    if (!prompt || prompt.trim().length < 3) {
      return NextResponse.json(
        { success: false, error: "提示词至少需要3个字符" },
        { status: 400 }
      );
    }

    if (!model || !SEEDANCE_MODELS.includes(model)) {
      return NextResponse.json(
        { success: false, error: `无效的模型: ${model}` },
        { status: 400 }
      );
    }

    if (!['9:16', '16:9'].includes(ratio)) {
      return NextResponse.json(
        { success: false, error: "比例只支持 9:16 或 16:9" },
        { status: 400 }
      );
    }

    // ============================================
    // 获取模型配置和积分
    // ============================================
    const modelConfig = VIDEO_MODEL_CONFIG[model];
    if (!modelConfig) {
      return NextResponse.json(
        { success: false, error: `模型配置未找到: ${model}` },
        { status: 400 }
      );
    }

    const creditCost = getNewVideoCost(model as VideoModel);
    const { duration, resolution } = getSeedanceParams(model);

    console.log("[Seedance Submit] Request:", {
      prompt: prompt.substring(0, 50) + "...",
      model,
      ratio,
      duration,
      resolution,
      creditCost,
      hasImage: !!imageUrl,
    });

    // ============================================
    // 积分检查 & 扣除
    // ============================================
    const supabase = createAdminClient();

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: "用户未找到" },
        { status: 404 }
      );
    }

    if (profile.credits < creditCost) {
      return NextResponse.json(
        { success: false, error: `积分不足！需要 ${creditCost} 积分，当前余额 ${profile.credits}` },
        { status: 400 }
      );
    }

    const billingTaskId = crypto.randomUUID();
    let chargeResult;
    try {
      chargeResult = await applyTaskCreditDelta({
        supabase,
        userId,
        entryKind: "consume",
        amount: -creditCost,
        scope: "seedance",
        taskId: billingTaskId,
        operation: "consume",
        pricingVersion: `seedance-${model}-v1`,
        description: `Seedance 2.0 ${model} 扣费`,
      });
    } catch (error) {
      console.error("[Seedance Submit] Failed to deduct credits:", error);
      return NextResponse.json(
        { success: false, error: "扣除积分失败" },
        { status: 500 }
      );
    }

    console.log("[Seedance Submit] Credits deducted:", {
      userId,
      cost: creditCost,
      before: chargeResult.balanceBefore,
      after: chargeResult.balanceAfter,
    });

    // ============================================
    // 调用 Seedance API
    // ============================================
    const result = await submitSeedanceTask({
      prompt: prompt.trim(),
      imageUrl,
      duration,
      resolution,
      ratio: ratio as '9:16' | '16:9',
    });

    if (result.status === 'failed') {
      // 提交失败，退还积分
      console.error("[Seedance Submit] Task failed:", result.error);

      try {
        await applyTaskCreditDelta({
          supabase,
          userId,
          entryKind: "refund",
          amount: creditCost,
          scope: "seedance",
          taskId: billingTaskId,
          operation: "refund",
          pricingVersion: `seedance-${model}-v1`,
          description: "Seedance 2.0 提交失败退款",
        });

        console.log("[Seedance Submit] Credits refunded:", {
          userId,
          refund: creditCost,
        });
      } catch (refundError) {
        console.error("[Seedance Submit] Refund failed:", refundError);
      }

      return NextResponse.json(
        { success: false, error: result.error || "视频生成任务提交失败" },
        { status: 500 }
      );
    }

    // ============================================
    // 写入 generations 表
    // ============================================
    const { error: insertError } = await supabase.from("generations").insert({
        id: billingTaskId,
        user_id: userId,
        task_id: result.taskId,
        type: "video",
        source: "quick_gen",
        prompt: prompt.trim(),
        model: model,
        duration,
        aspect_ratio: ratio,
        quality: resolution === '720p' ? 'hd' : 'standard',
        source_image_url: imageUrl || null,
        status: "processing",
        result_url: null,
        video_url: null,
        credit_cost: creditCost,
        use_pro: model.includes('pro'),
        metadata: {
          provider: 'volcengine',
          seedance_model: model,
          resolution,
          generate_audio: true,
          billing_task_id: billingTaskId,
          billing_scope: "seedance",
        },
        created_at: new Date().toISOString(),
      });
    if (insertError) {
      console.error("[Seedance Submit] DB insert failed:", insertError);
      await applyTaskCreditDelta({
        supabase,
        userId,
        entryKind: "refund",
        amount: creditCost,
        scope: "seedance",
        taskId: billingTaskId,
        operation: "refund",
        pricingVersion: `seedance-${model}-v1`,
        description: "Seedance 2.0 任务记录失败退款",
      });
      return NextResponse.json(
        { success: false, error: "任务记录失败，积分已退还" },
        { status: 500 }
      );
    }
      console.log("[Seedance Submit] Saved to generations:", result.taskId);

    // ============================================
    // 返回结果
    // ============================================
    return NextResponse.json({
      success: true,
      data: {
        taskId: result.taskId,
        status: result.status,
        estimatedTime: modelConfig.estimatedTime || "~2分钟",
        model,
        creditCost,
      },
    });

  } catch (error) {
    console.error("[Seedance Submit] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
