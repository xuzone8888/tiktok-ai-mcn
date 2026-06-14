/**
 * 图片生成 API - GPT Image 2 / 新图片模型
 * 
 * POST /api/generate/image - 提交图片生成任务
 * GET /api/generate/image?taskId=xxx&model=xxx - 查询任务状态
 */

import { NextResponse } from "next/server";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_RESOLUTION,
  IMAGE_MODEL_CONFIG,
  isImageResolution,
  type ImageModel,
  type ImageResolution,
} from "@/types/generation";
import { getNewImageCost } from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { getImageQueueMetadata } from "@/lib/image-prompt-complexity";
import { validateImageReferenceUrls } from "@/lib/image-reference-url";
import {
  createCharacterAssetSnapshotFromSelection,
  getCharacterAssetReferenceUrls,
  normalizeCharacterAssetImages,
  normalizeCharacterTags,
  type CharacterAssetSnapshot,
} from "@/lib/character-assets";

// 增加请求体大小限制以支持 base64 图片 (50MB)
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const VALID_IMAGE_MODES = new Set(["generate", "upscale", "nine_grid"]);
const OPENAI_IMAGE_MAX_ATTEMPTS = 6;

function sanitizeCharacterAsset(value: unknown): CharacterAssetSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;

  return createCharacterAssetSnapshotFromSelection({
    id: record.id,
    name: record.name,
    description: typeof record.description === "string" ? record.description : null,
    avatar_url: typeof record.avatar_url === "string" ? record.avatar_url : null,
    reference_sheet_url: typeof record.reference_sheet_url === "string" ? record.reference_sheet_url : null,
    reference_images: normalizeCharacterAssetImages(record.reference_images),
    preview_video_url: typeof record.preview_video_url === "string" ? record.preview_video_url : null,
    category: typeof record.category === "string" ? record.category : "现代都市",
    tags: normalizeCharacterTags(record.tags),
    source: record.source === "user_created" ? "user_created" : "official",
    ownership: record.ownership === "owned" || record.ownership === "community" || record.ownership === "official" || record.ownership === "licensed"
      ? record.ownership
      : "licensed",
    publish_price: typeof record.publish_price === "number" ? record.publish_price : 100,
    reference_status: typeof record.reference_status === "string" ? record.reference_status : "none",
    trigger_word: typeof record.trigger_word === "string" ? record.trigger_word : null,
    forge_type: typeof record.forge_type === "string" ? record.forge_type : null,
  });
}

function parseImageResolution(value: unknown): ImageResolution | null {
  const normalized = typeof value === "string" ? value.toLowerCase() : value;
  return isImageResolution(normalized) ? normalized : null;
}

function getOpenAIEditPrompt(mode: string, prompt: string | undefined, resolution: string): string {
  const userPrompt = prompt?.trim();
  if (userPrompt) return userPrompt;

  if (mode === "upscale") {
    return `Enhance this image using the reference image. Preserve the original subject, composition, colors, and identity. Improve sharpness, texture detail, lighting balance, and overall clarity for a ${resolution.toUpperCase()} quality output. Do not add text, watermark, or extra objects.`;
  }

  return "Using the reference image, create a clean 3x3 nine-grid multi-angle product showcase. Preserve the exact same product identity, colors, shape, materials, and details. Show varied useful angles and close-up detail views on a clean background. Do not add text or watermark.";
}

interface ImageCreditChargeResult {
  success: boolean;
  amount: number;
  balanceBefore?: number;
  balanceAfter?: number;
  error?: string;
  status?: number;
  manualReviewRequired?: boolean;
  transactionMissing?: boolean;
  balanceMaybeDeducted?: boolean;
  uncertainAmount?: number;
}

interface ImageCreditRefundResult {
  success: boolean;
  balanceBefore?: number;
  balanceAfter?: number;
  error?: string;
}

async function insertImageCreditTransaction(
  adminClient: ReturnType<typeof createAdminClient>,
  payload: {
    user_id: string;
    amount: number;
    type: "usage" | "consume" | "refund";
    description: string;
    reference_type: string;
    reference_id: string;
    balance_before: number;
    balance_after: number;
  }
) {
  const candidateTypes = payload.type === "consume" || payload.type === "usage"
    ? ["usage", "consume"]
    : ["refund"];
  let lastError: unknown;

  for (const type of candidateTypes) {
    const { error } = await adminClient.from("credit_transactions").insert({
      ...payload,
      type,
    } as any);

    if (!error) return null;
    lastError = error;
  }

  return lastError;
}

async function rollbackImageCreditCharge(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  balanceBefore: number,
  balanceAfter: number
): Promise<boolean> {
  const { data: rollbackProfile, error: rollbackError } = await adminClient
    .from("profiles")
    .update({ credits: balanceBefore })
    .eq("id", userId)
    .eq("credits", balanceAfter)
    .select("credits")
    .single();

  if (rollbackError || !rollbackProfile) {
    console.error("[Generate Image] Failed to rollback credit charge:", rollbackError);
    return false;
  }

  return true;
}

async function chargeImageCreditsBeforeGeneration(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  taskId: string,
  generationId: string,
  creditCost: number
): Promise<ImageCreditChargeResult> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return { success: false, amount: creditCost, error: "User not found", status: 404 };
    }

    const balanceBefore = (profile as { credits: number }).credits;
    if (balanceBefore < creditCost) {
      return {
        success: false,
        amount: creditCost,
        balanceBefore,
        error: `积分不足！需要 ${creditCost} 积分，当前余额 ${balanceBefore}`,
        status: 400,
      };
    }

    const balanceAfter = balanceBefore - creditCost;
    const { data: updatedProfile, error: deductError } = await adminClient
      .from("profiles")
      .update({ credits: balanceAfter })
      .eq("id", userId)
      .eq("credits", balanceBefore)
      .select("credits")
      .single();

    if (deductError || !updatedProfile) {
      if (attempt < maxAttempts) {
        console.log(`[Generate Image] Credits deduct retry ${attempt}/${maxAttempts}`);
        await new Promise(r => setTimeout(r, 100 * attempt));
        continue;
      }

      console.error("[Generate Image] Failed to deduct credits:", deductError);
      return { success: false, amount: creditCost, error: "扣费失败，请重试", status: 409 };
    }

    const transactionError = await insertImageCreditTransaction(adminClient, {
      user_id: userId,
      amount: -creditCost,
      type: "usage",
      description: `图片生成 - GPT Image 2 (${taskId})`,
      reference_type: "quick_gen_image",
      reference_id: generationId,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    });

    if (transactionError) {
      console.error("[Generate Image] Failed to record credit transaction:", transactionError);
      const rollbackSucceeded = await rollbackImageCreditCharge(adminClient, userId, balanceBefore, balanceAfter);
      return {
        success: false,
        amount: creditCost,
        balanceBefore,
        balanceAfter,
        error: rollbackSucceeded
          ? "扣费流水记录失败，请重试"
          : "扣费流水记录失败，余额状态需人工核查",
        status: 500,
        manualReviewRequired: !rollbackSucceeded,
        transactionMissing: true,
        balanceMaybeDeducted: !rollbackSucceeded,
        uncertainAmount: !rollbackSucceeded ? creditCost : 0,
      };
    }

    return { success: true, amount: creditCost, balanceBefore, balanceAfter };
  }

  return { success: false, amount: creditCost, error: "扣费失败，请重试", status: 409 };
}

async function refundImageCreditsAfterGenerationFailure(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  taskId: string,
  generationId: string,
  creditCost: number
): Promise<ImageCreditRefundResult> {
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    console.error("[Generate Image] Failed to load profile for refund:", profileError);
    return { success: false, error: "退款失败：用户不存在" };
  }

  const balanceBefore = (profile as { credits: number }).credits;
  const balanceAfter = balanceBefore + creditCost;
  const { data: updatedProfile, error: refundError } = await adminClient
    .from("profiles")
    .update({ credits: balanceAfter })
    .eq("id", userId)
    .eq("credits", balanceBefore)
    .select("credits")
    .single();

  if (refundError || !updatedProfile) {
    console.error("[Generate Image] Failed to refund credits:", refundError);
    return { success: false, balanceBefore, balanceAfter, error: "退款失败，请联系客服处理" };
  }

  const transactionError = await insertImageCreditTransaction(adminClient, {
    user_id: userId,
    amount: creditCost,
    type: "refund",
    description: `图片生成失败自动退款 - GPT Image 2 (${taskId})`,
    reference_type: "quick_gen_image",
    reference_id: generationId,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
  });

  if (transactionError) {
    console.error("[Generate Image] Failed to record refund transaction:", transactionError);
    return { success: false, balanceBefore, balanceAfter, error: "退款流水记录失败，请联系客服处理" };
  }

  return { success: true, balanceBefore, balanceAfter };
}

function getImageTaskMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }

  return {};
}

function getImageTaskAttempts(metadata: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(metadata.attempts)
    ? (metadata.attempts as Array<Record<string, unknown>>)
    : [];
}

function getImageTaskMaxAttempts(metadata: Record<string, unknown>): number {
  const maxAttempts = Number(metadata.maxAttempts || OPENAI_IMAGE_MAX_ATTEMPTS);
  return Number.isFinite(maxAttempts) && maxAttempts > 0
    ? Math.min(maxAttempts, OPENAI_IMAGE_MAX_ATTEMPTS)
    : OPENAI_IMAGE_MAX_ATTEMPTS;
}

function isOpenAIImageGenerationRecord(record: Record<string, unknown>): boolean {
  const metadata = getImageTaskMetadata(record.metadata);
  return record.model === DEFAULT_IMAGE_MODEL ||
    metadata.provider === "openai" ||
    metadata.provider === "video_platform_image";
}

function mapOpenAIImageClientStatus(status: string): "processing" | "completed" | "failed" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "processing";
}

// ============================================================================
// POST - 提交图片生成任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const authClient = await createServerClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    const authUserId = user.id;
    const body = await request.json();
    const hasLegacyModelField = Object.prototype.hasOwnProperty.call(body, "model");

    const {
      mode,           // "generate" | "upscale" | "nine_grid"
      prompt,
      sourceImageUrl,
      sourceImageUrls,          // 多张参考图 URL 数组
      model: requestedLegacyModel,
      imageModel: requestedImageModel,
      aspectRatio = "auto",
      resolution: requestedResolution,
      qualityLevel,
      source = "quick_gen",         // "quick_gen" | "batch_image"
      requestId,                    // 前端生成的 ID
      characterId,
      characterName,
      characterReferenceImages,
      characterAsset,
    } = body;
    const sanitizedCharacterAsset = sanitizeCharacterAsset(characterAsset);
    const normalizedCharacterReferenceImages = normalizeCharacterAssetImages(characterReferenceImages);
    const characterAssetReferenceUrls = sanitizedCharacterAsset
      ? getCharacterAssetReferenceUrls(sanitizedCharacterAsset)
      : [];
    const characterReferenceUrls = normalizedCharacterReferenceImages.length
      ? normalizedCharacterReferenceImages
      : characterAssetReferenceUrls;

    // 合并多图来源：优先 sourceImageUrls，兼容旧的单张 sourceImageUrl
    const normalizedSourceImageUrls = Array.isArray(sourceImageUrls)
      ? sourceImageUrls
        .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
        .map(url => url.trim())
      : [];
    const normalizedSourceImageUrl = typeof sourceImageUrl === "string" && sourceImageUrl.trim()
      ? sourceImageUrl.trim()
      : null;
    const allSourceImageUrls: string[] = [
      ...characterReferenceUrls,
      ...normalizedSourceImageUrls,
      normalizedSourceImageUrl,
    ].filter((url, index, urls): url is string =>
      typeof url === "string" &&
      url.length > 0 &&
      urls.indexOf(url) === index
    );
    // 第一张图用于 DB 记录和 Pro 模式
    const primarySourceImageUrl = allSourceImageUrls[0] || null;
    const modeValue = mode || "generate";
    const requestedImageModelValue = typeof requestedImageModel === "string" ? requestedImageModel : undefined;
    const imageResolution = parseImageResolution(
      qualityLevel
        ?? requestedResolution
        ?? DEFAULT_IMAGE_RESOLUTION
    );
    const imageModel: ImageModel = DEFAULT_IMAGE_MODEL;
    const imageConfig = IMAGE_MODEL_CONFIG[imageModel];
    const useSingleReferenceFor4kNineGrid =
      modeValue === "nine_grid" &&
      imageResolution === "4k" &&
      allSourceImageUrls.length > 1;
    const submittedSourceImageUrls = useSingleReferenceFor4kNineGrid
      ? allSourceImageUrls.slice(0, 1)
      : allSourceImageUrls;
    const referenceSubmissionInfo = {
      referenceCountReceived: allSourceImageUrls.length,
      referenceCountUsed: submittedSourceImageUrls.length,
      reason: useSingleReferenceFor4kNineGrid
        ? "4k_nine_grid_single_reference_stability"
        : null,
    };

    console.log("[Generate Image] Request received:", {
      mode: modeValue,
      legacyModel: requestedLegacyModel,
      imageModel,
      requestedImageModel: requestedImageModelValue,
      resolution: imageResolution,
      source,
      hasPrompt: !!prompt,
      promptLength: prompt?.length || 0,
      hasSourceImage: allSourceImageUrls.length > 0,
      sourceImageCount: allSourceImageUrls.length,
      hasCharacterAsset: !!sanitizedCharacterAsset || !!characterId,
      referenceCountUsed: submittedSourceImageUrls.length,
      referenceReductionReason: referenceSubmissionInfo.reason,
    });

    // ============================================
    // 参数校验：必须先于扣费
    // ============================================
    if (!VALID_IMAGE_MODES.has(modeValue)) {
      return NextResponse.json(
        { success: false, error: "无效的图片生成模式" },
        { status: 400 }
      );
    }

    if (hasLegacyModelField) {
      return NextResponse.json(
        { success: false, error: "旧图片模型已停用，请使用 imageModel/gpt-image-2" },
        { status: 400 }
      );
    }

    if (!imageResolution) {
      return NextResponse.json(
        { success: false, error: "无效的图片画质档位，请使用 1k / 2k / 4k" },
        { status: 400 }
      );
    }

    if (
      requestedImageModelValue &&
      requestedImageModelValue !== DEFAULT_IMAGE_MODEL
    ) {
      return NextResponse.json(
        { success: false, error: "当前图片生成模型固定为 gpt-image-2，请使用 resolution/qualityLevel 选择 1K/2K/4K" },
        { status: 400 }
      );
    }

    if ((modeValue === "upscale" || modeValue === "nine_grid") && !primarySourceImageUrl) {
      return NextResponse.json(
        { success: false, error: modeValue === "upscale" ? "Source image URL is required for upscale" : "Source image URL is required for nine grid" },
        { status: 400 }
      );
    }

    if (modeValue === "generate" && allSourceImageUrls.length === 0 && (!prompt || prompt.trim().length < 2)) {
      return NextResponse.json(
        { success: false, error: "请输入至少 2 个字符的提示词" },
        { status: 400 }
      );
    }

    try {
      validateImageReferenceUrls(allSourceImageUrls);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "参考图 URL 不允许访问",
        },
        { status: 400 }
      );
    }

    // ============================================
    // 计算积分消耗
    // ============================================
    const creditCost = getNewImageCost(imageModel, imageResolution);
    const taskId = requestId || (modeValue === "upscale" || modeValue === "nine_grid"
      ? `openai-${modeValue}-${Date.now()}`
      : `openai-${Date.now()}`);
    const generationId = crypto.randomUUID();

    // ============================================
    // 创建本地任务占位：consume 成功前保持 pending，不进入 worker
    // ============================================
    const supabase = createAdminClient();
    const config = imageConfig!;
    const promptForGeneration = modeValue === "upscale" || modeValue === "nine_grid"
      ? getOpenAIEditPrompt(modeValue, prompt, imageResolution)
      : (prompt || "");
    const sourceImageUrlsForGeneration = modeValue === "upscale" || modeValue === "nine_grid"
      ? submittedSourceImageUrls
      : allSourceImageUrls;
    const createdAt = new Date().toISOString();
    const queueMetadata = getImageQueueMetadata(promptForGeneration, sourceImageUrlsForGeneration, imageResolution);
    const baseTaskMetadata = {
      provider: "video_platform_image",
      taskEngine: "video_platform_image_worker",
      mode: modeValue,
      imageModel,
      apiModel: config.apiModel,
      source,
      prompt: promptForGeneration,
      promptLength: promptForGeneration.length,
      aspectRatio,
      resolution: imageResolution,
      sourceImageUrls: sourceImageUrlsForGeneration,
      allSourceImageUrls,
      primarySourceImageUrl,
      referenceCountReceived: referenceSubmissionInfo.referenceCountReceived,
      referenceCountUsed: referenceSubmissionInfo.referenceCountUsed,
      referenceReductionReason: referenceSubmissionInfo.reason,
      characterId: typeof characterId === "string" ? characterId : sanitizedCharacterAsset?.id || null,
      characterName: typeof characterName === "string" ? characterName : sanitizedCharacterAsset?.name || null,
      characterReferenceImages: characterReferenceUrls,
      characterAsset: sanitizedCharacterAsset,
      attempts: [],
      maxAttempts: OPENAI_IMAGE_MAX_ATTEMPTS,
      nextAttemptAt: createdAt,
      complexityProfile: queueMetadata.complexityProfile,
      queueLane: queueMetadata.queueLane,
      maxWaitMs: queueMetadata.maxWaitMs,
      generationId,
      charge: {
        status: "pending",
        amount: creditCost,
      },
    };

    const { data: insertedGeneration, error: insertError } = await supabase
      .from("generations")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        id: generationId,
        user_id: authUserId,
        task_id: taskId,
        type: "image",
        generation_type: "image",
        source,
        prompt: promptForGeneration || null,
        model: imageModel,
        aspect_ratio: aspectRatio,
        quality: imageResolution,
        resolution: imageResolution,
        source_image_url: primarySourceImageUrl || null,
        status: "pending",
        result_url: null,
        image_url: null,
        credit_cost: creditCost,
        created_at: createdAt,
        metadata: baseTaskMetadata as any,
      } as any)
      .select("id, task_id, status")
      .single();

    if (insertError || !insertedGeneration) {
      console.error("[Generate Image] Failed to create local task before charge:", insertError);
      return NextResponse.json(
        { success: false, error: "任务创建失败，请重试" },
        { status: 500 }
      );
    }

    // ============================================
    // 扣除积分并记录流水
    // ============================================
    const chargeResult = await chargeImageCreditsBeforeGeneration(
      supabase,
      authUserId,
      taskId,
      generationId,
      creditCost
    );

    if (!chargeResult.success) {
      const chargeManualReviewMetadata = chargeResult.manualReviewRequired
        ? {
            charge_manual_review_required: true,
            charge_transaction_missing: !!chargeResult.transactionMissing,
            charge_balance_maybe_deducted: !!chargeResult.balanceMaybeDeducted,
            charge_uncertain_amount: chargeResult.uncertainAmount || creditCost,
            charge_manual_review_at: new Date().toISOString(),
            last_charge_error: chargeResult.error || "扣费流水写入失败且余额回滚失败，需人工对账",
          }
        : {};

      await supabase
        .from("generations")
        .update({
          status: "failed",
          metadata: {
            ...baseTaskMetadata,
            ...chargeManualReviewMetadata,
            charge: {
              status: "failed",
              amount: creditCost,
              error: chargeResult.error || "扣费失败",
              manualReviewRequired: !!chargeResult.manualReviewRequired,
            },
          } as any,
        })
        .eq("id", generationId)
        .eq("status", "pending");

      return NextResponse.json(
        { success: false, error: chargeResult.error || "扣费失败，请重试" },
        { status: chargeResult.status || 500 }
      );
    }

    console.log("[Generate Image] Credits deducted:", {
      userId: authUserId,
      mode: modeValue,
      cost: creditCost,
      before: chargeResult.balanceBefore,
      after: chargeResult.balanceAfter,
    });

    // ============================================
    // 激活本地任务：POST 不再同步等待上游完成
    // ============================================
    const taskMetadata = {
      ...baseTaskMetadata,
      charge: {
        status: "charged",
        amount: creditCost,
        balanceBefore: chargeResult.balanceBefore,
        balanceAfter: chargeResult.balanceAfter,
      },
    };

    const { data: activatedGeneration, error: activateError } = await supabase
      .from("generations")
      .update({
        status: "processing",
        metadata: taskMetadata as any,
      })
      .eq("id", generationId)
      .eq("status", "pending")
      .select("id, task_id, status")
      .single();

    if (activateError || !activatedGeneration) {
      console.error("[Generate Image] Failed to activate processing task:", activateError);
      const refundResult = await refundImageCreditsAfterGenerationFailure(
        supabase,
        authUserId,
        taskId,
        generationId,
        creditCost
      );
      await supabase
        .from("generations")
        .update({
          status: "failed",
          metadata: {
            ...taskMetadata,
            activationError: activateError?.message || "任务入队失败",
            refundAfterActivationFailure: refundResult,
          } as any,
        })
        .eq("id", generationId);

      return NextResponse.json(
        {
          success: false,
          error: refundResult.success
            ? "任务创建失败，积分已退还"
            : "任务创建失败，退款失败请联系客服处理",
        },
        { status: 500 }
      );
    }

    console.log("[Generate Image] Processing task created:", {
      taskId,
      mode: modeValue,
      imageModel,
      resolution: imageResolution,
      maxAttempts: OPENAI_IMAGE_MAX_ATTEMPTS,
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId,
        status: "processing",
        imageUrl: null,
        model: imageModel,
        resolution: imageResolution,
        attempts: 0,
        maxAttempts: OPENAI_IMAGE_MAX_ATTEMPTS,
        nextAttemptAt: createdAt,
        complexityProfile: queueMetadata.complexityProfile,
        queueLane: queueMetadata.queueLane,
        maxWaitMs: queueMetadata.maxWaitMs,
        referenceCountReceived: referenceSubmissionInfo.referenceCountReceived,
        referenceCountUsed: referenceSubmissionInfo.referenceCountUsed,
        referenceReductionReason: referenceSubmissionInfo.reason,
        estimatedTime: config.estimatedTime,
      },
    });
  } catch (error) {
    console.error("[Generate Image] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET - 查询任务状态
// ============================================================================

export async function GET(request: Request) {
  try {
    const authClient = await createServerClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    const authUserId = user.id;
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    console.log("[Generate Image] Querying task:", taskId, { userId: authUserId });
    const supabase = createAdminClient();

    // ================================================================
    // GPT Image 2 本地任务查询：GET 只读，不推进 attempt、不调用上游、不退款
    // ================================================================
    const { data: generationRecord, error: generationError } = await supabase
      .from("generations")
      .select("*")
      .eq("task_id", taskId)
      .eq("user_id", authUserId)
      .maybeSingle();

    if (generationError || !generationRecord) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权访问" },
        { status: 404 }
      );
    }

    const record = generationRecord as Record<string, unknown>;
    const metadata = getImageTaskMetadata(record.metadata);
    const attempts = getImageTaskAttempts(metadata);
    const lastAttempt = attempts[attempts.length - 1] || {};
    const clientStatus = mapOpenAIImageClientStatus(String(record.status || "processing"));
    const progress = clientStatus === "completed"
      ? 100
      : clientStatus === "failed"
        ? 100
        : Math.min(95, 20 + attempts.length * 12);

    if (isOpenAIImageGenerationRecord(record)) {
      const attempts = getImageTaskAttempts(metadata);

      return NextResponse.json({
        success: true,
        data: {
          taskId: record.task_id,
          status: clientStatus,
          progress,
          imageUrl: record.image_url || record.result_url || null,
          errorMessage: record.error_message || null,
          createdAt: record.created_at,
          updatedAt: record.completed_at,
          model: record.model || DEFAULT_IMAGE_MODEL,
          resolution: metadata.resolution || record.quality || DEFAULT_IMAGE_RESOLUTION,
          attempts: attempts.length,
          maxAttempts: getImageTaskMaxAttempts(metadata),
          nextAttemptAt: metadata.nextAttemptAt || null,
          complexityProfile: metadata.complexityProfile || null,
          queueLane: metadata.queueLane || "standard",
          maxWaitMs: metadata.maxWaitMs || null,
          requestedSize: lastAttempt.requestedSize,
          upstreamSize: lastAttempt.upstreamSize,
          upstreamQuality: lastAttempt.upstreamQuality,
          outputFormat: lastAttempt.outputFormat,
          fallbackMode: lastAttempt.fallbackMode || "none",
          fallbackAttempt: lastAttempt.fallbackAttempt || 0,
          upstreamCallCount: lastAttempt.upstreamCallCount || 0,
          referenceCountReceived: metadata.referenceCountReceived,
          referenceCountUsed: metadata.referenceCountUsed,
          referenceReductionReason: metadata.referenceReductionReason || null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: record.task_id || taskId,
        status: clientStatus,
        progress,
        imageUrl: record.image_url || record.result_url || null,
        errorMessage: record.error_message || null,
        createdAt: record.created_at,
        updatedAt: record.completed_at,
        attempts: attempts.length,
        maxAttempts: getImageTaskMaxAttempts(metadata),
        nextAttemptAt: metadata.nextAttemptAt || null,
      },
    });
  } catch (error) {
    console.error("[Generate Image] Query error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
