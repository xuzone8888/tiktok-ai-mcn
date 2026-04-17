/**
 * P2-8: Google Lyria 3 BGM 生成器
 *
 * 使用 Google AI Studio (Gemini) 的 Lyria 3 音乐生成能力，
 * 为 Viral Clone 成品生成定制 BGM。
 *
 * 策略:
 * 1. 根据 MasterPlan 的 style_bible 推导音乐风格
 * 2. 调用 Lyria 3 API 生成配乐
 * 3. 上传到自有 OSS
 */

import { uploadBuffer, generateMediaPath } from '@/lib/oss';
import type { StyleBible } from '@/types/viral-clone';

// ============================================================================
// 配置
// ============================================================================

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';
const LYRIA_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GENERATE_TIMEOUT_MS = 120000;

// ============================================================================
// 类型
// ============================================================================

export interface BGMRequest {
  /** 风格圣经（推导音乐风格） */
  styleBible: StyleBible;
  /** 目标时长（秒） */
  durationSeconds: number;
  /** 用户 ID */
  userId: string;
  /** 任务 ID */
  jobId: string;
  /** 可选: 用户自定义音乐描述 */
  musicPrompt?: string;
}

export interface BGMResult {
  success: boolean;
  /** 音频 OSS URL */
  audioUrl?: string;
  /** OSS 对象键 */
  ossKey?: string;
  /** 时长（秒） */
  durationSeconds?: number;
  error?: string;
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 为成品生成定制 BGM
 */
export async function generateBGM(request: BGMRequest): Promise<BGMResult> {
  if (!GOOGLE_AI_API_KEY) {
    return { success: false, error: 'GOOGLE_AI_API_KEY 未配置' };
  }

  try {
    // Step 1: 从 style_bible 推导音乐描述
    const musicPrompt = request.musicPrompt || buildMusicPrompt(request.styleBible, request.durationSeconds);

    console.log(`[LyriaBGM] Generating BGM:`, {
      prompt: musicPrompt.substring(0, 80),
      duration: request.durationSeconds,
    });

    // Step 2: 调用 Lyria 3 API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

    const response = await fetch(
      `${LYRIA_API_BASE}/models/lyria-realtime:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: musicPrompt,
            }],
          }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Leda', // Lyria music voice
                },
              },
            },
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[LyriaBGM] API error ${response.status}:`, errText.substring(0, 200));
      return { success: false, error: `Lyria API error: ${response.status}` };
    }

    const data = await response.json();

    // Step 3: 提取音频数据
    const audioData = extractAudioFromResponse(data);
    if (!audioData) {
      return { success: false, error: 'Lyria 未返回音频数据' };
    }

    // Step 4: 上传到 OSS
    const ossKey = generateMediaPath('misc', request.userId, `vc-bgm-${request.jobId}.mp3`);
    const audioUrl = await uploadBuffer(audioData, ossKey, 'audio/mpeg');

    console.log(`[LyriaBGM] Complete: ${(audioData.length / 1024).toFixed(0)}KB`);

    return {
      success: true,
      audioUrl,
      ossKey,
      durationSeconds: request.durationSeconds,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[LyriaBGM] Error:`, errMsg);
    return { success: false, error: errMsg };
  }
}

// ============================================================================
// 内部函数
// ============================================================================

/**
 * 从 StyleBible 推导音乐描述
 */
function buildMusicPrompt(style: StyleBible, durationS: number): string {
  const moodToGenre: Record<string, string> = {
    professional: 'corporate ambient, clean and polished',
    casual: 'lo-fi chill beats, relaxed',
    energetic: 'upbeat electronic pop, dynamic',
    calm: 'ambient piano, peaceful and serene',
    playful: 'happy ukulele, cheerful indie pop',
    luxury: 'elegant jazz piano, sophisticated',
    tech: 'synthwave, modern futuristic',
    warm: 'acoustic guitar, warm folk',
  };

  const pacingToTempo: Record<string, string> = {
    fast: '120-140 BPM, energetic rhythm',
    medium: '90-110 BPM, moderate groove',
    slow: '60-80 BPM, gentle and flowing',
  };

  const genre = moodToGenre[style.mood] || 'modern cinematic background music';
  const tempo = pacingToTempo[style.pacing] || '100 BPM, balanced tempo';

  return [
    `Generate a ${durationS}-second instrumental background music track.`,
    `Style: ${genre}.`,
    `Tempo: ${tempo}.`,
    `This is background music for a product showcase video.`,
    `It should be non-intrusive, loop-friendly, and suitable as underscore.`,
    `No vocals. Clean production. Suitable for commercial use.`,
  ].join(' ');
}

/**
 * 从 Gemini API 响应提取音频数据
 */
function extractAudioFromResponse(data: Record<string, unknown>): Buffer | null {
  try {
    const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates || candidates.length === 0) return null;

    const content = candidates[0].content as Record<string, unknown> | undefined;
    if (!content) return null;

    const parts = content.parts as Array<Record<string, unknown>> | undefined;
    if (!parts) return null;

    for (const part of parts) {
      const inlineData = part.inlineData as Record<string, string> | undefined;
      if (inlineData?.data && inlineData.mimeType?.startsWith('audio/')) {
        return Buffer.from(inlineData.data, 'base64');
      }
    }

    return null;
  } catch {
    return null;
  }
}
