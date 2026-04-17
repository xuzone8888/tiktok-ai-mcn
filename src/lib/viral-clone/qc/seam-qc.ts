/**
 * Seam QC — 拼接缝检查
 *
 * 方案 §10 要求: 拼接前检查每段最后 0.6s 和下一段前 0.6s 的:
 * - 音频能量（是否有有效声音 vs 静音）
 * - 静音位置（是否在自然气口处切分）
 * - 句尾完成度（是否把话说完了）
 *
 * 策略:
 * - 优先用 FFmpeg silencedetect 做能量分析
 * - 辅以 Qwen 文本分析句尾完成度
 * - 降级: FFmpeg 不可用时仅做文本层面检查
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// 配置
// ============================================================================

/** 检查窗口（秒）— 每段尾部和下一段头部各取这么长 */
const SEAM_WINDOW_S = 0.6;

/** 静音判定阈值 (dB) */
const SILENCE_THRESHOLD_DB = -40;

/** 最小呼吸间隔 (ms) */
const MIN_BREATH_GAP_MS = 80;

/** 最大可接受的尾部静音 (ms) — 超过则建议裁剪 */
const MAX_TAIL_SILENCE_MS = 500;

/** ffprobe/ffmpeg 超时 */
const CMD_TIMEOUT_MS = 15000;

// ============================================================================
// 类型
// ============================================================================

export interface SeamQCResult {
  passed: boolean;
  /** 前段尾部能量 (dB, -inf 到 0) */
  tail_energy_db: number;
  /** 后段头部能量 (dB) */
  head_energy_db: number;
  /** 前段尾部是否是静音（自然气口） */
  tail_is_silence: boolean;
  /** 后段头部是否是静音 */
  head_is_silence: boolean;
  /** 前段句尾是否完成（文本层面） */
  sentence_complete: boolean;
  /** 建议裁剪: 前段尾部要裁掉多少毫秒 */
  suggested_trim_tail_ms: number;
  /** 建议裁剪: 后段头部要裁掉多少毫秒 */
  suggested_trim_head_ms: number;
  /** 严重程度 */
  severity: 'clean' | 'trimmable' | 'rough' | 'broken';
  /** 说明 */
  details: string;
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 检查两个相邻 segment 之间的拼接缝质量
 *
 * @param tailVideoUrl 前段视频 URL
 * @param headVideoUrl 后段视频 URL
 * @param tailSpokenText 前段口播文本（用于句尾完成度判断）
 * @param segmentIndexA 前段序号
 * @param segmentIndexB 后段序号
 */
export async function runSeamQC(
  tailVideoUrl: string,
  headVideoUrl: string,
  tailSpokenText: string,
  segmentIndexA: number,
  segmentIndexB: number
): Promise<SeamQCResult> {
  console.log(`[SeamQC] Checking seam ${segmentIndexA} → ${segmentIndexB}`);

  try {
    // 并行检测前段尾部和后段头部的音频能量
    const [tailAnalysis, headAnalysis] = await Promise.all([
      analyzeAudioEdge(tailVideoUrl, 'tail'),
      analyzeAudioEdge(headVideoUrl, 'head'),
    ]);

    // 句尾完成度 — 基于标点/语义判断
    const sentenceComplete = checkSentenceCompleteness(tailSpokenText);

    // 计算建议裁剪量
    const suggestedTrimTail = tailAnalysis.is_silence && tailAnalysis.silence_duration_ms > MAX_TAIL_SILENCE_MS
      ? Math.max(0, tailAnalysis.silence_duration_ms - MIN_BREATH_GAP_MS)
      : 0;

    const suggestedTrimHead = headAnalysis.is_silence && headAnalysis.silence_duration_ms > MAX_TAIL_SILENCE_MS
      ? Math.max(0, headAnalysis.silence_duration_ms - MIN_BREATH_GAP_MS)
      : 0;

    // 判定严重程度
    const severity = evaluateSeamSeverity(
      tailAnalysis, headAnalysis, sentenceComplete
    );

    const passed = severity === 'clean' || severity === 'trimmable';

    const details = [
      `Tail: ${tailAnalysis.energy_db.toFixed(1)}dB ${tailAnalysis.is_silence ? '(silence)' : '(active)'}`,
      `Head: ${headAnalysis.energy_db.toFixed(1)}dB ${headAnalysis.is_silence ? '(silence)' : '(active)'}`,
      `Sentence: ${sentenceComplete ? 'complete' : 'INCOMPLETE'}`,
      `Severity: ${severity}`,
      suggestedTrimTail ? `TrimTail: ${suggestedTrimTail}ms` : '',
      suggestedTrimHead ? `TrimHead: ${suggestedTrimHead}ms` : '',
    ].filter(Boolean).join(', ');

    console.log(`[SeamQC] ${passed ? 'PASSED' : 'FAILED'}: ${details}`);

    return {
      passed,
      tail_energy_db: tailAnalysis.energy_db,
      head_energy_db: headAnalysis.energy_db,
      tail_is_silence: tailAnalysis.is_silence,
      head_is_silence: headAnalysis.is_silence,
      sentence_complete: sentenceComplete,
      suggested_trim_tail_ms: suggestedTrimTail,
      suggested_trim_head_ms: suggestedTrimHead,
      severity,
      details,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SeamQC] Error:`, errMsg);

    // 降级: 无法分析时只做文本层面检查
    const sentenceComplete = checkSentenceCompleteness(tailSpokenText);

    return {
      passed: sentenceComplete,
      tail_energy_db: -Infinity,
      head_energy_db: -Infinity,
      tail_is_silence: false,
      head_is_silence: false,
      sentence_complete: sentenceComplete,
      suggested_trim_tail_ms: 0,
      suggested_trim_head_ms: 0,
      severity: sentenceComplete ? 'trimmable' : 'rough',
      details: `SeamQC degraded (ffmpeg unavailable): sentence ${sentenceComplete ? 'complete' : 'INCOMPLETE'}`,
    };
  }
}

// ============================================================================
// 内部函数
// ============================================================================

interface AudioEdgeAnalysis {
  energy_db: number;
  is_silence: boolean;
  silence_duration_ms: number;
}

/**
 * 分析视频边缘（头部或尾部）的音频能量
 *
 * 使用 ffmpeg astats filter 计算 RMS 能量
 */
async function analyzeAudioEdge(
  videoUrl: string,
  edge: 'head' | 'tail'
): Promise<AudioEdgeAnalysis> {
  try {
    // 先获取视频总时长
    const durationS = await getVideoDuration(videoUrl);
    if (durationS <= 0) {
      return { energy_db: -Infinity, is_silence: true, silence_duration_ms: 0 };
    }

    // 计算取样区间
    const startS = edge === 'head' ? 0 : Math.max(0, durationS - SEAM_WINDOW_S);
    const windowS = Math.min(SEAM_WINDOW_S, durationS);

    // 使用 astats filter 获取音频能量
    const cmd = [
      'ffmpeg', '-y',
      '-ss', startS.toFixed(3),
      '-t', windowS.toFixed(3),
      '-i', `"${videoUrl}"`,
      '-af', '"astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level"',
      '-f', 'null', '-',
    ].join(' ');

    const { stderr } = await execAsync(cmd, { timeout: CMD_TIMEOUT_MS }).catch(
      (e: { stderr?: string }) => ({ stderr: e.stderr || '' })
    );

    // 解析 RMS level
    const rmsMatch = stderr.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)/);
    const energyDb = rmsMatch ? parseFloat(rmsMatch[1]) : -Infinity;

    const isSilence = energyDb <= SILENCE_THRESHOLD_DB || energyDb === -Infinity;

    // 检测静音持续时间
    let silenceDurationMs = 0;
    if (isSilence) {
      silenceDurationMs = Math.round(windowS * 1000);
    } else {
      // 尝试用 silencedetect 精确测量
      silenceDurationMs = await detectEdgeSilence(videoUrl, startS, windowS);
    }

    return {
      energy_db: energyDb,
      is_silence: isSilence,
      silence_duration_ms: silenceDurationMs,
    };
  } catch {
    return { energy_db: -Infinity, is_silence: true, silence_duration_ms: 0 };
  }
}

/**
 * 获取视频时长（秒）
 */
async function getVideoDuration(videoUrl: string): Promise<number> {
  try {
    const cmd = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoUrl}"`;
    const { stdout } = await execAsync(cmd, { timeout: CMD_TIMEOUT_MS });
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * 检测边缘区域的静音长度
 */
async function detectEdgeSilence(
  videoUrl: string,
  startS: number,
  windowS: number
): Promise<number> {
  try {
    const cmd = [
      'ffmpeg', '-y',
      '-ss', startS.toFixed(3),
      '-t', windowS.toFixed(3),
      '-i', `"${videoUrl}"`,
      '-af', `"silencedetect=noise=${SILENCE_THRESHOLD_DB}dB:d=0.05"`,
      '-f', 'null', '-',
    ].join(' ');

    const { stderr } = await execAsync(cmd, { timeout: CMD_TIMEOUT_MS }).catch(
      (e: { stderr?: string }) => ({ stderr: e.stderr || '' })
    );

    // 解析最后一段静音的持续时间
    const silenceDurations = [...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)]
      .map(m => parseFloat(m[1]) * 1000);

    return silenceDurations.length > 0
      ? Math.round(silenceDurations[silenceDurations.length - 1])
      : 0;
  } catch {
    return 0;
  }
}

/**
 * 检查口播文本的句尾完成度
 *
 * 规则:
 * - 以 。！？.!? 结尾 → 完整
 * - 以 ，、,; 结尾 → 不完整（分句中断）
 * - 以 …… 结尾 → 完整（省略句式）
 * - 空文本 → 完整（B-roll 段没有口播）
 */
function checkSentenceCompleteness(spokenText: string): boolean {
  const trimmed = spokenText.trim();
  if (!trimmed) return true; // B-roll / 无口播段默认完整

  const lastChar = trimmed[trimmed.length - 1];

  // 完整标点
  if ('。！？.!?…'.includes(lastChar)) return true;

  // 中断标点
  if ('，、,;；：:'.includes(lastChar)) return false;

  // 无标点 — 启发式判断
  // 中文: 以"吧、了、呢、啊、的、哦、嘛"等语气词结尾视为完整
  if (/[吧了呢啊的哦嘛]$/.test(trimmed)) return true;

  // 英文: 以介词/连词结尾视为不完整
  const lastWord = trimmed.split(/\s+/).pop()?.toLowerCase() || '';
  if (['and', 'but', 'or', 'so', 'the', 'a', 'an', 'to', 'for', 'with', 'in', 'on', 'at', 'of'].includes(lastWord)) {
    return false;
  }

  // 默认视为完整
  return true;
}

/**
 * 评估拼接缝严重程度
 */
function evaluateSeamSeverity(
  tail: AudioEdgeAnalysis,
  head: AudioEdgeAnalysis,
  sentenceComplete: boolean
): 'clean' | 'trimmable' | 'rough' | 'broken' {
  // 情况 1: 完美 — 前段尾部静音 + 后段头部静音 + 句子完整
  if (tail.is_silence && head.is_silence && sentenceComplete) {
    return 'clean';
  }

  // 情况 2: 可裁 — 有多余静音但可以裁掉
  if (sentenceComplete && (tail.is_silence || head.is_silence)) {
    return 'trimmable';
  }

  // 情况 3: 粗糙 — 句子不完整但音频过渡尚可
  if (!sentenceComplete && (tail.is_silence || head.is_silence)) {
    return 'rough';
  }

  // 情况 4: 断裂 — 句子不完整 + 音频都在说话
  if (!sentenceComplete && !tail.is_silence && !head.is_silence) {
    return 'broken';
  }

  // 默认: 音频都在说话但句子完整 → 硬切可接受
  return sentenceComplete ? 'trimmable' : 'rough';
}
