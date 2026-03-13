/**
 * AI 魔法棒 API — 提示词扩写/翻译
 *
 * POST /api/characters/enhance-prompt
 *
 * 复用 doubao-api-client.ts 的 callDoubaoAPI()
 * 将简短中文角色描述扩写为专业英文生图提示词
 */

import { NextResponse } from "next/server";
import { callDoubaoAPI } from "@/lib/doubao-api-client";
import type { EnhancePromptRequest } from "@/types/character";

// 审查报告第 2 条：必须声明超时，否则部署后极易 504
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ============================================================================
// 系统提示词
// ============================================================================

const EXPAND_SYSTEM_PROMPT = `You are an expert AI image prompt engineer specializing in character design. 
Convert the following simple character description into a highly detailed, professional English prompt 
suitable for AI image generation (such as Flux, DALL-E, Midjourney).

Focus on:
- Physical appearance (face shape, skin tone, expression)
- Clothing and accessories (material, fit, details)
- Hair (style, length, color, texture)
- Body proportions and posture
- Lighting and atmosphere
- Artistic style and rendering quality

Output ONLY the English prompt, nothing else. Do not include any explanations or markdown.
Keep it to 1-2 paragraphs, around 80-150 words.`;

const TRANSLATE_SYSTEM_PROMPT = `You are a professional translator specializing in AI image generation prompts.
Translate the following Chinese text into natural, fluent English suitable as an AI image generation prompt.
Preserve all visual details and artistic intent. Output ONLY the English translation, nothing else.`;

// ============================================================================
// POST — 增强/翻译提示词
// ============================================================================

export async function POST(request: Request) {
  try {
    const body: EnhancePromptRequest = await request.json();

    const { prompt, mode = "expand" } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { success: false, error: "提示词不能为空" },
        { status: 400 }
      );
    }

    console.log("[Enhance Prompt] Request:", {
      mode,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 50),
    });

    const systemPrompt =
      mode === "translate" ? TRANSLATE_SYSTEM_PROMPT : EXPAND_SYSTEM_PROMPT;

    const result = await callDoubaoAPI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt.trim() },
      ],
      {
        maxTokens: 512,
        temperature: 0.7,
        maxRetries: 2,
      }
    );

    if (!result.success || !result.content) {
      console.error("[Enhance Prompt] API failed:", result.error);
      return NextResponse.json(
        {
          success: false,
          error: result.error || "AI 扩写服务暂时不可用，请稍后重试",
        },
        { status: 502 }
      );
    }

    // 清理返回内容（去掉可能的引号和多余空白）
    const enhancedPrompt = result.content
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();

    console.log("[Enhance Prompt] Success:", {
      mode,
      inputLength: prompt.length,
      outputLength: enhancedPrompt.length,
      outputPreview: enhancedPrompt.substring(0, 80),
    });

    return NextResponse.json({
      success: true,
      enhancedPrompt,
    });
  } catch (error) {
    console.error("[Enhance Prompt] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
