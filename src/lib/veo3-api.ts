/**
 * VEO3 API 统一接口
 * 
 * 文档: https://docs.apimart.ai/en/api-reference/videos/veo3/generation
 * 
 * 支持模型:
 * - veo3.1-fast: 快速生成模式，适合快速预览
 * - veo3.1-quality: 高质量生成模式，适合最终生产
 * 
 * 特点:
 * - 固定 8 秒时长
 * - 支持文生视频和图生视频
 * - 生成链接 24 小时有效
 */

import https from 'https';

// ============================================================================
// 配置
// ============================================================================

const VEO3_API_BASE = process.env.VEO3_API_ENDPOINT || "https://api.apimart.ai";
const VEO3_API_KEY = process.env.VEO3_API_KEY || "";

// ============================================================================
// 类型定义
// ============================================================================

/** VEO3 模型类型 */
export type Veo3ModelType = "veo3.1-fast" | "veo3.1-quality";

/** VEO3 视频生成参数 */
export interface Veo3Params {
  prompt: string;
  model?: Veo3ModelType;
  duration?: number;          // 固定 8 秒
  aspectRatio?: "16:9" | "9:16";
  imageUrls?: string[];       // 参考图片 URL 列表（图生视频）
}

/** VEO3 提交响应 */
interface Veo3SubmitResponse {
  code: number;
  data?: {
    status: string;  // "submitted"
    task_id: string;
  }[];
  message?: string;
}

/** VEO3 查询响应 */
interface Veo3QueryResponse {
  code: number;
  data?: {
    id: string;
    status: string;  // "pending" | "processing" | "completed" | "failed"
    progress?: number;
    created?: number;       // Unix timestamp
    completed?: number;     // Unix timestamp
    actual_time?: number;   // 实际耗时（秒）
    estimated_time?: number; // 预估耗时（秒）
    error?: {               // 任务级别的错误信息
      code?: string;
      message?: string;
    };
    result?: {
      videos?: Array<{
        url: string[];      // 视频 URL 数组
        expires_at?: number; // 过期时间
      }>;
      error?: string;       // 结果级别的错误信息
    };
  };
  message?: string;
}

/** 任务状态 */
export interface Veo3TaskStatus {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  resultUrl?: string;
  errorMessage?: string;
  progress?: number;
  createdAt?: string;
  completedAt?: string;
}

// ============================================================================
// VEO3 API 函数
// ============================================================================

/**
 * 提交 VEO3 视频生成任务
 * 
 * API 端点: POST /v1/videos/generations
 */
export async function submitVeo3(
  params: Veo3Params,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = apiKey || VEO3_API_KEY;

  if (!key) {
    return { success: false, error: "VEO3 API key not configured" };
  }

  try {
    const model = params.model || "veo3.1-fast";
    const endpoint = `${VEO3_API_BASE}/v1/videos/generations`;

    console.log("[VEO3] Submitting task:", {
      endpoint,
      model,
      prompt: params.prompt.substring(0, 50) + "...",
      hasImage: !!(params.imageUrls && params.imageUrls.length > 0),
      aspectRatio: params.aspectRatio || "16:9",
    });

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      model: model,
      prompt: params.prompt,
      duration: 8,  // VEO3 固定 8 秒
      aspect_ratio: params.aspectRatio || "16:9",
    };

    // 如果有参考图片，添加到请求体（图生视频）
    if (params.imageUrls && params.imageUrls.length > 0) {
      requestBody.image_urls = params.imageUrls;
    }

    // 使用 https.request 并强制 IPv4
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

        break;
      } catch (fetchError) {
        retryCount++;
        if (retryCount > maxRetries) {
          throw fetchError;
        }
        const waitTime = 3000 * retryCount;
        console.log(`[VEO3] Retry ${retryCount}/${maxRetries} after error, waiting ${waitTime}ms:`, fetchError);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    console.log("[VEO3] Raw response (status: " + statusCode + "):", responseText.substring(0, 500));

    // 检查 HTTP 状态码
    if (statusCode >= 500) {
      console.error(`[VEO3] Server error ${statusCode}:`, responseText.substring(0, 200));
      return {
        success: false,
        error: `VEO3 服务暂时繁忙 (${statusCode})，请稍后重试`
      };
    }

    let data: Veo3SubmitResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[VEO3] Failed to parse response:", responseText.substring(0, 500));
      if (responseText.includes("<!DOCTYPE") || responseText.includes("<html")) {
        return { success: false, error: "VEO3 服务网关错误，请稍后重试" };
      }
      return { success: false, error: "VEO3 服务响应格式错误，请稍后重试" };
    }

    console.log("[VEO3] Submit response:", {
      code: data.code,
      taskId: data.data?.[0]?.task_id,
      status: data.data?.[0]?.status,
    });

    // 检查响应 - 支持多种可能的响应格式
    if (data.code === 200 && data.data && data.data.length > 0) {
      const taskId = data.data[0].task_id;
      if (taskId) {
        return { success: true, taskId };
      }
    }

    // 检查是否是没有 code 字段的响应格式 (某些 API 版本)
    if (data.code === undefined) {
      // 尝试直接从 data 获取 task_id
      const anyData = data as unknown as { task_id?: string; id?: string; data?: { task_id?: string } };
      const taskId = anyData.task_id || anyData.id || anyData.data?.task_id;
      if (taskId) {
        console.log("[VEO3] Found taskId in alternative format:", taskId);
        return { success: true, taskId };
      }

      // 打印完整响应以便调试
      console.error("[VEO3] Response has no code field. Full response:", JSON.stringify(data).substring(0, 1000));
      return {
        success: false,
        error: data.message || "VEO3 API 响应格式异常，请联系管理员"
      };
    }

    // 处理错误码
    const errorMessages: Record<number, string> = {
      400: "请求参数错误",
      401: "API 密钥无效或已过期",
      402: "账户余额不足",
      403: "无权访问此功能",
      429: "请求过于频繁，请稍后重试",
      500: "VEO3 服务内部错误",
      502: "VEO3 服务网关错误",
    };

    return {
      success: false,
      error: errorMessages[data.code] || data.message || `API error: code ${data.code}`
    };
  } catch (error) {
    console.error("[VEO3] Submit error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error"
    };
  }
}

/**
 * 查询 VEO3 任务结果
 * 
 * API 端点: GET /v1/tasks/{task_id}
 */
export async function queryVeo3Result(
  taskId: string,
  apiKey?: string
): Promise<{ success: boolean; task?: Veo3TaskStatus; error?: string; raw?: unknown }> {
  const key = apiKey || VEO3_API_KEY;

  if (!key) {
    return { success: false, error: "VEO3 API key not configured" };
  }

  try {
    const endpoint = `${VEO3_API_BASE}/v1/tasks/${taskId}`;

    // 使用 https.request 并强制 IPv4
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
            timeout: 45000, // 45秒超时
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

        if (statusCode >= 500 && statusCode < 600) {
          throw new Error(`Server error: ${statusCode}`);
        }

        break;
      } catch (fetchError) {
        retryCount++;
        if (retryCount > maxRetries) {
          throw fetchError;
        }
        console.log(`[VEO3] Query retry ${retryCount}/${maxRetries}:`, fetchError);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!responseText) {
      return { success: false, error: "网络请求失败，请稍后重试" };
    }

    // 检查 HTTP 状态码
    if (statusCode >= 500) {
      console.error(`[VEO3] Query server error ${statusCode}:`, responseText.substring(0, 200));
      return { success: false, error: `VEO3 服务暂时繁忙 (${statusCode})，请稍后重试` };
    }

    let data: Veo3QueryResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[VEO3] Failed to parse query response:", responseText.substring(0, 200));
      if (responseText.includes("<!DOCTYPE") || responseText.includes("<html")) {
        return { success: false, error: "VEO3 服务网关错误，请稍后重试" };
      }
      return { success: false, error: "VEO3 任务查询响应格式错误" };
    }

    console.log("[VEO3] Query response:", {
      code: data.code,
      taskId: data.data?.id,
      status: data.data?.status,
      progress: data.data?.progress,
      hasUrl: !!(data.data?.result?.videos && data.data.result.videos.length > 0),
    });

    if (data.code === 200 && data.data) {
      // 状态映射
      const statusMap: Record<string, Veo3TaskStatus["status"]> = {
        "pending": "pending",
        "submitted": "pending",
        "queued": "pending",
        "processing": "processing",
        "completed": "completed",
        "success": "completed",
        "failed": "failed",
        "error": "failed",
      };

      const taskStatus = statusMap[data.data.status] || "processing";

      // 从 result.videos 数组中提取视频 URL
      let videoUrl: string | undefined;
      if (data.data.result?.videos && data.data.result.videos.length > 0) {
        const firstVideo = data.data.result.videos[0];
        if (firstVideo.url && firstVideo.url.length > 0) {
          videoUrl = firstVideo.url[0];
        }
      }

      // 获取错误信息 - 优先使用 data.error.message，其次使用 result.error
      let errorMessage: string | undefined;
      if (data.data.error?.message) {
        // 解析并友好化错误信息
        const rawError = data.data.error.message;
        if (rawError.includes('PUBLIC_ERROR_UNSAFE_GENERATION')) {
          errorMessage = '内容安全审核未通过：提示词或图片可能包含敏感内容，请修改后重试';
        } else if (rawError.includes('所有渠道均已失败')) {
          // 提取最后的错误原因
          const match = rawError.match(/最后错误[：:]\s*(.+)/);
          if (match) {
            const lastError = match[1];
            if (lastError.includes('UNSAFE_GENERATION')) {
              errorMessage = '内容安全审核未通过：提示词或图片可能包含敏感内容';
            } else {
              errorMessage = `视频生成失败：${lastError.substring(0, 100)}`;
            }
          } else {
            errorMessage = '视频生成失败：所有渠道均不可用，请稍后重试';
          }
        } else {
          errorMessage = rawError.length > 150 ? rawError.substring(0, 150) + '...' : rawError;
        }
      } else if (data.data.result?.error) {
        errorMessage = data.data.result.error;
      }

      return {
        success: true,
        task: {
          taskId: data.data.id || taskId,
          status: taskStatus,
          resultUrl: videoUrl,
          errorMessage: errorMessage,
          progress: data.data.progress,
          createdAt: data.data.created ? new Date(data.data.created * 1000).toISOString() : undefined,
          completedAt: data.data.completed ? new Date(data.data.completed * 1000).toISOString() : undefined,
        },
        raw: data,
      };
    }

    return { success: false, error: data.message || "Query failed" };
  } catch (error) {
    console.error("[VEO3] Query error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error"
    };
  }
}

/**
 * 获取 VEO3 模型显示名称
 */
export function getVeo3ModelDisplayName(model: Veo3ModelType): string {
  const names: Record<Veo3ModelType, string> = {
    "veo3.1-fast": "VEO3 快速版 (8秒)",
    "veo3.1-quality": "VEO3 高清版 (8秒)",
  };
  return names[model] || model;
}

/**
 * 测试 VEO3 API 连接
 */
export async function testVeo3Connection(apiKey?: string): Promise<{
  success: boolean;
  message: string;
}> {
  const key = apiKey || VEO3_API_KEY;

  if (!key) {
    return { success: false, message: "VEO3 API key not configured" };
  }

  try {
    // 简单测试 - 不实际提交任务，只检查认证
    const endpoint = `${VEO3_API_BASE}/v1/models`;

    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const url = new URL(endpoint);
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'GET',
        family: 4,
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json',
        },
        timeout: 10000,
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

    if (result.statusCode === 200) {
      return { success: true, message: "VEO3 API 连接成功" };
    } else if (result.statusCode === 401) {
      return { success: false, message: "VEO3 API 密钥无效" };
    } else {
      return { success: false, message: `VEO3 API 返回状态码: ${result.statusCode}` };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
