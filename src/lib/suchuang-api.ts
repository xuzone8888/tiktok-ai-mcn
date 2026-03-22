/**
 * 速创 API 统一接口
 * 
 * 2026-03-19 重构：
 * - line1 (scd666) 和 line2 (望京) 已剔除，仅 line3 (无印科技 wuyinkeji) 可用
 * - NanoBanana 已替换为 Gemini Image，保留查询函数兼容历史任务
 * - 新增角色创建接口 (sora2_character)
 *
 * 文档:
 * - Sora2-NEW: https://api.wuyinkeji.com/doc/40
 * - 角色创建: /api/async/video_sora_character
 */

import https from 'https';

// ============================================================================
// 配置
// ============================================================================

const API_BASE_URL = process.env.SUCHUANG_API_ENDPOINT || "https://api.wuyinkeji.com";
const API_KEY = process.env.SUCHUANG_API_KEY || "";

// @deprecated 备用线路 (line2) - 望景API - 已剔除，保留配置避免引用报错
const WANGJING_API_BASE = process.env.WANGJING_API_ENDPOINT || "http://60.205.120.27:35208";
const WANGJING_API_KEY = process.env.WANGJING_API_KEY || "";

// 备用线路2 (line3) - 无印科技 sora2-new (老接口格式, form-urlencoded)
const WUYINKEJI_API_BASE = "https://api.wuyinkeji.com";
const WUYINKEJI_API_KEY = process.env.WUYINKEJI_API_KEY || "";

// Gemini 3 Pro Image - xas231 代理 (需要 stream:true 模式)
const GEMINI_IMAGE_API_BASE = process.env.GEMINI_IMAGE_API_ENDPOINT || "https://api.xas231.online";
const GEMINI_IMAGE_API_KEY = process.env.GEMINI_IMAGE_API_KEY || "";

// 注意：Sora2 API 使用 https.request 并强制 IPv4
// 因为 Cloudflare 的 IPv6 在阿里云服务器上不可达

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
// 从环境变量读取，支持动态切换
const SORA2_API_BASE = process.env.SORA2_API_ENDPOINT || "https://api.scd666.com";
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
 * 
 * @param apiLine - API 线路选择
 * 线路支持：
 *   - line1=默认(scd666)
 *   - line2=望景API(OpenAI兼容格式)
 *   - line3=无印科技(sora2-new, 仅支持10/15秒, 0.5元/次)
 */
export async function submitSora2(
  params: Sora2Params & { model?: Sora2ModelType },
  apiKey?: string,
  apiLine: "line1" | "line2" | "line3" = "line3"
): Promise<{ success: boolean; taskId?: string; error?: string }> {

  // ========== Line2: 望景API (OpenAI 兼容格式) ==========
  if (apiLine === "line2") {
    const key = WANGJING_API_KEY;
    if (!key) {
      return { success: false, error: "备用线路 API 未配置，请联系管理员" };
    }

    // 望景API 支持 10/15 秒
    const duration = params.duration || 15;
    if (duration !== 10 && duration !== 15) {
      return { success: false, error: "望景API 备用线路仅支持 10 秒和 15 秒视频" };
    }

    // 根据 aspectRatio 映射 size 参数
    const aspectRatio = params.aspectRatio || "9:16";
    const size = aspectRatio === "16:9" ? "1280x720" : "720x1280";

    // 文档请求示例使用 sora-2，网关根据 size/seconds 自动映射具体模型
    // 可用模型: sora-2, sora2-portrait-10s, sora2-portrait-15s, sora2-landscape-10s, sora2-landscape-15s
    const orientation = aspectRatio === "16:9" ? "landscape" : "portrait";

    try {
      const endpoint = `${WANGJING_API_BASE}/v1/videos`;
      const requestBody = JSON.stringify({
        model: "sora-2",
        prompt: params.prompt,
        seconds: String(duration),
        size,
        ...(params.url && { image: params.url }),
      });

      console.log("[Sora2-Wangjing] Submitting task:", {
        endpoint,
        duration,
        size,
        aspectRatio,
        prompt: params.prompt.substring(0, 50) + "...",
        hasImage: !!params.url,
      });

      // 发送 POST 请求 (使用 http 因为望景API 是 http 协议)
      const urlObj = new URL(endpoint);
      const httpModule = urlObj.protocol === 'https:' ? https : await import('http');

      const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname,
          method: 'POST',
          family: 4,
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
          },
        };

        const req = httpModule.request(options, (res: import('http').IncomingMessage) => {
          let data = '';
          res.on('data', (chunk: string) => data += chunk);
          res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        req.write(requestBody);
        req.end();
      });

      console.log("[Sora2-Wangjing] Response:", result.data.substring(0, 300));

      const data = JSON.parse(result.data);

      // 检查错误响应
      if (data.error) {
        return { success: false, error: data.error.message || data.error.code || "望景API 错误" };
      }

      // 成功响应：返回 task_id 或 id
      const taskId = data.task_id || data.id;
      if (taskId) {
        return { success: true, taskId };
      }

      return { success: false, error: "望景API 未返回任务ID" };
    } catch (error) {
      console.error("[Sora2-Wangjing] Submit error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error"
      };
    }
  }

  // ========== Line3: 无印科技 sora2-new (老接口格式) ==========
  if (apiLine === "line3") {
    const key = WUYINKEJI_API_KEY;
    if (!key) {
      return { success: false, error: "备用线路2 (无印科技) API 未配置，请联系管理员" };
    }

    const duration = params.duration || 10;
    if (duration !== 10 && duration !== 15) {
      return { success: false, error: "无印科技 sora2-new 仅支持 10 秒和 15 秒视频" };
    }

    const aspectRatio = params.aspectRatio || "9:16";

    try {
      const endpoint = `${WUYINKEJI_API_BASE}/api/sora2-new/submit`;
      const formBody = new URLSearchParams({
        prompt: params.prompt,
        duration: String(duration),
        aspectRatio: aspectRatio,
        size: 'small',
        ...(params.url && { url: params.url }),
      }).toString();

      console.log("[Sora2-Wuyinkeji] Submitting task:", {
        endpoint,
        duration,
        aspectRatio,
        prompt: params.prompt.substring(0, 50) + "...",
        hasImage: !!params.url,
      });

      const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
        const urlObj = new URL(endpoint);
        const options = {
          hostname: urlObj.hostname,
          port: 443,
          path: urlObj.pathname,
          method: 'POST',
          family: 4,
          timeout: 60000,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'Authorization': key,
            'Content-Length': Buffer.byteLength(formBody),
          },
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk: string) => data += chunk);
          res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        req.write(formBody);
        req.end();
      });

      console.log("[Sora2-Wuyinkeji] Response:", result.data.substring(0, 300));
      const data = JSON.parse(result.data);

      if (data.code !== 200) {
        return { success: false, error: data.msg || "无印科技 API 提交失败" };
      }

      const taskId = data.data?.id;
      if (!taskId) {
        return { success: false, error: "无印科技 API 未返回任务 ID" };
      }

      console.log("[Sora2-Wuyinkeji] Task submitted:", taskId);
      return { success: true, taskId };
    } catch (error) {
      console.error("[Sora2-Wuyinkeji] Submit error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error"
      };
    }
  }

  // ========== Line1: 速创 API (OpenAI 兼容格式) ==========
  // 以下代码仅处理 line1，line2（吾音科技）已在上面处理完毕
  const apiBase = SORA2_API_BASE;
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

    const endpoint = `${apiBase}/v1/videos`;

    console.log("[Sora2] Submitting task:", {
      endpoint,
      apiLine,
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

    // 使用 https.request 并强制 IPv4（解决 IPv6 超时问题）
    const bodyStr = JSON.stringify(requestBody);
    let retryCount = 0;
    const maxRetries = 3;
    let responseText = '';
    let statusCode = 0;

    while (retryCount <= maxRetries) {
      try {
        const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
          const url = new URL(endpoint);
          const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'POST',
            family: 4, // 强制 IPv4
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`,
              'Accept': 'application/json',
              'Content-Length': Buffer.byteLength(bodyStr),
            },
            timeout: 120000, // 2分钟超时
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
          });

          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
          });

          req.write(bodyStr);
          req.end();
        });

        responseText = result.data;
        statusCode = result.statusCode;

        // 如果是 5xx 服务器错误，进行重试
        if (statusCode >= 500 && statusCode < 600) {
          throw new Error(`Server error: ${statusCode}`);
        }

        break; // 成功则跳出循环
      } catch (fetchError) {
        retryCount++;
        if (retryCount > maxRetries) {
          throw fetchError;
        }
        const waitTime = 3000 * retryCount;
        console.log(`[Sora2] Retry ${retryCount}/${maxRetries} after error, waiting ${waitTime}ms:`, fetchError);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    console.log("[Sora2] Raw response (status: " + statusCode + "):", responseText.substring(0, 500));

    // 检查 HTTP 状态码
    if (statusCode >= 500) {
      console.error(`[Sora2] Server error ${statusCode}:`, responseText.substring(0, 200));
      return {
        success: false,
        error: `视频服务暂时繁忙 (${statusCode})，请稍后重试`
      };
    }

    let data: Sora2SubmitResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[Sora2] Failed to parse response:", responseText.substring(0, 500));
      // 检查是否是 HTML 错误页面
      if (responseText.includes("<!DOCTYPE") || responseText.includes("<html")) {
        return { success: false, error: "视频服务网关错误，请稍后重试" };
      }
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
 * 
 * @param apiLine - API 线路选择
 *   - line1=默认(scd666)
 *   - line2=望景API(OpenAI兼容格式)
 *   - line3=无印科技(sora2-new/detail)
 */
export async function querySora2Result(
  taskId: string,
  usePro: boolean = false,
  apiKey?: string,
  apiLine: "line1" | "line2" | "line3" = "line3"
): Promise<{ success: boolean; task?: TaskStatus; error?: string; raw?: unknown }> {

  // ========== Line2: 望景API 查询 (OpenAI 兼容格式) ==========
  if (apiLine === "line2") {
    const key = WANGJING_API_KEY;
    if (!key) {
      return { success: false, error: "备用线路 API 未配置，请联系管理员" };
    }

    try {
      const endpoint = `${WANGJING_API_BASE}/v1/videos/${taskId}`;
      const urlObj = new URL(endpoint);
      // 新增：使用 link_mode=esa 利用加速链提高下载稳定性
      urlObj.searchParams.set('link_mode', 'esa');
      const httpModule = urlObj.protocol === 'https:' ? https : await import('http');

      console.log("[Sora2-Wangjing] Querying task:", taskId);

      const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          family: 4,
          timeout: 60000,
          headers: {
            'Authorization': `Bearer ${key}`,
          },
        };

        const req = httpModule.request(options, (res: import('http').IncomingMessage) => {
          let data = '';
          res.on('data', (chunk: string) => data += chunk);
          res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        req.end();
      });

      const data = JSON.parse(result.data);

      // 错误响应
      if (data.error) {
        return { success: false, error: data.error.message || "望景API 查询失败" };
      }

      // 望景API 状态：queued, in_progress, completed, failed
      const wangjingStatusMap: Record<string, TaskStatus["status"]> = {
        "queued": "processing",
        "in_progress": "processing",
        "completed": "completed",
        "failed": "failed",
      };

      const taskStatus = wangjingStatusMap[data.status] ?? "processing";

      // 获取视频URL：completed 时可能在 output.url 或需要通过 /content 端点
      let videoUrl = data.output?.url || data.video_url || null;

      // 如果已完成但没有直接URL，尝试 /content 端点
      if (taskStatus === "completed" && !videoUrl) {
        videoUrl = `${WANGJING_API_BASE}/v1/videos/${taskId}/content`;
      }

      console.log("[Sora2-Wangjing] Query response:", {
        id: data.id || taskId,
        status: data.status,
        mappedStatus: taskStatus,
        progress: data.progress,
        hasUrl: !!videoUrl,
      });

      return {
        success: true,
        task: {
          taskId: data.id || data.task_id || taskId,
          status: taskStatus,
          resultUrl: videoUrl,
          errorMessage: data.error?.message || data.fail_reason,
        },
        raw: data,
      };
    } catch (error) {
      console.error("[Sora2-Wangjing] Query error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error"
      };
    }
  }

  // ========== Line3: 无印科技 sora2/detail ==========
  if (apiLine === "line3") {
    const key = WUYINKEJI_API_KEY;
    if (!key) {
      return { success: false, error: "备用线路2 (无印科技) API 未配置" };
    }

    try {
      const endpoint = `${WUYINKEJI_API_BASE}/api/sora2/detail?key=${encodeURIComponent(key)}&id=${encodeURIComponent(taskId)}`;

      console.log("[Sora2-Wuyinkeji] Querying task:", taskId);

      const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
        const urlObj = new URL(endpoint);
        const options = {
          hostname: urlObj.hostname,
          port: 443,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          family: 4,
          timeout: 60000,
          headers: {
            'Authorization': key,
          },
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk: string) => data += chunk);
          res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        req.end();
      });

      const data = JSON.parse(result.data);

      if (data.code !== 200) {
        return { success: false, error: data.msg || "无印科技 查询失败" };
      }

      const taskData = data.data || data;

      // 无印科技状态：0=处理中, 1=成功, 2=失败
      // 注意：status=2 时 fail_reason 有值且 remote_url 为空
      const wuyinkejiStatusMap: Record<number, TaskStatus["status"]> = {
        0: "processing",
        1: "completed",
        2: "failed",
      };

      let taskStatus = wuyinkejiStatusMap[taskData.status] ?? "processing";
      // 容错：即使 status!=2 但有 fail_reason 且无 URL，也视为失败
      if (taskData.fail_reason && !taskData.remote_url && !taskData.transfer_url) {
        taskStatus = "failed";
      }
      const videoUrl = taskData.transfer_url || taskData.remote_url || null;

      console.log("[Sora2-Wuyinkeji] Query response:", {
        id: taskData.id || taskId,
        status: taskData.status,
        mappedStatus: taskStatus,
        hasUrl: !!videoUrl,
        failReason: taskData.fail_reason,
      });

      return {
        success: true,
        task: {
          taskId: taskData.id || taskId,
          status: taskStatus,
          resultUrl: videoUrl,
          errorMessage: taskData.fail_reason,
        },
        raw: data,
      };
    } catch (error) {
      console.error("[Sora2-Wuyinkeji] Query error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error"
      };
    }
  }

  // ========== Line1: 速创 API (OpenAI 兼容格式) ==========
  // 以下代码仅处理 line1，line2（吾音科技）已在上面处理完毕
  const apiBase = SORA2_API_BASE;
  const key = apiKey || SORA2_API_KEY || API_KEY;

  if (!key) {
    return { success: false, error: "Sora2 API key not configured" };
  }

  try {
    const endpoint = `${apiBase}/v1/videos/${taskId}`;

    // 使用 https.request 并强制 IPv4（解决 IPv6 超时问题）
    let retryCount = 0;
    const maxRetries = 2;
    let responseText = '';
    let statusCode = 0;

    while (retryCount <= maxRetries) {
      try {
        const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
          const url = new URL(endpoint);
          const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'GET',
            family: 4, // 强制 IPv4
            headers: {
              'Authorization': `Bearer ${key}`,
              'Accept': 'application/json',
            },
            timeout: 60000, // 60秒超时
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
          });

          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
          });

          req.end();
        });

        responseText = result.data;
        statusCode = result.statusCode;

        // 如果是 5xx 服务器错误，进行重试
        if (statusCode >= 500 && statusCode < 600) {
          throw new Error(`Server error: ${statusCode}`);
        }

        break;
      } catch (fetchError) {
        retryCount++;
        if (retryCount > maxRetries) {
          throw fetchError;
        }
        console.log(`[Sora2] Query retry ${retryCount}/${maxRetries}:`, fetchError);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!responseText) {
      return { success: false, error: "网络请求失败，请稍后重试" };
    }

    // 检查 HTTP 状态码
    if (statusCode >= 500) {
      console.error(`[Sora2] Query server error ${statusCode}:`, responseText.substring(0, 200));
      return { success: false, error: `视频服务暂时繁忙 (${statusCode})，请稍后重试` };
    }

    let data: Sora2SubmitResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[Sora2] Failed to parse query response:", responseText.substring(0, 200));
      // 检查是否是 HTML 错误页面
      if (responseText.includes("<!DOCTYPE") || responseText.includes("<html")) {
        return { success: false, error: "视频服务网关错误，请稍后重试" };
      }
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


// ============================================================================
// Gemini 3 Pro Image API (图片生成 - 同步返回)
// ============================================================================

export interface GeminiImageParams {
  prompt: string;
  sourceImageUrl?: string;   // 可选的单张参考图片（向下兼容）
  sourceImageUrls?: string[]; // 可选的多张参考图片（新增，优先使用）
  aspectRatio?: string;      // 图片比例 如 "9:16", "16:9", "1:1"
  resolution?: string;       // 分辨率 如 "1024x1024"
}

export interface GeminiImageResult {
  success: boolean;
  imageBase64?: string;  // Base64 编码的图片数据
  imageUrl?: string;     // 如果上传到 OSS 后的 URL
  processing?: boolean;  // 524 超时时返回 true，表示可能还在处理中
  error?: string;
}

/**
 * 使用 Gemini 3 Pro Image 生成图片
 * 
 * 特点：
 * - 同步返回，无需轮询
 * - 返回 Base64 编码的 JPEG 图片
 * - 价格便宜（约 ¥0.02/张）
 * - 分辨率约 1K-1.5K
 * 
 * @param params 图片生成参数
 */
export async function generateGeminiImage(
  params: GeminiImageParams
): Promise<GeminiImageResult> {
  const key = GEMINI_IMAGE_API_KEY;

  if (!key) {
    return { success: false, error: "Gemini Image API key not configured" };
  }

  try {
    // 构建文本提示词
    let textContent = params.prompt;
    if (params.aspectRatio && params.aspectRatio !== "auto") {
      textContent = `生成的图片请使用 ${params.aspectRatio} 的宽高比例。${textContent}`;
    }

    // 根据比例选择模型（landscape 或 portrait）
    const isPortrait = params.aspectRatio === "9:16" || params.aspectRatio === "3:4" || params.aspectRatio === "2:3";
    const geminiModel = isPortrait
      ? "gemini-3.0-pro-image-portrait-2k"
      : "gemini-3.0-pro-image-landscape-2k";

    // 构建消息内容：
    // - 图生图模式：使用数组格式（上游 API 支持 image_url，会下载图片）
    // - 纯文本生图：使用字符串格式（上游 API 要求）
    let messageContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

    // 合并 sourceImageUrls 和 sourceImageUrl（向下兼容）
    const allImageUrls = params.sourceImageUrls?.length
      ? params.sourceImageUrls
      : (params.sourceImageUrl ? [params.sourceImageUrl] : []);

    if (allImageUrls.length > 0) {
      // 图生图：使用数组格式，API 会下载并参考源图（支持多张）
      messageContent = [
        { type: "text", text: textContent },
        ...allImageUrls.map(url => ({ type: "image_url" as const, image_url: { url } })),
      ];
      console.log(`[Gemini-Image] Image-to-image mode, ${allImageUrls.length} reference image(s):`, allImageUrls.map(u => u.substring(0, 60)));
    } else {
      // 纯文本生图：使用字符串格式
      messageContent = textContent;
      console.log("[Gemini-Image] Text-to-image mode, using string content format");
    }

    const messages = [
      { role: "user", content: messageContent }
    ];

    const requestBody = JSON.stringify({
      model: geminiModel,
      messages,
      stream: true,  // 新 API 必须使用流式模式
    });

    console.log("[Gemini-Image] Generating image:", {
      prompt: params.prompt.substring(0, 50) + "...",
      hasSourceImage: !!params.sourceImageUrl,
      model: geminiModel,
      streaming: true,
    });

    // 使用流式请求（新 API 要求 stream:true）
    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const url = new URL(`${GEMINI_IMAGE_API_BASE}/v1/chat/completions`);
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        family: 4,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'Content-Length': Buffer.byteLength(requestBody),
        },
        timeout: 300000, // 5分钟超时（图片生成可能需要2-3分钟）
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(requestBody);
      req.end();
    });

    if (result.statusCode !== 200) {
      console.error("[Gemini-Image] API error:", result.statusCode, result.data.substring(0, 300));

      // 524 = Cloudflare 超时
      if (result.statusCode === 524) {
        console.log("[Gemini-Image] 524 Cloudflare timeout - API may still be processing");
        return {
          success: true,
          processing: true,
          error: "Gemini API 正在处理中，请等待结果..."
        };
      }

      // 解析错误信息
      let errorMessage = `Gemini API 错误 (${result.statusCode})`;
      try {
        const errorData = JSON.parse(result.data);
        const rawMessage = errorData.error?.message || "";
        if (result.statusCode === 403) {
          if (rawMessage.includes("额度不足")) {
            errorMessage = "Gemini API 额度不足，请联系管理员";
          } else {
            errorMessage = "Gemini API 暂时繁忙，请稍后重试";
          }
        } else if (result.statusCode === 429) {
          errorMessage = "Gemini API 请求频率过高，请稍后重试";
        } else {
          errorMessage = rawMessage.substring(0, 100) || errorMessage;
        }
      } catch {
        // 解析失败时使用默认错误消息
      }

      return { success: false, error: errorMessage };
    }

    // 解析 SSE 流式响应，拼接所有 delta.content
    const fullContent = parseSSEResponse(result.data);

    if (!fullContent) {
      console.error("[Gemini-Image] Empty content from SSE stream");
      return { success: false, error: "API 未返回图片内容" };
    }

    // 提取 Base64 图片数据
    // 格式可能是: ![image](data:image/jpeg;base64,/9j/4AAQ...)
    // 或者: data:image/jpeg;base64,/9j/4AAQ...
    // 或者包含 URL: https://...xxx.png
    const base64Match = fullContent.indexOf('base64,');
    if (base64Match !== -1) {
      // Base64 格式的图片
      let imageBase64 = fullContent.substring(base64Match + 7);

      // 如果是 markdown 格式 ![image](data:...), 需要移除末尾的 )
      const closingParen = imageBase64.indexOf(')');
      if (closingParen !== -1) {
        imageBase64 = imageBase64.substring(0, closingParen);
      }
      // 移除引号、换行符和空格
      imageBase64 = imageBase64.replace(/["'\n\r\s]/g, '');

      console.log("[Gemini-Image] Image generated successfully (base64):", {
        sizeKB: (Buffer.from(imageBase64, 'base64').length / 1024).toFixed(2),
      });

      return { success: true, imageBase64 };
    }

    // 检查是否返回了图片 URL
    const urlMatch = fullContent.match(/https?:\/\/[^\s"')\]]+\.(png|jpg|jpeg|webp)[^\s"')\]]*/i);
    if (urlMatch) {
      console.log("[Gemini-Image] Image generated successfully (URL):", urlMatch[0]);
      return { success: true, imageUrl: urlMatch[0] };
    }

    console.error("[Gemini-Image] No image in response, content preview:", fullContent.substring(0, 300));
    return { success: false, error: "API 未返回有效图片" };

  } catch (error) {
    console.error("[Gemini-Image] Generate error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error"
    };
  }
}

/**
 * 解析 SSE (Server-Sent Events) 流式响应
 * 拼接所有 delta.content / delta.reasoning_content 到一个完整字符串
 */
function parseSSEResponse(rawData: string): string {
  let fullContent = '';
  const lines = rawData.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;

    const jsonStr = trimmed.substring(5).trim();
    if (jsonStr === '[DONE]') break;

    try {
      const chunk = JSON.parse(jsonStr);
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        fullContent += delta.content;
      }
      if (delta?.reasoning_content) {
        fullContent += delta.reasoning_content;
      }
    } catch {
      // 跳过无法解析的行
    }
  }

  return fullContent;
}

/**
 * 将 Base64 图片上传到 OSS 并返回 URL
 * 
 * 用于将 Gemini 返回的 Base64 图片转换为可访问的 URL
 */
export async function uploadBase64ImageToOSS(
  base64Data: string,
  filename?: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    // 直接使用 OSS SDK 上传
    const { uploadImageBuffer, generateMediaPath, getPublicUrl } = await import('@/lib/oss');

    const buffer = Buffer.from(base64Data, 'base64');
    const objectPath = generateMediaPath(
      'images',
      'gemini-gen',  // 使用固定的用户 ID 文件夹
      filename || `gemini-${Date.now()}.jpg`
    );

    const url = await uploadImageBuffer(buffer, objectPath, 'image/jpeg');

    console.log("[Gemini-Image] Uploaded to OSS:", url);

    return { success: true, url };
  } catch (error) {
    console.error("[Gemini-Image] Upload error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Upload failed"
    };
  }
}

// ============================================================================
// 望景API 新特性 (2026-02-24 更新)
// ============================================================================

/**
 * 获取望景API视频直接下载 URL
 * 
 * 使用 /v1/videos/{task_id}/content 端点
 * 返回 307 重定向到实际视频文件
 * 
 * @param taskId 任务 ID
 * @returns 直接下载 URL（通过 download-proxy 代理访问）
 */
export function getWangjingVideoContentUrl(taskId: string): string {
  return `${WANGJING_API_BASE}/v1/videos/${taskId}/content`;
}

/**
 * 查询望景API Byte 余额
 * 
 * API 端点: GET /v1/token/balance
 * 需要 Bearer token 认证
 * 
 * @returns 余额信息
 */
export async function getWangjingBalance(): Promise<{
  success: boolean;
  balance?: number;
  balanceFormatted?: string;
  error?: string;
}> {
  const key = WANGJING_API_KEY;
  if (!key) {
    return { success: false, error: '望景API 未配置' };
  }

  try {
    const endpoint = `${WANGJING_API_BASE}/v1/token/balance`;
    const urlObj = new URL(endpoint);
    const httpModule = urlObj.protocol === 'https:' ? https : await import('http');

    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname,
        method: 'GET',
        family: 4,
        timeout: 15000,
        headers: {
          'Authorization': `Bearer ${key}`,
        },
      };

      const req = httpModule.request(options, (res: import('http').IncomingMessage) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });

    if (result.statusCode !== 200) {
      console.error('[Wangjing Balance] HTTP error:', result.statusCode, result.data.substring(0, 200));
      return { success: false, error: `请求失败: ${result.statusCode}` };
    }

    const data = JSON.parse(result.data);
    console.log('[Wangjing Balance] Response:', data);

    // 望景API 返回格式: { balance_byte: number, object: string, unlimited_quota: boolean }
    const balance = data.balance_byte ?? data.data?.balance ?? data.balance ?? 0;
    const unlimited = data.unlimited_quota === true;

    return {
      success: true,
      balance,
      balanceFormatted: unlimited ? '无限额度' : `${balance.toFixed(4)} Byte`,
    };
  } catch (error) {
    console.error('[Wangjing Balance] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

// ============================================================================
// Sora2 角色创建接口 (2026-03-19 新增)
// ============================================================================

/**
 * 提交 Sora2 角色创建任务
 *
 * API: POST https://api.wuyinkeji.com/api/async/video_sora_character
 * 认证: Authorization: {key} (无 Bearer)
 * 计费: 0.1元/次
 *
 * @param url 角色视频 URL
 * @param timestamps 截取范围，如 "0,3"（最多3秒）
 * @returns taskId 用于轮询查询
 */
export async function submitCharacterCreate(
  url: string,
  timestamps?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = WUYINKEJI_API_KEY;
  if (!key) {
    return { success: false, error: "WUYINKEJI_API_KEY 未配置" };
  }

  try {
    const endpoint = `${WUYINKEJI_API_BASE}/api/async/video_sora_character`;
    const requestBody = JSON.stringify({
      url,
      ...(timestamps && { timestamps }),
    });

    console.log("[Sora2-Character] Submitting:", { url: url.substring(0, 50) + "...", timestamps });

    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const urlObj = new URL(endpoint);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        family: 4,
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': key,  // 无 Bearer
          'Content-Length': String(Buffer.byteLength(requestBody)),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(requestBody);
      req.end();
    });

    console.log("[Sora2-Character] Response:", result.statusCode, result.data.substring(0, 200));

    if (result.statusCode >= 400) {
      return { success: false, error: `角色创建服务错误 (${result.statusCode})` };
    }

    const data = JSON.parse(result.data);
    const taskId = data.data?.id;

    if (taskId) {
      return { success: true, taskId: String(taskId) };
    }

    return { success: false, error: data.msg || "未返回任务 ID" };
  } catch (error) {
    console.error("[Sora2-Character] Submit error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

/**
 * 查询角色创建结果
 *
 * API: GET https://api.wuyinkeji.com/api/async/detail?key={key}&id={taskId}
 * 返回: status=2 时 result[0] = 角色 pid
 *
 * @param taskId 角色创建任务 ID
 * @returns pid 角色引用 ID (在 prompt 中用 @pid 引用)
 */
export async function queryCharacterResult(
  taskId: string
): Promise<{ success: boolean; status: "pending" | "completed" | "failed"; pid?: string; error?: string }> {
  const key = WUYINKEJI_API_KEY;
  if (!key) {
    return { success: false, status: "failed", error: "WUYINKEJI_API_KEY 未配置" };
  }

  try {
    const queryUrl = `${WUYINKEJI_API_BASE}/api/async/detail?key=${encodeURIComponent(key)}&id=${encodeURIComponent(taskId)}`;

    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const urlObj = new URL(queryUrl);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: `${urlObj.pathname}${urlObj.search}`,
        method: 'GET',
        family: 4,
        timeout: 15000,
        headers: { 'Accept': 'application/json' },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });

    if (!result.data) {
      return { success: false, status: "pending", error: "查询无响应" };
    }

    const data = JSON.parse(result.data);
    console.log("[Sora2-Character] Query:", { taskId, status: data.data?.status, hasResult: !!data.data?.result });

    const status = data.data?.status;

    if (status === 2) {
      // 完成：result[0] 是角色 pid
      const pid = data.data?.result?.[0];
      if (pid) {
        return { success: true, status: "completed", pid };
      }
      return { success: false, status: "failed", error: "角色创建完成但无 pid" };
    } else if (status === 1) {
      return { success: false, status: "failed", error: data.data?.fail_reason || "角色创建失败" };
    } else if (status === 3) {
      // 无印科技系统错误 — 快速失败，不继续轮询
      const msg = data.data?.message || "system error";
      console.error("[Sora2-Character] System error:", msg);
      return { success: false, status: "failed", error: `提取失败（服务繁忙），请重试` };
    }

    // status === 0 或其他 → 仍在处理中
    return { success: true, status: "pending" };
  } catch (error) {
    console.error("[Sora2-Character] Query error:", error);
    return { success: false, status: "failed", error: error instanceof Error ? error.message : "Network error" };
  }
}
