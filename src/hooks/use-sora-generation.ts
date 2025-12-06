"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { VideoDuration } from "@/lib/sora-api";

// ============================================================================
// 类型定义
// ============================================================================

export type GenerationStatus = 
  | "idle" 
  | "creating" 
  | "processing" 
  | "completed" 
  | "failed" 
  | "timeout"
  | "cancelled";

export interface GenerationState {
  status: GenerationStatus;
  taskId: string | null;
  progress: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  creditsUsed: number;
  creditsRefunded: number;
  startTime: number | null;
  elapsedTime: number;
}

export interface UseGenerationOptions {
  onComplete?: (videoUrl: string, thumbnailUrl?: string) => void;
  onError?: (error: string, refundedCredits?: number) => void;
  onTimeout?: (refundedCredits: number) => void;
  pollInterval?: number;
}

// ============================================================================
// 积分定价
// ============================================================================

export const CREDITS_PRICING: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

// ============================================================================
// Hook 实现
// ============================================================================

export function useSoraGeneration(options: UseGenerationOptions = {}) {
  const { 
    onComplete, 
    onError, 
    onTimeout,
    pollInterval = 5000 
  } = options;

  const [state, setState] = useState<GenerationState>({
    status: "idle",
    taskId: null,
    progress: 0,
    videoUrl: null,
    thumbnailUrl: null,
    error: null,
    creditsUsed: 0,
    creditsRefunded: 0,
    startTime: null,
    elapsedTime: 0,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 清理函数
  const cleanup = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // 轮询任务状态
  const pollStatus = useCallback(async (taskId: string) => {
    try {
      const response = await fetch(`/api/sora/status/${taskId}`, {
        signal: abortControllerRef.current?.signal,
      });

      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to get status");
      }

      // 更新状态
      setState((prev) => ({
        ...prev,
        progress: data.progress || prev.progress,
        videoUrl: data.video_url || prev.videoUrl,
        thumbnailUrl: data.thumbnail_url || prev.thumbnailUrl,
        creditsRefunded: data.credits_refunded || prev.creditsRefunded,
      }));

      // 处理不同状态
      switch (data.status) {
        case "completed":
          cleanup();
          setState((prev) => ({
            ...prev,
            status: "completed",
            progress: 100,
            videoUrl: data.video_url,
            thumbnailUrl: data.thumbnail_url,
          }));
          onComplete?.(data.video_url, data.thumbnail_url);
          break;

        case "failed":
          cleanup();
          setState((prev) => ({
            ...prev,
            status: "failed",
            error: data.error || "Generation failed",
            creditsRefunded: data.credits_refunded || 0,
          }));
          onError?.(data.error || "Generation failed", data.credits_refunded);
          break;

        case "timeout":
          cleanup();
          setState((prev) => ({
            ...prev,
            status: "timeout",
            error: "Generation timed out",
            creditsRefunded: data.credits_refunded || 0,
          }));
          onTimeout?.(data.credits_refunded || 0);
          break;

        default:
          // 继续轮询
          break;
      }
    } catch (error: any) {
      if (error.name === "AbortError") return;
      console.error("[Poll Status] Error:", error);
    }
  }, [cleanup, onComplete, onError, onTimeout]);

  // 开始生成
  const startGeneration = useCallback(async (
    prompt: string,
    duration: VideoDuration,
    options?: {
      model_id?: string;
      product_id?: string;
      aspect_ratio?: "16:9" | "9:16" | "1:1";
    }
  ): Promise<boolean> => {
    // 清理之前的状态
    cleanup();

    // 重置状态
    setState({
      status: "creating",
      taskId: null,
      progress: 0,
      videoUrl: null,
      thumbnailUrl: null,
      error: null,
      creditsUsed: CREDITS_PRICING[duration],
      creditsRefunded: 0,
      startTime: Date.now(),
      elapsedTime: 0,
    });

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/sora/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          duration,
          model_id: options?.model_id,
          product_id: options?.product_id,
          aspect_ratio: options?.aspect_ratio,
        }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to start generation");
      }

      // 更新状态
      setState((prev) => ({
        ...prev,
        status: "processing",
        taskId: data.task_id,
        creditsUsed: data.credits_used,
      }));

      // 启动经过时间计时器
      elapsedIntervalRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          elapsedTime: prev.startTime ? Date.now() - prev.startTime : 0,
        }));
      }, 1000);

      // 启动轮询
      pollIntervalRef.current = setInterval(() => {
        pollStatus(data.task_id);
      }, pollInterval);

      // 立即执行一次轮询
      pollStatus(data.task_id);

      return true;
    } catch (error: any) {
      if (error.name === "AbortError") return false;

      setState((prev) => ({
        ...prev,
        status: "failed",
        error: error.message || "Failed to start generation",
      }));

      onError?.(error.message || "Failed to start generation");
      return false;
    }
  }, [cleanup, pollStatus, pollInterval, onError]);

  // 取消生成
  const cancelGeneration = useCallback(async (): Promise<boolean> => {
    if (!state.taskId) return false;

    try {
      const response = await fetch(`/api/sora/status/${state.taskId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      cleanup();

      setState((prev) => ({
        ...prev,
        status: "cancelled",
        creditsRefunded: data.refunded_credits || 0,
      }));

      return true;
    } catch (error: any) {
      console.error("[Cancel Generation] Error:", error);
      return false;
    }
  }, [state.taskId, cleanup]);

  // 重置状态
  const reset = useCallback(() => {
    cleanup();
    setState({
      status: "idle",
      taskId: null,
      progress: 0,
      videoUrl: null,
      thumbnailUrl: null,
      error: null,
      creditsUsed: 0,
      creditsRefunded: 0,
      startTime: null,
      elapsedTime: 0,
    });
  }, [cleanup]);

  // 格式化经过时间
  const formatElapsedTime = useCallback((ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }, []);

  return {
    ...state,
    isGenerating: ["creating", "processing"].includes(state.status),
    formattedElapsedTime: formatElapsedTime(state.elapsedTime),
    startGeneration,
    cancelGeneration,
    reset,
    getCreditsPrice: (duration: VideoDuration) => CREDITS_PRICING[duration],
  };
}



