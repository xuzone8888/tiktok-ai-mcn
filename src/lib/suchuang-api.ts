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
    // 注意：如果有参考图片，需要在提示词中明确指出如何基于参考图生成
    let finalPrompt = params.prompt;
    
    // 如果有参考图片，增强提示词以确保 AI 理解需要基于参考图进行创作
    if (params.img_url && params.prompt) {
      // 检查提示词是否已经包含参考图的相关指令
      const hasReferenceKeywords = /reference|参考|based on|基于|style of|风格/i.test(params.prompt);
      
      if (!hasReferenceKeywords) {
        // 为提示词添加参考图指令，确保 AI 根据提示词和参考图生成新内容
        finalPrompt = `Create a new image based on the reference image provided. Transform it according to this description: ${params.prompt}. Use the reference image as a style and composition guide, but generate new creative content following the prompt instructions.`;
      }
    }
    
    const requestBody: Record<string, unknown> = {
      prompt: finalPrompt,
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          "Authorization": key,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const responseText = await response.text();
      console.log("[NanoBanana] Raw response:", responseText);

      let data: NanoBananaResponse;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error("[NanoBanana] Failed to parse response:", responseText);
        return { success: false, error: "API 响应格式错误，请稍后重试" };
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
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.error("[NanoBanana] Fetch error:", fetchError);
      
      // 判断是否是网络超时
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return { success: false, error: "请求超时，请稍后重试" };
      }
      
      // 网络错误时返回更友好的提示
      return { 
        success: false, 
        error: fetchError instanceof Error ? `网络错误: ${fetchError.message}` : "网络连接失败" 
      };
    }
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
      return { success: false, error: "任务查询响应格式错误" };
    }

    // 重要修复：只使用 image_url 作为结果 URL，不使用 remote_url
    // remote_url 是原图，image_url 才是 AI 生成的结果图
    const imageUrl = data.data?.image_url;
    
    console.log("[NanoBanana] Query response:", {
      code: data.code,
      status: data.data?.status,
      hasGeneratedUrl: !!imageUrl,
      generatedUrl: imageUrl,
      sourceUrl: data.data?.remote_url,
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
      
      // 重要修复：只有当状态为 2 (completed) 且有图片 URL 时才认为成功
      // 不能仅凭有 URL 就认为成功，因为处理中也可能返回源图片 URL
      if (data.data.status === 2 && imageUrl && imageUrl.length > 0) {
        taskStatus = "completed";
      } else if (data.data.status === 0) {
        // 处理中状态，即使有 URL 也不认为完成
        taskStatus = "processing";
      }
      
      // 如果状态是 1 或有 fail_reason 且没有图片，则认为失败
      if (data.data.status === 1 || (data.data.fail_reason && data.data.status !== 2)) {
        taskStatus = "failed";
        console.log("[NanoBanana] Task failed:", {
          taskId: data.data.id,
          failReason: data.data.fail_reason,
          fullData: JSON.stringify(data.data).substring(0, 1000),
        });
      }

      // 只有在任务完成时才返回结果 URL
      const finalResultUrl = taskStatus === "completed" ? imageUrl : undefined;

      return {
        success: true,
        task: {
          taskId: String(data.data.id),
          status: taskStatus,
          resultUrl: finalResultUrl,
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
// Sora2 API (视频生成) - 新版 API
// 文档: https://k0qzjtg1od.apifox.cn/384599477e0
// ============================================================================

// 新版 Sora2 API 端点 (生产队API)
const SORA2_API_BASE = "https://api_scddl.scd666.com";
const SORA2_API_KEY = process.env.SORA2_API_KEY || "";

/**
 * Sora2 模型类型
 * 
 * 标清版 (3-5分钟):
 * - sora2-portrait: 竖屏 10秒
 * - sora2-landscape: 横屏 10秒
 * - sora2-portrait-15s: 竖屏 15秒
 * - sora2-landscape-15s: 横屏 15秒
 * 
 * Pro版 (15-30分钟):
 * - sora2-pro-portrait-hd-15s: 竖屏 15秒 高清
 * - sora2-pro-landscape-hd-15s: 横屏 15秒 高清
 * - sora2-pro-portrait-25s: 竖屏 25秒
 * - sora2-pro-landscape-25s: 横屏 25秒
 */
export type Sora2ModelType = 
  | "sora2-portrait"           // 竖屏 10秒 标清
  | "sora2-landscape"          // 横屏 10秒 标清
  | "sora2-portrait-15s"       // 竖屏 15秒 标清
  | "sora2-landscape-15s"      // 横屏 15秒 标清
  | "sora2-pro-portrait-hd-15s"    // 竖屏 15秒 高清 Pro
  | "sora2-pro-landscape-hd-15s"   // 横屏 15秒 高清 Pro
  | "sora2-pro-portrait-25s"       // 竖屏 25秒 标清 Pro
  | "sora2-pro-landscape-25s";     // 横屏 25秒 标清 Pro

/**
 * 根据参数获取 Sora2 模型名称
 */
export function getSora2ModelName(
  aspectRatio: "9:16" | "16:9",
  duration: 10 | 15 | 25,
  quality: "standard" | "hd"
): Sora2ModelType {
  const isPortrait = aspectRatio === "9:16";
  const isPro = quality === "hd" || duration === 25;
  
  if (duration === 10) {
    return isPortrait ? "sora2-portrait" : "sora2-landscape";
  } else if (duration === 15) {
    if (quality === "hd") {
      return isPortrait ? "sora2-pro-portrait-hd-15s" : "sora2-pro-landscape-hd-15s";
    }
    return isPortrait ? "sora2-portrait-15s" : "sora2-landscape-15s";
  } else if (duration === 25) {
    return isPortrait ? "sora2-pro-portrait-25s" : "sora2-pro-landscape-25s";
  }
  
  // 默认返回 15 秒标清
  return isPortrait ? "sora2-portrait-15s" : "sora2-landscape-15s";
}

/**
 * 新版 Sora2 响应类型
 * 
 * 提交响应 (POST /v1/videos):
 * - id, object, model, status, progress, created_at, size
 * 
 * 查询响应 (GET /v1/videos/{id}):
 * - 同上 + video_url, completed_at
 */
interface Sora2SubmitResponse {
  id: string;
  object: string;
  model: string;
  status: string;  // "queued" | "processing" | "completed" | "failed"
  progress: number;
  created_at: number;
  completed_at?: number;
  size: string;
  video_url?: string;  // 任务完成后返回
  error?: {
    message: string;
  };
}

/**
 * 提交 Sora2 视频生成任务（新版 API）
 * 
 * API 端点: POST /v1/videos
 * 文档: https://k0qzjtg1od.apifox.cn/384599477e0
 */
export async function submitSora2(
  params: Sora2Params & { model?: Sora2ModelType },
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = apiKey || SORA2_API_KEY || API_KEY;
  
  if (!key) {
    return { success: false, error: "Sora2 API key not configured" };
  }

  try {
    // 获取模型名称
    const model = params.model || getSora2ModelName(
      params.aspectRatio || "9:16",
      (params.duration as 10 | 15 | 25) || 15,
      "standard"
    );
    
    const endpoint = `${SORA2_API_BASE}/v1/videos`;

    console.log("[Sora2] Submitting task:", {
      endpoint,
      model,
      prompt: params.prompt.substring(0, 50) + "...",
      hasImage: !!params.url,
    });

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      prompt: params.prompt,
      model: model,
    };

    // 如果有参考图片，添加到请求体（图生视频）
    // 文档: https://k0qzjtg1od.apifox.cn/384599479e0
    // 参数名: image_url
    if (params.url) {
      requestBody.image_url = params.url;
    }

    // 添加超时控制和重试
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时
    
    let response: Response;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`,
            "Accept": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        break; // 成功则跳出循环
      } catch (fetchError) {
        retryCount++;
        if (retryCount > maxRetries) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
        console.log(`[Sora2] Retry ${retryCount}/${maxRetries} after error:`, fetchError);
        await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒后重试
      }
    }
    
    clearTimeout(timeoutId);

    const responseText = await response!.text();
    console.log("[Sora2] Raw response:", responseText.substring(0, 500));

    let data: Sora2SubmitResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[Sora2] Failed to parse response:", responseText);
      return { success: false, error: "视频生成服务响应格式错误，请稍后重试" };
    }

    console.log("[Sora2] Submit response:", {
      id: data.id,
      status: data.status,
      model: data.model,
      progress: data.progress,
    });

    // 检查是否有错误
    if (data.error?.message) {
      return { success: false, error: data.error.message };
    }

    if (data.id) {
      return { success: true, taskId: data.id };
    }

    return { 
      success: false, 
      error: "API 未返回任务ID，视频生成服务可能暂时不可用" 
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
 * 查询 Sora2 任务结果（新版 API）
 * 
 * API 端点: GET /v1/videos/{id}
 */
export async function querySora2Result(
  taskId: string,
  usePro: boolean = false,
  apiKey?: string
): Promise<{ success: boolean; task?: TaskStatus; error?: string; raw?: unknown }> {
  const key = apiKey || SORA2_API_KEY || API_KEY;
  
  if (!key) {
    return { success: false, error: "Sora2 API key not configured" };
  }

  try {
    const endpoint = `${SORA2_API_BASE}/v1/videos/${taskId}`;

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    const responseText = await response.text();
    
    let data: Sora2SubmitResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[Sora2] Failed to parse query response");
      return { success: false, error: "视频任务查询响应格式错误" };
    }

    console.log("[Sora2] Query response:", {
      id: data.id,
      status: data.status,
      progress: data.progress,
      hasUrl: !!data.video_url,
    });

    // 状态映射
    const statusMap: Record<string, TaskStatus["status"]> = {
      "queued": "pending",
      "processing": "processing",
      "completed": "completed",
      "failed": "failed",
    };

    const taskStatus = statusMap[data.status] || "processing";

    return {
      success: true,
      task: {
        taskId: data.id || taskId,
        status: taskStatus,
        resultUrl: data.video_url,
        errorMessage: data.error?.message,
      },
      raw: data,
    };
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
 * 
 * 优化适配 Sora2/Sora2 Pro 视频生成：
 * - 突出产品角度+细节，AI生成友好
 * - 画面构图简洁、光线均匀（自然光质感）
 * - 背景纯色（白底），便于 Sora 精准渲染高清细节
 */
export async function generateNineGrid(
  imageUrl: string,
  productDescription?: string,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  // 九宫格提示词 - 适配 Sora2/Sora2 Pro 视频生成
  const gridPrompt = `Create a professional 3x3 grid layout (9 cells) optimized for Sora2 AI video generation.

【核心要求】
- 画面构图简洁干净
- 光线均匀，自然光质感，无强烈阴影
- 背景纯白色，无杂质无纹理
- 每个镜头展示产品的不同角度和细节
- 所有镜头统一分辨率，比例1:1
- 画面无畸变，边缘清晰

【9个角度布局】
1. 正面全貌（居中，主视角）
2. 背面全貌
3. 左侧45度角
4. 右侧45度角
5. 俯视角度（顶部视图）
6. 仰视角度或底部细节
7. 产品核心细节特写1
8. 产品核心细节特写2
9. 使用场景或整体氛围展示

【图片质量要求】
- 高清晰度，细节锐利
- 产品主体突出，占画面60-80%
- 色彩真实准确
- 便于Sora AI精准识别和渲染

${productDescription ? `产品描述: ${productDescription}` : ""}

Output as a single 1:1 square image with perfect 3x3 grid layout, white background, ready for Sora2 video generation.`;

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

