/**
 * Grok Imagine 批量视频生成
 *
 * POST /api/video-batch/generate-grok-video
 *
 * 速创 wuyinkeji API:
 *   提交: POST /api/async/video_grok_imagine
 *   查询: GET  /api/async/detail?key=...&id=...
 */

import { NextRequest, NextResponse } from "next/server";
import { submitGrokImagine } from "@/lib/grok-imagine-api";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

interface RequestBody {
  aiVideoPrompt: string;
  mainGridImageUrl?: string;
  aspectRatio: "9:16" | "16:9";
  durationSeconds?: number;
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
      mainGridImageUrl,
      aspectRatio = "9:16",
      durationSeconds = 10,
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

    // 时长映射（只允许 10/15）
    const duration = (durationSeconds === 15 ? 15 : 10) as 10 | 15;

    // 构建参考图数组
    const imageUrls: string[] = [];
    if (mainGridImageUrl) imageUrls.push(mainGridImageUrl);

    console.log("[Grok Batch] Submitting Grok Imagine video:", {
      taskId,
      duration,
      aspectRatio,
      promptLength: aiVideoPrompt.length,
      userId: userId || "(not provided)",
      creditCost,
      imageCount: imageUrls.length,
      mode,
    });

    // 调用 Grok Imagine API
    const submitResult = await submitGrokImagine({
      prompt: aiVideoPrompt,
      duration,
      aspectRatio,
      ...(imageUrls.length > 0 && { imageUrls }),
    });

    if (!submitResult.success) {
      console.error("[Grok Batch] Submit failed:", submitResult.error);
      return NextResponse.json(
        { success: false, error: submitResult.error || "视频提交失败" },
        { status: 500 }
      );
    }

    const grokTaskId = submitResult.taskId;

    console.log("[Grok Batch] Task submitted:", { grokTaskId });

    // 数据库记录
    if (userId) {
      try {
        const supabase = createAdminClient();
        const { error: insertError } = await supabase
          .from("generations")
          .insert({
            user_id: userId,
            task_id: grokTaskId,
            type: "video",
            source: isPromptMode ? "batch_video_prompt_grok" : "batch_video_grok",
            prompt: aiVideoPrompt,
            model: "grok_imagine",
            duration,
            aspect_ratio: aspectRatio,
            quality: "standard",
            source_image_url: mainGridImageUrl || null,
            status: "processing",
            result_url: null,
            credit_cost: creditCost,
            group_name: groupName || "默认",
            use_pro: false,
            created_at: new Date().toISOString(),
          });

        if (insertError) {
          console.error("[Grok Batch] Failed to create DB record:", insertError);
        }
      } catch (dbError) {
        console.error("[Grok Batch] DB error:", dbError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        grokTaskId,
        status: "processing",
        syncMode: false,
        message: "Grok Imagine 视频任务已提交，请通过轮询接口查询状态",
      },
    });
  } catch (error) {
    console.error("[Grok Batch] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "视频提交失败"
      },
      { status: 500 }
    );
  }
}
