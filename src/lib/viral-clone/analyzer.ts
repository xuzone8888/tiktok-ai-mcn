/**
 * Analyzer — Qwen 视频/图文理解
 *
 * 职责:
 * 1. 从源视频/图片中提取结构化信息
 * 2. 识别产品、人物、场景、关键时刻
 * 3. 推断视频类型和建议拆分方案
 *
 * 对 entry_type='upload' 的视频使用 Qwen 多模态分析
 * 对 entry_type='prompt' 直接跳过分析
 */

import type { AnalysisResult, ViralCloneAsset, AnalysisArtifactV2 } from '@/types/viral-clone';
import { analyzeVideo, analyzeImage, askQwen, analyzeVideoDeep } from './qwen-client';

// ============================================================================
// System Prompts
// ============================================================================

const VIDEO_ANALYSIS_SYSTEM_PROMPT = `你是一个专业的短视频内容分析师。你的任务是分析给定的视频，提取关键信息用于复制/再创作同类型的短视频。

分析维度：
1. 内容摘要：视频讲了什么，核心卖点是什么
2. 产品识别：出现了哪些产品/商品（名称、外观描述）
3. 人物识别：出现了哪些人物（外貌、服装、角色）
4. 场景描述：拍摄场景（室内/室外、布光、色调）
5. 关键时刻：视频中的转折点/高潮时间点（秒）
6. 语言：主要使用的语言
7. 视频类型：产品种草/广告口播/教程讲解/生活方式/其他
8. 建议分段：适合拆成几段来复制（2-4段）
9. 建议时长：成片建议总时长（秒）

请严格按 JSON 格式返回，不要输出其他内容。`;

const VIDEO_ANALYSIS_USER_PROMPT = `请分析这个视频，返回 JSON：
{
  "summary": "内容摘要",
  "products": ["产品1描述", "产品2描述"],
  "persons": ["人物1描述", "人物2描述"],
  "scenes": ["场景1描述", "场景2描述"],
  "key_moments": [3.5, 8.0, 12.5],
  "language": "zh 或 en 或 mixed",
  "video_type": "product_review 或 ad_oral 或 tutorial 或 lifestyle 或 other",
  "suggested_segments": 3,
  "suggested_duration": 24
}`;

const IMAGE_ANALYSIS_SYSTEM_PROMPT = `你是一个专业的产品图片分析师。分析给定的产品图片，提取关键信息用于生成产品种草视频。

请严格按 JSON 格式返回。`;

const IMAGE_ANALYSIS_USER_PROMPT = `请分析这张产品图片，返回 JSON：
{
  "summary": "产品描述摘要",
  "products": ["产品名称和外观描述"],
  "persons": [],
  "scenes": ["适合展示该产品的场景描述"],
  "key_moments": [],
  "language": "en",
  "video_type": "product_review",
  "suggested_segments": 2,
  "suggested_duration": 16
}`;

// ============================================================================
// 默认分析结果
// ============================================================================

const DEFAULT_ANALYSIS: AnalysisResult = {
  summary: '',
  products: [],
  persons: [],
  scenes: [],
  key_moments: [],
  language: 'en',
  video_type: 'other',
  suggested_segments: 2,
  suggested_duration: 16,
};

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 分析源视频
 *
 * @param videoUrl 源视频 OSS URL
 * @returns 结构化分析结果
 */
export async function analyzeSourceVideo(videoUrl: string): Promise<AnalysisResult> {
  console.log(`[Analyzer] Analyzing video: ${videoUrl.substring(0, 60)}...`);

  try {
    const result = await analyzeVideo(
      videoUrl,
      VIDEO_ANALYSIS_SYSTEM_PROMPT,
      VIDEO_ANALYSIS_USER_PROMPT,
      { maxTokens: 2048, temperature: 0.3 }
    );

    if (!result.success || !result.content) {
      console.error(`[Analyzer] Video analysis failed:`, result.error);
      return DEFAULT_ANALYSIS;
    }

    return parseAnalysisJson(result.content);
  } catch (error) {
    console.error(`[Analyzer] Error:`, error);
    return DEFAULT_ANALYSIS;
  }
}

/**
 * 分析参考图片（提示词入口用）
 *
 * @param imageUrl 参考图 OSS URL
 * @returns 结构化分析结果
 */
export async function analyzeReferenceImage(imageUrl: string): Promise<AnalysisResult> {
  console.log(`[Analyzer] Analyzing image: ${imageUrl.substring(0, 60)}...`);

  try {
    const result = await analyzeImage(
      imageUrl,
      IMAGE_ANALYSIS_SYSTEM_PROMPT,
      IMAGE_ANALYSIS_USER_PROMPT,
      { maxTokens: 1024, temperature: 0.3 }
    );

    if (!result.success || !result.content) {
      console.error(`[Analyzer] Image analysis failed:`, result.error);
      return DEFAULT_ANALYSIS;
    }

    return parseAnalysisJson(result.content);
  } catch (error) {
    console.error(`[Analyzer] Error:`, error);
    return DEFAULT_ANALYSIS;
  }
}

/**
 * 从纯文本提示词推断分析结果（无需多模态）
 *
 * @param prompt 用户输入的提示词
 * @returns 结构化分析结果
 */
export async function analyzeFromPrompt(prompt: string): Promise<AnalysisResult> {
  console.log(`[Analyzer] Analyzing prompt (${prompt.length} chars)`);

  try {
    const result = await askQwen(
      `你是一个短视频策划师。根据用户的描述，推断出适合的视频结构。返回 JSON 格式。`,
      `用户要求制作的视频描述：${prompt}\n\n返回 JSON：
{
  "summary": "视频内容摘要",
  "products": ["涉及的产品"],
  "persons": ["涉及的人物角色"],
  "scenes": ["适合的场景"],
  "key_moments": [],
  "language": "en 或 zh",
  "video_type": "product_review 或 ad_oral 或 tutorial 或 lifestyle",
  "suggested_segments": 2,
  "suggested_duration": 16
}`,
      { maxTokens: 1024, temperature: 0.5 }
    );

    if (!result.success || !result.content) {
      return {
        ...DEFAULT_ANALYSIS,
        summary: prompt.substring(0, 200),
      };
    }

    return parseAnalysisJson(result.content);
  } catch (error) {
    console.error(`[Analyzer] Prompt analysis error:`, error);
    return {
      ...DEFAULT_ANALYSIS,
      summary: prompt.substring(0, 200),
    };
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从 Qwen 输出中解析 JSON
 */
function parseAnalysisJson(content: string): AnalysisResult {
  try {
    // 尝试提取 JSON 块
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[Analyzer] No JSON found in response`);
      return DEFAULT_ANALYSIS;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // 验证并填充默认值
    return {
      summary: parsed.summary || '',
      products: Array.isArray(parsed.products) ? parsed.products : [],
      persons: Array.isArray(parsed.persons) ? parsed.persons : [],
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      key_moments: Array.isArray(parsed.key_moments) ? parsed.key_moments : [],
      language: (['zh', 'en', 'mixed'].includes(parsed.language)) ? parsed.language : 'en',
      video_type: (['product_review', 'ad_oral', 'tutorial', 'lifestyle', 'other'].includes(parsed.video_type))
        ? parsed.video_type : 'other',
      suggested_segments: Math.min(Math.max(parseInt(parsed.suggested_segments) || 2, 2), 4),
      suggested_duration: Math.min(Math.max(parseInt(parsed.suggested_duration) || 16, 8), 60),
    };
  } catch (error) {
    console.error(`[Analyzer] JSON parse error:`, error);
    return DEFAULT_ANALYSIS;
  }
}

// ============================================================================
// V2 深度分析
// ============================================================================

/**
 * V2 深度分析源视频 — 完整转录 + 时间线 + 画面节拍
 *
 * 一次 Qwen 调用完成全局分析，输出 AnalysisArtifactV2。
 * 如果 Qwen 返回不完整，自动降级补全。
 */
export async function analyzeSourceVideoV2(videoUrl: string): Promise<AnalysisArtifactV2> {
  console.log(`[AnalyzerV2] Deep analyzing video: ${videoUrl.substring(0, 60)}...`);

  // 最多尝试 2 次 V2 分析
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await analyzeVideoDeep(videoUrl);

      if (!result.success || !result.content) {
        console.error(`[AnalyzerV2] Deep analysis failed (attempt ${attempt}):`, result.error);
        continue; // 重试
      }

      const artifact = parseAnalysisArtifactV2(result.content);
      console.log(`[AnalyzerV2] Analysis result (attempt ${attempt}):`, {
        utterances: artifact.utterances.length,
        beats: artifact.visual_beats.length,
        transcriptLength: artifact.transcript_full.length,
        suggestedSegments: artifact.suggested_segments,
      });

      // 🚨 硬门禁：转录不能为空
      if (artifact.transcript_full.trim().length === 0 || artifact.utterances.length === 0) {
        console.warn(`[AnalyzerV2] ⚠️ Empty transcript/utterances on attempt ${attempt}, ${attempt < 2 ? 'retrying...' : 'falling back to V1'}`);
        continue; // 重试
      }

      return artifact;
    } catch (error) {
      console.error(`[AnalyzerV2] Error (attempt ${attempt}):`, error);
    }
  }

  // V2 两次都失败 → 降级到 V1（至少有摘要作为台词）
  console.warn(`[AnalyzerV2] V2 analysis failed after 2 attempts, falling back to V1`);
  return buildFallbackArtifact(videoUrl);
}

/**
 * 解析 Qwen 返回的 V2 分析 JSON
 */
function parseAnalysisArtifactV2(content: string): AnalysisArtifactV2 {
  try {
    // 诊断日志：记录 Qwen 原始响应前 500 字符
    console.log(`[AnalyzerV2] Raw Qwen response (first 500 chars):`, content.substring(0, 500));

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[AnalyzerV2] No JSON found in response, full content length: ${content.length}`);
      return getDefaultArtifactV2();
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // 解析 utterances，确保 ID 稳定
    const utterances = Array.isArray(parsed.utterances)
      ? parsed.utterances.map((u: Record<string, unknown>, i: number) => ({
          id: (u.id as string) || `utt_${i}`,
          approx_start_s: Number(u.approx_start_s) || 0,
          approx_end_s: Number(u.approx_end_s) || 0,
          text: String(u.text || ''),
        }))
      : [];

    // 解析 visual_beats
    const visual_beats = Array.isArray(parsed.visual_beats)
      ? parsed.visual_beats.map((b: Record<string, unknown>, i: number) => ({
          id: (b.id as string) || `beat_${i}`,
          approx_start_s: Number(b.approx_start_s) || 0,
          approx_end_s: Number(b.approx_end_s) || 0,
          description: String(b.description || ''),
          key_elements: Array.isArray(b.key_elements) ? (b.key_elements as string[]) : [],
          camera: b.camera ? String(b.camera) : undefined,
          on_screen_text: Array.isArray(b.on_screen_text) ? (b.on_screen_text as string[]) : undefined,
        }))
      : [];

    // 构建 transcript_full：优先使用 Qwen 返回的，否则从 utterances 拼接
    const transcript_full = parsed.transcript_full
      ? String(parsed.transcript_full)
      : utterances.map((u: { text: string }) => u.text).join(' ');

    // 推荐段数：限制在 2-4
    const rawSegments = parseInt(parsed.suggested_segments) || 3;
    const suggested_segments = Math.min(Math.max(rawSegments, 2), 4) as 2 | 3 | 4;

    return {
      summary: String(parsed.summary || ''),
      transcript_full,
      utterances,
      visual_beats,
      key_claims: Array.isArray(parsed.key_claims) ? parsed.key_claims : [],
      suggested_segments,
      suggested_duration: Math.min(Math.max(parseInt(parsed.suggested_duration) || 16, 8), 60),
      language: (['zh', 'en', 'mixed'].includes(parsed.language)) ? parsed.language : 'en',
      video_type: parsed.video_type || 'other',
    };
  } catch (error) {
    console.error(`[AnalyzerV2] JSON parse error:`, error);
    return getDefaultArtifactV2();
  }
}

/**
 * V2 默认分析产物
 */
function getDefaultArtifactV2(): AnalysisArtifactV2 {
  return {
    summary: '',
    transcript_full: '',
    utterances: [],
    visual_beats: [],
    key_claims: [],
    suggested_segments: 3,
    suggested_duration: 24,
    language: 'en',
    video_type: 'other',
  };
}

/**
 * 降级方案：用 V1 分析结果构造 V2 格式
 */
async function buildFallbackArtifact(videoUrl: string): Promise<AnalysisArtifactV2> {
  console.log(`[AnalyzerV2] Falling back to V1 analysis`);
  const v1Result = await analyzeSourceVideo(videoUrl);

  return {
    summary: v1Result.summary,
    transcript_full: v1Result.summary, // V1 没有转录，用摘要代替
    utterances: [{
      id: 'utt_0',
      approx_start_s: 0,
      approx_end_s: v1Result.suggested_duration,
      text: v1Result.summary,
    }],
    visual_beats: v1Result.scenes.map((scene, i) => ({
      id: `beat_${i}`,
      approx_start_s: (v1Result.suggested_duration / v1Result.scenes.length) * i,
      approx_end_s: (v1Result.suggested_duration / v1Result.scenes.length) * (i + 1),
      description: scene,
      key_elements: [...v1Result.products, ...v1Result.persons],
    })),
    key_claims: v1Result.products,
    suggested_segments: Math.min(Math.max(v1Result.suggested_segments, 2), 4) as 2 | 3 | 4,
    suggested_duration: v1Result.suggested_duration,
    language: v1Result.language,
    video_type: v1Result.video_type,
  };
}

