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
// ============================================================================

const CREDIT_COST_MAP: Record<number, number> = {
  10: 30,   // 10s = 30积分
  15: 50,   // 15s = 50积分
  20: 200,  // 20s = 200积分
  25: 350,  // 25s = 350积分
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
      duration = 10, 
      aspectRatio = "9:16",
      size = "small",
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
    const creditCost = CREDIT_COST_MAP[duration] || 50;
    
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

    console.log("[Generate Video] Submitting task:", {
      originalPrompt: prompt.substring(0, 50) + "...",
      hasTriggerWord: !!triggerWord,
      duration,
      aspectRatio,
      size,
      hasSourceImage: !!sourceImageUrl,
      usePro: duration >= 20,
    });

    // 提交到速创 API - 使用新的统一接口
    const result = await submitSora2({
      prompt: finalPrompt,
      duration: duration as 10 | 15 | 20 | 25,
      aspectRatio: aspectRatio as "9:16" | "16:9",
      size: size as "small" | "large",
      url: sourceImageUrl,
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

    // 保存任务记录到数据库（可选）
    if (userId) {
      try {
        const supabase = createAdminClient();
        await supabase.from("generations").insert({
          user_id: userId,
          model_id: modelId || null,
          task_id: result.taskId,
          prompt: prompt,
          final_prompt: finalPrompt,
          duration,
          aspect_ratio: aspectRatio,
          size,
          source_image_url: sourceImageUrl || null,
          status: "processing",
          credit_cost: creditCost,
          use_pro: duration >= 20,
        });
      } catch (dbError) {
        console.error("[Generate Video] Failed to save to DB:", dbError);
        // 不阻止主流程
      }
    }

    console.log("[Generate Video] Task submitted successfully:", {
      taskId: result.taskId,
      duration,
      usePro: duration >= 20,
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId: result.taskId,
        status: "processing",
        estimatedTime: ESTIMATED_TIME_MAP[duration] || "5-6 minutes",
        usePro: duration >= 20,
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
            video_url: task.resultUrl || null,
            error_message: task.errorMessage || null,
            updated_at: new Date().toISOString(),
          })
          .eq("task_id", taskId);
        
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
