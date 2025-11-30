// ============================================================================
// TikTok AI MCN - 视频生成 API
// ============================================================================

import { NextResponse } from "next/server";
import type { TaskStatus, VideoDuration, AspectRatio } from "@/types/database";
import { assemblePrompt, validateUserPrompt } from "@/lib/prompt-assembler";

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
// 全局任务存储（模拟数据库）
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
// Mock 用户积分
// ============================================================================

let mockUserCredits = 5000;

export function getUserCredits(): number {
  return mockUserCredits;
}

export function deductCredits(amount: number): boolean {
  if (mockUserCredits >= amount) {
    mockUserCredits -= amount;
    return true;
  }
  return false;
}

export function refundCredits(amount: number): void {
  mockUserCredits += amount;
}

// ============================================================================
// 模拟任务处理
// ============================================================================

function simulateTaskProcessing(taskId: string, duration: VideoDuration) {
  const task = taskStore.get(taskId);
  if (!task) return;

  // 根据时长计算模拟生成时间
  const durationMs = parseInt(duration) * 1000;
  const totalSteps = 20;
  let currentStep = 0;

  const interval = setInterval(() => {
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

    // 完成
    if (currentStep >= totalSteps) {
      clearInterval(interval);
      
      // 90% 成功率
      const isSuccess = Math.random() > 0.1;
      
      if (isSuccess) {
        // Mock 输出 URL
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
        const credits = DURATION_CREDITS[duration];
        refundCredits(credits);
        
        taskStore.set(taskId, {
          ...currentTask,
          status: "failed",
          progress: 0,
          error_message: "Generation failed. Credits refunded.",
          completed_at: new Date().toISOString(),
        });
      }
    }
  }, durationMs / totalSteps);
}

// ============================================================================
// POST - 创建生成任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const body: GenerateRequest = await request.json();
    const { taskId, imageUrl, prompt, duration, aspectRatio, isAutoDownload, modelId } = body;

    // ============================================
    // 【修改】验证参数 - 支持纯文本生成
    // Prompt 或 Image 至少有一个
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
    // 【核心逻辑】组装最终 Prompt (注入唤醒词)
    // ============================================
    
    // 1. 验证用户输入的 Prompt
    const validation = validateUserPrompt(prompt || "");
    if (validation.warnings.length > 0) {
      console.log("[Generate API] Prompt validation warnings:", validation.warnings);
    }
    
    // 2. 组装最终 Prompt (自动注入模特唤醒词)
    const promptResult = await assemblePrompt({
      user_prompt: validation.sanitizedPrompt,
      model_id: modelId,
      source_image_url: imageUrl,
    });
    
    const finalPrompt = promptResult.final_prompt;
    
    console.log("[Generate API] Prompt Assembly:", {
      has_user_prompt: hasPrompt,
      has_image: hasImage,
      model_id: modelId,
      model_used: promptResult.model_used,
      trigger_word_injected: promptResult.trigger_word_injected,
      // 安全：不输出完整的 finalPrompt
    });

    // 计算积分消耗
    const credits = DURATION_CREDITS[duration] || 50;

    // 检查并扣除积分
    if (!deductCredits(credits)) {
      return NextResponse.json(
        { success: false, error: "Insufficient credits" },
        { status: 400 }
      );
    }

    // 创建任务记录 (存储原始用户输入)
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

    // 启动模拟处理 (使用注入唤醒词后的 Prompt)
    setTimeout(() => {
      const currentTask = taskStore.get(taskId);
      if (currentTask && currentTask.status === "queued") {
        taskStore.set(taskId, { ...currentTask, status: "processing" });
        simulateTaskProcessing(taskId, duration);
      }
    }, 500);

    return NextResponse.json({
      success: true,
      data: {
        taskId,
        status: "queued",
        credits_deducted: credits,
        credits_remaining: getUserCredits(),
        model_used: promptResult.model_used,
        trigger_word_injected: promptResult.trigger_word_injected,
      },
    });
  } catch (error) {
    console.error("Error creating generation task:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create generation task" },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - 取消任务
// ============================================================================

export async function DELETE(request: Request) {
  try {
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
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    // 只能取消排队中或处理中的任务
    if (task.status !== "queued" && task.status !== "processing") {
      return NextResponse.json(
        { success: false, error: "Task cannot be cancelled" },
        { status: 400 }
      );
    }

    // 标记为失败并退还积分
    // 这里简化处理，实际应该根据任务参数计算
    refundCredits(50);

    taskStore.set(taskId, {
      ...task,
      status: "failed",
      error_message: "Cancelled by user",
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: "Task cancelled",
      credits_refunded: 50,
    });
  } catch (error) {
    console.error("Error cancelling task:", error);
    return NextResponse.json(
      { success: false, error: "Failed to cancel task" },
      { status: 500 }
    );
  }
}

