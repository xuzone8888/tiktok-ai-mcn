/**
 * 视频生成 API
 * 
 * POST /api/generate/video - 提交视频生成任务
 * GET /api/generate/video?taskId=xxx - 查询任务状态
 *
 * 2026-03-19 更新：支持新模型 (Sora2-NEW + VEO3)
 */

import { NextResponse } from "next/server";
import { applyTaskCreditDelta } from "@/lib/credits/atomic-task-credit";
import { submitSora2, querySora2Result } from "@/lib/suchuang-api";
import { submitVeo3Video, queryVeoResult } from "@/lib/gaorui-veo-api";
import { VIDEO_MODEL_CONFIG, type VideoModel } from "@/types/generation";
import { getNewVideoCost } from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { transferVeoVideoToOSS, isOSSPermanentUrl } from "@/lib/transfer-veo-to-oss";

// ============================================================================
// 积分配置
// 快速单个视频功能扣分机制：
// - 标准款（10秒/15秒 横/竖屏）：20 积分/条
// - PRO 款（25秒 横/竖屏）：320 积分/条
// - PRO 高清款（15秒 横/竖屏）：320 积分/条
// ============================================================================

function getVideoCreditCost(duration: number, quality: string, videoModel?: string): number {
  // 新模型：从 VIDEO_MODEL_CONFIG 读取积分
  if (videoModel && VIDEO_MODEL_CONFIG[videoModel]) {
    return getNewVideoCost(videoModel as VideoModel);
  }
  // 旧模型兼容
  if (duration === 15 && quality === "hd") return 320;
  if (duration === 25) return 320;
  return 20;
}

// 保留旧的映射用于兼容
const CREDIT_COST_MAP: Record<number, number> = {
  10: 20,   // 标准款 10s = 20积分
  15: 20,   // 标准款 15s = 20积分
  20: 320,  // PRO款 20s = 320积分 (如果支持)
  25: 320,  // PRO款 25s = 320积分
};

const ESTIMATED_TIME_MAP: Record<number, string> = {
  10: "4-5 minutes",
  15: "5-6 minutes",
  20: "7-8 minutes",
  25: "8-10 minutes",
};

// ============================================================================
// POST - 提交视频生成任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      prompt,
      duration = 15,
      aspectRatio = "9:16",
      quality = "standard",
      apiModel,
      videoModel,       // 新模型：如 "sora2-new-10s", "veo3-fast" 等
      modelId,
      sourceImageUrl,
      sourceImageUrls,  // VEO3 多张参考图
      userId: requestedUserId,
    } = body;

    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }
    if (requestedUserId && requestedUserId !== user.id) {
      return NextResponse.json(
        { success: false, error: "用户身份不匹配" },
        { status: 403 }
      );
    }
    const userId = user.id;

    if (!prompt || prompt.trim().length < 5) {
      return NextResponse.json(
        { success: false, error: "Prompt must be at least 5 characters" },
        { status: 400 }
      );
    }

    // 验证时长 - 支持 8 (VEO3), 10, 15, 20, 25 秒
    if (![8, 10, 15, 20, 25].includes(duration)) {
      return NextResponse.json(
        { success: false, error: "Duration must be 8, 10, 15, 20, or 25 seconds" },
        { status: 400 }
      );
    }

    // ============================================
    // 计算费用并扣除积分
    // ============================================
    const creditCost = getVideoCreditCost(duration, quality, videoModel);

    const billingTaskId = crypto.randomUUID();
    {
      const supabase = createAdminClient();

      // 获取用户当前积分
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .single();

      if (profileError || !profile) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 }
        );
      }

      if (profile.credits < creditCost) {
        return NextResponse.json(
          { success: false, error: `积分不足！需要 ${creditCost} 积分，当前余额 ${profile.credits}` },
          { status: 400 }
        );
      }

      // 扣除积分
      let chargeResult;
      try {
        chargeResult = await applyTaskCreditDelta({
          supabase,
          userId,
          entryKind: "consume",
          amount: -creditCost,
          scope: "quick-video",
          taskId: billingTaskId,
          operation: "consume",
          pricingVersion: `quick-video-${videoModel || duration}-${quality}-v1`,
          description: "快速视频生成扣费",
        });
      } catch (error) {
        console.error("[Generate Video] Failed to deduct credits:", error);
        return NextResponse.json(
          { success: false, error: "Failed to deduct credits" },
          { status: 500 }
        );
      }

      console.log("[Generate Video] Credits deducted:", {
        userId,
        cost: creditCost,
        duration,
        before: chargeResult.balanceBefore,
        after: chargeResult.balanceAfter,
      });
    }

    // 组装最终 prompt（如果有模特 ID，注入 trigger word）
    let finalPrompt = prompt;
    let triggerWord: string | null = null;
    let actualModelId: string | null = null;
    let characterRefImageUrl: string | null = null; // 角色参考图 URL（用于 VEO imageUrls）

    // 判断是否是 VEO 模型（VEO 通过 imageUrls 识别角色，不需要 prompt 注入）
    const modelConfig = videoModel ? VIDEO_MODEL_CONFIG[videoModel] : null;
    const isVeoModel = modelConfig && modelConfig.provider === "gaorui";

    // 调试日志：记录收到的 modelId
    console.log("[Generate Video] Received modelId:", modelId, "userId:", userId, "isVeoModel:", !!isVeoModel);

    if (modelId) {
      const supabase = createAdminClient();

      // 处理 "auto" 模式：从用户已签约的模特中随机选择一个
      if (modelId === "auto" && userId) {
        console.log("[Generate Video] Auto mode: selecting random model for user:", userId);

        // 查询用户已签约且未过期的角色
        const { data: contracts } = await supabase
          .from("contracts")
          .select("model_id, ai_models!inner(id, name, trigger_word, description, reference_sheet_url, source)")
          .eq("user_id", userId)
          .eq("status", "active")
          .gt("end_date", new Date().toISOString());

        if (contracts && contracts.length > 0) {
          // 随机选择一个角色
          const randomIndex = Math.floor(Math.random() * contracts.length);
          const selectedContract = contracts[randomIndex];
          const modelData = selectedContract.ai_models as any;

          // 兆底逻辑：trigger_word → description → name
          const characterPrompt = modelData?.trigger_word || modelData?.description || modelData?.name;
          if (characterPrompt) {
            triggerWord = characterPrompt;
            actualModelId = modelData.id;
            characterRefImageUrl = modelData?.reference_sheet_url || null;

            if (isVeoModel) {
              // VEO：不注入 prompt，角色通过 imageUrls 传入
              finalPrompt = prompt;
              console.log("[Generate Video] VEO auto mode - using user prompt directly, character via imageUrls");
            } else {
              // Sora2：通过 prompt 注入角色描述
              finalPrompt = `Professional video featuring ${characterPrompt}. ${prompt}`;
            }
            console.log("[Generate Video] Auto mode - Selected character:", {
              modelName: modelData.name,
              usedField: modelData.trigger_word ? "trigger_word" : modelData.description ? "description" : "name",
              selectedFromCount: contracts.length,
              isVeoModel: !!isVeoModel,
            });
          } else {
            console.log("[Generate Video] Auto mode - Selected model has no prompt data:", modelData?.name);
          }
        } else {
          console.log("[Generate Video] Auto mode - No active contracts found for user");
        }
      } else if (modelId !== "auto") {
        // 直接使用指定的角色 ID
        const { data: model } = await supabase
          .from("ai_models")
          .select("trigger_word, name, description, reference_sheet_url, source")
          .eq("id", modelId)
          .single();

        // 兆底逻辑：trigger_word → description → name
        const characterPrompt = model?.trigger_word || model?.description || model?.name;
        if (characterPrompt) {
          triggerWord = characterPrompt;
          actualModelId = modelId;
          characterRefImageUrl = model?.reference_sheet_url || null;

          if (isVeoModel) {
            // VEO：不注入 prompt，角色通过 imageUrls 传入
            finalPrompt = prompt;
            console.log("[Generate Video] VEO mode - using user prompt directly, character via imageUrls");
          } else {
            // Sora2：通过 prompt 注入角色描述
            finalPrompt = `Professional video featuring ${characterPrompt}. ${prompt}`;
          }
          console.log("[Generate Video] Injected character:", {
            modelName: model?.name,
            usedField: model?.trigger_word ? "trigger_word" : model?.description ? "description" : "name",
            isVeoModel: !!isVeoModel,
          });
        } else {
          console.log("[Generate Video] Model not found or has no prompt data:", modelId);
        }
      }
    }

    // 验证角色参考图 URL 为 OSS 永久地址
    if (characterRefImageUrl && !characterRefImageUrl.includes("media.toryxai.com")) {
      console.warn("[Generate Video] characterRefImageUrl is not a permanent OSS URL:", characterRefImageUrl.substring(0, 80));
      return NextResponse.json(
        { success: false, error: "角色参考图地址已过期，请到「我的角色」重新生成参考图" },
        { status: 400 }
      );
    }

    // 添加质量提升词
    finalPrompt += ". High quality, cinematic, professional lighting.";

    // 确定使用的 Sora2 模型
    const isPro = quality === "hd" || duration === 25;

    console.log("[Generate Video] Submitting task:", {
      originalPrompt: prompt.substring(0, 50) + "...",
      hasTriggerWord: !!triggerWord,
      hasCharacterRefImage: !!characterRefImageUrl,
      duration,
      aspectRatio,
      quality,
      apiModel,
      hasSourceImage: !!sourceImageUrl,
      usePro: isPro,
    });

    // 根据 videoModel 选择路由（modelConfig 已在上面声明）

    let result: { success: boolean; taskId?: string; videoUrl?: string; error?: string };
    let responseMode: "sync" | "async" = "async";

    if (modelConfig && modelConfig.provider === "gaorui") {
      // VEO3 模型→高瑞网关
      console.log("[Generate Video] Routing to Gaorui VEO3:", videoModel);

      // 合并用户上传图 + 角色参考图到 imageUrls
      const mergedImageUrls: string[] = [];
      if (sourceImageUrls) {
        mergedImageUrls.push(...sourceImageUrls);
      } else if (sourceImageUrl) {
        mergedImageUrls.push(sourceImageUrl);
      }
      if (characterRefImageUrl) {
        mergedImageUrls.push(characterRefImageUrl);
      }

      const veoResult = await submitVeo3Video({
        prompt: finalPrompt,
        model: modelConfig.apiModel as any,
        aspectRatio: aspectRatio as "9:16" | "16:9",
        imageUrls: mergedImageUrls.length > 0 ? mergedImageUrls : undefined,
      });
      responseMode = veoResult.mode;
      result = {
        success: veoResult.success,
        taskId: veoResult.taskId,
        videoUrl: veoResult.videoUrl,
        error: veoResult.error,
      };
    } else {
      // Sora2 模型→速创网关（默认）
      const sora2Duration = modelConfig?.duration || duration;
      result = await submitSora2({
        prompt: finalPrompt,
        duration: sora2Duration as 10 | 15 | 25,
        aspectRatio: aspectRatio as "9:16" | "16:9",
        url: sourceImageUrl,
        model: apiModel,
      });
    }

    if (!result.success) {
      console.error("[Generate Video] Submit failed:", result.error);

      // 如果提交失败，退还积分
      try {
        const supabase = createAdminClient();
        await applyTaskCreditDelta({
          supabase,
          userId,
          entryKind: "refund",
          amount: creditCost,
          scope: "quick-video",
          taskId: billingTaskId,
          operation: "refund",
          pricingVersion: `quick-video-${videoModel || duration}-${quality}-v1`,
          description: "快速视频生成提交失败退款",
        });
        console.log("[Generate Video] Credits refunded due to submit failure:", {
          userId,
          refund: creditCost,
        });
      } catch (refundError) {
        console.error("[Generate Video] Failed to refund credits:", refundError);
      }

      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    // 保存任务记录到数据库
    {
      const supabase = createAdminClient();
        // 注意：数据库的 "model" 字段存储 API 模型名称
        // actualModelId 存储选中的 AI 模特 ID（等数据库添加 ai_model_id 字段后启用）
        // finalPrompt 包含注入的唤醒词（等数据库添加 final_prompt 字段后启用）
        const { error: insertError } = await supabase.from("generations").insert({
          id: billingTaskId,
          user_id: userId,
          task_id: result.taskId,
          type: "video",
          source: "quick_gen",
          prompt: prompt,
          // 将模特信息暂存在 metadata 中，方便日后迁移
          model: videoModel || apiModel || `sora2-${duration}s`,
          duration,
          aspect_ratio: aspectRatio,
          quality: quality,
          source_image_url: sourceImageUrl || null,
          status: responseMode === "sync" && result.videoUrl ? "completed" : "processing",
          result_url: result.videoUrl || null,
          video_url: result.videoUrl || null,
          credit_cost: creditCost,
          use_pro: isPro,
          metadata: {
            ai_model_id: actualModelId,
            final_prompt: finalPrompt,
            trigger_word: triggerWord,
            billing_task_id: billingTaskId,
            billing_scope: "quick-video",
          },
          created_at: new Date().toISOString(),
        });
        if (insertError) {
          console.error("[Generate Video] Failed to save to DB:", insertError);
          await applyTaskCreditDelta({
            supabase,
            userId,
            entryKind: "refund",
            amount: creditCost,
            scope: "quick-video",
            taskId: billingTaskId,
            operation: "refund",
            pricingVersion: `quick-video-${videoModel || duration}-${quality}-v1`,
            description: "快速视频任务记录失败退款",
          });
          return NextResponse.json(
            { success: false, error: "任务记录失败，积分已退还" },
            { status: 500 }
          );
        }
        console.log("[Generate Video] Saved to generations table:", result.taskId, actualModelId ? `with model ${actualModelId}` : "no model");
    }

    console.log("[Generate Video] Task submitted successfully:", {
      taskId: result.taskId,
      duration,
      quality,
      usePro: isPro,
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId: result.taskId || "sync-" + Date.now(),
        status: responseMode === "sync" && result.videoUrl ? "completed" : "processing",
        videoUrl: result.videoUrl || null,
        estimatedTime: modelConfig?.estimatedTime || ESTIMATED_TIME_MAP[duration] || "5-6 minutes",
        usePro: isPro,
        responseMode,
      },
    });
  } catch (error) {
    console.error("[Generate Video] Error:", error);
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
    const usePro = searchParams.get("usePro") === "true";
    const videoModel = searchParams.get("videoModel");  // 新增：用于路由到不同查询接口

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    const ownershipClient = createAdminClient();
    const { data: ownedGeneration } = await ownershipClient
      .from("generations")
      .select("id, user_id, status, result_url")
      .eq("task_id", taskId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!ownedGeneration) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权查看" },
        { status: 404 }
      );
    }

    console.log("[Generate Video] Querying task:", taskId, { usePro, videoModel });

    // 根据 videoModel 路由查询
    const modelConfig = videoModel ? VIDEO_MODEL_CONFIG[videoModel] : null;

    let result: { success: boolean; task?: { taskId: string; status: string; resultUrl?: string; errorMessage?: string; createdAt?: string; updatedAt?: string }; error?: string };

    if (modelConfig && modelConfig.provider === "gaorui") {
      // VEO3 异步查询
      // 先检查数据库是否已有 OSS URL（之前已转存过）
      const existingGen = ownedGeneration;

      if (existingGen?.status === "completed" && existingGen?.result_url && isOSSPermanentUrl(existingGen.result_url)) {
        // 已有 OSS URL，直接返回
        console.log("[Generate Video] VEO already transferred to OSS, returning cached URL");
        result = {
          success: true,
          task: {
            taskId,
            status: "completed",
            resultUrl: existingGen.result_url,
          },
        };
      } else {
        const veoResult = await queryVeoResult(taskId);
        const veoTask = veoResult.task;

        // 如果 VEO 任务完成且 URL 不是 OSS，立即转存
        let finalVideoUrl = veoTask?.videoUrl;
        if (veoTask?.status === "completed" && finalVideoUrl && !isOSSPermanentUrl(finalVideoUrl)) {
          console.log("[Generate Video] VEO completed, transferring to OSS...");
          const transferResult = await transferVeoVideoToOSS(
            taskId,
            finalVideoUrl,
            existingGen?.user_id || undefined
          );
          if (transferResult.success && transferResult.ossUrl) {
            finalVideoUrl = transferResult.ossUrl;
            console.log("[Generate Video] ✅ VEO OSS transfer success:", finalVideoUrl);
          } else {
            console.warn("[Generate Video] ⚠️ VEO OSS transfer failed, using original URL:", transferResult.error);
          }
        }

        result = {
          success: veoResult.success,
          task: veoTask ? {
            taskId: veoTask.taskId,
            status: veoTask.status,
            resultUrl: finalVideoUrl,
            errorMessage: veoTask.errorMessage,
            createdAt: veoTask.createdAt,
          } : undefined,
          error: veoResult.error,
        };
      }
    } else {
      // Sora2 查询（默认）
      result = await querySora2Result(taskId, usePro);
    }

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    const task = result.task!;

    // 更新数据库状态
    if (task.status === "completed" || task.status === "failed") {
      try {
        const supabase = createAdminClient();

        // 获取 generation 记录以获取 user_id 和 duration
        const { data: generation } = await supabase
          .from("generations")
          .select("id, user_id, duration, status, credit_cost")
          .eq("task_id", taskId)
          .eq("user_id", user.id)
          .single();

        // 使用原子操作更新状态（防止并发重复退款）
        if (task.status === "failed" && generation?.status === "processing") {
          // 先尝试原子更新状态
          const { data: updateResult, error: updateError } = await supabase
            .from("generations")
            .update({
              status: "failed",
              error_message: task.errorMessage || null,
            })
            .eq("task_id", taskId)
            .eq("status", "processing") // 乐观锁
            .select()
            .single();

          // 只有成功更新状态的请求才能退款
          if (updateResult && !updateError && generation?.user_id) {
            const refundAmount = generation.credit_cost || (generation.duration ? CREDIT_COST_MAP[generation.duration] : null) || 50;

            await applyTaskCreditDelta({
              supabase,
              userId: generation.user_id,
              entryKind: "refund",
              amount: refundAmount,
              scope: "quick-video",
              taskId: generation.id,
              operation: "refund",
              pricingVersion: "quick-video-refund-v1",
              description: `视频生成失败自动退款 (${taskId})`,
            });

            console.log("[Generate Video] Credits refunded due to failure:", {
              userId: generation.user_id,
              refund: refundAmount,
            });
          } else if (updateError) {
            console.log("[Generate Video] Skipping refund - already processed:", taskId);
          }
        } else if (task.status === "completed" && generation?.status === "processing") {
          // 任务成功完成
          await supabase
            .from("generations")
            .update({
              status: "completed",
              result_url: task.resultUrl || null,
              video_url: task.resultUrl || null,
              completed_at: new Date().toISOString(),
            })
            .eq("task_id", taskId)
            .eq("status", "processing");
        }

        console.log("[Generate Video] Updated generations table:", taskId, task.status, task.resultUrl ? "has URL" : "no URL");
      } catch (dbError) {
        console.error("[Generate Video] Failed to update DB:", dbError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        videoUrl: task.resultUrl,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    });
  } catch (error) {
    console.error("[Generate Video] Query error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
