"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Zap,
  Upload,
  Play,
  Pause,
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
  PlayCircle,
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Types
import {
  type VideoBatchTask,
  type TaskImageInfo,
  type VideoAspectRatio,
  PIPELINE_STEPS,
  VIDEO_BATCH_PRICING,
  getStatusLabel,
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
  getVideoBatchTaskCost,
  validateTaskImages,
} from "@/stores/video-batch-store";

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

function ImageUploader({ images, onImagesChange, maxImages = 10, compact = false }: ImageUploaderProps) {
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
          <strong>第一张图片必须是高清九宫格图（3×3 多角度）</strong>，其余为补充素材
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
}

function VideoTaskCard({
  task,
  isSelected,
  onToggleSelect,
  onStart,
  onRemove,
  onClone,
  onViewScript,
  onEditImages,
  onPlayVideo,
}: VideoTaskCardProps) {
  const cost = getVideoBatchTaskCost();
  const validation = validateTaskImages(task.images);
  const canStart = task.status === "pending" && validation.valid;

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
        "group relative rounded-xl border transition-all duration-200 overflow-hidden",
        isSelected
          ? "bg-tiktok-pink/5 border-tiktok-pink/50 ring-2 ring-tiktok-pink/20"
          : "bg-card/50 border-border/50 hover:border-border",
        task.status !== "pending" && task.status !== "success" && task.status !== "failed" && "ring-2 ring-tiktok-cyan/30"
      )}
    >
      {/* 选择复选框 */}
      <div
        onClick={onToggleSelect}
        className={cn(
          "absolute top-3 left-3 z-10 flex h-5 w-5 items-center justify-center rounded border cursor-pointer transition-all",
          isSelected
            ? "bg-tiktok-pink border-tiktok-pink text-white"
            : "border-white/30 bg-black/50 hover:border-tiktok-pink/50"
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
            {/* 视频标识 */}
            <div className="absolute top-2 right-2 bg-emerald-500 text-white text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <Video className="h-3 w-3" />
              已生成
            </div>
          </div>
        ) : (
          /* 图片预览 */
          <div className="absolute inset-0" onClick={onEditImages}>
            {task.images.length > 0 ? (
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

      {/* 卡片信息 */}
      <div className="p-3 space-y-3">
        {/* 状态和流水线进度 */}
        <div className="flex items-center justify-between gap-2">
          {getStatusBadge()}
          <PipelineProgress currentStep={task.currentStep} status={task.status} />
        </div>

        {/* 任务配置信息 */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1">
            <ImageIcon className="h-2.5 w-2.5" />
            {task.images.length} 张图片
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            {task.aspectRatio}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            15s
          </Badge>
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
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs font-semibold text-amber-400">{cost} Credits</span>
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
                    <a
                      href={task.soraVideoUrl}
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
}

// ============================================================================
// VideoPlayerDialog 组件 - 视频全屏播放弹窗
// ============================================================================

interface VideoPlayerDialogProps {
  task: VideoBatchTask | null;
  open: boolean;
  onClose: () => void;
}

function VideoPlayerDialog({ task, open, onClose }: VideoPlayerDialogProps) {
  if (!task || !task.soraVideoUrl) return null;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 bg-black border-white/10 overflow-hidden">
        <div className="relative">
          {/* 视频播放器 */}
          <video 
            src={task.soraVideoUrl} 
            controls 
            autoPlay
            className="w-full max-h-[80vh] bg-black"
          />
          
          {/* 底部操作栏 */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  生成成功
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {task.aspectRatio}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  15秒
                </Badge>
              </div>
              
              {/* 下载按钮 */}
              <a
                href={task.soraVideoUrl}
                download={`video-${task.id}.mp4`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold rounded-lg hover:opacity-90 transition-opacity"
              >
                <Download className="h-4 w-4" />
                下载视频
              </a>
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
// 主页面
// ============================================================================

export default function VideoBatchPage() {
  const { toast } = useToast();

  // Store
  const tasks = useVideoBatchTasks();
  const jobStatus = useVideoBatchJobStatus();
  const globalSettings = useVideoBatchGlobalSettings();
  const selectedTaskIds = useVideoBatchSelectedIds();
  const selectedCount = useVideoBatchSelectedCount();
  const stats = useVideoBatchStats();

  const {
    createTask,
    cloneTask,
    updateTaskStatus,
    updateTaskImages,
    removeTask,
    clearAllTasks,
    toggleTaskSelection,
    selectAllTasks,
    clearSelection,
    removeSelectedTasks,
    startBatch,
    pauseBatch,
    resumeBatch,
    cancelBatch,
    resetBatch,
    updateGlobalSettings,
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
  
  // AI模特功能
  const [useAiModel, setUseAiModel] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string>("");
  const [selectedModelTriggerWord, setSelectedModelTriggerWord] = useState<string>("");
  const [hiredModels, setHiredModels] = useState<Array<{ id: string; name: string; trigger_word: string; avatar_url: string }>>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);

  // 获取用户积分和签约模特
  useEffect(() => {
    // 获取积分
    fetch("/api/user/credits")
      .then((res) => res.json())
      .then((data) => {
        if (data.credits !== undefined) setUserCredits(data.credits);
        if (data.userId) setUserId(data.userId);
      })
      .catch(console.error);

    // 获取签约模特
    fetch("/api/contracts")
      .then((res) => res.json())
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

  // 计算属性
  const pendingTasks = tasks.filter((t) => t.status === "pending" && validateTaskImages(t.images).valid);
  const canStartBatch =
    pendingTasks.length > 0 &&
    jobStatus === "idle" &&
    userCredits >= stats.totalCost &&
    userId !== null;

  // 上传单张图片到服务器
  const uploadImageToServer = async (image: TaskImageInfo): Promise<string> => {
    // 如果已经是 http/https URL，直接返回
    if (image.url.startsWith("http://") || image.url.startsWith("https://")) {
      return image.url;
    }

    // 如果是 blob URL，需要上传
    if (image.url.startsWith("blob:") && image.file) {
      const formData = new FormData();
      formData.append("file", image.file);

      const response = await fetch("/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "图片上传失败");
      }

      return result.data.url;
    }

    throw new Error("无效的图片格式");
  };

  // 单个任务处理 - 调用实际 API
  const handleStartSingleTask = useCallback(
    async (task: VideoBatchTask) => {
      if (!validateTaskImages(task.images).valid) {
        toast({ variant: "destructive", title: "请先完善任务图片" });
        return;
      }

      try {
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
        
        const imageUrls = uploadedUrls;
        const scriptResponse = await fetch("/api/video-batch/generate-talking-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: imageUrls, taskId: task.id }),
        });
        
        const scriptResult = await scriptResponse.json();
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
          }),
        });
        
        const promptResult = await promptResponse.json();
        if (!promptResult.success) {
          throw new Error(promptResult.error || "生成提示词失败");
        }

        updateTaskStatus(task.id, "generating_video", {
          currentStep: 3,
          progress: 65,
          doubaoAiVideoPrompt: promptResult.data.prompt,
        });

        // ==================== Step 3: 生成 Sora 视频 ====================
        // 使用上传后的主图 URL（第一张图）
        const mainGridImageUrl = uploadedUrls[0];
        if (!mainGridImageUrl) {
          throw new Error("缺少九宫格主图");
        }

        // 最终提示词（已包含AI模特触发词）
        let finalVideoPrompt = promptResult.data.prompt;
        
        // 如果使用AI模特且有trigger word，确保它在最终提示词中
        if (useAiModel && selectedModelTriggerWord && !finalVideoPrompt.includes(selectedModelTriggerWord)) {
          finalVideoPrompt = `[AI MODEL: ${selectedModelTriggerWord}]\n\n${finalVideoPrompt}`;
          console.log("[Video Batch] Added AI model trigger word to final prompt");
        }

        const videoResponse = await fetch("/api/video-batch/generate-sora-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aiVideoPrompt: finalVideoPrompt,
            mainGridImageUrl: mainGridImageUrl,
            aspectRatio: task.aspectRatio,
            durationSeconds: 15,
            taskId: task.id,
          }),
        });
        
        const videoResult = await videoResponse.json();
        if (!videoResult.success) {
          throw new Error(videoResult.error || "视频生成失败");
        }

        // ==================== 完成 ====================
        updateTaskStatus(task.id, "success", {
          currentStep: 4,
          progress: 100,
          soraTaskId: videoResult.data.soraTaskId,
          soraVideoUrl: videoResult.data.videoUrl,
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
      }
    },
    [updateTaskStatus, toast, useAiModel, selectedModelTriggerWord]
  );

  // 批量处理（顺序执行，避免API超时）
  const handleStartBatch = useCallback(async () => {
    if (!canStartBatch) return;

    startBatch();
    toast({
      title: "🚀 批量处理已启动",
      description: `共 ${pendingTasks.length} 个任务，将依次执行避免超时`,
    });

    // 顺序执行任务，避免同时请求导致API超时
    for (let i = 0; i < pendingTasks.length; i++) {
      const task = pendingTasks[i];
      
      // 检查是否被暂停或取消
      const currentState = useVideoBatchStore.getState();
      if (currentState.jobStatus !== "running") {
        console.log("[Video Batch] Batch stopped, remaining tasks:", pendingTasks.length - i);
        break;
      }
      
      await handleStartSingleTask(task);
      
      // 任务之间添加短暂延迟
      if (i < pendingTasks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // 更新最终状态
    const currentState = useVideoBatchStore.getState();
    const allDone = currentState.tasks.every(
      (t) => t.status === "success" || t.status === "failed" || t.status === "pending"
    );
    if (allDone && currentState.jobStatus === "running") {
      useVideoBatchStore.setState({ jobStatus: "completed" });
      const finalStats = {
        success: currentState.tasks.filter((t) => t.status === "success").length,
        failed: currentState.tasks.filter((t) => t.status === "failed").length,
      };
      toast({
        title: "🎉 批量处理完成",
        description: `成功 ${finalStats.success}，失败 ${finalStats.failed}`,
      });
    }
  }, [canStartBatch, pendingTasks, startBatch, handleStartSingleTask, toast]);

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
        {/* 页面头部 */}
        <div className="flex items-center gap-4">
          <Link href="/pro-studio">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Video className="h-6 w-6 text-tiktok-cyan" />
              <span className="gradient-tiktok-text">批量视频生产</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              上传产品图片 → 生成口播脚本 → 生成AI提示词 → Sora2生成15秒视频
            </p>
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

        {/* 流水线说明 */}
        <Card className="glass-card">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              {PIPELINE_STEPS.map((step, index) => (
                <div key={step.step} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20 flex items-center justify-center text-lg">
                      {step.icon}
                    </div>
                    <p className="text-xs font-medium mt-2">{step.label}</p>
                    <p className="text-[10px] text-muted-foreground">{step.description}</p>
                  </div>
                  {index < PIPELINE_STEPS.length - 1 && (
                    <div className="w-16 h-0.5 bg-gradient-to-r from-tiktok-cyan/50 to-tiktok-pink/50 mx-4" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 全局配置 */}
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-tiktok-cyan" />
              全局配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              {/* 视频比例 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">视频比例</Label>
                <div className="flex gap-1">
                  {(["9:16", "16:9"] as VideoAspectRatio[]).map((ratio) => (
                    <Button
                      key={ratio}
                      variant="outline"
                      size="sm"
                      onClick={() => updateGlobalSettings("aspectRatio", ratio)}
                      className={cn(
                        "h-8 px-3 text-xs gap-1",
                        globalSettings.aspectRatio === ratio
                          ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan"
                          : "btn-subtle"
                      )}
                    >
                      {ratio === "9:16" && <Smartphone className="h-3 w-3" />}
                      {ratio === "16:9" && <Monitor className="h-3 w-3" />}
                      {ratio}
                    </Button>
                  ))}
                </div>
              </div>

              {/* AI模特选择 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">AI模特</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!useAiModel) {
                        setShowModelSelector(true);
                      } else {
                        setUseAiModel(false);
                        setSelectedModelId(null);
                        setSelectedModelName("");
                        setSelectedModelTriggerWord("");
                      }
                    }}
                    className={cn(
                      "h-8 px-3 text-xs gap-1",
                      useAiModel
                        ? "bg-purple-500/20 border-purple-500/50 text-purple-400"
                        : "btn-subtle"
                    )}
                  >
                    <UserCircle className="h-3 w-3" />
                    {useAiModel ? selectedModelName || "已选择" : "选择模特"}
                  </Button>
                  {useAiModel && (
                    <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px]">
                      已启用
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex-1" />

              {/* 创建任务按钮 */}
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="h-9 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90 text-black font-semibold"
              >
                <FolderUp className="h-4 w-4 mr-2" />
                创建视频任务
              </Button>
            </div>

            {/* 费用说明 */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground p-2 rounded-lg bg-muted/30">
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                脚本生成: {VIDEO_BATCH_PRICING.doubaoScript} pts
              </span>
              <span className="flex items-center gap-1">
                <Wand2 className="h-3 w-3" />
                提示词生成: {VIDEO_BATCH_PRICING.doubaoPrompt} pts
              </span>
              <span className="flex items-center gap-1">
                <Film className="h-3 w-3" />
                视频生成: {VIDEO_BATCH_PRICING.sora15s} pts
              </span>
              <span className="font-semibold text-amber-400">
                总计: {VIDEO_BATCH_PRICING.total} pts/任务
              </span>
            </div>
          </CardContent>
        </Card>

        {/* 任务列表 */}
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Film className="h-4 w-4 text-tiktok-cyan" />
                  任务队列
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {tasks.length} 个任务
                </Badge>
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
                onClick={() => setShowCreateDialog(true)}
              >
                <Video className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">暂无视频任务</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  点击"创建视频任务"开始批量生产
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tasks.map((task) => (
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
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 底部控制栏 */}
        {tasks.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-xl">
            <div className="container max-w-7xl mx-auto px-6 py-4">
              <div className="flex items-center justify-between">
                {/* 统计信息 */}
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Video className="h-5 w-5 text-muted-foreground" />
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
                  </div>

                  {(stats.success > 0 || stats.failed > 0) && (
                    <>
                      <div className="h-5 w-px bg-border/50" />
                      <div className="flex items-center gap-3 text-sm">
                        {stats.success > 0 && (
                          <span className="flex items-center gap-1 text-emerald-500">
                            <CheckCircle2 className="h-4 w-4" />
                            {stats.success}
                          </span>
                        )}
                        {stats.failed > 0 && (
                          <span className="flex items-center gap-1 text-red-400">
                            <XCircle className="h-4 w-4" />
                            {stats.failed}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-3">
                  {jobStatus === "idle" && (
                    <Button
                      onClick={handleStartBatch}
                      disabled={!canStartBatch}
                      className="h-11 px-6 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90 text-black font-semibold"
                    >
                      <PlayCircle className="h-5 w-5 mr-2" />
                      开始批量生成
                    </Button>
                  )}

                  {jobStatus === "running" && (
                    <>
                      <Button
                        onClick={pauseBatch}
                        variant="outline"
                        className="h-11 px-4 border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
                      >
                        <Pause className="h-4 w-4 mr-2" />
                        暂停
                      </Button>
                      <Button
                        onClick={cancelBatch}
                        variant="outline"
                        className="h-11 px-4 border-red-500/50 text-red-500 hover:bg-red-500/10"
                      >
                        <X className="h-4 w-4 mr-2" />
                        取消
                      </Button>
                    </>
                  )}

                  {jobStatus === "paused" && (
                    <>
                      <Button
                        onClick={resumeBatch}
                        className="h-11 px-4 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90 text-black"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        继续
                      </Button>
                      <Button
                        onClick={cancelBatch}
                        variant="outline"
                        className="h-11 px-4 border-red-500/50 text-red-500 hover:bg-red-500/10"
                      >
                        <X className="h-4 w-4 mr-2" />
                        取消
                      </Button>
                    </>
                  )}

                  {(jobStatus === "completed" || jobStatus === "cancelled") && (
                    <Button onClick={resetBatch} variant="outline" className="h-11 px-4">
                      <RotateCcw className="h-4 w-4 mr-2" />
                      重新开始
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 创建任务弹窗 */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-2xl bg-black/95 border-white/10">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderUp className="h-5 w-5 text-tiktok-cyan" />
                创建视频任务
              </DialogTitle>
              <DialogDescription>上传产品图片，第一张必须是高清九宫格图</DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <ImageUploader images={newTaskImages} onImagesChange={setNewTaskImages} maxImages={10} />
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setNewTaskImages([]);
                  setBatchCreateCount(1);
                  setShowCreateDialog(false);
                }}
              >
                取消
              </Button>
              <div className="flex items-center gap-3">
                {/* 任务数量选择器 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">创建数量:</span>
                  <div className="flex items-center border border-border/50 rounded-lg overflow-hidden">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setBatchCreateCount(Math.max(1, batchCreateCount - 1))}
                      className="h-8 w-8 rounded-none border-r border-border/50"
                      disabled={batchCreateCount <= 1}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-10 text-center text-sm font-medium">{batchCreateCount}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setBatchCreateCount(Math.min(20, batchCreateCount + 1))}
                      className="h-8 w-8 rounded-none border-l border-border/50"
                      disabled={batchCreateCount >= 20}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    if (newTaskImages.length === 0) {
                      toast({ variant: "destructive", title: "请至少上传一张图片" });
                      return;
                    }
                    const validation = validateTaskImages(newTaskImages);
                    if (!validation.valid) {
                      toast({ variant: "destructive", title: validation.error || "图片校验失败" });
                      return;
                    }
                    // 批量创建相同图片的任务
                    for (let i = 0; i < batchCreateCount; i++) {
                      createTask([...newTaskImages]);
                    }
                    setNewTaskImages([]);
                    setBatchCreateCount(1);
                    setShowCreateDialog(false);
                    toast({ title: `✅ 已创建 ${batchCreateCount} 个任务` });
                  }}
                  disabled={newTaskImages.length === 0}
                  className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black"
                >
                  <Check className="h-4 w-4 mr-2" />
                  创建 {batchCreateCount > 1 ? `${batchCreateCount} 个任务` : "任务"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 编辑任务图片弹窗 */}
        <Dialog open={!!editingTaskId} onOpenChange={(open) => !open && setEditingTaskId(null)}>
          <DialogContent className="max-w-2xl bg-black/95 border-white/10">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-tiktok-pink" />
                编辑任务素材
              </DialogTitle>
              <DialogDescription>调整图片顺序，确保第一张是高清九宫格图</DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <ImageUploader images={editingImages} onImagesChange={setEditingImages} maxImages={10} />
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
        <VideoPlayerDialog task={playingVideoTask} open={!!playingVideoTask} onClose={() => setPlayingVideoTask(null)} />

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
                    setSelectedModelName("");
                    setSelectedModelTriggerWord("");
                    setShowModelSelector(false);
                  }}
                >
                  取消使用模特
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

