/**
 * 执行完整视频生产流水线
 * 
 * POST /api/video-batch/execute-full-pipeline
 * 
 * 完整流程：
 * 1. 上传图片（如果是 blob URL）
 * 2. 调用豆包生成口播脚本
 * 3. 调用豆包生成 AI 视频提示词
 * 4. 调用 Sora2 Pro 生成视频
 */

import { NextRequest, NextResponse } from "next/server";

// ============================================================================
// 请求类型
// ============================================================================

interface ImageInfo {
  url: string;
  name: string;
  isMainGrid: boolean;
}

interface RequestBody {
  taskId: string;
  images: ImageInfo[];
  aspectRatio: "9:16" | "16:9" | "1:1";
  userId?: string;
  durationSeconds?: number;
  quality?: "standard" | "hd";
  creditCost?: number;
}

// ============================================================================
// 内部 API 调用
// ============================================================================

async function callGenerateTalkingScript(images: string[], taskId: string): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  
  const response = await fetch(`${baseUrl}/api/video-batch/generate-talking-script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, taskId }),
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "生成脚本失败");
  }

  return result.data.script;
}

async function callGenerateAiVideoPrompt(talkingScript: string, taskId: string): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  
  const response = await fetch(`${baseUrl}/api/video-batch/generate-ai-video-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ talkingScript, taskId }),
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "生成提示词失败");
  }

  return result.data.prompt;
}

async function callGenerateSoraVideo(
  aiVideoPrompt: string, 
  mainGridImageUrl: string, 
  aspectRatio: string,
  taskId: string,
  options: {
    durationSeconds?: number;
    quality?: string;
    userId?: string;
    creditCost?: number;
  } = {}
): Promise<{ soraTaskId: string; videoUrl: string }> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const { durationSeconds = 15, quality = "standard", userId, creditCost = 0 } = options;
  
  const response = await fetch(`${baseUrl}/api/video-batch/generate-sora-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      aiVideoPrompt, 
      mainGridImageUrl, 
      aspectRatio,
      durationSeconds,
      quality,
      taskId,
      userId,
      creditCost,
    }),
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || "视频生成失败");
  }

  return {
    soraTaskId: result.data.soraTaskId,
    videoUrl: result.data.videoUrl,
  };
}

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { taskId, images, aspectRatio, userId, durationSeconds = 15, quality = "standard", creditCost = 0 } = body;

    // 参数校验
    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "请提供任务ID" },
        { status: 400 }
      );
    }

    if (!images || images.length === 0) {
      return NextResponse.json(
        { success: false, error: "请提供图片" },
        { status: 400 }
      );
    }

    // 找到主九宫格图
    const mainGridImage = images.find((img) => img.isMainGrid);
    if (!mainGridImage) {
      return NextResponse.json(
        { success: false, error: "请设置九宫格主图" },
        { status: 400 }
      );
    }

    console.log("[Video Batch Pipeline] Starting full pipeline:", {
      taskId,
      imageCount: images.length,
      aspectRatio,
      userId,
    });

    // ========================================
    // Step 1: 生成口播脚本
    // ========================================
    console.log("[Video Batch Pipeline] Step 1: Generating talking script...");
    const imageUrls = images.map((img) => img.url);
    const talkingScript = await callGenerateTalkingScript(imageUrls, taskId);
    console.log("[Video Batch Pipeline] Step 1 completed, script length:", talkingScript.length);

    // ========================================
    // Step 2: 生成 AI 视频提示词
    // ========================================
    console.log("[Video Batch Pipeline] Step 2: Generating AI video prompt...");
    const aiVideoPrompt = await callGenerateAiVideoPrompt(talkingScript, taskId);
    console.log("[Video Batch Pipeline] Step 2 completed, prompt length:", aiVideoPrompt.length);

    // ========================================
    // Step 3: 生成 Sora 视频
    // ========================================
    console.log("[Video Batch Pipeline] Step 3: Generating Sora video...");
    const { soraTaskId, videoUrl } = await callGenerateSoraVideo(
      aiVideoPrompt,
      mainGridImage.url,
      aspectRatio,
      taskId,
      { durationSeconds, quality, userId, creditCost }
    );
    console.log("[Video Batch Pipeline] Step 3 completed, video URL:", videoUrl);

    // ========================================
    // 返回完整结果
    // ========================================
    return NextResponse.json({
      success: true,
      data: {
        taskId,
        talkingScript,
        aiVideoPrompt,
        soraTaskId,
        videoUrl,
        status: "success",
      },
    });
  } catch (error) {
    console.error("[Video Batch Pipeline] Error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "流水线执行失败" 
      },
      { status: 500 }
    );
  }
}


