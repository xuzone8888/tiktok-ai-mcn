/**
 * Grok Provider — xAI 视频生成适配层
 *
 * 使用 Vercel AI SDK `@ai-sdk/xai` 实现：
 * 1. reference-to-video: 参考图生成视频（保持人物/产品一致性）
 * 2. extend-video: 链式延伸（零拼接，连续生成）
 *
 * 审计约束: 生成结果必须先转存自有 OSS
 */

import type { ProviderAlias, ViralCloneAsset } from '@/types/viral-clone';
import { getProviderConfig, getActualModelName } from './provider-registry';
import { uploadBuffer, generateMediaPath, getPublicUrl } from '@/lib/oss';

// ============================================================================
// 配置
// ============================================================================

/** 生成超时（毫秒）— Grok 视频生成通常 60-120s */
const GENERATE_TIMEOUT_MS = 180000;

/** 下载超时（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 60000;

// ============================================================================
// 类型
// ============================================================================

/** 生成请求 */
export interface GrokGenerateRequest {
  /** Provider 别名 */
  provider: ProviderAlias;
  /** 视频提示词 */
  prompt: string;
  /** 参考图 URL 列表 */
  ref_images: string[];
  /** 画面比例 */
  aspect_ratio: '9:16' | '16:9';
  /** 用户 ID（用于 OSS 路径） */
  user_id: string;
  /** 目标时长（秒） */
  duration?: number;
}

/** 延伸请求 */
export interface GrokExtendRequest {
  /** 视频提示词 */
  prompt: string;
  /** 上一段视频的 OSS URL */
  source_video_url: string;
  /** 画面比例 */
  aspect_ratio: '9:16' | '16:9';
  /** 用户 ID */
  user_id: string;
  /** 目标时长（秒） */
  duration?: number;
}

/** 生成结果 */
export interface GrokGenerateResult {
  success: boolean;
  /** 自有 OSS URL */
  oss_url?: string;
  /** OSS 对象键 */
  oss_key?: string;
  /** 文件大小（bytes） */
  size_bytes?: number;
  /** 耗时（毫秒） */
  duration_ms?: number;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 使用参考图生成视频段（reference-to-video 模式）
 *
 * 适用于第一段或需要锚定人物/产品一致性的段
 */
export async function generateWithReference(
  request: GrokGenerateRequest
): Promise<GrokGenerateResult> {
  const startTime = Date.now();

  try {
    const { xai } = await import('@ai-sdk/xai');
    const { experimental_generateVideo: generateVideo } = await import('ai');

    const actualModel = getActualModelName(request.provider);

    console.log(`[GrokProvider] reference-to-video:`, {
      model: actualModel,
      refImageCount: request.ref_images.length,
      aspectRatio: request.aspect_ratio,
      promptLength: request.prompt.length,
    });

    const result = await generateVideo({
      model: xai.video(actualModel),
      prompt: request.prompt,
      providerOptions: {
        xai: {
          mode: 'reference-to-video',
          referenceImageUrls: request.ref_images.slice(0, 3),
        },
      },
      aspectRatio: request.aspect_ratio,
      duration: request.duration || 8,
      abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });

    // 提取视频 URL
    const videoUrl = extractVideoUrl(result);
    if (!videoUrl) {
      return { success: false, error: 'Grok 未返回视频 URL', duration_ms: Date.now() - startTime };
    }

    // 下载到自有 OSS
    return await downloadToOSS(videoUrl, request.user_id, 'grok-ref', startTime);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[GrokProvider] reference-to-video error:`, errMsg);
    return { success: false, error: errMsg, duration_ms: Date.now() - startTime };
  }
}

/**
 * 链式延伸视频（extend-video 模式）
 *
 * 从上一段视频的最后一帧开始继续生成，实现零拼接连续性
 */
export async function extendVideo(
  request: GrokExtendRequest
): Promise<GrokGenerateResult> {
  const startTime = Date.now();

  try {
    const { xai } = await import('@ai-sdk/xai');
    const { experimental_generateVideo: generateVideo } = await import('ai');

    const actualModel = getActualModelName('grok_extend');

    console.log(`[GrokProvider] extend-video:`, {
      model: actualModel,
      sourceUrl: request.source_video_url.substring(0, 60),
      promptLength: request.prompt.length,
    });

    const result = await generateVideo({
      model: xai.video(actualModel),
      prompt: request.prompt,
      providerOptions: {
        xai: {
          mode: 'extend-video',
          videoUrl: request.source_video_url,
        },
      },
      aspectRatio: request.aspect_ratio,
      duration: request.duration || 8,
      abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });

    const videoUrl = extractVideoUrl(result);
    if (!videoUrl) {
      return { success: false, error: 'Grok extend 未返回视频 URL', duration_ms: Date.now() - startTime };
    }

    return await downloadToOSS(videoUrl, request.user_id, 'grok-ext', startTime);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[GrokProvider] extend-video error:`, errMsg);
    return { success: false, error: errMsg, duration_ms: Date.now() - startTime };
  }
}

// ============================================================================
// 内部工具函数
// ============================================================================

/**
 * 从 Vercel AI SDK 结果提取视频 URL
 */
function extractVideoUrl(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;

  const r = result as Record<string, unknown>;

  // SDK 返回格式可能是 { video: { url } } 或 { url }
  if (r.video && typeof r.video === 'object') {
    const v = r.video as Record<string, unknown>;
    if (typeof v.url === 'string') return v.url;
    if (typeof v.base64 === 'string') return `data:video/mp4;base64,${v.base64}`;
  }

  if (typeof r.url === 'string') return r.url;

  // 尝试 experimental 格式
  if (Array.isArray(r.videos) && r.videos.length > 0) {
    const first = r.videos[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first && typeof (first as Record<string, unknown>).url === 'string') {
      return (first as Record<string, unknown>).url as string;
    }
  }

  console.warn('[GrokProvider] Unknown result format:', JSON.stringify(r).substring(0, 200));
  return null;
}

/**
 * 下载视频并转存到自有 OSS（审计补充①）
 */
async function downloadToOSS(
  videoUrl: string,
  userId: string,
  prefix: string,
  startTime: number
): Promise<GrokGenerateResult> {
  try {
    let videoBuffer: Buffer;

    if (videoUrl.startsWith('data:')) {
      // base64 data URL
      const base64Data = videoUrl.split(',')[1];
      videoBuffer = Buffer.from(base64Data, 'base64');
    } else {
      // HTTP URL — 下载
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      const response = await fetch(videoUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'ViralClone/1.5-Grok' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { success: false, error: `下载失败: HTTP ${response.status}`, duration_ms: Date.now() - startTime };
      }

      const arrayBuffer = await response.arrayBuffer();
      videoBuffer = Buffer.from(arrayBuffer);
    }

    // 上传到自有 OSS
    const taskId = Date.now().toString(36);
    const ossKey = generateMediaPath('videos', userId, `vc-${prefix}-${taskId}.mp4`);
    const ossUrl = await uploadBuffer(videoBuffer, ossKey, 'video/mp4');

    const totalDuration = Date.now() - startTime;
    console.log(`[GrokProvider] Complete: size=${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB, total=${(totalDuration / 1000).toFixed(1)}s`);

    return {
      success: true,
      oss_url: ossUrl,
      oss_key: ossKey,
      size_bytes: videoBuffer.length,
      duration_ms: totalDuration,
    };
  } catch (error) {
    return {
      success: false,
      error: `OSS 转存失败: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}
