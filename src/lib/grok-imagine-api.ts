/**
 * Grok Imagine 视频生成 API
 * 
 * 提供商: 速创/无印科技 (wuyinkeji)
 * 模型: xAI Grok Imagine (grok_imagine)
 * 价格: 0.05元/秒 (10秒=0.50元, 15秒=0.75元)
 * 
 * 文档: https://api.wuyinkeji.com （文档中心 → grok_imagine）
 * 
 * 接口:
 *   提交: POST /api/async/video_grok_imagine (application/json)
 *   查询: GET  /api/async/detail?key=...&id=...
 * 
 * 状态码:
 *   0 = 处理中 (processing)
 *   2 = 完成 (completed) → result[0] 有视频 URL
 *   3 = 失败 (failed)
 * 
 * 注意: 状态码与 Sora2 不同！Sora2 的 1=成功, Grok 的 2=成功
 */

import https from 'https';

// ============================================================================
// 配置
// ============================================================================

const WUYINKEJI_API_BASE = "https://api.wuyinkeji.com";
const WUYINKEJI_API_KEY = process.env.WUYINKEJI_API_KEY || "";

// ============================================================================
// 类型定义
// ============================================================================

/** Grok Imagine 提交参数 */
export interface GrokImagineParams {
  /** 提示词（必需） */
  prompt: string;
  /** 视频时长：10 或 15 秒 */
  duration: 10 | 15;
  /** 画面比例：横屏 16:9 或竖屏 9:16 */
  aspectRatio: "16:9" | "9:16";
  /** 参考图 URL 数组（可选，有参考图时比例不生效） */
  imageUrls?: string[];
}

/** Grok Imagine 提交响应 */
interface GrokSubmitResponse {
  code: number;
  msg: string;
  data?: {
    id: string;
    count: string | null;
  };
  exec_time?: number;
}

/** Grok Imagine 查询响应 */
interface GrokQueryResponse {
  code: number;
  msg: string;
  data?: {
    task_id: string;
    status: number; // 0=处理中, 2=完成, 3=失败
    result?: string[];
    duration?: string;
    message?: string;
    fail_reason?: string;
    created_at?: string;
    updated_at?: string;
    request?: {
      prompt?: string;
    };
  };
}

/** 通用任务状态 */
export interface GrokTaskStatus {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  errorMessage?: string;
  duration?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// 提交任务
// ============================================================================

/**
 * 提交 Grok Imagine 视频生成任务
 * 
 * POST https://api.wuyinkeji.com/api/async/video_grok_imagine
 * Authorization: {key}（不带 Bearer 前缀）
 * Content-Type: application/json
 */
export async function submitGrokImagine(
  params: GrokImagineParams,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const key = apiKey || WUYINKEJI_API_KEY;
  if (!key) {
    return { success: false, error: "无印科技 API Key 未配置 (WUYINKEJI_API_KEY)" };
  }

  // 参数校验
  if (!params.prompt || params.prompt.trim().length === 0) {
    return { success: false, error: "提示词不能为空" };
  }
  if (params.duration !== 10 && params.duration !== 15) {
    return { success: false, error: "Grok Imagine 仅支持 10 秒和 15 秒视频" };
  }

  try {
    const requestBody: Record<string, unknown> = {
      prompt: params.prompt,
      duration: String(params.duration),
      aspect_ratio: params.aspectRatio || "9:16",
    };

    // 参考图（可选，有参考图时比例不生效）
    if (params.imageUrls && params.imageUrls.length > 0) {
      requestBody.image_urls = params.imageUrls;
    }

    const bodyStr = JSON.stringify(requestBody);

    console.log("[Grok-Imagine] Submitting task:", {
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      hasImages: !!(params.imageUrls && params.imageUrls.length > 0),
      imageCount: params.imageUrls?.length || 0,
      prompt: params.prompt.substring(0, 60) + "...",
    });

    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const bodyBuffer = Buffer.from(bodyStr, 'utf-8');
      const req = https.request({
        hostname: new URL(WUYINKEJI_API_BASE).hostname,
        port: 443,
        path: "/api/async/video_grok_imagine",
        method: "POST",
        family: 4,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': key, // 不带 Bearer 前缀
          'Accept': 'application/json',
          'Content-Length': String(bodyBuffer.length),
        },
        timeout: 30000,
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

    console.log("[Grok-Imagine] Submit response (status:", result.statusCode, "):", result.data.substring(0, 300));

    if (result.statusCode >= 500) {
      return { success: false, error: `Grok Imagine 服务暂时繁忙 (${result.statusCode})，请稍后重试` };
    }

    let response: GrokSubmitResponse;
    try {
      response = JSON.parse(result.data);
    } catch {
      console.error("[Grok-Imagine] Failed to parse response:", result.data.substring(0, 300));
      return { success: false, error: "Grok Imagine 服务响应格式错误" };
    }

    if (response.code !== 200) {
      return { success: false, error: response.msg || `Grok Imagine 提交失败 (code: ${response.code})` };
    }

    const taskId = response.data?.id;
    if (!taskId) {
      return { success: false, error: "Grok Imagine 未返回任务 ID" };
    }

    console.log("[Grok-Imagine] Task submitted:", {
      taskId,
      count: response.data?.count,
      execTime: response.exec_time,
    });

    return { success: true, taskId };
  } catch (error) {
    console.error("[Grok-Imagine] Submit error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error"
    };
  }
}

// ============================================================================
// 查询任务
// ============================================================================

/**
 * 查询 Grok Imagine 任务结果
 * 
 * GET https://api.wuyinkeji.com/api/async/detail?key={key}&id={taskId}
 * 
 * 状态码: 0=处理中, 2=完成, 3=失败
 * 视频 URL: data.result[0]
 */
export async function queryGrokImagineResult(
  taskId: string,
  apiKey?: string
): Promise<{ success: boolean; task?: GrokTaskStatus; error?: string; raw?: unknown }> {
  const key = apiKey || WUYINKEJI_API_KEY;
  if (!key) {
    return { success: false, error: "无印科技 API Key 未配置 (WUYINKEJI_API_KEY)" };
  }

  try {
    const endpoint = `${WUYINKEJI_API_BASE}/api/async/detail?key=${encodeURIComponent(key)}&id=${encodeURIComponent(taskId)}`;

    console.log("[Grok-Imagine] Querying task:", taskId);

    const result = await new Promise<{ data: string; statusCode: number }>((resolve, reject) => {
      const urlObj = new URL(endpoint);
      const req = https.request({
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        family: 4,
        timeout: 30000,
        headers: {
          'Authorization': key,
          'Accept': 'application/json',
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => resolve({ data, statusCode: res.statusCode || 0 }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.end();
    });

    let response: GrokQueryResponse;
    try {
      response = JSON.parse(result.data);
    } catch {
      console.error("[Grok-Imagine] Failed to parse query response:", result.data.substring(0, 300));
      return { success: false, error: "查询响应格式错误" };
    }

    if (response.code !== 200) {
      return { success: false, error: response.msg || "Grok Imagine 查询失败" };
    }

    const taskData = response.data;
    if (!taskData) {
      return { success: false, error: "查询响应无数据" };
    }

    // 状态映射: 0=处理中, 2=完成, 3=失败
    // ⚠️ 注意：与 Sora2 不同！Sora2 的 1=成功, Grok 的 2=成功
    const statusMap: Record<number, GrokTaskStatus["status"]> = {
      0: "processing",
      2: "completed",
      3: "failed",
    };
    let taskStatus = statusMap[taskData.status] ?? "processing";

    // 容错：如果有失败信息但状态不是3，也标记失败
    if (taskData.fail_reason && taskData.status !== 2) {
      taskStatus = "failed";
    }

    // 提取视频 URL: result 是字符串数组
    let videoUrl: string | undefined;
    if (taskData.result && Array.isArray(taskData.result) && taskData.result.length > 0) {
      videoUrl = taskData.result[0];
    }

    console.log("[Grok-Imagine] Query result:", {
      taskId: taskData.task_id,
      status: taskData.status,
      mappedStatus: taskStatus,
      hasVideoUrl: !!videoUrl,
      duration: taskData.duration,
    });

    return {
      success: true,
      task: {
        taskId: taskData.task_id || taskId,
        status: taskStatus,
        videoUrl,
        errorMessage: taskData.fail_reason || taskData.message,
        duration: taskData.duration,
        createdAt: taskData.created_at,
        updatedAt: taskData.updated_at,
      },
      raw: response,
    };
  } catch (error) {
    console.error("[Grok-Imagine] Query error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error"
    };
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 获取 Grok Imagine 单价（元/条）
 */
export function getGrokImaginePrice(duration: 10 | 15): number {
  return duration * 0.05; // 0.05元/秒
}

/**
 * 获取 Grok Imagine 积分消耗
 * 按公司积分体系换算（1积分=0.1元）
 */
export function getGrokImagineCreditCost(duration: 10 | 15): number {
  const price = getGrokImaginePrice(duration);
  return Math.ceil(price * 10); // 0.50元→5积分, 0.75元→8积分（向上取整）
}
