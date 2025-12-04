/**
 * Sora2 视频生成
 * 
 * POST /api/video-batch/generate-sora-video
 * 
 * 支持 Sora2 标清和 Sora2 Pro 模式
 */

import { NextRequest, NextResponse } from "next/server";
import { submitSora2, querySora2Result, waitForTaskCompletion, getSora2ModelName } from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// 请求/响应类型
// ============================================================================

interface RequestBody {
  aiVideoPrompt: string;
  mainGridImageUrl: string;
  aspectRatio: "9:16" | "16:9";
  durationSeconds?: number;
  quality?: "standard" | "hd";
  modelType?: "sora2" | "sora2-pro";
  taskId: string;
  userId?: string;
  creditCost?: number;
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
      durationSeconds = 15,
      quality = "standard",
      modelType = "sora2",
      taskId,
      userId,
      creditCost = 0,
    } = body;

    // 参数校验
    if (!aiVideoPrompt || aiVideoPrompt.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "请提供 AI 视频提示词" },
        { status: 400 }
      );
    }

    if (!mainGridImageUrl) {
      return NextResponse.json(
        { success: false, error: "请提供九宫格主图 URL" },
        { status: 400 }
      );
    }

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "请提供任务ID" },
        { status: 400 }
      );
    }

    // 获取 Sora2 模型名称
    const sora2Model = getSora2ModelName(
      aspectRatio,
      durationSeconds as 10 | 15 | 25,
      quality
    );

    console.log("[Video Batch] Generating Sora video:", {
      taskId,
      model: sora2Model,
      modelType,
      aspectRatio,
      durationSeconds,
      quality,
      promptLength: aiVideoPrompt.length,
      userId: userId || "(not provided)",
      creditCost,
      hasMainImage: !!mainGridImageUrl,
    });

    // 提交 Sora2 视频生成任务
    const submitResult = await submitSora2({
      prompt: aiVideoPrompt,
      duration: durationSeconds as 10 | 15 | 25,
      aspectRatio: aspectRatio,
      url: mainGridImageUrl,
      model: sora2Model,
    });

    if (!submitResult.success || !submitResult.taskId) {
      console.error("[Video Batch] Sora submit failed:", submitResult.error);
      return NextResponse.json(
        { success: false, error: submitResult.error || "视频提交失败" },
        { status: 500 }
      );
    }

    const soraTaskId = submitResult.taskId;
    console.log("[Video Batch] Sora task submitted:", soraTaskId);

    // 等待视频生成完成
    // Sora2 标清: 3-5 分钟, Pro: 15-30 分钟
    const isPro = modelType === "sora2-pro" || quality === "hd" || durationSeconds === 25;
    const maxWaitTime = isPro ? 35 * 60 * 1000 : 10 * 60 * 1000;  // Pro 35分钟, 标清 10分钟
    
    const completionResult = await waitForTaskCompletion(
      soraTaskId,
      (id) => querySora2Result(id, isPro),
      {
        maxWaitTime,
        pollInterval: 15 * 1000,       // 15 秒轮询一次
        onProgress: (task) => {
          console.log("[Video Batch] Sora progress:", {
            taskId: soraTaskId,
            status: task.status,
          });
        },
      }
    );

    if (!completionResult.success || !completionResult.task) {
      console.error("[Video Batch] Sora generation failed:", completionResult.error);
      
      // 失败时也写入 generations 表
      if (userId) {
        try {
          const supabase = createAdminClient();
          await supabase.from("generations").insert({
            user_id: userId,
            task_id: soraTaskId,
            type: "video",
            source: "batch_video",
            prompt: aiVideoPrompt,
            model: sora2Model,
            duration: durationSeconds,
            aspect_ratio: aspectRatio,
            quality: quality,
            source_image_url: mainGridImageUrl,
            status: "failed",
            error_message: completionResult.error || "视频生成失败",
            credit_cost: creditCost,
            use_pro: isPro,
            created_at: new Date().toISOString(),
          });
        } catch (dbError) {
          console.error("[Video Batch] Failed to save failed task to DB:", dbError);
        }
      }
      
      return NextResponse.json(
        { success: false, error: completionResult.error || "视频生成失败" },
        { status: 500 }
      );
    }

    const videoUrl = completionResult.task.resultUrl;

    if (!videoUrl) {
      return NextResponse.json(
        { success: false, error: "视频生成完成但未获取到视频URL" },
        { status: 500 }
      );
    }

    console.log("[Video Batch] Sora video generated successfully:", {
      taskId,
      soraTaskId,
      videoUrl: videoUrl.substring(0, 80) + "...",
    });

    // 写入 generations 表
    if (userId) {
      try {
        const supabase = createAdminClient();
        await supabase.from("generations").insert({
          user_id: userId,
          task_id: soraTaskId,
          type: "video",
          source: "batch_video",
          prompt: aiVideoPrompt,
          model: sora2Model,
          duration: durationSeconds,
          aspect_ratio: aspectRatio,
          quality: quality,
          source_image_url: mainGridImageUrl,
          status: "completed",
          result_url: videoUrl,
          video_url: videoUrl,
          credit_cost: creditCost,
          use_pro: isPro,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
        console.log("[Video Batch] Saved to generations table:", soraTaskId);
      } catch (dbError) {
        console.error("[Video Batch] Failed to save to DB:", dbError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        soraTaskId,
        status: "success",
        videoUrl,
      },
    });
  } catch (error) {
    console.error("[Video Batch] Error generating Sora video:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "视频生成失败" 
      },
      { status: 500 }
    );
  }
}
