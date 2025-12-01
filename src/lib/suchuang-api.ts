/**
 * 速创 API 统一接口
 * 
 * 文档:
 * - NanoBanana: https://api.wuyinkeji.com/doc/18
 * - NanoBanana Pro: https://api.wuyinkeji.com/doc/43
 * - Sora2: https://api.wuyinkeji.com/doc/40
 * - Sora2 Pro: https://api.wuyinkeji.com/doc/41
 */

// ============================================================================
// 配置
// ============================================================================

const API_BASE_URL = process.env.SUCHUANG_API_ENDPOINT || "https://api.wuyinkeji.com";
const API_KEY = process.env.SUCHUANG_API_KEY || "";

// ============================================================================
// 类型定义
// ============================================================================

// NanoBanana 图片生成参数
export interface NanoBananaParams {
  model: "nano-banana" | "nano-banana-pro";
  prompt: string;
  img_url?: string | string[];  // 参考图片 URL
  aspectRatio?: "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "5:4" | "4:5" | "21:9";
  resolution?: "1k" | "2k" | "4k";  // 仅 Pro 版本支持
}

// NanoBanana 响应
export interface NanoBananaResponse {
  code: number;
  msg: string;
  data?: {
    id: number;  // 任务 ID
  };
}

// NanoBanana 结果查询响应
export interface NanoBananaResultResponse {
  code: number;
  msg: string;
  data?: {
    id: number;
    task_id?: string;
    status: number;  // 0=处理中, 1=失败, 2=成功 (根据实际 API 返回)
    size?: string;
    prompt?: string;
    fail_reason?: string;
    image_url?: string;  // 生成的图片 URL (API 实际返回的字段名)
    remote_url?: string;  // 备用字段名
    created_at?: string;
    updated_at?: string;
  };
}

// Sora2 视频生成参数
export interface Sora2Params {
  prompt: string;
  duration?: 10 | 15 | 20 | 25;  // Sora2 支持 10/15, Sora2Pro 支持 10/15/20/25
  aspectRatio?: "9:16" | "16:9";
  size?: "small" | "large";
  url?: string;  // 参考图片 URL
}

// Sora2 响应
export interface Sora2Response {
  code: number;
  msg: string;
  data?: {
    id: string;
  };
}

// Sora2 结果响应
export interface Sora2ResultResponse {
  code: number;
  msg: string;
  data?: {
    id: string;
    content: string;
    status: number;  // 0=处理中, 1=成功, 2=失败
    fail_reason?: string;
    remote_url?: string;
    duration?: number;
    aspectRatio?: string;
    created_at?: string;
    updated_at?: string;
  };
}

// 通用任务状态
export interface TaskStatus {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  resultUrl?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// NanoBanana API (图片生成)
// ============================================================================

/**
 * 提交 NanoBanana 图片生成任务
 * 
 * 根据速创 API 文档:
 * - NanoBanana 接口地址: https://api.wuyinkeji.com/api/img/nanoBanana
 *   - 需要 model 参数
 * - NanoBanana-pro 接口地址: https://api.wuyinkeji.com/api/img/nanoBanana-pro
 *   - 不需要 model 和 size 参数
 * - Content-Type: application/json;charset=utf-8
 * - Authorization: 接口密钥
 */
export async function submitNanoBanana(
  params: NanoBananaParams,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = apiKey || API_KEY;
  
  if (!key) {
    return { success: false, error: "API key not configured" };
  }

  try {
    const isPro = params.model === "nano-banana-pro";
    // 根据 model 选择不同的端点
    const endpoint = isPro 
      ? `${API_BASE_URL}/api/img/nanoBanana-pro`
      : `${API_BASE_URL}/api/img/nanoBanana`;

    console.log("[NanoBanana] Submitting task to:", endpoint);
    console.log("[NanoBanana] Params:", {
      model: params.model,
      prompt: params.prompt.substring(0, 50) + "...",
      hasImage: !!params.img_url,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
    });

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      prompt: params.prompt,
    };

    // 普通 NanoBanana 需要 model 参数，Pro 版本不需要
    if (!isPro) {
      requestBody.model = "nano-banana";
    }

    // 添加比例参数
    if (params.aspectRatio && params.aspectRatio !== "auto") {
      requestBody.aspectRatio = params.aspectRatio;
    }

    // 添加参考图片
    if (params.img_url) {
      requestBody.img_url = params.img_url;
    }

    // NanoBanana Pro 支持 imageSize 参数 (1K, 2K, 4K)
    // 注意：API 文档中参数名是 imageSize，K 是大写
    if (isPro && params.resolution) {
      const sizeMap: Record<string, string> = {
        "1k": "1K",
        "2k": "2K",
        "4k": "4K",
      };
      requestBody.imageSize = sizeMap[params.resolution] || "1K";
    }

    console.log("[NanoBanana] Request body:", JSON.stringify(requestBody));

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "Authorization": key,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    console.log("[NanoBanana] Raw response:", responseText);

    let data: NanoBananaResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[NanoBanana] Failed to parse response:", responseText);
      return { success: false, error: "Invalid API response format" };
    }

    console.log("[NanoBanana] Submit response:", {
      code: data.code,
      msg: data.msg,
      taskId: data.data?.id,
    });

    if (data.code === 200 && data.data?.id) {
      return { success: true, taskId: String(data.data.id) };
    }

    return { 
      success: false, 
      error: data.msg || `API error: code ${data.code}` 
    };
  } catch (error) {
    console.error("[NanoBanana] Submit error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

/**
 * 查询 NanoBanana 任务结果
 * 
 * 根据速创 API 文档:
 * - 接口地址: https://api.wuyinkeji.com/api/img/drawDetail
 * - 请求方式: HTTP GET
 * - 请求参数: key (API密钥), id (任务ID)
 * - 此接口支持查询 NanoBanana, NanoBanana-pro, Sora 等图片生成结果
 */
export async function queryNanoBananaResult(
  taskId: string,
  model: "nano-banana" | "nano-banana-pro" = "nano-banana",
  apiKey?: string
): Promise<{ success: boolean; task?: TaskStatus; error?: string }> {
  const key = apiKey || API_KEY;
  
  if (!key) {
    return { success: false, error: "API key not configured" };
  }

  try {
    // 使用通用的图片生成详情查询接口 (GET 请求)
    const endpoint = `${API_BASE_URL}/api/img/drawDetail?key=${encodeURIComponent(key)}&id=${encodeURIComponent(taskId)}`;

    console.log("[NanoBanana] Querying task:", taskId, "at:", `${API_BASE_URL}/api/img/drawDetail`);

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    const responseText = await response.text();
    console.log("[NanoBanana] Query raw response:", responseText.substring(0, 500));

    let data: NanoBananaResultResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[NanoBanana] Failed to parse query response");
      return { success: false, error: "Invalid API response format" };
    }

    // 获取图片 URL (API 可能返回 image_url 或 remote_url)
    const imageUrl = data.data?.image_url || data.data?.remote_url;
    
    console.log("[NanoBanana] Query response:", {
      code: data.code,
      status: data.data?.status,
      hasUrl: !!imageUrl,
      imageUrl: imageUrl,
      failReason: data.data?.fail_reason,
    });

    if (data.code === 200 && data.data) {
      // 根据实际 API 返回，状态码含义：
      // 0 = 处理中 (processing)
      // 1 = 失败 (failed) - 有 fail_reason
      // 2 = 成功 (completed) - 有 image_url
      const statusMap: Record<number, TaskStatus["status"]> = {
        0: "processing",
        1: "failed",
        2: "completed",
      };

      let taskStatus = statusMap[data.data.status] || "processing";
      
      // 如果有图片 URL，即使状态码不是 2，也认为成功
      if (imageUrl && imageUrl.length > 0) {
        taskStatus = "completed";
      }
      
      // 如果状态是 1 或有 fail_reason 且没有图片，则认为失败
      if (data.data.status === 1 || (data.data.fail_reason && !imageUrl)) {
        taskStatus = "failed";
        console.log("[NanoBanana] Task failed:", {
          taskId: data.data.id,
          failReason: data.data.fail_reason,
          fullData: JSON.stringify(data.data).substring(0, 1000),
        });
      }

      return {
        success: true,
        task: {
          taskId: String(data.data.id),
          status: taskStatus,
          resultUrl: imageUrl,
          errorMessage: data.data.fail_reason,
          createdAt: data.data.created_at,
          updatedAt: data.data.updated_at,
        },
      };
    }

    return { success: false, error: data.msg || "Query failed" };
  } catch (error) {
    console.error("[NanoBanana] Query error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

// ============================================================================
// Sora2 API (视频生成)
// ============================================================================

/**
 * 提交 Sora2 视频生成任务
 * 
 * 注意: 
 * - sora2 端点支持 10s, 15s
 * - sora2pro 端点支持 10s, 15s, 20s, 25s
 */
export async function submitSora2(
  params: Sora2Params,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = apiKey || API_KEY;
  
  if (!key) {
    return { success: false, error: "API key not configured" };
  }

  try {
    // 根据时长选择端点: 20s 和 25s 需要使用 sora2pro 端点
    const usePro = params.duration && params.duration >= 20;
    const endpoint = usePro
      ? `${API_BASE_URL}/api/sora2pro/submit`
      : `${API_BASE_URL}/api/sora2/submit`;

    console.log("[Sora2] Submitting task:", {
      endpoint: usePro ? "sora2pro" : "sora2",
      prompt: params.prompt.substring(0, 50) + "...",
      duration: params.duration || 10,
      aspectRatio: params.aspectRatio || "9:16",
      hasImage: !!params.url,
    });

    const response = await fetch(endpoint, {
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

    const data: Sora2Response = await response.json();

    console.log("[Sora2] Submit response:", {
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
    console.error("[Sora2] Submit error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

/**
 * 查询 Sora2 任务结果
 */
export async function querySora2Result(
  taskId: string,
  usePro: boolean = false,
  apiKey?: string
): Promise<{ success: boolean; task?: TaskStatus; error?: string; raw?: Sora2ResultResponse }> {
  const key = apiKey || API_KEY;
  
  if (!key) {
    return { success: false, error: "API key not configured" };
  }

  try {
    const endpoint = usePro
      ? `${API_BASE_URL}/api/sora2pro/detail`
      : `${API_BASE_URL}/api/sora2/detail`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        key,
        id: taskId,
      }),
    });

    const data: Sora2ResultResponse = await response.json();

    console.log("[Sora2] Query response:", {
      code: data.code,
      status: data.data?.status,
      hasUrl: !!data.data?.remote_url,
    });

    if (data.code === 200 && data.data) {
      const statusMap: Record<number, TaskStatus["status"]> = {
        0: "processing",
        1: "completed",
        2: "failed",
      };

      return {
        success: true,
        task: {
          taskId: data.data.id || taskId,
          status: statusMap[data.data.status] || "processing",
          resultUrl: data.data.remote_url,
          errorMessage: data.data.fail_reason,
          createdAt: data.data.created_at,
          updatedAt: data.data.updated_at,
        },
        raw: data,
      };
    }

    return { success: false, error: data.msg || "Query failed", raw: data };
  } catch (error) {
    console.error("[Sora2] Query error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Network error" 
    };
  }
}

// ============================================================================
// 图片增强 - 放大高清 (Upscale)
// ============================================================================

/**
 * 图片放大高清
 * 使用 NanoBanana 的图片增强能力
 */
export async function upscaleImage(
  imageUrl: string,
  targetResolution: "2k" | "4k" = "2k",
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  // 使用 NanoBanana Pro 进行高清放大
  const upscalePrompt = `Enhance and upscale this image to ${targetResolution} resolution. Maintain all original details, improve sharpness, clarity and quality. Preserve the exact composition, colors, and content. Professional high-resolution enhancement.`;
  
  return submitNanoBanana({
    model: "nano-banana-pro",
    prompt: upscalePrompt,
    img_url: imageUrl,
    aspectRatio: "auto",  // 保持原比例
    resolution: targetResolution,
  }, apiKey);
}

// ============================================================================
// 图片增强 - 九宫格多角度
// ============================================================================

/**
 * 生成产品九宫格多角度图
 * 使用 NanoBanana 生成产品的多角度展示图
 */
export async function generateNineGrid(
  imageUrl: string,
  productDescription?: string,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  // 九宫格提示词 - 生成产品的多角度展示
  const gridPrompt = `Create a professional 3x3 grid layout showing 9 different angles and views of the product in the image. 
Include:
- Front view (center)
- Back view
- Left side view  
- Right side view
- Top view
- Bottom view
- 45-degree angle views (2-3 variations)
- Detail/close-up shot

Each view should be:
- On a clean white/neutral background
- Professionally lit with soft shadows
- High quality product photography style
- Consistent lighting across all views
- Sharp focus on product details

${productDescription ? `Product description: ${productDescription}` : ""}

Output as a single image with 3x3 grid layout, each cell showing a different angle of the same product.`;

  return submitNanoBanana({
    model: "nano-banana-pro",
    prompt: gridPrompt,
    img_url: imageUrl,
    aspectRatio: "1:1",  // 九宫格使用正方形
    resolution: "2k",
  }, apiKey);
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 等待任务完成
 */
export async function waitForTaskCompletion(
  taskId: string,
  queryFn: (taskId: string) => Promise<{ success: boolean; task?: TaskStatus; error?: string }>,
  options?: {
    maxWaitTime?: number;
    pollInterval?: number;
    onProgress?: (task: TaskStatus) => void;
  }
): Promise<{ success: boolean; task?: TaskStatus; error?: string }> {
  const {
    maxWaitTime = 5 * 60 * 1000,  // 5 分钟
    pollInterval = 10 * 1000,     // 10 秒
    onProgress,
  } = options || {};

  const startTime = Date.now();
  let lastTask: TaskStatus | undefined;

  while (true) {
    const elapsedTime = Date.now() - startTime;

    if (elapsedTime >= maxWaitTime) {
      return {
        success: false,
        task: lastTask,
        error: "Task timeout",
      };
    }

    const result = await queryFn(taskId);

    if (!result.success) {
      await sleep(pollInterval);
      continue;
    }

    lastTask = result.task;

    if (onProgress && lastTask) {
      onProgress(lastTask);
    }

    if (lastTask?.status === "completed") {
      return { success: true, task: lastTask };
    }

    if (lastTask?.status === "failed") {
      return {
        success: false,
        task: lastTask,
        error: lastTask.errorMessage || "Task failed",
      };
    }

    await sleep(pollInterval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 测试 API 连接
 */
export async function testApiConnection(apiKey?: string): Promise<{
  success: boolean;
  message: string;
}> {
  const key = apiKey || API_KEY;
  
  if (!key) {
    return { success: false, message: "API key not configured" };
  }

  try {
    // 测试 NanoBanana 连接
    const result = await submitNanoBanana({
      model: "nano-banana",
      prompt: "A simple test image of a red apple",
      aspectRatio: "1:1",
    }, key);

    if (result.success) {
      return {
        success: true,
        message: `API connection successful. Task ID: ${result.taskId}`,
      };
    }

    return { success: false, message: result.error || "Unknown error" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

