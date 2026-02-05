"use client";

import { useState, useCallback, useEffect, useRef, useMemo, memo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  Settings2,
  FolderUp,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Grid3X3,
  Eye,
  FileText,
  Wand2,
  Film,
  Smartphone,
  Monitor,
  AlertTriangle,
  Plus,
  Minus,
  Copy,
  UserCircle,
  Clock,
  FileDown,
  Square,
  Sparkles,
  FolderDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  SlideshowModePanel,
  PositionUploader,
  MusicPoolManager,
  SubtitleEditor,
  TransitionPicker,
  type SlideshowMode,
  type Position,
  type MusicMode,
  type SubtitleConfig,
  type TransitionEffect
} from "@/components/slideshow";


// Types
import {
  type VideoBatchTask,
  type TaskImageInfo,
  type VideoAspectRatio,
  type VideoModelType,
  type VideoDuration,
  type VideoQuality,
  type ApiLineType,
  API_LINES,
  PIPELINE_STEPS,
  getStatusLabel,
  getVideoBatchTotalPrice,
} from "@/types/video-batch";

// Store
import {
  useVideoBatchStore,
  useVideoBatchTasks,
  useVideoBatchJobStatus,
  useVideoBatchGlobalSettings,
  useVideoBatchSelectedIds,
  useVideoBatchSelectedCount,
  useVideoBatchStats,
  useVideoBatchActiveGroup,
  useActiveGroupTasks,
  useActiveGroupStats,
  validateTaskImages,
  validatePromptTask,
  MAX_TASK_GROUPS,
} from "@/stores/video-batch-store";

// Textarea
import { Textarea } from "@/components/ui/textarea";

// 下载管理
import { getCachedSpeedTestResults, getBestRouteId } from "@/lib/download-manager";

// Templates
import { SaveTemplateDialog } from "@/components/studio/SaveTemplateDialog";
import { TemplateManager, type Template } from "@/components/studio/TemplateManager";
import { LayoutTemplate, Save } from "lucide-react";

// ============================================================================
// PipelineProgress 组件 - 流水线进度指示器
// ============================================================================

interface PipelineProgressProps {
  currentStep: PipelineStep;
  status: string;
}

function PipelineProgress({ currentStep, status }: PipelineProgressProps) {
  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STEPS.map((step, index) => {
        const isCompleted = currentStep > step.step;
        const isCurrent = currentStep === step.step;
        const isFailed = status === "failed" && isCurrent;

        return (
          <TooltipProvider key={step.step}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium transition-all",
                    isCompleted && "bg-emerald-500 text-white",
                    isCurrent && !isFailed && "bg-tiktok-cyan text-black animate-pulse",
                    isFailed && "bg-red-500 text-white",
                    !isCompleted && !isCurrent && "bg-muted text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-3 w-3" />
                  ) : isFailed ? (
                    <X className="h-3 w-3" />
                  ) : (
                    step.step
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{step.label}</p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </TooltipContent>
            </Tooltip>
            {index < PIPELINE_STEPS.length - 1 && (
              <div
                className={cn(
                  "w-4 h-0.5 transition-all",
                  currentStep > step.step ? "bg-emerald-500" : "bg-muted"
                )}
              />
            )}
          </TooltipProvider>
        );
      })}
    </div>
  );
}

// ============================================================================
// ImageUploader 组件 - 素材上传与排序
// ============================================================================

interface ImageUploaderProps {
  images: TaskImageInfo[];
  onImagesChange: (images: TaskImageInfo[]) => void;
  maxImages?: number;
  compact?: boolean;
}

function ImageUploader({ images, onImagesChange, maxImages = 4, compact = false }: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = useCallback(
    (files: FileList) => {
      const remainingSlots = maxImages - images.length;
      const filesToAdd = Array.from(files)
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, remainingSlots);

      if (filesToAdd.length === 0) {
        toast({ variant: "destructive", title: "请选择图片文件" });
        return;
      }

      const newImages: TaskImageInfo[] = filesToAdd.map((file, index) => ({
        id: `img-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
        url: URL.createObjectURL(file),
        name: file.name,
        isMainGrid: images.length === 0 && index === 0,
        order: images.length + index,
        file,
      }));

      onImagesChange([...images, ...newImages]);
    },
    [images, maxImages, onImagesChange, toast]
  );

  const handleRemoveImage = useCallback(
    (imageId: string) => {
      const imageToRemove = images.find((img) => img.id === imageId);
      if (imageToRemove?.url.startsWith("blob:")) {
        URL.revokeObjectURL(imageToRemove.url);
      }

      const newImages = images
        .filter((img) => img.id !== imageId)
        .map((img, index) => ({
          ...img,
          order: index,
          isMainGrid: index === 0,
        }));

      onImagesChange(newImages);
    },
    [images, onImagesChange]
  );

  const handleMoveImage = useCallback(
    (fromIndex: number, direction: "up" | "down") => {
      const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= images.length) return;

      const newImages = [...images];
      const [removed] = newImages.splice(fromIndex, 1);
      newImages.splice(toIndex, 0, removed);

      onImagesChange(
        newImages.map((img, index) => ({
          ...img,
          order: index,
          isMainGrid: index === 0,
        }))
      );
    },
    [images, onImagesChange]
  );

  const handleSetMainGrid = useCallback(
    (imageId: string) => {
      const targetIndex = images.findIndex((img) => img.id === imageId);
      if (targetIndex <= 0) return;

      const newImages = [...images];
      const [targetImage] = newImages.splice(targetIndex, 1);
      newImages.unshift(targetImage);

      onImagesChange(
        newImages.map((img, index) => ({
          ...img,
          order: index,
          isMainGrid: index === 0,
        }))
      );
    },
    [images, onImagesChange]
  );

  if (compact && images.length > 0) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {images.slice(0, 4).map((img, index) => (
          <div
            key={img.id}
            className={cn(
              "relative w-12 h-12 rounded-lg overflow-hidden border-2",
              index === 0 ? "border-tiktok-cyan" : "border-border/50"
            )}
          >
            <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
            {index === 0 && (
              <div className="absolute bottom-0 left-0 right-0 bg-tiktok-cyan/90 text-[8px] text-center text-black font-bold py-0.5">
                主图
              </div>
            )}
          </div>
        ))}
        {images.length > 4 && (
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground">
            +{images.length - 4}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 提示信息 */}
      <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <p className="text-xs text-amber-400">
          <strong>第一张图片必须是适配Sora2的九宫格图（纯白背景+3×3多角度）</strong>，其余最多3张为补充素材
        </p>
      </div>

      {/* 图片列表 */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map((img, index) => (
            <div
              key={img.id}
              className={cn(
                "group relative aspect-square rounded-xl overflow-hidden border-2 transition-all",
                index === 0
                  ? "border-tiktok-cyan ring-2 ring-tiktok-cyan/30"
                  : "border-border/50 hover:border-border"
              )}
            >
              <img src={img.url} alt={img.name} className="w-full h-full object-cover" />

              {/* 主图标记 */}
              {index === 0 && (
                <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-tiktok-cyan to-tiktok-cyan/80 text-black text-xs font-bold text-center py-1 flex items-center justify-center gap-1">
                  <Grid3X3 className="h-3 w-3" />
                  九宫格主图
                </div>
              )}

              {/* 序号 */}
              <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded">
                #{index + 1}
              </div>

              {/* 操作按钮 */}
              <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {index > 0 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="secondary"
                          onClick={() => handleMoveImage(index, "up")}
                          className="h-6 w-6 bg-black/70 hover:bg-black/90"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>上移</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {index < images.length - 1 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="secondary"
                          onClick={() => handleMoveImage(index, "down")}
                          className="h-6 w-6 bg-black/70 hover:bg-black/90"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>下移</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {index > 0 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="secondary"
                          onClick={() => handleSetMainGrid(img.id)}
                          className="h-6 w-6 bg-tiktok-cyan/70 hover:bg-tiktok-cyan text-black"
                        >
                          <Grid3X3 className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>设为主图</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="secondary"
                        onClick={() => handleRemoveImage(img.id)}
                        className="h-6 w-6 bg-red-500/70 hover:bg-red-500 text-white"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>删除</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          ))}

          {/* 添加更多 */}
          {images.length < maxImages && (
            <label className="aspect-square rounded-xl border-2 border-dashed border-border/50 hover:border-tiktok-cyan/50 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
                className="hidden"
              />
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">添加图片</span>
            </label>
          )}
        </div>
      )}

      {/* 空状态 - 上传区域 */}
      {images.length === 0 && (
        <label className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-border/50 hover:border-tiktok-cyan/30 rounded-xl cursor-pointer transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
            className="hidden"
          />
          <Upload className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-lg font-medium text-muted-foreground mb-1">点击或拖拽上传图片</p>
          <p className="text-sm text-muted-foreground/70">支持 JPG、PNG、WebP，最多 {maxImages} 张</p>
        </label>
      )}

      <p className="text-xs text-muted-foreground">
        已上传 {images.length}/{maxImages} 张图片
      </p>
    </div>
  );
}

// ============================================================================
// VideoTaskCard 组件 - 单个任务卡片
// ============================================================================

interface VideoTaskCardProps {
  task: VideoBatchTask;
  isSelected: boolean;
  onToggleSelect: () => void;
  onStart: () => void;
  onRemove: () => void;
  onClone: () => void;
  onViewScript: () => void;
  onEditImages: () => void;
  onPlayVideo: () => void;
  onDownload: () => void;
  // 全局配置信息
  modelType: VideoModelType;
  duration: VideoDuration;
  quality: VideoQuality;
  // 下载状态
  downloadProgress?: number; // 0-100 下载进度
  isDownloading?: boolean;
  isDownloaded?: boolean;
}

const VideoTaskCard = memo(function VideoTaskCard({
  task,
  isSelected,
  onToggleSelect,
  onStart,
  onRemove,
  onClone,
  onViewScript,
  onEditImages,
  onPlayVideo,
  onDownload,
  modelType: globalModelType,
  duration: globalDuration,
  quality: globalQuality,
  downloadProgress = 0,
  isDownloading = false,
  isDownloaded = false,
}: VideoTaskCardProps) {
  // 判断任务类型并验证
  const isPromptMode = task.mode === "prompt_to_video";
  const validation = isPromptMode ? validatePromptTask(task) : validateTaskImages(task.images);
  const canStart = task.status === "pending" && validation.valid;

  // 检测是否使用了 AI 模特（优先使用任务配置，兼容旧任务检测脚本内容）
  const hasAiModel = !!(
    task.useAiModel ||
    (task.doubaoTalkingScript && task.doubaoTalkingScript.includes('AI模特')) ||
    (task.doubaoAiVideoPrompt && task.doubaoAiVideoPrompt.includes('[AI MODEL:'))
  );

  // 使用任务自身的配置，如果不存在则回退到全局配置（兼容旧任务）
  const taskModelType = task.modelType || globalModelType;
  const taskDuration = task.duration || globalDuration;
  const taskQuality = task.quality || globalQuality;

  // 获取显示标签
  const getModelLabel = () => {
    if (taskModelType === "veo3") {
      return "8秒";
    } else if (taskModelType === "veo3-quality") {
      return "8秒 高清";
    } else if (taskModelType === "sora2") {
      return `${taskDuration}秒`;
    } else {
      // sora2-pro
      if (taskQuality === "hd") {
        return `${taskDuration}秒 高清`;
      }
      return `${taskDuration}秒`;
    }
  };

  const getStatusBadge = () => {
    const statusConfig: Record<string, { className: string; icon: React.ReactNode }> = {
      pending: { className: "bg-muted/50 text-muted-foreground", icon: null },
      uploading: { className: "bg-blue-500/10 text-blue-500 border-blue-500/30", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      generating_script: { className: "bg-purple-500/10 text-purple-500 border-purple-500/30", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      generating_prompt: { className: "bg-amber-500/10 text-amber-500 border-amber-500/30", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      generating_video: { className: "bg-tiktok-cyan/10 text-tiktok-cyan border-tiktok-cyan/30", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      success: { className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30", icon: <CheckCircle2 className="h-3 w-3" /> },
      failed: { className: "bg-red-500/10 text-red-500 border-red-500/30", icon: <XCircle className="h-3 w-3" /> },
    };

    const config = statusConfig[task.status];
    return (
      <Badge className={cn("text-xs", config.className)}>
        {config.icon}
        <span className="ml-1">{getStatusLabel(task.status)}</span>
      </Badge>
    );
  };

  return (
    <div
      className={cn(
        "group relative rounded-3xl border transition-all duration-500 overflow-hidden",
        isSelected
          ? "bg-[#0B0C10] border-mermaid-cyan/50 ring-1 ring-mermaid-cyan/50 shadow-[0_0_30px_rgba(0,242,234,0.15)] scale-[1.02]"
          : "bg-[#0B0C10] border-white/5 hover:border-mermaid-cyan/30 hover:shadow-[0_0_20px_rgba(0,242,234,0.05)] hover:-translate-y-1",
        task.status !== "pending" && task.status !== "success" && task.status !== "failed" && "ring-1 ring-mermaid-cyan/30 animate-pulse-subtle"
      )}
    >
      {/* 选择复选框 - Neon Checkbox */}
      <div
        onClick={onToggleSelect}
        className={cn(
          "absolute top-3 left-3 z-20 flex h-6 w-6 items-center justify-center rounded-lg border cursor-pointer transition-all duration-300",
          isSelected
            ? "bg-mermaid-cyan border-mermaid-cyan text-black shadow-[0_0_15px_rgba(0,242,234,0.5)]"
            : "border-white/20 bg-black/40 hover:border-mermaid-cyan/50 hover:bg-black/60"
        )}
      >
        {isSelected && <Check className="h-3 w-3" />}
      </div>

      {/* 预览区 - 视频成功时显示视频缩略图，否则显示图片 */}
      <div className="relative aspect-video bg-muted/30">
        {task.status === "success" && task.soraVideoUrl ? (
          /* 视频预览 - 横屏填满，带播放按钮 */
          <div
            className="absolute inset-0 cursor-pointer group/video"
            onClick={(e) => {
              e.stopPropagation();
              onPlayVideo();
            }}
          >
            <video
              src={task.soraVideoUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
            />
            {/* 播放按钮覆盖层 */}
            <div className="absolute inset-0 bg-black/30 group-hover/video:bg-black/50 transition-all flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover/video:scale-110 transition-transform">
                <Play className="h-7 w-7 text-black ml-1" />
              </div>
            </div>
            {/* 视频标识和下载状态 */}
            <div className="absolute top-2 right-2 flex items-center gap-1.5">
              {isDownloaded ? (
                <div className="bg-tiktok-cyan text-white text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 shadow-lg shadow-tiktok-cyan/30">
                  <CheckCircle2 className="h-3 w-3" />
                  已下载
                </div>
              ) : (
                <div className="bg-emerald-500 text-white text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <Video className="h-3 w-3" />
                  已生成
                </div>
              )}
            </div>

            {/* 下载进度条 */}
            {isDownloading && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 text-tiktok-cyan animate-spin shrink-0" />
                  <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink rounded-full transition-all duration-300"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/80 font-medium min-w-[32px] text-right">
                    {downloadProgress}%
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* 图片预览或提示词预览 */
          <div className="absolute inset-0" onClick={isPromptMode ? undefined : onEditImages}>
            {isPromptMode ? (
              /* 纯提示词模式显示 */
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-purple-500/20 to-pink-500/20 p-4">
                <FileText className="h-8 w-8 text-purple-400 mb-2" />
                <p className="text-xs text-purple-300 text-center line-clamp-3">
                  {task.customPrompt?.slice(0, 80)}...
                </p>
                {task.referenceImageUrl && (
                  <Badge variant="outline" className="mt-2 text-[10px] bg-purple-500/20 border-purple-500/30 text-purple-300">
                    含参考图
                  </Badge>
                )}
              </div>
            ) : task.images.length > 0 ? (
              <div className="absolute inset-0 grid grid-cols-3 gap-0.5 p-1">
                {task.images.slice(0, 6).map((img, index) => (
                  <div key={img.id} className="relative overflow-hidden rounded">
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                    {index === 0 && (
                      <div className="absolute inset-0 ring-2 ring-tiktok-cyan ring-inset" />
                    )}
                  </div>
                ))}
                {task.images.length > 6 && (
                  <div className="bg-black/70 flex items-center justify-center text-white text-sm font-medium rounded">
                    +{task.images.length - 6}
                  </div>
                )}
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <ImageIcon className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">无图片</p>
              </div>
            )}

            {/* 悬浮编辑层 */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">
              <span className="text-white text-sm font-medium">编辑素材</span>
            </div>
          </div>
        )}
      </div>

      {/* 卡片信息 - Titanium Body */}
      <div className="p-4 space-y-3 bg-[#0B0C10] border-t border-white/5 relative">
        {/* 状态和流水线进度 */}
        <div className="flex items-center justify-between gap-2">
          {getStatusBadge()}
          <PipelineProgress currentStep={task.currentStep} status={task.status} />
        </div>

        {/* 任务配置信息 */}
        <div className="flex flex-wrap gap-1.5">
          {isPromptMode ? (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 bg-purple-500/10 border-purple-500/30 text-purple-300">
              <FileText className="h-2.5 w-2.5" />
              提示词模式
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1">
              <ImageIcon className="h-2.5 w-2.5" />
              {task.images.length} 张图片
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            {task.aspectRatio}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            {getModelLabel()}
          </Badge>
          {taskModelType === "sora2-pro" && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-purple-500/10 border-purple-500/30 text-purple-400">
              Pro
            </Badge>
          )}
          {(taskModelType === "veo3" || taskModelType === "veo3-quality") && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-teal-500/10 border-teal-500/30 text-teal-400">
              VEO3
            </Badge>
          )}
          {hasAiModel && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 bg-pink-500/10 border-pink-500/30 text-pink-400">
              <span className="text-[10px]">👤</span>
              AI模特
            </Badge>
          )}
        </div>

        {/* 生成结果标记 */}
        <div className="flex gap-2">
          {task.doubaoTalkingScript && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="text-[10px] h-5 px-1.5 gap-1 bg-purple-500/10 border-purple-500/30 text-purple-400 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewScript();
                    }}
                  >
                    <FileText className="h-2.5 w-2.5" />
                    脚本
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>点击查看口播脚本</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {task.doubaoAiVideoPrompt && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="text-[10px] h-5 px-1.5 gap-1 bg-amber-500/10 border-amber-500/30 text-amber-400 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewScript();
                    }}
                  >
                    <Wand2 className="h-2.5 w-2.5" />
                    提示词
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>点击查看AI视频提示词</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* 校验错误 */}
        {!validation.valid && task.status === "pending" && (
          <p className="text-[10px] text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {validation.error}
          </p>
        )}

        {/* 错误信息 */}
        {task.errorMessage && (
          <p className="text-[10px] text-red-400 flex items-center gap-1 line-clamp-2">
            <XCircle className="h-3 w-3 shrink-0" />
            {task.errorMessage}
          </p>
        )}

        {/* 操作栏 */}
        <div className="flex items-center justify-end pt-1">
          <div className="flex items-center gap-1">
            {/* 开始按钮 */}
            {canStart && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStart();
                      }}
                      className="h-7 w-7 text-tiktok-cyan hover:text-tiktok-cyan hover:bg-tiktok-cyan/10"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>开始生成</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* 克隆按钮 */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClone();
                    }}
                    className="h-7 w-7 text-blue-400 hover:text-blue-400 hover:bg-blue-400/10"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>克隆任务</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* 查看脚本按钮 */}
            {(task.doubaoTalkingScript || task.doubaoAiVideoPrompt) && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewScript();
                      }}
                      className="h-7 w-7 text-purple-400 hover:text-purple-400 hover:bg-purple-400/10"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>查看详情</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* 下载按钮 */}
            {task.status === "success" && task.soraVideoUrl && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload();
                      }}
                      className="h-7 w-7 text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>下载视频</TooltipContent>
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
                <TooltipContent>删除任务</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// VideoPlayerDialog 组件 - 视频全屏播放弹窗
// ============================================================================

interface VideoPlayerDialogProps {
  task: VideoBatchTask | null;
  open: boolean;
  onClose: () => void;
  onDownload: (task: VideoBatchTask) => void;
}

function VideoPlayerDialog({ task, open, onClose, onDownload }: VideoPlayerDialogProps) {
  const [downloading, setDownloading] = useState(false);

  if (!task || !task.soraVideoUrl) return null;

  // 获取视频时长和清晰度显示文字
  const getDurationLabel = () => {
    const duration = task.duration || 15;
    const quality = task.quality || "standard";
    const modelType = task.modelType || "sora2";

    if (modelType === "veo3") {
      return "8秒";
    } else if (modelType === "veo3-quality") {
      return "8秒 高清";
    } else if (modelType === "sora2-pro") {
      if (quality === "hd") return `${duration}秒 高清`;
      return `${duration}秒 标清`;
    }
    return `${duration}秒`;
  };

  const handleDownload = async () => {
    setDownloading(true);
    await onDownload(task);
    setDownloading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 bg-background border-border overflow-hidden">
        <div className="relative">
          {/* 视频播放器 */}
          <video
            src={task.soraVideoUrl}
            controls
            autoPlay
            className="w-full max-h-[80vh] bg-black"
          />

          {/* 底部操作栏 - 使用不透明背景确保文字可见 */}
          <div className="border-t border-border bg-background p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  生成成功
                </Badge>
                <Badge variant="outline" className="text-xs text-foreground border-border">
                  {task.aspectRatio}
                </Badge>
                <Badge variant="outline" className="text-xs text-foreground border-border">
                  {getDurationLabel()}
                </Badge>
              </div>

              {/* 下载按钮 */}
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {downloading ? "下载中..." : "下载视频"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// ScriptPreviewDialog 组件 - 脚本预览弹窗
// ============================================================================

interface ScriptPreviewDialogProps {
  task: VideoBatchTask | null;
  open: boolean;
  onClose: () => void;
}

function ScriptPreviewDialog({ task, open, onClose }: ScriptPreviewDialogProps) {
  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden bg-black/95 border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-purple-400" />
            任务详情
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[60vh] pr-2">
          {/* 口播脚本 */}
          {task.doubaoTalkingScript && (
            <div>
              <h4 className="text-sm font-semibold text-purple-400 mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                口播脚本 (C01-C07)
              </h4>
              <pre className="p-4 rounded-lg bg-muted/30 border border-border/50 text-sm whitespace-pre-wrap font-mono">
                {task.doubaoTalkingScript}
              </pre>
            </div>
          )}

          {/* AI视频提示词 */}
          {task.doubaoAiVideoPrompt && (
            <div>
              <h4 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                AI 视频提示词
              </h4>
              <pre className="p-4 rounded-lg bg-muted/30 border border-border/50 text-sm whitespace-pre-wrap font-mono">
                {task.doubaoAiVideoPrompt}
              </pre>
            </div>
          )}

          {/* 视频结果 */}
          {task.soraVideoUrl && (
            <div>
              <h4 className="text-sm font-semibold text-tiktok-cyan mb-2 flex items-center gap-2">
                <Film className="h-4 w-4" />
                生成视频
              </h4>
              <video src={task.soraVideoUrl} controls className="w-full rounded-lg" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 批量下载进度对话框
// ============================================================================

interface DownloadProgressDialogProps {
  progress: {
    show: boolean;
    total: number;
    current: number;
    success: number;
    failed: number;
    currentFilename: string;
    startTime: number;
    cancelled: boolean;
  };
  onCancel: () => void;
  onClose: () => void;
}

function DownloadProgressDialog({ progress, onCancel, onClose }: DownloadProgressDialogProps) {
  const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const isComplete = progress.current >= progress.total;

  // 计算预估剩余时间
  const getEstimatedTime = () => {
    if (progress.current === 0 || progress.startTime === 0) return "计算中...";
    const elapsed = Date.now() - progress.startTime;
    const avgTimePerItem = elapsed / progress.current;
    const remaining = progress.total - progress.current;
    const estimatedMs = remaining * avgTimePerItem;

    if (estimatedMs < 60000) {
      return `约 ${Math.ceil(estimatedMs / 1000)} 秒`;
    } else {
      return `约 ${Math.ceil(estimatedMs / 60000)} 分钟`;
    }
  };

  return (
    <Dialog
      open={progress.show}
      onOpenChange={(open) => {
        if (!open) {
          // 允许在任何时候关闭对话框
          if (!isComplete && !progress.cancelled) {
            onCancel(); // 同时取消下载
          }
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md bg-black/95 border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isComplete ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : progress.cancelled ? (
              <XCircle className="h-5 w-5 text-red-500" />
            ) : (
              <Download className="h-5 w-5 text-tiktok-cyan animate-pulse" />
            )}
            {isComplete ? "下载完成" : progress.cancelled ? "下载已取消" : "批量下载中"}
          </DialogTitle>
          <DialogDescription>
            {isComplete
              ? `成功调起 ${progress.success} 个下载任务${progress.failed > 0 ? `，${progress.failed} 个失败` : ""}，请在浏览器下载列表查看进度`
              : progress.cancelled
                ? `已调起 ${progress.success} 个下载任务`
                : "正在调起下载任务，实际下载进度请查看浏览器下载列表"
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 进度条 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">下载进度</span>
              <span className="font-mono font-semibold text-tiktok-cyan">
                {progress.current} / {progress.total}
              </span>
            </div>
            <div className="h-3 bg-muted/30 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  isComplete
                    ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                    : progress.cancelled
                      ? "bg-gradient-to-r from-red-500 to-red-400"
                      : "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink"
                )}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="text-center text-2xl font-bold text-white">
              {percentage}%
            </div>
          </div>

          {/* 统计信息 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
              <div className="text-2xl font-bold text-emerald-400">{progress.success}</div>
              <div className="text-xs text-muted-foreground">成功</div>
            </div>
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
              <div className="text-2xl font-bold text-red-400">{progress.failed}</div>
              <div className="text-xs text-muted-foreground">失败</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 text-center">
              <div className="text-2xl font-bold text-muted-foreground">
                {progress.total - progress.current}
              </div>
              <div className="text-xs text-muted-foreground">剩余</div>
            </div>
          </div>

          {/* 当前文件名 & 预估时间 */}
          {!isComplete && !progress.cancelled && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3 w-3 animate-spin text-tiktok-cyan" />
                <span className="text-muted-foreground truncate flex-1">
                  {progress.currentFilename || "准备中..."}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-3 w-3 text-amber-400" />
                <span className="text-muted-foreground">
                  预计剩余: <span className="text-amber-400 font-medium">{getEstimatedTime()}</span>
                </span>
              </div>
            </div>
          )}

          {/* 失败提示 */}
          {progress.failed > 0 && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-200">
                  {progress.failed} 个视频下载失败，已自动在新窗口打开，您可以手动保存
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {isComplete || progress.cancelled ? (
            <Button
              onClick={onClose}
              className="w-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold"
            >
              关闭
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() => {
                onCancel();
                onClose();
              }}
              className="w-full"
            >
              <X className="h-4 w-4 mr-2" />
              取消下载
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 主页面
// ============================================================================

export default function VideoBatchPage() {
  const { toast } = useToast();

  // Store
  const tasks = useVideoBatchTasks();
  const _jobStatus = useVideoBatchJobStatus(); // 保留供未来批量功能使用
  const globalSettings = useVideoBatchGlobalSettings();
  const selectedTaskIds = useVideoBatchSelectedIds();
  const selectedCount = useVideoBatchSelectedCount();
  const stats = useVideoBatchStats();
  const activeGroupName = useVideoBatchActiveGroup();
  const activeGroupTasks = useActiveGroupTasks();
  const activeGroupStats = useActiveGroupStats();
  void _jobStatus; // suppress unused warning

  const {
    createTask,
    createTaskFromPrompt,
    cloneTask,
    updateTaskStatus,
    updateTaskImages,
    removeTask,
    clearAllTasks,
    toggleTaskSelection,
    selectAllTasks,
    clearSelection,
    removeSelectedTasks,
    resetBatch,
    updateGlobalSettings,
    setActiveGroup,
    removeGroup,
    getGroups,
  } = useVideoBatchStore();

  // Local State
  const [userId, setUserId] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState(0);
  const [previewTask, setPreviewTask] = useState<VideoBatchTask | null>(null);
  const [playingVideoTask, setPlayingVideoTask] = useState<VideoBatchTask | null>(null);
  const [editingImages, setEditingImages] = useState<TaskImageInfo[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTaskImages, setNewTaskImages] = useState<TaskImageInfo[]>([]);
  const [batchCreateCount, setBatchCreateCount] = useState(1);

  // 纯提示词创建模式
  const [createMode, setCreateMode] = useState<"image" | "prompt">("prompt");

  // 轮播视频状态
  const [slideshowMode, setSlideshowMode] = useState<SlideshowMode>('random');
  const [slideshowPositions, setSlideshowPositions] = useState<Position[]>([]);
  const [slideshowImages, setSlideshowImages] = useState<File[]>([]);
  const [slideshowImagesPerVideo, setSlideshowImagesPerVideo] = useState(5);
  const [slideshowMusicMode, setSlideshowMusicMode] = useState<MusicMode>('preset');
  const [slideshowCustomMusic, setSlideshowCustomMusic] = useState<File[]>([]);
  const [slideshowTransition, setSlideshowTransition] = useState<TransitionEffect>('fade');
  const [slideshowDuration, setSlideshowDuration] = useState(3); // 每张图片时长2-10秒
  const [slideshowAspectRatio, setSlideshowAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [slideshowSubtitle, setSlideshowSubtitle] = useState<SubtitleConfig | null>(null);
  const [isSlideshowGenerating, setIsSlideshowGenerating] = useState(false);

  const [promptInput, setPromptInput] = useState("");
  const [groupNameInput, setGroupNameInput] = useState(""); // 分组名称
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState("");

  // 删除任务组确认弹窗
  const [deleteGroupDialog, setDeleteGroupDialog] = useState<{ open: boolean; groupName: string; count: number }>({
    open: false,
    groupName: "",
    count: 0,
  });


  // 批量下载状态
  const [isDownloading, setIsDownloading] = useState(false);
  // 批量开始状态
  const [isBatchStarting, setIsBatchStarting] = useState(false);
  // 线路检测弹窗状态
  const [showSpeedTest, setShowSpeedTest] = useState(false);

  // Template State
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);

  // Template Handlers
  const handleSaveTemplate = async (name: string, description: string) => {
    try {
      setIsUploadingTemplate(true);

      // 上传素材图片到 OSS（如果有 blob URL）
      const uploadedImages: Array<{ url: string; name: string; order: number; isMainGrid: boolean }> = [];
      for (const img of newTaskImages) {
        if (img.url.startsWith('blob:')) {
          // 需要上传
          try {
            const blobResponse = await fetch(img.url);
            const blob = await blobResponse.blob();
            const formData = new FormData();
            formData.append('file', blob, img.name);
            const uploadRes = await fetch('/api/upload/image', {
              method: 'POST',
              body: formData,
            });
            const uploadResult = await uploadRes.json();
            if (uploadResult.success && uploadResult.data?.url) {
              uploadedImages.push({
                url: uploadResult.data.url,
                name: img.name,
                order: img.order,
                isMainGrid: img.isMainGrid,
              });
            }
          } catch (uploadErr) {
            console.error('Upload image failed:', uploadErr);
          }
        } else {
          // 已经是远程 URL，直接使用
          uploadedImages.push({
            url: img.url,
            name: img.name,
            order: img.order,
            isMainGrid: img.isMainGrid,
          });
        }
      }

      // 上传参考图（纯提示词模式）
      let savedReferenceImageUrl = "";
      if (createMode === "prompt" && referenceImageFile) {
        try {
          const formData = new FormData();
          formData.append('file', referenceImageFile);
          const uploadRes = await fetch('/api/upload/image', {
            method: 'POST',
            body: formData,
          });
          const uploadResult = await uploadRes.json();
          if (uploadResult.success && uploadResult.data?.url) {
            savedReferenceImageUrl = uploadResult.data.url;
          }
        } catch (uploadErr) {
          console.error('Upload reference image failed:', uploadErr);
        }
      } else if (createMode === "prompt" && referenceImageUrl && !referenceImageUrl.startsWith('blob:')) {
        // 已经是远程 URL
        savedReferenceImageUrl = referenceImageUrl;
      }

      // 准备保存配置
      const configToSave = {
        globalSettings: {
          modelType: globalSettings.modelType,
          duration: globalSettings.duration,
          quality: globalSettings.quality,
          aspectRatio: globalSettings.aspectRatio,
          apiLine: globalSettings.apiLine, // 新增：API 线路
          useAiModel: useAiModel,
          aiModelId: selectedModelId,
          aiModelName: selectedModelName,
          aiModelTriggerWord: selectedModelTriggerWord,
        },
        createMode,
        createPrompt: promptInput,
        createCount: batchCreateCount,
        groupNameTemplate: groupNameInput,
        templateImages: uploadedImages,
        referenceImageUrl: savedReferenceImageUrl, // 新增：参考图持久化 URL
        savedAt: new Date().toISOString(),
      };

      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          type: 'video_batch',
          config: configToSave
        })
      });

      if (!res.ok) {
        let errorMessage = '保存失败';
        try {
          const data = await res.json();
          errorMessage = data.error || data.message || res.statusText || '保存失败';
        } catch (e) {
          errorMessage = await res.text() || res.statusText || '保存失败';
        }
        throw new Error(errorMessage);
      }

      toast({
        title: "✅ 方案已保存",
        description: `"${name}" 包含 ${uploadedImages.length} 张图片`,
      });
      setShowSaveTemplate(false);
    } catch (e) {
      console.error('Save template error:', e);
      toast({
        variant: "destructive",
        title: "保存失败",
        description: e instanceof Error ? e.message : "无法保存您的方案，请重试"
      });
    } finally {
      setIsUploadingTemplate(false);
    }
  };

  const handleLoadTemplate = (template: Template) => {
    try {
      const config = template.config;

      // 恢复全局设置
      if (config.globalSettings) {
        const gs = config.globalSettings;
        if (gs.modelType) updateGlobalSettings('modelType', gs.modelType);
        if (gs.duration) updateGlobalSettings('duration', gs.duration);
        if (gs.quality) updateGlobalSettings('quality', gs.quality);
        if (gs.aspectRatio) updateGlobalSettings('aspectRatio', gs.aspectRatio);
        if (gs.apiLine) updateGlobalSettings('apiLine', gs.apiLine); // 新增：API 线路
      }

      // 恢复 AI 模特
      if (config.globalSettings?.useAiModel && config.globalSettings?.aiModelId) {
        setUseAiModel(true);
        setSelectedModelId(config.globalSettings.aiModelId);
        setSelectedModelName(config.globalSettings.aiModelName);
        setSelectedModelTriggerWord(config.globalSettings.aiModelTriggerWord);
      } else {
        setUseAiModel(false);
        setSelectedModelId(null);
        setSelectedModelName(null);
        setSelectedModelTriggerWord(null);
      }

      // 恢复创建模式
      if (config.createMode) setCreateMode(config.createMode);

      // 恢复提示词
      if (config.createPrompt) setPromptInput(config.createPrompt);

      // 恢复批量数量
      if (config.createCount) setBatchCreateCount(config.createCount);

      // 恢复分组名称
      if (config.groupNameTemplate) setGroupNameInput(config.groupNameTemplate);

      // 恢复素材图片（从 OSS URL）
      if (config.templateImages && config.templateImages.length > 0) {
        const restoredImages: TaskImageInfo[] = config.templateImages.map((img: any, index: number) => ({
          id: `restored-${Date.now()}-${index}`,
          url: img.url,
          name: img.name,
          order: img.order ?? index,
          isMainGrid: img.isMainGrid ?? (index === 0),
        }));
        setNewTaskImages(restoredImages);
      }

      // 恢复参考图（纯提示词模式）
      if (config.referenceImageUrl) {
        setReferenceImageUrl(config.referenceImageUrl);
        setReferenceImageFile(null); // 远程图片没有 File 对象
      } else {
        setReferenceImageUrl("");
        setReferenceImageFile(null);
      }

      // 关闭方案管理器
      setShowTemplateManager(false);

      // 自动打开创建任务弹窗
      setShowCreateDialog(true);

      toast({
        title: "✅ 方案已加载",
        description: `"${template.name}" 的配置已填充，可直接创建任务`,
      });
    } catch (e) {
      console.error('Load template error:', e);
      toast({
        variant: "destructive",
        title: "加载失败",
        description: "方案数据格式可能已过期"
      });
    }
  };

  // 单个下载进度状态
  const [downloadingTaskId, setDownloadingTaskId] = useState<string | null>(null);

  // 每个任务的下载进度 { taskId: progress (0-100) }
  const [taskDownloadProgress, setTaskDownloadProgress] = useState<Record<string, number>>({});
  // 正在下载的任务ID集合
  const [downloadingTaskIds, setDownloadingTaskIds] = useState<Set<string>>(new Set());
  // 已下载的任务ID集合（从 localStorage 恢复）
  const [downloadedTaskIds, setDownloadedTaskIds] = useState<Set<string>>(new Set());

  // 批量下载进度状态
  const [downloadProgress, setDownloadProgress] = useState<{
    show: boolean;
    total: number;
    current: number;
    success: number;
    failed: number;
    currentFilename: string;
    startTime: number;
    cancelled: boolean;
  }>({
    show: false,
    total: 0,
    current: 0,
    success: 0,
    failed: 0,
    currentFilename: "",
    startTime: 0,
    cancelled: false,
  });

  // 取消下载的ref
  const cancelDownloadRef = useRef(false);

  // 生成简化文件名的辅助函数（支持分组前缀）
  const generateSimpleFilename = useCallback((task: VideoBatchTask, index?: number) => {
    const aspectStr = task.aspectRatio.replace(":", "x");
    const durationStr = `${task.duration || 15}s`;

    // 如果有分组名，计算组内序号；否则使用全局序号
    let seq: number;
    if (task.groupName) {
      // 获取同组任务，计算组内序号
      const groupTasks = tasks.filter(t => t.groupName === task.groupName);
      seq = index !== undefined ? index + 1 : groupTasks.findIndex(t => t.id === task.id) + 1;
      // 返回带分组前缀的文件名
      return `${task.groupName}-视频${seq}-${aspectStr}-${durationStr}.mp4`;
    }

    // 无分组时使用全局序号
    seq = index !== undefined ? index + 1 : tasks.findIndex(t => t.id === task.id) + 1;
    return `视频-${seq}-${aspectStr}-${durationStr}.mp4`;
  }, [tasks]);

  // 通过代理下载视频（现在改为利用后端的302重定向直连）
  const downloadVideoViaProxy = useCallback(async (url: string, filename: string, routeId?: string): Promise<boolean> => {
    try {
      // 构建代理URL，包含线路参数
      const params = new URLSearchParams({
        url,
        filename,
        ...(routeId && { route: routeId }),
      });
      const proxyUrl = `/api/download-proxy?${params}`;

      // 直接触发浏览器下载行为，而不是 fetch 到内存中
      // 这样可以利用浏览器原生下载管理器，支持断点续传且速度极快
      const link = document.createElement("a");
      link.href = proxyUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      return true;
    } catch (error) {
      console.error("[Proxy Download] Failed:", error);
      return false;
    }
  }, []);

  // 直接下载视频（备选方案，尝试直接请求源站）
  const downloadVideoDirect = useCallback(async (url: string, filename: string): Promise<boolean> => {
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank"; // 增加 target="_blank" 确保不影响当前页面
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    } catch (error) {
      console.error("[Direct Download] Failed:", error);
      return false;
    }
  }, []);

  // 在新窗口打开视频（最后备选方案）
  const openVideoInNewTab = useCallback((url: string) => {
    window.open(url, "_blank");
  }, []);

  // ========== 内置多线程下载（类似 IDM） ==========
  const [multiThreadProgress, setMultiThreadProgress] = useState<{
    show: boolean;
    filename: string;
    totalSize: number;
    downloadedSize: number;
    threads: number;
    speed: number;
    startTime: number;
  }>({
    show: false,
    filename: "",
    totalSize: 0,
    downloadedSize: 0,
    threads: 4,
    speed: 0,
    startTime: 0,
  });

  // 多线程下载单个视频
  const downloadWithMultiThread = useCallback(async (
    url: string,
    filename: string,
    threads: number = 4,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<boolean> => {
    try {
      console.log(`[Multi-Thread] Starting download: ${filename} with ${threads} threads`);

      // 1. 获取文件信息
      const infoParams = new URLSearchParams({ url, mode: "info" });
      let info;
      try {
        const infoRes = await fetch(`/api/download-proxy?${infoParams}`);
        info = await infoRes.json();
        console.log(`[Multi-Thread] File info:`, info);
      } catch (e) {
        console.error("[Multi-Thread] Failed to get file info:", e);
        // 回退到普通下载
        return await downloadVideoViaProxy(url, filename);
      }

      if (!info.size || info.size === 0) {
        console.log("[Multi-Thread] Cannot get file size, falling back to normal download");
        return await downloadVideoViaProxy(url, filename);
      }

      const fileSize = info.size;
      console.log(`[Multi-Thread] File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

      // 如果文件小于 2MB，直接普通下载
      if (fileSize < 2 * 1024 * 1024) {
        console.log("[Multi-Thread] File too small, using normal download");
        return await downloadVideoViaProxy(url, filename);
      }

      // 2. 计算分片
      const chunkSize = Math.ceil(fileSize / threads);
      const chunks: { start: number; end: number; index: number }[] = [];

      for (let i = 0; i < threads; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, fileSize - 1);
        chunks.push({ start, end, index: i });
      }

      console.log(`[Multi-Thread] Chunks:`, chunks.map(c => `${c.start}-${c.end}`));

      // 3. 并行下载所有分片
      let totalDownloaded = 0;
      const chunkData: ArrayBuffer[] = new Array(threads);

      const downloadChunk = async (chunk: { start: number; end: number; index: number }) => {
        console.log(`[Multi-Thread] Downloading chunk ${chunk.index}: ${chunk.start}-${chunk.end}`);

        const params = new URLSearchParams({
          url,
          mode: "chunk",
          start: chunk.start.toString(),
          end: chunk.end.toString(),
        });

        const response = await fetch(`/api/download-proxy?${params}`);
        if (!response.ok) {
          console.error(`[Multi-Thread] Chunk ${chunk.index} failed: ${response.status}`);
          throw new Error(`Chunk ${chunk.index} failed: ${response.status}`);
        }

        const data = await response.arrayBuffer();
        chunkData[chunk.index] = data;

        totalDownloaded += data.byteLength;
        console.log(`[Multi-Thread] Chunk ${chunk.index} done: ${data.byteLength} bytes, total: ${totalDownloaded}/${fileSize}`);
        onProgress?.(totalDownloaded, fileSize);

        return data;
      };

      try {
        await Promise.all(chunks.map(downloadChunk));
      } catch (e) {
        console.error("[Multi-Thread] Chunk download failed:", e);
        // 回退到普通下载
        return await downloadVideoViaProxy(url, filename);
      }

      // 4. 合并分片
      console.log("[Multi-Thread] Merging chunks...");
      const totalLength = chunkData.reduce((acc, arr) => acc + (arr?.byteLength || 0), 0);
      const mergedData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunkData) {
        if (chunk) {
          mergedData.set(new Uint8Array(chunk), offset);
          offset += chunk.byteLength;
        }
      }

      // 5. 触发下载
      console.log("[Multi-Thread] Creating blob and downloading...");
      const blob = new Blob([mergedData], { type: "video/mp4" });
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

      console.log(`[Multi-Thread] Download complete: ${filename}`);
      return true;
    } catch (error) {
      console.error("[Multi-Thread] Error:", error);
      // 最后回退
      return await downloadVideoViaProxy(url, filename);
    }
  }, [downloadVideoViaProxy]);

  // 极速下载 - 前端直接 fetch CDN + blob（绕过服务器，直连CDN）
  // 添加超时机制，避免卡住
  const downloadFastViaCDN = useCallback(async (url: string, filename: string): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时

    try {
      console.log("[Fast Download] Fetching from CDN directly (8s timeout)...");

      // 直接 fetch CDN（不经过我们的服务器）
      const response = await fetch(url, {
        mode: "cors",
        credentials: "omit",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // 将响应转换为 blob（设置额外超时）
      const blobPromise = response.blob();
      const blobTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Blob timeout")), 30000) // 30秒 blob 超时
      );

      const blob = await Promise.race([blobPromise, blobTimeoutPromise]);
      const blobUrl = URL.createObjectURL(blob);

      // 使用 <a> 标签触发下载
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 清理 blob URL
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

      console.log("[Fast Download] Success via direct CDN fetch");
      return true;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        console.warn("[Fast Download] Timeout - CDN too slow or blocked");
      } else {
        console.warn("[Fast Download] CDN fetch failed:", error);
      }
      return false;
    }
  }, []);

  // 智能下载视频 - 优先直连CDN，速度最快
  const downloadVideo = useCallback(async (url: string, filename: string, mode: "fast" | "named" = "fast"): Promise<boolean> => {
    if (mode === "named") {
      // 命名下载模式：走代理，可以指定文件名，但较慢
      console.log("[Download] Named mode: using proxy for custom filename...");
      return await downloadVideoViaProxy(url, filename);
    }

    // 极速下载模式：优先尝试直连CDN
    console.log("[Download] Fast mode: trying direct CDN fetch...");

    // 先尝试直接 fetch CDN（速度最快）
    const fastSuccess = await downloadFastViaCDN(url, filename);
    if (fastSuccess) {
      return true;
    }

    // 如果直连失败（CORS问题），回退到代理下载
    console.log("[Download] Falling back to proxy download...");
    return await downloadVideoViaProxy(url, filename);
  }, [downloadVideoViaProxy, downloadFastViaCDN]);

  // 下载单个任务的视频
  const handleDownloadTask = useCallback(async (task: VideoBatchTask, mode: "fast" | "named" = "fast") => {
    if (!task.soraVideoUrl) {
      toast({ variant: "destructive", title: "视频未生成" });
      return;
    }

    const filename = generateSimpleFilename(task);
    setDownloadingTaskId(task.id);

    if (mode === "fast") {
      toast({
        title: `🚀 极速下载中...`,
        description: `正在直连CDN获取视频`
      });
    } else {
      toast({
        title: `📁 命名下载`,
        description: `正在下载: ${filename}（通过代理）`
      });
    }

    const success = await downloadVideo(task.soraVideoUrl, filename, mode);
    setDownloadingTaskId(null);

    if (success) {
      toast({
        title: `✅ 下载成功`,
        description: filename,
      });
    } else {
      toast({
        variant: "destructive",
        title: `下载失败`,
        description: "请尝试右键视频另存为...",
      });
    }
  }, [downloadVideo, generateSimpleFilename, toast]);

  // AI模特功能 - 使用 store 中的全局设置
  const useAiModel = globalSettings.useAiModel;
  const selectedModelId = globalSettings.aiModelId;
  const selectedModelName = globalSettings.aiModelName;  // 显示名称（从 store 获取）
  const selectedModelTriggerWord = globalSettings.aiModelTriggerWord;  // 触发词（后台使用）
  const selectedModelCover = globalSettings.aiModelCover; // Assuming this exists in globalSettings
  const [hiredModels, setHiredModels] = useState<Array<{ id: string; name: string; trigger_word: string; avatar_url: string }>>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);

  // 提示词配置
  const [showPromptConfig, setShowPromptConfig] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<string>("default");
  const [customPrompts, setCustomPrompts] = useState<{
    talkingScriptSystem: string;
    talkingScriptUser: string;
    aiVideoPromptSystem: string;
    aiVideoPromptUser: string;
  }>({
    talkingScriptSystem: "",
    talkingScriptUser: "",
    aiVideoPromptSystem: "",
    aiVideoPromptUser: "",
  });

  // 预设视频风格 - 统一限制条件
  // 第二步脚本生成：7行(C01-C07)，每行<150字符，解释<300字符
  // 第三步视频提示：7行(C01-C07)，每行<50字符，无解释
  const VIDEO_STYLES = [
    {
      id: "default",
      name: "默认风格",
      description: "标准口播带货风格",
      icon: "🎬",
      prompts: {
        talkingScriptSystem: "",
        talkingScriptUser: "",
        aiVideoPromptSystem: "",
        aiVideoPromptUser: "",
      }
    },
    {
      id: "energetic",
      name: "活力种草",
      description: "热情活泼，快节奏卖点展示",
      icon: "🔥",
      prompts: {
        talkingScriptSystem: `TikTok script writer. High-energy style.
OUTPUT RULES: Exactly 7 shots (C01-C07). Each shot <150 chars. Total explanation <300 chars.`,
        talkingScriptUser: `Write energetic product script. Fast-paced, urgent, exciting.
FORMAT: C01: [visual] [action] [line] ... up to C07. Each shot under 150 characters.`,
        aiVideoPromptSystem: "Output ONLY 7 lines. Each line under 50 chars. No intro, no explanation.",
        aiVideoPromptUser: `Convert to 7 Sora shots with energetic style:
{{SCRIPT}}

RULES: Output EXACTLY this format, nothing else:
C01: [quick camera move, energetic action, <50 chars]
C02: [dynamic gesture, bright lighting, <50 chars]
C03: [fast cut, excited expression, <50 chars]
C04: [product highlight, enthusiasm, <50 chars]
C05: [demo action, energy, <50 chars]
C06: [benefit showcase, upbeat, <50 chars]
C07: [strong CTA, urgency, <50 chars]`,
      }
    },
    {
      id: "luxury",
      name: "高端质感",
      description: "奢华精致，强调品质感",
      icon: "💎",
      prompts: {
        talkingScriptSystem: `TikTok script writer. Luxury, elegant style.
OUTPUT RULES: Exactly 7 shots (C01-C07). Each shot <150 chars. Total explanation <300 chars.`,
        talkingScriptUser: `Write premium product script. Sophisticated, refined, exclusive.
FORMAT: C01: [visual] [action] [line] ... up to C07. Each shot under 150 characters.`,
        aiVideoPromptSystem: "Output ONLY 7 lines. Each line under 50 chars. No intro, no explanation.",
        aiVideoPromptUser: `Convert to 7 Sora shots with luxury style:
{{SCRIPT}}

RULES: Output EXACTLY this format, nothing else:
C01: [elegant opening, soft lighting, <50 chars]
C02: [slow reveal, premium feel, <50 chars]
C03: [detail closeup, quality focus, <50 chars]
C04: [refined movement, sophistication, <50 chars]
C05: [luxury demo, grace, <50 chars]
C06: [exclusive appeal, elegance, <50 chars]
C07: [premium CTA, refined, <50 chars]`,
      }
    },
    {
      id: "friendly",
      name: "闺蜜分享",
      description: "亲切自然，像朋友推荐",
      icon: "💕",
      prompts: {
        talkingScriptSystem: `TikTok script writer. Warm, friendly style.
OUTPUT RULES: Exactly 7 shots (C01-C07). Each shot <150 chars. Total explanation <300 chars.`,
        talkingScriptUser: `Write friendly product script. Like chatting with best friend, casual, warm.
FORMAT: C01: [visual] [action] [line] ... up to C07. Each shot under 150 characters.`,
        aiVideoPromptSystem: "Output ONLY 7 lines. Each line under 50 chars. No intro, no explanation.",
        aiVideoPromptUser: `Convert to 7 Sora shots with friendly style:
{{SCRIPT}}

RULES: Output EXACTLY this format, nothing else:
C01: [casual greeting, warm smile, <50 chars]
C02: [natural pose, cozy vibe, <50 chars]
C03: [genuine reaction, relatable, <50 chars]
C04: [friendly demo, personal touch, <50 chars]
C05: [honest review, warmth, <50 chars]
C06: [recommendation, caring tone, <50 chars]
C07: [soft CTA, friendly invite, <50 chars]`,
      }
    },
    {
      id: "professional",
      name: "专业测评",
      description: "客观详细，专业角度分析",
      icon: "📊",
      prompts: {
        talkingScriptSystem: `TikTok script writer. Professional reviewer style.
OUTPUT RULES: Exactly 7 shots (C01-C07). Each shot <150 chars. Total explanation <300 chars.`,
        talkingScriptUser: `Write professional review script. Objective, informative, credible.
FORMAT: C01: [visual] [action] [line] ... up to C07. Each shot under 150 characters.`,
        aiVideoPromptSystem: "Output ONLY 7 lines. Each line under 50 chars. No intro, no explanation.",
        aiVideoPromptUser: `Convert to 7 Sora shots with professional style:
{{SCRIPT}}

RULES: Output EXACTLY this format, nothing else:
C01: [clean intro, professional setup, <50 chars]
C02: [product overview, clear framing, <50 chars]
C03: [spec highlight, steady shot, <50 chars]
C04: [detailed demo, informative, <50 chars]
C05: [comparison point, objective, <50 chars]
C06: [expert verdict, credible, <50 chars]
C07: [professional CTA, trustworthy, <50 chars]`,
      }
    },
    {
      id: "storytelling",
      name: "故事叙述",
      description: "情感共鸣，讲述使用场景",
      icon: "📖",
      prompts: {
        talkingScriptSystem: `TikTok script writer. Storyteller, emotional style.
OUTPUT RULES: Exactly 7 shots (C01-C07). Each shot <150 chars. Total explanation <300 chars.`,
        talkingScriptUser: `Write story-driven product script. Emotional narrative, relatable scenarios.
FORMAT: C01: [visual] [action] [line] ... up to C07. Each shot under 150 characters.`,
        aiVideoPromptSystem: "Output ONLY 7 lines. Each line under 50 chars. No intro, no explanation.",
        aiVideoPromptUser: `Convert to 7 Sora shots with storytelling style:
{{SCRIPT}}

RULES: Output EXACTLY this format, nothing else:
C01: [scene setting, mood establish, <50 chars]
C02: [problem intro, relatable, <50 chars]
C03: [discovery moment, cinematic, <50 chars]
C04: [solution demo, emotional, <50 chars]
C05: [transformation, lifestyle, <50 chars]
C06: [happy ending, satisfaction, <50 chars]
C07: [story CTA, inspiring, <50 chars]`,
      }
    },
  ];

  // 加载本地存储的提示词配置
  useEffect(() => {
    const savedPrompts = localStorage.getItem("video-batch-custom-prompts");
    if (savedPrompts) {
      try {
        setCustomPrompts(JSON.parse(savedPrompts));
      } catch (e) {
        console.error("Failed to parse saved prompts:", e);
      }
    }
  }, []);

  // 从 localStorage 恢复已下载的任务
  useEffect(() => {
    const savedDownloaded = localStorage.getItem("video-batch-downloaded-tasks");
    if (savedDownloaded) {
      try {
        const ids = JSON.parse(savedDownloaded);
        if (Array.isArray(ids)) {
          setDownloadedTaskIds(new Set(ids));
        }
      } catch (e) {
        console.error("Failed to parse downloaded tasks:", e);
      }
    }
  }, []);

  // 保存已下载任务到 localStorage
  const markTaskAsDownloaded = useCallback((taskId: string) => {
    setDownloadedTaskIds(prev => {
      const newSet = new Set(prev);
      newSet.add(taskId);
      // 保存到 localStorage
      localStorage.setItem("video-batch-downloaded-tasks", JSON.stringify([...newSet]));
      return newSet;
    });
  }, []);

  // AI 模特设置函数
  const setUseAiModel = (value: boolean) => updateGlobalSettings("useAiModel", value);
  const setSelectedModelId = (value: string | null) => updateGlobalSettings("aiModelId", value);
  const setSelectedModelName = (value: string | null) => updateGlobalSettings("aiModelName", value);
  const setSelectedModelTriggerWord = (value: string | null) => updateGlobalSettings("aiModelTriggerWord", value);
  const setSelectedModelCover = (value: string | null) => updateGlobalSettings("aiModelCover", value); // Added this line

  // 任务处理锁，防止重复执行
  const processingTasksRef = useRef<Set<string>>(new Set());

  // 获取用户积分和签约模特
  useEffect(() => {
    // 获取积分
    fetch("/api/user/credits")
      .then(async (res) => {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error("[Video Batch] Failed to parse credits response:", text, e);
          return {};
        }
      })
      .then((data) => {
        if (data.credits !== undefined) setUserCredits(data.credits);
        if (data.userId) setUserId(data.userId);
      })
      .catch(console.error);

    // 获取签约模特
    fetch("/api/contracts")
      .then(async (res) => {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error("[Video Batch] Failed to parse contracts response:", text, e);
          return { success: false };
        }
      })
      .then((data) => {
        console.log("[Video Batch] Contracts API response:", data);
        if (data.success && data.data) {
          const models = data.data
            .filter((contract: { ai_models: { id: string; name: string; trigger_word?: string; avatar_url?: string | null } | null }) => contract.ai_models !== null)
            .map((contract: { ai_models: { id: string; name: string; trigger_word?: string; avatar_url?: string | null } }) => ({
              id: contract.ai_models.id,
              name: contract.ai_models.name,
              trigger_word: contract.ai_models.trigger_word || "",
              avatar_url: contract.ai_models.avatar_url || "",
            }));
          console.log("[Video Batch] Loaded hired models:", models);
          setHiredModels(models);
        }
      })
      .catch((err) => {
        console.error("[Video Batch] Failed to load contracts:", err);
      });
  }, []);

  // 页面离开警告 - 当有任务正在处理时提醒用户
  useEffect(() => {
    const hasRunningTasks = tasks.some(t =>
      ["uploading", "generating_script", "generating_prompt", "generating_video"].includes(t.status)
    );

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasRunningTasks) {
        e.preventDefault();
        e.returnValue = "有任务正在处理中，确定要离开吗？任务状态已自动保存，返回后可继续处理。";
        return e.returnValue;
      }
    };

    if (hasRunningTasks) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [tasks]);

  // 上传单张图片到服务器
  const uploadImageToServer = async (image: TaskImageInfo): Promise<string> => {
    // 如果已经是 http/https URL，直接返回
    if (image.url.startsWith("http://") || image.url.startsWith("https://")) {
      return image.url;
    }

    // 如果是 blob URL，需要上传
    if (image.url.startsWith("blob:")) {
      // 检查 file 属性是否存在
      if (!image.file) {
        console.error("[Video Batch] Image file not found for blob URL:", image.url);
        throw new Error("图片文件已失效，请重新上传");
      }

      // 验证 blob URL 是否仍然有效
      try {
        const blobResponse = await fetch(image.url);
        if (!blobResponse.ok) {
          throw new Error("Blob URL 已失效");
        }
      } catch (blobError) {
        console.error("[Video Batch] Blob URL invalid:", image.url, blobError);
        throw new Error("图片链接已失效，请重新上传图片");
      }

      const formData = new FormData();
      formData.append("file", image.file);

      const response = await fetch("/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        console.error("[Video Batch] Failed to parse upload response:", responseText.substring(0, 200));
        throw new Error("图片上传服务响应格式错误");
      }
      if (!result.success) {
        throw new Error(result.error || "图片上传失败");
      }

      return result.data.url;
    }

    console.error("[Video Batch] Unknown image URL format:", image.url);
    throw new Error("无效的图片格式");
  };

  // 单个任务处理 - 调用实际 API
  const handleStartSingleTask = useCallback(
    async (task: VideoBatchTask) => {
      const isPromptMode = task.mode === "prompt_to_video";

      // 验证任务
      if (isPromptMode) {
        if (!task.customPrompt || task.customPrompt.trim().length < 10) {
          toast({ variant: "destructive", title: "提示词至少需要10个字符" });
          return;
        }
      } else {
        if (!validateTaskImages(task.images).valid) {
          toast({ variant: "destructive", title: "请先完善任务图片" });
          return;
        }
      }

      // 检查任务是否已经在处理中（防止重复执行）
      if (processingTasksRef.current.has(task.id)) {
        console.warn(`[Video Batch] Task ${task.id} is already being processed, skipping...`);
        return;
      }

      // 检查任务状态，如果不是 pending 则跳过
      const currentState = useVideoBatchStore.getState();
      const currentTask = currentState.tasks.find(t => t.id === task.id);
      if (currentTask && currentTask.status !== "pending") {
        console.warn(`[Video Batch] Task ${task.id} status is ${currentTask.status}, skipping...`);
        return;
      }

      // 确保 userId 已获取，如果没有则先获取
      let currentUserId = userId;
      if (!currentUserId) {
        try {
          const creditsRes = await fetch("/api/user/credits");
          const creditsText = await creditsRes.text();
          let creditsData;
          try {
            creditsData = JSON.parse(creditsText);
          } catch (e) {
            console.error("[Video Batch] Failed to parse credits response:", creditsText, e);
            creditsData = {};
          }
          if (creditsData.userId) {
            currentUserId = creditsData.userId;
            setUserId(creditsData.userId);
            console.log("[Video Batch] Got userId on demand:", creditsData.userId);
          }
        } catch (e) {
          console.error("[Video Batch] Failed to get userId:", e);
        }
      }

      // 添加到处理锁
      processingTasksRef.current.add(task.id);

      try {
        let finalVideoPrompt = "";
        let mainGridImageUrl = "";

        if (isPromptMode) {
          // ==================== 纯提示词模式 ====================
          // 跳过图片上传和脚本生成，直接使用用户提示词
          updateTaskStatus(task.id, "generating_video", { currentStep: 3, progress: 20 });

          finalVideoPrompt = task.customPrompt || "";
          mainGridImageUrl = task.referenceImageUrl || "";

          // 如果使用AI模特且有trigger word，添加到提示词中
          if (useAiModel && selectedModelTriggerWord) {
            finalVideoPrompt = `[AI MODEL: ${selectedModelTriggerWord}]\n\n${finalVideoPrompt}`;
            console.log("[Video Batch] Prompt mode - Added AI model trigger word:", selectedModelTriggerWord);
          }

          // 保存用户提示词到任务（不暴露 trigger_word）
          updateTaskStatus(task.id, "generating_video", {
            currentStep: 3,
            progress: 30,
            doubaoTalkingScript: useAiModel && selectedModelTriggerWord
              ? `【纯提示词模式 - 已启用AI模特】`
              : "【纯提示词模式 - 无口播脚本】",
            // 保存给用户看的提示词不包含 trigger_word
            doubaoAiVideoPrompt: task.customPrompt || "",
          });

          console.log("[Video Batch] Prompt mode - using custom prompt directly", {
            hasAiModel: useAiModel,
            triggerWord: selectedModelTriggerWord,
          });
        } else {
          // ==================== 图片到视频模式 ====================
          // ==================== Step 0: 上传图片 ====================
          updateTaskStatus(task.id, "uploading", { currentStep: 0, progress: 5 });

          const uploadedUrls: string[] = [];
          for (let i = 0; i < task.images.length; i++) {
            const url = await uploadImageToServer(task.images[i]);
            uploadedUrls.push(url);
            updateTaskStatus(task.id, "uploading", {
              progress: 5 + Math.round((i + 1) / task.images.length * 15)
            });
          }
          console.log("[Video Batch] Images uploaded:", uploadedUrls);

          // ==================== Step 1: 生成口播脚本 ====================
          updateTaskStatus(task.id, "generating_script", { currentStep: 1, progress: 20 });

          // 获取本地存储的自定义提示词
          let savedCustomPrompts = null;
          try {
            const savedPromptsStr = localStorage.getItem("video-batch-custom-prompts");
            if (savedPromptsStr) {
              savedCustomPrompts = JSON.parse(savedPromptsStr);
            }
          } catch (e) {
            console.warn("Failed to parse custom prompts:", e);
          }

          const imageUrls = uploadedUrls;
          const scriptResponse = await fetch("/api/video-batch/generate-talking-script", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              images: imageUrls,
              taskId: task.id,
              customPrompts: savedCustomPrompts ? {
                systemPrompt: savedCustomPrompts.talkingScriptSystem,
                userPrompt: savedCustomPrompts.talkingScriptUser,
              } : undefined,
            }),
          });

          const scriptText = await scriptResponse.text();
          let scriptResult;
          try {
            scriptResult = JSON.parse(scriptText);
          } catch (e) {
            console.error("[Video Batch] Failed to parse script response:", scriptText, e);
            throw new Error("生成脚本服务响应格式错误");
          }
          if (!scriptResult.success) {
            throw new Error(scriptResult.error || "生成脚本失败");
          }

          updateTaskStatus(task.id, "generating_prompt", {
            currentStep: 2,
            progress: 45,
            doubaoTalkingScript: scriptResult.data.script,
          });

          // ==================== Step 2: 生成 AI 视频提示词 ====================
          const promptResponse = await fetch("/api/video-batch/generate-ai-video-prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              talkingScript: scriptResult.data.script,
              taskId: task.id,
              modelTriggerWord: useAiModel ? selectedModelTriggerWord : undefined,
              customPrompts: savedCustomPrompts ? {
                systemPrompt: savedCustomPrompts.aiVideoPromptSystem,
                userPrompt: savedCustomPrompts.aiVideoPromptUser,
              } : undefined,
            }),
          });

          const promptText = await promptResponse.text();
          let promptResult;
          try {
            promptResult = JSON.parse(promptText);
          } catch (e) {
            console.error("[Video Batch] Failed to parse prompt response:", promptText, e);
            throw new Error("生成提示词服务响应格式错误");
          }
          if (!promptResult.success) {
            throw new Error(promptResult.error || "生成提示词失败");
          }

          updateTaskStatus(task.id, "generating_video", {
            currentStep: 3,
            progress: 65,
            // 保存展示提示词（不含 trigger word）给用户看
            doubaoAiVideoPrompt: promptResult.data.displayPrompt || promptResult.data.prompt,
          });

          // 设置最终提示词（含 trigger word）用于发送给视频 API
          finalVideoPrompt = promptResult.data.prompt;
          mainGridImageUrl = uploadedUrls[0];

          if (!mainGridImageUrl) {
            throw new Error("缺少九宫格主图");
          }
        }

        // ==================== Step 3: 生成 Sora 视频 ====================

        // 如果使用AI模特且有trigger word，确保它在最终提示词中
        if (useAiModel && selectedModelTriggerWord && !finalVideoPrompt.includes(selectedModelTriggerWord)) {
          finalVideoPrompt = `[AI MODEL: ${selectedModelTriggerWord}]\n\n${finalVideoPrompt}`;
          console.log("[Video Batch] Added AI model trigger word to final prompt");
        }

        // 使用任务自身的配置，兼容旧任务（回退到全局配置）
        const taskAspectRatio = task.aspectRatio || globalSettings.aspectRatio;
        const taskDuration = task.duration || globalSettings.duration;
        const taskQuality = task.quality || globalSettings.quality;
        const taskModelType = task.modelType || globalSettings.modelType;

        // 计算积分消耗
        const taskCreditCost = getVideoBatchTotalPrice(taskModelType, taskDuration, taskQuality);

        // 判断是否使用 VEO3 模型
        const isVeo3Model = taskModelType === "veo3" || taskModelType === "veo3-quality";
        const apiEndpoint = isVeo3Model
          ? "/api/video-batch/generate-veo-video"
          : "/api/video-batch/generate-sora-video";

        console.log(`[Video Batch] Calling ${isVeo3Model ? 'VEO3' : 'Sora2'} API with userId:`, currentUserId);
        const videoResponse = await fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aiVideoPrompt: finalVideoPrompt,
            mainGridImageUrl: mainGridImageUrl || undefined, // 纯提示词模式下可能为空
            aspectRatio: taskAspectRatio,
            durationSeconds: taskDuration,
            quality: isVeo3Model ? (taskModelType === "veo3-quality" ? "quality" : "fast") : taskQuality,
            modelType: taskModelType,
            taskId: task.id,
            userId: currentUserId,  // 传递用户ID以便记录到任务日志
            creditCost: taskCreditCost,  // 传递积分消耗
            mode: isPromptMode ? "prompt_to_video" : "image_to_video", // 传递任务模式
            apiLine: task.apiLine || globalSettings.apiLine, // 新增：API 线路
          }),
        });

        const videoText = await videoResponse.text();
        let videoResult;
        try {
          videoResult = JSON.parse(videoText);
        } catch (e) {
          console.error("[Video Batch] Failed to parse video response:", videoText, e);
          throw new Error("视频生成服务响应格式错误");
        }
        if (!videoResult.success) {
          throw new Error(videoResult.error || "视频提交失败");
        }

        // 获取任务 ID（VEO3 返回 veoTaskId，Sora2 返回 soraTaskId）
        const soraTaskId = isVeo3Model ? videoResult.data.veoTaskId : videoResult.data.soraTaskId;
        console.log(`[Video Batch] ${isVeo3Model ? 'VEO3' : 'Sora2'} task submitted:`, soraTaskId);

        // 更新状态为正在生成视频
        updateTaskStatus(task.id, "generating_video", {
          currentStep: 3,
          progress: 70,
          soraTaskId: soraTaskId,
        });

        // ==================== Step 3.5: 轮询视频任务状态 ====================
        const isPro = taskModelType === "sora2-pro" || taskQuality === "hd" || taskDuration === 25;
        // VEO3 通常需要 3-5 分钟，设置 10 分钟超时
        const maxPollTime = isVeo3Model ? 10 * 60 * 1000 : (isPro ? 35 * 60 * 1000 : 10 * 60 * 1000);
        // 轮询状态接口路径
        const taskApiLine = task.apiLine || globalSettings.apiLine; // 新增：获取任务的 API 线路
        const statusApiPath = isVeo3Model
          ? `/api/video-batch/veo-status/${soraTaskId}`
          : `/api/video-batch/sora-status/${soraTaskId}?isPro=${isPro}&apiLine=${taskApiLine}`;
        const pollInterval = 15 * 1000; // 15秒轮询一次（减少请求频率）
        const startTime = Date.now();

        let videoUrl: string | undefined;
        let pollError: string | undefined;
        let consecutiveErrors = 0; // 连续错误计数
        const maxConsecutiveErrors = 10; // 最多允许10次连续错误 (Increased from 5)

        while (Date.now() - startTime < maxPollTime) {
          // 等待轮询间隔
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          // 检查任务是否被取消（页面刷新等）
          const currentState = useVideoBatchStore.getState();
          const currentTask = currentState.tasks.find(t => t.id === task.id);
          if (!currentTask || currentTask.status === "failed" || currentTask.status === "success") {
            console.log("[Video Batch] Task state changed, stopping poll");
            break;
          }

          // 更新进度（模拟进度）
          const elapsed = Date.now() - startTime;
          const progress = Math.min(70 + Math.floor((elapsed / maxPollTime) * 25), 95);
          updateTaskStatus(task.id, "generating_video", {
            currentStep: 3,
            progress: progress,
          });

          // 轮询任务状态（带重试）
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时 (Increased from 30s)

            const statusResponse = await fetch(
              statusApiPath,
              { signal: controller.signal }
            );
            clearTimeout(timeoutId);

            const statusText = await statusResponse.text();
            let statusResult;
            try {
              statusResult = JSON.parse(statusText);
            } catch {
              console.error("[Video Batch] Failed to parse status response:", statusText.substring(0, 200));
              consecutiveErrors++;
              if (consecutiveErrors >= maxConsecutiveErrors) {
                pollError = "连续多次查询状态失败，请稍后在生产轨迹簿中查看结果";
                break;
              }
              continue;
            }

            // 成功获取响应，重置错误计数
            consecutiveErrors = 0;

            if (!statusResult.success) {
              console.log("[Video Batch] Status query failed:", statusResult.error);
              continue;
            }

            const taskStatus = statusResult.data.status;
            console.log("[Video Batch] Sora task status:", taskStatus);

            if (taskStatus === "completed") {
              videoUrl = statusResult.data.videoUrl;
              break;
            } else if (taskStatus === "failed") {
              // 包含退款提示和建议
              const baseError = statusResult.data.errorMessage || "第三方 AI 视频服务暂时繁忙";
              const refundNote = statusResult.data.refundNote;
              const suggestion = statusResult.data.suggestion;

              let errorParts = [baseError];
              if (suggestion) errorParts.push(suggestion);
              if (refundNote) errorParts.push(refundNote);

              pollError = errorParts.join("。");
              break;
            }
            // 继续轮询 (pending/processing)
          } catch (pollErr) {
            console.error("[Video Batch] Poll error:", pollErr);
            consecutiveErrors++;

            // 检查是否是网络错误
            if (pollErr instanceof Error) {
              if (pollErr.name === "AbortError") {
                console.log("[Video Batch] Poll request timeout, retrying...");
              } else if (pollErr.message.includes("fetch")) {
                console.log("[Video Batch] Network error, retrying...");
              }
            }

            if (consecutiveErrors >= maxConsecutiveErrors) {
              pollError = "网络连接不稳定，或第三方服务响应超时。任务已在后台运行，请稍后在生产轨迹簿中查看结果。";
              break;
            }
            // 继续尝试
          }
        }

        // 检查结果
        if (pollError) {
          throw new Error(pollError);
        }

        if (!videoUrl) {
          // 超时但任务可能仍在后台运行
          // 标记为需要后台检查的状态，而不是直接失败
          console.log("[Video Batch] Poll timeout for task:", task.id, "soraTaskId:", soraTaskId);
          throw new Error(`视频生成耗时较长（${isPro ? "Pro高清约10-25分钟" : "标清约3-8分钟"}），任务已提交成功。请稍后在「生产轨迹簿」中查看结果，或刷新页面后重试。`);
        }

        // ==================== 完成 ====================
        updateTaskStatus(task.id, "success", {
          currentStep: 4,
          progress: 100,
          soraTaskId: soraTaskId,
          soraVideoUrl: videoUrl,
        });

        toast({ title: "✅ 视频生成完成！" });
      } catch (error) {
        console.error("[Video Batch] Task failed:", error);
        updateTaskStatus(task.id, "failed", {
          errorMessage: error instanceof Error ? error.message : "任务执行失败",
        });
        toast({
          variant: "destructive",
          title: "❌ 任务失败",
          description: error instanceof Error ? error.message : "未知错误",
        });
      } finally {
        // 释放任务处理锁
        processingTasksRef.current.delete(task.id);
      }
    },
    [updateTaskStatus, toast, useAiModel, selectedModelTriggerWord, promptInput, batchCreateCount, globalSettings.aiModelId, globalSettings.aiModelName, globalSettings.aiModelTriggerWord]
  );

  // 编辑任务图片
  const handleEditTaskImages = useCallback((task: VideoBatchTask) => {
    setEditingTaskId(task.id);
    setEditingImages([...task.images]);
  }, []);

  const handleSaveTaskImages = useCallback(() => {
    if (editingTaskId) {
      updateTaskImages(editingTaskId, editingImages);
      setEditingTaskId(null);
      setEditingImages([]);
      toast({ title: "✅ 图片已更新" });
    }
  }, [editingTaskId, editingImages, updateTaskImages, toast]);

  return (
    <TooltipProvider>
      <div className="space-y-6 pb-32">
        {/* ============================================ */}
        {/* 页面头部 */}
        {/* ============================================ */}
        <div className="mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
            <span className="text-white drop-shadow-lg">批量视频线</span>
          </h1>
          <p className="mt-2 text-white/60">
            一键生成多个视频，支持 SORA2 Pro / VEO3 多模型流水线处理
          </p>
        </div>

        {/* ============================================ */}
        {/* 任务队列 */}
        {/* ============================================ */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Film className="h-5 w-5 text-mermaid-cyan" />
                任务队列
              </h2>
              <Badge variant="outline" className="text-xs bg-white/5 border-white/10 text-white/60">
                {tasks.length} 个任务
              </Badge>
            </div>

            <div className="flex items-center gap-3">
              {/* 批量操作组 - 移至此处 */}
              <div className="flex items-center gap-2 mr-2">
                {selectedCount > 0 && (
                  <>
                    {/* 批量下载 */}
                    {tasks.filter(t => selectedTaskIds[t.id] && t.status === "success" && t.soraVideoUrl).length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isDownloading}
                            className="h-8 text-xs text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                          >
                            {isDownloading ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3 mr-1" />
                            )}
                            下载 ({tasks.filter(t => selectedTaskIds[t.id] && t.status === "success" && t.soraVideoUrl).length})
                            <ChevronDown className="h-3 w-3 ml-1" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          {/* 方式1: 直连CDN推荐 */}
                          <DropdownMenuItem
                            onClick={async () => {
                              const completedSelectedTasks = tasks.filter(
                                t => selectedTaskIds[t.id] && t.status === "success" && t.soraVideoUrl && !downloadedTaskIds.has(t.id)
                              );
                              if (completedSelectedTasks.length === 0) {
                                const allDownloaded = tasks.filter(
                                  t => selectedTaskIds[t.id] && t.status === "success" && t.soraVideoUrl
                                ).every(t => downloadedTaskIds.has(t.id));

                                if (allDownloaded) {
                                  toast({ title: "✅ 所有选中视频已下载", description: "无需重复下载" });
                                } else {
                                  toast({ variant: "destructive", title: "没有可下载的视频" });
                                }
                                return;
                              }

                              cancelDownloadRef.current = false;
                              setDownloadProgress({
                                show: true,
                                total: completedSelectedTasks.length,
                                current: 0,
                                success: 0,
                                failed: 0,
                                currentFilename: "准备中...",
                                startTime: Date.now(),
                                cancelled: false,
                              });
                              setIsDownloading(true);

                              let successCount = 0;
                              let failedCount = 0;

                              for (let i = 0; i < completedSelectedTasks.length; i++) {
                                if (cancelDownloadRef.current) {
                                  setDownloadProgress(prev => ({ ...prev, cancelled: true }));
                                  break;
                                }

                                const task = completedSelectedTasks[i];
                                if (task.soraVideoUrl) {
                                  const filename = generateSimpleFilename(task, tasks.indexOf(task));
                                  setDownloadProgress(prev => ({ ...prev, currentFilename: filename }));
                                  setDownloadingTaskIds(prev => new Set(prev).add(task.id));
                                  setTaskDownloadProgress(prev => ({ ...prev, [task.id]: 0 }));

                                  try {
                                    const response = await fetch(task.soraVideoUrl, {
                                      method: "GET",
                                      mode: "cors",
                                      credentials: "omit",
                                    });

                                    if (!response.ok) throw new Error(`HTTP ${response.status}`);

                                    const contentLength = response.headers.get("content-length");
                                    const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
                                    const reader = response.body?.getReader();
                                    if (!reader) throw new Error("无法读取响应流");

                                    const chunks: Uint8Array[] = [];
                                    let receivedLength = 0;

                                    while (true) {
                                      const { done, value } = await reader.read();
                                      if (done) break;
                                      chunks.push(value);
                                      receivedLength += value.length;
                                      if (totalSize > 0) {
                                        const progress = Math.round((receivedLength / totalSize) * 100);
                                        setTaskDownloadProgress(prev => ({ ...prev, [task.id]: progress }));
                                      }
                                    }

                                    const blob = new Blob(chunks, { type: "video/mp4" });
                                    const blobUrl = URL.createObjectURL(blob);
                                    const link = document.createElement("a");
                                    link.href = blobUrl;
                                    link.download = filename;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                                    successCount++;
                                    markTaskAsDownloaded(task.id);
                                    setTaskDownloadProgress(prev => ({ ...prev, [task.id]: 100 }));
                                  } catch (error) {
                                    console.error(`Download Error:`, error);
                                    failedCount++;
                                    openVideoInNewTab(task.soraVideoUrl);
                                  }

                                  setDownloadingTaskIds(prev => {
                                    const newSet = new Set(prev);
                                    newSet.delete(task.id);
                                    return newSet;
                                  });

                                  setDownloadProgress(prev => ({
                                    ...prev,
                                    current: i + 1,
                                    success: successCount,
                                    failed: failedCount,
                                  }));

                                  await new Promise(r => setTimeout(r, 200));
                                }
                              }

                              setIsDownloading(false);
                              setTaskDownloadProgress({});
                            }}
                            className="cursor-pointer bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20"
                          >
                            <Zap className="h-4 w-4 mr-2 text-emerald-400" />
                            <div className="flex flex-col">
                              <span className="font-medium text-emerald-400">直连CDN推荐 🧪</span>
                              <span className="text-xs text-muted-foreground">直连CDN，速度最快，显示进度</span>
                            </div>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={() => {
                              const completedSelectedTasks = tasks.filter(
                                t => selectedTaskIds[t.id] && t.status === "success" && t.soraVideoUrl
                              );
                              if (completedSelectedTasks.length === 0) return;

                              const urls = completedSelectedTasks
                                .map((task) => task.soraVideoUrl)
                                .filter(Boolean)
                                .join("\n");

                              const blob = new Blob([urls], { type: "text/plain;charset=utf-8" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `video_urls_${new Date().toISOString().slice(0, 10)}.txt`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);

                              toast({ title: "✅ 导出成功", description: `已导出 ${completedSelectedTasks.length} 个视频地址` });
                            }}
                            className="cursor-pointer"
                          >
                            <FileDown className="h-4 w-4 mr-2 text-blue-400" />
                            <div className="flex flex-col">
                              <span>导出地址 (TXT)</span>
                              <span className="text-xs text-muted-foreground">导入 IDM/迅雷 批量下载</span>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    {/* 删除选中 */}
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

                {/* 选择管理 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 text-xs font-medium bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                    >
                      <Settings2 className="h-3.5 w-3.5 mr-1.5 opacity-70" />
                      <span className="text-white/70 group-hover:text-white">选择管理</span>
                      <ChevronDown className="h-3 w-3 ml-1.5 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => selectAllTasks(true)} className="cursor-pointer">
                      <Check className="h-4 w-4 mr-2 text-emerald-400" />
                      全选
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={clearSelection} className="cursor-pointer">
                      <X className="h-4 w-4 mr-2 text-orange-400" />
                      取消选择
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={clearAllTasks} className="text-red-400 cursor-pointer">
                      <Trash2 className="h-4 w-4 mr-2" />
                      清空所有
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="h-4 w-px bg-white/10 mx-1" />

              {/* Mermaid Ultra 开始全部按钮 (Emerald Gradient) - 作用于当前任务组 */}
              {activeGroupStats.pending > 0 && (
                <button
                  onClick={async () => {
                    if (!userId) {
                      toast({ variant: "destructive", title: "请先登录" });
                      return;
                    }

                    // 只处理当前任务组的待处理任务
                    const pendingTasks = activeGroupTasks.filter(t => t.status === "pending");
                    if (pendingTasks.length === 0) {
                      toast({ title: "当前任务组没有待处理任务", variant: "default" });
                      return;
                    }

                    if (userCredits < activeGroupStats.totalCost) {
                      toast({ variant: "destructive", title: `积分不足，需要 ${activeGroupStats.totalCost} 积分，当前余额 ${userCredits}` });
                      return;
                    }

                    setIsBatchStarting(true);
                    toast({ title: `🚀 正在启动「${activeGroupName}」中 ${pendingTasks.length} 个视频任务...` });

                    for (const task of pendingTasks) {
                      handleStartSingleTask(task);
                      await new Promise(r => setTimeout(r, 1000));
                    }

                    setIsBatchStarting(false);
                  }}
                  disabled={isBatchStarting || activeGroupStats.pending === 0}
                  className="relative h-8 px-5 rounded-full font-bold text-white text-xs transition-all duration-500 bg-gradient-to-r from-emerald-500 to-teal-500 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] border border-white/20 overflow-hidden group shadow-[0_0_10px_rgba(16,185,129,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
                  <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-300" />
                  <span className="relative z-10 flex items-center justify-center gap-1.5">
                    {isBatchStarting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5 fill-white/20" />
                    )}
                    {isBatchStarting ? "启动中..." : `开始全部 (${activeGroupStats.pending})`}
                  </span>
                </button>
              )}

              {/* Mermaid Ultra 创建任务按钮 (Small) */}
              <button
                onClick={() => setShowCreateDialog(true)}
                className="relative h-8 px-5 rounded-full font-bold text-black text-xs transition-all duration-500 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.5)] border border-white/20 overflow-hidden group shadow-[0_0_10px_rgba(0,242,234,0.2)]"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
                <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-300" />
                <span className="relative z-10 flex items-center justify-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 fill-black/20" />
                  创建视频任务
                </span>
              </button>
            </div>
          </div>





          {tasks.length === 0 ? (
            <div
              className="group flex flex-col items-center justify-center py-24 rounded-[2rem] border border-white/5 bg-[#0B0C10] relative overflow-hidden cursor-pointer transition-all duration-500 hover:border-mermaid-cyan/30 hover:shadow-[0_0_30px_rgba(0,242,234,0.1)]"
              onClick={() => setShowCreateDialog(true)}
            >
              {/* Aurora Background Effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-mermaid-cyan/5 via-transparent to-mermaid-pink/5 opacity-50" />
              <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10" />

              {/* Animated Rings */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] border border-white/5 rounded-full animate-[spin_20s_linear_infinite]" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] border border-white/5 rounded-full animate-[spin_15s_linear_infinite_reverse]" />

              <div className="relative z-10 flex flex-col items-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-mermaid-cyan/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative w-24 h-24 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-inner">
                    <Video className="h-12 w-12 text-white/20 group-hover:text-mermaid-cyan transition-colors duration-300" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-mermaid-cyan transition-colors tracking-tight">暂无视频任务</h3>
                <p className="text-sm text-white/40 group-hover:text-white/80 transition-colors">
                  点击 <span className="text-mermaid-cyan font-medium">"创建视频任务"</span> 开始批量生产
                </p>
              </div>
            </div>
          ) : (
            (() => {
              // 获取所有任务组（按创建时间排序）
              const groups = getGroups();

              // 如果没有激活的组，自动激活第一个
              if (groups.length > 0 && !activeGroupName) {
                // 自动切换到第一个组
                setTimeout(() => setActiveGroup(groups[0].name), 0);
              }

              // 当前组的任务（反转顺序，最新在前）
              const currentGroupTasks = [...activeGroupTasks].reverse();

              // 渲染单个任务卡片的辅助函数
              const renderTaskCard = (task: VideoBatchTask) => (
                <VideoTaskCard
                  key={task.id}
                  task={task}
                  isSelected={!!selectedTaskIds[task.id]}
                  onToggleSelect={() => toggleTaskSelection(task.id)}
                  onStart={() => handleStartSingleTask(task)}
                  onRemove={() => removeTask(task.id)}
                  onClone={() => {
                    const newId = cloneTask(task.id);
                    if (newId) {
                      toast({ title: "✅ 任务已克隆" });
                    }
                  }}
                  onViewScript={() => setPreviewTask(task)}
                  onEditImages={() => handleEditTaskImages(task)}
                  onPlayVideo={() => setPlayingVideoTask(task)}
                  onDownload={() => handleDownloadTask(task)}
                  modelType={globalSettings.modelType}
                  duration={globalSettings.duration}
                  quality={globalSettings.quality}
                  downloadProgress={taskDownloadProgress[task.id] || 0}
                  isDownloading={downloadingTaskIds.has(task.id)}
                  isDownloaded={downloadedTaskIds.has(task.id)}
                />
              );

              return (
                <div className="space-y-4">
                  {/* 任务组 Tab 横向切换栏 */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {groups.map((group) => (
                      <div
                        key={group.name}
                        className={cn(
                          "relative flex items-center gap-2 px-4 py-2 rounded-full transition-all cursor-pointer group shrink-0",
                          activeGroupName === group.name
                            ? "bg-gradient-to-r from-tiktok-cyan/20 to-tiktok-pink/20 border border-tiktok-cyan/30 text-white shadow-[0_0_15px_rgba(0,242,234,0.15)] font-medium"
                            : "bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 hover:border-white/20"
                        )}
                        onClick={() => setActiveGroup(group.name)}
                      >
                        <FolderUp className="h-4 w-4" />
                        <span className="max-w-[120px] truncate">{group.name}</span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-xs",
                            activeGroupName === group.name
                              ? "bg-tiktok-cyan/20 text-tiktok-cyan border-tiktok-cyan/20"
                              : "bg-white/10 text-white/60"
                          )}
                        >
                          {group.completed}/{group.count}
                        </Badge>
                        {/* 删除任务组按钮 */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setDeleteGroupDialog({
                              open: true,
                              groupName: group.name,
                              count: group.count,
                            });
                          }}
                          className={cn(
                            "ml-1 p-1 rounded-full transition-all hover:scale-110",
                            activeGroupName === group.name
                              ? "hover:bg-red-500/20 text-red-400/70 hover:text-red-400"
                              : "hover:bg-red-500/20 text-white/40 hover:text-red-400"
                          )}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}

                    {/* 任务组数量提示 */}
                    {groups.length >= MAX_TASK_GROUPS && (
                      <div className="shrink-0 px-3 py-2 text-xs text-amber-400 bg-amber-500/10 rounded-full border border-amber-500/20">
                        已达上限 {MAX_TASK_GROUPS} 个任务组
                      </div>
                    )}
                  </div>

                  {/* 当前任务组的任务卡片网格 */}
                  {currentGroupTasks.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {currentGroupTasks.map(renderTaskCard)}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                        <Video className="h-8 w-8 text-white/20" />
                      </div>
                      <p className="text-white/40 text-sm">
                        {groups.length === 0
                          ? "暂无任务组，点击「创建视频任务」开始"
                          : "当前任务组暂无任务"}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>

        {/* 底部状态栏 - 显示当前任务组的统计信息 */}
        {tasks.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-xl">
            <div className="container max-w-7xl mx-auto px-6 py-3">
              <div className="flex items-center justify-between">
                {/* 统计信息 */}
                <div className="flex items-center gap-6">
                  {/* 当前任务组名称 */}
                  {activeGroupName && (
                    <>
                      <div className="flex items-center gap-2">
                        <FolderUp className="h-5 w-5 text-tiktok-cyan" />
                        <span className="text-sm font-semibold text-tiktok-cyan">{activeGroupName}</span>
                      </div>
                      <div className="h-5 w-px bg-border/50" />
                    </>
                  )}

                  <div className="flex items-center gap-2">
                    <Video className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm">
                      <span className="font-semibold">{activeGroupStats.total}</span>
                      <span className="text-muted-foreground ml-1">个任务</span>
                    </span>
                  </div>

                  <div className="h-5 w-px bg-border/50" />

                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-amber-400" />
                    <span className="text-sm">
                      <span className="font-semibold text-amber-400">{activeGroupStats.totalCost}</span>
                      <span className="text-muted-foreground ml-1">Credits</span>
                    </span>
                  </div>

                  {(activeGroupStats.pending > 0 || activeGroupStats.running > 0 || activeGroupStats.success > 0 || activeGroupStats.failed > 0) && (
                    <>
                      <div className="h-5 w-px bg-border/50" />
                      <div className="flex items-center gap-3 text-sm">
                        {activeGroupStats.pending > 0 && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            {activeGroupStats.pending} 待处理
                          </span>
                        )}
                        {activeGroupStats.running > 0 && (
                          <span className="flex items-center gap-1 text-tiktok-cyan">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {activeGroupStats.running} 处理中
                          </span>
                        )}
                        {activeGroupStats.success > 0 && (
                          <span className="flex items-center gap-1 text-emerald-500">
                            <CheckCircle2 className="h-4 w-4" />
                            {activeGroupStats.success} 完成
                          </span>
                        )}
                        {activeGroupStats.failed > 0 && (
                          <span className="flex items-center gap-1 text-red-400">
                            <XCircle className="h-4 w-4" />
                            {activeGroupStats.failed} 失败
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* 操作按钮 - 重置当前任务组的失败任务 */}
                {activeGroupStats.failed > 0 && (
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
        )}

        {/* V7 创建任务弹窗 - 左右布局 */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-5xl bg-[#0B0C10]/98 backdrop-blur-3xl border border-white/10 text-white shadow-[0_0_120px_-30px_rgba(0,242,234,0.15)] gap-0 p-0 overflow-hidden rounded-2xl flex flex-col max-h-[90vh]">
            {/* Header: Tab切换(左) + 加载方案(右) */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-white/5 to-transparent">
              <div className="flex items-center gap-4">
                <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-tiktok-pink" />
                  创建视频任务
                </DialogTitle>
                <DialogDescription className="sr-only">配置参数并批量生成视频</DialogDescription>

                {/* V7 Tab切换 - 左上角 */}
                <div className="flex p-0.5 bg-white/5 rounded-lg border border-white/10">
                  <button
                    onClick={() => setCreateMode("prompt")}
                    className={cn(
                      "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                      createMode === "prompt"
                        ? "bg-gradient-to-r from-tiktok-pink/30 to-purple-500/30 text-tiktok-pink border border-tiktok-pink/30 shadow-sm"
                        : "text-white/50 hover:text-white"
                    )}
                  >
                    <FileText className="h-4 w-4" />
                    自由创作
                  </button>
                  <button
                    onClick={() => setCreateMode("image")}
                    className={cn(
                      "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                      createMode === "image"
                        ? "bg-gradient-to-r from-tiktok-cyan/30 to-tiktok-blue/30 text-tiktok-cyan border border-tiktok-cyan/30 shadow-sm"
                        : "text-white/50 hover:text-white"
                    )}
                  >
                    <ImageIcon className="h-4 w-4" />
                    图片转视频（电商）
                  </button>
                </div>
              </div>

              {/* Glass Ghost 加载方案按钮 */}
              {/* Glass Ghost 加载方案按钮 - 增加 mr-10 避开关闭按钮 */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTemplateManager(true)}
                className="h-8 gap-1.5 bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 rounded-lg px-3 mr-10"
              >
                <FolderDown className="h-4 w-4" />
                <span className="text-xs font-medium">加载方案</span>
              </Button>
            </div>

            {/* V7 左右布局内容区域 */}
            <div className="flex flex-1 overflow-hidden">
              {/* 左侧 60%：素材/提示词区域 */}
              <div className="flex-[6] p-6 border-r border-white/10 overflow-y-auto">
                {createMode === "prompt" ? (
                  /* 自由创作模式 */
                  <div className="space-y-4 h-full flex flex-col">
                    <div className="flex-1 space-y-3">
                      <Label className="text-sm text-white flex items-center gap-1">
                        🪄 视频提示词 <span className="text-red-400">*</span>
                      </Label>
                      <Textarea
                        placeholder="详细描述你想要生成的视频内容，例如：&#10;&#10;一个时尚的亚洲女性模特手持产品，在简约白色背景下展示，镜头缓慢推进，光影柔和，主体清晰，画面质感高级..."
                        value={promptInput}
                        onChange={(e) => setPromptInput(e.target.value)}
                        className="flex-1 min-h-[280px] bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none focus:border-tiktok-pink/50 focus:ring-tiktok-pink/20"
                      />
                    </div>

                    {/* 可选参考图 + 分组名 */}
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="space-y-2">
                        <Label className="text-xs text-white/60">📷 参考图 (可选)</Label>
                        <div
                          className="h-24 border border-dashed border-white/20 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 cursor-pointer transition-all"
                          onClick={() => document.getElementById('ref-image-upload')?.click()}
                        >
                          {referenceImageUrl ? (
                            <div className="relative w-full h-full">
                              <img src={referenceImageUrl} alt="参考图" className="w-full h-full object-cover rounded-lg" />
                              <button
                                onClick={(e) => { e.stopPropagation(); setReferenceImageUrl(""); setReferenceImageFile(null); }}
                                className="absolute -top-2 -right-2 h-5 w-5 bg-red-500 rounded-full flex items-center justify-center"
                              >
                                <X className="h-3 w-3 text-white" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-white/40">点击上传</span>
                          )}
                        </div>
                        <input
                          id="ref-image-upload"
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setReferenceImageFile(file);
                              setReferenceImageUrl(URL.createObjectURL(file));
                            }
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-white/60 flex items-center gap-1">
                          📁 任务组 <span className="text-red-400">*</span>
                        </Label>
                        <div className="space-y-2">
                          {/* 现有任务组快捷选择 */}
                          {getGroups().length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {getGroups().slice(0, 5).map((g) => (
                                <button
                                  key={g.name}
                                  type="button"
                                  onClick={() => setGroupNameInput(g.name)}
                                  className={cn(
                                    "px-2 py-1 rounded text-xs transition-all",
                                    groupNameInput === g.name
                                      ? "bg-tiktok-pink/20 text-tiktok-pink border border-tiktok-pink/30"
                                      : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white"
                                  )}
                                >
                                  {g.name}
                                </button>
                              ))}
                            </div>
                          )}
                          <input
                            type="text"
                            value={groupNameInput}
                            onChange={(e) => setGroupNameInput(e.target.value)}
                            placeholder="输入或选择任务组名称..."
                            className={cn(
                              "w-full h-10 px-3 bg-white/5 border rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none",
                              groupNameInput.trim() ? "border-white/10 focus:border-tiktok-pink/50" : "border-red-500/30 focus:border-red-500/50"
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : createMode === "image" ? (
                  /* 图片转视频模式 */
                  <div className="space-y-4 h-full flex flex-col">
                    {/* 极简进度条 */}
                    <div className="flex items-center justify-center gap-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-white/60" />
                        <span className="text-xs text-white/60">素材上传</span>
                      </div>
                      <div className="w-12 h-px bg-white/20" />
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-white/20" />
                        <span className="text-xs text-white/30">生成脚本</span>
                      </div>
                      <div className="w-12 h-px bg-white/20" />
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-white/20" />
                        <span className="text-xs text-white/30">生成提示词</span>
                      </div>
                      <div className="w-12 h-px bg-white/20" />
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-white/20" />
                        <span className="text-xs text-white/30">生成视频</span>
                      </div>
                    </div>

                    <div className="flex-1">
                      <Label className="text-sm text-white flex items-center gap-1 mb-3">
                        📷 上传素材图片 <span className="text-xs text-white/40 ml-2">支持批量上传</span>
                      </Label>
                      <ImageUploader
                        images={newTaskImages}
                        onImagesChange={setNewTaskImages}
                        maxImages={10}
                      />
                    </div>

                    {/* 提示词配置 + 分组名 */}
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="space-y-2">
                        <Label className="text-xs text-white/60 flex items-center gap-1">
                          📁 任务组 <span className="text-red-400">*</span>
                        </Label>
                        <div className="space-y-2">
                          {/* 现有任务组快捷选择 */}
                          {getGroups().length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {getGroups().slice(0, 5).map((g) => (
                                <button
                                  key={g.name}
                                  type="button"
                                  onClick={() => setGroupNameInput(g.name)}
                                  className={cn(
                                    "px-2 py-1 rounded text-xs transition-all",
                                    groupNameInput === g.name
                                      ? "bg-tiktok-cyan/20 text-tiktok-cyan border border-tiktok-cyan/30"
                                      : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white"
                                  )}
                                >
                                  {g.name}
                                </button>
                              ))}
                            </div>
                          )}
                          <input
                            type="text"
                            value={groupNameInput}
                            onChange={(e) => setGroupNameInput(e.target.value)}
                            placeholder="输入或选择任务组名称..."
                            className={cn(
                              "w-full h-10 px-3 bg-white/5 border rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none",
                              groupNameInput.trim() ? "border-white/10 focus:border-tiktok-cyan/50" : "border-red-500/30 focus:border-red-500/50"
                            )}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-white/60">⚙️ 提示词配置</Label>
                        {/* Secondary Prism 按钮 */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowPromptConfig(true)}
                          className="w-full h-10 bg-transparent border-0 relative overflow-hidden group"
                        >
                          <span className="absolute inset-0 rounded-lg bg-gradient-to-r from-tiktok-cyan via-purple-500 to-tiktok-pink opacity-30" />
                          <span className="absolute inset-[1px] rounded-lg bg-[#0B0C10]" />
                          <span className="relative flex items-center gap-2 text-transparent bg-clip-text bg-gradient-to-r from-tiktok-cyan to-tiktok-pink font-medium">
                            <FileText className="h-4 w-4 text-tiktok-cyan" />
                            配置提示词模板
                          </span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : createMode === "slideshow" ? (
                  /* 图片轮播模式 */
                  <div className="space-y-5 h-full flex flex-col">
                    {/* 模式选择 */}
                    <SlideshowModePanel
                      mode={slideshowMode}
                      onChange={setSlideshowMode}
                    />

                    {/* 素材上传区 */}
                    <div className="flex-1 overflow-y-auto">
                      {slideshowMode === 'random' ? (
                        /* 智能混剪: 批量上传 */
                        <div className="space-y-3">
                          <Label className="text-xs text-white/60">📷 上传图片 (最多300张)</Label>
                          <div className="border-2 border-dashed border-white/20 rounded-xl p-4 hover:border-mermaid-cyan/50 transition-colors">
                            <input
                              type="file"
                              multiple
                              accept="image/*"
                              className="hidden"
                              id="slideshow-images"
                              onChange={(e) => {
                                const files = Array.from(e.target.files || []).slice(0, 300);
                                setSlideshowImages(prev => [...prev, ...files].slice(0, 300));
                              }}
                            />
                            <label htmlFor="slideshow-images" className="cursor-pointer block text-center">
                              <Upload className="h-8 w-8 mx-auto text-white/30 mb-2" />
                              <p className="text-sm text-white/50">点击或拖拽上传图片</p>
                              <p className="text-xs text-white/30 mt-1">已上传 {slideshowImages.length} 张</p>
                            </label>
                          </div>
                          {slideshowImages.length > 0 && (
                            <div className="grid grid-cols-6 gap-2 max-h-[200px] overflow-y-auto">
                              {slideshowImages.slice(0, 18).map((file, i) => (
                                <div key={i} className="aspect-square rounded-lg overflow-hidden bg-white/5 relative group">
                                  <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
                                  <button
                                    onClick={() => setSlideshowImages(prev => prev.filter((_, idx) => idx !== i))}
                                    className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                  >
                                    <X className="h-2.5 w-2.5 text-white" />
                                  </button>
                                </div>
                              ))}
                              {slideshowImages.length > 18 && (
                                <div className="aspect-square rounded-lg bg-white/10 flex items-center justify-center text-white/60 text-sm">
                                  +{slideshowImages.length - 18}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        /* 场景编排: 位置上传 */
                        <PositionUploader
                          positions={slideshowPositions}
                          onChange={setSlideshowPositions}
                          maxPositions={15}
                        />
                      )}
                    </div>

                    {/* 配置区 */}
                    <div className="space-y-4 pt-4 border-t border-white/10">
                      {/* 每视频图片数 (仅智能混剪) */}
                      {slideshowMode === 'random' && (
                        <div className="space-y-2">
                          <Label className="text-xs text-white/60">🎬 每视频图片数</Label>
                          <div className="flex gap-2">
                            {[1, 3, 5, 8, 10, 15].map(n => (
                              <button
                                key={n}
                                onClick={() => setSlideshowImagesPerVideo(n)}
                                className={cn(
                                  "px-3 py-1.5 rounded-lg text-sm transition-all",
                                  slideshowImagesPerVideo === n
                                    ? "bg-mermaid-cyan/20 text-mermaid-cyan border border-mermaid-cyan/30"
                                    : "bg-white/5 text-white/50 hover:bg-white/10"
                                )}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 转场效果 */}
                      <TransitionPicker
                        value={slideshowTransition}
                        onChange={setSlideshowTransition}
                      />

                      {/* 图片时长 */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-white/60">⏱️ 图片时长</Label>
                          <span className="text-xs text-mermaid-cyan font-medium">{slideshowDuration}秒</span>
                        </div>
                        <input
                          type="range"
                          min={2}
                          max={10}
                          value={slideshowDuration}
                          onChange={(e) => setSlideshowDuration(parseInt(e.target.value))}
                          className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-mermaid-cyan"
                        />
                        <div className="flex justify-between text-[10px] text-white/40">
                          <span>2秒</span>
                          <span>总时长: {(() => {
                            const imageCount = slideshowMode === 'random'
                              ? Math.min(slideshowImages.length, slideshowImagesPerVideo)
                              : slideshowPositions[0]?.images.length || 1;
                            const total = imageCount * slideshowDuration - (imageCount - 1) * 0.5;
                            return total > 0 ? `${total.toFixed(1)}s` : '0s';
                          })()}</span>
                          <span>10秒</span>
                        </div>
                      </div>

                      {/* 音乐配置 */}
                      <MusicPoolManager
                        mode={slideshowMusicMode}
                        onModeChange={setSlideshowMusicMode}
                        customMusic={slideshowCustomMusic}
                        onCustomMusicChange={setSlideshowCustomMusic}
                        recommendedCount={Math.ceil(
                          slideshowMode === 'random'
                            ? Math.floor(slideshowImages.length / slideshowImagesPerVideo) / 10
                            : (slideshowPositions[0]?.images.length || 0) / 10
                        )}
                      />

                      {/* 字幕配置 */}
                      <SubtitleEditor
                        subtitle={slideshowSubtitle}
                        onChange={setSlideshowSubtitle}
                        previewFiles={
                          slideshowMode === 'random'
                            ? slideshowImages.slice(0, 10)
                            : (slideshowPositions[0]?.images?.slice(0, 10) || [])
                        }
                        aspectRatio="9:16"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* 右侧 40%：配置区域 */}
              <div className="flex-[4] p-6 overflow-y-auto bg-white/[0.02]">
                <div className="space-y-5">
                  <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    视频配置
                  </h3>

                  {/* 模型选择 */}
                  <div className="space-y-2">
                    <Label className="text-xs text-white/60">模型</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { id: "sora2", name: "Sora2", dur: 15, qual: "standard" },
                        { id: "sora2-pro", name: "Sora Pro", dur: 15, qual: "hd" },
                        { id: "veo3", name: "VEO3", dur: 8, qual: "standard" },
                        { id: "veo3-quality", name: "VEO3 HD", dur: 8, qual: "hd" },
                      ].map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            updateGlobalSettings("modelType", m.id as VideoModelType);
                            updateGlobalSettings("duration", m.dur as VideoDuration);
                            updateGlobalSettings("quality", m.qual as VideoQuality);
                          }}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                            globalSettings.modelType === m.id
                              ? "bg-gradient-to-r from-purple-500/30 to-tiktok-pink/30 text-white border border-purple-500/30"
                              : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 时长选择 */}
                  <div className="space-y-2">
                    <Label className="text-xs text-white/60">时长</Label>
                    <div className="flex gap-2">
                      {(globalSettings.modelType === "sora2" ? [10, 15] :
                        globalSettings.modelType === "sora2-pro" ? [15, 25] : [8]).map((dur) => (
                          <button
                            key={dur}
                            onClick={() => updateGlobalSettings("duration", dur as VideoDuration)}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                              globalSettings.duration === dur
                                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            {dur}秒
                          </button>
                        ))}
                    </div>
                  </div>

                  {/* 比例选择 */}
                  <div className="space-y-2">
                    <Label className="text-xs text-white/60">比例</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: "9:16", label: "竖版", icon: <Smartphone className="h-3 w-3" /> },
                        { id: "16:9", label: "横版", icon: <Monitor className="h-3 w-3" /> },
                      ].map((ar) => (
                        <button
                          key={ar.id}
                          onClick={() => updateGlobalSettings("aspectRatio", ar.id as VideoAspectRatio)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5",
                            globalSettings.aspectRatio === ar.id
                              ? "bg-tiktok-cyan/20 text-tiktok-cyan border border-tiktok-cyan/30"
                              : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          {ar.icon}
                          {ar.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* API 线路选择 - 仅 Sora2/Sora2 Pro 显示 */}
                  {(globalSettings.modelType === "sora2" ||
                    globalSettings.modelType === "sora2-pro") && (
                      <div className="space-y-2">
                        <Label className="text-xs text-white/60 flex items-center gap-1.5">
                          <span>🌐</span> API 线路
                          <span className="text-[10px] text-amber-400/80 ml-1">
                            (繁忙时切换)
                          </span>
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.values(API_LINES).map((line) => (
                            <button
                              key={line.id}
                              onClick={() => updateGlobalSettings("apiLine", line.id)}
                              className={cn(
                                "px-3 py-2 rounded-lg text-xs transition-all text-center font-medium",
                                globalSettings.apiLine === line.id
                                  ? "bg-tiktok-cyan/20 text-tiktok-cyan border border-tiktok-cyan/30"
                                  : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/70"
                              )}
                            >
                              {line.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* AI 模特选择 */}
                  <div className="space-y-2">
                    <Label className="text-xs text-white/60">AI 模特</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowModelSelector(true)}
                      className={cn(
                        "w-full h-9 justify-start gap-2 text-xs",
                        useAiModel && selectedModelId
                          ? "bg-pink-500/10 border-pink-500/30 text-pink-400"
                          : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                      )}
                    >
                      <UserCircle className="h-4 w-4" />
                      {useAiModel && selectedModelId ? selectedModelName : "选择模特 (可选)"}
                    </Button>
                  </div>

                  <div className="h-px bg-white/10" />

                  {/* 数量控制 */}
                  <div className="space-y-2">
                    <Label className="text-xs text-white/60">
                      {createMode === "image" ? "每张图创建数量" : "重复生成数量"}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                        onClick={() => setBatchCreateCount(Math.max(1, batchCreateCount - 1))}
                        disabled={batchCreateCount <= 1}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <input
                        type="number"
                        min={1}
                        max={300}
                        value={batchCreateCount}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val)) setBatchCreateCount(Math.min(300, Math.max(1, val)));
                        }}
                        className="w-16 h-8 bg-white/5 border border-white/10 rounded-lg text-center text-sm font-semibold text-white focus:outline-none focus:border-tiktok-cyan/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                        onClick={() => setBatchCreateCount(Math.min(300, batchCreateCount + 1))}
                        disabled={batchCreateCount >= 300}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <span className="text-xs text-white/40 ml-1">最多300</span>
                    </div>
                  </div>

                  {/* 积分消耗 */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <span className="text-xs text-white/50">预计消耗</span>
                    <div className="flex items-center gap-1 text-amber-400 font-medium">
                      <Zap className="h-4 w-4" />
                      <span>{getVideoBatchTotalPrice(globalSettings.modelType, globalSettings.duration, globalSettings.quality) * batchCreateCount} pts</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <DialogFooter className="px-6 py-4 border-t border-white/10 bg-white/[0.02] sm:justify-between">
              {/* Glass Ghost 保存方案按钮 */}
              <Button
                variant="ghost"
                onClick={() => setShowSaveTemplate(true)}
                className="bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 gap-2"
              >
                <Save className="h-4 w-4" />
                保存方案
              </Button>

              <div className="flex gap-3">
                {/* Glass Ghost 取消按钮 */}
                <Button
                  variant="ghost"
                  onClick={() => {
                    newTaskImages.forEach((img) => {
                      if (img.url.startsWith("blob:")) URL.revokeObjectURL(img.url);
                    });
                    if (referenceImageUrl.startsWith("blob:")) URL.revokeObjectURL(referenceImageUrl);
                    setNewTaskImages([]);
                    setPromptInput("");
                    setGroupNameInput("");
                    setReferenceImageUrl("");
                    setReferenceImageFile(null);
                    setBatchCreateCount(1);
                    setShowCreateDialog(false);
                  }}
                  className="bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10"
                >
                  取消
                </Button>

                {/* Mermaid Ultra 立即创建按钮 (高级形态) */}
                <button
                  className="relative px-8 py-2 rounded-full font-bold text-black text-sm transition-all duration-500 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.5)] border border-white/20 overflow-hidden group shadow-[0_0_20px_rgba(0,242,234,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={async () => {
                    if (createMode === "image") {
                      if (newTaskImages.length === 0) {
                        toast({ variant: "destructive", title: "请至少上传一张图片" });
                        return;
                      }
                      const validation = validateTaskImages(newTaskImages);
                      if (!validation.valid) {
                        toast({ variant: "destructive", title: validation.error || "图片校验失败" });
                        return;
                      }
                    } else {
                      if (!promptInput.trim() || promptInput.trim().length < 10) {
                        toast({ variant: "destructive", title: "提示词至少需要10个字符" });
                        return;
                      }
                    }

                    // 任务组名称必填验证
                    if (!groupNameInput.trim()) {
                      toast({ variant: "destructive", title: "请输入或选择任务组名称" });
                      return;
                    }

                    const currentMode = createMode;
                    const currentCount = batchCreateCount;
                    const currentPrompt = promptInput;
                    const currentGroup = groupNameInput;
                    const currentImages = [...newTaskImages];
                    const currentRefFile = referenceImageFile;
                    const currentRefUrl = referenceImageUrl;

                    setShowCreateDialog(false);
                    toast({ title: `⏳ 正在创建 ${currentCount} 个任务...` });

                    setTimeout(async () => {
                      try {
                        if (currentMode === "image") {
                          for (let i = 0; i < currentCount; i++) createTask([...currentImages], currentGroup.trim() || undefined);
                          setNewTaskImages([]);
                        } else {
                          let uploadedRefUrl = "";
                          if (currentRefFile) {
                            try {
                              const formData = new FormData();
                              formData.append("file", currentRefFile);
                              const uploadRes = await fetch("/api/upload/image", { method: "POST", body: formData });
                              const uploadResult = await uploadRes.json();
                              if (uploadResult.success && uploadResult.data?.url) uploadedRefUrl = uploadResult.data.url;
                            } catch (e) {
                              console.error("Upload reference image failed:", e);
                            }
                          }

                          createTaskFromPrompt(currentPrompt, uploadedRefUrl || undefined, currentCount, currentGroup || undefined);
                          setPromptInput("");
                          setGroupNameInput("");
                          if (currentRefUrl.startsWith("blob:")) URL.revokeObjectURL(currentRefUrl);
                          setReferenceImageUrl("");
                          setReferenceImageFile(null);
                        }
                        setBatchCreateCount(1);
                        toast({ title: `✅ 已创建 ${currentCount} 个任务` });
                        // 自动切换到新创建的任务组
                        setActiveGroup(currentGroup.trim());
                      } catch (error) {
                        console.error("Create tasks error:", error);
                        toast({ variant: "destructive", title: "创建任务失败，请重试" });
                      }
                    }, 50);
                  }}
                  disabled={createMode === "image" ? newTaskImages.length === 0 : !promptInput.trim()}
                >
                  <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
                  <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-300" />
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4 fill-black/20" />
                    立即创建 {batchCreateCount > 1 && `(${batchCreateCount})`}
                  </span>
                </button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 编辑任务图片弹窗 */}
        <Dialog open={!!editingTaskId} onOpenChange={(open) => !open && setEditingTaskId(null)}>
          <DialogContent className="max-w-2xl bg-background border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-tiktok-pink" />
                编辑任务素材
              </DialogTitle>
              <DialogDescription>调整图片顺序，确保第一张是适配Sora2的九宫格图</DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <ImageUploader images={editingImages} onImagesChange={setEditingImages} maxImages={4} />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingTaskId(null)}>
                取消
              </Button>
              <Button
                onClick={handleSaveTaskImages}
                className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black"
              >
                <Check className="h-4 w-4 mr-2" />
                保存更改
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 脚本预览弹窗 */}
        <ScriptPreviewDialog task={previewTask} open={!!previewTask} onClose={() => setPreviewTask(null)} />

        {/* 视频播放弹窗 */}
        <VideoPlayerDialog
          task={playingVideoTask}
          open={!!playingVideoTask}
          onClose={() => setPlayingVideoTask(null)}
          onDownload={handleDownloadTask}
        />

        {/* 批量下载进度弹窗 */}
        <DownloadProgressDialog
          progress={downloadProgress}
          onCancel={() => {
            cancelDownloadRef.current = true;
          }}
          onClose={() => {
            setDownloadProgress(prev => ({ ...prev, show: false }));
          }}
        />

        {/* AI模特选择弹窗 */}
        <Dialog open={showModelSelector} onOpenChange={setShowModelSelector}>
          <DialogContent className="max-w-2xl bg-black/95 border-white/10">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserCircle className="h-5 w-5 text-purple-400" />
                选择 AI 模特
              </DialogTitle>
              <DialogDescription>
                选择签约模特后，AI会将模特的外观特征应用到生成的视频中
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              {hiredModels.length === 0 ? (
                <div className="text-center py-8">
                  <UserCircle className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground">暂无签约模特</p>
                  <p className="text-sm text-muted-foreground mt-1">请先在模特中心签约模特</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {hiredModels.map((model) => (
                    <div
                      key={model.id}
                      onClick={() => {
                        setSelectedModelId(model.id);
                        setSelectedModelName(model.name);
                        setSelectedModelTriggerWord(model.trigger_word);
                        setUseAiModel(true);
                        setShowModelSelector(false);
                      }}
                      className={cn(
                        "relative rounded-xl border p-3 cursor-pointer transition-all",
                        selectedModelId === model.id
                          ? "border-purple-500 bg-purple-500/10"
                          : "border-border/50 hover:border-purple-500/50"
                      )}
                    >
                      <div className="aspect-square rounded-lg overflow-hidden bg-muted/30 mb-2">
                        {model.avatar_url ? (
                          <img
                            src={model.avatar_url}
                            alt={model.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <UserCircle className="h-12 w-12 text-muted-foreground/30" />
                          </div>
                        )}
                      </div>
                      <p className="text-sm font-medium text-center truncate">{model.name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowModelSelector(false)}>
                取消
              </Button>
              {useAiModel && (
                <Button
                  variant="destructive"
                  onClick={() => {
                    setUseAiModel(false);
                    setSelectedModelId(null);
                    setSelectedModelName(null);
                    setSelectedModelTriggerWord(null);
                    setShowModelSelector(false);
                  }}
                >
                  取消使用模特
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 提示词配置弹窗 */}
        <Dialog open={showPromptConfig} onOpenChange={setShowPromptConfig}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-background border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-tiktok-cyan" />
                提示词配置
              </DialogTitle>
              <DialogDescription>
                选择预设风格或自定义提示词，打造不同风格的带货视频
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* 视频风格选择 */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-amber-400" />
                  选择视频风格
                </Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {VIDEO_STYLES.map((style) => (
                    <button
                      key={style.id}
                      onClick={() => {
                        setSelectedStyle(style.id);
                        setCustomPrompts(style.prompts);
                      }}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all",
                        selectedStyle === style.id
                          ? "bg-tiktok-cyan/10 border-tiktok-cyan/50 ring-2 ring-tiktok-cyan/20"
                          : "bg-muted/30 border-border/50 hover:border-border"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{style.icon}</span>
                        <span className="font-medium text-sm">{style.name}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">
                        {style.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* 脚本生成提示词 */}
              <div className="space-y-4 p-4 rounded-xl bg-muted/30 border border-border/50">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-amber-400" />
                  口播脚本提示词
                  <Badge variant="outline" className="text-[10px]">
                    {selectedStyle === "default" ? "默认" : "自定义"}
                  </Badge>
                </h3>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">系统提示词</Label>
                  <textarea
                    value={customPrompts.talkingScriptSystem}
                    onChange={(e) => {
                      setSelectedStyle("custom");
                      setCustomPrompts(prev => ({ ...prev, talkingScriptSystem: e.target.value }));
                    }}
                    placeholder="留空使用默认提示词..."
                    className="w-full h-20 px-3 py-2 text-sm bg-background border border-border/50 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-tiktok-cyan/50"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">用户提示词</Label>
                  <textarea
                    value={customPrompts.talkingScriptUser}
                    onChange={(e) => {
                      setSelectedStyle("custom");
                      setCustomPrompts(prev => ({ ...prev, talkingScriptUser: e.target.value }));
                    }}
                    placeholder="留空使用默认提示词..."
                    className="w-full h-24 px-3 py-2 text-sm bg-background border border-border/50 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-tiktok-cyan/50"
                  />
                </div>
              </div>

              {/* 视频提示词 */}
              <div className="space-y-4 p-4 rounded-xl bg-muted/30 border border-border/50">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Video className="h-4 w-4 text-tiktok-pink" />
                  视频生成提示词
                </h3>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">系统提示词</Label>
                  <textarea
                    value={customPrompts.aiVideoPromptSystem}
                    onChange={(e) => {
                      setSelectedStyle("custom");
                      setCustomPrompts(prev => ({ ...prev, aiVideoPromptSystem: e.target.value }));
                    }}
                    placeholder="留空使用默认提示词..."
                    className="w-full h-20 px-3 py-2 text-sm bg-background border border-border/50 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-tiktok-cyan/50"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    用户提示词
                    <span className="ml-2 text-amber-400/80 text-[10px]">{"{{SCRIPT}}"} = 脚本占位符</span>
                  </Label>
                  <textarea
                    value={customPrompts.aiVideoPromptUser}
                    onChange={(e) => {
                      setSelectedStyle("custom");
                      setCustomPrompts(prev => ({ ...prev, aiVideoPromptUser: e.target.value }));
                    }}
                    placeholder="留空使用默认提示词..."
                    className="w-full h-24 px-3 py-2 text-sm bg-background border border-border/50 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-tiktok-cyan/50"
                  />
                </div>
              </div>

              {/* 提示 */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-400/90">
                  不同风格会影响脚本语气和视频呈现效果。建议先小批量测试后再大规模使用。
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCustomPrompts({
                    talkingScriptSystem: "",
                    talkingScriptUser: "",
                    aiVideoPromptSystem: "",
                    aiVideoPromptUser: "",
                  });
                  localStorage.removeItem("video-batch-custom-prompts");
                  toast({ title: "✅ 已重置为默认配置" });
                }}
                className="text-red-400 border-red-400/30 hover:bg-red-400/10"
              >
                重置为默认
              </Button>
              <Button variant="outline" onClick={() => setShowPromptConfig(false)}>
                取消
              </Button>
              <Button
                onClick={() => {
                  localStorage.setItem("video-batch-custom-prompts", JSON.stringify(customPrompts));
                  setShowPromptConfig(false);
                  toast({ title: "✅ 提示词配置已保存" });
                }}
                className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black"
              >
                保存配置
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Template Dialogs */}
        <SaveTemplateDialog
          open={showSaveTemplate}
          onOpenChange={setShowSaveTemplate}
          onSave={handleSaveTemplate}
          defaultName={`${globalSettings.modelType}-${globalSettings.duration}s-${globalSettings.aspectRatio}`}
          isUploading={isUploadingTemplate}
          configPreview={[
            { icon: <Film className="h-3.5 w-3.5" />, label: "模型", value: globalSettings.modelType === "sora2" ? "Sora 2.0" : globalSettings.modelType === "sora2-pro" ? "Sora 2.0 Pro" : globalSettings.modelType === "veo3" ? "VEO3 快速版" : "VEO3 高清版" },
            { icon: <Clock className="h-3.5 w-3.5" />, label: "时长", value: `${globalSettings.duration}秒` },
            { icon: <Monitor className="h-3.5 w-3.5" />, label: "比例", value: globalSettings.aspectRatio },
            { icon: <UserCircle className="h-3.5 w-3.5" />, label: "AI模特", value: useAiModel && selectedModelName ? selectedModelName : "未使用" },
            { icon: <ImageIcon className="h-3.5 w-3.5" />, label: "数量", value: `${batchCreateCount}个` },
          ]}
          imagePreview={newTaskImages.map(img => ({ url: img.url, name: img.name }))}
        />
        <TemplateManager
          open={showTemplateManager}
          onOpenChange={setShowTemplateManager}
          type="video_batch"
          onSelect={handleLoadTemplate}
        />

        {/* 删除任务组确认弹窗 - JCUI 2.0 Mermaid Glass */}
        <AlertDialog open={deleteGroupDialog.open} onOpenChange={(open) => setDeleteGroupDialog(prev => ({ ...prev, open }))}>
          <AlertDialogContent className="bg-[#0B0C10] border border-white/10 shadow-[0_0_60px_rgba(236,72,153,0.15)] backdrop-blur-xl rounded-2xl overflow-hidden max-w-md">
            {/* 顶部渐变装饰条 */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-mermaid-lime via-mermaid-cyan to-mermaid-pink" />

            <AlertDialogHeader className="pt-6">
              <AlertDialogTitle className="flex items-center gap-4 text-white text-lg">
                <div className="relative">
                  <div className="absolute inset-0 bg-mermaid-pink/30 rounded-xl blur-lg animate-pulse" />
                  <div className="relative p-3 rounded-xl bg-mermaid-pink/10 border border-mermaid-pink/30">
                    <Trash2 className="h-6 w-6 text-mermaid-pink" />
                  </div>
                </div>
                <div>
                  <span className="block">删除任务组</span>
                  <span className="text-xs text-white/40 font-normal">此操作无法撤销</span>
                </div>
              </AlertDialogTitle>
              <AlertDialogDescription className="text-white/60 pt-4 text-sm leading-relaxed">
                确定要删除任务组「<span className="text-white font-medium px-1.5 py-0.5 bg-white/10 rounded">{deleteGroupDialog.groupName}</span>」吗？
                <div className="mt-4 p-3 rounded-lg bg-mermaid-pink/5 border border-mermaid-pink/20">
                  <div className="flex items-center gap-2 text-mermaid-pink">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="font-medium">警告</span>
                  </div>
                  <p className="mt-1.5 text-xs text-white/50">
                    将删除该组下所有 <span className="text-mermaid-pink font-bold">{deleteGroupDialog.count}</span> 个任务，已生成的视频也将一并删除。
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-3 pt-6">
              <AlertDialogCancel className="flex-1 bg-white/5 border-white/10 text-white/80 hover:bg-white/10 hover:border-mermaid-cyan/30 hover:text-white rounded-xl transition-all">
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  removeGroup(deleteGroupDialog.groupName);
                  toast({ title: `🗑️ 已删除任务组「${deleteGroupDialog.groupName}」` });
                  setDeleteGroupDialog({ open: false, groupName: "", count: 0 });
                }}
                className="flex-1 bg-gradient-to-r from-mermaid-pink to-red-500 hover:from-mermaid-pink hover:to-red-400 text-white font-medium border-0 rounded-xl shadow-[0_0_20px_rgba(236,72,153,0.3)] hover:shadow-[0_0_30px_rgba(236,72,153,0.5)] transition-all hover:scale-[1.02] active:scale-95"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                确认删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider >
  );
}

