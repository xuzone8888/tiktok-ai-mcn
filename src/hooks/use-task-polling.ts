"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { TaskStatus } from "@/types/database";

// ============================================================================
// 类型定义
// ============================================================================

export interface PollingTask {
  id: string;
  status: TaskStatus;
  progress?: number;
  outputUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  isAutoDownload?: boolean;
  fileName?: string;
}

export interface UseTaskPollingOptions {
  // 轮询间隔（毫秒）
  pollingInterval?: number;
  // 最大轮询时间（毫秒）
  maxPollingTime?: number;
  // 完成回调
  onTaskComplete?: (task: PollingTask) => void;
  // 失败回调
  onTaskFailed?: (task: PollingTask, error: string) => void;
  // 超时回调
  onTaskTimeout?: (task: PollingTask) => void;
  // 自动下载完成回调
  onAutoDownload?: (task: PollingTask) => void;
}

export interface UseTaskPollingReturn {
  // 开始轮询任务
  startPolling: (taskId: string, isAutoDownload?: boolean, fileName?: string) => void;
  // 停止轮询任务
  stopPolling: (taskId: string) => void;
  // 停止所有轮询
  stopAllPolling: () => void;
  // 正在轮询的任务
  pollingTasks: Map<string, PollingTask>;
  // 是否有任务在轮询
  isPolling: boolean;
}

// ============================================================================
// 自动下载函数
// ============================================================================

function triggerAutoDownload(url: string, fileName: string): boolean {
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName || `video-${Date.now()}.mp4`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (error) {
    console.error("Auto-download failed:", error);
    return false;
  }
}

// ============================================================================
// useTaskPolling Hook
// ============================================================================

export function useTaskPolling(options: UseTaskPollingOptions = {}): UseTaskPollingReturn {
  const {
    pollingInterval = 3000,
    maxPollingTime = 10 * 60 * 1000, // 10 minutes
    onTaskComplete,
    onTaskFailed,
    onTaskTimeout,
    onAutoDownload,
  } = options;

  // 轮询任务状态
  const [pollingTasks, setPollingTasks] = useState<Map<string, PollingTask>>(new Map());
  
  // 轮询定时器引用
  const pollingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // 开始时间引用
  const startTimesRef = useRef<Map<string, number>>(new Map());

  // 查询任务状态
  const checkTaskStatus = useCallback(async (taskId: string): Promise<PollingTask | null> => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/status`);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      const data = await response.json();
      
      if (data.success && data.task) {
        return {
          id: taskId,
          status: data.task.status,
          progress: data.task.progress,
          outputUrl: data.task.output_url,
          thumbnailUrl: data.task.thumbnail_url,
          error: data.task.error_message,
        };
      }
      return null;
    } catch (error) {
      console.error(`Failed to check task ${taskId} status:`, error);
      return null;
    }
  }, []);

  // 处理任务完成
  const handleTaskComplete = useCallback((task: PollingTask) => {
    // 停止轮询
    const timer = pollingTimersRef.current.get(task.id);
    if (timer) {
      clearInterval(timer);
      pollingTimersRef.current.delete(task.id);
    }
    startTimesRef.current.delete(task.id);

    // 检查是否需要自动下载
    const pollingTask = pollingTasks.get(task.id);
    if (pollingTask?.isAutoDownload && task.outputUrl) {
      const fileName = pollingTask.fileName || `video-${task.id}.mp4`;
      const downloaded = triggerAutoDownload(task.outputUrl, fileName);
      if (downloaded) {
        onAutoDownload?.(task);
      }
    }

    // 回调
    onTaskComplete?.(task);
  }, [pollingTasks, onTaskComplete, onAutoDownload]);

  // 处理任务失败
  const handleTaskFailed = useCallback((task: PollingTask, error: string) => {
    // 停止轮询
    const timer = pollingTimersRef.current.get(task.id);
    if (timer) {
      clearInterval(timer);
      pollingTimersRef.current.delete(task.id);
    }
    startTimesRef.current.delete(task.id);

    // 回调
    onTaskFailed?.(task, error);
  }, [onTaskFailed]);

  // 处理任务超时
  const handleTaskTimeout = useCallback((task: PollingTask) => {
    // 停止轮询
    const timer = pollingTimersRef.current.get(task.id);
    if (timer) {
      clearInterval(timer);
      pollingTimersRef.current.delete(task.id);
    }
    startTimesRef.current.delete(task.id);

    // 回调
    onTaskTimeout?.(task);
  }, [onTaskTimeout]);

  // 开始轮询
  const startPolling = useCallback((taskId: string, isAutoDownload = false, fileName?: string) => {
    // 如果已经在轮询，先停止
    const existingTimer = pollingTimersRef.current.get(taskId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    // 记录开始时间
    startTimesRef.current.set(taskId, Date.now());

    // 初始化任务状态
    setPollingTasks((prev) => {
      const newMap = new Map(prev);
      newMap.set(taskId, {
        id: taskId,
        status: "queued",
        progress: 0,
        isAutoDownload,
        fileName,
      });
      return newMap;
    });

    // 轮询函数
    const poll = async () => {
      const startTime = startTimesRef.current.get(taskId);
      
      // 检查超时
      if (startTime && Date.now() - startTime > maxPollingTime) {
        const task = pollingTasks.get(taskId) || { id: taskId, status: "failed" as TaskStatus };
        handleTaskTimeout(task);
        setPollingTasks((prev) => {
          const newMap = new Map(prev);
          newMap.set(taskId, { ...task, status: "failed", error: "Timeout" });
          return newMap;
        });
        return;
      }

      // 查询状态
      const task = await checkTaskStatus(taskId);
      
      if (task) {
        // 更新状态
        setPollingTasks((prev) => {
          const newMap = new Map(prev);
          const existingTask = prev.get(taskId);
          newMap.set(taskId, {
            ...task,
            isAutoDownload: existingTask?.isAutoDownload,
            fileName: existingTask?.fileName,
          });
          return newMap;
        });

        // 检查是否完成
        if (task.status === "completed") {
          const existingTask = pollingTasks.get(taskId);
          handleTaskComplete({
            ...task,
            isAutoDownload: existingTask?.isAutoDownload,
            fileName: existingTask?.fileName,
          });
        } else if (task.status === "failed") {
          handleTaskFailed(task, task.error || "Unknown error");
        }
      }
    };

    // 立即执行一次
    poll();

    // 设置定时器
    const timer = setInterval(poll, pollingInterval);
    pollingTimersRef.current.set(taskId, timer);
  }, [
    pollingInterval,
    maxPollingTime,
    pollingTasks,
    checkTaskStatus,
    handleTaskComplete,
    handleTaskFailed,
    handleTaskTimeout,
  ]);

  // 停止轮询
  const stopPolling = useCallback((taskId: string) => {
    const timer = pollingTimersRef.current.get(taskId);
    if (timer) {
      clearInterval(timer);
      pollingTimersRef.current.delete(taskId);
    }
    startTimesRef.current.delete(taskId);
    
    setPollingTasks((prev) => {
      const newMap = new Map(prev);
      newMap.delete(taskId);
      return newMap;
    });
  }, []);

  // 停止所有轮询
  const stopAllPolling = useCallback(() => {
    pollingTimersRef.current.forEach((timer) => clearInterval(timer));
    pollingTimersRef.current.clear();
    startTimesRef.current.clear();
    setPollingTasks(new Map());
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      pollingTimersRef.current.forEach((timer) => clearInterval(timer));
    };
  }, []);

  return {
    startPolling,
    stopPolling,
    stopAllPolling,
    pollingTasks,
    isPolling: pollingTasks.size > 0,
  };
}

export default useTaskPolling;

