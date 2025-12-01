"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Zap,
  Upload,
  Play,
  Pause,
  Loader2,
  Download,
  ImageIcon,
  Video,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Check,
  Trash2,
  Factory,
  MoreVertical,
  Copy,
  Edit3,
  PlayCircle,
  AlertCircle,
  Settings2,
  FolderUp,
  Wand2,
  Smartphone,
  Monitor,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// 导入共享类型和工具
// ============================================================================

import {
  type OutputMode,
  type VideoModel,
  type VideoAspectRatio,
  type NanoTier,
  type ImageAspectRatio,
  type ImageResolution,
  VIDEO_MODEL_PRICING,
  NANO_PRICING,
  IMAGE_ASPECT_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
} from "@/types/generation";

// 导入批量执行器 (复用 generation-client 的 API 调用)
import {
  createBatchExecutor,
  type BatchExecutor,
  type BatchExecutionStats,
} from "@/lib/batch-executor";

// ============================================================================
// 导入 Zustand Store
// ============================================================================

import {
  useBatchStore,
  useBatchTasks,
  useBatchJobStatus,
  useBatchGlobalSettings,
  useBatchSelectedIds,
  useBatchSelectedCount,
  useBatchStats,
  getTaskCost,
  type BatchTask,
  type BatchTaskStatus,
} from "@/stores/batch-store";

// ============================================================================
// CompactTaskRow 组件
// ============================================================================

interface CompactTaskRowProps {
  task: BatchTask;
  index: number;
  isSelected: boolean;
  onToggleSelect: () => void;
  onUpdatePrompt: (prompt: string) => void;
  onUpdateConfig: (key: string, value: unknown) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

function CompactTaskRow({
  task,
  index,
  isSelected,
  onToggleSelect,
  onUpdatePrompt,
  onUpdateConfig,
  onDuplicate,
  onRemove,
}: CompactTaskRowProps) {
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [localPrompt, setLocalPrompt] = useState(task.config.prompt);
  const cost = getTaskCost(task.config);

  const handleSavePrompt = () => {
    onUpdatePrompt(localPrompt);
    setIsEditingPrompt(false);
  };

  const renderStatusBadge = (status: BatchTaskStatus) => {
    switch (status) {
      case "draft":
        return (
          <Badge variant="outline" className="bg-muted/50 text-[10px] h-5 px-1.5">
            <Edit3 className="h-2.5 w-2.5 mr-0.5" />
            草稿
          </Badge>
        );
      case "queued":
        return (
          <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-[10px] h-5 px-1.5">
            <Clock className="h-2.5 w-2.5 mr-0.5" />
            排队
          </Badge>
        );
      case "processing":
        return (
          <Badge className="bg-tiktok-cyan/10 text-tiktok-cyan border-tiktok-cyan/30 text-[10px] h-5 px-1.5">
            <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" />
            处理中
          </Badge>
        );
      case "success":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-[10px] h-5 px-1.5">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
            完成
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/10 text-red-500 border-red-500/30 text-[10px] h-5 px-1.5">
            <XCircle className="h-2.5 w-2.5 mr-0.5" />
            失败
          </Badge>
        );
    }
  };

  return (
    <div
      className={cn(
        "group flex items-start gap-3 p-3 rounded-xl border transition-all",
        isSelected
          ? "bg-tiktok-cyan/5 border-tiktok-cyan/30"
          : "bg-card/50 border-border/50 hover:border-border",
        task.status === "processing" && "ring-2 ring-tiktok-cyan/30"
      )}
    >
      {/* 选择框 */}
      <div
        onClick={onToggleSelect}
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded border cursor-pointer transition-colors mt-1",
          isSelected
            ? "bg-tiktok-cyan border-tiktok-cyan text-black"
            : "border-border/50 hover:border-tiktok-cyan/50"
        )}
      >
        {isSelected && <Check className="h-3 w-3" />}
      </div>

      {/* 缩略图 */}
      <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-muted/30 border border-border/50">
        {task.config.sourceImageUrl ? (
          <img
            src={task.config.sourceImageUrl}
            alt="Thumbnail"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {task.config.outputMode === "video" ? (
              <Video className="h-6 w-6 text-muted-foreground/50" />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
            )}
          </div>
        )}
      </div>

      {/* 中间内容 */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* 顶部信息栏 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-muted-foreground">#{index + 1}</span>
          {renderStatusBadge(task.status)}
          
          {/* 参数概览 */}
          {task.config.outputMode === "video" ? (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Badge variant="outline" className="h-5 px-1.5 gap-1">
                <Video className="h-2.5 w-2.5" />
                {VIDEO_MODEL_PRICING[task.config.videoModel!]?.duration || "10s"}
              </Badge>
              <Badge variant="outline" className="h-5 px-1.5">
                {task.config.videoAspectRatio || "9:16"}
              </Badge>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Badge variant="outline" className="h-5 px-1.5 gap-1">
                <ImageIcon className="h-2.5 w-2.5" />
                {task.config.imageTier?.toUpperCase() || "FAST"}
              </Badge>
              <Badge variant="outline" className="h-5 px-1.5">
                {task.config.imageAspectRatio || "auto"}
              </Badge>
            </div>
          )}
        </div>

        {/* Prompt 输入框 */}
        {isEditingPrompt ? (
          <div className="flex gap-2">
            <Textarea
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              className="input-surface min-h-[60px] text-sm resize-none flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) handleSavePrompt();
                if (e.key === "Escape") setIsEditingPrompt(false);
              }}
            />
            <div className="flex flex-col gap-1">
              <Button size="sm" onClick={handleSavePrompt} className="h-7 px-2">
                <Check className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditingPrompt(false)} className="h-7 px-2">
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => setIsEditingPrompt(true)}
            className="p-2 rounded-lg bg-muted/30 border border-border/50 cursor-text hover:border-tiktok-cyan/30 transition-colors min-h-[40px]"
          >
            <p className="text-sm text-foreground line-clamp-2">
              {task.config.prompt || (
                <span className="text-muted-foreground italic">点击输入 Prompt...</span>
              )}
            </p>
          </div>
        )}

        {/* 进度条 */}
        {task.status === "processing" && task.progress !== undefined && (
          <div className="space-y-1">
            <Progress value={task.progress} className="h-1" />
            <p className="text-[10px] text-muted-foreground">{task.progress}%</p>
          </div>
        )}

        {/* 错误信息 */}
        {task.status === "failed" && task.error && (
          <p className="text-[10px] text-red-400 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {task.error}
          </p>
        )}

        {/* 结果预览 */}
        {task.status === "success" && task.resultUrl && (
          <div className="flex items-center gap-2">
            {task.config.outputMode === "video" ? (
              <video src={task.resultUrl} className="h-12 rounded border border-border/50" controls />
            ) : (
              <img src={task.resultUrl} alt="Result" className="h-12 rounded border border-border/50 object-cover" />
            )}
            <a
              href={task.resultUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-tiktok-cyan hover:underline flex items-center gap-1"
            >
              <Download className="h-3 w-3" />
              下载
            </a>
          </div>
        )}
      </div>

      {/* 右侧操作 */}
      <div className="flex flex-col items-end gap-2 shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold text-amber-400">{cost} pts</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4 mr-2" />
                复制
              </DropdownMenuItem>
              {task.resultUrl && (
                <DropdownMenuItem asChild>
                  <a href={task.resultUrl} download target="_blank" rel="noopener noreferrer">
                    <Download className="h-4 w-4 mr-2" />
                    下载
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRemove} className="text-red-400">
                <Trash2 className="h-4 w-4 mr-2" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="h-7 w-7 text-red-400 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// GlobalToolbar 组件
// ============================================================================

interface GlobalToolbarProps {
  mode: OutputMode;
  onBatchUpload: (files: FileList) => void;
  onApplyToAll: () => void;
}

function GlobalToolbar({ mode, onBatchUpload, onApplyToAll }: GlobalToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const globalSettings = useBatchGlobalSettings();
  const { updateGlobalSettings } = useBatchStore();

  return (
    <Card className="glass-card">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* 模板配置标题 */}
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-tiktok-cyan" />
            <span className="text-sm font-medium">全局模板</span>
          </div>

          <div className="h-6 w-px bg-border/50" />

          {/* 视频模式配置 */}
          {mode === "video" && (
            <>
              {/* 模型选择 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">时长</Label>
                <Select
                  value={globalSettings.videoModel}
                  onValueChange={(v) => updateGlobalSettings("videoModel", v as VideoModel)}
                >
                  <SelectTrigger className="w-[180px] h-8 text-xs input-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(VIDEO_MODEL_PRICING).map(([key, value]) => (
                      <SelectItem key={key} value={key} className="text-xs">
                        {value.duration} - {value.credits} pts
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 宽高比 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">比例</Label>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateGlobalSettings("videoAspectRatio", "9:16")}
                    className={cn(
                      "h-8 px-3 text-xs",
                      globalSettings.videoAspectRatio === "9:16"
                        ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan"
                        : "btn-subtle"
                    )}
                  >
                    <Smartphone className="h-3 w-3 mr-1" />
                    9:16
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateGlobalSettings("videoAspectRatio", "16:9")}
                    className={cn(
                      "h-8 px-3 text-xs",
                      globalSettings.videoAspectRatio === "16:9"
                        ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan"
                        : "btn-subtle"
                    )}
                  >
                    <Monitor className="h-3 w-3 mr-1" />
                    16:9
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* 图片模式配置 */}
          {mode === "image" && (
            <>
              {/* 质量 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">质量</Label>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateGlobalSettings("imageTier", "fast")}
                    className={cn(
                      "h-8 px-3 text-xs",
                      globalSettings.imageTier === "fast"
                        ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan"
                        : "btn-subtle"
                    )}
                  >
                    Fast ({NANO_PRICING.fast.credits}pts)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateGlobalSettings("imageTier", "pro")}
                    className={cn(
                      "h-8 px-3 text-xs",
                      globalSettings.imageTier === "pro"
                        ? "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink"
                        : "btn-subtle"
                    )}
                  >
                    Pro ({NANO_PRICING.pro.credits}pts)
                  </Button>
                </div>
              </div>

              {/* 宽高比 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">比例</Label>
                <Select
                  value={globalSettings.imageAspectRatio}
                  onValueChange={(v) => updateGlobalSettings("imageAspectRatio", v as ImageAspectRatio)}
                >
                  <SelectTrigger className="w-[100px] h-8 text-xs input-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_ASPECT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex-1" />

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onApplyToAll}
                    className="h-8 text-xs btn-subtle"
                  >
                    <Wand2 className="h-3.5 w-3.5 mr-1" />
                    应用到全部
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>将当前全局设置应用到所有草稿任务</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => e.target.files && onBatchUpload(e.target.files)}
              className="hidden"
              ref={fileInputRef}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="h-8 text-xs bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
            >
              <FolderUp className="h-3.5 w-3.5 mr-1" />
              批量上传
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// BottomBar 组件
// ============================================================================

interface BottomBarProps {
  totalTasks: number;
  totalCost: number;
  userCredits: number;
  jobStatus: string;
  canStart: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onReset: () => void;
  successCount: number;
  failedCount: number;
  autoDownload: boolean;
  onAutoDownloadChange: (value: boolean) => void;
}

function BottomBar({
  totalTasks,
  totalCost,
  userCredits,
  jobStatus,
  canStart,
  onStart,
  onPause,
  onResume,
  onCancel,
  onReset,
  successCount,
  failedCount,
  autoDownload,
  onAutoDownloadChange,
}: BottomBarProps) {
  const insufficientCredits = userCredits < totalCost;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-xl">
      <div className="container max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* 左侧统计 */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Factory className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm">
                <span className="font-semibold">{totalTasks}</span>
                <span className="text-muted-foreground ml-1">个任务</span>
              </span>
            </div>

            <div className="h-5 w-px bg-border/50" />

            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-400" />
              <span className="text-sm">
                <span className="font-semibold text-amber-400">{totalCost}</span>
                <span className="text-muted-foreground ml-1">Credits</span>
              </span>
              {insufficientCredits && (
                <span className="text-xs text-red-400 ml-1">(余额不足)</span>
              )}
            </div>

            {(successCount > 0 || failedCount > 0) && (
              <>
                <div className="h-5 w-px bg-border/50" />
                <div className="flex items-center gap-3 text-sm">
                  {successCount > 0 && (
                    <span className="flex items-center gap-1 text-emerald-500">
                      <CheckCircle2 className="h-4 w-4" />
                      {successCount}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="flex items-center gap-1 text-red-400">
                      <XCircle className="h-4 w-4" />
                      {failedCount}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 右侧操作 */}
          <div className="flex items-center gap-3">
            {/* 自动下载开关 */}
            {(jobStatus === "idle" || jobStatus === "completed") && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDownload}
                  onChange={(e) => onAutoDownloadChange(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={cn(
                    "w-9 h-5 rounded-full transition-colors relative",
                    autoDownload ? "bg-tiktok-cyan" : "bg-muted"
                  )}
                >
                  <div
                    className={cn(
                      "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                      autoDownload && "translate-x-4"
                    )}
                  />
                </div>
                <span className="text-xs text-muted-foreground">自动下载</span>
              </label>
            )}

            {jobStatus === "idle" && (
              <Button
                onClick={onStart}
                disabled={!canStart || totalTasks === 0}
                className="h-10 px-6 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90 font-semibold"
              >
                <PlayCircle className="h-5 w-5 mr-2" />
                开始批量生成
              </Button>
            )}

            {jobStatus === "running" && (
              <>
                <Button
                  onClick={onPause}
                  variant="outline"
                  className="h-10 px-4 border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
                >
                  <Pause className="h-4 w-4 mr-2" />
                  暂停
                </Button>
                <Button
                  onClick={onCancel}
                  variant="outline"
                  className="h-10 px-4 border-red-500/50 text-red-500 hover:bg-red-500/10"
                >
                  <X className="h-4 w-4 mr-2" />
                  取消
                </Button>
              </>
            )}

            {jobStatus === "paused" && (
              <>
                <Button
                  onClick={onResume}
                  className="h-10 px-4 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
                >
                  <Play className="h-4 w-4 mr-2" />
                  继续
                </Button>
                <Button
                  onClick={onCancel}
                  variant="outline"
                  className="h-10 px-4 border-red-500/50 text-red-500 hover:bg-red-500/10"
                >
                  <X className="h-4 w-4 mr-2" />
                  取消
                </Button>
              </>
            )}

            {(jobStatus === "completed" || jobStatus === "cancelled") && (
              <div className="flex items-center gap-3">
                <div className={cn(
                  "flex items-center gap-2",
                  jobStatus === "completed" ? "text-emerald-500" : "text-muted-foreground"
                )}>
                  {jobStatus === "completed" ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <X className="h-5 w-5" />
                  )}
                  <span className="font-semibold">
                    {jobStatus === "completed" ? "处理完成" : "已取消"}
                  </span>
                </div>
                <Button onClick={onReset} variant="outline" className="h-10 px-4">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  重新开始
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Pro Studio 主页面
// ============================================================================

export default function ProStudioPage() {
  const { toast } = useToast();

  // ================================================================
  // Zustand Store
  // ================================================================
  const tasks = useBatchTasks();
  const jobStatus = useBatchJobStatus();
  const globalSettings = useBatchGlobalSettings();
  const selectedTaskIds = useBatchSelectedIds();
  const selectedCount = useBatchSelectedCount();
  const stats = useBatchStats();

  const {
    addTask,
    addTasksFromFiles,
    addTasksFromPrompts,
    updateTaskConfig,
    updateTaskStatus,
    duplicateTask,
    removeTask,
    clearAllTasks,
    toggleTaskSelection,
    selectAllTasks,
    clearSelection,
    removeSelectedTasks,
    startBatch,
    pauseBatch,
    resumeBatch,
    resetBatch,
    setCurrentTaskIndex,
    updateGlobalSettings,
    applyGlobalSettingsToAllDrafts,
  } = useBatchStore();

  // ================================================================
  // 用户状态
  // ================================================================
  const [userId, setUserId] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState(0);

  // ================================================================
  // UI 状态
  // ================================================================
  const [activeTab, setActiveTab] = useState<"video" | "image">("video");
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoDownload, setAutoDownload] = useState(false);

  // ================================================================
  // 批量执行器实例 (使用 useRef 保持引用稳定)
  // ================================================================
  const executorRef = useRef<BatchExecutor | null>(null);

  // 初始化执行器
  useEffect(() => {
    executorRef.current = createBatchExecutor({
      concurrency: 3, // 最大并发 3 个任务
      autoDownload,
      userId: userId || undefined,
    });
  }, [autoDownload, userId]);

  // ================================================================
  // 计算属性
  // ================================================================
  const filteredTasks = tasks.filter((t) => t.config.outputMode === activeTab);
  const filteredStats = {
    total: filteredTasks.length,
    totalCost: filteredTasks.reduce((sum, t) => sum + getTaskCost(t.config), 0),
    success: filteredTasks.filter((t) => t.status === "success").length,
    failed: filteredTasks.filter((t) => t.status === "failed").length,
  };

  const canStartBatch =
    filteredTasks.length > 0 &&
    jobStatus === "idle" &&
    userCredits >= filteredStats.totalCost &&
    userId !== null;

  // ================================================================
  // 数据获取
  // ================================================================
  useEffect(() => {
    fetch("/api/user/credits")
      .then((res) => res.json())
      .then((data) => {
        if (data.credits !== undefined) setUserCredits(data.credits);
        if (data.userId) setUserId(data.userId);
      })
      .catch(console.error);
  }, []);

  // 同步 activeTab 到 globalSettings
  useEffect(() => {
    updateGlobalSettings("outputMode", activeTab);
  }, [activeTab, updateGlobalSettings]);

  // ================================================================
  // 批量上传处理
  // ================================================================
  const handleBatchUpload = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files).filter((f) => f.type.startsWith("image/"));

      if (fileArray.length === 0) {
        toast({ variant: "destructive", title: "请选择图片文件" });
        return;
      }

      const ids = await addTasksFromFiles(fileArray);

      toast({
        title: "✅ 批量上传成功",
        description: `已添加 ${ids.length} 个任务`,
      });
    },
    [addTasksFromFiles, toast]
  );

  // ================================================================
  // 应用全局设置到所有任务
  // ================================================================
  const handleApplyToAll = useCallback(() => {
    applyGlobalSettingsToAllDrafts();
    toast({ title: "✅ 已应用全局设置到所有草稿任务" });
  }, [applyGlobalSettingsToAllDrafts, toast]);

  // ================================================================
  // 批量处理逻辑 (使用 p-limit 并发控制)
  // ================================================================

  /**
   * 开始批量处理
   * 
   * 使用 batch-executor 实现并发控制：
   * - 最大并发 3 个任务
   * - 复用 generation-client 的 API 调用
   * - 支持暂停/继续/取消
   * - 支持自动下载
   */
  const handleStartBatch = useCallback(async () => {
    if (!canStartBatch || !executorRef.current) return;

    setIsProcessing(true);
    startBatch();

    toast({
      title: "🚀 批量处理已启动",
      description: `共 ${filteredTasks.length} 个任务，最大并发 3 个`,
    });

    try {
      // 使用批量执行器执行任务
      const stats = await executorRef.current.execute(filteredTasks, {
        // 任务状态更新回调
        onTaskUpdate: (taskId, status, extra) => {
          updateTaskStatus(taskId, status, extra);
        },

        // 单个任务完成回调
        onTaskComplete: (task, result) => {
          const taskIndex = filteredTasks.findIndex((t) => t.id === task.id);
          if (result.success) {
            toast({ title: `✅ 任务 #${taskIndex + 1} 完成` });
          } else {
            toast({
              variant: "destructive",
              title: `任务 #${taskIndex + 1} 失败`,
              description: result.error,
            });
          }
        },

        // 全部完成回调
        onAllComplete: (stats: BatchExecutionStats) => {
          console.log("[Pro Studio] Batch completed:", stats);
          
          // 更新 Zustand store 状态
          useBatchStore.setState({ jobStatus: "completed" });
          setIsProcessing(false);

          // 显示完成通知
          const duration = Math.round(stats.duration / 1000);
          toast({
            title: "🎉 批量处理完成",
            description: `成功 ${stats.success}，失败 ${stats.failed}，耗时 ${duration} 秒`,
          });

          // 刷新用户积分
          fetch("/api/user/credits")
            .then((res) => res.json())
            .then((data) => {
              if (data.credits !== undefined) setUserCredits(data.credits);
            })
            .catch(console.error);
        },
      });

    } catch (error) {
      console.error("[Pro Studio] Batch execution error:", error);
      useBatchStore.setState({ jobStatus: "idle" });
      setIsProcessing(false);
      toast({
        variant: "destructive",
        title: "批量处理失败",
        description: error instanceof Error ? error.message : "未知错误",
      });
    }
  }, [canStartBatch, filteredTasks, startBatch, updateTaskStatus, toast]);

  /**
   * 暂停批量处理
   */
  const handlePauseBatch = useCallback(() => {
    executorRef.current?.pause();
    pauseBatch();
    toast({ title: "⏸️ 批量处理已暂停" });
  }, [pauseBatch, toast]);

  /**
   * 继续批量处理
   */
  const handleResumeBatch = useCallback(async () => {
    executorRef.current?.resume();
    resumeBatch();
    toast({ title: "▶️ 批量处理已继续" });
    // 注意：resume 后执行器会自动继续处理
  }, [resumeBatch, toast]);

  /**
   * 取消批量处理
   */
  const handleCancelBatch = useCallback(() => {
    executorRef.current?.cancel();
    useBatchStore.setState({ jobStatus: "cancelled" });
    setIsProcessing(false);
    toast({ title: "❌ 批量处理已取消" });
  }, [toast]);

  // ================================================================
  // 添加空任务
  // ================================================================
  const handleAddEmptyTask = useCallback(() => {
    addTask({
      outputMode: activeTab,
      prompt: "",
    });
    toast({ title: "✅ 已添加空任务" });
  }, [activeTab, addTask, toast]);

  // ================================================================
  // 渲染
  // ================================================================

  return (
    <TooltipProvider>
      <div className="space-y-4 pb-24">
        {/* ============================================ */}
        {/* 页面头部 */}
        {/* ============================================ */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              <span className="gradient-tiktok-text">Pro Studio</span>
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              批量生成视频和图片，提高创作效率
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30">
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-semibold text-amber-400">
                {userCredits.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* ============================================ */}
        {/* 顶级 Tabs */}
        {/* ============================================ */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "video" | "image")}>
          <TabsList className="bg-muted/30 p-1 h-12">
            <TabsTrigger
              value="video"
              className={cn(
                "flex-1 h-10 gap-2 text-sm font-medium transition-all",
                activeTab === "video"
                  ? "bg-gradient-to-r from-tiktok-cyan to-blue-500 text-white shadow-lg"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Video className="h-4 w-4" />
              Batch Video Producer
              {tasks.filter((t) => t.config.outputMode === "video").length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                  {tasks.filter((t) => t.config.outputMode === "video").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="image"
              className={cn(
                "flex-1 h-10 gap-2 text-sm font-medium transition-all",
                activeTab === "image"
                  ? "bg-gradient-to-r from-tiktok-pink to-purple-500 text-white shadow-lg"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ImageIcon className="h-4 w-4" />
              Batch Image Processor
              {tasks.filter((t) => t.config.outputMode === "image").length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                  {tasks.filter((t) => t.config.outputMode === "image").length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Video Tab Content */}
          <TabsContent value="video" className="mt-4 space-y-4">
            {/* Global Toolbar */}
            <GlobalToolbar mode="video" onBatchUpload={handleBatchUpload} onApplyToAll={handleApplyToAll} />

            {/* Task List */}
            <Card className="glass-card">
              <CardContent className="p-4">
                {/* 列表头部 */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Factory className="h-4 w-4 text-tiktok-cyan" />
                      视频任务队列
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {filteredTasks.length} 个任务
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={removeSelectedTasks}
                        className="h-7 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        删除选中 ({selectedCount})
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddEmptyTask}
                      className="h-7 text-xs btn-subtle"
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      添加任务
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 btn-subtle">
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
                          清空所有任务
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* 任务列表 */}
                {filteredTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Video className="h-16 w-16 mb-4 opacity-30" />
                    <p className="text-lg font-medium">暂无视频任务</p>
                    <p className="text-sm mt-1">点击"批量上传"添加图片，或点击"添加任务"创建空任务</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                    {filteredTasks.map((task, index) => (
                      <CompactTaskRow
                        key={task.id}
                        task={task}
                        index={index}
                        isSelected={!!selectedTaskIds[task.id]}
                        onToggleSelect={() => toggleTaskSelection(task.id)}
                        onUpdatePrompt={(prompt) => updateTaskConfig(task.id, "prompt", prompt)}
                        onUpdateConfig={(key, value) => updateTaskConfig(task.id, key as keyof typeof task.config, value)}
                        onDuplicate={() => duplicateTask(task.id)}
                        onRemove={() => removeTask(task.id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Image Tab Content */}
          <TabsContent value="image" className="mt-4 space-y-4">
            {/* Global Toolbar */}
            <GlobalToolbar mode="image" onBatchUpload={handleBatchUpload} onApplyToAll={handleApplyToAll} />

            {/* Task List */}
            <Card className="glass-card">
              <CardContent className="p-4">
                {/* 列表头部 */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Factory className="h-4 w-4 text-tiktok-pink" />
                      图片任务队列
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {filteredTasks.length} 个任务
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={removeSelectedTasks}
                        className="h-7 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        删除选中 ({selectedCount})
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddEmptyTask}
                      className="h-7 text-xs btn-subtle"
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      添加任务
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 btn-subtle">
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
                          清空所有任务
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* 任务列表 */}
                {filteredTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <ImageIcon className="h-16 w-16 mb-4 opacity-30" />
                    <p className="text-lg font-medium">暂无图片任务</p>
                    <p className="text-sm mt-1">点击"批量上传"添加图片，或点击"添加任务"创建空任务</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                    {filteredTasks.map((task, index) => (
                      <CompactTaskRow
                        key={task.id}
                        task={task}
                        index={index}
                        isSelected={!!selectedTaskIds[task.id]}
                        onToggleSelect={() => toggleTaskSelection(task.id)}
                        onUpdatePrompt={(prompt) => updateTaskConfig(task.id, "prompt", prompt)}
                        onUpdateConfig={(key, value) => updateTaskConfig(task.id, key as keyof typeof task.config, value)}
                        onDuplicate={() => duplicateTask(task.id)}
                        onRemove={() => removeTask(task.id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ============================================ */}
        {/* Bottom Bar */}
        {/* ============================================ */}
        <BottomBar
          totalTasks={filteredStats.total}
          totalCost={filteredStats.totalCost}
          userCredits={userCredits}
          jobStatus={jobStatus}
          canStart={canStartBatch}
          onStart={handleStartBatch}
          onPause={handlePauseBatch}
          onResume={handleResumeBatch}
          onCancel={handleCancelBatch}
          onReset={resetBatch}
          successCount={filteredStats.success}
          failedCount={filteredStats.failed}
          autoDownload={autoDownload}
          onAutoDownloadChange={setAutoDownload}
        />
      </div>
    </TooltipProvider>
  );
}
