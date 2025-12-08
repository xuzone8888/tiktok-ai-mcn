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
  pending: "bg-muted text-muted-foreground",
  active: "bg-primary text-primary-foreground animate-pulse",
  completed: "bg-green-500 text-white",
  failed: "bg-red-500 text-white",
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
    resolution,
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
          resolution: modelType === "nano-banana-pro" ? resolution : undefined,
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
    <div className="flex flex-col h-full">
      {/* 标题 */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">生成流程</span>
        </div>
        {currentTask && (
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-1" />
            重新开始
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* 步骤流 */}
          <div className="space-y-4">
            {steps.map((step, index) => {
              const Icon = STEP_ICONS[step.id as keyof typeof STEP_ICONS] || Upload;
              const isActive = step.status === "active";
              const isCompleted = step.status === "completed";
              const isFailed = step.status === "failed";

              return (
                <div key={step.id} className="relative">
                  {/* 连接线 */}
                  {index < steps.length - 1 && (
                    <div
                      className={cn(
                        "absolute left-5 top-10 w-0.5 h-8",
                        isCompleted ? "bg-green-500" : "bg-muted"
                      )}
                    />
                  )}

                  <div className="flex items-start gap-4">
                    {/* 图标 */}
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                        STATUS_COLORS[step.status]
                      )}
                    >
                      {isActive ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : isCompleted ? (
                        <Check className="h-5 w-5" />
                      ) : isFailed ? (
                        <AlertCircle className="h-5 w-5" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </div>

                    {/* 内容 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{step.title}</span>
                        {isFailed && (
                          <Badge variant="destructive" className="text-xs">
                            失败
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {step.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 提示词编辑区域 */}
          {currentTask && 
           modeConfig.needsPromptGeneration && 
           !isOneClick &&
           currentTask.status === "generating_images" &&
           Object.keys(editablePrompts).length > 0 && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <Label>编辑提示词</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingPrompts(!isEditingPrompts)}
                >
                  <Edit3 className="h-4 w-4 mr-1" />
                  {isEditingPrompts ? "取消编辑" : "编辑"}
                </Button>
              </div>

              {Object.entries(editablePrompts).map(([key, value]) => (
                <div key={key} className="space-y-2">
                  <Label className="text-xs text-muted-foreground capitalize">
                    {key}
                  </Label>
                  <Textarea
                    value={value}
                    onChange={(e) => updateEditablePrompt(key, e.target.value)}
                    disabled={!isEditingPrompts}
                    className="min-h-[80px] text-sm"
                  />
                </div>
              ))}
            </div>
          )}

          {/* 进度显示 */}
          {isPolling && currentTask && (
            <div className="space-y-2 pt-4 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">生成进度</span>
                <span className="font-medium">{getProgress()}%</span>
              </div>
              <Progress value={getProgress()} className="h-2" />
            </div>
          )}

          {/* 错误显示 */}
          {error && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-500">出错了</p>
                  <p className="text-sm text-muted-foreground mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 底部：操作按钮 */}
      <div className="p-4 border-t space-y-3">
        {!currentTask ? (
          // 开始任务
          <Button
            className="w-full"
            size="lg"
            onClick={handleCreateTask}
            disabled={!canStartTask || isCreatingTask}
          >
            {isCreatingTask ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                创建任务中...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                {isOneClick ? "一键生成" : "开始任务"}
              </>
            )}
          </Button>
        ) : currentTask.status === "created" && modeConfig.needsPromptGeneration && !isOneClick ? (
          // 手动模式：生成提示词
          <Button
            className="w-full"
            size="lg"
            onClick={() => handleGeneratePrompts()}
            disabled={isGeneratingPrompts}
          >
            {isGeneratingPrompts ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                生成提示词中...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                生成提示词
              </>
            )}
          </Button>
        ) : currentTask.status === "generating_images" && !isPolling && !isGeneratingImages ? (
          // 手动模式：生成图片
          <Button
            className="w-full"
            size="lg"
            onClick={() => handleGenerateImages()}
            disabled={isGeneratingImages}
          >
            {isGeneratingImages ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <ImagePlus className="h-4 w-4 mr-2" />
                生成图片
              </>
            )}
          </Button>
        ) : isPolling ? (
          // 生成中
          <Button className="w-full" size="lg" disabled>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            图片生成中...
          </Button>
        ) : ["success", "partial_success", "failed"].includes(currentTask?.status || "") ? (
          // 完成
          <Button
            className="w-full"
            size="lg"
            variant="outline"
            onClick={handleReset}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            重新开始
          </Button>
        ) : null}
      </div>
    </div>
  );
}

