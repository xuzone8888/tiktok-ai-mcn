/**
 * Provider Registry — 审计约束 3.1: model 名不写死业务层
 *
 * 业务层只用 ProviderAlias（如 'veo_std_refs'），
 * 实际 model 字符串通过本注册表注入。
 *
 * 开工前必须: 发测试请求确认聚合商当前可用的 model 名。
 */

import type { ProviderAlias, ProviderCapability, ProviderRegistry } from '../types';

// ============================================================================
// Provider 注册表（可配置，不写死）
// ============================================================================

const REGISTRY: ProviderRegistry = {
  veo_std_refs: {
    alias: 'veo_std_refs',
    actual_model: 'veo3.1-fast-components',   // ← 聚合商实际接受的 model 名
    api_format: 'json',
    max_ref_images: 3,
    supports_audio: true,
    default_seconds: 8,
    credit_cost: 50,                          // 50 积分/次
  },
  veo_fast_frames: {
    alias: 'veo_fast_frames',
    actual_model: 'veo3.1-fast',              // ← 聚合商实际接受的 model 名
    api_format: 'multipart',
    max_ref_images: 2,                        // 首帧 + 尾帧
    supports_audio: true,
    default_seconds: 8,
    credit_cost: 30,                          // 30 积分/次
  },
  grok_ref: {
    alias: 'grok_ref',
    actual_model: 'grok-imagine-video',       // ← xAI 模型名
    api_format: 'vercel_ai_sdk',
    max_ref_images: 3,
    supports_audio: true,
    default_seconds: 8,
    credit_cost: 40,                          // 40 积分/次
    supports_extend: false,
  },
  grok_extend: {
    alias: 'grok_extend',
    actual_model: 'grok-imagine-video',       // ← xAI 模型名（同模型，不同 mode）
    api_format: 'vercel_ai_sdk',
    max_ref_images: 0,                        // extend 不用参考图
    supports_audio: true,
    default_seconds: 8,
    credit_cost: 40,
    supports_extend: true,
  },
};

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 获取 provider 能力配置
 */
export function getProviderConfig(alias: ProviderAlias): ProviderCapability {
  const config = REGISTRY[alias];
  if (!config) {
    throw new Error(`[ProviderRegistry] Unknown provider alias: ${alias}`);
  }
  return config;
}

/**
 * 获取完整注册表（用于 job 创建时冻结 capability_snapshot）
 */
export function getProviderSnapshot(): ProviderRegistry {
  return { ...REGISTRY };
}

/**
 * 获取 provider 的实际 model 名（发送给聚合商的字符串）
 */
export function getActualModelName(alias: ProviderAlias): string {
  return getProviderConfig(alias).actual_model;
}

/**
 * 获取 provider 的积分消耗
 */
export function getProviderCreditCost(alias: ProviderAlias): number {
  return getProviderConfig(alias).credit_cost;
}

/**
 * 验证 provider 是否支持给定数量的参考图
 */
export function validateRefImageCount(alias: ProviderAlias, count: number): boolean {
  const config = getProviderConfig(alias);
  return count <= config.max_ref_images;
}

/**
 * 获取所有可用的 provider alias
 */
export function getAvailableProviders(): ProviderAlias[] {
  return Object.keys(REGISTRY) as ProviderAlias[];
}

/**
 * 获取 provider 的期望输出时长（秒）
 * 用于 generation_duration 和 qc_expected_duration 的计算
 */
export function getExpectedOutputDuration(alias: ProviderAlias): number {
  return getProviderConfig(alias).default_seconds;
}
