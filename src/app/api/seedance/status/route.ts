/**
 * Seedance 2.0 视频生成 - 查询任务状态
 * 
 * GET /api/seedance/status?taskId=cgt-xxx&model=seedance-5s
 * 
 * 流程:
 * 1. 查询火山方舟任务状态
 * 2. 如果 succeeded:
 *    - 480p 模式 → 下载 + FFmpeg 超分 + 上传 OSS
 *    - 720p 模式 → 直接下载 + 上传 OSS
 * 3. 更新 generations 表状态
 * 4. 如果 failed → 原子退款 + credit_transactions 记录
 */

import { NextResponse } from "next/server";
import { querySeedanceTask, needsUpscaling } from "@/lib/seedance-api";
import { upscaleVideo, getUpscaleTarget } from "@/lib/video-upscale";
import { uploadVideoBuffer, generateMediaPath, getPublicUrl } from "@/lib/oss";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const model = searchParams.get("model") || "seedance-5s";
    const ratio = (searchParams.get("ratio") || "9:16") as "9:16" | "16:9";

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    console.log("[Seedance Status] Querying:", { taskId, model, ratio });

    // ============================================
    // 查询火山方舟任务状态
    // ============================================
    const result = await querySeedanceTask(taskId);

    if (result.status === 'failed') {
      // 任务失败 → 原子退款
      await handleTaskFailure(taskId, result.error);

      return NextResponse.json({
        success: true,
        data: {
          taskId,
          status: "failed",
          errorMessage: result.error || "视频生成失败",
        },
      });
    }

    if (result.status === 'succeeded' && result.videoUrl) {
      // 任务成功 → 处理视频（超分/直传）
      const finalUrl = await processCompletedVideo(
        taskId,
        result.videoUrl,
        model,
        ratio
      );

      // 更新 generations 表
      await updateGenerationCompleted(taskId, finalUrl);

      return NextResponse.json({
        success: true,
        data: {
          taskId,
          status: "completed",
          videoUrl: finalUrl,
          tokens: result.tokens,
        },
      });
    }

    // 进行中
    return NextResponse.json({
      success: true,
      data: {
        taskId,
        status: result.status === 'queued' ? 'processing' : 'processing',
      },
    });

  } catch (error) {
    console.error("[Seedance Status] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// 视频后处理
// ============================================================================

/**
 * 处理已完成的视频
 * - 480p 模型：下载 → FFmpeg 超分 → 上传 OSS
 * - 720p 模型：下载 → 直接上传 OSS
 */
async function processCompletedVideo(
  taskId: string,
  sourceVideoUrl: string,
  model: string,
  ratio: '9:16' | '16:9'
): Promise<string> {
  
  console.log("[Seedance Status] Processing video:", { taskId, model, ratio, needsUpscaling: needsUpscaling(model) });

  // 获取 userId（从 generations 表）
  const supabase = createAdminClient();
  const { data: generation } = await supabase
    .from("generations")
    .select("user_id")
    .eq("task_id", taskId)
    .single();

  const userId = generation?.user_id || "unknown";

  // 下载源视频
  console.log("[Seedance Status] Downloading source video...");
  const videoResponse = await fetch(sourceVideoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download video: ${videoResponse.status}`);
  }
  
  const videoArrayBuffer = await videoResponse.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let videoBuffer: any = Buffer.from(new Uint8Array(videoArrayBuffer));

  // 480p 模型需要超分
  if (needsUpscaling(model)) {
    const target = getUpscaleTarget(ratio);
    console.log("[Seedance Status] Starting FFmpeg upscale:", target);

    const upscaleResult = await upscaleVideo({
      inputBuffer: videoBuffer,
      targetWidth: target.width,
      targetHeight: target.height,
      taskId,
    });

    if (upscaleResult.success) {
      videoBuffer = upscaleResult.outputBuffer;
      console.log("[Seedance Status] Upscale succeeded, size:", videoBuffer.length);
    } else {
      // 超分失败：降级使用原始 480p（不阻断流程）
      console.warn("[Seedance Status] Upscale failed, using original 480p:", upscaleResult.error);
    }
  }

  // 上传到 OSS
  const ossPath = generateMediaPath('quick-gen', userId, `seedance-${taskId}.mp4`);
  console.log("[Seedance Status] Uploading to OSS:", ossPath);

  const ossUrl = await uploadVideoBuffer(videoBuffer, ossPath, 'video/mp4');
  console.log("[Seedance Status] OSS upload complete:", ossUrl);

  return ossUrl;
}

// ============================================================================
// 数据库操作
// ============================================================================

/**
 * 更新 generations 表为已完成
 */
async function updateGenerationCompleted(taskId: string, videoUrl: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase
      .from("generations")
      .update({
        status: "completed",
        result_url: videoUrl,
        video_url: videoUrl,
        completed_at: new Date().toISOString(),
      })
      .eq("task_id", taskId)
      .eq("status", "processing"); // 乐观锁

    console.log("[Seedance Status] Generation updated to completed:", taskId);
  } catch (error) {
    console.error("[Seedance Status] Failed to update generation:", error);
  }
}

/**
 * 处理任务失败：原子退款 + 记录流水
 * 使用乐观锁防止并发重复退款
 */
async function handleTaskFailure(taskId: string, errorMessage?: string): Promise<void> {
  try {
    const supabase = createAdminClient();

    // 查询 generation 记录
    const { data: generation } = await supabase
      .from("generations")
      .select("user_id, status, credit_cost")
      .eq("task_id", taskId)
      .single();

    if (!generation || generation.status !== "processing") {
      console.log("[Seedance Status] Skip refund - already processed:", taskId);
      return;
    }

    // 原子更新状态（乐观锁）
    const { data: updateResult, error: updateError } = await supabase
      .from("generations")
      .update({
        status: "failed",
        error_message: errorMessage || "生成失败",
      })
      .eq("task_id", taskId)
      .eq("status", "processing") // 乐观锁
      .select()
      .single();

    if (!updateResult || updateError) {
      console.log("[Seedance Status] Skip refund - concurrent update:", taskId);
      return;
    }

    // 退还积分
    const refundAmount = generation.credit_cost || 233; // 默认最低积分
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", generation.user_id)
      .single();

    if (profile) {
      await supabase
        .from("profiles")
        .update({ credits: profile.credits + refundAmount })
        .eq("id", generation.user_id);

      // 记录退款流水
      await supabase.from("credit_transactions").insert({
        user_id: generation.user_id,
        amount: refundAmount,
        type: "refund",
        description: `Seedance 2.0 生成失败自动退款 (${taskId})`,
        balance_before: profile.credits,
        balance_after: profile.credits + refundAmount,
      });

      console.log("[Seedance Status] Credits refunded:", {
        userId: generation.user_id,
        refund: refundAmount,
      });
    }
  } catch (error) {
    console.error("[Seedance Status] Refund error:", error);
  }
}
