/**
 * 图片生成 API - NanoBanana / Gemini
 * 
 * POST /api/generate/image - 提交图片生成任务
 * GET /api/generate/image?taskId=xxx&model=xxx - 查询任务状态
 */

import { NextResponse } from "next/server";
import {
  submitNanoBanana,
  queryNanoBananaResult,
  upscaleImage,
  generateNineGrid,
  generateGeminiImage,
  uploadBase64ImageToOSS,
} from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// 积分配置
// 快速单个图片/批量生产图片扣分机制：
// - Nano Banana Fast: 10 积分/次
// - Nano Banana Pro: 28 积分/次
// ============================================================================

// NanoBanana 积分配置
const NANO_BANANA_CREDITS = {
  "nano-banana": {
    "fast": 10,   // Fast 模式 = 10积分
    "pro": 10,    // 同样是 10积分（nano-banana 只有 fast 模式）
  },
  "nano-banana-pro": {
    "1k": 28,     // Pro 模式 = 28积分
    "2k": 28,     // Pro 模式 = 28积分
    "4k": 28,     // Pro 模式 = 28积分
  },
};

// 图片增强积分配置
const ENHANCEMENT_CREDITS = {
  "upscale_2k": 10,   // Nano Banana 放大 = 10积分
  "upscale_4k": 10,   // Nano Banana 放大 = 10积分
  "nine_grid": 10,    // Nano Banana 九宫格 = 10积分
};

// ============================================================================
// POST - 提交图片生成任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      mode,           // "generate" | "upscale" | "nine_grid"
      prompt,
      sourceImageUrl,
      model = "nano-banana",        // "nano-banana" | "nano-banana-pro"
      tier = "fast",                // "fast" | "pro" (for nano-banana)
      aspectRatio = "auto",
      resolution = "1k",            // "1k" | "2k" | "4k" (for nano-banana-pro)
      userId,
      source = "quick_gen",         // "quick_gen" | "batch_image"
      requestId,                    // 前端生成的 ID，用于确保前端始终知道 taskId
    } = body;

    console.log("[Generate Image] Request received:", {
      mode,
      model,
      source,
      hasPrompt: !!prompt,
      promptLength: prompt?.length || 0,
      promptPreview: prompt?.substring(0, 100) || "(empty)",
      hasSourceImage: !!sourceImageUrl,
    });

    // ============================================
    // 计算积分消耗
    // ============================================
    let creditCost = 0;

    if (mode === "upscale") {
      creditCost = resolution === "4k"
        ? ENHANCEMENT_CREDITS.upscale_4k
        : ENHANCEMENT_CREDITS.upscale_2k;
    } else if (mode === "nine_grid") {
      creditCost = ENHANCEMENT_CREDITS.nine_grid;
    } else {
      // 普通生成
      if (model === "nano-banana-pro") {
        creditCost = NANO_BANANA_CREDITS["nano-banana-pro"][resolution as "1k" | "2k" | "4k"] || 30;
      } else {
        creditCost = tier === "pro"
          ? NANO_BANANA_CREDITS["nano-banana"].pro
          : NANO_BANANA_CREDITS["nano-banana"].fast;
      }
    }

    // ============================================
    // 扣除积分
    // ============================================
    if (userId) {
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

      if (currentCredits < creditCost) {
        return NextResponse.json(
          { success: false, error: `积分不足！需要 ${creditCost} 积分，当前余额 ${currentCredits}` },
          { status: 400 }
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deductError } = await (supabase as any)
        .from("profiles")
        .update({ credits: currentCredits - creditCost })
        .eq("id", userId);

      if (deductError) {
        console.error("[Generate Image] Failed to deduct credits:", deductError);
        return NextResponse.json(
          { success: false, error: "Failed to deduct credits" },
          { status: 500 }
        );
      }

      console.log("[Generate Image] Credits deducted:", {
        userId,
        mode,
        cost: creditCost,
        before: currentCredits,
        after: currentCredits - creditCost,
      });
    }

    // ============================================
    // 根据模式提交任务
    // ============================================
    let result: { success: boolean; taskId?: string; error?: string };

    if (mode === "upscale") {
      // 图片放大高清
      if (!sourceImageUrl) {
        return NextResponse.json(
          { success: false, error: "Source image URL is required for upscale" },
          { status: 400 }
        );
      }

      console.log("[Generate Image] Upscaling image:", {
        sourceImageUrl: sourceImageUrl.substring(0, 50) + "...",
        targetResolution: resolution,
      });

      result = await upscaleImage(
        sourceImageUrl,
        resolution as "2k" | "4k"
      );

    } else if (mode === "nine_grid") {
      // 九宫格多角度
      if (!sourceImageUrl) {
        return NextResponse.json(
          { success: false, error: "Source image URL is required for nine grid" },
          { status: 400 }
        );
      }

      console.log("[Generate Image] Generating nine grid:", {
        sourceImageUrl: sourceImageUrl.substring(0, 50) + "...",
        productDescription: prompt,
      });

      result = await generateNineGrid(sourceImageUrl, prompt);

    } else {
      // 普通图片生成
      // 如果有源图片，允许空 prompt 或短 prompt
      // 如果没有源图片，至少需要 2 个字符的 prompt
      if (!sourceImageUrl && (!prompt || prompt.trim().length < 2)) {
        return NextResponse.json(
          { success: false, error: "请输入至少 2 个字符的提示词" },
          { status: 400 }
        );
      }

      console.log("[Generate Image] Generating image:", {
        model,
        prompt: prompt.substring(0, 50) + "...",
        hasSourceImage: !!sourceImageUrl,
        aspectRatio,
        resolution: model === "nano-banana-pro" ? resolution : undefined,
      });

      // ================================================================
      // nano-banana (快速模式) 直接使用 Gemini 3 Pro Image API
      // nano-banana-pro 继续使用原 NanoBanana API (支持 2K/4K)
      // ================================================================
      if (model === "nano-banana") {
        // 使用 Gemini API（同步返回，更快更便宜）
        console.log("[Generate Image] Using Gemini 3 Pro Image API...");
        const geminiResult = await generateGeminiImage({
          prompt,
          sourceImageUrl,
        });

        if (!geminiResult.success || !geminiResult.imageBase64) {
          result = { success: false, error: geminiResult.error || "Gemini 图片生成失败" };
        } else {
          // 将 Base64 上传到 OSS
          const uploadResult = await uploadBase64ImageToOSS(
            geminiResult.imageBase64,
            `gemini-${Date.now()}.jpg`
          );

          if (!uploadResult.success || !uploadResult.url) {
            result = { success: false, error: uploadResult.error || "图片上传失败" };
          } else {
            // Gemini 是同步的，直接返回成功
            // 优先使用前端传来的 requestId，确保前端始终知道 taskId
            const taskId = requestId || `gemini-${Date.now()}`;

            // 直接写入 generations 表（已完成状态）
            if (userId) {
              try {
                const supabase = createAdminClient();
                await supabase.from("generations").insert({
                  user_id: userId,
                  task_id: taskId,
                  type: "image",
                  source: source,
                  prompt: prompt || null,
                  model: "gemini-3-pro-image",
                  aspect_ratio: aspectRatio,
                  quality: "1k",
                  source_image_url: sourceImageUrl || null,
                  status: "completed",
                  result_url: uploadResult.url,
                  image_url: uploadResult.url,
                  credit_cost: creditCost,
                  created_at: new Date().toISOString(),
                  completed_at: new Date().toISOString(),
                });
              } catch (dbError) {
                console.error("[Generate Image] DB insert error:", dbError);
              }
            }

            // 直接返回完成状态
            return NextResponse.json({
              success: true,
              data: {
                taskId,
                status: "completed",
                imageUrl: uploadResult.url,
                model: "gemini-3-pro-image",
                estimatedTime: "已完成",
              },
            });
          }
        }
      } else {
        // nano-banana-pro 使用原 NanoBanana API
        result = await submitNanoBanana({
          model: model as "nano-banana" | "nano-banana-pro",
          prompt,
          img_url: sourceImageUrl,
          aspectRatio: aspectRatio as "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
          resolution: resolution as "1k" | "2k" | "4k",
        });
      }
    }

    if (!result.success) {
      console.error("[Generate Image] Submit failed:", result.error);

      // 退还积分
      if (userId) {
        try {
          const supabase = createAdminClient();
          const { data: refundProfile } = await supabase
            .from("profiles")
            .select("credits")
            .eq("id", userId)
            .single();

          if (refundProfile) {
            const refundCredits = (refundProfile as { credits: number }).credits;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from("profiles")
              .update({ credits: refundCredits + creditCost })
              .eq("id", userId);

            console.log("[Generate Image] Credits refunded:", creditCost);
          }
        } catch (refundError) {
          console.error("[Generate Image] Failed to refund:", refundError);
        }
      }

      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    console.log("[Generate Image] Task submitted:", {
      taskId: result.taskId,
      mode,
      model,
    });

    // 写入 generations 表
    if (userId && result.taskId) {
      try {
        const supabase = createAdminClient();
        await supabase.from("generations").insert({
          user_id: userId,
          task_id: result.taskId,
          type: "image",
          source: source,
          prompt: prompt || null,
          model: model,
          aspect_ratio: aspectRatio,
          quality: resolution,
          source_image_url: sourceImageUrl || null,
          status: "processing",
          credit_cost: creditCost,
          created_at: new Date().toISOString(),
        });
        console.log("[Generate Image] Saved to generations table:", result.taskId);
      } catch (dbError) {
        console.error("[Generate Image] Failed to save to DB:", dbError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: result.taskId,
        status: "processing",
        model: mode === "upscale" || mode === "nine_grid" ? "nano-banana-pro" : model,
        estimatedTime: "30-60 seconds",
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
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const model = searchParams.get("model") || "nano-banana";
    const userId = searchParams.get("userId"); // 新增：支持按用户ID查询

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    console.log("[Generate Image] Querying task:", taskId, { model, userId });

    // ================================================================
    // Gemini 任务直接查询数据库
    // Gemini API 是同步的，结果直接保存在 generations 表中
    // ================================================================
    if (taskId.startsWith("gemini-")) {
      const supabase = createAdminClient();

      // 首先尝试精确匹配 taskId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let { data: genData, error: dbError } = await (supabase as any)
        .from("generations")
        .select("*")
        .eq("task_id", taskId)
        .single();

      // 如果精确匹配失败且有 userId，尝试查询该用户最近1分钟内的 Gemini 任务
      // 这解决了 POST 响应解析失败但后端已成功的情况
      if ((dbError || !genData) && userId) {
        console.log("[Generate Image] Exact match failed, searching recent tasks for user:", userId);
        const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: recentData } = await (supabase as any)
          .from("generations")
          .select("*")
          .eq("user_id", userId)
          .eq("source", "batch_image")
          .like("task_id", "gemini-%")
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
        const supabase = createAdminClient();

        // 获取任务信息以便退款
        const { data: genData } = await supabase
          .from("generations")
          .select("user_id, credit_cost, status")
          .eq("task_id", taskId)
          .single();

        // 如果任务失败且之前状态是 processing，则退还积分
        if (task.status === "failed" && genData && genData.status === "processing") {
          const userId = genData.user_id;
          const creditCost = genData.credit_cost || 0;

          if (userId && creditCost > 0) {
            const { data: profileData } = await supabase
              .from("profiles")
              .select("credits")
              .eq("id", userId)
              .single();

            if (profileData) {
              const currentCredits = (profileData as { credits: number }).credits;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase as any)
                .from("profiles")
                .update({ credits: currentCredits + creditCost })
                .eq("id", userId);

              console.log("[Generate Image] Credits refunded on task failure:", {
                taskId,
                userId,
                refunded: creditCost,
                newBalance: currentCredits + creditCost,
              });
            }
          }
        }

        // 生成更友好的错误信息
        let friendlyErrorMessage = task.errorMessage;
        if (task.errorMessage?.includes("google gemini timeout")) {
          friendlyErrorMessage = "第三方 AI 服务暂时繁忙，积分已自动退还，请稍后重试或使用 Nano Banana Fast 模式";
        } else if (task.errorMessage?.includes("timeout")) {
          friendlyErrorMessage = "生成超时，积分已自动退还，请稍后重试";
        }

        await supabase
          .from("generations")
          .update({
            status: task.status,
            result_url: task.resultUrl || null,
            image_url: task.resultUrl || null,
            error_message: friendlyErrorMessage || null,
            completed_at: task.status === "completed" ? new Date().toISOString() : null,
          })
          .eq("task_id", taskId);
        console.log("[Generate Image] Updated generations table:", taskId, task.status);
      } catch (dbError) {
        console.error("[Generate Image] Failed to update DB:", dbError);
      }
    }

    // 生成更友好的错误信息返回给前端
    let displayErrorMessage = task.errorMessage;
    if (task.status === "failed") {
      if (task.errorMessage?.includes("google gemini timeout")) {
        displayErrorMessage = "第三方 AI 服务暂时繁忙，积分已自动退还，请稍后重试或使用 Nano Banana Fast 模式";
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

