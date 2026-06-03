import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isVideoModelId } from "@/lib/video-models/catalog";
import { refundVideoCreditsOnce } from "@/lib/video-models/credits";
import { getRegisteredVideoModel } from "@/lib/video-models/registry";
import { transferVideoToOss } from "@/lib/video-models/storage";
import { isOSSPermanentUrl } from "@/lib/transfer-veo-to-oss";
import type { Json } from "@/types/database";
import type { VideoAspectRatio, VideoModelId, VideoQuality, VideoModelStatusResult } from "@/lib/video-models/types";

export const maxDuration = 180;
export const dynamic = "force-dynamic";

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function getExistingGeneration(taskId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("generations")
    .select("status, result_url, video_url, user_id, metadata")
    .eq("task_id", taskId)
    .maybeSingle();
  return { supabase, generation: data };
}

async function getCurrentUser() {
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  return user;
}

async function getOwnedGeneration(taskId: string, userId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("generations")
    .select("status, result_url, video_url, user_id, metadata")
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .maybeSingle();

  return { supabase, generation: data };
}

async function persistCompletedVideo(params: {
  modelType: VideoModelId;
  taskId: string;
  model: ReturnType<typeof getRegisteredVideoModel>;
  status: VideoModelStatusResult;
  userId?: string;
  aspectRatio?: VideoAspectRatio;
  durationSeconds?: number;
  quality?: VideoQuality;
}) {
  const { supabase, generation } = await getExistingGeneration(params.taskId);

  const cachedUrl = generation?.result_url || generation?.video_url;
  if (generation?.status === "completed" && cachedUrl && isOSSPermanentUrl(cachedUrl)) {
    return cachedUrl;
  }

  const lock = generation
    ? await supabase
        .from("generations")
        .update({ progress: 99 } as any)
        .eq("task_id", params.taskId)
        .eq("status", "processing")
        .select("user_id, metadata")
        .maybeSingle()
    : { data: null, error: null };

  const lockedGeneration = lock.data || generation;
  const generationUserId = lockedGeneration?.user_id || params.userId;
  let finalVideoUrl: string;
  let completionMetadata: Json | undefined;

  if (params.model.adapter.complete) {
    const completed = await params.model.adapter.complete({
      modelType: params.modelType,
      taskId: params.taskId,
      status: params.status,
      userId: params.userId,
      generationUserId,
      aspectRatio: params.aspectRatio,
      durationSeconds: params.durationSeconds,
      quality: params.quality,
    });
    finalVideoUrl = completed.videoUrl;
    completionMetadata = completed.metadata;
  } else {
    const sourceUrl = params.status.videoUrl || params.status.contentUrl;
    if (!sourceUrl) {
      throw new Error("上游任务已完成但未返回视频地址");
    }
    finalVideoUrl = await transferVideoToOss({
      taskId: params.taskId,
      modelType: params.modelType,
      videoUrl: sourceUrl,
      userId: generationUserId,
      headers: params.status.videoUrl ? undefined : params.status.contentHeaders,
    });
  }

  if (generation) {
    const previousMetadata = asMetadata(lockedGeneration?.metadata || generation.metadata);
    await supabase
      .from("generations")
      .update({
        status: "completed",
        result_url: finalVideoUrl,
        video_url: finalVideoUrl,
        output_url: finalVideoUrl,
        progress: 100,
        completed_at: new Date().toISOString(),
        metadata: {
          ...previousMetadata,
          completion: {
            ...(asMetadata(previousMetadata.completion)),
            oss_url: finalVideoUrl,
            adapter: completionMetadata || {},
          },
        },
      } as any)
      .eq("task_id", params.taskId);
  }

  return finalVideoUrl;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const rawModelType = searchParams.get("modelType") || "";
    const taskId = searchParams.get("taskId") || "";
    const aspectRatio = (searchParams.get("aspectRatio") || undefined) as VideoAspectRatio | undefined;
    const durationSeconds = searchParams.get("durationSeconds")
      ? Number(searchParams.get("durationSeconds"))
      : undefined;
    const quality = (searchParams.get("quality") || undefined) as VideoQuality | undefined;

    if (!isVideoModelId(rawModelType)) {
      return NextResponse.json(
        { success: false, error: `无效的视频模型: ${rawModelType}` },
        { status: 400 }
      );
    }
    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "用户未登录" },
        { status: 401 }
      );
    }

    const owned = await getOwnedGeneration(taskId, user.id);
    if (!owned.generation) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权查看" },
        { status: 404 }
      );
    }

    const modelType = rawModelType;
    const model = getRegisteredVideoModel(modelType);
    const status = await model.adapter.status({
      modelType,
      taskId,
      aspectRatio,
      durationSeconds,
      quality,
    });

    if (status.status === "failed") {
      const refund = await refundVideoCreditsOnce({
        supabase: owned.supabase,
        taskId,
        modelType,
        reason: status.errorMessage || "视频生成失败",
      });

      return NextResponse.json({
        success: true,
        data: {
          taskId,
          modelType,
          status: "failed",
          progress: 0,
          videoUrl: null,
          errorMessage: status.errorMessage || "视频生成失败",
          refundNote: refund.refunded ? "积分已自动退还到您的账户" : undefined,
        },
      });
    }

    if (status.status === "completed") {
      const finalVideoUrl = await persistCompletedVideo({
        modelType,
        taskId,
        model,
        status,
        userId: user.id,
        aspectRatio,
        durationSeconds,
        quality,
      });

      return NextResponse.json({
        success: true,
        data: {
          taskId,
          modelType,
          status: "completed",
          progress: 100,
          videoUrl: finalVideoUrl,
          errorMessage: null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId,
        modelType,
        status: "processing",
        progress: status.progress ?? 50,
        videoUrl: null,
        errorMessage: null,
      },
    });
  } catch (error) {
    console.error("[Video Models Status] Error:", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "查询状态失败",
      },
      { status: 500 }
    );
  }
}
