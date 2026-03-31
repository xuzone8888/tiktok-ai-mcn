/**
 * 高瑞 VEO3 API 统一封装
 *
 * 三个模型 (全部异步, POST /v1/videos, multipart/form-data):
 * - veo_3_1-components (参考图版, async, multipart)
 * - veo3.1-fast (快速版, async, multipart)
 * - veo3.1-fast-4K (4K超清, async, multipart)
 *
 * 查询: GET /v1/videos/{id}
 * 下载: GET /v1/videos/{id}/content
 *
 * Base URL: https://gaorui.cc
 * 认证: Authorization: Bearer {key}
 */

import https from 'https';

// ============================================================================
// 配置
// ============================================================================

const GAORUI_API_BASE = process.env.GAORUI_API_ENDPOINT || "https://gaorui.cc";
const GAORUI_API_KEY = process.env.VEO3_GAORUI_API_KEY || "";

// ============================================================================
// 类型定义
// ============================================================================

/** VEO3 模型类型 */
export type GaoruiVeoModel = "veo_3_1-components" | "veo3.1-fast" | "veo3.1-fast-4K";

/** 提交参数 */
export interface VeoSubmitParams {
  prompt: string;
  model: GaoruiVeoModel;
  aspectRatio?: "16:9" | "9:16";
  imageUrls?: string[];  // 参考图 URL 列表
}

/** 任务状态 */
export interface VeoTaskStatus {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  errorMessage?: string;
  progress?: number;
  createdAt?: string;
  completedAt?: string;
}

// ============================================================================
// 内部工具函数
// ============================================================================

/**
 * 发送 HTTPS 请求（强制 IPv4）
 */
function httpsRequest(options: {
  hostname: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeout?: number;
}): Promise<{ data: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: options.hostname,
      port: 443,
      path: options.path,
      method: options.method,
      family: 4, // 强制 IPv4
      headers: {
        ...options.headers,
        ...(options.body ? { 'Content-Length': String(Buffer.byteLength(options.body)) } : {}),
      },
      timeout: options.timeout || 120000,
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * 带重试的请求
 */
async function requestWithRetry(
  options: Parameters<typeof httpsRequest>[0],
  maxRetries: number = 2
): Promise<{ data: string; statusCode: number }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await httpsRequest(options);
      if (result.statusCode >= 500 && attempt < maxRetries) {
        throw new Error(`Server error: ${result.statusCode}`);
      }
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const waitMs = 3000 * (attempt + 1);
        console.log(`[Gaorui-VEO] Retry ${attempt + 1}/${maxRetries}, waiting ${waitMs}ms`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }
  throw lastError || new Error('Request failed');
}

/**
 * 下载图片（用于 multipart 文件上传）
 */
async function downloadImage(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, { family: 4, timeout: 30000 }, (res: any) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // 跟随重定向
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ============================================================================
// VEO3 Components (异步, POST /v1/videos, application/json)
// ============================================================================

/**
 * 提交 VEO3 Components 视频生成任务（异步轮询）
 *
 * 文档: POST /v1/videos (application/json)
 * 仅支持模型 veo_3_1-components
 *
 * Body (application/json):
 *   model: "veo_3_1-components" (string, 必需)
 *   prompt: 提示词 (string, 必需)
 *   images: 参考图 URL 数组 (string[], 可选, 最多 3 张)
 *   enhance_prompt: true (boolean, 必需)
 *   enable_upsample: true (boolean/string, 必需)
 *   aspect_ratio: "9:16" 或 "16:9" (string, 必需)
 *
 * 响应: { id, status: "queued", ... }
 */
export async function submitVeoComponents(
  params: VeoSubmitParams,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = apiKey || GAORUI_API_KEY;
  if (!key) return { success: false, error: "高瑞 API Key 未配置" };

  try {
    // 按文档要求使用 application/json 格式
    const jsonBody: Record<string, unknown> = {
      model: "veo3.1-fast-components",
      prompt: params.prompt,
      enhance_prompt: true,
      enable_upsample: true,
      aspect_ratio: params.aspectRatio || "9:16",
    };

    // 参考图片: 文档要求传 URL 字符串数组（最多 3 张）
    if (params.imageUrls && params.imageUrls.length > 0) {
      jsonBody.images = params.imageUrls.slice(0, 3);
    }

    const bodyStr = JSON.stringify(jsonBody);

    console.log("[Gaorui-VEO] Submitting Components task (JSON):", {
      model: "veo3.1-fast-components",
      imageCount: params.imageUrls?.length || 0,
      aspectRatio: params.aspectRatio || "9:16",
      bodyLength: bodyStr.length,
      prompt: params.prompt.substring(0, 50) + "...",
    });

    // 带重试的请求（防止偶发 504 网关超时）
    const MAX_RETRIES = 2;
    let result: { data: string; statusCode: number } | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
          const bodyBuffer = Buffer.from(bodyStr, 'utf-8');
          const req = https.request({
            hostname: new URL(GAORUI_API_BASE).hostname,
            port: 443,
            path: "/v1/videos",
            method: "POST",
            family: 4,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer ${key}`,
              'Content-Length': String(bodyBuffer.length),
            },
            timeout: 120000,
          }, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => data += chunk);
            res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
          req.write(bodyBuffer);
          req.end();
        });

        console.log(`[Gaorui-VEO] Components response (attempt ${attempt + 1}, status: ${result.statusCode}):`, result.data.substring(0, 300));

        // 5xx 且还有重试次数 → 重试
        if (result.statusCode >= 500 && attempt < MAX_RETRIES) {
          const waitMs = 3000 * (attempt + 1);
          console.log(`[Gaorui-VEO] Components 5xx, retrying in ${waitMs}ms (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
        break;
      } catch (reqError) {
        console.error(`[Gaorui-VEO] Components request error (attempt ${attempt + 1}):`, reqError);
        if (attempt < MAX_RETRIES) {
          const waitMs = 3000 * (attempt + 1);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
        throw reqError;
      }
    }

    if (!result) {
      return { success: false, error: "请求失败，所有重试已用尽" };
    }

    if (result.statusCode >= 400) {
      let errorDetail = `VEO3 服务错误 (${result.statusCode})`;
      try {
        const errBody = JSON.parse(result.data);
        const msg = errBody.error?.message || errBody.message || errBody.detail || JSON.stringify(errBody).substring(0, 200);
        errorDetail = `VEO3 (${result.statusCode}): ${msg}`;
      } catch { /* 无法解析错误响应 */ }
      console.error("[Gaorui-VEO] Components API error:", errorDetail);
      return { success: false, error: errorDetail };
    }

    const data = JSON.parse(result.data);

    // 异步模式: 返回 { id, status: "queued" }
    const taskId = data.id || data.task_id;
    if (taskId) {
      return { success: true, taskId };
    }

    return { success: false, error: data.error?.message || "未返回任务 ID" };
  } catch (error) {
    console.error("[Gaorui-VEO] Components error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

// ============================================================================
// VEO3 Fast (异步, /v1/videos)
// ============================================================================

/**
 * 提交 VEO3 Fast 视频生成任务（异步轮询）
 *
 * 文档: POST /v1/videos (multipart/form-data)
 * 不支持模型 veo_3_1-components
 *
 * Body (multipart/form-data):
 *   model: "veo3.1-fast" (string, 必需)
 *   prompt: 提示词 (string, 必需)
 *   seconds: "8" (string, 必需)
 *   input_reference: 参考图 (file, 必需)
 *   size: "16x9" 或 "9x16" (string, 必需)
 *   watermark: "false" (string, 可选)
 *
 * 响应: { id, object: "video", model, status: "queued", progress: 0, ... }
 */
export async function submitVeoFast(
  params: VeoSubmitParams,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = apiKey || GAORUI_API_KEY;
  if (!key) return { success: false, error: "高瑞 API Key 未配置" };

  try {
    const aspectRatio = params.aspectRatio || "9:16";
    const size = aspectRatio === "16:9" ? "16x9" : "9x16";

    // 构建 multipart/form-data
    const boundary = `----VeoFast${Date.now()}`;
    const parts: string[] = [];

    // model
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nveo3.1-fast`);
    // prompt
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${params.prompt}`);
    // seconds
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="seconds"\r\n\r\n8`);
    // size
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${size}`);
    // watermark
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="watermark"\r\n\r\nfalse`);

    // input_reference（如果有参考图 URL，先下载再作为 file 上传）
    let bodyBuffer: Buffer;
    if (params.imageUrls && params.imageUrls.length > 0) {
      const imageUrl = params.imageUrls[0];
      console.log("[Gaorui-VEO] Downloading reference image:", imageUrl.substring(0, 80));
      try {
        const imageData = await downloadImage(imageUrl);
        const fileName = "reference.png";
        const textPart = parts.join("\r\n") + "\r\n";
        const filePart = `--${boundary}\r\nContent-Disposition: form-data; name="input_reference"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`;
        const endPart = `\r\n--${boundary}--\r\n`;

        bodyBuffer = Buffer.concat([
          Buffer.from(textPart, 'utf-8'),
          Buffer.from(filePart, 'utf-8'),
          imageData,
          Buffer.from(endPart, 'utf-8'),
        ]);
      } catch (imgError) {
        console.error("[Gaorui-VEO] Failed to download reference image:", imgError);
        // 无图片时继续（不含 input_reference）
        const textPart = parts.join("\r\n") + `\r\n--${boundary}--\r\n`;
        bodyBuffer = Buffer.from(textPart, 'utf-8');
      }
    } else {
      // 无参考图
      const textPart = parts.join("\r\n") + `\r\n--${boundary}--\r\n`;
      bodyBuffer = Buffer.from(textPart, 'utf-8');
    }

    console.log("[Gaorui-VEO] Submitting Fast task (multipart):", {
      model: "veo3.1-fast",
      size,
      hasImage: !!(params.imageUrls && params.imageUrls.length > 0),
      bodySize: bodyBuffer.length,
      prompt: params.prompt.substring(0, 50) + "...",
    });

    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const req = https.request({
        hostname: new URL(GAORUI_API_BASE).hostname,
        port: 443,
        path: "/v1/videos",
        method: "POST",
        family: 4,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json',
          'Content-Length': String(bodyBuffer.length),
        },
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => data += chunk);
        res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(bodyBuffer);
      req.end();
    });

    console.log("[Gaorui-VEO] Fast response (status:", result.statusCode, "):", result.data.substring(0, 300));

    if (result.statusCode >= 400) {
      return { success: false, error: `VEO3 服务错误 (${result.statusCode})` };
    }

    const data = JSON.parse(result.data);

    // 异步模式: 返回 { id, status: "queued" }
    const taskId = data.id || data.task_id;
    if (taskId) {
      return { success: true, taskId };
    }

    return { success: false, error: data.error?.message || "未返回任务 ID" };
  } catch (error) {
    console.error("[Gaorui-VEO] Fast error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

// ============================================================================
// VEO3 Fast 4K (异步, POST /v1/videos, multipart/form-data)
// ============================================================================

/**
 * 提交 VEO3 Fast 4K 视频生成任务（异步轮询）
 *
 * 文档: POST /v1/videos (multipart/form-data)
 * 格式与 veo3.1-fast 一致，model 改为 "veo3.1-fast-4K"
 * 支持最多 2 张参考图
 *
 * Body (multipart/form-data):
 *   model: "veo3.1-fast-4K" (string, 必需)
 *   prompt: 提示词 (string, 必需)
 *   seconds: "8" (string, 必需)
 *   input_reference: 参考图 (file, 可选)
 *   size: "16x9" 或 "9x16" (string, 必需)
 *   watermark: "false" (string, 可选)
 *
 * 响应: { id, object: "video", model, status: "queued", progress: 0, ... }
 */
export async function submitVeoFast4K(
  params: VeoSubmitParams,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = apiKey || GAORUI_API_KEY;
  if (!key) return { success: false, error: "高瑞 API Key 未配置" };

  try {
    const aspectRatio = params.aspectRatio || "9:16";
    const size = aspectRatio === "16:9" ? "16x9" : "9x16";

    // 构建 multipart/form-data
    const boundary = `----VeoFast4K${Date.now()}`;
    const parts: string[] = [];

    // model
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nveo3.1-fast-4K`);
    // prompt
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${params.prompt}`);
    // seconds
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="seconds"\r\n\r\n8`);
    // size
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${size}`);
    // watermark
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="watermark"\r\n\r\nfalse`);

    // input_reference（最多 2 张参考图，逐张下载后 file 上传）
    let bodyBuffer: Buffer;
    if (params.imageUrls && params.imageUrls.length > 0) {
      const imagesToUpload = params.imageUrls.slice(0, 2);
      const downloadedImages: { data: Buffer; name: string }[] = [];

      for (let i = 0; i < imagesToUpload.length; i++) {
        const imageUrl = imagesToUpload[i];
        console.log(`[Gaorui-VEO] 4K: Downloading reference image ${i + 1}/${imagesToUpload.length}:`, imageUrl.substring(0, 80));
        try {
          const imageData = await downloadImage(imageUrl);
          downloadedImages.push({ data: imageData, name: `reference_${i + 1}.png` });
        } catch (imgError) {
          console.error(`[Gaorui-VEO] 4K: Failed to download reference image ${i + 1}:`, imgError);
        }
      }

      if (downloadedImages.length > 0) {
        const textPart = parts.join("\r\n") + "\r\n";
        const bufferParts: Buffer[] = [Buffer.from(textPart, 'utf-8')];

        for (const img of downloadedImages) {
          const filePart = `--${boundary}\r\nContent-Disposition: form-data; name="input_reference"; filename="${img.name}"\r\nContent-Type: image/png\r\n\r\n`;
          bufferParts.push(Buffer.from(filePart, 'utf-8'));
          bufferParts.push(img.data);
          bufferParts.push(Buffer.from("\r\n", 'utf-8'));
        }

        bufferParts.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));
        bodyBuffer = Buffer.concat(bufferParts);
      } else {
        // 所有图片下载失败，无图继续
        const textPart = parts.join("\r\n") + `\r\n--${boundary}--\r\n`;
        bodyBuffer = Buffer.from(textPart, 'utf-8');
      }
    } else {
      const textPart = parts.join("\r\n") + `\r\n--${boundary}--\r\n`;
      bodyBuffer = Buffer.from(textPart, 'utf-8');
    }

    console.log("[Gaorui-VEO] Submitting Fast-4K task (multipart):", {
      model: "veo3.1-fast-4K",
      size,
      hasImage: !!(params.imageUrls && params.imageUrls.length > 0),
      bodySize: bodyBuffer.length,
      prompt: params.prompt.substring(0, 50) + "...",
    });

    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const req = https.request({
        hostname: new URL(GAORUI_API_BASE).hostname,
        port: 443,
        path: "/v1/videos",
        method: "POST",
        family: 4,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json',
          'Content-Length': String(bodyBuffer.length),
        },
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => data += chunk);
        res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(bodyBuffer);
      req.end();
    });

    console.log("[Gaorui-VEO] Fast-4K response (status:", result.statusCode, "):", result.data.substring(0, 300));

    if (result.statusCode >= 400) {
      let errorDetail = `VEO3 4K 服务错误 (${result.statusCode})`;
      try {
        const errBody = JSON.parse(result.data);
        const msg = errBody.error?.message || errBody.message || errBody.detail || JSON.stringify(errBody).substring(0, 200);
        errorDetail = `VEO3 4K (${result.statusCode}): ${msg}`;
      } catch { /* 无法解析错误响应 */ }
      console.error("[Gaorui-VEO] Fast-4K API error:", errorDetail);
      return { success: false, error: errorDetail };
    }

    const data = JSON.parse(result.data);

    // 异步模式: 返回 { id, status: "queued" }
    const taskId = data.id || data.task_id;
    if (taskId) {
      return { success: true, taskId };
    }

    return { success: false, error: data.error?.message || "未返回任务 ID" };
  } catch (error) {
    console.error("[Gaorui-VEO] Fast-4K error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

// ============================================================================
// VEO3 任务查询（异步轮询）
// ============================================================================

/**
 * 查询 VEO3 任务结果
 *
 * 文档: GET /v1/videos/{id}
 *
 * 响应: { id, status, video_url, enhanced_prompt, status_update_time }
 * 实际响应还包含 detail 对象: { id, detail: { status, pending_info: { progress_pct, ... } }, status, status_update_time }
 */
export async function queryVeoResult(
  taskId: string,
  apiKey?: string
): Promise<{ success: boolean; task?: VeoTaskStatus; error?: string }> {
  const key = apiKey || GAORUI_API_KEY;
  if (!key) return { success: false, error: "高瑞 API Key 未配置" };

  try {
    const result = await requestWithRetry({
      hostname: new URL(GAORUI_API_BASE).hostname,
      path: `/v1/videos/${taskId}`,
      method: "GET",
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      timeout: 30000,
    }, 1);

    if (!result.data) {
      return { success: false, error: "查询无响应" };
    }

    const data = JSON.parse(result.data);

    console.log("[Gaorui-VEO] Query result:", {
      id: data.id,
      status: data.status,
      hasVideoUrl: !!data.video_url,
      enhancedPrompt: data.enhanced_prompt ? "yes" : "no",
      statusUpdateTime: data.status_update_time,
      detailStatus: data.detail?.status,
      progressPct: data.detail?.pending_info?.progress_pct,
    });

    // 状态映射
    const statusMap: Record<string, VeoTaskStatus["status"]> = {
      "pending": "pending",
      "submitted": "pending",
      "queued": "pending",
      "processing": "processing",
      "completed": "completed",
      "success": "completed",
      "failed": "failed",
      "error": "failed",
    };

    const taskStatus = statusMap[data.status] || "processing";

    // 进度: 优先从 detail.pending_info.progress_pct 获取 (0~1 的小数)
    let progress = data.progress;
    if (data.detail?.pending_info?.progress_pct !== undefined) {
      progress = Math.round(data.detail.pending_info.progress_pct * 100);
    }

    // video_url: 查询接口返回的视频下载地址
    // 注意: /v1/videos/{id}/content 端点目前「开发中」(404)，不使用
    const videoUrl = data.video_url || data.result_url || undefined;

    return {
      success: true,
      task: {
        taskId: data.id || taskId,
        status: taskStatus,
        videoUrl,
        errorMessage: data.error?.message || data.detail?.pending_info?.failure_reason,
        progress,
        createdAt: data.created_at
          ? new Date(data.created_at * 1000).toISOString()
          : data.detail?.pending_info?.created_at,
        completedAt: data.completed_at
          ? new Date(data.completed_at * 1000).toISOString()
          : undefined,
      },
    };
  } catch (error) {
    console.error("[Gaorui-VEO] Query error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

/**
 * 获取 VEO3 视频下载 URL
 *
 * 文档: GET /v1/videos/{id}/content
 * 用于下载已完成的视频内容
 */
export function getVeoVideoContentUrl(taskId: string): string {
  return `${GAORUI_API_BASE}/v1/videos/${taskId}/content`;
}

// ============================================================================
// 统一入口
// ============================================================================

/**
 * 统一提交 VEO3 视频生成任务
 *
 * 根据模型自动选择 sync/async 模式
 *
 * @returns sync 模式直接返回 videoUrl, async 模式返回 taskId（需轮询）
 */
export async function submitVeo3Video(
  params: VeoSubmitParams,
  apiKey?: string
): Promise<{
  success: boolean;
  mode: "sync" | "async";
  videoUrl?: string;  // sync 模式
  taskId?: string;    // async 模式
  error?: string;
}> {
  switch (params.model) {
    case "veo_3_1-components": {
      const r = await submitVeoComponents(params, apiKey);
      return { ...r, mode: "async" };
    }
    case "veo3.1-fast": {
      const r = await submitVeoFast(params, apiKey);
      return { ...r, mode: "async" };
    }
    case "veo3.1-fast-4K": {
      const r = await submitVeoFast4K(params, apiKey);
      return { ...r, mode: "async" };
    }
    default:
      return { success: false, mode: "async", error: `未知模型: ${params.model}` };
  }
}
