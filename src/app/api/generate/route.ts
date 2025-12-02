// ============================================================================
// TikTok AI MCN - 视频生成 API
// ============================================================================

import { NextResponse } from "next/server";
import type { TaskStatus, VideoDuration, AspectRatio } from "@/types/database";
import { assemblePrompt, validateUserPrompt } from "@/lib/prompt-assembler";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// 类型定义
// ============================================================================

interface GenerateRequest {
  taskId: string;
  imageUrl?: string | null;        // 参考图片 URL (可选，支持纯文本生成)
  prompt: string;
  duration: VideoDuration;
  aspectRatio: AspectRatio;
  isAutoDownload?: boolean;
  modelId?: string | null;          // AI 模特 ID (用于唤醒词注入)
}

interface TaskRecord {
  id: string;
  status: TaskStatus;
  progress: number;
  output_url: string | null;
  thumbnail_url: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  is_auto_download: boolean;
}

// ============================================================================
// 内存任务存储（用于实时状态更新）
// ============================================================================

const taskStore = new Map<string, TaskRecord>();

// 导出供状态查询 API 使用
export function getTaskFromStore(taskId: string): TaskRecord | undefined {
  return taskStore.get(taskId);
}

// ============================================================================
// 积分定价
// ============================================================================

const DURATION_CREDITS: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

// ============================================================================
// POST - 创建生成任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    const body: GenerateRequest = await request.json();
    const { taskId, imageUrl, prompt, duration, aspectRatio, isAutoDownload, modelId } = body;

    // ============================================
    // 验证参数 - 支持纯文本生成
    // ============================================
    if (!taskId || !duration) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: taskId, duration" },
        { status: 400 }
      );
    }

    const hasPrompt = prompt && prompt.trim().length > 0;
    const hasImage = imageUrl && imageUrl.trim().length > 0;

    if (!hasPrompt && !hasImage) {
      return NextResponse.json(
        { success: false, error: "Either prompt or image is required" },
        { status: 400 }
      );
    }

    // ============================================
    // 获取用户积分
    // ============================================
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { success: false, error: "用户不存在" },
        { status: 404 }
      );
    }

    // 计算积分消耗
    const credits = DURATION_CREDITS[duration] || 50;

    // 检查积分
    if (profile.credits < credits) {
      return NextResponse.json(
        { success: false, error: "积分不足" },
        { status: 400 }
      );
    }

    // ============================================
    // 组装最终 Prompt (注入唤醒词)
    // ============================================
    
    const validation = validateUserPrompt(prompt || "");
    if (validation.warnings.length > 0) {
      console.log("[Generate API] Prompt validation warnings:", validation.warnings);
    }
    
    const promptResult = await assemblePrompt({
      user_prompt: validation.sanitizedPrompt,
      model_id: modelId,
      source_image_url: imageUrl,
    });
    
    console.log("[Generate API] Prompt Assembly:", {
      has_user_prompt: hasPrompt,
      has_image: hasImage,
      model_id: modelId,
      model_used: promptResult.model_used,
      trigger_word_injected: promptResult.trigger_word_injected,
    });

    // ============================================
    // 扣除积分
    // ============================================
    const adminSupabase = createAdminClient();
    const { error: deductError } = await adminSupabase
      .from("profiles")
      .update({ credits: profile.credits - credits })
      .eq("id", user.id);

    if (deductError) {
      console.error("[Generate API] Failed to deduct credits:", deductError);
      return NextResponse.json(
        { success: false, error: "扣除积分失败" },
        { status: 500 }
      );
    }

    // 创建任务记录
    const task: TaskRecord = {
      id: taskId,
      status: "queued",
      progress: 0,
      output_url: null,
      thumbnail_url: null,
      error_message: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      is_auto_download: isAutoDownload || false,
    };

    taskStore.set(taskId, task);

    // 启动处理
    setTimeout(() => {
      const currentTask = taskStore.get(taskId);
      if (currentTask && currentTask.status === "queued") {
        taskStore.set(taskId, { ...currentTask, status: "processing" });
        // 实际生产中这里会调用真实的视频生成 API
        simulateTaskProcessing(taskId, duration, user.id, credits);
      }
    }, 500);

    return NextResponse.json({
      success: true,
      data: {
        taskId,
        status: "queued",
        credits_deducted: credits,
        credits_remaining: profile.credits - credits,
        model_used: promptResult.model_used,
        trigger_word_injected: promptResult.trigger_word_injected,
      },
    });
  } catch (error) {
    console.error("Error creating generation task:", error);
    return NextResponse.json(
      { success: false, error: "创建任务失败" },
      { status: 500 }
    );
  }
}

// ============================================================================
// 模拟任务处理（实际生产中替换为真实 API 调用）
// ============================================================================

async function simulateTaskProcessing(
  taskId: string, 
  duration: VideoDuration, 
  userId: string, 
  credits: number
) {
  const task = taskStore.get(taskId);
  if (!task) return;

  const durationMs = parseInt(duration) * 1000;
  const totalSteps = 20;
  let currentStep = 0;

  const interval = setInterval(async () => {
    const currentTask = taskStore.get(taskId);
    if (!currentTask || currentTask.status === "failed") {
      clearInterval(interval);
      return;
    }

    currentStep++;
    const progress = Math.min(Math.round((currentStep / totalSteps) * 100), 99);

    taskStore.set(taskId, {
      ...currentTask,
      status: "processing",
      progress,
    });

    if (currentStep >= totalSteps) {
      clearInterval(interval);
      
      // 90% 成功率
      const isSuccess = Math.random() > 0.1;
      
      if (isSuccess) {
        const outputUrls = [
          "https://www.w3schools.com/html/mov_bbb.mp4",
          "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4",
        ];
        const thumbnailUrls = [
          "https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&h=711&fit=crop",
          "https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&h=711&fit=crop",
        ];

        taskStore.set(taskId, {
          ...currentTask,
          status: "completed",
          progress: 100,
          output_url: outputUrls[Math.floor(Math.random() * outputUrls.length)],
          thumbnail_url: thumbnailUrls[Math.floor(Math.random() * thumbnailUrls.length)],
          completed_at: new Date().toISOString(),
        });
      } else {
        // 失败 - 退还积分
        const adminSupabase = createAdminClient();
        const { data: profile } = await adminSupabase
          .from("profiles")
          .select("credits")
          .eq("id", userId)
          .single();

        if (profile) {
          await adminSupabase
            .from("profiles")
            .update({ credits: profile.credits + credits })
            .eq("id", userId);
        }
        
        taskStore.set(taskId, {
          ...currentTask,
          status: "failed",
          progress: 0,
          error_message: "生成失败，积分已退还",
          completed_at: new Date().toISOString(),
        });
      }
    }
  }, durationMs / totalSteps);
}

// ============================================================================
// DELETE - 取消任务
// ============================================================================

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "Task ID required" },
        { status: 400 }
      );
    }

    const task = taskStore.get(taskId);
    if (!task) {
      return NextResponse.json(
        { success: false, error: "任务不存在" },
        { status: 404 }
      );
    }

    // 只能取消排队中或处理中的任务
    if (task.status !== "queued" && task.status !== "processing") {
      return NextResponse.json(
        { success: false, error: "任务无法取消" },
        { status: 400 }
      );
    }

    // 退还积分
    const refundCredits = 50;
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profile) {
      const adminSupabase = createAdminClient();
      await adminSupabase
        .from("profiles")
        .update({ credits: profile.credits + refundCredits })
        .eq("id", user.id);
    }

    taskStore.set(taskId, {
      ...task,
      status: "failed",
      error_message: "用户取消",
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: "任务已取消",
      credits_refunded: refundCredits,
    });
  } catch (error) {
    console.error("Error cancelling task:", error);
    return NextResponse.json(
      { success: false, error: "取消任务失败" },
      { status: 500 }
    );
  }
}
