"use client";

/**
 * 后台任务管理器
 * 
 * 功能：
 * 1. 在后台持续执行视频批量生成和图片批量处理任务
 * 2. 在后台持续执行 Quick Generator 视频和图片任务
 * 3. 任务完成时显示全局通知
 * 4. 页面切换不影响任务执行
 */

import { useEffect, useRef, useCallback } from "react";
import { useVideoBatchStore } from "@/stores/video-batch-store";
import { useImageBatchStore } from "@/stores/image-batch-store";
import { useQuickGenStore } from "@/stores/quick-gen-store";
import { useToast } from "@/hooks/use-toast";
import { Video, Image as ImageIcon, Sparkles, Palette } from "lucide-react";

// ============================================================================
// 视频任务执行器
// ============================================================================

function useVideoTaskExecutor() {
  const { toast } = useToast();
  const tasks = useVideoBatchStore((state) => state.tasks);
  const jobStatus = useVideoBatchStore((state) => state.jobStatus);
  const globalSettings = useVideoBatchStore((state) => state.globalSettings);
  const updateTaskStatus = useVideoBatchStore((state) => state.updateTaskStatus);
  const setJobStatus = useVideoBatchStore((state) => state.setJobStatus);
  
  const isExecutingRef = useRef(false);
  const executedTasksRef = useRef<Set<string>>(new Set());

  // 执行单个视频任务
  const executeVideoTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status !== "pending") return;

    try {
      // 上传图片
      updateTaskStatus(taskId, "uploading", 1, 10);
      
      const uploadedUrls: string[] = [];
      for (const img of task.images) {
        if (img.file) {
          const formData = new FormData();
          formData.append("file", img.file);
          formData.append("folder", "video-batch");
          
          const uploadRes = await fetch("/api/upload/image", {
            method: "POST",
            body: formData,
          });
          const uploadData = await uploadRes.json();
          
          if (!uploadData.success) {
            throw new Error(uploadData.error || "图片上传失败");
          }
          uploadedUrls.push(uploadData.url);
        } else if (img.url) {
          uploadedUrls.push(img.url);
        }
      }

      if (uploadedUrls.length === 0) {
        throw new Error("没有可用的图片");
      }

      // 转换图片为 Base64
      const imageBase64List: string[] = [];
      for (const url of uploadedUrls) {
        try {
          const response = await fetch(url);
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          imageBase64List.push(base64);
        } catch (err) {
          console.error("转换图片失败:", err);
          imageBase64List.push(url);
        }
      }

      // 生成脚本
      updateTaskStatus(taskId, "generating_script", 2, 30);
      
      const scriptRes = await fetch("/api/video-batch/generate-talking-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: imageBase64List,
          taskId: taskId,
          language: globalSettings.language,
        }),
      });
      
      const scriptResult = await scriptRes.json();
      if (!scriptResult.success) {
        throw new Error(scriptResult.error || "脚本生成失败");
      }

      updateTaskStatus(taskId, "generating_script", 2, 50, scriptResult.data.script);

      // 生成提示词
      updateTaskStatus(taskId, "generating_prompt", 3, 60);
      
      const promptRes = await fetch("/api/video-batch/generate-ai-video-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          talkingScript: scriptResult.data.script,
          taskId: taskId,
          modelTriggerWord: globalSettings.useAiModel ? globalSettings.aiModelTriggerWord : undefined,
        }),
      });
      
      const promptResult = await promptRes.json();
      if (!promptResult.success) {
        throw new Error(promptResult.error || "提示词生成失败");
      }

      // 最终提示词（包含 AI 模特触发词）
      let finalVideoPrompt = promptResult.data.prompt;
      if (globalSettings.useAiModel && globalSettings.aiModelTriggerWord && !finalVideoPrompt.includes(globalSettings.aiModelTriggerWord)) {
        finalVideoPrompt = `[AI MODEL: ${globalSettings.aiModelTriggerWord}]\n\n${finalVideoPrompt}`;
      }

      updateTaskStatus(taskId, "generating_prompt", 3, 75, undefined, finalVideoPrompt);

      // 生成视频
      updateTaskStatus(taskId, "generating_video", 4, 80);
      
      const mainGridImageUrl = uploadedUrls[0];
      const videoRes = await fetch("/api/video-batch/generate-sora-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiVideoPrompt: finalVideoPrompt,
          mainGridImageUrl: mainGridImageUrl,
          aspectRatio: globalSettings.aspectRatio,
          durationSeconds: globalSettings.duration,
          quality: globalSettings.quality,
          modelType: globalSettings.modelType,
          taskId: taskId,
        }),
      });
      
      const videoResult = await videoRes.json();
      if (!videoResult.success) {
        throw new Error(videoResult.error || "视频生成失败");
      }

      // 任务成功
      updateTaskStatus(
        taskId,
        "success",
        5,
        100,
        undefined,
        undefined,
        videoResult.data.soraTaskId,
        videoResult.data.videoUrl
      );

      // 显示成功通知
      toast({
        title: "🎉 视频生成完成",
        description: "批量视频任务已完成，点击查看",
        action: (
          <a href="/pro-studio/video-batch" className="text-tiktok-cyan hover:underline">
            查看
          </a>
        ),
      });

    } catch (error) {
      console.error("[VideoTask] Error:", error);
      updateTaskStatus(
        taskId,
        "failed",
        task.currentStep,
        task.progress,
        undefined,
        undefined,
        undefined,
        undefined,
        error instanceof Error ? error.message : "任务执行失败"
      );
    }
  }, [tasks, globalSettings, updateTaskStatus, toast]);

  // 监听并执行任务
  useEffect(() => {
    if (jobStatus !== "running" || isExecutingRef.current) return;

    const pendingTasks = tasks.filter(
      t => t.status === "pending" && !executedTasksRef.current.has(t.id)
    );

    if (pendingTasks.length === 0) {
      // 检查是否所有任务都完成
      const hasRunningTasks = tasks.some(
        t => t.status !== "pending" && t.status !== "success" && t.status !== "failed"
      );
      if (!hasRunningTasks && tasks.length > 0) {
        setJobStatus("completed");
        
        const successCount = tasks.filter(t => t.status === "success").length;
        const failedCount = tasks.filter(t => t.status === "failed").length;
        
        if (successCount > 0 || failedCount > 0) {
          toast({
            title: "📹 批量视频任务完成",
            description: `成功: ${successCount}, 失败: ${failedCount}`,
          });
        }
      }
      return;
    }

    // 顺序执行任务
    const executeNext = async () => {
      isExecutingRef.current = true;
      
      for (const task of pendingTasks) {
        if (executedTasksRef.current.has(task.id)) continue;
        executedTasksRef.current.add(task.id);
        
        await executeVideoTask(task.id);
        
        // 任务间延迟
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      isExecutingRef.current = false;
    };

    executeNext();
  }, [jobStatus, tasks, executeVideoTask, setJobStatus, toast]);

  // 重置执行状态
  useEffect(() => {
    if (jobStatus === "idle") {
      executedTasksRef.current.clear();
      isExecutingRef.current = false;
    }
  }, [jobStatus]);
}

// ============================================================================
// 图片任务执行器
// ============================================================================

function useImageTaskExecutor() {
  const { toast } = useToast();
  const tasks = useImageBatchStore((state) => state.tasks);
  const jobStatus = useImageBatchStore((state) => state.jobStatus);
  const globalSettings = useImageBatchStore((state) => state.globalSettings);
  const updateTaskResult = useImageBatchStore((state) => state.updateTaskResult);
  const setJobStatus = useImageBatchStore((state) => state.setJobStatus);
  
  const isExecutingRef = useRef(false);
  const executedTasksRef = useRef<Set<string>>(new Set());

  // 执行单个图片任务
  const executeImageTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status !== "pending") return;

    try {
      updateTaskResult(taskId, { status: "processing" });

      // 上传图片（如果是 blob URL）
      let remoteImageUrl = task.config.sourceImageUrl;
      if (task.config.sourceImageUrl.startsWith("blob:")) {
        try {
          const blobResponse = await fetch(task.config.sourceImageUrl);
          const blob = await blobResponse.blob();
          const formData = new FormData();
          formData.append("file", blob, task.config.sourceImageName);

          const uploadResponse = await fetch("/api/upload/image", {
            method: "POST",
            body: formData,
          });
          const uploadResult = await uploadResponse.json();

          if (uploadResult.success && uploadResult.data?.url) {
            remoteImageUrl = uploadResult.data.url;
          } else {
            throw new Error("图片上传失败");
          }
        } catch (uploadError) {
          throw new Error("图片上传失败: " + (uploadError instanceof Error ? uploadError.message : "未知错误"));
        }
      }

      // 调用 API - 使用正确的参数格式
      const response = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: task.config.action,  // "generate" | "upscale" | "nine_grid"
          model: task.config.model,
          sourceImageUrl: remoteImageUrl,
          aspectRatio: task.config.aspectRatio,
          resolution: task.config.resolution,
          prompt: task.config.action === "generate" ? (task.config.prompt || "High quality product photo") : undefined,
        }),
      });

      const result = await response.json();

      if (result.success && result.data?.taskId) {
        const apiTaskId = result.data.taskId;
        const taskModel = result.data.model;
        
        updateTaskResult(taskId, { apiTaskId });

        // 轮询等待结果
        const maxAttempts = 60;
        let attempts = 0;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;

          const statusRes = await fetch(`/api/generate/image?taskId=${apiTaskId}&model=${taskModel}`);
          const statusData = await statusRes.json();

          if (statusData.success && statusData.data) {
            if (statusData.data.status === "completed" && statusData.data.imageUrl) {
              updateTaskResult(taskId, {
                status: "completed",
                resultUrl: statusData.data.imageUrl,
              });
              return;
            } else if (statusData.data.status === "failed") {
              throw new Error(statusData.data.errorMessage || "图片生成失败");
            }
          }
        }

        throw new Error("任务超时");
      } else {
        throw new Error(result.error || "提交任务失败");
      }
    } catch (error) {
      console.error("[ImageTask] Error:", error);
      updateTaskResult(taskId, {
        status: "failed",
        error: error instanceof Error ? error.message : "任务执行失败",
      });
    }
  }, [tasks, updateTaskResult]);

  // 监听并执行任务
  useEffect(() => {
    if (jobStatus !== "running" || isExecutingRef.current) return;

    const pendingTasks = tasks.filter(
      t => t.status === "pending" && !executedTasksRef.current.has(t.id)
    );

    if (pendingTasks.length === 0) {
      const hasProcessingTasks = tasks.some(t => t.status === "processing");
      if (!hasProcessingTasks && tasks.length > 0) {
        setJobStatus("completed");
        
        const successCount = tasks.filter(t => t.status === "completed").length;
        const failedCount = tasks.filter(t => t.status === "failed").length;
        
        if (successCount > 0 || failedCount > 0) {
          toast({
            title: "🖼️ 批量图片任务完成",
            description: `成功: ${successCount}, 失败: ${failedCount}`,
          });
        }
      }
      return;
    }

    // 并发执行图片任务
    const executeAll = async () => {
      isExecutingRef.current = true;

      await Promise.all(
        pendingTasks.map(async (task) => {
          if (executedTasksRef.current.has(task.id)) return;
          executedTasksRef.current.add(task.id);
          await executeImageTask(task.id);
        })
      );

      isExecutingRef.current = false;
    };

    executeAll();
  }, [jobStatus, tasks, executeImageTask, setJobStatus, toast]);

  // 重置执行状态
  useEffect(() => {
    if (jobStatus === "idle") {
      executedTasksRef.current.clear();
      isExecutingRef.current = false;
    }
  }, [jobStatus]);
}

// ============================================================================
// Quick Gen 视频任务执行器
// ============================================================================

function useQuickGenTaskExecutor() {
  const { toast } = useToast();
  const activeTask = useQuickGenStore((state) => state.activeVideoTask);
  const updateTaskStatus = useQuickGenStore((state) => state.updateTaskStatus);
  
  const isExecutingRef = useRef(false);
  const executedTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeTask) return;
    if (isExecutingRef.current) return;
    if (executedTaskIdRef.current === activeTask.id) return;
    
    const needsExecution = activeTask.status === "idle" || activeTask.status === "polling";
    if (!needsExecution) return;

    const executeTask = async () => {
      isExecutingRef.current = true;
      executedTaskIdRef.current = activeTask.id;

      try {
        if (activeTask.status === "idle") {
          // 新任务，调用 API
          updateTaskStatus(activeTask.id, "generating", { progress: 10 });

          const response = await fetch("/api/generate/video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: activeTask.prompt,
              duration: activeTask.duration,
              aspectRatio: activeTask.aspectRatio,
              quality: activeTask.quality,
              apiModel: activeTask.apiModel,
              modelId: activeTask.modelId,
              sourceImageUrl: activeTask.sourceImageUrl,
            }),
          });

          const result = await response.json();
          if (!result.success) throw new Error(result.error || "提交失败");

          updateTaskStatus(activeTask.id, "polling", { 
            progress: 20, taskId: result.data.taskId, creditsDeducted: true 
          });
        }

        // 轮询查询结果
        const state = useQuickGenStore.getState();
        const task = state.activeVideoTask;
        if (!task || !task.taskId) return;

        const usePro = task.quality === "hd" || task.duration === 25;
        const maxAttempts = usePro ? 120 : 40;
        
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise(r => setTimeout(r, 10000));
          updateTaskStatus(task.id, "polling", { progress: Math.min(20 + i * 2, 90) });

          const statusRes = await fetch(`/api/generate/video?taskId=${task.taskId}&usePro=${usePro}`);
          const statusData = await statusRes.json();

          if (statusData.success && statusData.data) {
            if (statusData.data.status === "completed" && statusData.data.videoUrl) {
              updateTaskStatus(task.id, "completed", {
                progress: 100, resultUrl: statusData.data.videoUrl, completedAt: new Date().toISOString()
              });
              toast({ title: "🎉 快速视频生成完成", description: "点击查看结果" });
              return;
            } else if (statusData.data.status === "failed") {
              throw new Error(statusData.data.errorMessage || "生成失败");
            }
          }
        }
        throw new Error("任务超时");
      } catch (error) {
        updateTaskStatus(activeTask.id, "failed", {
          errorMessage: error instanceof Error ? error.message : "执行失败",
          completedAt: new Date().toISOString()
        });
        toast({ variant: "destructive", title: "❌ 快速视频生成失败", description: error instanceof Error ? error.message : "未知错误" });
      } finally {
        isExecutingRef.current = false;
      }
    };

    executeTask();
  }, [activeTask, updateTaskStatus, toast]);

  useEffect(() => {
    if (!activeTask || ["completed", "failed"].includes(activeTask.status)) {
      executedTaskIdRef.current = null;
      isExecutingRef.current = false;
    }
  }, [activeTask]);
}

// ============================================================================
// Quick Gen 图片任务执行器
// ============================================================================

function useQuickGenImageTaskExecutor() {
  const { toast } = useToast();
  const activeTask = useQuickGenStore((state) => state.activeImageTask);
  const updateTaskStatus = useQuickGenStore((state) => state.updateImageTaskStatus);
  
  const isExecutingRef = useRef(false);
  const executedTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeTask) return;
    if (isExecutingRef.current) return;
    if (executedTaskIdRef.current === activeTask.id) return;
    
    const needsExecution = activeTask.status === "idle" || activeTask.status === "polling";
    if (!needsExecution) return;

    const executeTask = async () => {
      isExecutingRef.current = true;
      executedTaskIdRef.current = activeTask.id;

      try {
        if (activeTask.status === "idle") {
          updateTaskStatus(activeTask.id, "generating", { progress: 10 });

          // 调用图片生成 API
          const response = await fetch("/api/generate/image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "generate",
              model: activeTask.model,
              prompt: activeTask.prompt,
              sourceImageUrl: activeTask.sourceImageUrls.length > 0 ? activeTask.sourceImageUrls : undefined,
              tier: activeTask.tier,
              aspectRatio: activeTask.aspectRatio,
              resolution: activeTask.resolution,
            }),
          });

          const result = await response.json();
          if (!result.success) throw new Error(result.error || "提交失败");

          updateTaskStatus(activeTask.id, "polling", { 
            progress: 20, taskId: result.data.taskId, creditsDeducted: true 
          });
        }

        // 轮询查询结果
        const state = useQuickGenStore.getState();
        const task = state.activeImageTask;
        if (!task || !task.taskId) return;

        const maxAttempts = 60;
        
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise(r => setTimeout(r, 3000));
          updateTaskStatus(task.id, "polling", { progress: Math.min(20 + i * 2, 90) });

          const statusRes = await fetch(`/api/generate/image?taskId=${task.taskId}&model=${task.model}`);
          const statusData = await statusRes.json();

          if (statusData.success && statusData.data) {
            if (statusData.data.status === "completed" && statusData.data.imageUrl) {
              updateTaskStatus(task.id, "completed", {
                progress: 100, resultUrl: statusData.data.imageUrl, completedAt: new Date().toISOString()
              });
              toast({ title: "🎉 快速图片生成完成", description: "点击查看结果" });
              return;
            } else if (statusData.data.status === "failed") {
              throw new Error(statusData.data.errorMessage || "生成失败");
            }
          }
        }
        throw new Error("任务超时");
      } catch (error) {
        updateTaskStatus(activeTask.id, "failed", {
          errorMessage: error instanceof Error ? error.message : "执行失败",
          completedAt: new Date().toISOString()
        });
        toast({ variant: "destructive", title: "❌ 快速图片生成失败", description: error instanceof Error ? error.message : "未知错误" });
      } finally {
        isExecutingRef.current = false;
      }
    };

    executeTask();
  }, [activeTask, updateTaskStatus, toast]);

  useEffect(() => {
    if (!activeTask || ["completed", "failed"].includes(activeTask.status)) {
      executedTaskIdRef.current = null;
      isExecutingRef.current = false;
    }
  }, [activeTask]);
}

// ============================================================================
// 任务状态指示器组件 - 右下角悬浮通知
// ============================================================================

function TaskStatusIndicator() {
  const videoTasks = useVideoBatchStore((state) => state.tasks);
  const videoJobStatus = useVideoBatchStore((state) => state.jobStatus);
  const imageTasks = useImageBatchStore((state) => state.tasks);
  const imageJobStatus = useImageBatchStore((state) => state.jobStatus);
  const quickGenTask = useQuickGenStore((state) => state.activeVideoTask);
  const quickGenImageTask = useQuickGenStore((state) => state.activeImageTask);

  const runningVideoTasks = videoTasks.filter(
    t => t.status !== "pending" && t.status !== "success" && t.status !== "failed"
  ).length;
  
  const runningImageTasks = imageTasks.filter(t => t.status === "processing").length;
  
  const isQuickGenRunning = quickGenTask && !["completed", "failed", "idle"].includes(quickGenTask.status);
  const isQuickGenImageRunning = quickGenImageTask && !["completed", "failed", "idle"].includes(quickGenImageTask.status);

  const hasRunningTasks = videoJobStatus === "running" || imageJobStatus === "running" || 
                          runningVideoTasks > 0 || runningImageTasks > 0 || isQuickGenRunning || isQuickGenImageRunning;

  if (!hasRunningTasks) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 animate-in slide-in-from-right-5 fade-in duration-300">
      {/* 快速图片生成 */}
      {isQuickGenImageRunning && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 backdrop-blur-xl border border-violet-500/30 rounded-xl px-4 py-3 shadow-xl shadow-violet-500/10 hover:scale-[1.02] transition-transform cursor-pointer">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-violet-500/20">
            <Palette className="h-5 w-5 text-violet-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-violet-400 rounded-full animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-violet-400 rounded-full" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-violet-100">快速图片生成中</span>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-24 h-1.5 bg-violet-900/30 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-400 rounded-full transition-all duration-500"
                  style={{ width: `${quickGenImageTask?.progress || 0}%` }}
                />
              </div>
              <span className="text-xs text-violet-400/80">{quickGenImageTask?.progress || 0}%</span>
            </div>
          </div>
        </div>
      )}

      {/* 快速视频生成 */}
      {isQuickGenRunning && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 backdrop-blur-xl border border-amber-500/30 rounded-xl px-4 py-3 shadow-xl shadow-amber-500/10 hover:scale-[1.02] transition-transform cursor-pointer">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500/20">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-amber-400 rounded-full animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-amber-400 rounded-full" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-amber-100">快速视频生成中</span>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-24 h-1.5 bg-amber-900/30 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all duration-500"
                  style={{ width: `${quickGenTask?.progress || 0}%` }}
                />
              </div>
              <span className="text-xs text-amber-400/80">{quickGenTask?.progress || 0}%</span>
            </div>
          </div>
        </div>
      )}

      {/* 批量视频生成 */}
      {(videoJobStatus === "running" || runningVideoTasks > 0) && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 backdrop-blur-xl border border-cyan-500/30 rounded-xl px-4 py-3 shadow-xl shadow-cyan-500/10 hover:scale-[1.02] transition-transform cursor-pointer">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-500/20">
            <Video className="h-5 w-5 text-cyan-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-cyan-400 rounded-full animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-cyan-400 rounded-full" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-cyan-100">批量视频生成中</span>
            <span className="text-xs text-cyan-400/80 mt-0.5">
              {runningVideoTasks > 0 ? runningVideoTasks : videoTasks.filter(t => t.status === "pending").length} 个任务处理中
            </span>
          </div>
        </div>
      )}
      
      {/* 批量图片处理 */}
      {(imageJobStatus === "running" || runningImageTasks > 0) && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-pink-500/10 to-purple-500/10 backdrop-blur-xl border border-pink-500/30 rounded-xl px-4 py-3 shadow-xl shadow-pink-500/10 hover:scale-[1.02] transition-transform cursor-pointer">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-pink-500/20">
            <ImageIcon className="h-5 w-5 text-pink-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-pink-400 rounded-full animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-pink-400 rounded-full" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-pink-100">批量图片处理中</span>
            <span className="text-xs text-pink-400/80 mt-0.5">
              {runningImageTasks} 个任务处理中
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export function BackgroundTaskManager() {
  // 启动视频批量任务执行器
  useVideoTaskExecutor();
  
  // 启动图片批量任务执行器
  useImageTaskExecutor();
  
  // 启动 Quick Gen 视频任务执行器
  useQuickGenTaskExecutor();
  
  // 启动 Quick Gen 图片任务执行器
  useQuickGenImageTaskExecutor();

  return <TaskStatusIndicator />;
}

