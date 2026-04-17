/**
 * Segmenter — 脚本分段切割器
 *
 * 按实施文档第八节的分段规则:
 * - 默认段长 8 秒，口播 6.0-7.0 秒
 * - ≤16s → 2段, 18-24s → 3段, >24s → 4段
 * - 切分优先级: 语义完成 > 气口 > 标点 > 时长目标
 * - 不允许半句话切在段末
 * - 每段必须有明确 spoken_text
 */

import type { SegmentPlan, SegmentRole, SegmentBlueprintV2, AnalysisArtifactV2 } from '@/types/viral-clone';
import { SEGMENTATION_RULES } from '@/types/viral-clone';

// ============================================================================
// 配置
// ============================================================================

interface SegmentOptions {
  /** 目标段数 */
  targetSegments: number;
  /** 目标总时长（秒） */
  targetDuration: number;
  /** 参考图 URL 列表（所有段共享） */
  refImages: string[];
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 将完整脚本切分为多个段
 *
 * @param fullScript 完整口播文案
 * @param options 分段选项
 * @returns 分段计划数组
 */
export function segmentScript(
  fullScript: string,
  options: SegmentOptions
): SegmentPlan[] {
  const { targetSegments, targetDuration, refImages } = options;

  // 确定实际段数
  const segmentCount = determineSegmentCount(targetDuration, targetSegments);

  console.log(`[Segmenter] Splitting script (${fullScript.length} chars) into ${segmentCount} segments, target ${targetDuration}s`);

  // 按语义边界切分文本
  const textChunks = splitBySemanticBoundary(fullScript, segmentCount);

  // 为每个 chunk 分配角色和时长
  const segments: SegmentPlan[] = textChunks.map((text, index) => {
    const role = assignRole(index, textChunks.length);
    const targetSeconds = calculateSegmentDuration(index, textChunks.length, targetDuration);

    return {
      spoken_text: text.trim(),
      visual_goal: generateVisualGoal(text, role),
      role,
      target_seconds: targetSeconds,
      seam_hint: generateSeamHint(index, textChunks.length, role),
      ref_images: refImages.slice(0, 3), // 每段共享同一组参考图
    };
  });

  return segments;
}

// ============================================================================
// 内部函数
// ============================================================================

/**
 * 确定实际分段数
 */
function determineSegmentCount(targetDuration: number, suggestedCount: number): number {
  // 按时长规则确定
  for (const rule of SEGMENTATION_RULES.SEGMENT_COUNT_MAP) {
    if (targetDuration <= rule.maxDuration) {
      return rule.segments;
    }
  }

  // 如果都不满足，取建议值但限制在 2-4
  return Math.min(Math.max(suggestedCount, 2), 4);
}

/**
 * 按语义边界切分文本
 *
 * 切分优先级: 语义完成 > 气口 > 标点 > 均分
 * 硬约束: 不允许半句话切在段末
 */
function splitBySemanticBoundary(text: string, targetChunks: number): string[] {
  if (targetChunks <= 1) return [text];

  // Step 1: 按强分隔符拆分（句号、感叹号、问号、换行）
  const sentences = text
    .split(/(?<=[。！？!?.;\n])\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length <= targetChunks) {
    // 句子数不够，尝试用逗号等弱分隔
    return distributeEvenly(sentences, targetChunks);
  }

  // Step 2: 将句子分配到 targetChunks 个桶中
  return distributeEvenly(sentences, targetChunks);
}

/**
 * 将句子均匀分配到多个桶中
 */
function distributeEvenly(sentences: string[], bucketCount: number): string[] {
  if (sentences.length === 0) {
    return Array(bucketCount).fill('');
  }

  if (bucketCount >= sentences.length) {
    // 桶比句子多，直接每句一桶，空桶合并到相邻
    const result: string[] = [];
    for (let i = 0; i < bucketCount; i++) {
      if (i < sentences.length) {
        result.push(sentences[i]);
      }
    }
    // 如果桶比句子多，把多余的桶合并到最后一个
    while (result.length > bucketCount) {
      const last = result.pop()!;
      result[result.length - 1] += ' ' + last;
    }
    // 如果桶比句子少，补空
    while (result.length < bucketCount) {
      result.push(result[result.length - 1] || '');
    }
    return result;
  }

  // 正常情况：句子多于桶
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
  const charsPerBucket = totalChars / bucketCount;

  const result: string[] = [];
  let currentBucket: string[] = [];
  let currentLength = 0;
  let bucketsRemaining = bucketCount;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentencesRemaining = sentences.length - i;

    currentBucket.push(sentence);
    currentLength += sentence.length;

    // 判断是否应该切到下一个桶
    const shouldCut =
      bucketsRemaining > 1 && (
        // 当前桶已达目标长度
        currentLength >= charsPerBucket * 0.8 ||
        // 剩余句子刚好够剩余桶分
        sentencesRemaining - 1 <= bucketsRemaining - 1
      );

    if (shouldCut) {
      result.push(currentBucket.join(' '));
      currentBucket = [];
      currentLength = 0;
      bucketsRemaining--;
    }
  }

  // 最后一个桶
  if (currentBucket.length > 0) {
    result.push(currentBucket.join(' '));
  }

  // 确保桶数正确
  while (result.length < bucketCount) {
    result.push('');
  }
  while (result.length > bucketCount) {
    // 合并最后两个
    const last = result.pop()!;
    result[result.length - 1] += ' ' + last;
  }

  return result;
}

/**
 * 分配段角色
 */
function assignRole(index: number, total: number): SegmentRole {
  if (index === 0) return 'hook';
  if (index === total - 1) return 'cta';
  return 'body';
}

/**
 * 计算每段目标时长
 */
function calculateSegmentDuration(
  index: number,
  total: number,
  totalDuration: number
): number {
  const baseDuration = SEGMENTATION_RULES.DEFAULT_SEGMENT_SECONDS;

  // 均分原则，但首段和末段可以略短
  const avgDuration = totalDuration / total;

  if (index === 0) {
    // hook 段略短
    return Math.min(avgDuration, baseDuration);
  }
  if (index === total - 1) {
    // CTA 段略短
    return Math.min(avgDuration, baseDuration);
  }

  // body 段取均分值
  return Math.min(avgDuration, baseDuration);
}

/**
 * 生成视觉目标描述（给 prompt compiler 用）
 */
function generateVisualGoal(spokenText: string, role: SegmentRole): string {
  switch (role) {
    case 'hook':
      return `Opening hook shot: grab attention, show product/person prominently. Content: ${spokenText.substring(0, 50)}`;
    case 'cta':
      return `Call to action closeup: product hero shot, confident presenter. Content: ${spokenText.substring(0, 50)}`;
    case 'demo':
      return `Product demonstration: hands-on, detailed view. Content: ${spokenText.substring(0, 50)}`;
    case 'b_roll':
      return `B-roll transition: ambient, lifestyle context`;
    case 'body':
    default:
      return `Main content: product showcase with presenter. Content: ${spokenText.substring(0, 50)}`;
  }
}

/**
 * 生成衔接提示
 */
function generateSeamHint(index: number, total: number, role: SegmentRole): string {
  if (index === 0) return 'start_of_video';
  if (index === total - 1) return 'end_of_video';

  switch (role) {
    case 'body':
      return 'speech_to_speech';
    case 'b_roll':
      return 'broll_transition';
    default:
      return 'speech_to_speech';
  }
}

// ============================================================================
// V2 时间线切段
// ============================================================================

type BlueprintRole = SegmentBlueprintV2['role'];

/** 角色分配模板 */
const ROLE_TEMPLATES: Record<number, BlueprintRole[]> = {
  2: ['hook', 'cta'],
  3: ['hook', 'demo', 'cta'],
  4: ['hook', 'demo', 'proof', 'cta'],
};

/**
 * V2: 基于时间线的分段 — 从 AnalysisArtifactV2 构建 SegmentBlueprintV2[]
 *
 * 切分策略:
 * 1. 按 utterances 时间线均分
 * 2. 优先在 utterance 边界切（语义完成点）
 * 3. 关联对应时间范围的 visual_beats
 * 4. 合并 key_elements
 */
export function segmentByTimeline(
  analysis: AnalysisArtifactV2,
  targetSegments: number,
  refImages: string[]
): SegmentBlueprintV2[] {
  const segCount = Math.min(Math.max(targetSegments, 2), 4);
  const roles = ROLE_TEMPLATES[segCount] || ROLE_TEMPLATES[3];

  console.log(`[SegmenterV2] Splitting ${analysis.utterances.length} utterances into ${segCount} segments`);

  // 🚨 防御：空 utterances 不允许通过，必须让上层处理
  if (analysis.utterances.length === 0) {
    // 如果有 transcript_full 但没有 utterances，用 transcript_full 构造一个最小 utterance
    if (analysis.transcript_full.trim().length > 0) {
      console.warn(`[SegmenterV2] No utterances but has transcript_full, constructing synthetic utterance`);
      const dur = analysis.suggested_duration || 24;
      analysis.utterances = [{
        id: 'utt_synthetic_0',
        approx_start_s: 0,
        approx_end_s: dur,
        text: analysis.transcript_full,
      }];
    } else {
      throw new Error('[SegmenterV2] Cannot segment: no utterances and no transcript. Analysis likely failed.');
    }
  }

  // Step 1: 将 utterances 分配到各段
  const utteranceGroups = distributeUtterances(analysis.utterances, segCount);

  // Step 2: 为每组构建 blueprint
  return utteranceGroups.map((group, i) => {
    const role = roles[i] || 'demo';

    // 计算时间范围
    const source_start_s = group.length > 0
      ? group[0].approx_start_s
      : (i > 0 ? utteranceGroups[i - 1][utteranceGroups[i - 1].length - 1]?.approx_end_s || 0 : 0);
    const source_end_s = group.length > 0
      ? group[group.length - 1].approx_end_s
      : source_start_s + (analysis.suggested_duration / segCount);

    // 关联 utterance IDs
    const utterance_ids = group.map(u => u.id);

    // 拼接台词
    const spoken_text_exact = group.map(u => u.text).join(' ').trim();

    // 找到时间范围内的 visual_beats
    const matchedBeats = analysis.visual_beats.filter(b =>
      b.approx_start_s < source_end_s && b.approx_end_s > source_start_s
    );
    const beat_ids = matchedBeats.map(b => b.id);

    // 合并 key_elements（去重）
    const key_elements = [...new Set(
      matchedBeats.flatMap(b => b.key_elements)
    )];

    // 计算源视频跨度时长（segmenter 只负责"源视频怎么切"）
    const source_span_seconds = Math.round(source_end_s - source_start_s);
    // 兼容旧字段
    const target_seconds = Math.max(source_span_seconds, SEGMENTATION_RULES.DEFAULT_SEGMENT_SECONDS);

    return {
      index: i,
      source_start_s: Math.round(source_start_s * 10) / 10,
      source_end_s: Math.round(source_end_s * 10) / 10,
      role,
      utterance_ids,
      beat_ids,
      spoken_text_exact,
      key_elements,
      seam_hint: generateSeamHintV2(i, segCount, role),
      ref_images: refImages.slice(0, 3),
      target_seconds,
      source_span_seconds: Math.max(source_span_seconds, 1),
      // generation_duration_seconds 和 qc_expected_duration_seconds
      // 由 planner 的 resolveGenerationDuration 填充，segmenter 先给默认值
      generation_duration_seconds: SEGMENTATION_RULES.DEFAULT_SEGMENT_SECONDS,
      qc_expected_duration_seconds: SEGMENTATION_RULES.DEFAULT_SEGMENT_SECONDS,
    };
  });
}

/**
 * 将 utterances 均匀分配到多个段中（优先在语义边界切）
 */
function distributeUtterances(
  utterances: AnalysisArtifactV2['utterances'],
  segCount: number
): AnalysisArtifactV2['utterances'][] {
  if (utterances.length <= segCount) {
    // 每个 utterance 一个段，不够的空段
    const result: AnalysisArtifactV2['utterances'][] = [];
    for (let i = 0; i < segCount; i++) {
      result.push(i < utterances.length ? [utterances[i]] : []);
    }
    return result;
  }

  // 按总时长均分
  const totalDuration = utterances[utterances.length - 1].approx_end_s - utterances[0].approx_start_s;
  const targetDurationPerSeg = totalDuration / segCount;

  const result: AnalysisArtifactV2['utterances'][] = [];
  let current: AnalysisArtifactV2['utterances'] = [];
  let currentDuration = 0;
  let segsRemaining = segCount;

  for (let i = 0; i < utterances.length; i++) {
    const utt = utterances[i];
    const uttDuration = utt.approx_end_s - utt.approx_start_s;
    current.push(utt);
    currentDuration += uttDuration;

    const remaining = utterances.length - i - 1;
    const shouldCut = segsRemaining > 1 && (
      currentDuration >= targetDurationPerSeg * 0.7 ||
      remaining <= segsRemaining - 1
    );

    if (shouldCut) {
      result.push(current);
      current = [];
      currentDuration = 0;
      segsRemaining--;
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  // 确保段数正确
  while (result.length < segCount) result.push([]);
  while (result.length > segCount) {
    const last = result.pop()!;
    result[result.length - 1].push(...last);
  }

  return result;
}

/**
 * V2 衔接提示生成
 */
function generateSeamHintV2(index: number, total: number, role: BlueprintRole): string {
  if (index === 0) return 'start_of_video';
  if (index === total - 1) return 'end_of_video';
  if (role === 'b_roll') return 'broll_transition';
  return 'speech_to_speech';
}
