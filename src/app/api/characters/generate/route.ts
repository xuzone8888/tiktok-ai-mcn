/**
 * 角色图片生成 API — V5 Gemini 同步版
 *
 * POST /api/characters/generate
 *   type="hero"(默认): 生成 Hero Shot（扣 20 积分）
 *     → 使用 Gemini 4K 同步生成，结果直接上传 OSS，返回永久 imageUrl
 *     → 不再使用 nanoBanana-pro（openpt.wuyinkeji.com 临时 CDN 已废弃）
 *   type="reference":  生成多角度参考图（不扣积分，用 heroImageUrl 做参考）
 *     → 使用 Gemini 2K，结果上传 OSS
 *
 * GET /api/characters/generate?taskId=xxx
 *   → 仅保留做历史 nanoBanana 任务兼容查询，新流程不再使用
 */

import { NextResponse } from "next/server";
import {
  queryNanoBananaResult,
} from "@/lib/suchuang-api";
import { submitGeminiImage } from "@/lib/gemini-image-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { callDoubaoAPI } from "@/lib/doubao-api-client";
import type { GenerateCharacterRequest } from "@/types/character";

export const maxDuration = 120; // Gemini 4K 最长约 25s，留足余量
export const dynamic = "force-dynamic";

// ============================================================================
// 积分配置
// ============================================================================

const HERO_GENERATE_CREDITS = 20; // Hero 阶段一次扣完（含多角度预扣）

// ============================================================================
// 中文翻译
// ============================================================================

async function translateIfChinese(prompt: string): Promise<string> {
  const hasChinese = /[\u4e00-\u9fff]/.test(prompt);
  if (!hasChinese) return prompt.trim();

  console.log("[Character Generate] Detected Chinese, translating...");
  try {
    const result = await callDoubaoAPI(
      [
        {
          role: "system",
          content:
            "Translate the following text into natural, fluent English suitable as an AI image generation prompt. Preserve all visual details and artistic intent. Output ONLY the English text, nothing else.",
        },
        { role: "user", content: prompt.trim() },
      ],
      { maxTokens: 512, temperature: 0.3, maxRetries: 2 }
    );

    if (result.success && result.content) {
      const translated = result.content
        .replace(/^["'`]+|["'`]+$/g, "")
        .trim();
      console.log("[Character Generate] Translated:", translated.substring(0, 80));
      return translated;
    }
  } catch (err) {
    console.error("[Character Generate] Translation failed, using original:", err);
  }
  return prompt.trim(); // 翻译失败回退原文
}

// ============================================================================
// Prompt 模板
// ============================================================================

/** Hero Shot: 电影级单人立绘 (Pro 4K, 3:4) */
const HERO_SHOT_TEMPLATE = `

Create a single stunning character portrait in 3:4 vertical composition.
This should be a cinematic hero shot with dramatic lighting, 
showing the character from mid-thigh up in a confident, dynamic pose.

Requirements:
- Professional studio quality, ultra detailed
- Dramatic cinematic lighting with rim light
- Character fills 70-80% of the frame
- Slight dynamic angle (not straight-on)
- Rich background atmosphere matching the character's theme
- 4K resolution, sharp focus on face and upper body
- Magazine cover quality composition`;

/** 多角度参考图: 基于参考图的转面图 (标准, 16:9) */
const MULTI_ANGLE_TEMPLATE = `

Based on the reference image provided, generate a multi-angle turnaround of this EXACT same character from 7 different camera angles in a clean grid layout on a pure white background.

CRITICAL STYLE RULE: You MUST preserve the EXACT same rendering style as the reference image. If the reference is photorealistic, the output must be photorealistic. If the reference is anime/cartoon/illustration, the output must match that exact same art style. Do NOT change or deviate from the reference image's visual style under any circumstances.

The character's face, body proportions, clothing, colors, textures, accessories, and overall appearance MUST exactly match the reference image.

Row 1 (full body, natural standing pose, 4 panels):
front view | left 3/4 profile | right 3/4 profile | back view

Row 2 (close-up headshot, 3 panels centered):
front face | left profile face | right profile face

Critical requirements:
- Rendering style must be IDENTICAL to the reference image (do not change art style)
- Character must look like the SAME person/character in every panel
- Maintain exact same color palette, proportions, and level of detail
- Consistent lighting across all views
- Clean separation between panels
- High quality, detailed rendering, sharp focus`;


// ============================================================================
// POST — Hero / Reference 分派
// ============================================================================

export async function POST(request: Request) {
  try {
    const body: GenerateCharacterRequest = await request.json();
    const { prompt, sourceImageUrl, userId, type = "hero", heroImageUrl } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { success: false, error: "提示词不能为空" },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "userId is required" },
        { status: 400 }
      );
    }

    // ============================================
    // type = "reference" — 多角度参考图（不扣积分）
    // ============================================
    if (type === "reference") {
      if (!heroImageUrl) {
        return NextResponse.json(
          { success: false, error: "heroImageUrl is required for reference type" },
          { status: 400 }
        );
      }

      // 翻译 prompt（可能已经是英文）
      const englishPrompt = await translateIfChinese(prompt);
      const refPrompt = `${englishPrompt}.${MULTI_ANGLE_TEMPLATE}`;

      console.log("[Character Generate] Submitting reference task (gemini-4k, gaorui native):", {
        promptLength: refPrompt.length,
        heroImageUrl: heroImageUrl.substring(0, 60),
      });

      // 使用 gemini-4k (高瑞原生格式) — 返回 base64 → 内部上传 OSS → 永久 URL
      // 之前用 gemini-2k (xas231) 返回临时 URL，阿里云 ECS 下载该临时 URL 经常 ETIMEDOUT
      const geminiResult = await submitGeminiImage({
        model: "gemini-4k",
        prompt: refPrompt,
        sourceImageUrls: [heroImageUrl],
        aspectRatio: "16:9",
      });

      if (!geminiResult.success || !geminiResult.imageUrl) {
        return NextResponse.json(
          { success: false, error: geminiResult.error || "多角度参考图生成失败" },
          { status: 500 }
        );
      }

      console.log("[Character Generate] Reference image ready:", geminiResult.imageUrl.substring(0, 80));

      // gemini-4k (gaorui native) 返回 base64 → submitGeminiImage 内部已上传 OSS → 永久 URL
      // 检查是否已是永久 OSS URL，若是则直接使用，无需再次下载转存
      let permanentUrl: string | null = null;
      const isAlreadyPermanent = geminiResult.imageUrl.includes('aliyuncs.com') || geminiResult.imageUrl.includes('oss-cn-');

      if (isAlreadyPermanent) {
        permanentUrl = geminiResult.imageUrl;
        console.log("[Character Generate] Reference already on OSS, skip re-upload");
      } else {
        // fallback: 如果返回的是临时 URL（例如 fallback 到 xas231），仍需下载转存
        const maxOssRetries = 2;
        for (let attempt = 1; attempt <= maxOssRetries; attempt++) {
          try {
            const { uploadImageBuffer, generateMediaPath } = await import('@/lib/oss');
            const imgResponse = await fetch(geminiResult.imageUrl);
            if (!imgResponse.ok) {
              throw new Error(`Failed to download temp image: ${imgResponse.status}`);
            }
            const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
            const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
            const ext = contentType.split('/')[1] || 'jpg';
            const objectPath = generateMediaPath(
              'images',
              'character-reference',
              `ref-sheet-${Date.now()}.${ext}`
            );
            permanentUrl = await uploadImageBuffer(imgBuffer, objectPath, contentType);
            console.log("[Character Generate] Reference uploaded to OSS:", permanentUrl.substring(0, 80));
            break;
          } catch (ossErr) {
            console.error(`[Character Generate] OSS upload attempt ${attempt}/${maxOssRetries} failed:`, ossErr);
            if (attempt < maxOssRetries) {
              await new Promise(r => setTimeout(r, 1000 * attempt));
            }
          }
        }
      }

      if (!permanentUrl) {
        console.error("[Character Generate] OSS upload failed after all retries, refusing to store temp URL");
        return NextResponse.json(
          { success: false, error: "参考图持久化失败，请重试生成" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        referenceImageUrl: permanentUrl,
      });
    }

    // ============================================
    // type = "hero"（默认）— Hero Shot + 积分扣除
    // ============================================
    const supabase = createAdminClient();

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profileData) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const currentCredits = (profileData as { credits: number }).credits;

    if (currentCredits < HERO_GENERATE_CREDITS) {
      return NextResponse.json(
        {
          success: false,
          error: `积分不足！需要 ${HERO_GENERATE_CREDITS} 积分，当前余额 ${currentCredits}`,
        },
        { status: 400 }
      );
    }

    // 乐观锁扣费（带重试）
    let deductSuccess = false;
    let deductAttempts = 0;
    const maxAttempts = 3;

    while (!deductSuccess && deductAttempts < maxAttempts) {
      deductAttempts++;

      const { data: latestProfile } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .single();

      const latestCredits =
        (latestProfile as unknown as { credits: number })?.credits || 0;

      if (latestCredits < HERO_GENERATE_CREDITS) {
        return NextResponse.json(
          {
            success: false,
            error: `积分不足！需要 ${HERO_GENERATE_CREDITS} 积分，当前余额 ${latestCredits}`,
          },
          { status: 400 }
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deductError } = await (supabase as any)
        .from("profiles")
        .update({ credits: latestCredits - HERO_GENERATE_CREDITS })
        .eq("id", userId)
        .eq("credits", latestCredits); // 乐观锁

      if (!deductError) {
        deductSuccess = true;
      } else if (deductAttempts < maxAttempts) {
        console.log(
          `[Character Generate] Credits deduct retry ${deductAttempts}/${maxAttempts}`
        );
        await new Promise((r) => setTimeout(r, 100 * deductAttempts));
      }
    }

    if (!deductSuccess) {
      console.error(
        "[Character Generate] Failed to deduct credits after retries"
      );
      return NextResponse.json(
        { success: false, error: "扣费失败，请重试" },
        { status: 500 }
      );
    }

    // 翻译中文 prompt
    const englishPrompt = await translateIfChinese(prompt);
    const heroPrompt = `${englishPrompt}.${HERO_SHOT_TEMPLATE}`;

    console.log("[Character Generate] Generating Hero Shot via Gemini 4K:", {
      userId,
      cost: HERO_GENERATE_CREDITS,
      before: currentCredits,
      after: currentCredits - HERO_GENERATE_CREDITS,
      promptLength: heroPrompt.length,
      promptPreview: englishPrompt.substring(0, 80),
      hasSourceImage: !!sourceImageUrl,
    });

    // V5: 使用 Gemini 4K（高瑞）同步生成 Hero Shot
    // - 结果由 submitGeminiImage 自动上传 OSS → 返回永久 URL
    // - 不再使用 nanoBanana-pro（openpt.wuyinkeji.com 临时 CDN）
    const heroResult = await submitGeminiImage({
      model: "gemini-4k",
      prompt: heroPrompt,
      sourceImageUrls: sourceImageUrl ? [sourceImageUrl] : undefined,
      aspectRatio: "3:4",
    });

    if (!heroResult.success || !heroResult.imageUrl) {
      // Hero 失败 → 全额退 20
      console.error("[Character Generate] Hero failed, refunding", HERO_GENERATE_CREDITS);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("profiles")
        .update({ credits: currentCredits })
        .eq("id", userId);

      return NextResponse.json(
        {
          success: false,
          error: `Hero Shot 生成失败，积分已退还。${heroResult.error || ""}`,
        },
        { status: 500 }
      );
    }

    console.log("[Character Generate] Hero Shot ready (OSS):", heroResult.imageUrl.substring(0, 80));

    // 同步返回图片 URL（永久 OSS URL）+ 英文 prompt（给前端触发多角度生成）
    // heroTaskId 不再存在，前端收到 heroImageUrl 直接展示，无需轮询
    return NextResponse.json({
      success: true,
      heroImageUrl: heroResult.imageUrl,  // 永久 OSS URL
      refPrompt: englishPrompt,
    });
  } catch (error) {
    console.error("[Character Generate] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET — 查询生成任务状态（通用轮询，Hero 和多角度共用）
// ============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    const result = await queryNanoBananaResult(taskId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "查询失败" },
        { status: 500 }
      );
    }

    // 注意：新流程（V5）Hero Shot 已改为同步 Gemini 生成，不再经过此 GET 轮询
    // 此 GET handler 仅保留用于查询历史 nanoBanana 任务（兼容旧前端）
    return NextResponse.json({
      success: true,
      task: result.task,
    });
  } catch (error) {
    console.error("[Character Generate] Query error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
