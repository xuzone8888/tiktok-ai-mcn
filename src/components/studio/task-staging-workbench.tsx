"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Play,
  Trash2,
  Eraser,
  Copy,
  Zap,
  Layers,
  Sparkles,
  ImageIcon,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
  StopCircle,
  RotateCcw,
} from "lucide-react";
import { TaskCard, type TaskData } from "./task-card";
import { useToast } from "@/hooks/use-toast";
import type { AspectRatio, VideoDuration, TaskStatus } from "@/types/database";

// ============================================================================
// 类型定义
// ============================================================================

export interface TaskStagingWorkbenchProps {
  // 全局配置（从 Configuration Bar 继承）
  globalDuration: VideoDuration;
  globalAspectRatio: AspectRatio;
  globalAutoDownload: boolean;
  
  // 用户积分
  userCredits: number;
  
  // 外部添加的任务（从 ResourceInput）
  externalTasks?: Array<{
    imageUrl: string;
    imageName?: string;
    prompt?: string;
    duration?: VideoDuration;
    aspectRatio?: AspectRatio;
  }>;
  
  // 清除外部任务的回调（添加后清空）
  onExternalTasksAdded?: () => void;
  
  // 是否正在处理
  isProcessing?: boolean;
  
  // 类名
  className?: string;
}

// ============================================================================
// 积分定价
// ============================================================================

const DURATION_CREDITS: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

// ============================================================================
// 辅助函数
// ============================================================================

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function createEmptyTask(
  imageUrl: string,
  imageName: string,
  duration: VideoDuration,
  aspectRatio: AspectRatio
): TaskData {
  return {
    id: generateTaskId(),
    imageUrl,
    imageName,
    prompt: "",
    duration,
    aspectRatio,
    status: "draft",
    costCredits: DURATION_CREDITS[duration],
  };
}

// ============================================================================
// Mock 图片数据（演示用）
// ============================================================================

const DEMO_IMAGES = [
  {
    url: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&h=400&fit=crop",
    name: "时尚服装展示",
  },
  {
    url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop",
    name: "智能手表产品",
  },
  {
    url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=400&fit=crop",
    name: "耳机配件",
  },
];

// ============================================================================
// 并发控制配置
// ============================================================================

const MAX_CONCURRENCY = 5; // 最大并发数
const POLLING_INTERVAL = 3000; // 轮询间隔（毫秒）

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
// Task Staging Workbench 组件
// ============================================================================

export function TaskStagingWorkbench({
  globalDuration,
  globalAspectRatio,
  globalAutoDownload,
  userCredits,
  externalTasks = [],
  onExternalTasksAdded,
  isProcessing = false,
  className,
}: TaskStagingWorkbenchProps) {
  const { toast } = useToast();
  
  // 任务列表状态
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  
  // 轮询定时器引用
  const pollingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // 取消标志
  const cancelledTasksRef = useRef<Set<string>>(new Set());

  // 清理轮询定时器
  useEffect(() => {
    return () => {
      pollingTimersRef.current.forEach((timer) => clearInterval(timer));
    };
  }, []);

  // 处理外部添加的任务
  useEffect(() => {
    if (externalTasks.length > 0) {
      const newTasks = externalTasks.map((ext) =>
        createEmptyTask(
          ext.imageUrl,
          ext.imageName || "上传图片",
          ext.duration || globalDuration,
          ext.aspectRatio || globalAspectRatio
        )
      );
      
      // 如果有 prompt，更新
      newTasks.forEach((task, i) => {
        if (externalTasks[i].prompt) {
          task.prompt = externalTasks[i].prompt || "";
        }
      });

      setTasks((prev) => [...prev, ...newTasks]);
      
      toast({
        title: "任务已添加",
        description: `${newTasks.length} 个任务已添加到备料台`,
      });

      // 通知外部清空
      onExternalTasksAdded?.();
    }
  }, [externalTasks, globalDuration, globalAspectRatio, onExternalTasksAdded, toast]);

  // ================================================================
  // 计算统计信息
  // ================================================================
  const stats = useMemo(() => {
    const draftTasks = tasks.filter((t) => t.status === "draft");
    const totalCost = draftTasks.reduce((sum, t) => sum + t.costCredits, 0);
    const completedCount = tasks.filter((t) => t.status === "completed").length;
    const failedCount = tasks.filter((t) => t.status === "failed").length;
    const processingCount = tasks.filter(
      (t) => t.status === "processing" || t.status === "queued"
    ).length;

    return {
      draftCount: draftTasks.length,
      totalCost,
      completedCount,
      failedCount,
      processingCount,
      totalCount: tasks.length,
      canGenerate: draftTasks.length > 0 && totalCost <= userCredits,
      insufficientCredits: totalCost > userCredits,
    };
  }, [tasks, userCredits]);

  // ================================================================
  // 轮询任务状态
  // ================================================================
  
  const startPollingTask = useCallback((taskId: string, isAutoDownload: boolean) => {
    // 如果已有定时器，先清除
    const existingTimer = pollingTimersRef.current.get(taskId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    const poll = async () => {
      // 检查是否已取消
      if (cancelledTasksRef.current.has(taskId)) {
        const timer = pollingTimersRef.current.get(taskId);
        if (timer) clearInterval(timer);
        pollingTimersRef.current.delete(taskId);
        return;
      }

      try {
        const response = await fetch(`/api/tasks/${taskId}/status`);
        const data = await response.json();

        if (data.success && data.task) {
          const { status, progress, output_url, thumbnail_url, error_message } = data.task;

          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    status: status as TaskStatus,
                    progress: progress || t.progress,
                    outputUrl: output_url || t.outputUrl,
                    error: error_message || t.error,
                  }
                : t
            )
          );

          // 检查是否完成
          if (status === "completed") {
            // 停止轮询
            const timer = pollingTimersRef.current.get(taskId);
            if (timer) clearInterval(timer);
            pollingTimersRef.current.delete(taskId);

            // 自动下载
            if (isAutoDownload && output_url) {
              const fileName = `video-${taskId.slice(-8)}.mp4`;
              const downloaded = triggerAutoDownload(output_url, fileName);
              if (downloaded) {
                toast({
                  title: "Video downloaded automatically",
                  description: `${fileName} has been saved to your device`,
                });
              }
            }

            toast({
              title: "生成完成！",
              description: "视频已成功生成",
            });
          } else if (status === "failed") {
            // 停止轮询
            const timer = pollingTimersRef.current.get(taskId);
            if (timer) clearInterval(timer);
            pollingTimersRef.current.delete(taskId);

            toast({
              variant: "destructive",
              title: "生成失败",
              description: error_message || "未知错误",
            });
          }
        }
      } catch (error) {
        console.error(`Polling error for task ${taskId}:`, error);
      }
    };

    // 立即执行一次
    poll();

    // 设置定时器
    const timer = setInterval(poll, POLLING_INTERVAL);
    pollingTimersRef.current.set(taskId, timer);
  }, [toast]);

  // 停止轮询任务
  const stopPollingTask = useCallback((taskId: string) => {
    const timer = pollingTimersRef.current.get(taskId);
    if (timer) {
      clearInterval(timer);
      pollingTimersRef.current.delete(taskId);
    }
  }, []);

  // ================================================================
  // 调用生成 API
  // ================================================================
  
  const callGenerateAPI = useCallback(async (task: TaskData): Promise<boolean> => {
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          imageUrl: task.imageUrl,
          prompt: task.prompt || "Generate a creative video",
          duration: task.duration,
          aspectRatio: task.aspectRatio,
          isAutoDownload: globalAutoDownload,
        }),
      });

      const data = await response.json();
      return data.success;
    } catch (error) {
      console.error(`API call failed for task ${task.id}:`, error);
      return false;
    }
  }, [globalAutoDownload]);

  // ================================================================
  // 任务操作函数
  // ================================================================

  // 添加演示任务
  const handleAddDemoTasks = useCallback(() => {
    const newTasks = DEMO_IMAGES.map((img) =>
      createEmptyTask(img.url, img.name, globalDuration, globalAspectRatio)
    );
    setTasks((prev) => [...prev, ...newTasks]);
  }, [globalDuration, globalAspectRatio]);

  // 更新任务 Prompt
  const handlePromptChange = useCallback((taskId: string, prompt: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, prompt } : t))
    );
  }, []);

  // 开始单个任务
  const handleStartTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status !== "draft") return;

      // 从取消列表中移除
      cancelledTasksRef.current.delete(taskId);

      // 更新状态为排队中
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: "queued" as TaskStatus } : t
        )
      );

      try {
        // 调用 API
        const success = await callGenerateAPI(task);
        
        if (success) {
          // 开始轮询
          startPollingTask(taskId, globalAutoDownload);
          
          toast({
            title: "任务已启动",
            description: `正在生成: ${task.imageName || "任务"}`,
          });
        } else {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? { ...t, status: "failed" as TaskStatus, error: "API 调用失败" }
                : t
            )
          );
        }
      } catch (error) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, status: "failed" as TaskStatus, error: "生成失败" }
              : t
          )
        );
      }
    },
    [tasks, callGenerateAPI, startPollingTask, globalAutoDownload, toast]
  );

  // 停止单个任务
  const handleStopTask = useCallback(async (taskId: string) => {
    // 添加到取消列表
    cancelledTasksRef.current.add(taskId);
    
    // 停止轮询
    stopPollingTask(taskId);

    // 调用取消 API
    try {
      await fetch(`/api/generate?taskId=${taskId}`, { method: "DELETE" });
    } catch (error) {
      console.error("Failed to cancel task:", error);
    }

    // 更新状态
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: "failed" as TaskStatus, error: "已取消" }
          : t
      )
    );

    toast({
      title: "任务已取消",
      description: "积分已退还",
    });
  }, [stopPollingTask, toast]);

  // 重试任务
  const handleRetryTask = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status !== "failed") return;

    // 从取消列表中移除
    cancelledTasksRef.current.delete(taskId);

    // 重置状态为草稿
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: "draft" as TaskStatus, error: undefined, progress: 0 }
          : t
      )
    );

    // 启动任务
    setTimeout(() => handleStartTask(taskId), 100);
  }, [tasks, handleStartTask]);

  // 复制任务
  const handleDuplicateTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const newTask: TaskData = {
        ...task,
        id: generateTaskId(),
        status: "draft",
        progress: undefined,
        error: undefined,
        outputUrl: undefined,
      };

      setTasks((prev) => {
        const index = prev.findIndex((t) => t.id === taskId);
        const newTasks = [...prev];
        newTasks.splice(index + 1, 0, newTask);
        return newTasks;
      });
    },
    [tasks]
  );

  // 删除任务
  const handleDeleteTask = useCallback((taskId: string) => {
    // 停止轮询
    stopPollingTask(taskId);
    // 添加到取消列表
    cancelledTasksRef.current.add(taskId);
    // 删除任务
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, [stopPollingTask]);

  // 清空任务 Prompt
  const handleClearPrompt = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, prompt: "" } : t))
    );
  }, []);

  // ================================================================
  // 批量操作函数
  // ================================================================

  // 应用第一个 Prompt 到所有任务
  const handleApplyFirstPrompt = useCallback(() => {
    const firstTask = tasks.find((t) => t.status === "draft" && t.prompt);
    if (!firstTask) return;

    setTasks((prev) =>
      prev.map((t) =>
        t.status === "draft" ? { ...t, prompt: firstTask.prompt } : t
      )
    );
    
    toast({
      title: "已应用提示词",
      description: "所有任务已使用第一个提示词",
    });
  }, [tasks, toast]);

  // 清空所有图片（删除所有草稿任务）
  const handleClearAllImages = useCallback(() => {
    // 停止所有轮询
    tasks.forEach((t) => {
      if (t.status === "draft") {
        stopPollingTask(t.id);
      }
    });
    setTasks((prev) => prev.filter((t) => t.status !== "draft"));
  }, [tasks, stopPollingTask]);

  // 清空所有 Prompts
  const handleClearAllPrompts = useCallback(() => {
    setTasks((prev) =>
      prev.map((t) => (t.status === "draft" ? { ...t, prompt: "" } : t))
    );
  }, []);

  // 停止所有任务
  const handleStopAllTasks = useCallback(() => {
    tasks
      .filter((t) => t.status === "processing" || t.status === "queued")
      .forEach((t) => handleStopTask(t.id));
  }, [tasks, handleStopTask]);

  // 批量生成（带并发控制）
  const handleBatchGenerate = useCallback(async () => {
    const draftTasks = tasks.filter((t) => t.status === "draft");
    if (draftTasks.length === 0) return;

    setIsBatchProcessing(true);
    
    toast({
      title: "批量生成已启动",
      description: `正在处理 ${draftTasks.length} 个任务（最多 ${MAX_CONCURRENCY} 个并发）`,
    });

    // 更新所有草稿为排队中
    setTasks((prev) =>
      prev.map((t) =>
        t.status === "draft" ? { ...t, status: "queued" as TaskStatus } : t
      )
    );

    // 并发控制执行
    const queue = [...draftTasks];
    const executing: Promise<void>[] = [];

    const runNext = async (): Promise<void> => {
      if (queue.length === 0) return;

      const task = queue.shift();
      if (!task) return;

      // 检查是否已取消
      if (cancelledTasksRef.current.has(task.id)) {
        if (queue.length > 0) await runNext();
        return;
      }

      try {
        // 调用 API
        const success = await callGenerateAPI(task);
        
        if (success) {
          // 开始轮询
          startPollingTask(task.id, globalAutoDownload);
        } else {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? { ...t, status: "failed" as TaskStatus, error: "API 调用失败" }
                : t
            )
          );
        }
      } catch (error) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, status: "failed" as TaskStatus, error: "生成失败" }
              : t
          )
        );
      }

      // 继续执行队列中的下一个任务
      if (queue.length > 0) {
        await runNext();
      }
    };

    // 启动初始批次（限制并发数）
    const initialBatch = Math.min(MAX_CONCURRENCY, queue.length);
    for (let i = 0; i < initialBatch; i++) {
      executing.push(runNext());
    }

    // 等待所有任务完成
    await Promise.all(executing);

    setIsBatchProcessing(false);
  }, [tasks, callGenerateAPI, startPollingTask, globalAutoDownload, toast]);

  // ================================================================
  // 渲染
  // ================================================================

  return (
    <TooltipProvider>
      <div className={cn("flex flex-col", className)}>
        {/* ============================================================ */}
        {/* 顶部工具栏 */}
        {/* ============================================================ */}
        <div
          className={cn(
            "flex items-center justify-between gap-4 p-4 rounded-t-2xl",
            "bg-gradient-to-r from-white/[0.02] to-white/[0.05]",
            "border border-b-0 border-white/10"
          )}
        >
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-tiktok-cyan" />
            <h3 className="font-semibold text-lg">任务备料台</h3>
            {stats.totalCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-white/10 text-xs font-medium">
                {stats.totalCount} 项
              </span>
            )}
          </div>

          {/* 批量操作按钮 */}
          <div className="flex items-center gap-2">
            {/* 添加演示任务 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddDemoTasks}
                  disabled={isProcessing || isBatchProcessing}
                  className="h-8 px-3 border-white/10 hover:bg-white/5"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  添加示例
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>添加 3 个演示任务</p>
              </TooltipContent>
            </Tooltip>

            {tasks.length > 0 && (
              <>
                {/* 应用第一个 Prompt */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleApplyFirstPrompt}
                      disabled={
                        isProcessing ||
                        isBatchProcessing ||
                        !tasks.some((t) => t.status === "draft" && t.prompt)
                      }
                      className="h-8 px-3 text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">应用首个提示词</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>将第一个任务的提示词复制给所有任务</p>
                  </TooltipContent>
                </Tooltip>

                {/* 清空所有 Prompts */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleClearAllPrompts}
                      disabled={isProcessing || isBatchProcessing}
                      className="h-8 px-3 text-muted-foreground hover:text-foreground"
                    >
                      <FileText className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">清空提示词</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>清空所有任务的提示词</p>
                  </TooltipContent>
                </Tooltip>

                {/* 清空所有图片 */}
                <AlertDialog>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isProcessing || isBatchProcessing}
                          className="h-8 px-3 text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          <span className="hidden sm:inline">清空全部</span>
                        </Button>
                      </AlertDialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>删除所有待处理任务</p>
                    </TooltipContent>
                  </Tooltip>
                  <AlertDialogContent className="bg-black/95 border-white/10">
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认清空所有任务？</AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作将删除所有待处理的任务，已完成和处理中的任务不受影响。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-white/10">取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleClearAllImages}
                        className="bg-red-500 hover:bg-red-600"
                      >
                        确认清空
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* 任务列表区域 */}
        {/* ============================================================ */}
        <div
          className={cn(
            "flex-1 min-h-[300px] max-h-[500px] overflow-y-auto",
            "bg-black/20 border-x border-white/10",
            "p-4 space-y-3"
          )}
        >
          {tasks.length === 0 ? (
            /* 空状态 */
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <div className="h-16 w-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <h4 className="text-lg font-medium text-muted-foreground mb-2">
                备料台为空
              </h4>
              <p className="text-sm text-muted-foreground/70 max-w-sm mb-4">
                上传图片或从素材库选择图片，它们将显示在这里等待处理
              </p>
              <Button
                variant="outline"
                onClick={handleAddDemoTasks}
                className="border-tiktok-cyan/50 text-tiktok-cyan hover:bg-tiktok-cyan/10"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                添加演示任务
              </Button>
            </div>
          ) : (
            /* 任务卡片列表 */
            <div className="space-y-3 pl-4">
              {tasks.map((task, index) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  index={index}
                  isProcessing={
                    task.status === "processing" || task.status === "queued"
                  }
                  onPromptChange={handlePromptChange}
                  onStart={handleStartTask}
                  onStop={handleStopTask}
                  onRetry={handleRetryTask}
                  onDuplicate={handleDuplicateTask}
                  onDelete={handleDeleteTask}
                  onClearPrompt={handleClearPrompt}
                  disabled={isProcessing || isBatchProcessing}
                />
              ))}
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* 底部固定栏 */}
        {/* ============================================================ */}
        <div
          className={cn(
            "flex items-center justify-between gap-4 p-4 rounded-b-2xl",
            "bg-gradient-to-r from-white/[0.03] to-white/[0.06]",
            "border border-t-0 border-white/10"
          )}
        >
          {/* 左侧：统计信息 */}
          <div className="flex items-center gap-4 text-sm">
            {/* 待处理数量 */}
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{stats.draftCount}</span>{" "}
                Tasks Waiting
              </span>
            </div>

            {/* 处理中 */}
            {stats.processingCount > 0 && (
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin text-tiktok-cyan" />
                <span className="text-muted-foreground">
                  <span className="font-semibold text-tiktok-cyan">
                    {stats.processingCount}
                  </span>{" "}
                  Processing
                </span>
              </div>
            )}

            {/* 已完成 */}
            {stats.completedCount > 0 && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <span className="text-muted-foreground">
                  <span className="font-semibold text-emerald-500">
                    {stats.completedCount}
                  </span>{" "}
                  Completed
                </span>
              </div>
            )}

            {/* 失败 */}
            {stats.failedCount > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3 w-3 text-red-500" />
                <span className="text-muted-foreground">
                  <span className="font-semibold text-red-500">{stats.failedCount}</span>{" "}
                  Failed
                </span>
              </div>
            )}
          </div>

          {/* 右侧：总价和批量生成按钮 */}
          <div className="flex items-center gap-4">
            {/* 总价显示 */}
            <div
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl",
                stats.insufficientCredits
                  ? "bg-red-500/10 border border-red-500/30"
                  : "bg-amber-500/10 border border-amber-500/30"
              )}
            >
              <Zap
                className={cn(
                  "h-4 w-4",
                  stats.insufficientCredits ? "text-red-500" : "text-amber-500"
                )}
              />
              <span className="text-sm text-muted-foreground">Total Cost:</span>
              <span
                className={cn(
                  "text-lg font-bold",
                  stats.insufficientCredits ? "text-red-400" : "text-amber-400"
                )}
              >
                {stats.totalCost}
              </span>
              <span className="text-xs text-muted-foreground">Credits</span>
            </div>

            {/* 积分不足提示 */}
            {stats.insufficientCredits && (
              <span className="text-xs text-red-400">
                积分不足 (余额: {userCredits})
              </span>
            )}

            {/* 停止所有按钮（处理中显示） */}
            {stats.processingCount > 0 && (
              <Button
                size="lg"
                variant="outline"
                onClick={handleStopAllTasks}
                className="px-4 border-red-500/50 text-red-400 hover:bg-red-500/10"
              >
                <StopCircle className="h-4 w-4 mr-2" />
                Stop All ({stats.processingCount})
              </Button>
            )}

            {/* 批量生成按钮 */}
            <Button
              size="lg"
              onClick={handleBatchGenerate}
              disabled={
                !stats.canGenerate ||
                isProcessing ||
                isBatchProcessing ||
                stats.draftCount === 0
              }
              className={cn(
                "px-6 font-semibold transition-all duration-300",
                stats.canGenerate && !isBatchProcessing
                  ? "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black shadow-[0_0_30px_rgba(0,242,234,0.3)] hover:shadow-[0_0_40px_rgba(0,242,234,0.4)]"
                  : "bg-white/10 text-muted-foreground"
              )}
            >
              {isBatchProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  批量生成中...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Generate All ({stats.draftCount})
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default TaskStagingWorkbench;

