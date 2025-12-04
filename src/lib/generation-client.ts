/**
 * Generation Client
 * 
 * 统一的生成 API 客户端
 * 用于 Quick Generator 和 Pro Studio (Batch) 页面
 */

import {
  type VideoModel,
  type NanoTier,
  type ImageAspectRatio,
  type ImageResolution,
  type GenerationStatus,
  VIDEO_MODEL_PRICING,
} from "@/types/generation";

// ============================================================================
// 视频生成 API
// ============================================================================

export interface SubmitVideoParams {
  prompt: string;
  model: VideoModel;
  aspectRatio: VideoAspectRatio;
  sourceImageUrl?: string;
  modelId?: string;  // AI 模特 ID
  userId?: string;
}

export interface SubmitVideoResult {
  success: boolean;
  taskId?: string;
  status?: GenerationStatus;
  estimatedTime?: string;
  usePro?: boolean;
  error?: string;
}

/**
 * 提交视频生成任务
 */
export async function submitVideoGeneration(params: SubmitVideoParams): Promise<SubmitVideoResult> {
  try {
    const { model, ...rest } = params;
    const duration = VIDEO_MODEL_PRICING[model].apiDuration;
    
    const response = await fetch("/api/generate/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...rest,
        duration,
        size: "small",
      }),
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      console.error("[Generation Client] Failed to parse video submit response:", responseText.substring(0, 200));
      return { success: false, error: "服务器响应格式错误，请稍后重试" };
    }

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      taskId: result.data.taskId,
      status: result.data.status,
      estimatedTime: result.data.estimatedTime,
      usePro: result.data.usePro,
    };
  } catch (error) {
    console.error("[Generation Client] Submit video error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

export interface VideoTaskStatus {
  taskId: string;
  status: GenerationStatus;
  videoUrl?: string;
  errorMessage?: string;
}

/**
 * 查询视频生成任务状态
 */
export async function queryVideoStatus(
  taskId: string, 
  usePro: boolean = false
): Promise<{ success: boolean; task?: VideoTaskStatus; error?: string }> {
  try {
    const response = await fetch(
      `/api/generate/video?taskId=${encodeURIComponent(taskId)}&usePro=${usePro}`
    );
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      console.error("[Generation Client] Failed to parse video query response:", responseText.substring(0, 200));
      return { success: false, error: "服务器响应格式错误，请稍后重试" };
    }

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      task: {
        taskId: result.data.taskId,
        status: result.data.status,
        videoUrl: result.data.videoUrl,
        errorMessage: result.data.errorMessage,
      },
    };
  } catch (error) {
    console.error("[Generation Client] Query video error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

// ============================================================================
// 图片生成 API
// ============================================================================

export interface SubmitImageParams {
  mode: "generate" | "upscale" | "nine_grid";
  prompt?: string;
  sourceImageUrl?: string | string[];
  tier?: NanoTier;
  aspectRatio?: ImageAspectRatio;
  resolution?: ImageResolution;
  userId?: string;
}

export interface SubmitImageResult {
  success: boolean;
  taskId?: string;
  status?: GenerationStatus;
  model?: string;
  estimatedTime?: string;
  error?: string;
}

/**
 * 提交图片生成任务
 */
export async function submitImageGeneration(params: SubmitImageParams): Promise<SubmitImageResult> {
  try {
    const { tier, ...rest } = params;
    const model = tier === "pro" ? "nano-banana-pro" : "nano-banana";
    
    const response = await fetch("/api/generate/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...rest,
        model,
        tier,
      }),
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      console.error("[Generation Client] Failed to parse image submit response:", responseText.substring(0, 200));
      return { success: false, error: "服务器响应格式错误，请稍后重试" };
    }

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      taskId: result.data.taskId,
      status: result.data.status,
      model: result.data.model,
      estimatedTime: result.data.estimatedTime,
    };
  } catch (error) {
    console.error("[Generation Client] Submit image error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

export interface ImageTaskStatus {
  taskId: string;
  status: GenerationStatus;
  imageUrl?: string;
  errorMessage?: string;
}

/**
 * 查询图片生成任务状态
 */
export async function queryImageStatus(
  taskId: string, 
  model: "nano-banana" | "nano-banana-pro" = "nano-banana"
): Promise<{ success: boolean; task?: ImageTaskStatus; error?: string }> {
  try {
    const response = await fetch(
      `/api/generate/image?taskId=${encodeURIComponent(taskId)}&model=${model}`
    );
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      console.error("[Generation Client] Failed to parse image query response:", responseText.substring(0, 200));
      return { success: false, error: "服务器响应格式错误，请稍后重试" };
    }

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      task: {
        taskId: result.data.taskId,
        status: result.data.status,
        imageUrl: result.data.imageUrl,
        errorMessage: result.data.errorMessage,
      },
    };
  } catch (error) {
    console.error("[Generation Client] Query image error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

// ============================================================================
// 轮询工具
// ============================================================================

export interface PollOptions {
  maxPolls?: number;
  intervalMs?: number;
  onProgress?: (pollCount: number, maxPolls: number) => void;
}

/**
 * 轮询视频任务直到完成或失败
 */
export async function pollVideoUntilComplete(
  taskId: string,
  usePro: boolean = false,
  options: PollOptions = {}
): Promise<{ success: boolean; task?: VideoTaskStatus; error?: string }> {
  const { maxPolls = 120, intervalMs = 5000, onProgress } = options;
  
  return new Promise((resolve) => {
    let pollCount = 0;
    
    const pollTimer = setInterval(async () => {
      pollCount++;
      onProgress?.(pollCount, maxPolls);
      
      try {
        const result = await queryVideoStatus(taskId, usePro);
        
        if (!result.success) {
          // 继续轮询，除非达到最大次数
          if (pollCount >= maxPolls) {
            clearInterval(pollTimer);
            resolve({ success: false, error: result.error || "Query failed" });
          }
          return;
        }
        
        const task = result.task!;
        
        if (task.status === "completed") {
          clearInterval(pollTimer);
          resolve({ success: true, task });
        } else if (task.status === "failed") {
          clearInterval(pollTimer);
          resolve({ success: false, task, error: task.errorMessage });
        } else if (pollCount >= maxPolls) {
          clearInterval(pollTimer);
          resolve({ success: false, error: "Timeout: Task took too long" });
        }
      } catch (error) {
        if (pollCount >= maxPolls) {
          clearInterval(pollTimer);
          resolve({ 
            success: false, 
            error: error instanceof Error ? error.message : "Polling error" 
          });
        }
      }
    }, intervalMs);
  });
}

/**
 * 轮询图片任务直到完成或失败
 */
export async function pollImageUntilComplete(
  taskId: string,
  model: "nano-banana" | "nano-banana-pro" = "nano-banana",
  options: PollOptions = {}
): Promise<{ success: boolean; task?: ImageTaskStatus; error?: string }> {
  const { maxPolls = 60, intervalMs = 3000, onProgress } = options;
  
  return new Promise((resolve) => {
    let pollCount = 0;
    
    const pollTimer = setInterval(async () => {
      pollCount++;
      onProgress?.(pollCount, maxPolls);
      
      try {
        const result = await queryImageStatus(taskId, model);
        
        if (!result.success) {
          if (pollCount >= maxPolls) {
            clearInterval(pollTimer);
            resolve({ success: false, error: result.error || "Query failed" });
          }
          return;
        }
        
        const task = result.task!;
        
        if (task.status === "completed") {
          clearInterval(pollTimer);
          resolve({ success: true, task });
        } else if (task.status === "failed") {
          clearInterval(pollTimer);
          resolve({ success: false, task, error: task.errorMessage });
        } else if (pollCount >= maxPolls) {
          clearInterval(pollTimer);
          resolve({ success: false, error: "Timeout: Task took too long" });
        }
      } catch (error) {
        if (pollCount >= maxPolls) {
          clearInterval(pollTimer);
          resolve({ 
            success: false, 
            error: error instanceof Error ? error.message : "Polling error" 
          });
        }
      }
    }, intervalMs);
  });
}

// ============================================================================
// 图片上传工具
// ============================================================================

/**
 * 将 Blob URL 上传到 Supabase Storage
 */
export async function uploadBlobToStorage(
  blobUrl: string,
  fileName: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    // 获取 blob 数据
    const blobResponse = await fetch(blobUrl);
    const blob = await blobResponse.blob();
    
    // 创建 FormData
    const formData = new FormData();
    formData.append("file", blob, fileName);
    
    // 上传到 Supabase Storage
    const uploadResponse = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    
    const uploadResponseText = await uploadResponse.text();
    let uploadResult;
    try {
      uploadResult = JSON.parse(uploadResponseText);
    } catch {
      console.error("[Generation Client] Failed to parse upload response:", uploadResponseText.substring(0, 200));
      return { success: false, error: "上传服务响应格式错误" };
    }
    
    if (!uploadResult.success) {
      return { success: false, error: uploadResult.error };
    }
    
    return { success: true, url: uploadResult.url };
  } catch (error) {
    console.error("[Generation Client] Upload error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Upload failed" 
    };
  }
}





