/**
 * VEO3 批量视频生成（使用高瑞 gaorui-veo-api）
 *
 * POST /api/video-batch/generate-veo-video
 *
 * 三个模型（全部 async, POST /v1/videos）:
 * - veo3-fast  → veo3.1-fast (文生视频 / 首尾帧图生视频)
 * - veo3-std   → veo3.1-fast-components (≤3张参考图URL, application/json)
 * - veo3-4k    → veo3.1-fast-4K (文生视频 / 首尾帧图生视频)
 */

import { NextRequest, NextResponse } from "next/server";
import { submitVeo3Video, type GaoruiVeoModel } from "@/lib/gaorui-veo-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// 所有 VEO3 模型都是异步模式, maxDuration 用于 Next.js route handler 的最大运行时间
export const maxDuration = 600;

// ============================================================================
// 请求/响应类型
// ============================================================================

interface RequestBody {
  aiVideoPrompt: string;
  mainGridImageUrl?: string;       // 参考图（veo3-std components 用）
  characterRefUrl?: string;        // 自建角色参考图 URL
  firstFrameUrl?: string;          // 首帧图片 URL（veo3-fast/veo3-4k 用）
  lastFrameUrl?: string;           // 尾帧图片 URL（veo3-fast/veo3-4k 用，可选）
  aspectRatio: "9:16" | "16:9";
  modelType: "veo3-fast" | "veo3-std" | "veo3-4k";
  taskId: string;
  userId?: string;
  creditCost?: number;
  mode?: "image_to_video" | "prompt_to_video";
  groupName?: string;
}

// 模型映射: VideoModelType → GaoruiVeoModel
const MODEL_MAP: Record<string, GaoruiVeoModel> = {
  "veo3-fast": "veo3.1-fast",
  "veo3-std": "veo_3_1-components",
  "veo3-4k": "veo3.1-fast-4K",
};

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const {
      aiVideoPrompt,
      mainGridImageUrl,
      characterRefUrl,
      firstFrameUrl,
      lastFrameUrl,
      aspectRatio,
      modelType = "veo3-fast",
      taskId,
      userId: requestedUserId,
      creditCost = 0,
      mode = "image_to_video",
      groupName,
    } = body;

    // 身份以登录态为准，忽略请求体伪造的 userId（沿用 models/submit 范式）
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
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

    const isPromptMode = mode === "prompt_to_video";

    // 参数校验
    if (!aiVideoPrompt || aiVideoPrompt.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "请提供 AI 视频提示词" },
        { status: 400 }
      );
    }

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "请提供任务ID" },
        { status: 400 }
      );
    }

    // 获取 gaorui 模型名称
    const gaoruiModel = MODEL_MAP[modelType];
    if (!gaoruiModel) {
      return NextResponse.json(
        { success: false, error: `未知模型类型: ${modelType}` },
        { status: 400 }
      );
    }

    // 验证角色参考图 URL 为 OSS 永久地址
    if (characterRefUrl && !characterRefUrl.includes("media.toryxai.com")) {
      console.warn("[VEO3 Batch] characterRefUrl is not a permanent OSS URL:", characterRefUrl.substring(0, 80));
      return NextResponse.json(
        { success: false, error: "角色参考图地址已过期，请到「我的角色」重新生成参考图" },
        { status: 400 }
      );
    }

    // 构建图片 URL 列表
    // - veo3-std (components): mainGridImageUrl + characterRefUrl (参考图, 最多3张)
    // - veo3-fast / veo3-4k: firstFrameUrl + lastFrameUrl (首尾帧) 或 mainGridImageUrl (兼容)
    const imageUrls: string[] = [];

    if (modelType === "veo3-std") {
      // Components 模型: 参考图模式
      if (mainGridImageUrl) imageUrls.push(mainGridImageUrl);
      if (characterRefUrl) imageUrls.push(characterRefUrl);
    } else {
      // Fast / 4K 模型: 首尾帧模式
      if (firstFrameUrl) {
        imageUrls.push(firstFrameUrl);
        if (lastFrameUrl) imageUrls.push(lastFrameUrl);
      } else if (mainGridImageUrl) {
        // 兼容: 没有首帧但有素材图时，当作首帧使用
        imageUrls.push(mainGridImageUrl);
      }
    }

    console.log("[VEO3 Batch] Submitting VEO3 video:", {
      taskId,
      modelType,
      gaoruiModel,
      aspectRatio,
      promptLength: aiVideoPrompt.length,
      userId: user.id,
      creditCost,
      imageCount: imageUrls.length,
      hasFirstFrame: !!firstFrameUrl,
      hasLastFrame: !!lastFrameUrl,
      mode,
    });

    // 调用统一入口
    const submitResult = await submitVeo3Video({
      prompt: aiVideoPrompt,
      model: gaoruiModel,
      aspectRatio: aspectRatio,
      ...(imageUrls.length > 0 && { imageUrls }),
    });

    if (!submitResult.success) {
      console.error("[VEO3 Batch] VEO3 submit failed:", submitResult.error);
      return NextResponse.json(
        { success: false, error: submitResult.error || "视频提交失败" },
        { status: 500 }
      );
    }

    // 全部为 async 模式: 返回 taskId，前端需要轮询
    const veoTaskId = submitResult.taskId;

    console.log("[VEO3 Batch] VEO3 task submitted (async):", {
      taskId: veoTaskId,
    });

    // 在数据库中创建记录
    try {
      const supabase = createAdminClient();
      const { data: insertedData, error: insertError } = await supabase
        .from("generations")
        .insert({
          user_id: user.id,
          task_id: veoTaskId,
          type: "video",
          source: isPromptMode ? "batch_video_prompt_veo3" : "batch_video_veo3",
          prompt: aiVideoPrompt,
          model: gaoruiModel,
          duration: 8,
          aspect_ratio: aspectRatio,
          quality: modelType === "veo3-4k" ? "4k" : "standard",
          source_image_url: mainGridImageUrl || firstFrameUrl || null,
          status: "processing",
          result_url: null,
          credit_cost: creditCost,
          group_name: groupName || "默认",
          use_pro: modelType === "veo3-4k",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error("[VEO3 Batch] Failed to create DB record:", insertError);
      } else {
        console.log("[VEO3 Batch] Created DB record:", {
          id: insertedData?.id,
          taskId: veoTaskId,
          status: "processing",
        });
      }
    } catch (dbError) {
      console.error("[VEO3 Batch] DB error:", dbError);
    }

    // 返回结果
    return NextResponse.json({
      success: true,
      data: {
        veoTaskId: submitResult.taskId,
        status: "processing",
        syncMode: false,
        message: "VEO3 视频任务已提交，请通过轮询接口查询状态",
      },
    });
  } catch (error) {
    console.error("[VEO3 Batch] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "视频提交失败"
      },
      { status: 500 }
    );
  }
}
