/**
 * 豆包 AI - 步骤1：生成口播脚本
 * 
 * POST /api/video-batch/generate-talking-script
 * 
 * 根据产品图片生成 TikTok 达人自拍口播种草脚本 (C01-C07)
 */

import { NextRequest, NextResponse } from "next/server";
import { generateTalkingScript } from "@/lib/doubao-api";

// ============================================================================
// 请求/响应类型
// ============================================================================

interface RequestBody {
  images: string[];  // 图片 URL 列表
  taskId: string;
  language?: "en" | "zh";
  customPrompts?: {
    systemPrompt?: string;
    userPrompt?: string;
  };
}

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { images, taskId, customPrompts } = body;

    // 参数校验
    if (!images || images.length === 0) {
      return NextResponse.json(
        { success: false, error: "请提供至少一张图片" },
        { status: 400 }
      );
    }

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "请提供任务ID" },
        { status: 400 }
      );
    }

    console.log("[Video Batch] Generating talking script:", {
      taskId,
      imageCount: images.length,
      hasCustomPrompts: !!customPrompts,
    });

    // 调用豆包 API 生成脚本
    const result = await generateTalkingScript(images, customPrompts);

    if (!result.success) {
      console.error("[Video Batch] Script generation failed:", result.error);
      return NextResponse.json(
        { success: false, error: result.error || "生成脚本失败" },
        { status: 500 }
      );
    }

    console.log("[Video Batch] Script generated successfully:", {
      taskId,
      scriptLength: result.script?.length || 0,
    });

    return NextResponse.json({
      success: true,
      data: {
        script: result.script,
        taskId,
      },
    });
  } catch (error) {
    console.error("[Video Batch] Error generating talking script:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "生成脚本失败" 
      },
      { status: 500 }
    );
  }
}
