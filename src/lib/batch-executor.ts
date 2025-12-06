/**
 * Batch Executor
 * 
 * 批量任务执行器，支持并发控制
 * 复用 generation-client.ts 中的 API 调用
 */

import pLimit from "p-limit";
import {
  submitVideoGeneration,
  submitImageGeneration,
  pollVideoUntilComplete,
  pollImageUntilComplete,
  uploadBlobToStorage,
  type SubmitVideoParams,
  type SubmitImageParams,
  type VideoTaskStatus,
  type ImageTaskStatus,
} from "./generation-client";
import {
  type BatchTask,
  type BatchTaskStatus,
  type BatchTaskConfig,
} from "@/stores/batch-store";
import { VIDEO_MODEL_PRICING } from "@/types/generation";

// ============================================================================
// 类型定义
// ============================================================================

export interface BatchExecutorOptions {
  /** 最大并发数 (默认 3) */
  concurrency?: number;
  /** 是否启用自动下载 */
  autoDownload?: boolean;
  /** 任务状态更新回调 */
  onTaskUpdate?: (
    taskId: string,
    status: BatchTaskStatus,
    extra?: {
      taskId?: string;
      resultUrl?: string;
      error?: string;
      progress?: number;
      startedAt?: string;
      completedAt?: string;
    }
  ) => void;
  /** 任务完成回调 */
  onTaskComplete?: (task: BatchTask, result: ExecutionResult) => void;
  /** 全部完成回调 */
  onAllComplete?: (stats: BatchExecutionStats) => void;
  /** 检查是否应该暂停 */
  shouldPause?: () => boolean;
  /** 检查是否应该取消 */
  shouldCancel?: () => boolean;
  /** 用户 ID */
  userId?: string;
}

export interface ExecutionResult {
  success: boolean;
  taskId?: string;
  resultUrl?: string;
  error?: string;
}

export interface BatchExecutionStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  duration: number; // ms
}

// ============================================================================
// 下载工具 (复用 Quick Gen 的下载逻辑)
// ============================================================================

/**
 * 后台下载文件 (不打开新窗口)
 */
async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // 延迟释放 blob URL
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (error) {
    console.error("[Batch Executor] Download error:", error);
  }
}

/**
 * 生成下载文件名
 */
function generateFilename(task: BatchTask, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mode = task.config.outputMode;
  const index = task.index + 1;
  return `batch-${mode}-${index}-${timestamp}.${extension}`;
}

// ============================================================================
// 单任务执行器
// ============================================================================

/**
 * 执行单个视频生成任务
 */
async function executeVideoTask(
  task: BatchTask,
  options: BatchExecutorOptions
): Promise<ExecutionResult> {
  const { onTaskUpdate, userId } = options;
  const config = task.config;

  // 1. 更新状态为处理中
  onTaskUpdate?.(task.id, "processing", {
    startedAt: new Date().toISOString(),
    progress: 0,
  });

  try {
    // 2. 处理源图片 (如果是 blob URL，需要先上传)
    let sourceImageUrl = config.sourceImageUrl;
    if (sourceImageUrl?.startsWith("blob:")) {
      onTaskUpdate?.(task.id, "processing", { progress: 5 });
      
      const uploadResult = await uploadBlobToStorage(
        sourceImageUrl,
        `batch-source-${task.id}.jpg`
      );
      
      if (!uploadResult.success) {
        return { success: false, error: `Upload failed: ${uploadResult.error}` };
      }
      
      sourceImageUrl = uploadResult.url;
    }

    // 3. 提交视频生成任务
    onTaskUpdate?.(task.id, "processing", { progress: 10 });

    const submitParams: SubmitVideoParams = {
      prompt: config.prompt || "",
      model: config.videoModel || "sora-2",
      aspectRatio: config.videoAspectRatio || "9:16",
      sourceImageUrl,
      modelId: config.modelId,
      userId,
    };

    const submitResult = await submitVideoGeneration(submitParams);

    if (!submitResult.success) {
      return { success: false, error: submitResult.error };
    }

    // 4. 轮询直到完成
    const pollResult = await pollVideoUntilComplete(
      submitResult.taskId!,
      submitResult.usePro || false,
      {
        maxPolls: 120, // 10 分钟超时 (120 * 5s)
        intervalMs: 5000,
        onProgress: (count, max) => {
          const progress = 10 + Math.round((count / max) * 85); // 10% - 95%
          onTaskUpdate?.(task.id, "processing", { progress });
        },
      }
    );

    // 5. 返回结果
    if (pollResult.success && pollResult.task?.videoUrl) {
      return {
        success: true,
        taskId: submitResult.taskId,
        resultUrl: pollResult.task.videoUrl,
      };
    } else {
      return {
        success: false,
        taskId: submitResult.taskId,
        error: pollResult.error || pollResult.task?.errorMessage || "Unknown error",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 执行单个图片生成任务
 */
async function executeImageTask(
  task: BatchTask,
  options: BatchExecutorOptions
): Promise<ExecutionResult> {
  const { onTaskUpdate, userId } = options;
  const config = task.config;

  // 1. 更新状态为处理中
  onTaskUpdate?.(task.id, "processing", {
    startedAt: new Date().toISOString(),
    progress: 0,
  });

  try {
    // 2. 处理源图片 (如果是 blob URL，需要先上传)
    let sourceImageUrl: string | string[] | undefined;
    
    if (config.sourceImageUrls?.length) {
      // 多图模式
      const uploadedUrls: string[] = [];
      for (let i = 0; i < config.sourceImageUrls.length; i++) {
        const url = config.sourceImageUrls[i];
        if (url.startsWith("blob:")) {
          const uploadResult = await uploadBlobToStorage(
            url,
            `batch-source-${task.id}-${i}.jpg`
          );
          if (!uploadResult.success) {
            return { success: false, error: `Upload failed: ${uploadResult.error}` };
          }
          uploadedUrls.push(uploadResult.url!);
        } else {
          uploadedUrls.push(url);
        }
        onTaskUpdate?.(task.id, "processing", { 
          progress: Math.round((i + 1) / config.sourceImageUrls.length * 10) 
        });
      }
      sourceImageUrl = uploadedUrls;
    } else if (config.sourceImageUrl?.startsWith("blob:")) {
      // 单图模式
      onTaskUpdate?.(task.id, "processing", { progress: 5 });
      
      const uploadResult = await uploadBlobToStorage(
        config.sourceImageUrl,
        `batch-source-${task.id}.jpg`
      );
      
      if (!uploadResult.success) {
        return { success: false, error: `Upload failed: ${uploadResult.error}` };
      }
      
      sourceImageUrl = uploadResult.url;
    } else {
      sourceImageUrl = config.sourceImageUrl;
    }

    // 3. 提交图片生成任务
    onTaskUpdate?.(task.id, "processing", { progress: 15 });

    const submitParams: SubmitImageParams = {
      mode: "generate",
      prompt: config.prompt || "High quality image",
      sourceImageUrl,
      tier: config.imageTier || "fast",
      aspectRatio: config.imageAspectRatio || "auto",
      resolution: config.imageResolution || "1k",
      userId,
    };

    const submitResult = await submitImageGeneration(submitParams);

    if (!submitResult.success) {
      return { success: false, error: submitResult.error };
    }

    // 4. 轮询直到完成
    const model = config.imageTier === "pro" ? "nano-banana-pro" : "nano-banana";
    
    const pollResult = await pollImageUntilComplete(
      submitResult.taskId!,
      model as "nano-banana" | "nano-banana-pro",
      {
        maxPolls: 60, // 3 分钟超时 (60 * 3s)
        intervalMs: 3000,
        onProgress: (count, max) => {
          const progress = 15 + Math.round((count / max) * 80); // 15% - 95%
          onTaskUpdate?.(task.id, "processing", { progress });
        },
      }
    );

    // 5. 返回结果
    if (pollResult.success && pollResult.task?.imageUrl) {
      return {
        success: true,
        taskId: submitResult.taskId,
        resultUrl: pollResult.task.imageUrl,
      };
    } else {
      return {
        success: false,
        taskId: submitResult.taskId,
        error: pollResult.error || pollResult.task?.errorMessage || "Unknown error",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 执行单个任务 (根据类型分发)
 */
async function executeTask(
  task: BatchTask,
  options: BatchExecutorOptions
): Promise<ExecutionResult> {
  const { outputMode } = task.config;

  if (outputMode === "video") {
    return executeVideoTask(task, options);
  } else {
    return executeImageTask(task, options);
  }
}

// ============================================================================
// 批量执行器
// ============================================================================

/**
 * 执行批量任务
 * 
 * @param tasks - 要执行的任务列表
 * @param options - 执行选项
 * @returns 执行统计
 */
export async function executeBatch(
  tasks: BatchTask[],
  options: BatchExecutorOptions = {}
): Promise<BatchExecutionStats> {
  const {
    concurrency = 3,
    autoDownload = false,
    onTaskUpdate,
    onTaskComplete,
    onAllComplete,
    shouldPause,
    shouldCancel,
  } = options;

  const startTime = Date.now();
  const stats: BatchExecutionStats = {
    total: tasks.length,
    success: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
  };

  // 过滤出需要执行的任务 (draft 或 failed)
  const pendingTasks = tasks.filter(
    (t) => t.status === "draft" || t.status === "queued" || t.status === "failed"
  );

  if (pendingTasks.length === 0) {
    stats.skipped = tasks.length;
    stats.duration = Date.now() - startTime;
    onAllComplete?.(stats);
    return stats;
  }

  // 创建并发限制器
  const limit = pLimit(concurrency);

  // 创建任务执行 Promise
  const taskPromises = pendingTasks.map((task) =>
    limit(async () => {
      // 检查是否应该取消
      if (shouldCancel?.()) {
        stats.skipped++;
        return;
      }

      // 检查是否应该暂停 (暂停时等待)
      while (shouldPause?.()) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (shouldCancel?.()) {
          stats.skipped++;
          return;
        }
      }

      // 将任务标记为 queued
      onTaskUpdate?.(task.id, "queued");

      // 执行任务
      const result = await executeTask(task, options);

      // 更新任务状态
      if (result.success) {
        stats.success++;
        onTaskUpdate?.(task.id, "success", {
          taskId: result.taskId,
          resultUrl: result.resultUrl,
          completedAt: new Date().toISOString(),
          progress: 100,
        });

        // 自动下载
        if (autoDownload && result.resultUrl) {
          const extension = task.config.outputMode === "video" ? "mp4" : "png";
          const filename = generateFilename(task, extension);
          await downloadFile(result.resultUrl, filename);
        }
      } else {
        stats.failed++;
        onTaskUpdate?.(task.id, "failed", {
          taskId: result.taskId,
          error: result.error,
          completedAt: new Date().toISOString(),
        });
      }

      // 任务完成回调
      onTaskComplete?.(task, result);
    })
  );

  // 等待所有任务完成
  await Promise.all(taskPromises);

  // 计算统计
  stats.skipped = tasks.length - stats.success - stats.failed;
  stats.duration = Date.now() - startTime;

  // 全部完成回调
  onAllComplete?.(stats);

  return stats;
}

// ============================================================================
// 批量执行器 Hook (用于 React 组件)
// ============================================================================

export interface UseBatchExecutorOptions {
  concurrency?: number;
  autoDownload?: boolean;
  userId?: string;
}

/**
 * 创建批量执行器实例
 * 
 * 用于在 React 组件中管理批量执行状态
 */
export function createBatchExecutor(options: UseBatchExecutorOptions = {}) {
  let isPaused = false;
  let isCancelled = false;

  return {
    /**
     * 执行批量任务
     */
    execute: async (
      tasks: BatchTask[],
      callbacks: {
        onTaskUpdate: BatchExecutorOptions["onTaskUpdate"];
        onTaskComplete?: BatchExecutorOptions["onTaskComplete"];
        onAllComplete?: BatchExecutorOptions["onAllComplete"];
      }
    ) => {
      isPaused = false;
      isCancelled = false;

      return executeBatch(tasks, {
        ...options,
        ...callbacks,
        shouldPause: () => isPaused,
        shouldCancel: () => isCancelled,
      });
    },

    /**
     * 暂停执行
     */
    pause: () => {
      isPaused = true;
    },

    /**
     * 继续执行
     */
    resume: () => {
      isPaused = false;
    },

    /**
     * 取消执行
     */
    cancel: () => {
      isCancelled = true;
    },

    /**
     * 获取状态
     */
    getStatus: () => ({
      isPaused,
      isCancelled,
    }),
  };
}

export type BatchExecutor = ReturnType<typeof createBatchExecutor>;





