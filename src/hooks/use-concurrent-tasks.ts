"use client";

import { useState, useCallback, useRef } from "react";

// ============================================================================
// 类型定义
// ============================================================================

export interface ConcurrentTask<T = unknown> {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result?: T;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface UseConcurrentTasksOptions {
  // 最大并发数
  maxConcurrency?: number;
  // 任务开始回调
  onTaskStart?: (taskId: string) => void;
  // 任务完成回调
  onTaskComplete?: (taskId: string, result: unknown) => void;
  // 任务失败回调
  onTaskFailed?: (taskId: string, error: string) => void;
  // 所有任务完成回调
  onAllComplete?: (results: Map<string, ConcurrentTask>) => void;
}

export interface UseConcurrentTasksReturn<T = unknown> {
  // 执行任务
  executeTasks: (
    tasks: Array<{ id: string; execute: () => Promise<T> }>
  ) => Promise<Map<string, ConcurrentTask<T>>>;
  // 取消任务
  cancelTask: (taskId: string) => void;
  // 取消所有任务
  cancelAllTasks: () => void;
  // 重试任务
  retryTask: (taskId: string, execute: () => Promise<T>) => Promise<ConcurrentTask<T> | null>;
  // 任务状态
  tasks: Map<string, ConcurrentTask<T>>;
  // 是否正在执行
  isExecuting: boolean;
  // 进度
  progress: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
  };
}

// ============================================================================
// useConcurrentTasks Hook
// ============================================================================

export function useConcurrentTasks<T = unknown>(
  options: UseConcurrentTasksOptions = {}
): UseConcurrentTasksReturn<T> {
  const {
    maxConcurrency = 5,
    onTaskStart,
    onTaskComplete,
    onTaskFailed,
    onAllComplete,
  } = options;

  const [tasks, setTasks] = useState<Map<string, ConcurrentTask<T>>>(new Map());
  const [isExecuting, setIsExecuting] = useState(false);
  
  // 取消标志
  const cancelledTasksRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // 计算进度
  const progress = {
    total: tasks.size,
    completed: Array.from(tasks.values()).filter((t) => t.status === "completed").length,
    failed: Array.from(tasks.values()).filter((t) => t.status === "failed").length,
    running: Array.from(tasks.values()).filter((t) => t.status === "running").length,
    pending: Array.from(tasks.values()).filter((t) => t.status === "pending").length,
  };

  // 更新单个任务状态
  const updateTask = useCallback((taskId: string, updates: Partial<ConcurrentTask<T>>) => {
    setTasks((prev) => {
      const newMap = new Map(prev);
      const existing = newMap.get(taskId);
      if (existing) {
        newMap.set(taskId, { ...existing, ...updates });
      }
      return newMap;
    });
  }, []);

  // 执行单个任务
  const executeTask = useCallback(
    async (
      taskId: string,
      execute: () => Promise<T>
    ): Promise<ConcurrentTask<T>> => {
      // 检查是否已取消
      if (cancelledTasksRef.current.has(taskId)) {
        return { id: taskId, status: "cancelled" };
      }

      // 创建 AbortController
      const controller = new AbortController();
      abortControllersRef.current.set(taskId, controller);

      // 更新状态为运行中
      updateTask(taskId, { status: "running", startedAt: Date.now() });
      onTaskStart?.(taskId);

      try {
        // 执行任务
        const result = await execute();

        // 检查是否已取消
        if (cancelledTasksRef.current.has(taskId)) {
          return { id: taskId, status: "cancelled" };
        }

        // 成功
        const completedTask: ConcurrentTask<T> = {
          id: taskId,
          status: "completed",
          result,
          completedAt: Date.now(),
        };
        updateTask(taskId, completedTask);
        onTaskComplete?.(taskId, result);
        return completedTask;
      } catch (error) {
        // 检查是否已取消
        if (cancelledTasksRef.current.has(taskId)) {
          return { id: taskId, status: "cancelled" };
        }

        // 失败
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const failedTask: ConcurrentTask<T> = {
          id: taskId,
          status: "failed",
          error: errorMessage,
          completedAt: Date.now(),
        };
        updateTask(taskId, failedTask);
        onTaskFailed?.(taskId, errorMessage);
        return failedTask;
      } finally {
        abortControllersRef.current.delete(taskId);
      }
    },
    [updateTask, onTaskStart, onTaskComplete, onTaskFailed]
  );

  // 并发执行任务
  const executeTasks = useCallback(
    async (
      taskList: Array<{ id: string; execute: () => Promise<T> }>
    ): Promise<Map<string, ConcurrentTask<T>>> => {
      if (taskList.length === 0) {
        return new Map();
      }

      setIsExecuting(true);
      cancelledTasksRef.current.clear();

      // 初始化任务状态
      const initialTasks = new Map<string, ConcurrentTask<T>>();
      taskList.forEach(({ id }) => {
        initialTasks.set(id, { id, status: "pending" });
      });
      setTasks(initialTasks);

      // 并发控制执行
      const results = new Map<string, ConcurrentTask<T>>();
      const queue = [...taskList];
      const executing: Promise<void>[] = [];

      const runNext = async (): Promise<void> => {
        if (queue.length === 0) return;

        const task = queue.shift();
        if (!task) return;

        const result = await executeTask(task.id, task.execute);
        results.set(task.id, result);

        // 继续执行队列中的下一个任务
        if (queue.length > 0) {
          await runNext();
        }
      };

      // 启动初始批次
      const initialBatch = Math.min(maxConcurrency, queue.length);
      for (let i = 0; i < initialBatch; i++) {
        executing.push(runNext());
      }

      // 等待所有任务完成
      await Promise.all(executing);

      setIsExecuting(false);
      onAllComplete?.(results);

      return results;
    },
    [maxConcurrency, executeTask, onAllComplete]
  );

  // 取消任务
  const cancelTask = useCallback((taskId: string) => {
    cancelledTasksRef.current.add(taskId);
    
    // 中止请求
    const controller = abortControllersRef.current.get(taskId);
    if (controller) {
      controller.abort();
    }

    updateTask(taskId, { status: "cancelled" });
  }, [updateTask]);

  // 取消所有任务
  const cancelAllTasks = useCallback(() => {
    tasks.forEach((_, taskId) => {
      cancelledTasksRef.current.add(taskId);
    });

    abortControllersRef.current.forEach((controller) => {
      controller.abort();
    });

    setTasks((prev) => {
      const newMap = new Map(prev);
      newMap.forEach((task, id) => {
        if (task.status === "pending" || task.status === "running") {
          newMap.set(id, { ...task, status: "cancelled" });
        }
      });
      return newMap;
    });

    setIsExecuting(false);
  }, [tasks]);

  // 重试任务
  const retryTask = useCallback(
    async (
      taskId: string,
      execute: () => Promise<T>
    ): Promise<ConcurrentTask<T> | null> => {
      const task = tasks.get(taskId);
      if (!task || (task.status !== "failed" && task.status !== "cancelled")) {
        return null;
      }

      cancelledTasksRef.current.delete(taskId);
      updateTask(taskId, { status: "pending", error: undefined });

      return executeTask(taskId, execute);
    },
    [tasks, updateTask, executeTask]
  );

  return {
    executeTasks,
    cancelTask,
    cancelAllTasks,
    retryTask,
    tasks,
    isExecuting,
    progress,
  };
}

export default useConcurrentTasks;

