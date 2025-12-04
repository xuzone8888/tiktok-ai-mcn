/**
 * Sora2 视频生成 (异步模式)
 * 
 * POST /api/video-batch/generate-sora-video
 * 
 * 提交任务后立即返回 soraTaskId，前端通过轮询获取状态
 */

import { NextRequest, NextResponse } from "next/server";
import { submitSora2, getSora2ModelName } from "@/lib/suchuang-api";
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

    const isPro = modelType === "sora2-pro" || quality === "hd" || durationSeconds === 25;

    console.log("[Video Batch] Submitting Sora video (async mode):", {
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
    console.log("[Video Batch] Sora task submitted (async):", soraTaskId);

    // 立即在数据库中创建 processing 状态的记录
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
          status: "processing",  // 初始状态为处理中
          credit_cost: creditCost,
          use_pro: isPro,
          created_at: new Date().toISOString(),
        });
        console.log("[Video Batch] Created processing record in DB:", soraTaskId);
      } catch (dbError) {
        console.error("[Video Batch] Failed to create DB record:", dbError);
        // 不阻塞返回，继续返回成功
      }
    }

    // 立即返回任务 ID，不等待完成
    return NextResponse.json({
      success: true,
      data: {
        soraTaskId,
        status: "processing",
        message: "视频任务已提交，请通过轮询接口查询状态",
      },
    });
  } catch (error) {
    console.error("[Video Batch] Error submitting Sora video:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "视频提交失败" 
      },
      { status: 500 }
    );
  }
}
