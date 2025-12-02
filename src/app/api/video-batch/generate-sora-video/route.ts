/**
 * Sora2 Pro - 视频生成
 * 
 * POST /api/video-batch/generate-sora-video
 * 
 * 使用 AI 视频提示词 + 九宫格图片生成 15 秒视频
 */

import { NextRequest, NextResponse } from "next/server";
import { submitSora2, querySora2Result, waitForTaskCompletion } from "@/lib/suchuang-api";

// ============================================================================
// 请求/响应类型
// ============================================================================

interface RequestBody {
  aiVideoPrompt: string;
  mainGridImageUrl: string;
  aspectRatio: "9:16" | "16:9";
  durationSeconds?: number;
  taskId: string;
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
      taskId 
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

    console.log("[Video Batch] Generating Sora video:", {
      taskId,
      aspectRatio,
      durationSeconds,
      promptLength: aiVideoPrompt.length,
      hasMainImage: !!mainGridImageUrl,
    });

    // 提交 Sora2 视频生成任务
    const submitResult = await submitSora2({
      prompt: aiVideoPrompt,
      duration: durationSeconds as 10 | 15 | 20 | 25,
      aspectRatio: aspectRatio,
      size: "small",  // 默认使用小尺寸，速度快
      url: mainGridImageUrl,
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

    // 等待视频生成完成（最多等待 10 分钟）
    const usePro = durationSeconds >= 20;
    const completionResult = await waitForTaskCompletion(
      soraTaskId,
      (id) => querySora2Result(id, usePro),
      {
        maxWaitTime: 10 * 60 * 1000,  // 10 分钟
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
