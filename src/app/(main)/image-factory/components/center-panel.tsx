"use client";

/**
 * 中间面板 - 步骤流和任务控制
 */

import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Wand2,
  ImagePlus,
  Check,
  Loader2,
  AlertCircle,
  Play,
  Pause,
  RotateCcw,
  Edit3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  useImageFactoryStore,
  useSteps,
  useCanStartTask,
  useIsTaskInProgress,
  useModeSpecificConfig,
} from "@/stores/image-factory-store";
import { ECOM_MODE_CONFIG } from "@/types/ecom-image";
import { cn } from "@/lib/utils";

// 步骤图标
const STEP_ICONS = {
  1: Upload,
  2: Wand2,
  3: ImagePlus,
};

// 状态颜色
const STATUS_COLORS = {
  pending: "bg-white/5 text-muted-foreground border border-white/10",
  active: "bg-mermaid-cyan/20 text-mermaid-cyan border border-mermaid-cyan/50 animate-pulse shadow-[0_0_15px_rgba(0,255,255,0.3)]",
  completed: "bg-neon-green/20 text-neon-green border border-neon-green/50",
  failed: "bg-neon-red/20 text-neon-red border border-neon-red/50",
};

export function CenterPanel() {
  const {
    currentMode,
    uploadedImages,
    currentTask,
    setCurrentTask,
    updateCurrentTask,
    editablePrompts,
    setEditablePrompts,
    updateEditablePrompt,
    isCreatingTask,
    setIsCreatingTask,
    isGeneratingPrompts,
    setIsGeneratingPrompts,
    isGeneratingImages,
    setIsGeneratingImages,
    isPolling,
    setIsPolling,
    error,
    setError,
    isOneClick,
    modelType,
    language,
    ratio,
    resetTask,
  } = useImageFactoryStore();

  const steps = useSteps();
  const canStartTask = useCanStartTask();
  const isTaskInProgress = useIsTaskInProgress();
  const modeConfig = ECOM_MODE_CONFIG[currentMode];
  const modeSpecificConfig = useModeSpecificConfig();

  const [isEditingPrompts, setIsEditingPrompts] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // 1. 创建任务
  const handleCreateTask = async () => {
    if (uploadedImages.length === 0) {
      toast.error("请先上传图片");
      return;
    }

    setIsCreatingTask(true);
    setError(null);

    try {
      // 先上传图片到服务器
      const imageUrls: string[] = [];
      for (const image of uploadedImages) {
        if (image.file) {
          const formData = new FormData();
          formData.append("file", image.file);
          formData.append("folder", "ecom-images");

          const uploadRes = await fetch("/api/upload/image", {
            method: "POST",
            body: formData,
          });

          if (!uploadRes.ok) {
            throw new Error("图片上传失败");
          }

          const uploadData = await uploadRes.json();
          // API 返回格式: { success: true, data: { url: "...", path: "..." } }
          if (uploadData.data?.url) {
            imageUrls.push(uploadData.data.url);
          } else if (uploadData.url) {
            // 兼容旧格式
            imageUrls.push(uploadData.url);
          }
        } else if (image.url) {
          imageUrls.push(image.url);
        }
      }

      if (imageUrls.length === 0) {
        throw new Error("没有可用的图片");
      }

      // 创建任务
      const response = await fetch("/api/image-factory/create-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: currentMode,
          model_type: modelType,
          language,
          ratio,
          input_image_urls: imageUrls,
          mode_config: modeSpecificConfig,
          is_one_click: isOneClick,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "创建任务失败");
      }

      setCurrentTask(data.task);
      toast.success("任务创建成功");

      // 一键模式：自动进入下一步
      if (isOneClick) {
        if (modeConfig.needsPromptGeneration) {
          await handleGeneratePrompts(data.task.id);
        } else {
          await handleGenerateImages(data.task.id);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "创建任务失败";
      setError(message);
      toast.error(message);
    } finally {
      setIsCreatingTask(false);
    }
  };

  // 2. 生成提示词
  const handleGeneratePrompts = async (taskId?: string) => {
    const id = taskId || currentTask?.id;
    if (!id) return;

    setIsGeneratingPrompts(true);
    setError(null);

    try {
      const response = await fetch("/api/image-factory/generate-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: id }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "生成提示词失败");
      }

      // 保存提示词用于编辑
      setEditablePrompts(data.prompts);

      // 更新任务状态
      if (currentTask) {
        updateCurrentTask({
          prompts: { original: data.prompts, modified: data.prompts },
          status: "generating_images",
          current_step: 3,
        });
      }

      toast.success("提示词生成成功");

      // 一键模式：自动进入下一步
      if (isOneClick) {
        await handleGenerateImages(id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成提示词失败";
      setError(message);
      toast.error(message);
    } finally {
      setIsGeneratingPrompts(false);
    }
  };

  // 3. 生成图片
  const handleGenerateImages = async (taskId?: string) => {
    const id = taskId || currentTask?.id;
    if (!id) return;

    setIsGeneratingImages(true);
    setError(null);

    try {
      const response = await fetch("/api/image-factory/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: id,
          prompts: isEditingPrompts ? editablePrompts : undefined,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "生成图片失败");
      }

      toast.success(data.message || "图片生成任务已提交");

      // 开始轮询任务状态
      startPolling(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成图片失败";
      setError(message);
      toast.error(message);
    } finally {
      setIsGeneratingImages(false);
    }
  };

  // 轮询任务状态
  const startPolling = (taskId: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    setIsPolling(true);

    const poll = async () => {
      try {
        const response = await fetch(`/api/image-factory/task/${taskId}`);
        const data = await response.json();

        if (data.success && data.task) {
          setCurrentTask(data.task);

          // 检查是否完成
          if (["success", "partial_success", "failed"].includes(data.task.status)) {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            setIsPolling(false);

            if (data.task.status === "success") {
              toast.success("所有图片生成完成！");
            } else if (data.task.status === "partial_success") {
              toast.warning("部分图片生成完成");
            } else {
              toast.error("图片生成失败");
            }
          }
        }
      } catch (err) {
        console.error("[Polling] Error:", err);
      }
    };

    // 立即执行一次
    poll();

    // 每 3 秒轮询一次
    pollingRef.current = setInterval(poll, 3000);
  };

  // 重新开始
  const handleReset = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    resetTask();
    setIsEditingPrompts(false);
    toast.info("已重置任务");
  };

  // 计算进度
  const getProgress = () => {
    if (!currentTask?.output_items) return 0;
    const items = currentTask.output_items as Array<{ status: string }>;
    const completed = items.filter(item => item.status === "completed").length;
    return items.length > 0 ? Math.round((completed / items.length) * 100) : 0;
  };

  return (
    <div className="flex flex-col h-full bg-[#16181D]/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
      {/* 标题 */}
      <div className="p-3 border-b border-white/5 flex items-center justify-between bg-white/5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-mermaid-cyan/70" />
          <span className="font-bold text-white tracking-wide text-xs">工作流水线</span>
        </div>
        {currentTask && (
          <Button variant="ghost" size="sm" onClick={handleReset} className="text-white/40 hover:text-white hover:bg-white/10 text-xs h-7 px-2">
            <RotateCcw className="h-3 w-3 mr-1" />
            RESET
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-6">
          {/* 步骤流 */}
          <div className="relative space-y-5">
            {/* 连线背景 */}
            <div className="absolute left-5 top-4 bottom-4 w-0.5 bg-gradient-to-b from-white/10 via-white/5 to-transparent -z-10" />

            {steps.map((step, index) => {
              const Icon = STEP_ICONS[step.id as keyof typeof STEP_ICONS] || Upload;
              const isActive = step.status === "active";
              const isCompleted = step.status === "completed";
              const isFailed = step.status === "failed";

              return (
                <div key={step.id} className="relative group">
                  <div className="flex items-start gap-4">
                    {/* 图标 */}
                    <div
                      className={cn(
                        "relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 border transition-all duration-500 z-10 bg-[#0B0C10]",
                        isActive
                          ? "border-mermaid-cyan text-mermaid-cyan shadow-[0_0_20px_rgba(0,242,234,0.3)] scale-110"
                          : isCompleted
                            ? "border-neon-green text-neon-green bg-neon-green/10"
                            : isFailed
                              ? "border-neon-red text-neon-red"
                              : "border-white/10 text-white/30 group-hover:border-white/20 group-hover:text-white/50"
                      )}
                    >
                      {isActive && <div className="absolute inset-0 rounded-full bg-mermaid-cyan/20 animate-ping" />}
                      {isActive ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isCompleted ? (
                        <Check className="h-4 w-4" />
                      ) : isFailed ? (
                        <AlertCircle className="h-4 w-4" />
                      ) : (
                        <Icon className="h-4 w-4" />
                      )}
                    </div>

                    {/* 内容 */}
                    <div className={cn("flex-1 min-w-0 pt-2 transition-all duration-300", isActive ? "opacity-100 translate-x-1" : "opacity-60")}>
                      <div className="flex items-center gap-3">
                        <span className={cn("font-bold text-sm tracking-wide", isActive ? "text-white" : "text-white/70")}>{step.title}</span>
                        {isActive && (
                          <Badge variant="outline" className="border-mermaid-cyan/20 text-mermaid-cyan bg-mermaid-cyan/10 text-[10px] px-1.5 py-0 animate-pulse">PROCESSING</Badge>
                        )}
                        {isFailed && (
                          <Badge variant="destructive" className="text-[10px]">FAILED</Badge>
                        )}
                      </div>
                      <p className="text-xs text-white/40 mt-1 font-medium">
                        {step.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 提示词编辑区域 - Obsidian Glass */}
          {currentTask &&
            modeConfig.needsPromptGeneration &&
            !isOneClick &&
            currentTask.status === "generating_images" &&
            Object.keys(editablePrompts).length > 0 && (
              <div className="space-y-4 pt-6 border-t border-white/5 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-white/50 uppercase tracking-wider">Refine Prompts</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditingPrompts(!isEditingPrompts)}
                    className="text-mermaid-cyan hover:text-mermaid-cyan hover:bg-mermaid-cyan/10 text-xs"
                  >
                    <Edit3 className="h-3 w-3 mr-1" />
                    {isEditingPrompts ? "CANCEL" : "EDIT"}
                  </Button>
                </div>

                {Object.entries(editablePrompts).map(([key, value]) => (
                  <div key={key} className="space-y-2">
                    <Label className="text-[10px] font-mono text-white/30 uppercase pl-1">
                      {key} Prompt
                    </Label>
                    <div className="relative group">
                      <div className="absolute -inset-0.5 bg-gradient-to-r from-mermaid-cyan/20 to-mermaid-pink/20 rounded-xl opacity-0 group-hover:opacity-100 transition duration-500 blur" />
                      <Textarea
                        value={value}
                        onChange={(e) => updateEditablePrompt(key, e.target.value)}
                        disabled={!isEditingPrompts}
                        className="relative min-h-[100px] text-sm bg-[#050505] border-white/10 text-white rounded-xl resize-none focus:border-mermaid-cyan/50 focus:ring-1 focus:ring-mermaid-cyan/20 transition-all"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

          {/* 进度显示 - Neon Gradient */}
          {isPolling && currentTask && (
            <div className="space-y-3 pt-6 border-t border-white/5 animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="text-mermaid-cyan animate-pulse font-bold">GENERATING ASSETS...</span>
                <span className="font-mono text-white/60">{getProgress()}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-mermaid-lime via-mermaid-cyan to-mermaid-pink transition-all duration-300 shadow-[0_0_10px_rgba(0,242,234,0.5)]"
                  style={{ width: `${getProgress()}%` }}
                />
              </div>
            </div>
          )}

          {/* 错误显示 */}
          {error && (
            <div className="p-4 rounded-xl bg-neon-red/5 border border-neon-red/20 backdrop-blur-md flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-neon-red shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-neon-red text-sm">System Error</p>
                <p className="text-xs text-white/60 mt-1">{error}</p>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 底部：操作按钮 - Mermaid Ultra */}
      <div className="p-4 border-t border-white/5 bg-[#0B0C10]/50 backdrop-blur-md">
        {!currentTask ? (
          // 开始任务
          <button
            onClick={handleCreateTask}
            disabled={!canStartTask || isCreatingTask}
            className="group relative w-full py-3 rounded-xl font-bold text-black text-xs tracking-wide transition-all duration-300 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(0,242,234,0.4)] border border-white/20 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent pointer-events-none" />
            <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] translate-x-[-100%] group-hover:animate-shimmer transition-opacity duration-300 pointer-events-none" />
            <span className="relative z-10 flex items-center justify-center gap-2">
              {isCreatingTask ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> INITIALIZING...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 fill-black/20" />
                  {isOneClick ? "一键生成" : "开始生成"}
                </>
              )}
            </span>
          </button>
        ) : currentTask.status === "created" && modeConfig.needsPromptGeneration && !isOneClick ? (
          // 手动模式：生成提示词
          <button
            onClick={() => handleGeneratePrompts()}
            disabled={isGeneratingPrompts}
            className="group relative w-full py-4 rounded-xl font-bold text-black text-sm tracking-wide transition-all duration-300 bg-gradient-to-r from-mermaid-cyan to-mermaid-lime hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.3)] border border-white/20 overflow-hidden disabled:opacity-50"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {isGeneratingPrompts ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> GENERATING PROMPTS...
                </>
              ) : (
                <>
                  <Edit3 className="h-4 w-4" /> GENERATE PROMPTS
                </>
              )}
            </span>
          </button>
        ) : currentTask.status === "generating_images" && !isPolling && !isGeneratingImages ? (
          // 手动模式：生成图片
          <button
            onClick={() => handleGenerateImages()}
            disabled={isGeneratingImages}
            className="group relative w-full py-4 rounded-xl font-bold text-black text-sm tracking-wide transition-all duration-300 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(0,242,234,0.4)] border border-white/20 overflow-hidden disabled:opacity-50"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent pointer-events-none" />
            <span className="relative z-10 flex items-center justify-center gap-2">
              {isGeneratingImages ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> SUBMITTING...
                </>
              ) : (
                <>
                  <ImagePlus className="h-4 w-4" /> GENERATE FINAL IMAGES
                </>
              )}
            </span>
          </button>
        ) : isPolling ? (
          // 生成中
          <button disabled className="w-full py-4 rounded-xl font-bold text-white/50 bg-[#0B0C10] border border-white/10 flex items-center justify-center gap-2 cursor-wait">
            <Loader2 className="h-4 w-4 animate-spin text-mermaid-cyan" /> PROCESSING...
          </button>
        ) : ["success", "partial_success", "failed"].includes(currentTask?.status || "") ? (
          // 完成
          <Button
            className="w-full py-6 rounded-xl font-bold border-white/10 hover:bg-white/5 hover:text-white"
            variant="outline"
            onClick={handleReset}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            START NEW TASK
          </Button>
        ) : null}
      </div>
    </div>
  );
}
