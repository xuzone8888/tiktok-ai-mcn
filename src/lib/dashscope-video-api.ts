/**
 * DashScope HappyHorse video generation adapter.
 *
 * Docs: POST /api/v1/services/aigc/video-generation/video-synthesis
 * Query: GET /api/v1/tasks/{task_id}
 */

const DASHSCOPE_API_BASE = process.env.DASHSCOPE_API_ENDPOINT || "https://dashscope.aliyuncs.com";
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "";

export type HappyHorseRatio = "16:9" | "9:16";
export type HappyHorseResolution = "720P" | "1080P";
export type HappyHorseModel = "happyhorse-1.0-t2v" | "happyhorse-1.0-r2v";
export type HappyHorseStatus = "pending" | "processing" | "completed" | "failed";

export interface SubmitHappyHorseParams {
  prompt: string;
  ratio?: HappyHorseRatio;
  duration?: 5 | 12;
  resolution?: HappyHorseResolution;
  imageUrls?: string[];
}

export interface HappyHorseTask {
  taskId: string;
  status: HappyHorseStatus;
  videoUrl?: string;
  errorMessage?: string;
  requestId?: string;
  usage?: unknown;
}

function getApiKey(apiKey?: string): string {
  return apiKey || DASHSCOPE_API_KEY;
}

function normalizeStatus(taskStatus?: string): HappyHorseStatus {
  switch ((taskStatus || "").toUpperCase()) {
    case "SUCCEEDED":
      return "completed";
    case "FAILED":
    case "UNKNOWN":
      return "failed";
    case "PENDING":
      return "pending";
    case "RUNNING":
    default:
      return "processing";
  }
}

function pickErrorMessage(data: Record<string, any>): string | undefined {
  return (
    data.message ||
    data.output?.message ||
    data.output?.error_message ||
    data.output?.code ||
    data.code ||
    undefined
  );
}

export async function submitHappyHorseVideo(
  params: SubmitHappyHorseParams,
  apiKey?: string
): Promise<{ success: boolean; taskId?: string; requestId?: string; model?: HappyHorseModel; error?: string }> {
  const key = getApiKey(apiKey);
  if (!key) {
    return { success: false, error: "DASHSCOPE_API_KEY 未配置" };
  }

  try {
    const referenceImageUrls = Array.from(new Set(
      (params.imageUrls || [])
        .map((url) => url.trim())
        .filter((url) => url.startsWith("http://") || url.startsWith("https://"))
    )).slice(0, 9);
    const model: HappyHorseModel = referenceImageUrls.length > 0
      ? "happyhorse-1.0-r2v"
      : "happyhorse-1.0-t2v";
    const input: Record<string, unknown> = {
      prompt: params.prompt,
    };

    if (referenceImageUrls.length > 0) {
      input.media = referenceImageUrls.map((url) => ({
        type: "reference_image",
        url,
      }));
    }

    const response = await fetch(
      `${DASHSCOPE_API_BASE}/api/v1/services/aigc/video-generation/video-synthesis`,
      {
        method: "POST",
        headers: {
          "X-DashScope-Async": "enable",
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input,
          parameters: {
            resolution: params.resolution || "720P",
            ratio: params.ratio || "16:9",
            duration: params.duration || 5,
          },
        }),
      }
    );

    const text = await response.text();
    let data: Record<string, any>;
    try {
      data = JSON.parse(text);
    } catch {
      return { success: false, error: `DashScope 返回非 JSON: ${text.substring(0, 200)}` };
    }

    if (!response.ok) {
      return { success: false, error: pickErrorMessage(data) || `DashScope HTTP ${response.status}` };
    }

    const taskId = data.output?.task_id || data.task_id;
    if (!taskId) {
      return { success: false, error: `DashScope 未返回 task_id: ${text.substring(0, 200)}` };
    }

    return {
      success: true,
      taskId,
      requestId: data.request_id,
      model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "DashScope 提交失败",
    };
  }
}

export async function queryHappyHorseVideo(
  taskId: string,
  apiKey?: string
): Promise<{ success: boolean; task?: HappyHorseTask; error?: string }> {
  const key = getApiKey(apiKey);
  if (!key) {
    return { success: false, error: "DASHSCOPE_API_KEY 未配置" };
  }

  try {
    const response = await fetch(`${DASHSCOPE_API_BASE}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();
    let data: Record<string, any>;
    try {
      data = JSON.parse(text);
    } catch {
      return { success: false, error: `DashScope 查询返回非 JSON: ${text.substring(0, 200)}` };
    }

    if (!response.ok) {
      return { success: false, error: pickErrorMessage(data) || `DashScope HTTP ${response.status}` };
    }

    const status = normalizeStatus(data.output?.task_status);
    const videoUrl = data.output?.video_url || data.output?.url || data.output?.results?.[0]?.url;

    return {
      success: true,
      task: {
        taskId: data.output?.task_id || taskId,
        status,
        videoUrl,
        errorMessage: status === "failed" ? pickErrorMessage(data) || "DashScope 视频生成失败" : undefined,
        requestId: data.request_id,
        usage: data.usage,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "DashScope 查询失败",
    };
  }
}
