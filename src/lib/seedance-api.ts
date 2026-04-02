/**
 * Seedance 2.0 API Client
 * 
 * 火山方舟 Seedance 2.0 视频生成 API 封装
 * 使用 Endpoint ID 调用（不是 Model Name）
 * 
 * API 文档: https://www.volcengine.com/docs/82379/2291680
 * 
 * 支持功能:
 * - 文生视频 (text → video)
 * - 图生视频 (image + text → video)
 * - 音画同生 (generate_audio: true)
 * 
 * 两种分辨率:
 * - 480p: 标准版，配合 FFmpeg 超分到 1080p
 * - 720p: Pro 版，原生输出
 */

// ============================================================================
// 配置
// ============================================================================

const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_ENDPOINT_STANDARD = process.env.ARK_ENDPOINT_STANDARD || '';
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

// ============================================================================
// 类型定义
// ============================================================================

/** Seedance 提交参数 */
export interface SeedanceSubmitParams {
  prompt: string;
  imageUrl?: string;              // 可选首帧图片（图生视频）
  duration: 5 | 10;
  resolution: '480p' | '720p';
  ratio: '9:16' | '16:9';
}

/** Seedance 任务结果 */
export interface SeedanceTaskResult {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  videoUrl?: string;
  tokens?: number;
  error?: string;
}

/** API 请求 Content 项 */
interface ArkContentItem {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

/** API 创建任务响应 */
interface ArkCreateResponse {
  id: string;
  model: string;
  status: string;
  error?: {
    code: string;
    message: string;
  };
}

/** API 查询任务响应 */
interface ArkQueryResponse {
  id: string;
  model: string;
  status: string;
  content?: {
    video_url: string;
  };
  usage?: {
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// 分辨率映射
// ============================================================================

/**
 * 根据比例和分辨率档位获取实际像素分辨率
 * 
 * 480p 档位实际像素（总像素按比例分配）:
 *   - 9:16 → 280×496
 *   - 16:9 → 496×280
 * 
 * 720p 档位实际像素:
 *   - 9:16 → 720×1280 
 *   - 16:9 → 1280×720
 */
function getApiResolution(resolution: '480p' | '720p', ratio: '9:16' | '16:9'): string {
  if (resolution === '720p') {
    return ratio === '9:16' ? '720p' : '720p';
  }
  return '480p';
}

// ============================================================================
// API 方法
// ============================================================================

/**
 * 提交 Seedance 视频生成任务
 * 
 * 使用火山方舟 Contents Generations API
 * POST /api/v3/contents/generations/tasks
 */
export async function submitSeedanceTask(params: SeedanceSubmitParams): Promise<SeedanceTaskResult> {
  const { prompt, imageUrl, duration, resolution, ratio } = params;

  if (!ARK_API_KEY) {
    throw new Error('[Seedance] ARK_API_KEY is not configured');
  }
  if (!ARK_ENDPOINT_STANDARD) {
    throw new Error('[Seedance] ARK_ENDPOINT_STANDARD is not configured');
  }

  // 构建 content 数组
  const content: ArkContentItem[] = [];

  // 如果有图片，先加图片
  if (imageUrl) {
    content.push({
      type: 'image_url',
      image_url: { url: imageUrl },
    });
  }

  // 加文本提示词
  content.push({
    type: 'text',
    text: prompt,
  });

  // 构建请求体
  const requestBody = {
    model: ARK_ENDPOINT_STANDARD,  // 必须使用 Endpoint ID
    content,
    // 视频生成参数
    duration,
    resolution: getApiResolution(resolution, ratio),
    ratio,
    generate_audio: true,  // 音画同生
    watermark: false,
    seed: -1,              // 随机种子
  };

  console.log('[Seedance] Submitting task:', {
    prompt: prompt.substring(0, 60) + '...',
    hasImage: !!imageUrl,
    duration,
    resolution,
    ratio,
    endpointId: ARK_ENDPOINT_STANDARD,
  });

  try {
    const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Seedance] API error:', response.status, errorText);
      return {
        taskId: '',
        status: 'failed',
        error: `API Error ${response.status}: ${errorText}`,
      };
    }

    const data: ArkCreateResponse = await response.json();

    if (data.error) {
      console.error('[Seedance] Task creation error:', data.error);
      return {
        taskId: data.id || '',
        status: 'failed',
        error: `${data.error.code}: ${data.error.message}`,
      };
    }

    console.log('[Seedance] Task created:', {
      taskId: data.id,
      status: data.status,
    });

    return {
      taskId: data.id,
      status: mapStatus(data.status),
    };
  } catch (error) {
    console.error('[Seedance] Submit error:', error);
    return {
      taskId: '',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 查询 Seedance 任务状态
 * 
 * GET /api/v3/contents/generations/tasks/{task_id}
 */
export async function querySeedanceTask(taskId: string): Promise<SeedanceTaskResult> {
  if (!ARK_API_KEY) {
    throw new Error('[Seedance] ARK_API_KEY is not configured');
  }

  try {
    const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ARK_API_KEY}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Seedance] Query error:', response.status, errorText);
      return {
        taskId,
        status: 'failed',
        error: `Query Error ${response.status}: ${errorText}`,
      };
    }

    const data: ArkQueryResponse = await response.json();

    if (data.error) {
      console.error('[Seedance] Task error:', data.error);
      return {
        taskId,
        status: 'failed',
        error: `${data.error.code}: ${data.error.message}`,
      };
    }

    const result: SeedanceTaskResult = {
      taskId: data.id,
      status: mapStatus(data.status),
    };

    // 如果生成成功，提取视频 URL 和 token 用量
    if (data.status === 'succeeded' && data.content?.video_url) {
      result.videoUrl = data.content.video_url;
    }

    if (data.usage) {
      result.tokens = data.usage.completion_tokens || data.usage.total_tokens;
    }

    console.log('[Seedance] Task status:', {
      taskId,
      status: result.status,
      hasVideoUrl: !!result.videoUrl,
      tokens: result.tokens,
    });

    return result;
  } catch (error) {
    console.error('[Seedance] Query error:', error);
    return {
      taskId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 将 API 状态映射到内部状态
 */
function mapStatus(apiStatus: string): SeedanceTaskResult['status'] {
  switch (apiStatus) {
    case 'queued':
    case 'pending':
      return 'queued';
    case 'running':
    case 'processing':
      return 'running';
    case 'succeeded':
    case 'completed':
      return 'succeeded';
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'failed';
    default:
      console.warn('[Seedance] Unknown status:', apiStatus);
      return 'running';  // 默认当作进行中
  }
}

/**
 * 判断 Seedance 模型是否需要 FFmpeg 超分
 */
export function needsUpscaling(model: string): boolean {
  return model === 'seedance-5s' || model === 'seedance-10s';
}

/**
 * 根据模型 ID 获取 API 参数
 */
export function getSeedanceParams(model: string): {
  duration: 5 | 10;
  resolution: '480p' | '720p';
} {
  switch (model) {
    case 'seedance-5s':
      return { duration: 5, resolution: '480p' };
    case 'seedance-10s':
      return { duration: 10, resolution: '480p' };
    case 'seedance-5s-pro':
      return { duration: 5, resolution: '720p' };
    case 'seedance-10s-pro':
      return { duration: 10, resolution: '720p' };
    default:
      return { duration: 5, resolution: '480p' };
  }
}
