/**
 * 速创 API - Sora 2 真实接口
 * 
 * 文档: https://wuyinkeji.feishu.cn/wiki/Bec2waPvciCVbskbyp8cChwNnzb
 * 
 * 注意事项:
 * - sora2 生成需要约 4 分钟
 * - sora2pro 生成需要约 10 分钟
 * - status 为 1 表示生成成功
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface SoraSubmitParams {
  prompt: string;
  duration?: 10 | 15 | 25;       // 视频时长（秒），默认 10
  aspectRatio?: "9:16" | "16:9"; // 视频比例，默认 9:16
  size?: "small" | "large";      // 视频分辨率，默认 small
  url?: string;                  // 参考图片 URL（可选）
}

export interface SoraSubmitResponse {
  code: number;
  msg: string;
  data?: {
    id: string;  // 任务 ID，用于查询结果
  };
  exec_time?: number;
  ip?: string;
}

export interface SoraResultResponse {
  code: number;
  msg: string;
  data?: {
    content: string;      // 原始提示词
    status: number;       // 0=处理中, 1=成功, 2=失败
    fail_reason: string;  // 失败原因
    created_at: string;
    updated_at: string;
    remote_url: string;   // 生成的视频 URL
    size: string;
    duration: number;
    aspectRatio: string;
    url: string;          // 参考图片 URL
    pid: string;
    id: string;
  };
  exec_time?: number;
}

export interface GenerationTask {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  prompt: string;
  duration: number;
  aspectRatio: string;
  videoUrl?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt?: string;
}

// ============================================================================
// 配置
// ============================================================================

const API_BASE_URL = process.env.SUCHUANG_API_ENDPOINT 
  ? `${process.env.SUCHUANG_API_ENDPOINT}/api/sora2` 
  : "https://api.wuyinkeji.com/api/sora2";
const API_KEY = process.env.SUCHUANG_API_KEY || process.env.SORA_API_KEY || "";

// 状态映射
const STATUS_MAP: Record<number, GenerationTask["status"]> = {
  0: "processing",
  1: "completed",
  2: "failed",
};

// ============================================================================
// API 函数
// ============================================================================

/**
 * 提交视频生成任务
 */
export async function submitVideoGeneration(
  params: SoraSubmitParams,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = apiKey || API_KEY;
  
  if (!key) {
    return { success: false, error: "API key not configured" };
  }

  try {
    console.log("[Sora API] Submitting video generation:", {
      prompt: params.prompt.substring(0, 50) + "...",
      duration: params.duration || 10,
      aspectRatio: params.aspectRatio || "9:16",
      size: params.size || "small",
      hasReferenceImage: !!params.url,
    });

    const response = await fetch(`${API_BASE_URL}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        key,
        prompt: params.prompt,
        duration: String(params.duration || 10),
        aspectRatio: params.aspectRatio || "9:16",
        size: params.size || "small",
        ...(params.url && { url: params.url }),
      }),
    });

    const responseText = await response.text();
    let data: SoraSubmitResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[Sora API] Failed to parse response:", responseText.substring(0, 200));
      return { success: false, error: "视频生成服务响应格式错误，请稍后重试" };
    }

    console.log("[Sora API] Submit response:", {
      code: data.code,
      msg: data.msg,
      taskId: data.data?.id,
    });

    if (data.code === 200 && data.data?.id) {
      return { success: true, taskId: data.data.id };
    }

    return { 
      success: false, 
      error: data.msg || `API error: code ${data.code}` 
    };
  } catch (error) {
    console.error("[Sora API] Submit error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

/**
 * 查询视频生成结果
 */
export async function queryVideoResult(
  taskId: string,
  apiKey?: string
): Promise<{ 
  success: boolean; 
  task?: GenerationTask; 
  error?: string;
  raw?: SoraResultResponse;
}> {
  const key = apiKey || API_KEY;
  
  if (!key) {
    return { success: false, error: "API key not configured" };
  }

  try {
    console.log("[Sora API] Querying task result:", taskId);

    // 正确的查询端点是 /detail
    const response = await fetch(`${API_BASE_URL}/detail`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        key,
        id: taskId,
      }),
    });

    const responseText = await response.text();
    let data: SoraResultResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[Sora API] Failed to parse query response:", responseText.substring(0, 200));
      return { success: false, error: "视频任务查询响应格式错误，请稍后重试" };
    }

    console.log("[Sora API] Query response:", {
      code: data.code,
      msg: data.msg,
      status: data.data?.status,
      hasVideoUrl: !!data.data?.remote_url,
    });

    if (data.code === 200 && data.data) {
      const task: GenerationTask = {
        taskId: data.data.id || taskId,
        status: STATUS_MAP[data.data.status] || "processing",
        prompt: data.data.content,
        duration: data.data.duration,
        aspectRatio: data.data.aspectRatio,
        videoUrl: data.data.remote_url || undefined,
        errorMessage: data.data.fail_reason || undefined,
        createdAt: data.data.created_at,
        updatedAt: data.data.updated_at,
      };

      return { success: true, task, raw: data };
    }

    return { 
      success: false, 
      error: data.msg || `Query failed: code ${data.code}`,
      raw: data,
    };
  } catch (error) {
    console.error("[Sora API] Query error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

/**
 * 轮询等待视频生成完成
 * 
 * @param taskId 任务 ID
 * @param options 轮询选项
 * @returns 最终任务状态
 */
export async function waitForCompletion(
  taskId: string,
  options?: {
    apiKey?: string;
    maxWaitTime?: number;      // 最大等待时间（毫秒），默认 10 分钟
    pollInterval?: number;     // 轮询间隔（毫秒），默认 30 秒
    onProgress?: (task: GenerationTask, elapsedTime: number) => void;
  }
): Promise<{ success: boolean; task?: GenerationTask; error?: string }> {
  const {
    apiKey,
    maxWaitTime = 10 * 60 * 1000,  // 10 分钟
    pollInterval = 30 * 1000,       // 30 秒
    onProgress,
  } = options || {};

  const startTime = Date.now();
  let lastTask: GenerationTask | undefined;

  console.log("[Sora API] Starting poll for task:", taskId, {
    maxWaitTime: `${maxWaitTime / 1000}s`,
    pollInterval: `${pollInterval / 1000}s`,
  });

  while (true) {
    const elapsedTime = Date.now() - startTime;

    // 检查超时
    if (elapsedTime >= maxWaitTime) {
      console.log("[Sora API] Poll timeout reached");
      return {
        success: false,
        task: lastTask,
        error: "Generation timeout. Please try again later.",
      };
    }

    // 查询结果
    const result = await queryVideoResult(taskId, apiKey);

    if (!result.success) {
      console.log("[Sora API] Query failed:", result.error);
      // 继续轮询，可能是临时错误
      await sleep(pollInterval);
      continue;
    }

    lastTask = result.task;

    // 通知进度
    if (onProgress && lastTask) {
      onProgress(lastTask, elapsedTime);
    }

    // 检查状态
    if (lastTask?.status === "completed") {
      console.log("[Sora API] Task completed:", {
        taskId,
        duration: `${elapsedTime / 1000}s`,
        videoUrl: lastTask.videoUrl?.substring(0, 50) + "...",
      });
      return { success: true, task: lastTask };
    }

    if (lastTask?.status === "failed") {
      console.log("[Sora API] Task failed:", lastTask.errorMessage);
      return {
        success: false,
        task: lastTask,
        error: lastTask.errorMessage || "Generation failed",
      };
    }

    // 继续等待
    console.log("[Sora API] Task still processing, waiting...", {
      elapsedTime: `${Math.round(elapsedTime / 1000)}s`,
      status: lastTask?.status,
    });
    await sleep(pollInterval);
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 快速测试 API 连接
 */
export async function testConnection(apiKey: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    // 提交一个简单的测试任务
    const result = await submitVideoGeneration(
      {
        prompt: "A simple test video",
        duration: 10,
        aspectRatio: "9:16",
        size: "small",
      },
      apiKey
    );

    if (result.success) {
      return {
        success: true,
        message: `API connection successful. Task ID: ${result.taskId}`,
      };
    }

    return {
      success: false,
      message: result.error || "Unknown error",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

