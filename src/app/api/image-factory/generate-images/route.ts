/**
 * POST /api/image-factory/generate-images
 * 
 * 为电商图片任务生成图片
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { getEcomImageCost } from "@/lib/credits";
import { applyTaskCreditDelta } from "@/lib/credits/atomic-task-credit";
import { submitOpenAIImage } from "@/lib/openai-image-api";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_RESOLUTION,
  IMAGE_MODEL_CONFIG,
  isImageResolution,
  type ImageModel,
} from "@/types/generation";
import type {
  EcomImageMode,
  ImageModelType,
  OutputItem,
  EcomAspectRatio,
  EcomResolution,
} from "@/types/ecom-image";
import { FIVE_PACK_TYPES } from "@/types/ecom-image";

// Vercel 函数配置
export const maxDuration = 180;

const ECOM_IMAGE_CONCURRENCY = 2;
const GENERATABLE_ECOM_STATUSES = new Set(["created", "generating_prompts", "failed"]);

function parseEcomResolution(value: unknown): EcomResolution | null {
  const normalized = typeof value === "string" ? value.toLowerCase() : value;
  return isImageResolution(normalized) ? normalized : null;
}

function getTaskMetadata(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function getEcomBillingAttempt(metadata: Record<string, unknown>, alreadyCharged: boolean): number {
  const stored = Number(metadata.billing_attempt || 0);
  const previous = Number.isSafeInteger(stored) && stored > 0 ? stored : 0;
  return alreadyCharged ? Math.max(1, previous) : previous + 1;
}

function getEcomPricingVersion(mode: EcomImageMode, billingAttempt: number): string {
  return `ecom-image-${mode}-attempt-${billingAttempt}-v1`;
}

function getEcomRefundOperation(
  billingAttempt: number,
  stage: "charge-state" | "exception" | { failedCount: number; totalCount: number }
): string {
  return typeof stage === "string"
    ? `refund-a${billingAttempt}-${stage}`
    : `refund-a${billingAttempt}-f${stage.failedCount}-of-${stage.totalCount}`;
}

async function getRecordedEcomRefundAmount(
  adminClient: ReturnType<typeof createAdminClient>,
  taskId: string,
  pricingVersion: string,
  includeLegacy: boolean
): Promise<number> {
  const taskScopedResult = await (adminClient as any)
    .from("credit_transactions")
    .select("amount")
    .eq("task_id", taskId)
    .eq("entry_kind", "refund")
    .eq("pricing_version", pricingVersion);

  if (taskScopedResult.error) {
    console.error("[Generate Images] Failed to inspect task-scoped refunds:", taskScopedResult.error);
    return 0;
  }

  const taskScopedAmount = ((taskScopedResult.data || []) as Array<{ amount?: number }>)
    .reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
  if (!includeLegacy) return taskScopedAmount;

  const legacyResult = await adminClient
    .from("credit_transactions")
    .select("amount")
    .eq("reference_type", "ecom_image_task")
    .eq("reference_id", taskId)
    .eq("type", "refund");
  if (legacyResult.error) {
    console.error("[Generate Images] Failed to inspect legacy refunds:", legacyResult.error);
    return taskScopedAmount;
  }

  return taskScopedAmount + (legacyResult.data || [])
    .reduce((sum, row) => sum + Math.max(0, Number((row as { amount?: number }).amount || 0)), 0);
}

interface GenerateImagesRequest {
  task_id: string;
  prompts?: Record<string, string>; // 用户修改后的提示词（可选）
}

interface CreditChargeResult {
  success: boolean;
  chargedNow: boolean;
  amount: number;
  error?: string;
  status?: number;
}

export async function POST(request: NextRequest) {
  try {
    // 1. 验证用户身份
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    // 2. 解析请求参数
    const body: GenerateImagesRequest = await request.json();
    const { task_id, prompts: userPrompts } = body;

    if (!task_id) {
      return NextResponse.json(
        { success: false, error: "任务ID不能为空" },
        { status: 400 }
      );
    }

    // 3. 获取任务信息
    const adminClient = createAdminClient();
    const { data: task, error: taskError } = await adminClient
      .from("ecom_image_tasks")
      .select("*")
      .eq("id", task_id)
      .eq("user_id", user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权访问" },
        { status: 404 }
      );
    }

    // 4. 检查任务状态
    if (!GENERATABLE_ECOM_STATUSES.has(task.status)) {
      return NextResponse.json(
        { success: false, error: "任务状态不正确，无法生成图片" },
        { status: 400 }
      );
    }

    // 5. 获取提示词
    const taskPrompts = task.prompts as { original?: Record<string, string>; modified?: Record<string, string> } || {};
    const prompts = userPrompts || taskPrompts.modified || taskPrompts.original || {};

    // 6. 准备生成参数
    const mode = task.mode as EcomImageMode;
    const requestedModelType = task.model_type as ImageModelType;
    const resolution = parseEcomResolution(task.resolution ?? DEFAULT_IMAGE_RESOLUTION);
    const modelType = DEFAULT_IMAGE_MODEL as ImageModelType;
    const inputImages = (task.input_image_urls as string[]) || [];
    const ratio = task.ratio as EcomAspectRatio;
    const imageCount = mode === "ecom_five_pack" ? 5 : inputImages.length;
    const resolvedCreditsCost = resolution
      ? getEcomImageCost(mode, modelType, imageCount, resolution)
      : 0;

    if (!resolution) {
      const errorMessage = "无效的图片画质档位，请使用 1k / 2k / 4k";
      await adminClient
        .from("ecom_image_tasks")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", task_id)
        .eq("user_id", user.id)
        .eq("status", task.status);

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 400 }
      );
    }

    if (requestedModelType && requestedModelType !== DEFAULT_IMAGE_MODEL) {
      const errorMessage = "图片模型固定为 GPT Image 2，请通过 resolution 选择 1K/2K/4K";
      await adminClient
        .from("ecom_image_tasks")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", task_id)
        .eq("user_id", user.id)
        .eq("status", task.status);

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 400 }
      );
    }

    if (inputImages.length === 0) {
      return NextResponse.json(
        { success: false, error: "请先上传参考图" },
        { status: 400 }
      );
    }

    console.log("[Generate Images] Starting generation:", {
      taskId: task_id,
      mode,
      modelType,
      resolution,
      imageCount: inputImages.length,
      creditsCost: resolvedCreditsCost,
      promptCount: Object.keys(prompts).length,
    });

    const taskMetadata = getTaskMetadata(task.metadata);
    const storedBillingAttempt = getEcomBillingAttempt(taskMetadata, true);
    let alreadyCharged = Boolean(task.credits_charged);
    let recoveredFullRefund = false;
    if (alreadyCharged && resolvedCreditsCost > 0) {
      const recordedRefundAmount = await getRecordedEcomRefundAmount(
        adminClient,
        task_id,
        getEcomPricingVersion(mode, storedBillingAttempt),
        Number(taskMetadata.billing_attempt || 0) <= 1
      );
      recoveredFullRefund = recordedRefundAmount >= resolvedCreditsCost;
      alreadyCharged = !recoveredFullRefund;
    }
    const billingAttempt = getEcomBillingAttempt(taskMetadata, alreadyCharged);
    const { data: lockedTask, error: lockError } = await adminClient
      .from("ecom_image_tasks")
      .update({
        status: "generating_images",
        current_step: 3,
        credits_cost: resolvedCreditsCost,
        error_message: null,
        metadata: {
          ...taskMetadata,
          billing_attempt: billingAttempt,
          ...(recoveredFullRefund
            ? { billing_recovered_refund_attempt: storedBillingAttempt }
            : {}),
        },
      })
      .eq("id", task_id)
      .eq("user_id", user.id)
      .eq("status", task.status)
      .select("id, status")
      .single();

    if (lockError || !lockedTask) {
      return NextResponse.json(
        { success: false, error: "任务已开始生成，请勿重复提交" },
        { status: 409 }
      );
    }

    // 如果用户提供了修改后的提示词，仅生成锁持有者可以写入
    if (userPrompts && Object.keys(userPrompts).length > 0) {
      await adminClient
        .from("ecom_image_tasks")
        .update({
          prompts: {
            ...taskPrompts,
            modified: userPrompts,
          },
        })
        .eq("id", task_id)
        .eq("user_id", user.id)
        .eq("status", "generating_images");
    }

    const chargeResult = await chargeEcomCreditsBeforeGeneration(
      adminClient,
      user.id,
      task_id,
      mode,
      resolvedCreditsCost,
      alreadyCharged,
      billingAttempt
    );

    if (!chargeResult.success) {
      await adminClient
        .from("ecom_image_tasks")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: chargeResult.error || "扣费失败，请重试",
        })
        .eq("id", task_id)
        .eq("user_id", user.id)
        .eq("status", "generating_images");

      return NextResponse.json(
        { success: false, error: chargeResult.error || "扣费失败，请重试" },
        { status: chargeResult.status || 500 }
      );
    }

    // 8. 根据模式生成输出项。五图套装使用受控并发，避免串行卡住 60 秒窗口。
    let outputItems: OutputItem[];
    try {
      if (mode === "ecom_five_pack") {
        const fivePackTypes: Array<keyof typeof FIVE_PACK_TYPES> = ["main", "scene", "detail", "selling", "compare"];

        outputItems = await runWithConcurrency(fivePackTypes, ECOM_IMAGE_CONCURRENCY, async (type): Promise<OutputItem> => {
          const prompt = prompts[type] || `Generate a ${type} image for e-commerce`;
          const typeConfig = FIVE_PACK_TYPES[type];
          const result = await submitEcomImage({
            modelType,
            prompt,
            sourceImageUrl: inputImages[0], // 使用第一张图作为参考
            aspectRatio: ratio === "auto" ? "1:1" : ratio,
            resolution,
          });

          return {
            type,
            label: typeConfig.label,
            status: result.success ? result.status : "failed",
            task_id: result.taskId,
            url: result.imageUrl,
            error: result.error,
            input_image_url: inputImages[0],
          };
        });
      } else {
        outputItems = await runWithConcurrency(inputImages, ECOM_IMAGE_CONCURRENCY, async (inputImage, index): Promise<OutputItem> => {
          const promptKey = mode === "white_background" ? "white_bg" : Object.keys(prompts)[0] || "default";
          const prompt = prompts[promptKey] || getDefaultPrompt(mode);
          const result = await submitEcomImage({
            modelType,
            prompt,
            sourceImageUrl: inputImage,
            aspectRatio: ratio === "auto" ? undefined : ratio,
            resolution,
          });

          return {
            type: mode === "white_background" ? "white_bg" : mode,
            label: getModeLabel(mode, index + 1),
            status: result.success ? result.status : "failed",
            task_id: result.taskId,
            url: result.imageUrl,
            error: result.error,
            input_image_url: inputImage,
          };
        });
      }
    } catch (generationError) {
      console.error("[Generate Images] Generation threw:", generationError);
      if (chargeResult.chargedNow) {
        await refundEcomCreditsAfterGenerationFailure(
          adminClient,
          user.id,
          task_id,
          chargeResult.amount,
          `电商图片生成异常自动退款 (${task_id})`,
          getEcomRefundOperation(billingAttempt, "exception"),
          getEcomPricingVersion(mode, billingAttempt)
        );
      }

      await adminClient
        .from("ecom_image_tasks")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: generationError instanceof Error ? generationError.message : "图片生成失败",
        })
        .eq("id", task_id)
        .eq("user_id", user.id)
        .eq("status", "generating_images");

      return NextResponse.json(
        { success: false, error: chargeResult.chargedNow ? "图片生成失败，积分已退还" : "图片生成失败" },
        { status: 500 }
      );
    }

    const nanoTaskIds = outputItems
      .map(item => item.task_id)
      .filter((taskId): taskId is string => Boolean(taskId));
    const completedImageUrls = outputItems
      .map(item => item.url)
      .filter((url): url is string => Boolean(url));

    // 9. 更新任务输出项
    const successCount = outputItems.filter(item => item.status === "processing" || item.status === "completed").length;
    const failedCount = outputItems.filter(item => item.status === "failed").length;
    const processingCount = outputItems.filter(item => item.status === "processing").length;

    if (failedCount === outputItems.length && chargeResult.chargedNow) {
      await refundEcomCreditsAfterGenerationFailure(
        adminClient,
        user.id,
        task_id,
        chargeResult.amount,
        `电商图片生成失败自动退款 (${task_id})`,
        getEcomRefundOperation(billingAttempt, {
          failedCount,
          totalCount: outputItems.length,
        }),
        getEcomPricingVersion(mode, billingAttempt)
      );
    } else if (processingCount === 0 && failedCount > 0 && outputItems.length > 0 && chargeResult.chargedNow) {
      const partialRefundAmount = Math.round(chargeResult.amount * failedCount / outputItems.length);
      await refundEcomCreditsAfterGenerationFailure(
        adminClient,
        user.id,
        task_id,
        partialRefundAmount,
        `电商图片部分失败按比例退款 (${failedCount}/${outputItems.length}, ${task_id})`,
        getEcomRefundOperation(billingAttempt, {
          failedCount,
          totalCount: outputItems.length,
        }),
        getEcomPricingVersion(mode, billingAttempt),
        false
      );
    }

    const newStatus = failedCount === outputItems.length
      ? "failed"
      : processingCount > 0
        ? "generating_images"
        : failedCount > 0
          ? "partial_success"
          : "success";

    await adminClient
      .from("ecom_image_tasks")
      .update({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        output_items: outputItems as any,
        status: newStatus,
        completed_at: processingCount === 0 ? new Date().toISOString() : null,
        error_message: failedCount > 0
          ? `${failedCount}/${outputItems.length} 张图片生成失败`
          : null,
      })
      .eq("id", task_id)
      .eq("user_id", user.id)
      .eq("status", "generating_images");

    console.log("[Generate Images] Tasks submitted:", {
      taskId: task_id,
      successCount,
      failedCount,
      nanoTaskIds,
      completedImageUrls,
    });

    return NextResponse.json({
      success: true,
      nano_task_ids: nanoTaskIds,
      output_items: outputItems,
      message: `已提交 ${successCount} 个图片生成任务`,
    });

  } catch (error) {
    console.error("[Generate Images] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

async function chargeEcomCreditsBeforeGeneration(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  taskId: string,
  mode: EcomImageMode,
  creditCost: number,
  alreadyCharged: boolean,
  billingAttempt: number
): Promise<CreditChargeResult> {
  if (alreadyCharged || creditCost <= 0) {
    return { success: true, chargedNow: false, amount: creditCost };
  }

  try {
    await applyTaskCreditDelta({
      supabase: adminClient,
      userId,
      entryKind: "consume",
      amount: -creditCost,
      scope: "ecom-image",
      taskId,
      operation: `consume-a${billingAttempt}`,
      pricingVersion: getEcomPricingVersion(mode, billingAttempt),
      description: `电商图片工厂 - ${getModeDisplayName(mode)}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "扣费失败，请重试";
    console.error("[Generate Images] Failed to deduct credits:", error);
    const insufficient = /insufficient credits/i.test(message);
    return {
      success: false,
      chargedNow: false,
      amount: creditCost,
      error: insufficient ? `积分不足！需要 ${creditCost} 积分` : "扣费失败，请重试",
      status: insufficient ? 400 : 409,
    };
  }

  const { data: chargedTask, error: taskUpdateError } = await adminClient
    .from("ecom_image_tasks")
    .update({
      credits_charged: true,
      credits_charged_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("user_id", userId)
    .eq("credits_charged", false)
    .select("id")
    .single();

  if (taskUpdateError || !chargedTask) {
    console.error("[Generate Images] Failed to mark task credits charged:", taskUpdateError);
    await refundEcomCreditsAfterGenerationFailure(
      adminClient,
      userId,
      taskId,
      creditCost,
      `电商图片扣费标记失败自动退款 (${taskId})`,
      getEcomRefundOperation(billingAttempt, "charge-state"),
      getEcomPricingVersion(mode, billingAttempt),
      false
    );
    return { success: false, chargedNow: false, amount: creditCost, error: "扣费状态更新失败，请重试", status: 409 };
  }

  return { success: true, chargedNow: true, amount: creditCost };
}

async function refundEcomCreditsAfterGenerationFailure(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  taskId: string,
  amount: number,
  description: string,
  operation: string,
  pricingVersion: string,
  resetChargeState = true
): Promise<boolean> {
  if (amount <= 0) return true;

  try {
    await applyTaskCreditDelta({
      supabase: adminClient,
      userId,
      entryKind: "refund",
      amount,
      scope: "ecom-image",
      taskId,
      operation,
      pricingVersion,
      description,
    });
  } catch (error) {
    console.error("[Generate Images] Failed to refund credits:", error);
    return false;
  }

  if (resetChargeState) {
    await adminClient
      .from("ecom_image_tasks")
      .update({
        credits_charged: false,
        credits_charged_at: null,
      })
      .eq("id", taskId)
      .eq("user_id", userId);
  }

  console.log("[Generate Images] Credits refunded:", {
    taskId,
    userId,
    amount,
    resetChargeState,
  });

  return true;
}

async function submitEcomImage(params: {
  modelType: ImageModelType;
  prompt: string;
  sourceImageUrl?: string;
  aspectRatio?: EcomAspectRatio;
  resolution: EcomResolution;
}): Promise<{
  success: boolean;
  status: "processing" | "completed";
  taskId?: string;
  imageUrl?: string;
  error?: string;
}> {
  const config = IMAGE_MODEL_CONFIG[params.modelType as ImageModel];
  if (config?.provider !== "openai") {
    return {
      success: false,
      status: "completed",
      error: "当前图片工厂仅支持 GPT Image 2 / OpenAI 图片模型",
    };
  }

  const sourceImageUrls = params.sourceImageUrl ? [params.sourceImageUrl] : undefined;
  const result = await submitOpenAIImage({
    model: config.apiModel,
    prompt: params.prompt,
    sourceImageUrls,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
    quality: "high",
  });

  return {
    success: result.success,
    status: "completed",
    imageUrl: result.imageUrl,
    error: result.error,
  };
}

// 获取默认提示词 - 所有提示词都强调保持原产品不变
function getDefaultPrompt(mode: EcomImageMode): string {
  const keepProductPrefix = "Keep the EXACT SAME product from the reference image unchanged. Maintain all product details, colors, textures and shape exactly as shown.";

  switch (mode) {
    case "white_background":
      return `${keepProductPrefix} Place the product on a pure white background. Professional studio lighting, soft even illumination, no harsh shadows, no extra objects, no text, no watermark.`;
    case "scene_image":
      return `${keepProductPrefix} Place the product in a beautiful lifestyle scene with natural lighting, cozy atmosphere. The product must be clearly visible and identical to the reference.`;
    case "try_on":
      return `${keepProductPrefix} Show an AI model wearing/using the product with natural pose, professional fashion photography style. The product details must remain identical to the reference.`;
    case "buyer_show":
      return `${keepProductPrefix} Create a realistic buyer photo style with natural lighting, casual setting. The product must look exactly the same as in the reference image.`;
    default:
      return `${keepProductPrefix} Create a high quality e-commerce product image with professional lighting and clean presentation.`;
  }
}

// 获取模式标签
function getModeLabel(mode: EcomImageMode, index: number): string {
  switch (mode) {
    case "white_background":
      return `白底图 ${index}`;
    case "scene_image":
      return `场景图 ${index}`;
    case "try_on":
      return `试穿图 ${index}`;
    case "buyer_show":
      return `买家秀 ${index}`;
    default:
      return `图片 ${index}`;
  }
}

// 获取模式显示名称
function getModeDisplayName(mode: EcomImageMode): string {
  switch (mode) {
    case "ecom_five_pack":
      return "电商五图套装";
    case "white_background":
      return "一键白底图";
    case "scene_image":
      return "一键场景图";
    case "try_on":
      return "一键试穿";
    case "buyer_show":
      return "一键买家秀";
    default:
      return "图片生成";
  }
}
