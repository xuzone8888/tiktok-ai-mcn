/**
 * VEO Provider — VEO3 视频生成适配层
 *
 * 职责:
 * 1. 接收 ProviderAlias + prompt + 参考图，调用底层 gaorui-veo-api
 * 2. 轮询等待结果
 * 3. 下载 provider 视频到自有 OSS（审计补充①）
 * 4. 返回 OSS URL + 元数据
 *
 * 不直接写死 model 名，从 provider-registry 获取。
 */

import type {
  ProviderAlias,
  ViralCloneAsset,
} from '../types';
import { getProviderConfig, getActualModelName } from './provider-registry';
import {
  submitVeoComponents,
  submitVeoFast,
  queryVeoResult,
  type VeoSubmitParams,
  type GaoruiVeoModel,
} from '@/lib/gaorui-veo-api';
import { uploadBuffer, generateMediaPath, getPublicUrl } from '@/lib/oss';

// ============================================================================
// 配置
// ============================================================================

/** 最大轮询次数 */
const MAX_POLL_ATTEMPTS = 120;

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 5000;

/** 下载超时（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 60000;

// ============================================================================
// 类型
// ============================================================================

/** 生成请求 */
export interface VeoGenerateRequest {
  /** Provider 别名 */
  provider: ProviderAlias;
  /** 视频提示词 */
  prompt: string;
  /** 参考图 URL 列表（OSS URL） */
  ref_images: string[];
  /** 画面比例 */
  aspect_ratio: '9:16' | '16:9';
  /** 用户 ID（用于 OSS 路径） */
  user_id: string;
}

/** 生成结果 */
export interface VeoGenerateResult {
  success: boolean;
  /** 自有 OSS URL */
  oss_url?: string;
  /** OSS 对象键 */
  oss_key?: string;
  /** provider 原始 URL（仅审计用） */
  provider_url?: string;
  /** provider 任务 ID */
  provider_task_id?: string;
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
 * 提交视频生成任务并等待完成
 *
 * 完整流程:
 * 1. 从 registry 获取 actual_model
 * 2. 调用 gaorui-veo-api 提交任务
 * 3. 轮询等待完成
 * 4. 下载视频到 OSS（审计补充①: provider 结果必须先转存 OSS）
 * 5. 返回 OSS URL
 */
export async function generateSegmentVideo(
  request: VeoGenerateRequest
): Promise<VeoGenerateResult> {
  const startTime = Date.now();
  const config = getProviderConfig(request.provider);
  const actualModel = getActualModelName(request.provider);

  console.log(`[VeoProvider] Starting generation:`, {
    provider: request.provider,
    actualModel,
    refImageCount: request.ref_images.length,
    aspectRatio: request.aspect_ratio,
    promptLength: request.prompt.length,
  });

  // 验证参考图数量
  if (request.ref_images.length > config.max_ref_images) {
    return {
      success: false,
      error: `Provider ${request.provider} 最多支持 ${config.max_ref_images} 张参考图，收到 ${request.ref_images.length} 张`,
    };
  }

  try {
    // ========================================================================
    // Step 1: 提交任务
    // ========================================================================

    const submitParams: VeoSubmitParams = {
      prompt: request.prompt,
      model: actualModel as GaoruiVeoModel,
      aspectRatio: request.aspect_ratio,
      imageUrls: request.ref_images.length > 0 ? request.ref_images : undefined,
    };

    let submitResult;
    if (config.api_format === 'json') {
      // veo_std_refs → submitVeoComponents (JSON body, 图片传 URL)
      submitResult = await submitVeoComponents(submitParams);
    } else {
      // veo_fast_frames → submitVeoFast (multipart, 图片下载后上传)
      submitResult = await submitVeoFast(submitParams);
    }

    if (!submitResult.success || !submitResult.taskId) {
      return {
        success: false,
        error: submitResult.error || '提交任务失败，未返回 taskId',
      };
    }

    const taskId = submitResult.taskId;
    console.log(`[VeoProvider] Task submitted: ${taskId}`);

    // ========================================================================
    // Step 2: 轮询等待完成
    // ========================================================================

    let providerVideoUrl: string | undefined;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const queryResult = await queryVeoResult(taskId);
      if (!queryResult.success || !queryResult.task) {
        console.warn(`[VeoProvider] Poll ${attempt + 1}: query failed, retrying...`);
        continue;
      }

      const { task } = queryResult;

      switch (task.status) {
        case 'completed':
          if (task.videoUrl) {
            providerVideoUrl = task.videoUrl;
            console.log(`[VeoProvider] Task completed: ${taskId}, videoUrl available`);
          } else {
            return {
              success: false,
              provider_task_id: taskId,
              error: '任务完成但未返回视频 URL',
            };
          }
          break;

        case 'failed':
          return {
            success: false,
            provider_task_id: taskId,
            error: task.errorMessage || 'Provider 生成失败',
          };

        case 'pending':
        case 'processing':
          if (attempt % 12 === 0) {
            console.log(`[VeoProvider] Poll ${attempt + 1}/${MAX_POLL_ATTEMPTS}: ${task.status}, progress: ${task.progress || 'N/A'}%`);
          }
          continue;

        default:
          continue;
      }

      // 完成则跳出循环
      if (providerVideoUrl) break;
    }

    if (!providerVideoUrl) {
      return {
        success: false,
        provider_task_id: taskId,
        error: `轮询超时 (${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s)`,
      };
    }

    // ========================================================================
    // Step 3: 下载视频到自有 OSS（审计补充①）
    // ========================================================================

    console.log(`[VeoProvider] Downloading provider video to OSS...`);
    const downloadStart = Date.now();

    const videoBuffer = await downloadVideoBuffer(providerVideoUrl);
    if (!videoBuffer) {
      return {
        success: false,
        provider_task_id: taskId,
        provider_url: providerVideoUrl,
        error: '下载 provider 视频失败',
      };
    }

    // 上传到自有 OSS
    const ossKey = generateMediaPath('videos', request.user_id, `vc-segment-${taskId}.mp4`);
    const ossUrl = await uploadBuffer(videoBuffer, ossKey, 'video/mp4');

    const totalDuration = Date.now() - startTime;
    console.log(`[VeoProvider] Complete: taskId=${taskId}, size=${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB, total=${(totalDuration / 1000).toFixed(1)}s`);

    return {
      success: true,
      oss_url: ossUrl,
      oss_key: ossKey,
      provider_url: providerVideoUrl,
      provider_task_id: taskId,
      size_bytes: videoBuffer.length,
      duration_ms: totalDuration,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[VeoProvider] Error:`, errMsg);
    return {
      success: false,
      error: errMsg,
      duration_ms: Date.now() - startTime,
    };
  }
}

// ============================================================================
// 内部工具函数
// ============================================================================

/**
 * 下载视频文件为 Buffer
 */
async function downloadVideoBuffer(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ViralClone/1.5',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[VeoProvider] Download failed: HTTP ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`[VeoProvider] Download error:`, error);
    return null;
  }
}

/**
 * 简单的 sleep 工具
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
