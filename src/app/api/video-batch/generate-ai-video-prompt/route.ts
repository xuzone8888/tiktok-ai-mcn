/**
 * 豆包 AI - 步骤2：生成AI视频分镜提示词
 * 
 * POST /api/video-batch/generate-ai-video-prompt
 * 
 * 将口播脚本转换为 Sora2 Pro 可用的分镜提示词
 */

import { NextRequest, NextResponse } from "next/server";
import { generateAiVideoPrompt } from "@/lib/doubao-api";

// ============================================================================
// 请求/响应类型
// ============================================================================

interface RequestBody {
  talkingScript: string;
  taskId: string;
  modelTriggerWord?: string;
}

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { talkingScript, taskId } = body;

    // 参数校验
    if (!talkingScript || talkingScript.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "请提供口播脚本" },
        { status: 400 }
      );
    }

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "请提供任务ID" },
        { status: 400 }
      );
    }

    const { modelTriggerWord } = body;

    console.log("[Video Batch] Generating AI video prompt:", {
      taskId,
      scriptLength: talkingScript.length,
      hasModelTriggerWord: !!modelTriggerWord,
    });

    // 调用豆包 API 生成提示词
    const result = await generateAiVideoPrompt(talkingScript, modelTriggerWord);

    if (!result.success) {
      console.error("[Video Batch] Prompt generation failed:", result.error);
      return NextResponse.json(
        { success: false, error: result.error || "生成提示词失败" },
        { status: 500 }
      );
    }

    console.log("[Video Batch] AI video prompt generated successfully:", {
      taskId,
      promptLength: result.prompt?.length || 0,
    });

    return NextResponse.json({
      success: true,
      data: {
        prompt: result.prompt,
        taskId,
      },
    });
  } catch (error) {
    console.error("[Video Batch] Error generating AI video prompt:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "生成提示词失败" 
      },
      { status: 500 }
    );
  }
}
