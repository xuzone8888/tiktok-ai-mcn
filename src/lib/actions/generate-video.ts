"use server";

/**
 * 视频生成 Server Action
 * 
 * 核心功能：
 * - 接收前端传来的 prompt 和 model_id
 * - 在后端查询数据库获取 trigger_word (用户不可见)
 * - 组装最终 Prompt 并发送给 Sora API
 * - 记录调试日志（不暴露给前端）
 * 
 * ⚠️ 安全注意：
 * - trigger_word 绝对不能返回给前端
 * - 日志中不输出完整的 finalPrompt
 */

import { assemblePrompt, validateUserPrompt } from "@/lib/prompt-assembler";

// ============================================================================
// 类型定义
// ============================================================================

export type VideoDuration = "5s" | "10s" | "15s" | "20s";
export type AspectRatio = "9:16" | "16:9" | "1:1";

export interface GenerateVideoInput {
  prompt: string;
  duration: VideoDuration;
  aspectRatio: AspectRatio;
  modelId?: string | null;        // AI 模特 ID (用于唤醒词注入)
  sourceImageUrl?: string | null; // 参考图片 URL (图生视频模式)
  isAutoDownload?: boolean;
}

export interface GenerateVideoResult {
  success: boolean;
  taskId?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  modelUsed?: boolean;
  triggerWordInjected?: boolean;  // 告知前端是否使用了模特（但不暴露具体 trigger_word）
  error?: string;
}

// ============================================================================
// 积分定价配置
// ============================================================================

const DURATION_CREDITS: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

// ============================================================================
// Mock 用户积分存储
// ============================================================================

let mockUserCredits = 5000;

function getUserCredits(): number {
  return mockUserCredits;
}

function deductCredits(amount: number): boolean {
  if (mockUserCredits >= amount) {
    mockUserCredits -= amount;
    return true;
  }
  return false;
}

function refundCredits(amount: number): void {
  mockUserCredits += amount;
}

// ============================================================================
// Mock 任务存储
// ============================================================================

interface TaskRecord {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  // 存储原始用户输入（不存储注入后的 Prompt）
  userPrompt: string;
  modelId: string | null;
  // 内部标记（不暴露给前端）
  _finalPrompt?: string;
  _triggerWord?: string;
}

const taskStore = new Map<string, TaskRecord>();

// ============================================================================
// 核心函数：生成视频
// ============================================================================

/**
 * 生成视频 Server Action
 * 
 * 处理流程：
 * 1. 验证输入参数
 * 2. 检查 model_id → 查询 trigger_word
 * 3. 组装最终 Prompt (注入 trigger_word)
 * 4. 扣除积分
 * 5. 创建任务并调用 Sora API
 * 6. 返回任务状态（不包含敏感信息）
 */
export async function generateVideo(
  input: GenerateVideoInput
): Promise<GenerateVideoResult> {
  const { prompt, duration, aspectRatio, modelId, sourceImageUrl, isAutoDownload } = input;

  // ============================================
  // Step 1: 参数验证
  // ============================================
  
  const hasPrompt = prompt && prompt.trim().length > 0;
  const hasImage = sourceImageUrl && sourceImageUrl.trim().length > 0;

  // Prompt 或 Image 至少有一个
  if (!hasPrompt && !hasImage) {
    return {
      success: false,
      error: "Either prompt or image is required for video generation",
    };
  }

  if (!duration) {
    return {
      success: false,
      error: "Video duration is required",
    };
  }

  // ============================================
  // Step 2: 验证用户 Prompt 安全性
  // ============================================
  
  const validation = validateUserPrompt(prompt || "");
  
  if (validation.warnings.length > 0) {
    // 记录警告但不阻止生成
    console.log("[Generate Video] Prompt validation warnings:", {
      warnings: validation.warnings,
      // 安全：不输出原始 prompt
    });
  }

  // ============================================
  // Step 3: 组装最终 Prompt (核心逻辑 - 注入 Trigger Word)
  // ============================================
  
  const promptResult = await assemblePrompt({
    user_prompt: validation.sanitizedPrompt,
    model_id: modelId,
    source_image_url: sourceImageUrl,
  });

  const finalPrompt = promptResult.final_prompt;

  // ============================================
  // Step 4: 日志记录（调试用，不暴露完整 Prompt）
  // ============================================
  
  console.log("[Generate Video] Prompt Assembly Complete:", {
    has_user_prompt: hasPrompt,
    has_source_image: hasImage,
    model_id: modelId || "(none)",
    model_used: promptResult.model_used,
    trigger_word_injected: promptResult.trigger_word_injected,
    duration,
    aspect_ratio: aspectRatio,
    // 安全：只输出 Prompt 的前30个字符预览
    final_prompt_preview: `${finalPrompt.substring(0, 30)}...[HIDDEN]`,
    // ⚠️ 生产环境不要输出以下内容：
    // final_prompt: finalPrompt,  // NEVER LOG THIS
  });

  // ============================================
  // Step 5: 计算并扣除积分
  // ============================================
  
  const creditsRequired = DURATION_CREDITS[duration] || 50;
  const currentCredits = getUserCredits();

  if (currentCredits < creditsRequired) {
    return {
      success: false,
      error: `Insufficient credits. Required: ${creditsRequired}, Available: ${currentCredits}`,
    };
  }

  if (!deductCredits(creditsRequired)) {
    return {
      success: false,
      error: "Failed to deduct credits",
    };
  }

  // ============================================
  // Step 6: 创建任务记录
  // ============================================
  
  const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  
  const task: TaskRecord = {
    id: taskId,
    status: "queued",
    progress: 0,
    outputUrl: null,
    thumbnailUrl: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    // 存储原始用户输入（用于历史记录展示）
    userPrompt: prompt || "",
    modelId: modelId || null,
    // 内部标记（仅后端使用，不返回给前端）
    _finalPrompt: finalPrompt,
  };

  taskStore.set(taskId, task);

  // ============================================
  // Step 7: 调用 Sora API (模拟)
  // ============================================
  
  // 启动异步处理
  processVideoGeneration(taskId, finalPrompt, duration, creditsRequired);

  // ============================================
  // Step 8: 返回结果（不包含敏感信息）
  // ============================================
  
  return {
    success: true,
    taskId,
    creditsUsed: creditsRequired,
    creditsRemaining: getUserCredits(),
    modelUsed: promptResult.model_used,
    triggerWordInjected: promptResult.trigger_word_injected,
    // ⚠️ 注意：不要返回 finalPrompt 或 trigger_word
  };
}

// ============================================================================
// 异步任务处理
// ============================================================================

/**
 * 模拟视频生成处理
 * 
 * 实际生产环境应该：
 * 1. 调用真实的 Sora API
 * 2. 使用 finalPrompt（已注入 trigger_word）
 * 3. 轮询状态直到完成
 */
async function processVideoGeneration(
  taskId: string,
  finalPrompt: string,
  duration: VideoDuration,
  creditsUsed: number
) {
  const task = taskStore.get(taskId);
  if (!task) return;

  // 更新状态为处理中
  task.status = "processing";
  taskStore.set(taskId, task);

  console.log(`[Generate Video] Starting generation for task ${taskId}:`, {
    duration,
    // 安全：只打印 Prompt 类型信息，不打印完整内容
    prompt_type: task.modelId ? "model_enhanced" : "product_only",
    has_trigger_word: !!task._finalPrompt?.includes("@"),
  });

  // ============================================
  // 模拟生成过程
  // ============================================
  
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

    currentTask.progress = progress;
    taskStore.set(taskId, currentTask);

    // 完成生成
    if (currentStep >= totalSteps) {
      clearInterval(interval);
      completeGeneration(taskId, creditsUsed);
    }
  }, durationMs / totalSteps);
}

/**
 * 完成生成
 */
function completeGeneration(taskId: string, creditsUsed: number) {
  const task = taskStore.get(taskId);
  if (!task) return;

  // 90% 成功率
  const isSuccess = Math.random() > 0.1;

  if (isSuccess) {
    // 模拟输出 URL
    const outputUrls = [
      "https://www.w3schools.com/html/mov_bbb.mp4",
      "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4",
    ];
    const thumbnailUrls = [
      "https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&h=711&fit=crop",
      "https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&h=711&fit=crop",
    ];

    task.status = "completed";
    task.progress = 100;
    task.outputUrl = outputUrls[Math.floor(Math.random() * outputUrls.length)];
    task.thumbnailUrl = thumbnailUrls[Math.floor(Math.random() * thumbnailUrls.length)];
    task.completedAt = new Date().toISOString();
    
    // 清除内部敏感数据
    delete task._finalPrompt;
    
    taskStore.set(taskId, task);

    console.log(`[Generate Video] Task ${taskId} completed successfully`);
  } else {
    // 生成失败 - 退还积分
    refundCredits(creditsUsed);

    task.status = "failed";
    task.progress = 0;
    task.errorMessage = "Generation failed. Credits have been refunded.";
    task.completedAt = new Date().toISOString();
    
    // 清除内部敏感数据
    delete task._finalPrompt;
    
    taskStore.set(taskId, task);

    console.log(`[Generate Video] Task ${taskId} failed, refunded ${creditsUsed} credits`);
  }
}

// ============================================================================
// 任务状态查询
// ============================================================================

export interface TaskStatusResult {
  success: boolean;
  status?: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  outputUrl?: string | null;
  thumbnailUrl?: string | null;
  errorMessage?: string | null;
  error?: string;
}

/**
 * 查询任务状态 Server Action
 */
export async function getVideoTaskStatus(taskId: string): Promise<TaskStatusResult> {
  const task = taskStore.get(taskId);

  if (!task) {
    return {
      success: false,
      error: "Task not found",
    };
  }

  // 返回安全的任务状态（不包含敏感信息）
  return {
    success: true,
    status: task.status,
    progress: task.progress,
    outputUrl: task.outputUrl,
    thumbnailUrl: task.thumbnailUrl,
    errorMessage: task.errorMessage,
    // ⚠️ 不返回：_finalPrompt, _triggerWord
  };
}

// ============================================================================
// 任务取消
// ============================================================================

export interface CancelTaskResult {
  success: boolean;
  refundedCredits?: number;
  error?: string;
}

/**
 * 取消任务 Server Action
 */
export async function cancelVideoTask(taskId: string): Promise<CancelTaskResult> {
  const task = taskStore.get(taskId);

  if (!task) {
    return {
      success: false,
      error: "Task not found",
    };
  }

  if (task.status === "completed" || task.status === "failed") {
    return {
      success: false,
      error: "Task already finished",
    };
  }

  // 退还积分（简化处理，实际应根据任务参数计算）
  const refundAmount = 50;
  refundCredits(refundAmount);

  task.status = "failed";
  task.errorMessage = "Cancelled by user";
  task.completedAt = new Date().toISOString();
  
  // 清除内部敏感数据
  delete task._finalPrompt;
  
  taskStore.set(taskId, task);

  console.log(`[Generate Video] Task ${taskId} cancelled, refunded ${refundAmount} credits`);

  return {
    success: true,
    refundedCredits: refundAmount,
  };
}

// ============================================================================
// 获取用户当前积分
// ============================================================================

export async function getCurrentCredits(): Promise<number> {
  return getUserCredits();
}

