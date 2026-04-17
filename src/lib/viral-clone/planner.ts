/**
 * Planner — 脚本规划 + MasterPlan 生成
 *
 * 职责:
 * 1. 接收 AnalysisResult
 * 2. 生成 full_script（完整口播文案）
 * 3. 生成 style_bible（风格指南）
 * 4. 按分段规则切分 segments
 * 5. 输出完整 MasterPlan 供用户确认
 */

import type {
  AnalysisResult,
  AnalysisArtifactV2,
  MasterPlan,
  CloneSpecV2,
  StyleBible,
  SegmentPlan,
  SegmentBlueprintV2,
  VisualAnchors,
  AspectRatio,
  ProviderAlias,
  OutputProfile,
} from '@/types/viral-clone';
import { SEGMENTATION_RULES } from '@/types/viral-clone';
import { askQwen, refineSegments } from './qwen-client';
import { segmentScript, segmentByTimeline } from './segmenter';
import { getExpectedOutputDuration } from './providers/provider-registry';

// ============================================================================
// System Prompts
// ============================================================================

const SCRIPT_GENERATION_PROMPT = `你是一个顶级短视频文案策划师，专门为产品种草和广告口播类视频撰写脚本。

规则：
1. 文案必须是完整的口播脚本，像真人对着镜头说话一样
2. 开头必须有 hook（吸引注意力），结尾必须有 CTA（行动号召）
3. 中间内容要围绕产品核心卖点展开
4. 每句话都要自然流畅，适合朗读
5. 不要使用表情符号
6. 时长参考：每秒大约 2-3 个中文字 或 3-4 个英文单词

请直接输出文案文本，不要加标题或编号。`;

const STYLE_BIBLE_PROMPT = `你是一个视频导演。根据以下视频分析结果，制定拍摄风格指南。

请返回 JSON：
{
  "subject": "主体描述（谁在说/做什么）",
  "product": "产品描述（外观、颜色、材质）",
  "color_temp": "色温方向（warm/cool/neutral）",
  "lighting": "布光描述（自然光/柔光/硬光/环形灯等）",
  "camera": "机位描述（正面中景/俯拍特写/手持跟拍等）",
  "pacing": "节奏描述（fast/medium/slow）",
  "mood": "情绪基调（professional/casual/energetic/calm等）"
}`;

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 生成完整 MasterPlan
 *
 * @param analysis Qwen 分析结果
 * @param aspectRatio 画面比例
 * @param anchorUrls 锚定图 URL（最多 3 张）
 * @param userPrompt 用户额外的提示词（可选）
 */
export async function generateMasterPlan(params: {
  analysis: AnalysisResult;
  aspectRatio: AspectRatio;
  anchorUrls: string[];
  userPrompt?: string;
  language?: 'zh' | 'en';
}): Promise<MasterPlan> {
  const { analysis, aspectRatio, anchorUrls, userPrompt, language } = params;

  console.log(`[Planner] Generating MasterPlan:`, {
    videoType: analysis.video_type,
    suggestedSegments: analysis.suggested_segments,
    suggestedDuration: analysis.suggested_duration,
    anchorCount: anchorUrls.length,
  });

  // ========================================================================
  // Step 1: 生成完整脚本
  // ========================================================================

  const targetDuration = analysis.suggested_duration;
  const lang = language ?? (analysis.language === 'zh' ? 'zh' : 'en');

  const scriptContext = [
    `视频类型: ${analysis.video_type}`,
    `目标时长: ${targetDuration} 秒`,
    `语言: ${lang === 'zh' ? '中文' : '英文'}`,
    analysis.summary ? `内容简介: ${analysis.summary}` : '',
    analysis.products.length > 0 ? `产品: ${analysis.products.join(', ')}` : '',
    analysis.persons.length > 0 ? `人物: ${analysis.persons.join(', ')}` : '',
    userPrompt ? `用户要求: ${userPrompt}` : '',
  ].filter(Boolean).join('\n');

  const scriptResult = await askQwen(
    SCRIPT_GENERATION_PROMPT,
    `请为以下内容撰写一段 ${targetDuration} 秒的${lang === 'zh' ? '中文' : '英文'}口播脚本：\n\n${scriptContext}`,
    { maxTokens: 2048, temperature: 0.7 }
  );

  const fullScript = scriptResult.success && scriptResult.content
    ? scriptResult.content.trim()
    : generateFallbackScript(analysis, targetDuration, lang);

  // ========================================================================
  // Step 2: 生成风格指南
  // ========================================================================

  const styleBible = await generateStyleBible(analysis);

  // ========================================================================
  // Step 3: 切分脚本为分段
  // ========================================================================

  const segmentCount = analysis.suggested_segments;
  const segments = segmentScript(fullScript, {
    targetSegments: segmentCount,
    targetDuration,
    refImages: anchorUrls,
  });

  // ========================================================================
  // Step 4: 构建视觉锚点
  // ========================================================================

  const visualAnchors: VisualAnchors = {
    product_frame: anchorUrls[0] || '',
    spokesperson_frame: anchorUrls[1] || anchorUrls[0] || '',
    style_frame: anchorUrls[2] || anchorUrls[1] || anchorUrls[0] || '',
  };

  // ========================================================================
  // Step 5: 组装 MasterPlan
  // ========================================================================

  const resolution = aspectRatio === '9:16' ? '1080x1920' : '1920x1080';

  const outputProfile: OutputProfile = {
    aspect: aspectRatio,
    resolution: resolution as '1080x1920' | '1920x1080',
    publish_targets: ['tiktok'],
  };

  // 预估成本: 每段 50 积分 (veo_std_refs)
  const estimatedCost = segments.length * 50;

  // 预估时间: 每段约 3 分钟（生成 + QC + 下载）
  const estimatedTime = segments.length * 180;

  const masterPlan: MasterPlan = {
    full_script: fullScript,
    style_bible: styleBible,
    visual_anchors: visualAnchors,
    segments,
    provider_route: 'veo_std_refs' as ProviderAlias,
    fallback_route: 'veo_fast_frames' as ProviderAlias,
    output_profile: outputProfile,
    estimated_cost: estimatedCost,
    estimated_time: estimatedTime,
  };

  console.log(`[Planner] MasterPlan generated:`, {
    scriptLength: fullScript.length,
    segmentCount: segments.length,
    estimatedCost,
    estimatedTime,
  });

  return masterPlan;
}

// ============================================================================
// 内部函数
// ============================================================================

/**
 * 生成风格指南
 */
async function generateStyleBible(analysis: AnalysisResult): Promise<StyleBible> {
  const context = [
    `内容: ${analysis.summary}`,
    `产品: ${analysis.products.join(', ') || '无'}`,
    `人物: ${analysis.persons.join(', ') || '无'}`,
    `场景: ${analysis.scenes.join(', ') || '未知'}`,
    `类型: ${analysis.video_type}`,
  ].join('\n');

  const result = await askQwen(
    STYLE_BIBLE_PROMPT,
    context,
    { maxTokens: 1024, temperature: 0.5 }
  );

  if (result.success && result.content) {
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          subject: parsed.subject || '',
          product: parsed.product || '',
          color_temp: parsed.color_temp || 'neutral',
          lighting: parsed.lighting || 'soft natural light',
          camera: parsed.camera || 'medium shot, eye level',
          pacing: parsed.pacing || 'medium',
          mood: parsed.mood || 'professional',
        };
      }
    } catch {
      // JSON 解析失败，使用默认值
    }
  }

  // 默认风格
  return {
    subject: analysis.products[0] || 'product showcase',
    product: analysis.products.join(', ') || '',
    color_temp: 'neutral',
    lighting: 'soft natural light',
    camera: 'medium shot, eye level',
    pacing: 'medium',
    mood: 'professional',
  };
}

/**
 * 生成兜底脚本（Qwen 调用失败时用）
 */
function generateFallbackScript(
  analysis: AnalysisResult,
  targetDuration: number,
  lang: string
): string {
  const products = analysis.products.join(', ') || 'this product';

  if (lang === 'zh') {
    return `大家好，今天给大家分享一个超级好用的产品。${products}真的是太棒了，品质超好，性价比也很高。如果你也在找类似的产品，一定不要错过这个，赶紧点击下方链接了解更多吧！`;
  }

  return `Hey everyone, today I want to share something amazing with you. ${products} is absolutely incredible, the quality is outstanding and the value is unbeatable. If you've been looking for something like this, don't miss out. Click the link below to learn more!`;
}

// ============================================================================
// V2 CloneSpec 生成器
// ============================================================================

/**
 * V2: 从深度分析结果生成 CloneSpecV2
 *
 * 核心区别：不再"重新创作"脚本，而是基于原视频的真实转录构建蓝图。
 * 大部分逻辑本地完成（规则引擎），只有 StyleBible 和可选的细化需要 Qwen。
 */
export async function generateCloneSpec(params: {
  analysis: AnalysisArtifactV2;
  aspectRatio: AspectRatio;
  anchorUrls: string[];
  videoUrl?: string;                   // 源视频 URL，用于可选的 Qwen 细化
  clipUrls?: Array<{ index: number; url: string }>; // 切好的源 clips（来自 FFmpeg Worker）
  userSegmentOverride?: number;        // 用户手动覆盖段数
  providerRoute?: ProviderAlias;       // provider 路由，用于 duration 决策
  language?: 'zh' | 'en';
}): Promise<CloneSpecV2> {
  const { analysis, aspectRatio, anchorUrls, videoUrl, clipUrls, userSegmentOverride } = params;

  console.log(`[PlannerV2] Generating CloneSpec:`, {
    transcriptLength: analysis.transcript_full.length,
    utterances: analysis.utterances.length,
    beats: analysis.visual_beats.length,
    suggestedSegments: analysis.suggested_segments,
    userOverride: userSegmentOverride,
    hasClips: !!clipUrls?.length,
  });

  // ========================================================================
  // Step 1: 确定段数（本地规则引擎）
  // ========================================================================

  const segmentCount = userSegmentOverride
    ? Math.min(Math.max(userSegmentOverride, 2), 4)
    : analysis.suggested_segments;

  // ========================================================================
  // Step 2: 时间线切段（本地规则引擎）
  // ========================================================================

  let segments = segmentByTimeline(analysis, segmentCount, anchorUrls);

  // ========================================================================
  // Step 2b: Provider-aware duration 决策
  // 根据 provider 能力填充 generation_duration_seconds 和 qc_expected_duration_seconds
  // segmenter 只负责切源视频，不知道 provider 能生成多久
  // ========================================================================

  const providerAlias = params.providerRoute || 'veo_std_refs';
  const expectedDuration = getExpectedOutputDuration(providerAlias as ProviderAlias);

  segments = segments.map(seg => ({
    ...seg,
    generation_duration_seconds: expectedDuration,
    qc_expected_duration_seconds: expectedDuration,
  }));

  console.log(`[PlannerV2] Duration resolved: provider=${providerAlias}, generation=${expectedDuration}s, source_spans=[${segments.map(s => s.source_span_seconds).join(',')}]`);

  // ========================================================================
  // Step 3: Qwen 分段细化
  // 优先使用真实 source clips（来自 FFmpeg Worker），回退到整条视频 + 时间区间提示
  // ========================================================================

  if (segments.length > 0) {
    try {
      if (clipUrls && clipUrls.length > 0) {
        // 🔥 基于真实切好的 source clips 逐段细化
        console.log(`[PlannerV2] Refining with ${clipUrls.length} real source clips...`);
        for (const clip of clipUrls) {
          const matchingSeg = segments.find(s => s.index === clip.index);
          if (!matchingSeg) continue;

          const singleResult = await refineSegments(
            clip.url,  // 真实 clip URL，不是整条视频
            [{ index: matchingSeg.index, start_s: 0, end_s: matchingSeg.source_end_s - matchingSeg.source_start_s, role: matchingSeg.role }]
          );

          if (singleResult.success && singleResult.content) {
            segments = applyRefinement(segments, singleResult.content);
          }
        }
        console.log(`[PlannerV2] ✓ Segments refined with real clips`);
      } else if (videoUrl) {
        // 回退: 整条视频 + 时间区间提示
        console.log(`[PlannerV2] Refining with full video + time ranges (no clips available)...`);
        const refineResult = await refineSegments(
          videoUrl,
          segments.map(s => ({
            index: s.index,
            start_s: s.source_start_s,
            end_s: s.source_end_s,
            role: s.role,
          }))
        );

        if (refineResult.success && refineResult.content) {
          segments = applyRefinement(segments, refineResult.content);
          console.log(`[PlannerV2] ✓ Segments refined (fallback mode)`);
        } else {
          console.warn(`[PlannerV2] Refinement failed, using initial segments`);
        }
      }
    } catch (error) {
      console.warn(`[PlannerV2] Refinement error, using initial segments:`, error);
    }
  }

  // ========================================================================
  // Step 4: 生成 StyleBible（1 次 Qwen 调用）
  // ========================================================================

  const styleBibleContext = [
    `内容: ${analysis.summary}`,
    `核心卖点: ${analysis.key_claims.join(', ') || '无'}`,
    analysis.visual_beats.length > 0
      ? `画面样本: ${analysis.visual_beats.slice(0, 3).map(b => b.description).join('; ')}`
      : '',
    `类型: ${analysis.video_type}`,
  ].filter(Boolean).join('\n');

  const styleBible = await generateStyleBibleFromContext(styleBibleContext);

  // ========================================================================
  // Step 5: 构建视觉锚点
  // ========================================================================

  const visualAnchors: VisualAnchors = {
    product_frame: anchorUrls[0] || '',
    spokesperson_frame: anchorUrls[1] || anchorUrls[0] || '',
    style_frame: anchorUrls[2] || anchorUrls[1] || anchorUrls[0] || '',
  };

  // ========================================================================
  // Step 6: 组装 CloneSpecV2
  // ========================================================================

  const resolution = aspectRatio === '9:16' ? '1080x1920' : '1920x1080';
  const estimatedCost = segments.length * 50;
  const estimatedTime = segments.length * 180;

  const spec: CloneSpecV2 = {
    source_analysis: analysis,
    style_bible: styleBible,
    visual_anchors: visualAnchors,
    segments,
    provider_route: (providerAlias || 'veo_std_refs') as ProviderAlias,
    fallback_route: 'veo_fast_frames' as ProviderAlias,
    output_profile: {
      aspect: aspectRatio,
      resolution: resolution as '1080x1920' | '1920x1080',
      publish_targets: ['tiktok'],
    },
    estimated_cost: estimatedCost,
    estimated_time: estimatedTime,
    mode: 'clone',
  };

  console.log(`[PlannerV2] ✓ CloneSpec generated:`, {
    segmentCount: segments.length,
    totalSpokenChars: segments.reduce((sum, s) => sum + s.spoken_text_exact.length, 0),
    totalKeyElements: segments.reduce((sum, s) => sum + s.key_elements.length, 0),
    estimatedCost,
  });

  return spec;
}

/**
 * 应用 Qwen 细化结果到 segments
 */
function applyRefinement(segments: SegmentBlueprintV2[], content: string): SegmentBlueprintV2[] {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return segments;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.segments)) return segments;

    return segments.map(seg => {
      const refined = parsed.segments.find(
        (r: Record<string, unknown>) => Number(r.index) === seg.index
      );
      if (!refined) return seg;

      return {
        ...seg,
        // 如果细化版给了更精确的台词，使用它
        spoken_text_exact: refined.spoken_text_exact
          ? String(refined.spoken_text_exact)
          : seg.spoken_text_exact,
        // 补充 key_elements
        key_elements: [
          ...new Set([
            ...seg.key_elements,
            ...(Array.isArray(refined.key_elements) ? refined.key_elements : []),
          ]),
        ],
        // 写入细化后的画面描述
        visual_description: refined.visual_description
          ? String(refined.visual_description)
          : seg.visual_description,
        // 写入镜头运动描述
        camera: refined.camera_movement
          ? String(refined.camera_movement)
          : seg.camera,
      };
    });
  } catch {
    return segments;
  }
}

/**
 * 从上下文生成 StyleBible
 */
async function generateStyleBibleFromContext(context: string): Promise<StyleBible> {
  const result = await askQwen(
    STYLE_BIBLE_PROMPT,
    context,
    { maxTokens: 1024, temperature: 0.5 }
  );

  if (result.success && result.content) {
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          subject: parsed.subject || '',
          product: parsed.product || '',
          color_temp: parsed.color_temp || 'neutral',
          lighting: parsed.lighting || 'soft natural light',
          camera: parsed.camera || 'medium shot, eye level',
          pacing: parsed.pacing || 'medium',
          mood: parsed.mood || 'professional',
        };
      }
    } catch {
      // fall through to default
    }
  }

  return {
    subject: 'product showcase',
    product: '',
    color_temp: 'neutral',
    lighting: 'soft natural light',
    camera: 'medium shot, eye level',
    pacing: 'medium',
    mood: 'professional',
  };
}
