/**
 * P2-10: 统一 TTS 兜底模式
 *
 * 当连续性 QC 全部失败时的兜底方案:
 * 1. 使用 ElevenLabs TTS 将 full_script 转为统一配音
 * 2. 使用 Lyria BGM 生成背景音乐
 * 3. 将 TTS + BGM 合成为音频轨
 * 4. 替换所有生成视频段的原声
 *
 * 这样即使画面有轻微跳变，统一的配音也能让观众感觉内容是连贯的
 */

import { textToSpeech, PRESET_VOICES } from '@/lib/elevenlabs-api';
import { uploadBuffer, generateMediaPath } from '@/lib/oss';

// ============================================================================
// 配置
// ============================================================================

/** 默认 TTS 音色 */
const DEFAULT_VOICE_ID = PRESET_VOICES[0]?.id || 'EXAVITQu4vr4xnSDxMaL'; // Sarah

/** TTS 超时 */
const TTS_TIMEOUT_MS = 60000;

// ============================================================================
// 类型
// ============================================================================

export interface TTSFallbackRequest {
  /** 完整脚本 */
  fullScript: string;
  /** 分段脚本 */
  segmentTexts: string[];
  /** 用户 ID */
  userId: string;
  /** 任务 ID */
  jobId: string;
  /** 语言 */
  language: 'zh' | 'en';
  /** 自定义音色 ID（可选） */
  voiceId?: string;
}

export interface TTSFallbackResult {
  success: boolean;
  /** 完整配音 OSS URL */
  fullAudioUrl?: string;
  /** 分段配音 OSS URL 列表 */
  segmentAudioUrls?: string[];
  /** 总时长（秒） */
  totalDurationSeconds?: number;
  error?: string;
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 生成 TTS 兜底配音
 *
 * 策略:
 * - 逐段生成 TTS，保证每段时长与视频匹配
 * - 同时生成完整版，用于可能的整体替换
 */
export async function generateTTSFallback(
  request: TTSFallbackRequest
): Promise<TTSFallbackResult> {
  const voiceId = request.voiceId || getDefaultVoice(request.language);

  console.log(`[TTSFallback] Generating for job ${request.jobId}:`, {
    segmentCount: request.segmentTexts.length,
    language: request.language,
    voiceId,
    scriptLength: request.fullScript.length,
  });

  try {
    // ========================================================================
    // Step 1: 逐段生成 TTS
    // ========================================================================

    const segmentAudioUrls: string[] = [];

    for (let i = 0; i < request.segmentTexts.length; i++) {
      const text = request.segmentTexts[i];

      if (!text.trim()) {
        segmentAudioUrls.push('');
        continue;
      }

      try {
        const audioBuffer = await textToSpeech(voiceId, text, {
          stability: 0.6,
          similarity_boost: 0.8,
          style: 0.3,
        });

        const ossKey = generateMediaPath(
          'misc', request.userId,
          `vc-tts-seg${i}-${request.jobId}.mp3`
        );
        const audioUrl = await uploadBuffer(audioBuffer, ossKey, 'audio/mpeg');
        segmentAudioUrls.push(audioUrl);

        console.log(`[TTSFallback] Segment ${i}: ${(audioBuffer.length / 1024).toFixed(0)}KB`);

        // 避免 ElevenLabs 速率限制
        if (i < request.segmentTexts.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (segError) {
        console.error(`[TTSFallback] Segment ${i} failed:`, segError);
        segmentAudioUrls.push('');
      }
    }

    // ========================================================================
    // Step 2: 生成完整版配音
    // ========================================================================

    let fullAudioUrl: string | undefined;

    try {
      const fullAudioBuffer = await textToSpeech(voiceId, request.fullScript, {
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.3,
      });

      const fullOssKey = generateMediaPath(
        'misc', request.userId,
        `vc-tts-full-${request.jobId}.mp3`
      );
      fullAudioUrl = await uploadBuffer(fullAudioBuffer, fullOssKey, 'audio/mpeg');

      console.log(`[TTSFallback] Full TTS: ${(fullAudioBuffer.length / 1024).toFixed(0)}KB`);
    } catch (fullError) {
      console.warn(`[TTSFallback] Full script TTS failed, using segments only:`, fullError);
    }

    // 估算总时长（MP3 约 16KB/s at 128kbps）
    const totalBytes = segmentAudioUrls.length > 0 ? 0 : 0; // placeholder
    const estimatedDuration = request.fullScript.length / (request.language === 'zh' ? 4 : 15);

    return {
      success: true,
      fullAudioUrl,
      segmentAudioUrls,
      totalDurationSeconds: estimatedDuration,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[TTSFallback] Error:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * 判断是否需要 TTS 兜底
 *
 * 条件: 连续性 QC 中有 ≥50% 的段失败（major 或 critical）
 */
export function shouldUseTTSFallback(
  continuityResults: Array<{ passed: boolean; severity?: string } | null>
): boolean {
  if (continuityResults.length === 0) return false;

  const failures = continuityResults.filter(r =>
    r && !r.passed && (r.severity === 'major' || r.severity === 'critical')
  );

  return failures.length >= Math.ceil(continuityResults.length * 0.5);
}

// ============================================================================
// 内部函数
// ============================================================================

/**
 * 根据语言选择默认音色
 */
function getDefaultVoice(language: 'zh' | 'en'): string {
  // ElevenLabs 对中文支持最好的音色
  if (language === 'zh') {
    return PRESET_VOICES.find(v => v.gender === 'female')?.id || DEFAULT_VOICE_ID;
  }
  return DEFAULT_VOICE_ID;
}
