/**
 * 豆包 AI - 步骤2：生成AI视频分镜提示词
 * 
 * POST /api/video-batch/generate-ai-video-prompt
 * 
 * 将口播脚本转换为 Sora2 Pro 可用的分镜提示词
 * 
 * 优化：支持后端验证用户合约并获取触发词
 */

import { NextRequest, NextResponse } from "next/server";
import { generateAiVideoPrompt } from "@/lib/doubao-api";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// 请求/响应类型
// ============================================================================

interface RequestBody {
  talkingScript: string;
  taskId: string;
  modelTriggerWord?: string;  // 前端传入的触发词（向后兼容）
  // 新增：用于后端验证的参数
  userId?: string;
  modelId?: string;
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
    const { talkingScript, taskId, userId, modelId, customPrompts } = body;

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

    // 优先使用后端验证获取触发词
    let verifiedTriggerWord: string | undefined = body.modelTriggerWord;
    let modelName: string | undefined;

    // 如果提供了 userId 和 modelId，从数据库验证并获取触发词
    if (userId && modelId) {
      const supabase = createAdminClient();
      
      // 验证用户是否有该模特的有效合约
      const { data: contract } = await supabase
        .from("contracts")
        .select("id, model_id, ai_models!inner(id, name, trigger_word)")
        .eq("user_id", userId)
        .eq("model_id", modelId)
        .eq("status", "active")
        .gt("end_date", new Date().toISOString())
        .single();

      if (contract) {
        const modelData = contract.ai_models as { id: string; name: string; trigger_word: string | null };
        if (modelData?.trigger_word) {
          verifiedTriggerWord = modelData.trigger_word;
          modelName = modelData.name;
          console.log("[Video Batch] Verified trigger word from DB:", {
            modelId,
            modelName,
            triggerWord: verifiedTriggerWord,
          });
        }
      } else {
        console.warn("[Video Batch] No valid contract found for user:", userId, "model:", modelId);
        // 合约无效时，清除前端传入的触发词
        verifiedTriggerWord = undefined;
      }
    }

    console.log("[Video Batch] Generating AI video prompt:", {
      taskId,
      scriptLength: talkingScript.length,
      hasTriggerWord: !!verifiedTriggerWord,
      modelName: modelName || "(not specified)",
      hasCustomPrompts: !!customPrompts,
    });

    // 调用豆包 API 生成提示词
    const result = await generateAiVideoPrompt(talkingScript, verifiedTriggerWord, customPrompts);

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
      hasDisplayPrompt: !!result.displayPrompt,
    });

    return NextResponse.json({
      success: true,
      data: {
        prompt: result.prompt,  // 完整提示词（含 trigger word，用于发送给视频 API）
        displayPrompt: result.displayPrompt || result.prompt,  // 展示提示词（不含 trigger word）
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
