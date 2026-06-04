/**
 * 图片生成 API - GPT Image 2 / 新图片模型
 * 
 * POST /api/generate/image - 提交图片生成任务
 * GET /api/generate/image?taskId=xxx&model=xxx - 查询任务状态
 */

import { NextResponse } from "next/server";
import { queryNanoBananaResult } from "@/lib/suchuang-api";
import { submitOpenAIImage } from "@/lib/openai-image-api";
import { IMAGE_MODEL_CONFIG, isOpenAIImageModel, type ImageModel } from "@/types/generation";
import { getNewImageCost } from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

// 增加请求体大小限制以支持 base64 图片 (50MB)
export const maxDuration = 120; // 2分钟超时
export const dynamic = 'force-dynamic';

const VALID_IMAGE_MODES = new Set(["generate", "upscale", "nine_grid"]);

function getOpenAIEditPrompt(mode: string, prompt: string | undefined, resolution: string): string {
  const userPrompt = prompt?.trim();
  if (userPrompt) return userPrompt;

  if (mode === "upscale") {
    return `Enhance this image using the reference image. Preserve the original subject, composition, colors, and identity. Improve sharpness, texture detail, lighting balance, and overall clarity for a ${resolution.toUpperCase()} quality output. Do not add text, watermark, or extra objects.`;
  }

  return "Using the reference image, create a clean 3x3 nine-grid multi-angle product showcase. Preserve the exact same product identity, colors, shape, materials, and details. Show varied useful angles and close-up detail views on a clean background. Do not add text or watermark.";
}

function getUuidReferenceId(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

interface ImageCreditChargeResult {
  success: boolean;
  amount: number;
  balanceBefore?: number;
  balanceAfter?: number;
  error?: string;
  status?: number;
}

interface ImageCreditRefundResult {
  success: boolean;
  balanceBefore?: number;
  balanceAfter?: number;
  error?: string;
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

    const { error: transactionError } = await adminClient.from("credit_transactions").insert({
      user_id: userId,
      amount: -creditCost,
      type: "consume",
      description: `图片生成 - GPT Image 2 (${taskId})`,
      reference_type: "quick_gen_image",
      reference_id: getUuidReferenceId(taskId),
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    });

    if (transactionError) {
      console.error("[Generate Image] Failed to record credit transaction:", transactionError);
      await rollbackImageCreditCharge(adminClient, userId, balanceBefore, balanceAfter);
      return {
        success: false,
        amount: creditCost,
        balanceBefore,
        balanceAfter,
        error: "扣费流水记录失败，请重试",
        status: 500,
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

  const { error: transactionError } = await adminClient.from("credit_transactions").insert({
    user_id: userId,
    amount: creditCost,
    type: "refund",
    description: `图片生成失败自动退款 - GPT Image 2 (${taskId})`,
    reference_type: "quick_gen_image",
    reference_id: getUuidReferenceId(taskId),
    balance_before: balanceBefore,
    balance_after: balanceAfter,
  });

  if (transactionError) {
    console.error("[Generate Image] Failed to record refund transaction:", transactionError);
    return { success: false, balanceBefore, balanceAfter, error: "退款流水记录失败，请联系客服处理" };
  }

  return { success: true, balanceBefore, balanceAfter };
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
      resolution = "1k",
      source = "quick_gen",         // "quick_gen" | "batch_image"
      requestId,                    // 前端生成的 ID
    } = body;

    // 合并多图来源：优先 sourceImageUrls，兼容旧的单张 sourceImageUrl
    const allSourceImageUrls: string[] = sourceImageUrls?.length
      ? sourceImageUrls
      : (sourceImageUrl ? [sourceImageUrl] : []);
    // 第一张图用于 DB 记录和 Pro 模式
    const primarySourceImageUrl = allSourceImageUrls[0] || null;
    const modeValue = mode || "generate";
    const imageModel = (requestedImageModel || "gpt-image-2") as ImageModel;
    const imageConfig = imageModel ? IMAGE_MODEL_CONFIG[imageModel] : undefined;

    console.log("[Generate Image] Request received:", {
      mode: modeValue,
      legacyModel: requestedLegacyModel,
      imageModel,
      source,
      hasPrompt: !!prompt,
      promptLength: prompt?.length || 0,
      promptPreview: prompt?.substring(0, 100) || "(empty)",
      hasSourceImage: allSourceImageUrls.length > 0,
      sourceImageCount: allSourceImageUrls.length,
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

    if (imageModel && !imageConfig) {
      return NextResponse.json(
        { success: false, error: `未知图片模型: ${imageModel}` },
        { status: 400 }
      );
    }

    if (!isOpenAIImageModel(imageModel)) {
      return NextResponse.json(
        { success: false, error: "当前图片生成仅支持 GPT Image 2 / OpenAI 图片模型" },
        { status: 400 }
      );
    }

    if ((modeValue === "upscale" || modeValue === "nine_grid") && !primarySourceImageUrl) {
      return NextResponse.json(
        { success: false, error: modeValue === "upscale" ? "Source image URL is required for upscale" : "Source image URL is required for nine grid" },
        { status: 400 }
      );
    }

    if ((modeValue === "upscale" || modeValue === "nine_grid") && imageConfig?.provider !== "openai") {
      return NextResponse.json(
        { success: false, error: "Phase2 图片增强仅支持 GPT Image 2 / OpenAI edits，已阻断旧接口调用" },
        { status: 400 }
      );
    }

    if (modeValue === "generate" && allSourceImageUrls.length === 0 && (!prompt || prompt.trim().length < 2)) {
      return NextResponse.json(
        { success: false, error: "请输入至少 2 个字符的提示词" },
        { status: 400 }
      );
    }

    // ============================================
    // 计算积分消耗
    // ============================================
    const creditCost = getNewImageCost(imageModel);
    const taskId = requestId || (modeValue === "upscale" || modeValue === "nine_grid"
      ? `openai-${modeValue}-${Date.now()}`
      : `openai-${Date.now()}`);

    // ============================================
    // 扣除积分并记录流水
    // ============================================
    const supabase = createAdminClient();
    const chargeResult = await chargeImageCreditsBeforeGeneration(
      supabase,
      authUserId,
      taskId,
      creditCost
    );

    if (!chargeResult.success) {
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
    // 根据模式提交任务
    // ============================================
    let result: { success: boolean; error?: string } = { success: false, error: "图片生成失败" };

    if (modeValue === "upscale" || modeValue === "nine_grid") {
      const config = imageConfig!;
      console.log("[Generate Image] Running OpenAI edit mode:", {
        mode: modeValue,
        imageModel,
        sourceImageCount: allSourceImageUrls.length,
      });

      const imageResult = await submitOpenAIImage({
        model: config.apiModel,
        prompt: getOpenAIEditPrompt(modeValue, prompt, resolution),
        sourceImageUrls: allSourceImageUrls,
        aspectRatio,
        quality: "high",
      });

      if (!imageResult.success || !imageResult.imageUrl) {
        result = { success: false, error: imageResult.error || "图片编辑失败" };
      } else {
        try {
          await supabase.from("generations").insert({
            user_id: authUserId,
            task_id: taskId,
            type: "image",
            generation_type: "image",
            source: source,
            prompt: getOpenAIEditPrompt(modeValue, prompt, resolution),
            model: imageModel,
            aspect_ratio: aspectRatio,
            quality: config.resolution,
            resolution: config.resolution,
            source_image_url: primarySourceImageUrl || null,
            status: "completed",
            result_url: imageResult.imageUrl,
            image_url: imageResult.imageUrl,
            credit_cost: creditCost,
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          });
        } catch (dbError) {
          console.error("[Generate Image] DB insert error:", dbError);
        }

        return NextResponse.json({
          success: true,
          data: {
            taskId,
            status: "completed",
            imageUrl: imageResult.imageUrl,
            model: imageModel,
            estimatedTime: config.estimatedTime,
          },
        });
      }

    } else {
      console.log("[Generate Image] Generating image:", {
        imageModel,
        prompt: `${(prompt || "").substring(0, 50)}...`,
        hasSourceImage: allSourceImageUrls.length > 0,
        sourceImageCount: allSourceImageUrls.length,
        aspectRatio,
      });

      const config = imageConfig!;
      console.log("[Generate Image] Using image model:", imageModel, config.provider);
      const imageResult = await submitOpenAIImage({
        model: config.apiModel,
        prompt: prompt || "",
        sourceImageUrls: allSourceImageUrls.length > 0 ? allSourceImageUrls : undefined,
        aspectRatio,
        quality: "high",
      });

      if (!imageResult.success || !imageResult.imageUrl) {
        result = { success: false, error: imageResult.error || "图片生成失败" };
      } else {
        try {
          await supabase.from("generations").insert({
            user_id: authUserId,
            task_id: taskId,
            type: "image",
            generation_type: "image",
            source: source,
            prompt: prompt || null,
            model: imageModel,
            aspect_ratio: aspectRatio,
            quality: config.resolution,
            resolution: config.resolution,
            source_image_url: primarySourceImageUrl || null,
            status: "completed",
            result_url: imageResult.imageUrl,
            image_url: imageResult.imageUrl,
            credit_cost: creditCost,
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          });
        } catch (dbError) {
          console.error("[Generate Image] DB insert error:", dbError);
        }

        return NextResponse.json({
          success: true,
          data: {
            taskId,
            status: "completed",
            imageUrl: imageResult.imageUrl,
            model: imageModel,
            estimatedTime: config.estimatedTime,
          },
        });
      }
    }

    if (!result.success) {
      console.error("[Generate Image] Submit failed:", result.error);

      const refundResult = await refundImageCreditsAfterGenerationFailure(
        supabase,
        authUserId,
        taskId,
        creditCost
      );
      console.log("[Generate Image] Credits refund result:", {
        refunded: refundResult.success,
        amount: creditCost,
        before: refundResult.balanceBefore,
        after: refundResult.balanceAfter,
      });

      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { success: false, error: result.error || "图片生成失败" },
      { status: 500 }
    );
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
    const model = searchParams.get("model") || "nano-banana";

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    console.log("[Generate Image] Querying task:", taskId, { model, userId: authUserId });

    // ================================================================
    // 同步图片模型任务直接查询数据库
    // GPT Image / Gemini API 是同步的，结果直接保存在 generations 表中
    // ================================================================
    if (taskId.startsWith("gemini-") || taskId.startsWith("openai-")) {
      const supabase = createAdminClient();

      // 首先尝试精确匹配 taskId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let { data: genData, error: dbError } = await (supabase as any)
        .from("generations")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", authUserId)
        .single();

      // 如果精确匹配失败，尝试查询该用户最近1分钟内的同步图片任务
      // 这解决了 POST 响应解析失败但后端已成功的情况
      if (dbError || !genData) {
        console.log("[Generate Image] Exact match failed, searching recent tasks for user:", authUserId);
        const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: recentData } = await (supabase as any)
          .from("generations")
          .select("*")
          .eq("user_id", authUserId)
          .eq("source", "batch_image")
          .in("model", Object.keys(IMAGE_MODEL_CONFIG))
          .gte("created_at", oneMinuteAgo)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (recentData) {
          console.log("[Generate Image] Found recent Gemini task:", recentData.task_id);
          genData = recentData;
          dbError = null;
        }
      }

      if (dbError || !genData) {
        console.log("[Generate Image] Gemini task not found in DB:", taskId);
        return NextResponse.json({
          success: true,
          data: {
            taskId,
            status: "processing",
            imageUrl: null,
            errorMessage: null,
          },
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = genData as any;
      console.log("[Generate Image] Gemini task found in DB:", {
        taskId: record.task_id,
        status: record.status,
        hasImage: !!record.image_url,
      });

      return NextResponse.json({
        success: true,
        data: {
          taskId: record.task_id,
          status: record.status,
          imageUrl: record.image_url || record.result_url,
          errorMessage: record.error_message,
          createdAt: record.created_at,
          updatedAt: record.completed_at,
        },
      });
    }

    // ================================================================
    // NanoBanana 任务查询 API
    // ================================================================
    const supabase = createAdminClient();
    const { data: genData, error: genError } = await supabase
      .from("generations")
      .select("user_id, credit_cost, status")
      .eq("task_id", taskId)
      .eq("user_id", authUserId)
      .single();

    if (genError || !genData) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权访问" },
        { status: 404 }
      );
    }

    const result = await queryNanoBananaResult(
      taskId,
      model as "nano-banana" | "nano-banana-pro"
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    const task = result.task!;

    // 更新 generations 表状态
    if (task.status === "completed" || task.status === "failed") {
      try {
        // 如果任务失败且之前状态是 processing，则退还积分
        // 使用原子操作防止重复退款：先更新状态，只有成功更新的请求才能退款
        if (task.status === "failed" && genData && genData.status === "processing") {
          // 先尝试原子更新状态（乐观锁）- 只有 processing 状态才能更新为 failed
          const { data: updateResult, error: statusUpdateError } = await supabase
            .from("generations")
            .update({ status: "failed", error_message: task.errorMessage })
            .eq("task_id", taskId)
            .eq("user_id", authUserId)
            .eq("status", "processing") // 乐观锁：只有 processing 状态才能更新
            .select()
            .single();

          // 只有成功更新状态的请求才执行退款（防止并发重复退款）
          if (updateResult && !statusUpdateError) {
            const refundUserId = genData.user_id;
            const creditCost = genData.credit_cost || 0;

            if (refundUserId && creditCost > 0) {
                const { data: profileData } = await supabase
                  .from("profiles")
                  .select("credits")
                  .eq("id", refundUserId)
                .single();

              if (profileData) {
                const currentCredits = (profileData as { credits: number }).credits;
                await supabase
                  .from("profiles")
                  .update({ credits: currentCredits + creditCost })
                  .eq("id", refundUserId);

                // 记录退款交易
                await supabase.from("credit_transactions").insert({
                  user_id: refundUserId,
                  amount: creditCost,
                  type: "refund",
                  description: `图片生成失败自动退款 (${taskId})`,
                  balance_before: currentCredits,
                  balance_after: currentCredits + creditCost,
                });

                console.log("[Generate Image] Credits refunded on task failure:", {
                  taskId,
                  userId: refundUserId,
                  refunded: creditCost,
                  newBalance: currentCredits + creditCost,
                });
              }
            }
          } else {
            // 状态更新失败说明其他请求已经处理了，跳过退款
            console.log("[Generate Image] Skipping refund - already processed by another request:", taskId);
          }
        } else if (task.status === "completed" && genData && genData.status === "processing") {
          // 任务成功完成，更新状态
          await supabase
            .from("generations")
            .update({
              status: "completed",
              result_url: task.resultUrl || null,
              image_url: task.resultUrl || null,
              completed_at: new Date().toISOString(),
            })
            .eq("task_id", taskId)
            .eq("user_id", authUserId)
            .eq("status", "processing");
        }
        console.log("[Generate Image] Updated generations table:", taskId, task.status);
      } catch (dbError) {
        console.error("[Generate Image] Failed to update DB:", dbError);
      }
    }

    // 生成更友好的错误信息返回给前端
    let displayErrorMessage = task.errorMessage;
    if (task.status === "failed") {
      if (task.errorMessage?.includes("google gemini timeout")) {
        displayErrorMessage = "第三方 AI 服务暂时繁忙，积分已自动退还，请稍后重试或使用 GPT Image 2";
      } else if (task.errorMessage?.includes("timeout")) {
        displayErrorMessage = "生成超时，积分已自动退还，请稍后重试";
      } else {
        displayErrorMessage = task.errorMessage || "生成失败，积分已自动退还";
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        imageUrl: task.resultUrl,
        errorMessage: displayErrorMessage,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
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
