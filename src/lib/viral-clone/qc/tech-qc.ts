/**
 * Tech QC — FFmpeg 技术质量检查
 *
 * 使用 ffprobe/ffmpeg 检查:
 * - 时长是否在目标范围内
 * - 分辨率是否正确
 * - 音轨是否存在
 * - 黑帧检测 (blackdetect filter)
 * - 解码异常 (error-level decode)
 *
 * [审计修复] blackdetect 和 decode_errors 已补全实际检测逻辑
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { TechQCResult } from '@/types/viral-clone';

const execAsync = promisify(exec);

// ============================================================================
// 配置
// ============================================================================

/** 时长容差（±秒） */
const DURATION_TOLERANCE_S = 2.0;

/** ffprobe 超时（毫秒） */
const FFPROBE_TIMEOUT_MS = 30000;

/** blackdetect 阈值: 连续黑帧 ≥0.3s 视为异常 */
const BLACKDETECT_DURATION_THRESHOLD = 0.3;

/** blackdetect 像素阈值 (0-1) */
const BLACKDETECT_PIX_THRESHOLD = 0.10;

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 对单个 segment 视频执行技术 QC
 *
 * @param videoUrl 视频 URL（必须是自有 OSS URL）
 * @param targetDurationS 期望输出时长（秒）— 应传 qc_expected_duration / generation_duration
 * @param sourceSpanDurationS 源视频跨度时长（秒）— 仅用于 details 展示，不参与判定
 * @returns TechQCResult
 */
export async function runTechQC(
  videoUrl: string,
  targetDurationS: number,
  sourceSpanDurationS?: number
): Promise<TechQCResult> {
  console.log(`[TechQC] Checking: ${videoUrl.substring(0, 60)}...`);

  try {
    // ========================================================================
    // Step 1: ffprobe 获取视频信息
    // ========================================================================

    const probeCmd = [
      'ffprobe',
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      `"${videoUrl}"`,
    ].join(' ');

    const { stdout } = await execAsync(probeCmd, { timeout: FFPROBE_TIMEOUT_MS });
    const probeData = JSON.parse(stdout);

    // ========================================================================
    // Step 2: 解析流信息
    // ========================================================================

    const videoStream = probeData.streams?.find(
      (s: Record<string, unknown>) => s.codec_type === 'video'
    );
    const audioStream = probeData.streams?.find(
      (s: Record<string, unknown>) => s.codec_type === 'audio'
    );

    const durationMs = Math.round(
      parseFloat(probeData.format?.duration || '0') * 1000
    );
    const width = parseInt(videoStream?.width || '0');
    const height = parseInt(videoStream?.height || '0');
    const hasAudio = !!audioStream;

    // 时长检查
    const durationS = durationMs / 1000;
    const durationOk = Math.abs(durationS - targetDurationS) <= DURATION_TOLERANCE_S;

    // 分辨率检查（VEO3 输出 720p）
    const resolutionOk = width >= 640 && height >= 360;

    // ========================================================================
    // Step 3: 黑帧检测 (blackdetect filter)
    // ========================================================================

    const hasBlackFrames = await detectBlackFrames(videoUrl);

    // ========================================================================
    // Step 4: 解码异常检测
    // ========================================================================

    const decodeErrors = await countDecodeErrors(videoUrl);

    // ========================================================================
    // Step 5: 汇总结果
    // ========================================================================

    const passed = durationOk && resolutionOk && hasAudio && !hasBlackFrames && decodeErrors === 0;

    const details = [
      `Duration: ${durationS.toFixed(1)}s (expected: ${targetDurationS}s${sourceSpanDurationS ? `, source_span: ${sourceSpanDurationS}s` : ''}) ${durationOk ? '✓' : '✗'}`,
      `Resolution: ${width}x${height} ${resolutionOk ? '✓' : '✗'}`,
      `Audio: ${hasAudio ? '✓' : '✗ MISSING'}`,
      `BlackFrames: ${hasBlackFrames ? '✗ DETECTED' : '✓'}`,
      `DecodeErrors: ${decodeErrors === 0 ? '✓' : `✗ ${decodeErrors} errors`}`,
    ].join(', ');

    console.log(`[TechQC] ${passed ? 'PASSED' : 'FAILED'}: ${details}`);

    return {
      passed,
      duration_ok: durationOk,
      duration_actual_ms: durationMs,
      expected_output_duration_s: targetDurationS,
      source_span_duration_s: sourceSpanDurationS,
      resolution_ok: resolutionOk,
      width,
      height,
      has_audio: hasAudio,
      has_black_frames: hasBlackFrames,
      decode_errors: decodeErrors,
      details,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[TechQC] Error:`, errMsg);

    return {
      passed: false,
      duration_ok: false,
      duration_actual_ms: 0,
      resolution_ok: false,
      width: 0,
      height: 0,
      has_audio: false,
      has_black_frames: false,
      decode_errors: 1,
      details: `TechQC failed: ${errMsg}`,
    };
  }
}

// ============================================================================
// 内部函数
// ============================================================================

/**
 * 使用 ffmpeg blackdetect filter 检测黑帧
 *
 * 命令: ffmpeg -i <url> -vf "blackdetect=d=0.3:pix_th=0.10" -an -f null -
 * 输出在 stderr 中包含 "black_start" 行表示检测到黑帧段
 *
 * 降级: ffmpeg 不可用时返回 false（不阻塞主流程）
 */
async function detectBlackFrames(videoUrl: string): Promise<boolean> {
  try {
    const cmd = [
      'ffmpeg', '-y',
      '-i', `"${videoUrl}"`,
      '-vf', `"blackdetect=d=${BLACKDETECT_DURATION_THRESHOLD}:pix_th=${BLACKDETECT_PIX_THRESHOLD}"`,
      '-an', '-f', 'null', '-',
    ].join(' ');

    // blackdetect 输出在 stderr
    const { stderr } = await execAsync(cmd, { timeout: FFPROBE_TIMEOUT_MS });
    const blackSegments = (stderr.match(/black_start/g) || []).length;

    if (blackSegments > 0) {
      console.warn(`[TechQC] Detected ${blackSegments} black frame segment(s)`);
    }

    return blackSegments > 0;
  } catch (error) {
    // ffmpeg 执行会以非零退出码结束（正常行为），检查 stderr
    if (error && typeof error === 'object' && 'stderr' in error) {
      const stderr = (error as { stderr: string }).stderr || '';
      const blackSegments = (stderr.match(/black_start/g) || []).length;
      if (blackSegments > 0) {
        console.warn(`[TechQC] Detected ${blackSegments} black frame segment(s)`);
        return true;
      }
      return false;
    }
    // ffmpeg 完全不可用 → 降级放行
    console.warn(`[TechQC] blackdetect unavailable, skipping:`, error);
    return false;
  }
}

/**
 * 使用 ffmpeg error-level 解码检测解码异常
 *
 * 命令: ffmpeg -v error -i <url> -f null -
 * 统计 stderr 中 error 行数
 *
 * 降级: ffmpeg 不可用时返回 0
 */
async function countDecodeErrors(videoUrl: string): Promise<number> {
  try {
    const cmd = [
      'ffmpeg', '-y',
      '-v', 'error',
      '-i', `"${videoUrl}"`,
      '-f', 'null', '-',
    ].join(' ');

    const { stderr } = await execAsync(cmd, { timeout: FFPROBE_TIMEOUT_MS });

    // 统计 error 关键字（排除 info/warning）
    const errorLines = stderr.split('\n').filter(
      line => line.trim().length > 0 && !line.includes('Last message repeated')
    );

    if (errorLines.length > 0) {
      console.warn(`[TechQC] Detected ${errorLines.length} decode error(s):\n`, errorLines.slice(0, 3).join('\n'));
    }

    return errorLines.length;
  } catch (error) {
    if (error && typeof error === 'object' && 'stderr' in error) {
      const stderr = (error as { stderr: string }).stderr || '';
      const errorLines = stderr.split('\n').filter(
        line => line.trim().length > 0 && !line.includes('Last message repeated')
      );
      return errorLines.length;
    }
    // ffmpeg 不可用 → 降级放行
    console.warn(`[TechQC] decode error check unavailable, skipping:`, error);
    return 0;
  }
}
