"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Play,
  Copy,
  Trash2,
  Eraser,
  Loader2,
  Check,
  X,
  AlertCircle,
  Maximize2,
  Clock,
  RectangleVertical,
  RectangleHorizontal,
  Zap,
  StopCircle,
  RotateCcw,
} from "lucide-react";
import type { AspectRatio, VideoDuration, TaskStatus } from "@/types/database";

// ============================================================================
// 类型定义
// ============================================================================

export interface TaskData {
  id: string;
  imageUrl: string;
  imageName?: string;
  prompt: string;
  duration: VideoDuration;
  aspectRatio: AspectRatio;
  status: TaskStatus;
  progress?: number;
  error?: string;
  outputUrl?: string;
  costCredits: number;
}

export interface TaskCardProps {
  task: TaskData;
  index: number;
  isProcessing?: boolean;
  onPromptChange: (id: string, prompt: string) => void;
  onStart: (id: string) => void;
  onStop?: (id: string) => void;
  onRetry?: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onClearPrompt: (id: string) => void;
  disabled?: boolean;
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
// Task Card 组件
// ============================================================================

export function TaskCard({
  task,
  index,
  isProcessing = false,
  onPromptChange,
  onStart,
  onStop,
  onRetry,
  onDuplicate,
  onDelete,
  onClearPrompt,
  disabled = false,
}: TaskCardProps) {
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 状态颜色映射
  const statusStyles: Record<TaskStatus, { bg: string; border: string; text: string }> = {
    draft: { bg: "bg-white/5", border: "border-white/10", text: "text-muted-foreground" },
    queued: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400" },
    processing: { bg: "bg-tiktok-cyan/10", border: "border-tiktok-cyan/30", text: "text-tiktok-cyan" },
    completed: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400" },
    failed: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400" },
  };

  const currentStyle = statusStyles[task.status];
  const isEditable = task.status === "draft";
  const isRunning = task.status === "processing" || task.status === "queued";

  return (
    <div
      className={cn(
        "group relative flex items-stretch gap-4 p-4 rounded-xl transition-all duration-300",
        currentStyle.bg,
        "border",
        currentStyle.border,
        "hover:shadow-lg hover:shadow-black/20",
        isRunning && "animate-pulse"
      )}
    >
      {/* ================================================================ */}
      {/* 序号指示器 */}
      {/* ================================================================ */}
      <div className="absolute -left-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-black border border-white/20 text-xs font-bold">
        {index + 1}
      </div>

      {/* ================================================================ */}
      {/* 左侧：图片缩略图 */}
      {/* ================================================================ */}
      <Dialog open={isImagePreviewOpen} onOpenChange={setIsImagePreviewOpen}>
        <DialogTrigger asChild>
          <button
            className={cn(
              "relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden",
              "bg-black/30 border border-white/10",
              "cursor-pointer transition-all duration-200",
              "hover:border-tiktok-cyan/50 hover:shadow-[0_0_20px_rgba(0,242,234,0.2)]",
              "focus:outline-none focus:ring-2 focus:ring-tiktok-cyan/50"
            )}
          >
            <img
              src={task.imageUrl}
              alt={task.imageName || `Task ${index + 1}`}
              className="w-full h-full object-cover"
            />
            {/* 放大图标 */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
              <Maximize2 className="h-5 w-5 text-white" />
            </div>
            {/* 状态指示器 */}
            {task.status === "completed" && (
              <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-emerald-500 flex items-center justify-center">
                <Check className="h-3 w-3 text-black" />
              </div>
            )}
            {task.status === "failed" && (
              <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
                <X className="h-3 w-3 text-black" />
              </div>
            )}
            {isRunning && (
              <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-tiktok-cyan flex items-center justify-center">
                <Loader2 className="h-3 w-3 text-black animate-spin" />
              </div>
            )}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl bg-black/95 border-white/10 p-2">
          <img
            src={task.imageUrl}
            alt={task.imageName || `Task ${index + 1}`}
            className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
          />
        </DialogContent>
      </Dialog>

      {/* ================================================================ */}
      {/* 中间：Prompt 输入区 */}
      {/* ================================================================ */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {/* Prompt 输入框 */}
        <Textarea
          ref={textareaRef}
          value={task.prompt}
          onChange={(e) => onPromptChange(task.id, e.target.value)}
          placeholder="输入创意提示词... (例如: 模特展示产品，风格活泼年轻，适合TikTok)"
          disabled={!isEditable || disabled}
          className={cn(
            "min-h-[60px] max-h-[120px] resize-none",
            "bg-black/30 border-white/10 rounded-lg",
            "text-sm placeholder:text-muted-foreground/50",
            "focus:border-tiktok-cyan/50 focus:ring-1 focus:ring-tiktok-cyan/30",
            !isEditable && "opacity-60 cursor-not-allowed"
          )}
        />

        {/* 参数标签行 */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* 时长标签 */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">{task.duration}</span>
          </div>

          {/* 画幅标签 */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10">
            {task.aspectRatio === "9:16" ? (
              <RectangleVertical className="h-3.5 w-3.5 text-tiktok-cyan" />
            ) : (
              <RectangleHorizontal className="h-3.5 w-3.5 text-tiktok-pink" />
            )}
            <span className="text-xs font-medium">{task.aspectRatio}</span>
          </div>

          {/* 积分标签 */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-amber-400">{task.costCredits}</span>
          </div>

          {/* 状态标签 */}
          {task.status !== "draft" && (
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md",
              currentStyle.bg,
              "border",
              currentStyle.border
            )}>
              {task.status === "queued" && <Clock className="h-3.5 w-3.5" />}
              {task.status === "processing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {task.status === "completed" && <Check className="h-3.5 w-3.5" />}
              {task.status === "failed" && <AlertCircle className="h-3.5 w-3.5" />}
              <span className={cn("text-xs font-medium capitalize", currentStyle.text)}>
                {task.status === "queued" && "排队中"}
                {task.status === "processing" && `生成中 ${task.progress || 0}%`}
                {task.status === "completed" && "已完成"}
                {task.status === "failed" && "失败"}
              </span>
            </div>
          )}

          {/* 错误信息 */}
          {task.error && (
            <span className="text-xs text-red-400 truncate max-w-[200px]" title={task.error}>
              {task.error}
            </span>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* 右侧：操作工具栏 */}
      {/* ================================================================ */}
      <div className="flex flex-col justify-center gap-1">
        {/* 开始/停止/重试按钮 */}
        {isRunning && onStop ? (
          /* 停止按钮 */
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onStop(task.id)}
                className="h-9 w-9 p-0 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
              >
                <StopCircle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>停止任务</p>
            </TooltipContent>
          </Tooltip>
        ) : task.status === "failed" && onRetry ? (
          /* 重试按钮 */
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRetry(task.id)}
                disabled={disabled}
                className="h-9 w-9 p-0 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>重试任务</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          /* 开始按钮 */
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onStart(task.id)}
                disabled={!isEditable || disabled || isRunning}
                className={cn(
                  "h-9 w-9 p-0 rounded-lg transition-all duration-200",
                  isEditable && !disabled
                    ? "bg-tiktok-cyan/20 text-tiktok-cyan hover:bg-tiktok-cyan/30 hover:shadow-[0_0_15px_rgba(0,242,234,0.3)]"
                    : "opacity-50 cursor-not-allowed"
                )}
              >
                {task.status === "completed" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{task.status === "completed" ? "已完成" : "开始生成"}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* 复制按钮 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDuplicate(task.id)}
              disabled={disabled}
              className="h-9 w-9 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>复制任务</p>
          </TooltipContent>
        </Tooltip>

        {/* 清空 Prompt 按钮 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onClearPrompt(task.id)}
              disabled={!isEditable || disabled || !task.prompt}
              className="h-9 w-9 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-30"
            >
              <Eraser className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>清空提示词</p>
          </TooltipContent>
        </Tooltip>

        {/* 删除按钮 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(task.id)}
              disabled={isRunning || disabled}
              className="h-9 w-9 p-0 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>删除任务</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* ================================================================ */}
      {/* 进度条（处理中显示） */}
      {/* ================================================================ */}
      {isRunning && task.progress !== undefined && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50 rounded-b-xl overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink transition-all duration-300"
            style={{ width: `${task.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default TaskCard;

