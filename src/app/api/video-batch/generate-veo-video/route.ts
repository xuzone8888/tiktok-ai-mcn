/**
 * VEO3 视频生成 (异步模式)
 * 
 * POST /api/video-batch/generate-veo-video
 * 
 * 提交任务后立即返回 veoTaskId，前端通过轮询获取状态
 */

import { NextRequest, NextResponse } from "next/server";
import { submitVeo3, Veo3ModelType } from "@/lib/veo3-api";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// 请求/响应类型
// ============================================================================

interface RequestBody {
  aiVideoPrompt: string;
  mainGridImageUrl?: string; // 图生视频时的参考图
  aspectRatio: "9:16" | "16:9";
  quality?: "fast" | "quality";  // VEO3 质量选项
  taskId: string;
  userId?: string;
  creditCost?: number;
  mode?: "image_to_video" | "prompt_to_video";
}

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { 
      aiVideoPrompt, 
      mainGridImageUrl, 
      aspectRatio, 
      quality = "fast",
      taskId,
      userId,
      creditCost = 0,
      mode = "image_to_video",
    } = body;

    const isPromptMode = mode === "prompt_to_video";

    // 参数校验
    if (!aiVideoPrompt || aiVideoPrompt.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "请提供 AI 视频提示词" },
        { status: 400 }
      );
    }

    // 图片模式下必须提供主图
    if (!isPromptMode && !mainGridImageUrl) {
      return NextResponse.json(
        { success: false, error: "请提供参考图片 URL" },
        { status: 400 }
      );
    }

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "请提供任务ID" },
        { status: 400 }
      );
    }

    // 获取 VEO3 模型名称
    const veo3Model: Veo3ModelType = quality === "quality" ? "veo3.1-quality" : "veo3.1-fast";

    console.log("[VEO3 Batch] Submitting VEO3 video (async mode):", {
      taskId,
      model: veo3Model,
      aspectRatio,
      quality,
      promptLength: aiVideoPrompt.length,
      userId: userId || "(not provided)",
      creditCost,
      hasMainImage: !!mainGridImageUrl,
      mode,
    });

    // 提交 VEO3 视频生成任务
    const submitResult = await submitVeo3({
      prompt: aiVideoPrompt,
      model: veo3Model,
      aspectRatio: aspectRatio,
      ...(mainGridImageUrl && { imageUrls: [mainGridImageUrl] }),
    });

    if (!submitResult.success || !submitResult.taskId) {
      console.error("[VEO3 Batch] VEO3 submit failed:", submitResult.error);
      return NextResponse.json(
        { success: false, error: submitResult.error || "视频提交失败" },
        { status: 500 }
      );
    }

    const veoTaskId = submitResult.taskId;
    console.log("[VEO3 Batch] VEO3 task submitted (async):", veoTaskId);

    // 在数据库中创建 processing 状态的记录
    if (userId) {
      try {
        const supabase = createAdminClient();
        const { data: insertedData, error: insertError } = await supabase
          .from("generations")
          .insert({
            user_id: userId,
            task_id: veoTaskId,
            type: "video",
            source: isPromptMode ? "batch_video_prompt_veo3" : "batch_video_veo3",
            prompt: aiVideoPrompt,
            model: veo3Model,
            duration: 8, // VEO3 固定 8 秒
            aspect_ratio: aspectRatio,
            quality: quality,
            source_image_url: mainGridImageUrl || null,
            status: "processing",
            credit_cost: creditCost,
            use_pro: quality === "quality",
            created_at: new Date().toISOString(),
          })
          .select()
          .single();
        
        if (insertError) {
          console.error("[VEO3 Batch] Failed to create DB record:", insertError);
        } else {
          console.log("[VEO3 Batch] Created processing record in DB:", {
            id: insertedData?.id,
            taskId: veoTaskId,
            userId: userId,
          });
        }
      } catch (dbError) {
        console.error("[VEO3 Batch] Failed to create DB record (exception):", dbError);
      }
    } else {
      console.warn("[VEO3 Batch] No userId provided, skipping DB record creation for task:", veoTaskId);
    }

    // 立即返回任务 ID，不等待完成
    return NextResponse.json({
      success: true,
      data: {
        veoTaskId,
        status: "processing",
        message: "VEO3 视频任务已提交，请通过轮询接口查询状态",
      },
    });
  } catch (error) {
    console.error("[VEO3 Batch] Error submitting VEO3 video:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "视频提交失败" 
      },
      { status: 500 }
    );
  }
}
