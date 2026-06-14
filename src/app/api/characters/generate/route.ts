/**
 * 角色图片生成 API — GPTImage2 统一平台版
 *
 * POST /api/characters/generate
 *   type="board"(默认): 一次生成完整 2K 角色设定板（扣 20 积分）
 *     → 左侧主角展示 + 右侧多角度参考，结果转存 OSS，返回永久 imageUrl
 *
 * GET /api/characters/generate?taskId=xxx
 *   → 仅保留做历史 nanoBanana 任务兼容查询，新流程不再使用
 */

import { NextResponse } from "next/server";
import sharp from "sharp";

import { callDoubaoAPI } from "@/lib/doubao-api-client";
import { generateMediaPath, uploadImageBuffer } from "@/lib/oss";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { queryNanoBananaResult } from "@/lib/suchuang-api";
import { generateGptImage2 } from "@/lib/video-models/platform-image-client";
import type { CharacterBoardCropMeta, GenerateCharacterRequest } from "@/types/character";

export const maxDuration = 420; // GPTImage2 为异步轮询，给真实接口留足余量
export const dynamic = "force-dynamic";

// ============================================================================
// 积分配置
// ============================================================================

const BOARD_GENERATE_CREDITS = 20;
const BOARD_IMAGE_SIZE = "2048x1360";
const BOARD_SPLIT_RATIO = 949 / 2048;
const BOARD_CROP_GUTTER_RATIO = 48 / 2048;

async function getCurrentUser() {
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  return user;
}

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

const CHARACTER_BOARD_TEMPLATE = `Create a premium 2K AI character reference board for a video creation product: one consistent character, left side large full-body hero portrait, right side complete multi-angle reference sheet with front view, side view, back view, and close-up head portraits, clear vertical split into two aligned panels for UI cropping, realistic studio lighting, no text, no watermark.
Character concept: {{CHARACTER_CONCEPT}}.`;

function parseSize(size: string): { width: number; height: number } {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return { width: 2048, height: 1360 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function buildBoardCropMeta(size: string): CharacterBoardCropMeta {
  const { width, height } = parseSize(size);
  const splitX = Math.round(width * BOARD_SPLIT_RATIO);
  const seam = Math.max(24, Math.round(width * BOARD_CROP_GUTTER_RATIO));

  return {
    sourceWidth: width,
    sourceHeight: height,
    splitX,
    seam,
    left: {
      left: 0,
      top: 0,
      width: Math.max(1, splitX - Math.ceil(seam / 2)),
      height,
    },
    right: {
      left: Math.min(width - 1, splitX + Math.floor(seam / 2)),
      top: 0,
      width: Math.max(1, width - splitX - Math.floor(seam / 2)),
      height,
    },
  };
}

async function fetchBoardImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`角色设定板下载失败: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(new Uint8Array(arrayBuffer));
}

async function cropAndPersistAvatar(params: {
  boardUrl: string;
  cropMeta: CharacterBoardCropMeta;
  userId: string;
}): Promise<string> {
  const boardBuffer = await fetchBoardImageBuffer(params.boardUrl);
  const image = sharp(boardBuffer);
  const metadata = await image.metadata();

  const actualWidth = metadata.width || params.cropMeta.sourceWidth;
  const actualHeight = metadata.height || params.cropMeta.sourceHeight;
  const scaleX = actualWidth / params.cropMeta.sourceWidth;
  const scaleY = actualHeight / params.cropMeta.sourceHeight;

  const crop = params.cropMeta.left;
  const left = Math.max(0, Math.round(crop.left * scaleX));
  const top = Math.max(0, Math.round(crop.top * scaleY));
  const width = Math.max(1, Math.min(actualWidth - left, Math.round(crop.width * scaleX)));
  const height = Math.max(1, Math.min(actualHeight - top, Math.round(crop.height * scaleY)));

  const avatarBuffer = await image
    .extract({ left, top, width, height })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const objectPath = generateMediaPath(
    "images",
    params.userId,
    `character-avatar-${Date.now()}.jpg`
  );

  return uploadImageBuffer(avatarBuffer, objectPath, "image/jpeg");
}


// ============================================================================
// POST — 完整角色设定板
// ============================================================================

export async function POST(request: Request) {
  try {
    const body: GenerateCharacterRequest = await request.json();
    const { prompt, sourceImageUrl, userId, type = "board" } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { success: false, error: "提示词不能为空" },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    if (userId && userId !== user.id) {
      return NextResponse.json(
        { success: false, error: "用户身份不匹配" },
        { status: 403 }
      );
    }

    // 旧的 hero/reference 两段式不再作为创建角色入口使用。
    if (type === "reference") {
      return NextResponse.json(
        { success: false, error: "多角度参考图已合并到完整设定板生成流程，请重新创建角色" },
        { status: 410 }
      );
    }

    // ============================================
    // type = "board"/"hero"（兼容旧 hero 入参）— 完整设定板 + 积分扣除
    // ============================================
    const supabase = createAdminClient();

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profileError || !profileData) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const currentCredits = (profileData as { credits: number }).credits;

    if (currentCredits < BOARD_GENERATE_CREDITS) {
      return NextResponse.json(
        {
          success: false,
          error: `积分不足！需要 ${BOARD_GENERATE_CREDITS} 积分，当前余额 ${currentCredits}`,
        },
        { status: 400 }
      );
    }

    // 乐观锁扣费（带重试）
    let deductSuccess = false;
    let deductAttempts = 0;
    let deductedFromCredits = currentCredits;
    const maxAttempts = 3;

    while (!deductSuccess && deductAttempts < maxAttempts) {
      deductAttempts++;

      const { data: latestProfile } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", user.id)
        .single();

      const latestCredits =
        (latestProfile as unknown as { credits: number })?.credits || 0;

      if (latestCredits < BOARD_GENERATE_CREDITS) {
        return NextResponse.json(
          {
            success: false,
            error: `积分不足！需要 ${BOARD_GENERATE_CREDITS} 积分，当前余额 ${latestCredits}`,
          },
          { status: 400 }
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deductError } = await (supabase as any)
        .from("profiles")
        .update({ credits: latestCredits - BOARD_GENERATE_CREDITS })
        .eq("id", user.id)
        .eq("credits", latestCredits); // 乐观锁

      if (!deductError) {
        deductedFromCredits = latestCredits;
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
    const boardPrompt = CHARACTER_BOARD_TEMPLATE.replace("{{CHARACTER_CONCEPT}}", englishPrompt);

    console.log("[Character Generate] Generating character board via GPTImage2:", {
      userId: user.id,
      cost: BOARD_GENERATE_CREDITS,
      before: deductedFromCredits,
      after: deductedFromCredits - BOARD_GENERATE_CREDITS,
      promptLength: boardPrompt.length,
      promptPreview: englishPrompt.substring(0, 80),
      hasSourceImage: !!sourceImageUrl,
    });

    const boardResult = await generateGptImage2({
      prompt: boardPrompt,
      sourceImageUrls: sourceImageUrl ? [sourceImageUrl] : undefined,
      size: BOARD_IMAGE_SIZE,
      aspectRatio: "16:9",
      quality: "high",
      outputFormat: "jpeg",
      outputCompression: 92,
      purpose: "character-reference",
      userId: user.id,
      allowSizeFallback: false,
      maxPollMs: 360_000,
    });

    if (!boardResult.success || !boardResult.imageUrl) {
      console.error("[Character Generate] Character board failed, refunding", BOARD_GENERATE_CREDITS);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: latestProfile } = await (supabase as any)
        .from("profiles")
        .select("credits")
        .eq("id", user.id)
        .single();

      const latestCredits = (latestProfile as { credits?: number } | null)?.credits;
      if (typeof latestCredits === "number") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("profiles")
          .update({ credits: latestCredits + BOARD_GENERATE_CREDITS })
          .eq("id", user.id);
      }

      return NextResponse.json(
        {
          success: false,
          error: `角色设定板生成失败，积分已退还。${boardResult.error || ""}`,
        },
        { status: 500 }
      );
    }

    const usedSize = boardResult.usedSize || BOARD_IMAGE_SIZE;
    const cropMeta = buildBoardCropMeta(usedSize);
    const avatarUrl = await cropAndPersistAvatar({
      boardUrl: boardResult.imageUrl,
      cropMeta,
      userId: user.id,
    });

    console.log("[Character Generate] Character board ready (OSS):", boardResult.imageUrl.substring(0, 80));

    return NextResponse.json({
      success: true,
      characterBoardUrl: boardResult.imageUrl,
      avatarUrl,
      referenceImageUrl: boardResult.imageUrl,
      referenceSheetUrl: boardResult.imageUrl,
      heroImageUrl: avatarUrl,
      refPrompt: englishPrompt,
      boardPrompt,
      cropMeta,
      usedSize,
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
// GET — 查询历史生成任务状态
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

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    const result = await queryNanoBananaResult(taskId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "查询失败" },
        { status: 500 }
      );
    }

    // 注意：新流程完整设定板已改为 GPTImage2 同步/服务端轮询生成，不再经过此 GET 轮询
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
