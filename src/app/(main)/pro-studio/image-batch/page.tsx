"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
// import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
// import {
//   Select,
//   SelectContent,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Zap,
  Upload,
  Play,
  Loader2,
  Download,
  ImageIcon,
  Video,
  X,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Check,
  Trash2,
  MoreVertical,
  Settings2,
  FolderUp,
  Wand2,
  Sparkles,
  ZoomIn,
  Grid3X3,
  Maximize2,
  Square,
  Monitor,
  Smartphone,
  Tv,
  LayoutGrid,
  Eye,
  ChevronLeft,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

// Types
import {
  type ImageProcessAction,
  NANO_FAST_ASPECT_OPTIONS,
  NANO_PRO_ASPECT_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  NANO_FAST_ACTION_PRICING,
  NANO_PRO_ACTION_PRICING,
} from "@/types/generation";

// Store
import {
  useImageBatchStore,
  useImageBatchTasks,
  useImageBatchJobStatus,
  useImageBatchGlobalSettings,
  useImageBatchSelectedIds,
  useImageBatchSelectedCount,
  useImageBatchStats,
  getImageTaskCost,
  type ImageBatchTask,
} from "@/stores/image-batch-store";

// ============================================================================
// 图标映射
// ============================================================================

const AspectRatioIcons: Record<string, React.ReactNode> = {
  "auto": <Maximize2 className="h-4 w-4" />,
  "1:1": <Square className="h-4 w-4" />,
  "16:9": <Monitor className="h-4 w-4" />,
  "9:16": <Smartphone className="h-4 w-4" />,
  "4:3": <Tv className="h-4 w-4" />,
  "3:4": <LayoutGrid className="h-4 w-4" />,
};

// ============================================================================
// TaskCard 组件
// ============================================================================

interface TaskCardProps {
  task: ImageBatchTask;
  isSelected: boolean;
  onToggleSelect: () => void;
  onRemove: () => void;
  onStartSingle: () => void;
  onPreview: () => void;
}

function TaskCard({
  task,
  isSelected,
  onToggleSelect,
  onRemove,
  onStartSingle,
  onPreview,
}: TaskCardProps) {
  const cost = getImageTaskCost(task.config);

  const getStatusBadge = () => {
    switch (task.status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-muted/50 text-xs">
            待处理
          </Badge>
        );
      case "processing":
        return (
          <Badge className="bg-tiktok-cyan/10 text-tiktok-cyan border-tiktok-cyan/30 text-xs animate-pulse">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            处理中
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            完成
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/10 text-red-500 border-red-500/30 text-xs">
            <XCircle className="h-3 w-3 mr-1" />
            失败
          </Badge>
        );
    }
  };

  const getActionLabel = () => {
    const { model, action } = task.config;
    if (model === "nano-banana") {
      return NANO_FAST_ACTION_PRICING[action]?.label || action;
    }
    return NANO_PRO_ACTION_PRICING[action as "generate" | "nine_grid"]?.label || action;
  };

  return (
    <div
      className={cn(
        "group relative rounded-xl border transition-all duration-200 overflow-hidden",
        isSelected
          ? "bg-tiktok-cyan/5 border-tiktok-cyan/50 ring-2 ring-tiktok-cyan/20"
          : "bg-card/50 border-border/50 hover:border-border",
        task.status === "processing" && "ring-2 ring-tiktok-cyan/30"
      )}
    >
      {/* 选择复选框 */}
      <div
        onClick={onToggleSelect}
        className={cn(
          "absolute top-3 left-3 z-10 flex h-5 w-5 items-center justify-center rounded border cursor-pointer transition-all",
          isSelected
            ? "bg-tiktok-cyan border-tiktok-cyan text-black"
            : "border-white/30 bg-black/50 hover:border-tiktok-cyan/50"
        )}
      >
        {isSelected && <Check className="h-3 w-3" />}
      </div>

      {/* 图片预览 */}
      <div 
        className="relative aspect-square bg-muted/30 cursor-pointer"
        onClick={onPreview}
      >
        <img
          src={task.config.sourceImageUrl}
          alt={task.config.sourceImageName}
          className="w-full h-full object-cover"
        />
        
        {/* 悬浮操作层 */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Eye className="h-8 w-8 text-white" />
        </div>

        {/* 处理进度 */}
        {task.status === "processing" && task.progress !== undefined && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-2">
            <Progress value={task.progress} className="h-1.5" />
            <p className="text-[10px] text-white text-center mt-1">{task.progress}%</p>
          </div>
        )}

        {/* 结果预览 - 点击查看大图 */}
        {task.status === "completed" && task.resultUrl && (
          <div className="absolute inset-0 bg-black/90 flex items-center justify-center group-hover:bg-black/80 transition-colors">
            <img
              src={task.resultUrl}
              alt="Result"
              className="max-w-[90%] max-h-[90%] object-contain rounded"
            />
            {/* 点击查看提示 */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="bg-black/60 rounded-full p-3">
                <Eye className="h-6 w-6 text-white" />
              </div>
            </div>
          </div>
        )}

        {/* 错误显示 */}
        {task.status === "failed" && (
          <div className="absolute inset-0 bg-red-900/80 flex flex-col items-center justify-center p-4">
            <XCircle className="h-8 w-8 text-red-400 mb-2" />
            <p className="text-xs text-red-200 text-center line-clamp-2">
              {task.error || "处理失败"}
            </p>
          </div>
        )}
      </div>

      {/* 卡片信息 */}
      <div className="p-3 space-y-2">
        {/* 文件名和状态 */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate flex-1">
            {task.config.sourceImageName}
          </p>
          {getStatusBadge()}
        </div>

        {/* 任务配置信息 */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            {task.config.model === "nano-banana" ? "快速" : "Pro"}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            {getActionLabel()}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            {task.config.aspectRatio}
          </Badge>
          {task.config.model === "nano-banana-pro" && task.config.resolution && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5">
              {task.config.resolution.toUpperCase()}
            </Badge>
          )}
        </div>

        {/* 操作栏 */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs font-semibold text-amber-400">
            {cost} Credits
          </span>
          <div className="flex items-center gap-1">
            {/* 单独开始按钮 */}
            {task.status === "pending" && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartSingle();
                      }}
                      className="h-7 w-7 text-tiktok-cyan hover:text-tiktok-cyan hover:bg-tiktok-cyan/10"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>单独生成此任务</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* 下载按钮 */}
            {task.status === "completed" && task.resultUrl && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={task.resultUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>下载结果</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* 删除按钮 */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove();
                    }}
                    className="h-7 w-7 text-red-400 hover:text-red-400 hover:bg-red-400/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>删除任务</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 主页面
// ============================================================================

export default function ImageBatchPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Store
  const tasks = useImageBatchTasks();
  const _jobStatus = useImageBatchJobStatus(); // 保留供未来批量功能使用
  const globalSettings = useImageBatchGlobalSettings();
  const selectedTaskIds = useImageBatchSelectedIds();
  const selectedCount = useImageBatchSelectedCount();
  const stats = useImageBatchStats();
  void _jobStatus; // suppress unused warning

  const {
    addTasksFromFiles,
    updateTaskStatus,
    removeTask,
    clearAllTasks,
    toggleTaskSelection,
    selectAllTasks,
    clearSelection,
    removeSelectedTasks,
    resetBatch,
    updateGlobalSettings,
    applyGlobalSettingsToAllPending,
  } = useImageBatchStore();

  // Local State
  const [userId, setUserId] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState(0);
  const [previewTask, setPreviewTask] = useState<ImageBatchTask | null>(null);

  // 获取用户积分
  useEffect(() => {
    fetch("/api/user/credits")
      .then((res) => res.json())
      .then((data) => {
        if (data.credits !== undefined) setUserCredits(data.credits);
        if (data.userId) setUserId(data.userId);
      })
      .catch(console.error);
  }, []);

  // 批量上传
  const handleBatchUpload = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files).filter((f) => f.type.startsWith("image/"));

      if (fileArray.length === 0) {
        toast({ variant: "destructive", title: "请选择图片文件" });
        return;
      }

      const ids = await addTasksFromFiles(fileArray);

      toast({
        title: "✅ 上传成功",
        description: `已添加 ${ids.length} 张图片`,
      });
      
      // 重置文件输入，允许再次选择相同文件
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [addTasksFromFiles, toast]
  );

  // 应用全局设置
  const handleApplyToAll = useCallback(() => {
    applyGlobalSettingsToAllPending();
    toast({ title: "✅ 已应用设置到所有待处理任务" });
  }, [applyGlobalSettingsToAllPending, toast]);

  // 处理单个任务
  const handleProcessSingleTask = useCallback(
    async (task: ImageBatchTask) => {
      if (task.status !== "pending") return;
      if (userCredits < getImageTaskCost(task.config)) {
        toast({ variant: "destructive", title: "积分不足" });
        return;
      }
      
      // 确保 userId 已获取，如果没有则先获取
      let currentUserId = userId;
      if (!currentUserId) {
        try {
          const creditsRes = await fetch("/api/user/credits");
          const creditsData = await creditsRes.json();
          if (creditsData.userId) {
            currentUserId = creditsData.userId;
            setUserId(creditsData.userId);
            console.log("[Image Batch] Got userId on demand:", creditsData.userId);
          }
        } catch (e) {
          console.error("[Image Batch] Failed to get userId:", e);
        }
      }

      updateTaskStatus(task.id, "processing", {
        startedAt: new Date().toISOString(),
        progress: 0,
      });

      try {
        // 上传图片
        let remoteImageUrl = task.config.sourceImageUrl;
        if (task.config.sourceImageUrl.startsWith("blob:")) {
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
        }

        updateTaskStatus(task.id, "processing", { progress: 20 });

        // 调用 API
        console.log("[Image Batch] Calling generate/image with userId:", currentUserId);
        const response = await fetch("/api/generate/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: task.config.action,
            model: task.config.model,
            sourceImageUrl: remoteImageUrl,
            aspectRatio: task.config.aspectRatio,
            resolution: task.config.resolution,
            prompt: task.config.prompt,
            userId: currentUserId,
            source: "batch_image", // 标记来源为批量图片处理
          }),
        });

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || "提交任务失败");
        }

        const apiTaskId = result.data.taskId;
        const taskModel = result.data.model;

        updateTaskStatus(task.id, "processing", {
          apiTaskId,
          progress: 30,
        });

        // 轮询任务状态
        let pollCount = 0;
        const maxPolls = 60;
        const pollInterval = 3000;

        const pollTimer = setInterval(async () => {
          pollCount++;
          const estimatedProgress = Math.min(95, 30 + pollCount * 1.1);
          updateTaskStatus(task.id, "processing", { progress: Math.round(estimatedProgress) });

          try {
            const statusResponse = await fetch(
              `/api/generate/image?taskId=${apiTaskId}&model=${taskModel}`
            );
            const statusResult = await statusResponse.json();

            if (statusResult.success) {
              const taskData = statusResult.data;

              if (taskData.status === "completed" && taskData.imageUrl) {
                clearInterval(pollTimer);
                updateTaskStatus(task.id, "completed", {
                  resultUrl: taskData.imageUrl,
                  progress: 100,
                  completedAt: new Date().toISOString(),
                });
                setUserCredits((prev) => prev - getImageTaskCost(task.config));
                toast({ title: `✅ ${task.config.sourceImageName} 处理完成` });
              } else if (taskData.status === "failed") {
                clearInterval(pollTimer);
                updateTaskStatus(task.id, "failed", {
                  error: taskData.errorMessage || "处理失败",
                  completedAt: new Date().toISOString(),
                });
                toast({
                  variant: "destructive",
                  title: `❌ ${task.config.sourceImageName} 处理失败`,
                });
              }
            }

            if (pollCount >= maxPolls) {
              clearInterval(pollTimer);
              updateTaskStatus(task.id, "failed", {
                error: "处理超时",
                completedAt: new Date().toISOString(),
              });
            }
          } catch (pollError) {
            console.error("Polling error:", pollError);
          }
        }, pollInterval);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "处理失败";
        updateTaskStatus(task.id, "failed", {
          error: errorMessage,
          completedAt: new Date().toISOString(),
        });
        toast({ variant: "destructive", title: "处理失败", description: errorMessage });
      }
    },
    [userId, userCredits, updateTaskStatus, toast]
  );

  // 获取可用的 action 列表
  const getAvailableActions = () => {
    if (globalSettings.model === "nano-banana") {
      return Object.entries(NANO_FAST_ACTION_PRICING).map(([key, value]) => ({
        value: key as ImageProcessAction,
        label: value.label,
        description: value.description,
        credits: value.credits,
      }));
    } else {
      return Object.entries(NANO_PRO_ACTION_PRICING).map(([key, value]) => ({
        value: key as ImageProcessAction,
        label: value.label,
        description: value.description,
        credits: value.credits,
      }));
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6 pb-32">
        {/* ============================================ */}
        {/* 页面头部 */}
        {/* ============================================ */}
        <div className="flex items-center gap-4">
          <Link href="/pro-studio">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ImageIcon className="h-6 w-6 text-tiktok-pink" />
              <span className="gradient-tiktok-text">图片批量处理</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              批量上传图片，使用 AI 进行高清放大、九宫格生成等处理
            </p>
          </div>
          
          {/* 快捷切换按钮组 */}
          <div className="flex items-center gap-2 p-1 rounded-xl bg-muted/50 border border-border/50">
            <Link href="/pro-studio/video-batch">
              <Button
                variant="ghost"
                size="sm"
                className="hover:bg-tiktok-cyan/10 hover:text-tiktok-cyan"
              >
                <Video className="h-4 w-4 mr-1.5" />
                视频
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="bg-gradient-to-r from-tiktok-pink/20 to-tiktok-pink/10 text-tiktok-pink border border-tiktok-pink/30"
            >
              <ImageIcon className="h-4 w-4 mr-1.5" />
              图片
            </Button>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30">
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-semibold text-amber-400">
                {userCredits.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* ============================================ */}
        {/* 全局配置工具栏 */}
        {/* ============================================ */}
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-tiktok-cyan" />
              全局配置
            </CardTitle>
            <CardDescription className="text-xs">
              设置默认处理参数，将自动应用到新上传的图片
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 模型选择 */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => updateGlobalSettings("model", "nano-banana")}
                className={cn(
                  "h-auto py-4 flex flex-col items-start gap-1",
                  globalSettings.model === "nano-banana"
                    ? "bg-tiktok-cyan/10 border-tiktok-cyan/50 text-tiktok-cyan"
                    : "btn-subtle"
                )}
              >
                <div className="flex items-center gap-2 w-full">
                  <Zap className="h-5 w-5" />
                  <span className="font-semibold">Nano Banana</span>
                  <Badge className="ml-auto bg-tiktok-cyan/20 text-tiktok-cyan text-[10px]">
                    快速
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground text-left">
                  快速生成、高清放大、九宫格
                </p>
              </Button>

              <Button
                variant="outline"
                onClick={() => updateGlobalSettings("model", "nano-banana-pro")}
                className={cn(
                  "h-auto py-4 flex flex-col items-start gap-1",
                  globalSettings.model === "nano-banana-pro"
                    ? "bg-tiktok-pink/10 border-tiktok-pink/50 text-tiktok-pink"
                    : "btn-subtle"
                )}
              >
                <div className="flex items-center gap-2 w-full">
                  <Sparkles className="h-5 w-5" />
                  <span className="font-semibold">Nano Banana Pro</span>
                  <Badge className="ml-auto bg-tiktok-pink/20 text-tiktok-pink text-[10px]">
                    专业
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground text-left">
                  高质量输出，支持 1K/2K/4K 分辨率
                </p>
              </Button>
            </div>

            {/* 处理动作 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">处理类型</Label>
              <div className="grid grid-cols-3 gap-2">
                {getAvailableActions().map((action) => (
                  <Button
                    key={action.value}
                    variant="outline"
                    onClick={() => updateGlobalSettings("action", action.value)}
                    className={cn(
                      "h-auto py-3 flex flex-col items-center gap-1",
                      globalSettings.action === action.value
                        ? globalSettings.model === "nano-banana"
                          ? "bg-tiktok-cyan/10 border-tiktok-cyan/50"
                          : "bg-tiktok-pink/10 border-tiktok-pink/50"
                        : "btn-subtle"
                    )}
                  >
                    {action.value === "generate" && <Wand2 className="h-5 w-5" />}
                    {action.value === "upscale" && <ZoomIn className="h-5 w-5" />}
                    {action.value === "nine_grid" && <Grid3X3 className="h-5 w-5" />}
                    <span className="text-xs font-medium">{action.label}</span>
                    <span className="text-[10px] text-amber-400">{action.credits} pts</span>
                  </Button>
                ))}
              </div>
              {/* 动作描述 */}
              <p className="text-xs text-muted-foreground mt-2 p-2 rounded bg-muted/30">
                {getAvailableActions().find((a) => a.value === globalSettings.action)?.description}
              </p>
            </div>

            {/* 尺寸比例 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">尺寸比例</Label>
              <div className="flex flex-wrap gap-2">
                {(globalSettings.model === "nano-banana"
                  ? NANO_FAST_ASPECT_OPTIONS
                  : NANO_PRO_ASPECT_OPTIONS
                ).map((opt) => (
                  <Button
                    key={opt.value}
                    variant="outline"
                    size="sm"
                    onClick={() => updateGlobalSettings("aspectRatio", opt.value)}
                    className={cn(
                      "h-9 px-3 gap-1.5",
                      globalSettings.aspectRatio === opt.value
                        ? globalSettings.model === "nano-banana"
                          ? "bg-tiktok-cyan/10 border-tiktok-cyan/50 text-tiktok-cyan"
                          : "bg-tiktok-pink/10 border-tiktok-pink/50 text-tiktok-pink"
                        : "btn-subtle"
                    )}
                  >
                    {AspectRatioIcons[opt.value]}
                    <span className="text-xs">{opt.label}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* 输出分辨率 (仅 Pro 模式) */}
            {globalSettings.model === "nano-banana-pro" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">输出分辨率</Label>
                <div className="flex gap-2">
                  {IMAGE_RESOLUTION_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      variant="outline"
                      size="sm"
                      onClick={() => updateGlobalSettings("resolution", opt.value)}
                      className={cn(
                        "flex-1 h-10 flex-col gap-0.5",
                        globalSettings.resolution === opt.value
                          ? "bg-tiktok-pink/10 border-tiktok-pink/50 text-tiktok-pink"
                          : "btn-subtle"
                      )}
                    >
                      <span className="font-semibold">{opt.label}</span>
                      <span className="text-[10px] opacity-70">{opt.description}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* 提示词输入 - 仅在 AI 生成模式下启用 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                {globalSettings.action === "generate" ? (
                  <>
                    提示词
                    <span className="ml-2 text-muted-foreground/60">
                      描述您想要生成的图片效果
                    </span>
                  </>
                ) : (
                  <>
                    提示词
                    <span className="ml-2 text-amber-400/80">
                      {globalSettings.action === "upscale" 
                        ? "（高清放大模式无需提示词，系统自动处理）" 
                        : "（九宫格适配Sora2视频，纯白背景+多角度）"}
                    </span>
                  </>
                )}
              </Label>
              <textarea
                value={globalSettings.action === "generate" ? globalSettings.prompt : ""}
                onChange={(e) => updateGlobalSettings("prompt", e.target.value)}
                disabled={globalSettings.action !== "generate"}
                placeholder={
                  globalSettings.action === "generate"
                    ? "描述您想要生成的图片效果，例如：产品展示在白色背景上，柔和的光线，专业摄影风格..."
                    : globalSettings.action === "upscale"
                    ? "🔒 高清放大模式：自动增强图片清晰度和细节"
                    : "🔒 九宫格模式：适配Sora2视频，纯白背景+9角度展示，便于AI精准渲染"
                }
                className={cn(
                  "w-full h-20 px-3 py-2 text-sm border border-border/50 rounded-lg resize-none focus:outline-none",
                  globalSettings.action === "generate"
                    ? "bg-muted/30 focus:ring-2 focus:ring-tiktok-cyan/50"
                    : "bg-muted/10 text-muted-foreground/50 cursor-not-allowed"
                )}
              />
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2 pt-2">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => e.target.files && handleBatchUpload(e.target.files)}
                className="hidden"
                ref={fileInputRef}
              />
              <Button
                onClick={() => {
                  // 先重置文件输入，确保可以选择相同文件
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                  fileInputRef.current?.click();
                }}
                className="flex-1 h-11 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90 text-black font-semibold"
              >
                <FolderUp className="h-5 w-5 mr-2" />
                批量上传图片
              </Button>
              {tasks.length > 0 && (
                <Button
                  variant="outline"
                  onClick={handleApplyToAll}
                  className="h-11 btn-subtle"
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  应用到全部
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ============================================ */}
        {/* 任务列表 */}
        {/* ============================================ */}
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-tiktok-pink" />
                  任务队列
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {tasks.length} 个任务
                </Badge>
                {stats.pending > 0 && (
                  <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-xs">
                    {stats.pending} 待处理
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={removeSelectedTasks}
                    className="h-8 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    删除选中 ({selectedCount})
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 btn-subtle">
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => selectAllTasks(true)}>
                      <Check className="h-4 w-4 mr-2" />
                      全选
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={clearSelection}>
                      <X className="h-4 w-4 mr-2" />
                      取消选择
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={resetBatch}>
                      <RotateCcw className="h-4 w-4 mr-2" />
                      重置所有任务
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={clearAllTasks} className="text-red-400">
                      <Trash2 className="h-4 w-4 mr-2" />
                      清空所有
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-border/50 rounded-xl cursor-pointer hover:border-tiktok-cyan/30 transition-colors"
                onClick={() => {
                  // 先重置文件输入，确保可以选择相同文件
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                  fileInputRef.current?.click();
                }}
              >
                <Upload className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">点击或拖拽上传图片</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  支持 JPG、PNG、WebP 格式，可批量上传
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isSelected={!!selectedTaskIds[task.id]}
                    onToggleSelect={() => toggleTaskSelection(task.id)}
                    onRemove={() => removeTask(task.id)}
                    onStartSingle={() => handleProcessSingleTask(task)}
                    onPreview={() => setPreviewTask(task)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ============================================ */}
        {/* 底部状态栏 - 仅显示统计信息，单个任务手动点击开始 */}
        {/* ============================================ */}
        {tasks.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-xl">
            <div className="container max-w-7xl mx-auto px-6 py-3">
              <div className="flex items-center justify-between">
                {/* 统计信息 */}
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm">
                      <span className="font-semibold">{tasks.length}</span>
                      <span className="text-muted-foreground ml-1">个任务</span>
                    </span>
                  </div>

                  <div className="h-5 w-px bg-border/50" />

                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-amber-400" />
                    <span className="text-sm">
                      <span className="font-semibold text-amber-400">{stats.totalCost}</span>
                      <span className="text-muted-foreground ml-1">Credits</span>
                    </span>
                    {userCredits < stats.totalCost && (
                      <span className="text-xs text-red-400 ml-1">(余额不足)</span>
                    )}
                  </div>

                  {(stats.completed > 0 || stats.failed > 0 || stats.processing > 0) && (
                    <>
                      <div className="h-5 w-px bg-border/50" />
                      <div className="flex items-center gap-3 text-sm">
                        {stats.pending > 0 && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            {stats.pending} 待处理
                          </span>
                        )}
                        {stats.processing > 0 && (
                          <span className="flex items-center gap-1 text-tiktok-cyan">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {stats.processing} 处理中
                          </span>
                        )}
                        {stats.completed > 0 && (
                          <span className="flex items-center gap-1 text-emerald-500">
                            <CheckCircle2 className="h-4 w-4" />
                            {stats.completed} 完成
                          </span>
                        )}
                        {stats.failed > 0 && (
                          <span className="flex items-center gap-1 text-red-400">
                            <XCircle className="h-4 w-4" />
                            {stats.failed} 失败
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* 提示信息 */}
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>💡 点击每个任务卡片上的播放按钮开始生成</span>
                  {stats.pending > 0 && (
                    <Button
                      onClick={resetBatch}
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      重置失败任务
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================ */}
        {/* 预览弹窗 - 支持4K大图 */}
        {/* ============================================ */}
        <Dialog open={!!previewTask} onOpenChange={() => setPreviewTask(null)}>
          <DialogContent className="max-w-[95vw] max-h-[95vh] bg-black/95 border-white/10 overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-tiktok-cyan" />
                {previewTask?.config.sourceImageName}
                <span className="text-xs text-muted-foreground ml-2">
                  (点击图片可在新窗口查看原图)
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col lg:flex-row gap-6">
              {/* 原图 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  📷 原图
                </p>
                <a 
                  href={previewTask?.config.sourceImageUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="block"
                >
                  <img
                    src={previewTask?.config.sourceImageUrl}
                    alt="Original"
                    className="w-full max-h-[70vh] object-contain rounded-lg border border-white/10 cursor-zoom-in hover:border-white/30 transition-colors"
                  />
                </a>
              </div>
              {/* 结果图 */}
              {previewTask?.status === "completed" && previewTask.resultUrl && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                    ✨ 处理结果
                  </p>
                  <a 
                    href={previewTask.resultUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <img
                      src={previewTask.resultUrl}
                      alt="Result"
                      className="w-full max-h-[70vh] object-contain rounded-lg border border-tiktok-cyan/30 cursor-zoom-in hover:border-tiktok-cyan/50 transition-colors"
                    />
                  </a>
                </div>
              )}
            </div>
            <DialogFooter className="flex-row justify-end gap-2">
              {previewTask?.status === "completed" && previewTask.resultUrl && (
                <a
                  href={previewTask.resultUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black">
                    <Download className="h-4 w-4 mr-2" />
                    下载结果
                  </Button>
                </a>
              )}
              <Button variant="outline" onClick={() => setPreviewTask(null)}>
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

