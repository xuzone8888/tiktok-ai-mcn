/**
 * VEO3 批量视频生成（使用高瑞 gaorui-veo-api）
 *
 * POST /api/video-batch/generate-veo-video
 *
 * 三个模型（全部 async, POST /v1/videos, multipart/form-data）:
 * - veo3-fast  → veo3.1-fast (纯提示词)
 * - veo3-std   → veo_3_1-components (≤3张参考图URL)
 * - veo3-4k    → veo3.1-fast-4K (≤2张参考图)
 */

import { NextRequest, NextResponse } from "next/server";
import { submitVeo3Video, type GaoruiVeoModel } from "@/lib/gaorui-veo-api";
import { createAdminClient } from "@/lib/supabase/admin";

// 所有 VEO3 模型都是异步模式, maxDuration 用于 Next.js route handler 的最大运行时间
export const maxDuration = 600;

// ============================================================================
// 请求/响应类型
// ============================================================================

interface RequestBody {
  aiVideoPrompt: string;
  mainGridImageUrl?: string;       // 参考图（veo3-std/veo3-4k 用）
  characterRefUrl?: string;        // 自建角色参考图 URL
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
      aspectRatio,
      modelType = "veo3-fast",
      taskId,
      userId,
      creditCost = 0,
      mode = "image_to_video",
      groupName,
    } = body;

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

    // 构建图片 URL 列表
    const imageUrls: string[] = [];
    if (mainGridImageUrl) imageUrls.push(mainGridImageUrl);
    if (characterRefUrl) imageUrls.push(characterRefUrl);

    // veo3-fast 不支持参考图
    const finalImageUrls = modelType === "veo3-fast" ? [] : imageUrls;

    console.log("[VEO3 Batch] Submitting VEO3 video:", {
      taskId,
      modelType,
      gaoruiModel,
      aspectRatio,
      promptLength: aiVideoPrompt.length,
      userId: userId || "(not provided)",
      creditCost,
      imageCount: finalImageUrls.length,
      mode,
    });

    // 调用统一入口
    const submitResult = await submitVeo3Video({
      prompt: aiVideoPrompt,
      model: gaoruiModel,
      aspectRatio: aspectRatio,
      ...(finalImageUrls.length > 0 && { imageUrls: finalImageUrls }),
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
    if (userId) {
      try {
        const supabase = createAdminClient();
        const { data: insertedData, error: insertError } = await supabase
          .from("generations")
          .insert({
            user_id: userId,
            task_id: veoTaskId,
            type: "video",
            source: isPromptMode ? "batch_video_prompt_veo3" : "batch_video_veo3",
            prompt: aiVideoPrompt,
            model: gaoruiModel,
            duration: 8,
            aspect_ratio: aspectRatio,
            quality: modelType === "veo3-4k" ? "4k" : "standard",
            source_image_url: mainGridImageUrl || null,
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
