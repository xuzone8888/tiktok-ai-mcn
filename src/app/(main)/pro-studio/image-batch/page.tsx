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
  Plus,
  Minus,
  FileText,
  PackageOpen,
  Wifi,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

// 线路检测组件
import { SpeedTestDialog } from "@/components/speed-test-dialog";
import { getCachedSpeedTestResults, getBestRouteId } from "@/lib/download-manager";

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
} from "@/stores/image-batch-store";

import {
  type ImageBatchTask,
} from "@/types/generation";

// Templates
import { SaveTemplateDialog } from "@/components/studio/SaveTemplateDialog";
import { TemplateManager, type Template } from "@/components/studio/TemplateManager";
import { LayoutTemplate, Save } from "lucide-react";

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
        {task.config.sourceImageUrl ? (
          <img
            src={task.config.sourceImageUrl}
            alt={task.config.sourceImageName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-500/20 to-pink-500/20">
            <FileText className="h-10 w-10 text-purple-400 mb-2" />
            <span className="text-xs text-purple-300 text-center px-2 line-clamp-2">
              {task.config.prompt.slice(0, 30)}...
            </span>
          </div>
        )}

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
      {/* Templates */}
      <SaveTemplateDialog
        open={showSaveTemplate}
        onOpenChange={setShowSaveTemplate}
        onSave={handleSaveTemplate}
        defaultName={createPrompt ? (createPrompt.substring(0, 10) + "...") : "我的视频方案"}
      />
      <TemplateManager
        open={showTemplateManager}
        onOpenChange={setShowTemplateManager}
        type="video_batch"
        onSelect={handleLoadTemplate}
      />
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
    addTaskFromPrompt,
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
    applyGlobalSettingsToSelected,
  } = useImageBatchStore();

  // Local State
  const [userId, setUserId] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState(0);
  const [previewTask, setPreviewTask] = useState<ImageBatchTask | null>(null);

  // 创建任务弹窗状态
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createPrompt, setCreatePrompt] = useState("");
  const [createCount, setCreateCount] = useState(1);

  // 批量下载状态
  const [isDownloading, setIsDownloading] = useState(false);
  // 线路检测弹窗状态
  const [showSpeedTest, setShowSpeedTest] = useState(false);
  // 下载进度状态
  const [downloadProgress, setDownloadProgress] = useState({
    show: false,
    total: 0,
    current: 0,
    success: 0,
    failed: 0,
    currentFilename: "",
  });

  // Template State
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);

  // Template Handlers
  const handleSaveTemplate = async (name: string, description: string) => {
    try {
      const configToSave = {
        globalSettings,
      };

      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          type: 'image_batch',
          config: configToSave
        })
      });

      if (!res.ok) throw new Error('保存失败');

      toast({
        title: "保存成功",
        description: `方案 "${name}" 已保存`,
      });
      setShowSaveTemplate(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "保存失败",
        description: "无法保存您的方案"
      });
    }
  };

  const handleLoadTemplate = (template: Template) => {
    try {
      const config = template.config;
      if (config.globalSettings) {
        Object.entries(config.globalSettings).forEach(([key, value]) => {
          updateGlobalSettings(key as any, value);
        });
      }
      toast({
        title: "加载成功",
        description: `方案 "${template.name}" 已加载`,
      });
      setShowTemplateManager(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "加载失败",
        description: "方案数据可能已损坏"
      });
    }
  };

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

  // 应用全局设置到所有待处理任务
  const handleApplyToAll = useCallback(() => {
    applyGlobalSettingsToAllPending();
    toast({ title: "✅ 已应用设置到所有待处理任务" });
  }, [applyGlobalSettingsToAllPending, toast]);

  // 应用全局设置到选中的任务
  const handleApplyToSelected = useCallback(() => {
    applyGlobalSettingsToSelected();
    toast({ title: `✅ 已应用设置到 ${selectedCount} 个选中任务` });
  }, [applyGlobalSettingsToSelected, selectedCount, toast]);

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
        // 上传图片（如果有源图片）
        let remoteImageUrl = task.config.sourceImageUrl;
        if (task.config.sourceImageUrl) {
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
        } else {
          // 纯提示词模式，跳过上传步骤
          updateTaskStatus(task.id, "processing", { progress: 10 });
        }

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

        const responseText = await response.text();
        let result;
        try {
          result = JSON.parse(responseText);
        } catch {
          console.error("[Image Batch] Failed to parse submit response:", responseText.substring(0, 200));
          throw new Error("图片处理服务响应格式错误");
        }

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
                const errorMsg = taskData.errorMessage || "处理失败";
                updateTaskStatus(task.id, "failed", {
                  error: errorMsg,
                  completedAt: new Date().toISOString(),
                });
                toast({
                  variant: "destructive",
                  title: `❌ ${task.config.sourceImageName} 处理失败`,
                  description: errorMsg,
                  duration: 6000,
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
              <span className="gradient-tiktok-text">批量制图线</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTemplateManager(true)}
                className="ml-2 h-7 px-3 text-xs bg-white/5 border-white/10 hover:bg-white/10 text-gray-400 hover:text-cyan-400 gap-1.5 transition-all"
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                <span>加载方案</span>
              </Button>
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
        {/* 全局配置工具栏 - 简化版 */}
        {/* ============================================ */}
        <Card className="glass-card">
          <CardContent className="py-4 space-y-4">
            {/* 第一行：模型和处理类型 */}
            <div className="flex flex-wrap items-center gap-4">
              {/* 模型选择 - 简化为标签 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">模型</Label>
                <div className="flex gap-1 p-1 rounded-lg bg-muted/30">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateGlobalSettings("model", "nano-banana")}
                    className={cn(
                      "h-8 px-3 text-xs",
                      globalSettings.model === "nano-banana"
                        ? "bg-tiktok-cyan/20 text-tiktok-cyan"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Zap className="h-3.5 w-3.5 mr-1" />
                    快速
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateGlobalSettings("model", "nano-banana-pro")}
                    className={cn(
                      "h-8 px-3 text-xs",
                      globalSettings.model === "nano-banana-pro"
                        ? "bg-tiktok-pink/20 text-tiktok-pink"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                    专业
                  </Button>
                </div>
              </div>

              {/* 分隔线 */}
              <div className="h-6 w-px bg-border/50" />

              {/* 处理类型 - 简化为一排 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">处理</Label>
                <div className="flex gap-1">
                  {getAvailableActions().map((action) => (
                    <Button
                      key={action.value}
                      variant="outline"
                      size="sm"
                      onClick={() => updateGlobalSettings("action", action.value)}
                      className={cn(
                        "h-8 px-3 text-xs gap-1.5",
                        globalSettings.action === action.value
                          ? globalSettings.model === "nano-banana"
                            ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan"
                            : "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink"
                          : "btn-subtle"
                      )}
                    >
                      {action.value === "generate" && <Wand2 className="h-3.5 w-3.5" />}
                      {action.value === "upscale" && <ZoomIn className="h-3.5 w-3.5" />}
                      {action.value === "nine_grid" && <Grid3X3 className="h-3.5 w-3.5" />}
                      {action.label}
                      <span className="text-amber-400">{action.credits}pts</span>
                    </Button>
                  ))}
                </div>
              </div>

              {/* 分隔线 */}
              <div className="h-6 w-px bg-border/50" />

              {/* 尺寸比例 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">尺寸</Label>
                <div className="flex gap-1">
                  {(globalSettings.model === "nano-banana"
                    ? NANO_FAST_ASPECT_OPTIONS
                    : NANO_PRO_ASPECT_OPTIONS
                  ).slice(0, 4).map((opt) => (
                    <Button
                      key={opt.value}
                      variant="outline"
                      size="sm"
                      onClick={() => updateGlobalSettings("aspectRatio", opt.value)}
                      className={cn(
                        "h-8 w-8 p-0",
                        globalSettings.aspectRatio === opt.value
                          ? globalSettings.model === "nano-banana"
                            ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan"
                            : "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink"
                          : "btn-subtle"
                      )}
                      title={opt.label}
                    >
                      {AspectRatioIcons[opt.value]}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Pro 模式分辨率 */}
              {globalSettings.model === "nano-banana-pro" && (
                <>
                  <div className="h-6 w-px bg-border/50" />
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">画质</Label>
                    <div className="flex gap-1">
                      {IMAGE_RESOLUTION_OPTIONS.map((opt) => (
                        <Button
                          key={opt.value}
                          variant="outline"
                          size="sm"
                          onClick={() => updateGlobalSettings("resolution", opt.value)}
                          className={cn(
                            "h-8 px-2 text-xs",
                            globalSettings.resolution === opt.value
                              ? "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink"
                              : "btn-subtle"
                          )}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 第二行：提示词输入区 */}
            {globalSettings.action === "generate" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">提示词（用于 AI 生成）</Label>
                <textarea
                  value={globalSettings.prompt}
                  onChange={(e) => updateGlobalSettings("prompt", e.target.value)}
                  placeholder="详细描述你想要生成的图片内容，例如：一个时尚的女性穿着红色连衣裙，站在城市街头，阳光照射，专业摄影..."
                  className="w-full h-24 px-4 py-3 text-sm bg-muted/30 border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-tiktok-cyan/50 resize-none"
                />
              </div>
            )}

            {globalSettings.action !== "generate" && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/20 border border-border/30">
                <span className="text-sm text-muted-foreground">
                  {globalSettings.action === "upscale" ? "🔒 高清放大模式 - 自动增强清晰度，无需提示词" : "🔒 九宫格模式 - 纯白背景+多角度展示，无需提示词"}
                </span>
              </div>
            )}

            {/* 第三行：操作按钮 */}
            <div className="flex items-center gap-3">
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
                  if (fileInputRef.current) fileInputRef.current.value = "";
                  fileInputRef.current?.click();
                }}
                className="h-10 px-6 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90 text-black font-semibold"
              >
                <FolderUp className="h-4 w-4 mr-2" />
                上传图片
              </Button>

              {globalSettings.action === "generate" && (
                <Button
                  variant="outline"
                  onClick={() => setShowCreateDialog(true)}
                  className="h-10 px-4 border-tiktok-cyan/50 text-tiktok-cyan hover:bg-tiktok-cyan/10"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  纯提示词创建
                </Button>
              )}

              {tasks.length > 0 && (
                <Button variant="outline" onClick={handleApplyToAll} className="h-10 btn-subtle">
                  <Wand2 className="h-4 w-4 mr-1" />
                  应用全部
                </Button>
              )}

              <div className="flex-1" />

              <Button
                variant="outline"
                onClick={() => setShowSaveTemplate(true)}
                className="h-10 px-4 border-muted hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                title="保存当前配置为方案"
              >
                <Save className="h-4 w-4 mr-2" />
                保存方案
              </Button>
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
                {/* 线路检测按钮 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSpeedTest(true)}
                  className="h-8 text-xs"
                >
                  <Wifi className="h-3 w-3 mr-1" />
                  检测线路
                </Button>

                {selectedCount > 0 && (
                  <>
                    {/* 批量下载选中的已完成任务 */}
                    {tasks.filter(t => selectedTaskIds[t.id] && t.status === "completed" && t.resultUrl).length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const completedSelectedTasks = tasks.filter(
                            t => selectedTaskIds[t.id] && t.status === "completed" && t.resultUrl
                          );
                          if (completedSelectedTasks.length === 0) {
                            toast({ variant: "destructive", title: "没有可下载的图片" });
                            return;
                          }

                          // 获取最佳线路
                          const cachedResults = getCachedSpeedTestResults();
                          const bestRoute = getBestRouteId(cachedResults);

                          setIsDownloading(true);
                          setDownloadProgress({
                            show: true,
                            total: completedSelectedTasks.length,
                            current: 0,
                            success: 0,
                            failed: 0,
                            currentFilename: "准备中...",
                          });

                          let successCount = 0;
                          let failedCount = 0;

                          // 逐个通过代理下载
                          for (let i = 0; i < completedSelectedTasks.length; i++) {
                            const task = completedSelectedTasks[i];
                            if (task.resultUrl) {
                              const filename = `图片-${i + 1}.png`;
                              setDownloadProgress(prev => ({
                                ...prev,
                                currentFilename: filename,
                              }));

                              try {
                                // 构建代理URL
                                const params = new URLSearchParams({
                                  url: task.resultUrl,
                                  filename,
                                  ...(bestRoute && { route: bestRoute }),
                                });
                                const proxyUrl = `/api/download-proxy?${params}`;
                                const response = await fetch(proxyUrl);

                                if (response.ok) {
                                  const blob = await response.blob();
                                  const blobUrl = URL.createObjectURL(blob);
                                  const link = document.createElement("a");
                                  link.href = blobUrl;
                                  link.download = filename;
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  URL.revokeObjectURL(blobUrl);
                                  successCount++;
                                } else {
                                  // 代理失败，尝试直接下载
                                  const link = document.createElement("a");
                                  link.href = task.resultUrl;
                                  link.download = filename;
                                  link.target = "_blank";
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  successCount++;
                                }
                              } catch (err) {
                                console.error("Download failed:", err);
                                failedCount++;
                              }

                              setDownloadProgress(prev => ({
                                ...prev,
                                current: i + 1,
                                success: successCount,
                                failed: failedCount,
                              }));

                              // 间隔 600ms 避免浏览器阻止
                              await new Promise(r => setTimeout(r, 600));
                            }
                          }

                          setIsDownloading(false);
                          toast({
                            title: `✅ 下载完成`,
                            description: `成功 ${successCount} 张${failedCount > 0 ? `，失败 ${failedCount} 张` : ""}`,
                          });

                          // 3秒后关闭进度弹窗
                          setTimeout(() => {
                            setDownloadProgress(prev => ({ ...prev, show: false }));
                          }, 3000);
                        }}
                        disabled={isDownloading}
                        className="h-8 text-xs text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3 mr-1" />
                        )}
                        下载选中 ({tasks.filter(t => selectedTaskIds[t.id] && t.status === "completed" && t.resultUrl).length})
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleApplyToSelected}
                      className="h-8 text-xs text-tiktok-cyan border-tiktok-cyan/30 hover:bg-tiktok-cyan/10"
                    >
                      <Wand2 className="h-3 w-3 mr-1" />
                      应用到选中 ({selectedCount})
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={removeSelectedTasks}
                      className="h-8 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      删除 ({selectedCount})
                    </Button>
                  </>
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

        {/* 创建任务弹窗 - 纯提示词模式 */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-2xl bg-background border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-tiktok-cyan" />
                纯提示词创建图片任务
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* 提示词输入 */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">提示词 *</Label>
                <textarea
                  value={createPrompt}
                  onChange={(e) => setCreatePrompt(e.target.value)}
                  placeholder="详细描述你想要生成的图片内容，例如：&#10;&#10;一个时尚的亚洲女性穿着优雅的白色连衣裙，站在现代简约的室内环境中，柔和的自然光从落地窗照射进来，专业时尚摄影，高清画质..."
                  className="w-full h-40 px-4 py-3 text-sm bg-muted/30 border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-tiktok-cyan/50 resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  提示：详细的描述可以获得更好的生成效果。可以包含场景、人物、光线、风格等信息。
                </p>
              </div>

              {/* 任务数量 */}
              <div className="flex items-center gap-4">
                <Label className="text-sm font-medium whitespace-nowrap">创建数量</Label>
                <div className="flex items-center border border-border/50 rounded-lg overflow-hidden">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setCreateCount(Math.max(1, createCount - 1))}
                    className="h-9 w-9 rounded-none border-r border-border/50"
                    disabled={createCount <= 1}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-12 text-center text-sm font-medium">{createCount}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setCreateCount(Math.min(20, createCount + 1))}
                    className="h-9 w-9 rounded-none border-l border-border/50"
                    disabled={createCount >= 20}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  使用相同提示词创建多个任务（适合生成多个变体）
                </span>
              </div>

              {/* 当前配置显示 */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30">
                <span className="text-xs text-muted-foreground">当前配置：</span>
                <Badge variant="outline" className="text-xs">
                  {globalSettings.model === "nano-banana" ? "快速" : "Pro"}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {globalSettings.aspectRatio}
                </Badge>
                {globalSettings.model === "nano-banana-pro" && (
                  <Badge variant="outline" className="text-xs">
                    {globalSettings.resolution.toUpperCase()}
                  </Badge>
                )}
                <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-xs">
                  {getImageTaskCost({
                    ...globalSettings,
                    sourceImageUrl: "",
                    sourceImageName: "",
                    action: "generate",
                    prompt: "",
                  }) * createCount} Credits
                </Badge>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCreatePrompt("");
                  setCreateCount(1);
                  setShowCreateDialog(false);
                }}
              >
                取消
              </Button>
              <Button
                onClick={() => {
                  if (!createPrompt.trim()) {
                    toast({ variant: "destructive", title: "请输入提示词" });
                    return;
                  }
                  const ids = addTaskFromPrompt(createPrompt, createCount);
                  toast({ title: `✅ 已创建 ${ids.length} 个任务` });
                  setCreatePrompt("");
                  setCreateCount(1);
                  setShowCreateDialog(false);
                }}
                disabled={!createPrompt.trim()}
                className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black"
              >
                <Check className="h-4 w-4 mr-2" />
                创建 {createCount > 1 ? `${createCount} 个任务` : "任务"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 线路检测弹窗 */}
        <SpeedTestDialog
          open={showSpeedTest}
          onClose={() => setShowSpeedTest(false)}
          onComplete={(results) => {
            const bestRoute = getBestRouteId(results);
            if (bestRoute) {
              toast({
                title: "✅ 线路检测完成",
                description: `推荐使用 ${results.find(r => r.routeId === bestRoute)?.routeId || bestRoute} 线路`,
              });
            }
          }}
        />

        {/* 批量下载进度弹窗 */}
        <Dialog open={downloadProgress.show} onOpenChange={(open) => !open && setDownloadProgress(prev => ({ ...prev, show: false }))}>
          <DialogContent className="max-w-md bg-black/95 border-white/10">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {downloadProgress.current >= downloadProgress.total ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <Download className="h-5 w-5 text-tiktok-cyan animate-pulse" />
                )}
                {downloadProgress.current >= downloadProgress.total ? "下载完成" : "批量下载中"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Progress
                value={(downloadProgress.current / downloadProgress.total) * 100}
                className="h-3"
              />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>进度: {downloadProgress.current} / {downloadProgress.total}</span>
                <span>成功: {downloadProgress.success} / 失败: {downloadProgress.failed}</span>
              </div>
              {downloadProgress.currentFilename && (
                <div className="text-xs text-muted-foreground truncate">
                  当前: {downloadProgress.currentFilename}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {/* Templates */}
      <SaveTemplateDialog
        open={showSaveTemplate}
        onOpenChange={setShowSaveTemplate}
        onSave={handleSaveTemplate}
        defaultName="我的制图方案"
      />
      <TemplateManager
        open={showTemplateManager}
        onOpenChange={setShowTemplateManager}
        type="image_batch"
        onSelect={handleLoadTemplate}
      />
    </TooltipProvider>
  );
}

