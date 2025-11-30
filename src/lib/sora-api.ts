/**
 * Sora 2 API 处理模块
 * 
 * 功能：
 * - 创建视频生成任务
 * - 查询任务状态
 * - 异步轮询机制
 * - 超时处理与积分退还
 * - AI 模特唤醒词注入
 */

import { assemblePrompt, validateUserPrompt } from "./prompt-assembler";

// ============================================================================
// 类型定义
// ============================================================================

export type VideoDuration = "5s" | "10s" | "15s" | "20s";

export interface SoraTaskInput {
  prompt: string;
  duration: VideoDuration;
  model_id?: string | null;      // AI 模特 ID，用于查询唤醒词
  product_id?: string;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  resolution?: "480p" | "720p" | "1080p";
  source_image_url?: string | null;  // 参考图片 URL (图生视频)
}

export interface SoraTask {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "timeout";
  progress: number;
  video_url?: string;
  thumbnail_url?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  duration: VideoDuration;
  credits_used: number;
  credits_refunded?: number;
}

export interface SoraAPIResponse {
  success: boolean;
  data?: {
    id: string;
    status: string;
    outputs?: Array<{
      url: string;
      thumbnail_url?: string;
    }>;
    progress?: number;
    error?: string;
  };
  error?: string;
}

// ============================================================================
// 配置
// ============================================================================

const SORA_API_BASE_URL = process.env.SORA_API_URL || "https://api.openai.com/v1/video";
const SORA_API_KEY = process.env.SORA_API_KEY || "";

// 积分策略配置
export const CREDITS_PRICING: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

// 超时配置（毫秒）
export const TIMEOUT_MS = 10 * 60 * 1000; // 10分钟
export const POLL_INTERVAL_MS = 5 * 1000; // 5秒轮询

// ============================================================================
// 任务存储（生产环境应使用数据库）
// ============================================================================

interface StoredTask extends SoraTask {
  user_id: string;
  input: SoraTaskInput;
  timeout_timer?: NodeJS.Timeout;
}

const taskStore = new Map<string, StoredTask>();

// ============================================================================
// 核心 API 函数
// ============================================================================

/**
 * 创建 Sora 视频生成任务
 * 
 * 新增功能：AI 模特唤醒词自动注入
 * - 如果 model_id 存在，自动查询并注入 trigger_word
 * - 如果 model_id 不存在，使用通用产品展示前缀
 */
export async function createSoraTask(
  userId: string,
  input: SoraTaskInput
): Promise<{ success: boolean; task?: SoraTask; error?: string }> {
  const taskId = `sora-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const creditsRequired = CREDITS_PRICING[input.duration];

  // ============================================
  // 【核心逻辑】组装最终 Prompt (注入唤醒词)
  // ============================================
  
  // 1. 验证用户输入的 Prompt
  const validation = validateUserPrompt(input.prompt || "");
  if (validation.warnings.length > 0) {
    console.log("[Sora API] Prompt validation warnings:", validation.warnings);
  }
  
  // 2. 组装最终 Prompt (自动注入模特唤醒词)
  const promptResult = await assemblePrompt({
    user_prompt: validation.sanitizedPrompt,
    model_id: input.model_id,
    source_image_url: input.source_image_url,
  });
  
  const finalPrompt = promptResult.final_prompt;
  
  console.log("[Sora API] Prompt Assembly:", {
    user_prompt: input.prompt?.substring(0, 50) + "...",
    model_id: input.model_id,
    model_used: promptResult.model_used,
    trigger_word_injected: promptResult.trigger_word_injected,
    // 注意：不要在日志中输出完整的 finalPrompt，因为包含唤醒词
    final_prompt_preview: finalPrompt.substring(0, 30) + "...[hidden]",
  });

  // 创建任务记录 (存储原始用户输入，不存储注入后的 Prompt)
  const task: StoredTask = {
    id: taskId,
    user_id: userId,
    status: "pending",
    progress: 0,
    duration: input.duration,
    credits_used: creditsRequired,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    input: {
      ...input,
      // 存储原始 Prompt，不存储注入后的版本
      prompt: input.prompt || "",
    },
  };

  taskStore.set(taskId, task);

  try {
    // 检查 API Key
    if (!SORA_API_KEY) {
      console.log("[Sora API] No API key configured, using mock mode");
      // 模拟模式：启动模拟生成
      startMockGeneration(taskId);
      return { success: true, task };
    }

    // 调用真实 Sora API (使用注入唤醒词后的 Prompt)
    const response = await fetch(`${SORA_API_BASE_URL}/generations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SORA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sora-2",
        prompt: finalPrompt,  // 【关键】使用注入唤醒词后的 Prompt
        duration: parseDurationToSeconds(input.duration),
        aspect_ratio: input.aspect_ratio || "9:16",
        resolution: input.resolution || "1080p",
        // 如果有参考图片，传递给 API
        ...(input.source_image_url && { image: input.source_image_url }),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const data: SoraAPIResponse = await response.json();
    
    if (data.success && data.data?.id) {
      // 更新任务状态
      task.status = "processing";
      task.updated_at = new Date().toISOString();
      taskStore.set(taskId, task);

      // 启动超时计时器
      startTimeoutTimer(taskId);

      return { success: true, task };
    } else {
      throw new Error(data.error || "Failed to create task");
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Sora API] Create task error:", errorMessage);
    
    // 标记任务失败
    task.status = "failed";
    task.error_message = errorMessage;
    task.updated_at = new Date().toISOString();
    taskStore.set(taskId, task);

    return { success: false, error: errorMessage };
  }
}

/**
 * 查询任务状态
 */
export async function checkSoraTaskStatus(
  taskId: string
): Promise<{ success: boolean; task?: SoraTask; error?: string }> {
  const storedTask = taskStore.get(taskId);

  if (!storedTask) {
    return { success: false, error: "Task not found" };
  }

  // 如果任务已完成或失败，直接返回
  if (["completed", "failed", "timeout"].includes(storedTask.status)) {
    return { success: true, task: storedTask };
  }

  // 模拟模式下直接返回存储的状态
  if (!SORA_API_KEY) {
    return { success: true, task: storedTask };
  }

  try {
    // 调用真实 Sora API 查询状态
    const response = await fetch(`${SORA_API_BASE_URL}/generations/${taskId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${SORA_API_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data: SoraAPIResponse = await response.json();

    if (data.data) {
      // 更新任务状态
      storedTask.progress = data.data.progress || storedTask.progress;
      storedTask.updated_at = new Date().toISOString();

      if (data.data.status === "completed" && data.data.outputs?.[0]) {
        storedTask.status = "completed";
        storedTask.video_url = data.data.outputs[0].url;
        storedTask.thumbnail_url = data.data.outputs[0].thumbnail_url;
        storedTask.completed_at = new Date().toISOString();
        storedTask.progress = 100;

        // 清除超时计时器
        clearTimeoutTimer(taskId);
      } else if (data.data.status === "failed") {
        storedTask.status = "failed";
        storedTask.error_message = data.data.error || "Generation failed";

        // 清除超时计时器
        clearTimeoutTimer(taskId);
      } else if (data.data.status === "processing") {
        storedTask.status = "processing";
      }

      taskStore.set(taskId, storedTask);
    }

    return { success: true, task: storedTask };
  } catch (error: any) {
    console.error("[Sora API] Check status error:", error);
    return { success: true, task: storedTask }; // 返回缓存的状态
  }
}

/**
 * 取消任务
 */
export async function cancelSoraTask(
  taskId: string
): Promise<{ success: boolean; refunded_credits?: number; error?: string }> {
  const storedTask = taskStore.get(taskId);

  if (!storedTask) {
    return { success: false, error: "Task not found" };
  }

  if (["completed", "failed", "timeout"].includes(storedTask.status)) {
    return { success: false, error: "Task already finished" };
  }

  // 清除超时计时器
  clearTimeoutTimer(taskId);

  // 标记为失败并退还积分
  storedTask.status = "failed";
  storedTask.error_message = "Cancelled by user";
  storedTask.credits_refunded = storedTask.credits_used;
  storedTask.updated_at = new Date().toISOString();
  taskStore.set(taskId, storedTask);

  return { success: true, refunded_credits: storedTask.credits_used };
}

/**
 * 获取用户的所有任务
 */
export function getUserTasks(userId: string): SoraTask[] {
  const tasks: SoraTask[] = [];
  for (const task of taskStore.values()) {
    if (task.user_id === userId) {
      tasks.push(task);
    }
  }
  return tasks.sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * 获取积分价格
 */
export function getCreditsPrice(duration: VideoDuration): number {
  return CREDITS_PRICING[duration];
}

// ============================================================================
// 辅助函数
// ============================================================================

function parseDurationToSeconds(duration: VideoDuration): number {
  const match = duration.match(/^(\d+)s$/);
  return match ? parseInt(match[1], 10) : 10;
}

/**
 * 启动超时计时器
 */
function startTimeoutTimer(taskId: string) {
  const storedTask = taskStore.get(taskId);
  if (!storedTask) return;

  // 清除已存在的计时器
  if (storedTask.timeout_timer) {
    clearTimeout(storedTask.timeout_timer);
  }

  // 设置新的超时计时器
  const timer = setTimeout(() => {
    handleTaskTimeout(taskId);
  }, TIMEOUT_MS);

  storedTask.timeout_timer = timer;
  taskStore.set(taskId, storedTask);
}

/**
 * 清除超时计时器
 */
function clearTimeoutTimer(taskId: string) {
  const storedTask = taskStore.get(taskId);
  if (storedTask?.timeout_timer) {
    clearTimeout(storedTask.timeout_timer);
    storedTask.timeout_timer = undefined;
    taskStore.set(taskId, storedTask);
  }
}

/**
 * 处理任务超时
 */
async function handleTaskTimeout(taskId: string) {
  const storedTask = taskStore.get(taskId);
  if (!storedTask) return;

  // 如果任务已完成，不处理
  if (["completed", "failed", "timeout"].includes(storedTask.status)) {
    return;
  }

  console.log(`[Sora API] Task ${taskId} timed out after 10 minutes`);

  // 标记为超时
  storedTask.status = "timeout";
  storedTask.error_message = "Generation timed out after 10 minutes";
  storedTask.credits_refunded = storedTask.credits_used;
  storedTask.updated_at = new Date().toISOString();
  taskStore.set(taskId, storedTask);

  // 这里应该调用退还积分的逻辑
  // await refundCredits(storedTask.user_id, storedTask.credits_used);
}

// ============================================================================
// 模拟生成（开发/测试用）
// ============================================================================

/**
 * 模拟视频生成过程
 */
function startMockGeneration(taskId: string) {
  const storedTask = taskStore.get(taskId);
  if (!storedTask) return;

  // 更新状态为处理中
  storedTask.status = "processing";
  storedTask.updated_at = new Date().toISOString();
  taskStore.set(taskId, storedTask);

  // 根据时长计算模拟生成时间（每秒视频需要约1秒生成）
  const durationSeconds = parseDurationToSeconds(storedTask.duration);
  const totalGenerationTime = durationSeconds * 1000; // 实际可调整比例
  const updateInterval = 500; // 每500ms更新一次进度
  const totalSteps = totalGenerationTime / updateInterval;
  let currentStep = 0;

  const progressInterval = setInterval(() => {
    const task = taskStore.get(taskId);
    if (!task || ["completed", "failed", "timeout"].includes(task.status)) {
      clearInterval(progressInterval);
      return;
    }

    currentStep++;
    const progress = Math.min(Math.round((currentStep / totalSteps) * 100), 99);
    
    task.progress = progress;
    task.updated_at = new Date().toISOString();
    taskStore.set(taskId, task);

    // 完成生成
    if (currentStep >= totalSteps) {
      clearInterval(progressInterval);
      completeMockGeneration(taskId);
    }
  }, updateInterval);

  // 启动超时计时器
  startTimeoutTimer(taskId);
}

/**
 * 完成模拟生成
 */
function completeMockGeneration(taskId: string) {
  const storedTask = taskStore.get(taskId);
  if (!storedTask) return;

  // 模拟输出 URL
  const mockVideoUrls = [
    "https://www.w3schools.com/html/mov_bbb.mp4",
    "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4",
  ];

  const mockThumbnails = [
    "https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&h=711&fit=crop",
    "https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&h=711&fit=crop",
  ];

  storedTask.status = "completed";
  storedTask.progress = 100;
  storedTask.video_url = mockVideoUrls[Math.floor(Math.random() * mockVideoUrls.length)];
  storedTask.thumbnail_url = mockThumbnails[Math.floor(Math.random() * mockThumbnails.length)];
  storedTask.completed_at = new Date().toISOString();
  storedTask.updated_at = new Date().toISOString();
  taskStore.set(taskId, storedTask);

  // 清除超时计时器
  clearTimeoutTimer(taskId);

  console.log(`[Sora API] Mock generation completed for task ${taskId}`);
}

// ============================================================================
// Server Actions (Next.js 14)
// ============================================================================

/**
 * Server Action: 创建生成任务
 * 
 * @param userId - 用户 ID
 * @param prompt - 用户输入的提示词
 * @param duration - 视频时长
 * @param options - 可选参数
 *   - model_id: AI 模特 ID，用于自动注入唤醒词
 *   - product_id: 产品 ID
 *   - aspect_ratio: 视频比例
 *   - source_image_url: 参考图片 URL (图生视频模式)
 */
export async function createVideoGenerationAction(
  userId: string,
  prompt: string,
  duration: VideoDuration,
  options?: {
    model_id?: string | null;       // AI 模特 ID (用于唤醒词注入)
    product_id?: string;
    aspect_ratio?: "16:9" | "9:16" | "1:1";
    source_image_url?: string | null;  // 参考图片 URL
  }
): Promise<{ 
  success: boolean; 
  task_id?: string; 
  credits_used?: number; 
  model_used?: boolean;
  error?: string;
}> {
  const result = await createSoraTask(userId, {
    prompt,
    duration,
    model_id: options?.model_id,
    product_id: options?.product_id,
    aspect_ratio: options?.aspect_ratio || "9:16",
    source_image_url: options?.source_image_url,
  });

  if (result.success && result.task) {
    return {
      success: true,
      task_id: result.task.id,
      credits_used: result.task.credits_used,
      model_used: !!options?.model_id,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Server Action: 查询任务状态
 */
export async function checkVideoStatusAction(
  taskId: string
): Promise<{
  success: boolean;
  status?: SoraTask["status"];
  progress?: number;
  video_url?: string;
  thumbnail_url?: string;
  error?: string;
  credits_refunded?: number;
}> {
  const result = await checkSoraTaskStatus(taskId);

  if (result.success && result.task) {
    return {
      success: true,
      status: result.task.status,
      progress: result.task.progress,
      video_url: result.task.video_url,
      thumbnail_url: result.task.thumbnail_url,
      error: result.task.error_message,
      credits_refunded: result.task.credits_refunded,
    };
  }

  return { success: false, error: result.error };
}

/**
 * Server Action: 取消任务
 */
export async function cancelVideoGenerationAction(
  taskId: string
): Promise<{ success: boolean; refunded_credits?: number; error?: string }> {
  return cancelSoraTask(taskId);
}



