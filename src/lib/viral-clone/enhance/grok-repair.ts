/**
 * P2-7: Grok AI 视频修复
 *
 * 当 QC 发现视频段有瑕疵（闪帧、色偏、人物不一致等）但不严重到需要重新生成时，
 * 使用 Grok 的 extend-video 模式进行 AI 修复:
 *
 * 策略:
 * 1. 从瑕疵段的最后稳定帧重新生成剩余部分
 * 2. 用修复后的视频替换原视频段
 * 3. 记录修复操作到 attempts 表
 */

import type { ProviderAlias, TechQCResult, SemanticQCResult } from '@/types/viral-clone';
import { generateWithReference, extendVideo } from '../providers/grok-provider';
import { getProviderCreditCost } from '../providers/provider-registry';

// ============================================================================
// 类型
// ============================================================================

export interface RepairRequest {
  /** 需要修复的视频段 URL */
  segmentVideoUrl: string;
  /** 修复提示词 */
  prompt: string;
  /** 参考图 URL 列表（用于保持一致性） */
  refImages: string[];
  /** 画面比例 */
  aspectRatio: '9:16' | '16:9';
  /** 目标时长 */
  durationSeconds: number;
  /** 用户 ID */
  userId: string;
  /** QC 问题描述（指导修复方向） */
  qcIssues: string;
}

export interface RepairResult {
  success: boolean;
  /** 修复后的视频 URL */
  repairedUrl?: string;
  /** OSS 对象键 */
  ossKey?: string;
  /** 耗时（毫秒） */
  durationMs?: number;
  /** 积分消耗 */
  creditCost?: number;
  error?: string;
}

/** 修复策略 */
export type RepairStrategy = 'extend' | 'regenerate' | 'skip';

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 评估修复策略
 *
 * 根据 QC 结果严重程度决定修复方式
 */
export function evaluateRepairStrategy(
  techQC: TechQCResult | null,
  semanticQC: SemanticQCResult | null
): RepairStrategy {
  // 情况 1: Tech QC 检测到黑帧/解码错误 → 重新生成
  if (techQC && !techQC.passed) {
    if (techQC.has_black_frames || techQC.decode_errors > 0) {
      return 'regenerate';
    }
    // 时长偏差 → extend 修复
    if (!techQC.duration_ok) {
      return 'extend';
    }
  }

  // 情况 2: Semantic QC 内容不匹配 → 重新生成
  if (semanticQC && !semanticQC.passed) {
    if (!semanticQC.content_match || !semanticQC.visual_direction_ok) {
      return 'regenerate';
    }
    // 产品/人物缺失 → 尝试 extend 修复
    if (!semanticQC.product_visible || !semanticQC.person_visible) {
      return 'extend';
    }
  }

  // 情况 3: 轻微问题，跳过修复
  return 'skip';
}

/**
 * 执行 AI 视频修复
 *
 * 使用 Grok extend-video 模式，从视频的最后稳定帧开始重新生成
 */
export async function repairSegment(request: RepairRequest): Promise<RepairResult> {
  const startTime = Date.now();

  try {
    // 构建修复提示词（包含 QC 问题描述）
    const repairPrompt = buildRepairPrompt(request.prompt, request.qcIssues);

    console.log(`[GrokRepair] Repairing segment:`, {
      strategy: 'extend',
      promptLength: repairPrompt.length,
      issuesSummary: request.qcIssues.substring(0, 60),
    });

    // 尝试 extend 模式修复
    const result = await extendVideo({
      prompt: repairPrompt,
      source_video_url: request.segmentVideoUrl,
      aspect_ratio: request.aspectRatio,
      user_id: request.userId,
      duration: request.durationSeconds,
    });

    const durationMs = Date.now() - startTime;
    const creditCost = getProviderCreditCost('grok_extend');

    if (!result.success) {
      // extend 失败，尝试 reference 重新生成
      console.warn(`[GrokRepair] Extend failed, trying regenerate:`, result.error);

      const regenResult = await generateWithReference({
        provider: 'grok_ref',
        prompt: repairPrompt,
        ref_images: request.refImages,
        aspect_ratio: request.aspectRatio,
        user_id: request.userId,
        duration: request.durationSeconds,
      });

      return {
        success: regenResult.success,
        repairedUrl: regenResult.oss_url,
        ossKey: regenResult.oss_key,
        durationMs: Date.now() - startTime,
        creditCost: creditCost + getProviderCreditCost('grok_ref'),
        error: regenResult.error,
      };
    }

    return {
      success: true,
      repairedUrl: result.oss_url,
      ossKey: result.oss_key,
      durationMs,
      creditCost,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[GrokRepair] Error:`, errMsg);
    return {
      success: false,
      error: errMsg,
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// 内部函数
// ============================================================================

/**
 * 构建修复提示词
 */
function buildRepairPrompt(originalPrompt: string, qcIssues: string): string {
  return [
    originalPrompt,
    '',
    'REPAIR INSTRUCTIONS:',
    `The previous generation had these issues: ${qcIssues}`,
    'Please fix these issues while maintaining the same visual style, composition, and continuity.',
    'Ensure smooth visual transition from the source video.',
  ].join('\n');
}
