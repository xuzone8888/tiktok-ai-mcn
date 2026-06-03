/**
 * Stitcher — FFmpeg 气口拼接
 *
 * 审计修正 3.3: 重型 stitch 走专用 Worker，不走 Web API route
 *
 * 职责:
 * 1. silencedetect 检测静音
 * 2. 裁掉死空白，保留 80-200ms 自然呼吸
 * 3. loudnorm 音频标准化
 * 4. 按 seam_hint 选择过渡方式（硬切/微淡化）
 * 5. 拼接为完整视频
 * 6. 最终 720p→1080p 超分（调用 upscaleVideo）
 *
 * 执行方式: 调用 FFmpeg Worker 的 /api/stitch 端点
 */

import type {
  ViralCloneSegment,
  StitchConfig,
  AspectRatio,
} from '@/types/viral-clone';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DEFAULT_STITCH_CONFIG, UPSCALE_CONFIG } from '@/types/viral-clone';
import { uploadBuffer, generateMediaPath } from '@/lib/oss';
import { upscaleVideo, getUpscaleTarget } from '@/lib/video-upscale';

// ============================================================================
// 配置
// ============================================================================

/** FFmpeg Worker URL */
const FFMPEG_WORKER_URL = process.env.FFMPEG_WORKER_URL || 'http://localhost:9090';
const FFMPEG_WORKER_TOKEN = process.env.WORKER_AUTH_TOKEN || '';

/** Stitch 超时（毫秒） */
const STITCH_TIMEOUT_MS = 180000; // 3 分钟
const execAsync = promisify(exec);

// ============================================================================
// 类型
// ============================================================================

export interface StitchRequest {
  /** 有序的 segment 列表（必须按 segment_index 排列） */
  segments: Array<{
    videoUrl: string;       // OSS URL
    trimStartMs: number;
    trimEndMs: number;
    seamHint: string;
    role: string;
    generationDurationMs?: number;  // 模型生成时长（毫秒），用于 trim 计算
  }>;
  /** 画面比例 */
  aspectRatio: AspectRatio;
  /** 拼接配置 */
  config?: StitchConfig;
  /** 用户 ID */
  userId: string;
  /** 任务 ID */
  jobId: string;
}

export interface StitchResult {
  success: boolean;
  /** 拼接后视频 OSS URL */
  stitchedUrl?: string;
  stitchedOssKey?: string;
  /** 超分后视频 OSS URL */
  upscaledUrl?: string;
  upscaledOssKey?: string;
  /** 最终视频 URL（超分开启时 = upscaledUrl，否则 = stitchedUrl） */
  finalUrl?: string;
  /** 耗时（毫秒） */
  durationMs?: number;
  error?: string;
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 执行分段拼接 + 超分
 *
 * 流程:
 * 1. 构建 FFmpeg concat 命令
 * 2. 调用 Worker 执行拼接
 * 3. 上传拼接结果到 OSS
 * 4. 调用 upscaleVideo 超分到 1080p
 * 5. 上传超分结果到 OSS
 */
export async function stitchAndUpscale(request: StitchRequest): Promise<StitchResult> {
  const startTime = Date.now();
  const config = request.config || DEFAULT_STITCH_CONFIG;

  console.log(`[Stitcher] Starting stitch: ${request.segments.length} segments, ${request.aspectRatio}`);

  if (request.segments.length === 0) {
    return { success: false, error: '没有可拼接的段' };
  }

  try {
    // ========================================================================
    // Step 1: 构建拼接参数并调用 Worker
    // ========================================================================

    const workerPayload = {
      segments: request.segments.map(seg => ({
        url: seg.videoUrl,
        trim_start_ms: seg.trimStartMs,
        trim_end_ms: seg.trimEndMs,
        seam_hint: seg.seamHint,
        role: seg.role,
      })),
      aspect_ratio: request.aspectRatio,
      config: {
        breath_min_ms: config.breath_min_ms,
        breath_max_ms: config.breath_max_ms,
        loudnorm: config.loudnorm,
        crossfade_duration: config.crossfade_duration,
      },
      job_id: request.jobId,
    };

    // 调用 Worker（审计修正 3.3: 重型 stitch 走专用 Worker）
    const stitchResponse = await callWorker('/api/stitch', workerPayload);

    if (!stitchResponse.success) {
      // Worker 不可用时的降级方案: 本地 ffmpeg concat
      console.warn(`[Stitcher] Worker unavailable, falling back to local concat`);
      return await localFallbackStitch(request, config);
    }

    // Worker 返回 OSS URL
    const stitchedUrl = stitchResponse.videoUrl;
    const stitchedOssKey = stitchResponse.ossKey || '';

    if (!stitchedUrl) {
      return { success: false, error: 'Worker 未返回视频 URL', durationMs: Date.now() - startTime };
    }

    console.log(`[Stitcher] Stitch complete: ${stitchedUrl}`);

    // ========================================================================
    // Step 2: 720p → 1080p 超分（审计补充②: 独立 timeout）
    // ========================================================================

    const target = getUpscaleTarget(request.aspectRatio);

    console.log(`[Stitcher] Starting upscale: ${target.width}x${target.height}`);

    // 下载拼接后的视频
    const stitchedResp = await fetch(stitchedUrl);
    if (!stitchedResp.ok) {
      return {
        success: true,
        stitchedUrl,
        stitchedOssKey,
        finalUrl: stitchedUrl, // 降级：直接使用未超分版本
        durationMs: Date.now() - startTime,
        error: '下载拼接视频失败，跳过超分',
      };
    }

    const stitchedBuffer = Buffer.from(await stitchedResp.arrayBuffer());

    // 执行超分
    const upscaleResult = await upscaleVideo({
      inputBuffer: stitchedBuffer,
      targetWidth: target.width,
      targetHeight: target.height,
      taskId: `vc-${request.jobId}`,
    });

    // 上传超分结果到 OSS
    const upscaledOssKey = generateMediaPath('videos', request.userId, `vc-upscaled-${request.jobId}.mp4`);
    const upscaledUrl = await uploadBuffer(
      upscaleResult.outputBuffer,
      upscaledOssKey,
      'video/mp4'
    );

    const totalDuration = Date.now() - startTime;
    console.log(`[Stitcher] Complete: ${(totalDuration / 1000).toFixed(1)}s, upscaled=${upscaleResult.success}`);

    return {
      success: true,
      stitchedUrl,
      stitchedOssKey,
      upscaledUrl,
      upscaledOssKey,
      finalUrl: upscaleResult.success ? upscaledUrl : stitchedUrl,
      durationMs: totalDuration,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Stitcher] Error:`, errMsg);
    return {
      success: false,
      error: errMsg,
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Worker 调用
// ============================================================================

async function callWorker(
  path: string,
  payload: Record<string, unknown>
): Promise<{ success: boolean; videoUrl?: string; ossKey?: string; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (FFMPEG_WORKER_TOKEN) {
      headers['Authorization'] = `Bearer ${FFMPEG_WORKER_TOKEN}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STITCH_TIMEOUT_MS);

    const response = await fetch(`${FFMPEG_WORKER_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 503) {
      return { success: false, error: 'Worker busy (503)' };
    }

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Worker error: ${response.status} ${errorText.substring(0, 200)}` };
    }

    const data = await response.json();
    return {
      success: data.success ?? !!data.videoUrl,
      videoUrl: data.videoUrl,
      ossKey: data.ossKey,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Worker unreachable',
    };
  }
}

// ============================================================================
// V2: 源视频切片
// ============================================================================

/**
 * 调用 FFmpeg Worker 切分源视频为 clips
 *
 * 非阻塞：Worker 不可用时返回空数组，Planner 会自动回退到整视频 + 时间区间提示。
 */
export async function splitSourceVideo(
  videoUrl: string,
  segments: Array<{ index: number; start_s: number; end_s: number }>
): Promise<Array<{ index: number; url: string }>> {
  try {
    console.log(`[Stitcher] Splitting source video into ${segments.length} clips...`);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (FFMPEG_WORKER_TOKEN) {
      headers['Authorization'] = `Bearer ${FFMPEG_WORKER_TOKEN}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 分钟超时

    const response = await fetch(`${FFMPEG_WORKER_URL}/api/split-source`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ videoUrl, segments }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Stitcher] Split-source failed: HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (!data.success || !Array.isArray(data.clips)) {
      console.warn(`[Stitcher] Split-source returned no clips`);
      return [];
    }

    const validClips = data.clips.filter(
      (c: { index: number; url: string | null }) => c.url !== null
    );
    console.log(`[Stitcher] ✓ Split complete: ${validClips.length}/${segments.length} clips`);
    return validClips.map((c: { index: number; url: string }) => ({ index: c.index, url: c.url }));
  } catch (error) {
    console.warn(`[Stitcher] Split-source unavailable, falling back to whole-video analysis:`, error instanceof Error ? error.message : error);
    return [];
  }
}

// ============================================================================
// 本地降级方案
// ============================================================================

/**
 * Worker 不可用时的本地拼接降级方案
 * 使用简单的 ffmpeg concat demuxer
 */
async function localFallbackStitch(
  request: StitchRequest,
  config: StitchConfig
): Promise<StitchResult> {
  const startTime = Date.now();

  const tmpDir = os.tmpdir();
  const batchId = `vc-stitch-${Date.now()}`;

  try {
    console.log(`[Stitcher] Local fallback: downloading ${request.segments.length} segments...`);

    // Step 1: 下载 + 按需 trim 所有段到本地
    const localPaths: string[] = [];
    for (let i = 0; i < request.segments.length; i++) {
      const seg = request.segments[i];
      const rawPath = path.join(tmpDir, `${batchId}_raw${i}.mp4`);
      const trimmedPath = path.join(tmpDir, `${batchId}_seg${i}.mp4`);
      const resp = await fetch(seg.videoUrl);
      if (!resp.ok) throw new Error(`Failed to download segment ${i}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(rawPath, buffer);

      // 应用 trim（气口切割）
      const trimStart = seg.trimStartMs ?? 0;
      const trimEnd = seg.trimEndMs ?? 0;
      if (trimStart > 0 || trimEnd > 0) {
        try {
          const ssArg = trimStart > 0 ? `-ss ${(trimStart / 1000).toFixed(3)}` : '';
          // 优先使用真实的 generation_duration，不再硬编码 8000
          const estDuration = (seg as unknown as Record<string, unknown>).generationDurationMs
            ? Number((seg as unknown as Record<string, unknown>).generationDurationMs)
            : 8000;
          const effectiveDuration = Math.max(estDuration - trimStart - trimEnd, 1000);
          const tArg = `-t ${(effectiveDuration / 1000).toFixed(3)}`;
          const trimCmd = `ffmpeg -y ${ssArg} -i "${rawPath.replace(/\\/g, '/')}" ${tArg} -c copy "${trimmedPath.replace(/\\/g, '/')}"`;
          await execAsync(trimCmd, { timeout: 30000 });
          if (fs.existsSync(trimmedPath)) {
            localPaths.push(trimmedPath);
            try { fs.unlinkSync(rawPath); } catch { /* ok */ }
            console.log(`[Stitcher] Segment ${i}: trimmed ${trimStart}ms head, ${trimEnd}ms tail`);
            continue;
          }
        } catch (trimErr) {
          console.warn(`[Stitcher] Trim failed for segment ${i}, using untrimmed:`, trimErr instanceof Error ? trimErr.message : trimErr);
        }
      }

      // 无需 trim 或 trim 失败 → 使用原始
      if (fs.existsSync(rawPath)) {
        fs.renameSync(rawPath, trimmedPath);
      }
      localPaths.push(trimmedPath);
    }

    // Step 2: 创建 concat 列表文件
    const concatListPath = path.join(tmpDir, `${batchId}_list.txt`);
    const concatContent = localPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatListPath, concatContent);

    // Step 3: ffmpeg concat + loudnorm
    const outputPath = path.join(tmpDir, `${batchId}_stitched.mp4`);
    const loudnormFilter = config.loudnorm
      ? `-af "loudnorm=I=-16:TP=-1.5:LRA=11"`
      : '';

    const concatCmd = [
      'ffmpeg', '-y',
      '-f', 'concat', '-safe', '0',
      '-i', `"${concatListPath}"`,
      loudnormFilter,
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      `"${outputPath}"`,
    ].filter(Boolean).join(' ');

    console.log(`[Stitcher] Running local concat...`);
    await execAsync(concatCmd, { timeout: 120000 });

    // Step 4: 上传拼接结果到 OSS
    const stitchedBuffer = fs.readFileSync(outputPath);
    const stitchedOssKey = generateMediaPath('videos', request.userId, `vc-stitched-${request.jobId}.mp4`);
    const stitchedUrl = await uploadBuffer(stitchedBuffer, stitchedOssKey, 'video/mp4');

    // Step 5: 清理临时文件
    try {
      localPaths.forEach(p => fs.unlinkSync(p));
      fs.unlinkSync(concatListPath);
      fs.unlinkSync(outputPath);
    } catch { /* ignore cleanup errors */ }

    console.log(`[Stitcher] Local fallback complete: ${stitchedUrl}`);

    // Step 6: 尝试超分
    const target = getUpscaleTarget(request.aspectRatio);
    try {
      const upscaleResult = await upscaleVideo({
        inputBuffer: stitchedBuffer,
        targetWidth: target.width,
        targetHeight: target.height,
        taskId: `vc-${request.jobId}`,
      });

      if (upscaleResult.success) {
        const upscaledOssKey = generateMediaPath('videos', request.userId, `vc-upscaled-${request.jobId}.mp4`);
        const upscaledUrl = await uploadBuffer(upscaleResult.outputBuffer, upscaledOssKey, 'video/mp4');

        return {
          success: true,
          stitchedUrl,
          stitchedOssKey,
          upscaledUrl,
          upscaledOssKey,
          finalUrl: upscaledUrl,
          durationMs: Date.now() - startTime,
        };
      }
    } catch (upscaleErr) {
      console.warn(`[Stitcher] Upscale failed in local fallback:`, upscaleErr);
    }

    // 不超分，直接返回拼接版
    return {
      success: true,
      stitchedUrl,
      stitchedOssKey,
      finalUrl: stitchedUrl,
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    // 清理临时文件
    try {
      const files = fs.readdirSync(tmpDir).filter((f: string) => f.startsWith(batchId));
      files.forEach((f: string) => fs.unlinkSync(path.join(tmpDir, f)));
    } catch { /* ignore */ }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Local fallback failed',
      durationMs: Date.now() - startTime,
    };
  }
}
