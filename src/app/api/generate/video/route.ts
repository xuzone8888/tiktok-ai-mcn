/**
 * 视频生成 API
 * 
 * POST /api/generate/video - 提交视频生成任务
 * GET /api/generate/video?taskId=xxx - 查询任务状态
 */

import { NextResponse } from "next/server";
import { 
  submitVideoGeneration, 
  queryVideoResult,
  type SoraSubmitParams 
} from "@/lib/sora-api-real";
import { createAdminClient } from "@/lib/supabase/admin";

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

    // 验证时长
    if (![10, 15].includes(duration)) {
      return NextResponse.json(
        { success: false, error: "Duration must be 10 or 15 seconds" },
        { status: 400 }
      );
    }

    // ============================================
    // 计算费用并扣除积分
    // ============================================
    const creditCost = duration === 10 ? 30 : 50; // 10s=30积分, 15s=50积分
    
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
    });

    // 提交到速创 API
    const submitParams: SoraSubmitParams = {
      prompt: finalPrompt,
      duration: duration as 10 | 15,
      aspectRatio: aspectRatio as "9:16" | "16:9",
      size: size as "small" | "large",
    };

    // 如果有参考图片，添加到请求
    if (sourceImageUrl) {
      submitParams.url = sourceImageUrl;
    }

    const result = await submitVideoGeneration(submitParams);

    if (!result.success) {
      console.error("[Generate Video] Submit failed:", result.error);
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
        });
      } catch (dbError) {
        console.error("[Generate Video] Failed to save to DB:", dbError);
        // 不阻止主流程
      }
    }

    console.log("[Generate Video] Task submitted successfully:", {
      taskId: result.taskId,
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId: result.taskId,
        status: "processing",
        estimatedTime: duration === 10 ? "4-5 minutes" : "5-6 minutes",
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

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    console.log("[Generate Video] Querying task:", taskId);

    const result = await queryVideoResult(taskId);

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
          .select("user_id, duration, status")
          .eq("task_id", taskId)
          .single();
        
        // 更新 generation 状态
        await supabase
          .from("generations")
          .update({
            status: task.status,
            video_url: task.videoUrl || null,
            error_message: task.errorMessage || null,
            updated_at: new Date().toISOString(),
          })
          .eq("task_id", taskId);
        
        // 如果生成失败，退还积分
        if (task.status === "failed" && generation?.user_id && generation?.status !== "failed") {
          const refundAmount = generation.duration === 10 ? 30 : 50;
          
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
        videoUrl: task.videoUrl,
        errorMessage: task.errorMessage,
        duration: task.duration,
        aspectRatio: task.aspectRatio,
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

