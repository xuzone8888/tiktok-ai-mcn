/**
 * HappyHorse text-to-video generation through Alibaba Cloud DashScope.
 *
 * POST /api/video-batch/generate-happyhorse-video
 */

import { NextRequest, NextResponse } from "next/server";
import { submitHappyHorseVideo } from "@/lib/dashscope-video-api";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const HAPPYHORSE_SUPPORTED_DURATIONS = [5, 12] as const;
type HappyHorseDuration = (typeof HAPPYHORSE_SUPPORTED_DURATIONS)[number];

interface RequestBody {
  aiVideoPrompt: string;
  aspectRatio: "9:16" | "16:9";
  durationSeconds?: number;
  imageUrls?: string[];
  taskId: string;
  userId?: string;
  creditCost?: number;
  mode?: "image_to_video" | "prompt_to_video";
  groupName?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const {
      aiVideoPrompt,
      aspectRatio = "16:9",
      durationSeconds = 5,
      imageUrls = [],
      taskId,
      userId,
      creditCost = 0,
      mode = "prompt_to_video",
      groupName,
    } = body;

    if (!aiVideoPrompt || aiVideoPrompt.trim().length < 3) {
      return NextResponse.json(
        { success: false, error: "请提供至少 3 个字符的视频提示词" },
        { status: 400 }
      );
    }

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "请提供任务 ID" },
        { status: 400 }
      );
    }

    if (!HAPPYHORSE_SUPPORTED_DURATIONS.includes(durationSeconds as HappyHorseDuration)) {
      return NextResponse.json(
        { success: false, error: "HappyHorse 当前仅支持 5 秒或 12 秒视频" },
        { status: 400 }
      );
    }

    const happyHorseDuration = durationSeconds as HappyHorseDuration;
    const referenceImageUrls = Array.from(new Set(
      imageUrls
        .filter((url): url is string => typeof url === "string")
        .map((url) => url.trim())
        .filter((url) => url.startsWith("http://") || url.startsWith("https://"))
    )).slice(0, 9);
    if (Array.isArray(imageUrls) && imageUrls.length > 9) {
      return NextResponse.json(
        { success: false, error: "HappyHorse 参考图最多支持 9 张" },
        { status: 400 }
      );
    }

    console.log("[HappyHorse Batch] Submitting video:", {
      taskId,
      aspectRatio,
      durationSeconds,
      referenceImageCount: referenceImageUrls.length,
      userId: userId || "(not provided)",
      creditCost,
      promptLength: aiVideoPrompt.length,
    });

    const submitResult = await submitHappyHorseVideo({
      prompt: aiVideoPrompt.trim(),
      ratio: aspectRatio,
      duration: happyHorseDuration,
      resolution: "720P",
      imageUrls: referenceImageUrls,
    });

    if (!submitResult.success || !submitResult.taskId) {
      return NextResponse.json(
        { success: false, error: submitResult.error || "HappyHorse 视频提交失败" },
        { status: 500 }
      );
    }

    const happyHorseTaskId = submitResult.taskId;

    if (userId) {
      try {
        const supabase = createAdminClient();
        const { error: insertError } = await supabase.from("generations").insert({
          user_id: userId,
          task_id: happyHorseTaskId,
          type: "video",
          source: mode === "prompt_to_video" ? "batch_video_prompt_happyhorse" : "batch_video_happyhorse",
          prompt: aiVideoPrompt.trim(),
          model: submitResult.model || "happyhorse-1.0-t2v",
          duration: happyHorseDuration,
          aspect_ratio: aspectRatio,
          quality: "standard",
          source_image_url: referenceImageUrls[0] || null,
          status: "processing",
          result_url: null,
          video_url: null,
          credit_cost: creditCost,
          group_name: groupName || "默认",
          use_pro: false,
          metadata: {
            provider: "dashscope",
            request_id: submitResult.requestId,
            resolution: "720P",
            reference_image_urls: referenceImageUrls,
            reference_image_count: referenceImageUrls.length,
          },
          created_at: new Date().toISOString(),
        });

        if (insertError) {
          console.error("[HappyHorse Batch] Failed to create DB record:", insertError);
        }
      } catch (dbError) {
        console.error("[HappyHorse Batch] DB error:", dbError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        happyHorseTaskId,
        status: "processing",
        message: "HappyHorse 视频任务已提交，请通过轮询接口查询状态",
      },
    });
  } catch (error) {
    console.error("[HappyHorse Batch] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "HappyHorse 视频提交失败",
      },
      { status: 500 }
    );
  }
}
