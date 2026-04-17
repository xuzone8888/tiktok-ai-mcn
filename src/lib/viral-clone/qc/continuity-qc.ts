/**
 * Continuity QC — 连续性检查
 *
 * 使用 Qwen 多模态比较相邻两个 segment 的:
 * - 人物一致性（外貌、服装、姿态）
 * - 产品一致性
 * - 背景一致性
 * - 色调一致性
 * - 语气一致性
 */

import type { ContinuityQCResult } from '@/types/viral-clone';
import { compareVideoFrames } from '../qwen-client';

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 比较相邻两段的连续性
 *
 * @param tailFrameUrl 前一段的尾帧 URL
 * @param headFrameUrl 后一段的首帧 URL
 * @param segmentIndexA 前一段序号
 * @param segmentIndexB 后一段序号
 */
export async function runContinuityQC(
  tailFrameUrl: string,
  headFrameUrl: string,
  segmentIndexA: number,
  segmentIndexB: number
): Promise<ContinuityQCResult> {
  console.log(`[ContinuityQC] Comparing segment ${segmentIndexA} ↔ ${segmentIndexB}`);

  try {
    const systemPrompt = `你是一个视频连续性检查员。你需要比较两个连续视频段的首尾帧，判断它们之间是否存在明显的视觉跳变。

检查维度：
1. 人物一致性：同一个人是否保持相同外貌和服装
2. 产品一致性：同一产品的外观是否一致
3. 服装一致性：人物穿着是否一致
4. 背景一致性：场景是否连续
5. 色调一致性：色温和曝光是否一致

严重程度：
- none: 完全连续，无需处理
- minor: 轻微差异，可接受
- major: 明显跳变，建议重新生成
- critical: 严重不一致，必须重新生成

请严格按 JSON 格式返回，不要输出其他内容。`;

    const userPrompt = `请比较这两张图片（第一张是前一段的尾帧，第二张是后一段的首帧），判断连续性。

返回 JSON:
{
  "person_consistent": true/false,
  "product_consistent": true/false,
  "wardrobe_consistent": true/false,
  "background_consistent": true/false,
  "tone_consistent": true/false,
  "color_consistent": true/false,
  "severity": "none/minor/major/critical",
  "details": "检查说明"
}`;

    const result = await compareVideoFrames(
      tailFrameUrl,
      headFrameUrl,
      systemPrompt,
      userPrompt,
      { maxTokens: 512, temperature: 0.2 }
    );

    if (!result.success || !result.content) {
      return createDefaultResult(true, 'Qwen 分析失败，默认通过');
    }

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return createDefaultResult(true, '返回格式异常，默认通过');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const severity = (['none', 'minor', 'major', 'critical'].includes(parsed.severity))
      ? parsed.severity as ContinuityQCResult['severity']
      : 'none';

    const passed = severity === 'none' || severity === 'minor';

    const qcResult: ContinuityQCResult = {
      passed,
      person_consistent: parsed.person_consistent ?? true,
      product_consistent: parsed.product_consistent ?? true,
      wardrobe_consistent: parsed.wardrobe_consistent ?? true,
      background_consistent: parsed.background_consistent ?? true,
      tone_consistent: parsed.tone_consistent ?? true,
      color_consistent: parsed.color_consistent ?? true,
      severity,
      details: parsed.details || '',
    };

    console.log(`[ContinuityQC] ${passed ? 'PASSED' : 'FAILED'}: severity=${severity}`);
    return qcResult;

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ContinuityQC] Error:`, errMsg);
    return createDefaultResult(true, `ContinuityQC error: ${errMsg}`);
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function createDefaultResult(passed: boolean, details: string): ContinuityQCResult {
  return {
    passed,
    person_consistent: true,
    product_consistent: true,
    wardrobe_consistent: true,
    background_consistent: true,
    tone_consistent: true,
    color_consistent: true,
    severity: passed ? 'none' : 'major',
    details,
  };
}
