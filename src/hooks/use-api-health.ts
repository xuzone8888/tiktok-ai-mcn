"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================================
// Types
// ============================================================================

type ProviderStatus = "online" | "degraded" | "offline" | "unchecked";

interface ProviderStatusInfo {
  status: ProviderStatus;
  rate: number;
}

interface ApiHealthData {
  providers: Record<string, ProviderStatusInfo>;
  lastCheck: number | null;
}

// ============================================================================
// 模型 → Provider 映射（已交叉验证）
// ============================================================================

const MODEL_TO_PROVIDER: Record<string, string> = {
  // 图片模型
  "gpt-image-2": "openai",
  "gemini-1k": "gaorui",
  "gemini-2k": "xas231",
  "gemini-4k": "gaorui",
  // 视频模型
  "sora2": "suchuang",
  "sora2-pro": "suchuang",
  "sora2-15s": "suchuang",
  "sora2-10s": "suchuang",
  "veo3-fast": "gaorui",
  "veo3-std": "gaorui",
  "veo3-4k": "gaorui",
};

// ============================================================================
// 缓存（60s）
// ============================================================================

let cachedData: ApiHealthData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // 60s

async function fetchHealthStatus(): Promise<ApiHealthData | null> {
  const now = Date.now();
  if (cachedData && now - cacheTimestamp < CACHE_TTL) {
    return cachedData;
  }

  try {
    const res = await fetch("/api/admin/api-health/status");
    if (!res.ok) return cachedData;
    const data = await res.json();
    cachedData = data;
    cacheTimestamp = now;
    return data;
  } catch {
    return cachedData;
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useApiHealth() {
  const [data, setData] = useState<ApiHealthData | null>(cachedData);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const result = await fetchHealthStatus();
    if (mountedRef.current && result) {
      setData(result);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  /**
   * 根据模型 ID 获取对应 provider 的健康状态
   * 
   * @example
   *   const { getModelStatus } = useApiHealth();
   *   const status = getModelStatus("gemini-2k"); // "online" | "degraded" | "offline" | "unchecked"
   */
  const getModelStatus = useCallback(
    (modelId: string): ProviderStatus => {
      if (!data) return "unchecked";
      const provider = MODEL_TO_PROVIDER[modelId];
      if (!provider) return "unchecked";
      return (data.providers[provider]?.status as ProviderStatus) || "unchecked";
    },
    [data]
  );

  /**
   * 根据模型 ID 获取 provider 成功率
   */
  const getModelRate = useCallback(
    (modelId: string): number => {
      if (!data) return 0;
      const provider = MODEL_TO_PROVIDER[modelId];
      if (!provider) return 0;
      return data.providers[provider]?.rate ?? 0;
    },
    [data]
  );

  return {
    data,
    getModelStatus,
    getModelRate,
    refresh,
    lastCheck: data?.lastCheck ?? null,
  };
}
