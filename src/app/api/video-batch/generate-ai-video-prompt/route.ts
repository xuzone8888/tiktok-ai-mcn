/**
 * 豆包 AI - 步骤2：生成AI视频分镜提示词
 * 
 * POST /api/video-batch/generate-ai-video-prompt
 * 
 * 将口播脚本转换为 Sora2 Pro 可用的分镜提示词
 */

import { NextRequest, NextResponse } from "next/server";
import { generateAiVideoPrompt } from "@/lib/doubao-api";

// 延长 Vercel 函数超时时间
export const maxDuration = 120; // 120秒，豆包服务有时响应较慢

// ============================================================================
// 请求/响应类型
// ============================================================================

interface RequestBody {
  talkingScript: string;
  taskId: string;
  modelTriggerWord?: string;
  customPrompts?: {
    systemPrompt?: string;
    userPrompt?: string;
  };
}

// ============================================================================
// 带超时的 Promise 封装
// ============================================================================
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // 解析请求体（带超时）
    let body: RequestBody;
    try {
      body = await withTimeout(
        request.json(),
        10000,
        "请求解析超时"
      );
    } catch (parseError) {
      console.error("[Video Batch] Request parse error:", parseError);
      return NextResponse.json(
        { success: false, error: parseError instanceof Error ? parseError.message : "请求解析失败" },
        { status: 400 }
      );
    }
    
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

    const { modelTriggerWord, customPrompts } = body;

    console.log("[Video Batch] Generating AI video prompt:", {
      taskId,
      scriptLength: talkingScript.length,
      hasModelTriggerWord: !!modelTriggerWord,
      hasCustomPrompts: !!customPrompts,
    });

    // 调用豆包 API 生成提示词（带超时和重试）
    let result;
    let lastError: Error | null = null;
    const maxRetries = 2; // 最多重试2次（共3次尝试）
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Video Batch] Attempt ${attempt + 1}/${maxRetries + 1} for task ${taskId}`);
        
        result = await withTimeout(
          generateAiVideoPrompt(talkingScript, modelTriggerWord, customPrompts),
          90000, // 90秒超时，给豆包服务更多时间
          `AI提示词生成超时（尝试 ${attempt + 1}/${maxRetries + 1}）`
        );
        
        // 成功则跳出循环
        if (result.success) {
          break;
        }
        
        lastError = new Error(result.error || "生成失败");
      } catch (timeoutError) {
        lastError = timeoutError instanceof Error ? timeoutError : new Error("未知错误");
        console.error(`[Video Batch] Attempt ${attempt + 1} failed:`, lastError.message);
        
        // 如果不是最后一次尝试，等待一会儿再重试
        if (attempt < maxRetries) {
          console.log(`[Video Batch] Waiting 3s before retry...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
    
    // 所有尝试都失败
    if (!result?.success) {
      console.error("[Video Batch] All attempts failed:", lastError?.message);
      return NextResponse.json(
        { 
          success: false, 
          error: lastError?.message || "AI提示词生成失败，豆包服务响应较慢，请稍后重试" 
        },
        { status: 504 }
      );
    }

    if (!result.success) {
      console.error("[Video Batch] Prompt generation failed:", result.error);
      return NextResponse.json(
        { success: false, error: result.error || "生成提示词失败" },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;
    console.log("[Video Batch] AI video prompt generated successfully:", {
      taskId,
      promptLength: result.prompt?.length || 0,
      duration: `${duration}ms`,
    });

    return NextResponse.json({
      success: true,
      data: {
        prompt: result.prompt,
        taskId,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("[Video Batch] Error generating AI video prompt:", error, `duration: ${duration}ms`);
    
    // 确保返回有效的 JSON
    const errorMessage = error instanceof Error ? error.message : "生成提示词失败";
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage.includes("fetch") ? "网络请求失败，请检查网络连接" : errorMessage
      },
      { status: 500 }
    );
  }
}
