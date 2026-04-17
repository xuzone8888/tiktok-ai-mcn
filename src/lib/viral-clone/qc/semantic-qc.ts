/**
 * Semantic QC — Qwen 语义质量检查
 *
 * 使用 Qwen 多模态模型检查:
 * - 口播内容是否体现在画面中
 * - 画面方向是否正确
 * - 产品/人物是否出现
 */

import type { SemanticQCResult, SegmentBlueprintV2, AnalysisArtifactV2 } from '@/types/viral-clone';
import { analyzeImage } from '../qwen-client';

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 对单个 segment 视频执行语义 QC
 *
 * 实现方案: 从视频中抽取关键帧（中间帧），用 Qwen 分析是否符合预期
 *
 * @param frameUrl 视频关键帧 URL（需要先从视频中抽帧）
 * @param spokenText 该段的口播文案
 * @param visualGoal 该段的画面目标
 * @param role 该段角色
 */
export async function runSemanticQC(
  frameUrl: string,
  spokenText: string,
  visualGoal: string,
  role: string
): Promise<SemanticQCResult> {
  console.log(`[SemanticQC] Checking frame for role=${role}`);

  try {
    const systemPrompt = `你是一个视频质量检查员。你需要判断给定的视频画面是否符合预期的内容和视觉要求。

请严格按 JSON 格式返回检查结果，不要输出其他内容。`;

    const userPrompt = `请检查这个视频画面是否符合以下要求：

预期口播内容: ${spokenText.substring(0, 200)}
预期画面目标: ${visualGoal}
段落角色: ${role}

返回 JSON:
{
  "content_match": true/false,
  "visual_direction_ok": true/false,
  "product_visible": true/false,
  "person_visible": true/false,
  "confidence": 0.0-1.0,
  "details": "检查说明"
}`;

    const result = await analyzeImage(frameUrl, systemPrompt, userPrompt, {
      maxTokens: 512,
      temperature: 0.2,
    });

    if (!result.success || !result.content) {
      return createDefaultResult(false, 'Qwen 分析失败');
    }

    // 解析 JSON
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return createDefaultResult(false, '返回格式异常');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const qcResult: SemanticQCResult = {
      passed: (parsed.content_match !== false) && (parsed.visual_direction_ok !== false),
      content_match: parsed.content_match ?? true,
      visual_direction_ok: parsed.visual_direction_ok ?? true,
      product_visible: parsed.product_visible ?? false,
      person_visible: parsed.person_visible ?? false,
      confidence: parsed.confidence ?? 0.5,
      details: parsed.details || '',
    };

    console.log(`[SemanticQC] ${qcResult.passed ? 'PASSED' : 'FAILED'}: confidence=${qcResult.confidence}`);
    return qcResult;

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SemanticQC] Error:`, errMsg);
    return createDefaultResult(false, `SemanticQC error: ${errMsg}`);
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function createDefaultResult(passed: boolean, details: string): SemanticQCResult {
  return {
    passed,
    content_match: passed,
    visual_direction_ok: passed,
    product_visible: false,
    person_visible: false,
    confidence: passed ? 0.5 : 0,
    details,
  };
}

// ============================================================================
// V2 语义 QC — 对照 Blueprint 检查
// ============================================================================

/**
 * V2: 对照 SegmentBlueprintV2 做语义质检
 *
 * 检查维度：
 * - 台词内容是否体现（全文，不截断）
 * - 画面是否符合 visual_beats 描述
 * - key_elements 是否出现
 */
export async function runSemanticQCV2(
  frameUrl: string,
  blueprint: SegmentBlueprintV2,
  analysis: AnalysisArtifactV2
): Promise<SemanticQCResult> {
  console.log(`[SemanticQCV2] Checking segment ${blueprint.index}, role=${blueprint.role}`);

  try {
    // 构建检查上下文
    const matchedBeats = analysis.visual_beats.filter(b =>
      blueprint.beat_ids.includes(b.id)
    );
    const beatDescriptions = matchedBeats.map(b => b.description).join('\n');
    const keyElementsList = blueprint.key_elements.join(', ');

    const systemPrompt = `你是一个视频质量检查员。检查生成的视频画面是否符合原始视频的内容要求。

请严格按 JSON 格式返回检查结果。`;

    const userPrompt = `检查这个视频画面是否符合以下要求：

段落角色: ${blueprint.role}

预期口播内容:
"${blueprint.spoken_text_exact}"

预期画面描述:
${beatDescriptions || '无具体描述'}

必须出现的元素: ${keyElementsList || '无特定要求'}

返回 JSON:
{
  "content_match": true/false,
  "visual_direction_ok": true/false,
  "product_visible": true/false,
  "person_visible": true/false,
  "key_elements_found": ["找到的元素"],
  "key_elements_missing": ["缺失的元素"],
  "confidence": 0.0-1.0,
  "details": "检查说明"
}`;

    const result = await analyzeImage(frameUrl, systemPrompt, userPrompt, {
      maxTokens: 512,
      temperature: 0.2,
    });

    if (!result.success || !result.content) {
      return createDefaultResult(false, 'Qwen V2 QC 分析失败');
    }

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return createDefaultResult(false, 'V2 QC 返回格式异常');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const qcResult: SemanticQCResult = {
      passed: (parsed.content_match !== false) && (parsed.visual_direction_ok !== false),
      content_match: parsed.content_match ?? true,
      visual_direction_ok: parsed.visual_direction_ok ?? true,
      product_visible: parsed.product_visible ?? false,
      person_visible: parsed.person_visible ?? false,
      confidence: parsed.confidence ?? 0.5,
      details: parsed.details || '',
    };

    console.log(`[SemanticQCV2] ${qcResult.passed ? 'PASSED' : 'FAILED'}: confidence=${qcResult.confidence}`);
    return qcResult;

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SemanticQCV2] Error:`, errMsg);
    return createDefaultResult(false, `SemanticQCV2 error: ${errMsg}`);
  }
}
