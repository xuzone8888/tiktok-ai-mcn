import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getVideoModelCreditCost, isVideoModelId } from "@/lib/video-models/catalog";
import { mergeCharacterReferenceImages } from "@/lib/video-models/character-reference";
import { checkVideoCredits, deductVideoCredits, refundVideoCreditsDirect } from "@/lib/video-models/credits";
import { getRegisteredVideoModel } from "@/lib/video-models/registry";
import type { VideoAspectRatio, VideoModelId, VideoQuality } from "@/lib/video-models/types";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

interface SubmitRequestBody {
  modelType?: string;
  prompt?: string;
  aiVideoPrompt?: string;
  aspectRatio?: VideoAspectRatio;
  imageUrls?: string[];
  referenceImageUrls?: string[];
  mainGridImageUrl?: string;
  characterRefUrl?: string;
  characterReferenceImages?: string[];
  characterId?: string;
  characterName?: string;
  characterAsset?: unknown;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  clientTaskId?: string;
  taskId?: string;
  groupName?: string;
  userId?: string;
  durationSeconds?: number;
  quality?: VideoQuality;
  mode?: "image_to_video" | "prompt_to_video";
  /** Studio 批次 ID(UUID,落 generations.batch_id;非法格式忽略) */
  batchId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeBatchId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value.trim()) ? value.trim() : null;
}

function normalizeModelType(raw: string | undefined, quality?: VideoQuality): {
  modelType: VideoModelId | null;
  quality?: VideoQuality;
} {
  if (!raw) return { modelType: null, quality };
  if (raw === "veo3-fast" || raw === "veo3-std" || raw === "veo3-4k") {
    return { modelType: "veo", quality: raw === "veo3-4k" ? "hd" : quality };
  }
  if (raw === "seedance-pro") {
    return { modelType: "seedance", quality: "hd" };
  }
  if (isVideoModelId(raw)) return { modelType: raw, quality };
  return { modelType: null, quality };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function sanitizeCharacterAsset(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;

  return {
    id: record.id,
    name: record.name,
    description: typeof record.description === "string" ? record.description : null,
    avatar_url: typeof record.avatar_url === "string" ? record.avatar_url : null,
    reference_sheet_url: typeof record.reference_sheet_url === "string" ? record.reference_sheet_url : null,
    reference_images: normalizeStringArray(record.reference_images),
    preview_video_url: typeof record.preview_video_url === "string" ? record.preview_video_url : null,
    category: typeof record.category === "string" ? record.category : null,
    tags: normalizeStringArray(record.tags),
    source: record.source === "user_created" ? "user_created" : "official",
    ownership: typeof record.ownership === "string" ? record.ownership : null,
    publish_price: typeof record.publish_price === "number" ? record.publish_price : null,
    reference_status: typeof record.reference_status === "string" ? record.reference_status : null,
  };
}

function getCharacterReferenceImages(
  explicitReferenceImages: string[],
  characterAsset: Record<string, unknown> | null
): string[] {
  if (explicitReferenceImages.length > 0) return explicitReferenceImages;
  if (!characterAsset) return [];

  return normalizeStringArray([
    characterAsset.reference_sheet_url,
    ...normalizeStringArray(characterAsset.reference_images),
    characterAsset.avatar_url,
  ]);
}

function normalizeImageUrls(
  body: SubmitRequestBody,
  modelType: VideoModelId,
  characterReferenceImages: string[]
): string[] {
  const uploadedUrls = [
    ...characterReferenceImages.slice(1),
    ...normalizeStringArray(body.imageUrls),
    ...normalizeStringArray(body.referenceImageUrls),
  ];

  if (modelType === "veo" && body.firstFrameUrl) {
    uploadedUrls.unshift(body.firstFrameUrl);
    if (body.lastFrameUrl) uploadedUrls.push(body.lastFrameUrl);
  }

  if (body.mainGridImageUrl) uploadedUrls.push(body.mainGridImageUrl);

  return mergeCharacterReferenceImages(modelType, body.characterRefUrl || characterReferenceImages[0], uploadedUrls);
}

function getMissingSchemaColumn(error: unknown): string | null {
  const message = typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message
    : "";

  return (
    message.match(/Could not find the '([^']+)' column/)?.[1] ||
    message.match(/column generations\.([a-zA-Z0-9_]+) does not exist/)?.[1] ||
    null
  );
}

function summarizeError(error: unknown): { message?: string; code?: string } {
  return error && typeof error === "object"
    ? {
        message: typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : undefined,
        code: typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : undefined,
      }
    : { message: String(error) };
}

async function insertGenerationWithSchemaFallback(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Record<string, unknown>
) {
  let candidate = { ...payload };
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { error } = await supabase
      .from("generations")
      .insert(candidate as any);

    if (!error) return { error: null };

    lastError = error;
    const missingColumn = getMissingSchemaColumn(error);
    if (missingColumn && Object.prototype.hasOwnProperty.call(candidate, missingColumn)) {
      const { [missingColumn]: _removed, ...nextCandidate } = candidate;
      candidate = nextCandidate;
      continue;
    }

    if (
      error.code === "23514" &&
      error.message?.includes("valid_source") &&
      typeof candidate.source === "string"
    ) {
      candidate = {
        ...candidate,
        source: String(candidate.source).includes("prompt") ? "batch_video_prompt" : "batch_video",
      };
      continue;
    }

    break;
  }

  return { error: lastError };
}

export async function POST(request: NextRequest) {
  let upstreamTaskId: string | undefined;
  let resolvedModelType: VideoModelId | undefined;

  try {
    const body = (await request.json()) as SubmitRequestBody;
    const authSupabase = await createClient();
    const { data: { user } } = await authSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "用户未登录" },
        { status: 401 }
      );
    }

    if (body.userId && body.userId !== user.id) {
      return NextResponse.json(
        { success: false, error: "用户身份不匹配" },
        { status: 403 }
      );
    }

    const normalized = normalizeModelType(body.modelType, body.quality);
    const modelType = normalized.modelType;
    resolvedModelType = modelType || undefined;

    if (!modelType) {
      return NextResponse.json(
        { success: false, error: `无效的视频模型: ${body.modelType || ""}` },
        { status: 400 }
      );
    }

    const model = getRegisteredVideoModel(modelType);
    const prompt = (body.prompt || body.aiVideoPrompt || "").trim();
    const aspectRatio = body.aspectRatio || "9:16";
    const clientTaskId = body.clientTaskId || body.taskId || `vbt-${Date.now()}`;
    const groupName = (body.groupName || "默认").trim() || "默认";
    const userId = user.id;
    const quality = normalized.quality || body.quality || "standard";
    const durationSeconds = body.durationSeconds || model.durationSeconds;
    const sanitizedCharacterAsset = sanitizeCharacterAsset(body.characterAsset);
    const characterReferenceImages = getCharacterReferenceImages(
      normalizeStringArray(body.characterReferenceImages),
      sanitizedCharacterAsset
    );

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "提示词不能为空" },
        { status: 400 }
      );
    }

    if (!model.supportedAspectRatios.includes(aspectRatio)) {
      return NextResponse.json(
        { success: false, error: `${model.label} 不支持比例 ${aspectRatio}` },
        { status: 400 }
      );
    }

    const imageUrls = normalizeImageUrls(body, modelType, characterReferenceImages);
    if (!model.supportsNoImage && imageUrls.length === 0) {
      return NextResponse.json(
        { success: false, error: `${model.label} 需要至少 1 张图片` },
        { status: 400 }
      );
    }
    if (imageUrls.length > model.maxImages) {
      return NextResponse.json(
        { success: false, error: `${model.label} 最多支持 ${model.maxImages} 张图片` },
        { status: 400 }
      );
    }

    const creditCost = getVideoModelCreditCost(modelType, durationSeconds, quality);
    const supabase = createAdminClient();
    const creditCheck = await checkVideoCredits(supabase, userId, creditCost);
    if (!creditCheck.ok) {
      return NextResponse.json(
        { success: false, error: creditCheck.error || "积分不足" },
        { status: 400 }
      );
    }

    const submitResult = await model.adapter.submit({
      modelType,
      prompt,
      aspectRatio,
      imageUrls,
      clientTaskId,
      groupName,
      userId,
      durationSeconds,
      quality,
      mode: body.mode || (imageUrls.length > 0 ? "image_to_video" : "prompt_to_video"),
    });
    upstreamTaskId = submitResult.taskId;

    await deductVideoCredits({
      supabase,
      userId,
      taskId: upstreamTaskId,
      modelType,
      creditCost,
      clientTaskId,
    });

    const now = new Date().toISOString();
    const generationSource = imageUrls.length > 0 ? "batch_video" : "batch_video_prompt";
    const batchId = normalizeBatchId(body.batchId);
    const generationInsert = {
      user_id: userId,
      task_id: upstreamTaskId,
      ...(batchId ? { batch_id: batchId } : {}),
      type: "video",
      generation_type: "video",
      source: generationSource,
      prompt,
      model: submitResult.upstreamModel,
      duration: durationSeconds,
      aspect_ratio: aspectRatio,
      quality,
      source_image_url: imageUrls[0] || null,
      status: "processing",
      progress: 0,
      result_url: null,
      video_url: null,
      output_url: null,
      credit_cost: creditCost,
      credits_used: creditCost,
      credits_refunded: 0,
      use_pro: modelType === "sora2-pro" || quality === "hd",
      group_name: groupName,
      metadata: {
        model_type: modelType,
        client_task_id: clientTaskId,
        reference_image_urls: imageUrls,
        reference_image_count: imageUrls.length,
        character_id: body.characterId || sanitizedCharacterAsset?.id || null,
        character_name: body.characterName || sanitizedCharacterAsset?.name || null,
        character_reference_images: characterReferenceImages,
        character_asset: sanitizedCharacterAsset,
        billing: {
          charged: true,
          refunded: false,
        },
        adapter: submitResult.metadata || {},
      },
      started_at: now,
      created_at: now,
    };

    const { error: insertError } = await insertGenerationWithSchemaFallback(
      supabase,
      generationInsert
    );

    if (insertError) {
      const insertErrorSummary = summarizeError(insertError);
      console.error("[Video Models Submit] generations insert failed:", {
        modelType,
        taskId: upstreamTaskId,
        message: insertErrorSummary.message,
        code: insertErrorSummary.code,
      });
      await refundVideoCreditsDirect({
        supabase,
        userId,
        taskId: upstreamTaskId,
        modelType,
        amount: creditCost,
        reason: "generations 写入失败，自动退款",
        metadata: {
          client_task_id: clientTaskId,
          reference_image_count: imageUrls.length,
        },
      });
      return NextResponse.json(
        { success: false, error: "任务记录写入失败，已尝试自动退款" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: upstreamTaskId,
        modelType,
        status: "processing",
        creditCost,
        upstreamModel: submitResult.upstreamModel,
      },
    });
  } catch (error) {
    console.error("[Video Models Submit] Error:", {
      modelType: resolvedModelType,
      hasUpstreamTask: !!upstreamTaskId,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "视频提交失败",
      },
      { status: 500 }
    );
  }
}
