/**
 * 视频生成 API
 * 
 * POST /api/generate/video - 提交视频生成任务
 * GET /api/generate/video?taskId=xxx - 查询任务状态
 */

import { NextResponse } from "next/server";
import { submitSora2, querySora2Result } from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// 积分配置
// 快速单个视频功能扣分机制：
// - 标准款（10秒/15秒 横/竖屏）：20 积分/条
// - PRO 款（25秒 横/竖屏）：320 积分/条
// - PRO 高清款（15秒 横/竖屏）：320 积分/条
// ============================================================================

function getVideoCreditCost(duration: number, quality: string): number {
  // PRO 高清款 15秒
  if (duration === 15 && quality === "hd") {
    return 320;
  }
  // PRO 款 25秒
  if (duration === 25) {
    return 320;
  }
  // 标准款 10秒/15秒
  if (duration === 10 || duration === 15) {
    return 20;
  }
  // 默认
  return 20;
}

// 保留旧的映射用于兼容
const CREDIT_COST_MAP: Record<number, number> = {
  10: 20,   // 标准款 10s = 20积分
  15: 20,   // 标准款 15s = 20积分
  20: 320,  // PRO款 20s = 320积分 (如果支持)
  25: 320,  // PRO款 25s = 320积分
};

const ESTIMATED_TIME_MAP: Record<number, string> = {
  10: "4-5 minutes",
  15: "5-6 minutes",
  20: "7-8 minutes",
  25: "8-10 minutes",
};

// ============================================================================
// POST - 提交视频生成任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const { 
      prompt, 
      duration = 15, 
      aspectRatio = "9:16",
      quality = "standard",
      apiModel,
      modelId,
      sourceImageUrl,
      userId,
    } = body;

    if (!prompt || prompt.trim().length < 5) {
      return NextResponse.json(
        { success: false, error: "Prompt must be at least 5 characters" },
        { status: 400 }
      );
    }

    // 验证时长 - 支持 10, 15, 20, 25 秒
    if (![10, 15, 20, 25].includes(duration)) {
      return NextResponse.json(
        { success: false, error: "Duration must be 10, 15, 20, or 25 seconds" },
        { status: 400 }
      );
    }

    // ============================================
    // 计算费用并扣除积分
    // ============================================
    const creditCost = getVideoCreditCost(duration, quality);
    
    if (userId) {
      const supabase = createAdminClient();
      
      // 获取用户当前积分
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .single();
      
      if (profileError || !profile) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 }
        );
      }
      
      if (profile.credits < creditCost) {
        return NextResponse.json(
          { success: false, error: `积分不足！需要 ${creditCost} 积分，当前余额 ${profile.credits}` },
          { status: 400 }
        );
      }
      
      // 扣除积分
      const { error: deductError } = await supabase
        .from("profiles")
        .update({ credits: profile.credits - creditCost })
        .eq("id", userId);
      
      if (deductError) {
        console.error("[Generate Video] Failed to deduct credits:", deductError);
        return NextResponse.json(
          { success: false, error: "Failed to deduct credits" },
          { status: 500 }
        );
      }
      
      console.log("[Generate Video] Credits deducted:", {
        userId,
        cost: creditCost,
        duration,
        before: profile.credits,
        after: profile.credits - creditCost,
      });
    }

    // 组装最终 prompt（如果有模特 ID，注入 trigger word）
    let finalPrompt = prompt;
    let triggerWord: string | null = null;

    if (modelId) {
      const supabase = createAdminClient();
      const { data: model } = await supabase
        .from("ai_models")
        .select("trigger_word, name")
        .eq("id", modelId)
        .single();

      if (model?.trigger_word) {
        triggerWord = model.trigger_word;
        finalPrompt = `Professional video featuring ${triggerWord}. ${prompt}`;
        console.log("[Generate Video] Injected trigger word:", {
          modelName: model.name,
          triggerWord: triggerWord,
        });
      }
    }

    // 添加质量提升词
    finalPrompt += ". High quality, cinematic, professional lighting.";

    // 确定使用的 Sora2 模型
    const isPro = quality === "hd" || duration === 25;
    
    console.log("[Generate Video] Submitting task:", {
      originalPrompt: prompt.substring(0, 50) + "...",
      hasTriggerWord: !!triggerWord,
      duration,
      aspectRatio,
      quality,
      apiModel,
      hasSourceImage: !!sourceImageUrl,
      usePro: isPro,
    });

    // 提交到速创 API - 使用新的统一接口
    const result = await submitSora2({
      prompt: finalPrompt,
      duration: duration as 10 | 15 | 25,
      aspectRatio: aspectRatio as "9:16" | "16:9",
      url: sourceImageUrl,
      model: apiModel, // 直接使用传入的 API 模型名
    });

    if (!result.success) {
      console.error("[Generate Video] Submit failed:", result.error);
      
      // 如果提交失败，退还积分
      if (userId) {
        try {
          const supabase = createAdminClient();
          const { data: profile } = await supabase
            .from("profiles")
            .select("credits")
            .eq("id", userId)
            .single();
          
          if (profile) {
            await supabase
              .from("profiles")
              .update({ credits: profile.credits + creditCost })
              .eq("id", userId);
            
            console.log("[Generate Video] Credits refunded due to submit failure:", {
              userId,
              refund: creditCost,
            });
          }
        } catch (refundError) {
          console.error("[Generate Video] Failed to refund credits:", refundError);
        }
      }
      
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    // 保存任务记录到数据库
    if (userId) {
      try {
        const supabase = createAdminClient();
        await supabase.from("generations").insert({
          user_id: userId,
          model_id: modelId || null,
          task_id: result.taskId,
          type: "video",
          source: "quick_gen",
          prompt: prompt,
          final_prompt: finalPrompt,
          model: apiModel || `sora2-${duration}s`,
          duration,
          aspect_ratio: aspectRatio,
          quality: quality,
          source_image_url: sourceImageUrl || null,
          status: "processing",
          credit_cost: creditCost,
          use_pro: isPro,
          created_at: new Date().toISOString(),
        });
        console.log("[Generate Video] Saved to generations table:", result.taskId);
      } catch (dbError) {
        console.error("[Generate Video] Failed to save to DB:", dbError);
        // 不阻止主流程
      }
    }

    console.log("[Generate Video] Task submitted successfully:", {
      taskId: result.taskId,
      duration,
      quality,
      usePro: isPro,
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId: result.taskId,
        status: "processing",
        estimatedTime: ESTIMATED_TIME_MAP[duration] || "5-6 minutes",
        usePro: isPro,
      },
    });
  } catch (error) {
    console.error("[Generate Video] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET - 查询任务状态
// ============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const usePro = searchParams.get("usePro") === "true";

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    console.log("[Generate Video] Querying task:", taskId, { usePro });

    const result = await querySora2Result(taskId, usePro);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    const task = result.task!;

    // 更新数据库状态
    if (task.status === "completed" || task.status === "failed") {
      try {
        const supabase = createAdminClient();
        
        // 获取 generation 记录以获取 user_id 和 duration
        const { data: generation } = await supabase
          .from("generations")
          .select("user_id, duration, status, credit_cost")
          .eq("task_id", taskId)
          .single();
        
        // 更新 generation 状态
        await supabase
          .from("generations")
          .update({
            status: task.status,
            result_url: task.resultUrl || null,
            video_url: task.resultUrl || null,
            error_message: task.errorMessage || null,
            completed_at: task.status === "completed" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("task_id", taskId);
        
        console.log("[Generate Video] Updated generations table:", taskId, task.status, task.resultUrl ? "has URL" : "no URL");
        
        // 如果生成失败，退还积分
        if (task.status === "failed" && generation?.user_id && generation?.status !== "failed") {
          const refundAmount = generation.credit_cost || CREDIT_COST_MAP[generation.duration] || 50;
          
          const { data: profile } = await supabase
            .from("profiles")
            .select("credits")
            .eq("id", generation.user_id)
            .single();
          
          if (profile) {
            await supabase
              .from("profiles")
              .update({ credits: profile.credits + refundAmount })
              .eq("id", generation.user_id);
            
            console.log("[Generate Video] Credits refunded due to failure:", {
              userId: generation.user_id,
              refund: refundAmount,
            });
          }
        }
      } catch (dbError) {
        console.error("[Generate Video] Failed to update DB:", dbError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        videoUrl: task.resultUrl,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    });
  } catch (error) {
    console.error("[Generate Video] Query error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
