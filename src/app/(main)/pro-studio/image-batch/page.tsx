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
  DialogDescription,
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
  FileSpreadsheet,
  PackageOpen,
  Wifi,
  Film,
  FolderDown,
  ArrowLeft,
  Info,
  Save,
  LayoutTemplate,
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
  useImageBatchScenario,
  useImageBatchUploadedImages,
  useImageBatchExcelData,
  useImageBatchPromptCount,
  useImageBatchScenarioTaskCount,
  getImageTaskCost,
  type UploadedImageInfo,
} from "@/stores/image-batch-store";

import {
  type ImageBatchTask,
} from "@/types/generation";

// Templates
import { SaveTemplateDialog } from "@/components/studio/SaveTemplateDialog";
import { TemplateManager, type Template } from "@/components/studio/TemplateManager";

// Excel 批量上传
import { ExcelUploader } from "@/components/studio/ExcelUploader";



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
          <Badge variant="outline" className="bg-white/5 border-white/10 text-xs text-muted-foreground">
            待处理
          </Badge>
        );
      case "processing":
        return (
          <Badge className="bg-mermaid-cyan/10 text-mermaid-cyan border-mermaid-cyan/20 text-xs animate-pulse">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            处理中
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs shadow-[0_0_10px_rgba(16,185,129,0.2)]">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            完成
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-xs shadow-[0_0_10px_rgba(239,68,68,0.2)]">
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
        "group relative rounded-3xl border transition-all duration-500 overflow-hidden",
        isSelected
          ? "bg-[#0B0C10] border-mermaid-cyan/50 ring-1 ring-mermaid-cyan/50 shadow-[0_0_30px_rgba(0,242,234,0.15)] scale-[1.02]"
          : "bg-[#0B0C10] border-white/5 hover:border-mermaid-cyan/30 hover:shadow-[0_0_20px_rgba(0,242,234,0.05)] hover:-translate-y-1",
        task.status === "processing" && "ring-1 ring-mermaid-cyan/30 animate-pulse-subtle"
      )}
    >
      {/* 选择复选框 - Neon Checkbox */}
      <div
        onClick={onToggleSelect}
        className={cn(
          "absolute top-3 left-3 z-20 flex h-6 w-6 items-center justify-center rounded-lg border cursor-pointer transition-all duration-300",
          isSelected
            ? "bg-mermaid-cyan border-mermaid-cyan text-black shadow-[0_0_15px_rgba(0,242,234,0.4)] rotate-0"
            : "border-white/20 bg-black/40 hover:border-white/50 backdrop-blur-md opacity-0 group-hover:opacity-100 hover:opacity-100 rotate-45 hover:rotate-0"
        )}
      >
        {isSelected && <Check className="h-3.5 w-3.5 font-bold" />}
      </div>

      {/* 图片预览 - Deep Glass Container */}
      <div
        className="relative aspect-square bg-[#050505] cursor-pointer overflow-hidden"
        onClick={onPreview}
      >
        {task.config.sourceImageUrl ? (
          <img
            src={task.config.sourceImageUrl}
            alt={task.config.sourceImageName}
            className={cn(
              "w-full h-full object-cover transition-transform duration-700",
              task.status === "processing" ? "scale-110 blur-sm" : "group-hover:scale-110"
            )}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-white/5 group-hover:bg-white/10 transition-colors">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 mb-3">
              <FileText className="h-8 w-8 text-white/20" />
            </div>
            <span className="text-[10px] text-white/30 text-center px-6 leading-relaxed uppercase tracking-wider font-mono">
              Pure Prompt Task
            </span>
          </div>
        )}

        {/* 悬浮操作层 - Deep Glass Overlay */}
        <div className="absolute inset-0 bg-[#050505]/60 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 z-10">
          <div className="flex gap-2 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
            <div className="h-10 w-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center backdrop-blur-md hover:bg-mermaid-cyan hover:text-black hover:border-mermaid-cyan transition-all cursor-pointer shadow-lg" onClick={(e) => { e.stopPropagation(); onPreview(); }}>
              <Eye className="h-5 w-5" />
            </div>
          </div>
        </div>

        {/* 处理进度条 - Neon Gradient */}
        {task.status === "processing" && task.progress !== undefined && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/40 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 text-mermaid-cyan animate-spin mb-3" />
            <div className="w-2/3 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-mermaid-lime via-mermaid-cyan to-mermaid-pink transition-all duration-300 shadow-[0_0_10px_rgba(0,242,234,0.5)]"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-mermaid-cyan mt-2 animate-pulse">{task.progress}%</span>
          </div>
        )}

        {/* 结果预览 - Titanium Reveal */}
        {task.status === "completed" && task.resultUrl && (
          <div className="absolute inset-0 z-10 transition-opacity duration-300 opacity-100 group-hover:opacity-0 pointer-events-none">
            <img
              src={task.resultUrl}
              alt="Result"
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-0 inset-x-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0 h-5 backdrop-blur-md">
                DONE
              </Badge>
            </div>
          </div>
        )}

        {/* 错误显示 - Red Glass */}
        {task.status === "failed" && (
          <div className="absolute inset-0 bg-red-950/90 flex flex-col items-center justify-center p-6 backdrop-blur-md z-20 border border-red-500/20">
            <div className="p-3 rounded-full bg-red-500/20 mb-3 animate-bounce">
              <XCircle className="h-6 w-6 text-red-400" />
            </div>
            <p className="text-[10px] text-red-200 text-center font-mono leading-relaxed border-t border-red-500/20 pt-2 mt-1 w-full">
              {task.error || "GENERATION FAILED"}
            </p>
          </div>
        )}
      </div>

      {/* 卡片信息 - Titanium Body */}
      <div className="p-4 space-y-3 bg-[#0B0C10] border-t border-white/5 relative">
        {/* 文件名 */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-white/80 truncate flex-1 font-mono tracking-tight" title={task.config.sourceImageName}>
            {task.config.sourceImageName || "UNTITLED TASK"}
          </p>
          {/* Status Badge */}
          {task.status === 'pending' && <Badge variant="outline" className="text-[10px] h-4 border-white/10 text-white/40 bg-white/5">WAITING</Badge>}
        </div>

        {/* 任务配置信息 - Neon Chips */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 border-white/5 bg-white/5 font-normal", task.config.model === 'nano-banana' ? 'text-mermaid-cyan' : 'text-mermaid-pink')}>
            {task.config.model === "nano-banana" ? "TURBO" : "PRO"}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-white/5 text-white/50 bg-white/5 font-normal">
            {getActionLabel()}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-white/5 text-white/50 bg-white/5 font-normal">
            {task.config.aspectRatio}
          </Badge>
        </div>

        {/* 操作栏 */}
        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          <span className="text-[10px] font-mono text-white/30 flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-mermaid-cyan/60" />
            <span className="text-white/60 font-bold">{cost}</span> PTS
          </span>
          <div className="flex items-center -mr-2">
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
                      className="h-7 w-7 text-white/40 hover:text-mermaid-cyan hover:bg-mermaid-cyan/10 transition-colors rounded-lg"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Start Task</p>
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
                        className="h-7 w-7 text-white/40 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors rounded-lg"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Download</p>
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
                    className="h-7 w-7 text-white/40 hover:text-neon-red hover:bg-neon-red/10 transition-colors rounded-lg"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Remove</p>
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

  // Store - 基础状态
  const tasks = useImageBatchTasks();
  const _jobStatus = useImageBatchJobStatus();
  const globalSettings = useImageBatchGlobalSettings();
  const selectedTaskIds = useImageBatchSelectedIds();
  const selectedCount = useImageBatchSelectedCount();
  const stats = useImageBatchStats();
  void _jobStatus;

  // Store - 场景状态
  const scenario = useImageBatchScenario();
  const uploadedImages = useImageBatchUploadedImages();
  const excelData = useImageBatchExcelData();
  const promptCount = useImageBatchPromptCount();
  const scenarioTaskCount = useImageBatchScenarioTaskCount();

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
    // 场景管理
    setScenario,
    addUploadedImages,
    clearUploadedImages,
    setExcelData,
    clearExcelData,
    setPromptCount,
    resetScenarioData,
    createTasksFromScenario,
  } = useImageBatchStore();

  // Local State
  const [userId, setUserId] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState(0);
  const [previewTask, setPreviewTask] = useState<ImageBatchTask | null>(null);

  // 启动任务弹窗状态
  const [showStartDialog, setShowStartDialog] = useState(false);

  // 批量下载状态
  const [isDownloading, setIsDownloading] = useState(false);
  const [showSpeedTest, setShowSpeedTest] = useState(false);
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
        globalSettings: {
          model: globalSettings.model,
          action: globalSettings.action,
          aspectRatio: globalSettings.aspectRatio,
          resolution: globalSettings.resolution,
          prompt: globalSettings.prompt,
        },
        // 保存场景数据
        scenario,
        promptCount,
        // 图片和Excel数据在实际使用时需要先上传到OSS
        savedAt: new Date().toISOString(),
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
        title: "✅ 方案已保存",
        description: `"${name}" 配置已成功保存`,
      });
      setShowSaveTemplate(false);
    } catch (e) {
      console.error('Save template error:', e);
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

      // 恢复全局设置
      if (config.globalSettings) {
        const gs = config.globalSettings;
        if (gs.model) updateGlobalSettings('model', gs.model);
        if (gs.action) updateGlobalSettings('action', gs.action);
        if (gs.aspectRatio) updateGlobalSettings('aspectRatio', gs.aspectRatio);
        if (gs.resolution) updateGlobalSettings('resolution', gs.resolution);
        if (gs.prompt) updateGlobalSettings('prompt', gs.prompt);
      }

      // 恢复场景数据
      if (config.scenario) setScenario(config.scenario);
      if (config.promptCount) setPromptCount(config.promptCount);

      // 关闭方案管理器
      setShowTemplateManager(false);

      // 自动打开启动任务弹窗
      setShowStartDialog(true);

      toast({
        title: "✅ 方案已加载",
        description: `"${template.name}" 的配置已填充，可直接创建任务`,
      });
    } catch (e) {
      console.error('Load template error:', e);
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

      // 存储到 uploadedImages 状态，而不是直接创建任务
      const newImages = fileArray.map(file => ({
        id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
      }));
      addUploadedImages(newImages);

      toast({
        title: "✅ 图片已添加",
        description: `已添加 ${newImages.length} 张图片，点击「启动任务」开始处理`,
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

        // 前端预先生成 requestId，后端用它作为 taskId
        // 这样即使响应超时/解析失败，我们也能用 requestId 查询
        const requestId = `gemini-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        let result;
        let needPolling = false;
        let fetchError: Error | null = null;

        // 调用 API（可能会超时）
        console.log("[Image Batch] Calling generate/image with requestId:", requestId);
        try {
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
              source: "batch_image",
              requestId,
            }),
          });

          const responseText = await response.text();
          console.log("[Image Batch] API response status:", response.status, "length:", responseText.length);

          // 504 = Gateway Timeout，后端可能还在处理
          if (response.status === 504) {
            console.log("[Image Batch] 504 Timeout, will poll for result with requestId:", requestId);
            needPolling = true;
            result = { success: true, data: { taskId: requestId, model: task.config.model, status: "processing" } };
          } else {
            try {
              result = JSON.parse(responseText);
            } catch {
              // 解析失败，如果状态码是 200，可能后端成功了
              if (response.status === 200) {
                console.log("[Image Batch] Parse failed but status 200, will poll:", requestId);
                needPolling = true;
                result = { success: true, data: { taskId: requestId, model: task.config.model, status: "processing" } };
              } else {
                throw new Error(`图片处理失败 (${response.status})`);
              }
            }
          }
        } catch (err) {
          fetchError = err instanceof Error ? err : new Error("Network error");
          const errMsg = fetchError.message.toLowerCase();

          // 检查是否是超时类错误，如果是，启动轮询
          const isTimeoutError = errMsg.includes("timeout") ||
            errMsg.includes("504") ||
            errMsg.includes("socket hang up") ||
            errMsg.includes("econnreset") ||
            errMsg.includes("aborted");

          if (isTimeoutError) {
            console.log("[Image Batch] Timeout/network error, will poll for result:", requestId, errMsg);
            needPolling = true;
            result = { success: true, data: { taskId: requestId, model: task.config.model, status: "processing" } };
          } else {
            // 其他错误直接抛出
            throw fetchError;
          }
        }

        if (!result.success) {
          throw new Error(result.error || "提交任务失败");
        }

        // 优先用后端返回的 taskId，否则用我们的 requestId
        const apiTaskId = result.data.taskId || requestId;
        const taskModel = result.data.model;

        // ================================================================
        // 重要：Gemini API (nano-banana) 是同步返回的，直接检查状态
        // 如果 API 已经返回 completed，无需轮询
        // ================================================================
        if (result.data.status === "completed" && result.data.imageUrl) {
          updateTaskStatus(task.id, "completed", {
            apiTaskId,
            resultUrl: result.data.imageUrl,
            progress: 100,
            completedAt: new Date().toISOString(),
          });
          setUserCredits((prev) => prev - getImageTaskCost(task.config));
          toast({ title: `✅ ${task.config.sourceImageName || "图片"} 处理完成` });
          return; // 直接返回，不进入轮询
        }

        // 非同步 API（如 nano-banana-pro），需要轮询
        updateTaskStatus(task.id, "processing", {
          apiTaskId,
          progress: 30,
        });

        // 轮询任务状态
        let pollCount = 0;
        const maxPolls = needPolling ? 20 : 60;
        const pollInterval = needPolling ? 2000 : 3000;
        const taskIdToTrack = task.id; // 保存任务ID用于状态检查

        const pollTimer = setInterval(async () => {
          // 重要：从 store 获取当前任务状态，防止覆盖已完成的任务
          const currentTask = useImageBatchStore.getState().tasks.find(t => t.id === taskIdToTrack);
          if (!currentTask || currentTask.status !== "processing") {
            console.log("[Image Batch] Task no longer processing, stopping poll:", taskIdToTrack, currentTask?.status);
            clearInterval(pollTimer);
            return;
          }

          pollCount++;
          const estimatedProgress = Math.min(95, 30 + pollCount * 1.1);
          updateTaskStatus(task.id, "processing", { progress: Math.round(estimatedProgress) });

          try {
            const statusResponse = await fetch(
              `/api/generate/image?taskId=${apiTaskId}&model=${taskModel}&userId=${currentUserId}`
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

  // 批量开始任务
  const handleStartAll = useCallback(async () => {
    const pendingTasks = tasks.filter((t) => t.status === "pending");
    if (pendingTasks.length === 0) return;

    toast({ title: `🚀 开始处理 ${pendingTasks.length} 个任务` });

    // 串行执行以避免并发限制
    for (const task of pendingTasks) {
      await handleProcessSingleTask(task);
      // 间隔 800ms
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }, [tasks, handleProcessSingleTask, toast]);

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
        <div className="flex items-center justify-between mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
              <span className="text-white drop-shadow-lg">批量制图线</span>
            </h1>
            <p className="mt-2 text-white/60">
              PRO STUDIO · IMAGE BATCH PIPELINE
            </p>
          </div>

          <div className="flex items-center gap-4">
            <Link href="/quick-gen">
              <Button variant="ghost" className="text-white/40 hover:text-white hover:bg-white/5">
                <ArrowLeft className="h-4 w-4 mr-2" />
                返回普通模式
              </Button>
            </Link>
          </div>
        </div>

        {/* ============================================ */}
        {/* 全局配置工具栏 - Titanium Mermaid Edition */}
        {/* ============================================ */}
        <div className="relative z-10 mb-8 rounded-3xl bg-[#16181D]/80 backdrop-blur-xl border border-white/5 shadow-2xl overflow-hidden group/panel">
          {/* Ambient Glow */}
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-mermaid-cyan/5 rounded-full blur-3xl pointer-events-none group-hover/panel:bg-mermaid-cyan/10 transition-colors duration-700" />
          <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 bg-mermaid-pink/5 rounded-full blur-3xl pointer-events-none group-hover/panel:bg-mermaid-pink/10 transition-colors duration-700" />

          <div className="relative p-7 space-y-7">
            {/* 第一行：主要配置 - Glass Pills Layout */}
            <div className="flex flex-wrap items-center gap-8">
              {/* 模型选择 */}
              <div className="space-y-3">
                <Label className="text-[10px] uppercase tracking-wider text-white/30 font-bold ml-1 flex items-center gap-2">
                  <Zap className="h-3 w-3" />
                  模型引擎
                </Label>
                <div className="flex items-center p-1.5 rounded-full bg-[#050505]/60 border border-white/5 backdrop-blur-md shadow-inner">
                  <button
                    onClick={() => updateGlobalSettings("model", "nano-banana")}
                    className={cn(
                      "relative px-5 py-2.5 rounded-full text-xs font-bold transition-all duration-300 flex items-center gap-2.5",
                      globalSettings.model === "nano-banana"
                        ? "bg-white/10 text-white shadow-[0_2px_10px_rgba(0,0,0,0.3)] border border-white/10"
                        : "text-white/40 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <Zap className={cn("h-3.5 w-3.5", globalSettings.model === "nano-banana" ? "text-mermaid-cyan" : "text-white/40")} />
                    快速版 Turbo
                  </button>
                  <button
                    onClick={() => updateGlobalSettings("model", "nano-banana-pro")}
                    className={cn(
                      "relative px-5 py-2.5 rounded-full text-xs font-bold transition-all duration-300 flex items-center gap-2.5",
                      globalSettings.model === "nano-banana-pro"
                        ? "bg-white/10 text-white shadow-[0_2px_10px_rgba(0,0,0,0.3)] border border-white/10"
                        : "text-white/40 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <Sparkles className={cn("h-3.5 w-3.5", globalSettings.model === "nano-banana-pro" ? "text-mermaid-pink" : "text-white/40")} />
                    专业版 Pro
                  </button>
                </div>
              </div>

              <div className="h-12 w-px bg-white/5" />

              {/* 处理类型 */}
              <div className="space-y-3">
                <Label className="text-[10px] uppercase tracking-wider text-white/30 font-bold ml-1 flex items-center gap-2">
                  <Wand2 className="h-3 w-3" />
                  处理模式
                </Label>
                <div className="flex items-center gap-2">
                  {getAvailableActions().map((action) => (
                    <button
                      key={action.value}
                      onClick={() => updateGlobalSettings("action", action.value)}
                      className={cn(
                        "px-4 py-2.5 rounded-full text-xs font-bold border transition-all duration-300 flex items-center gap-2.5",
                        globalSettings.action === action.value
                          ? "bg-mermaid-cyan/10 border-mermaid-cyan/30 text-mermaid-cyan shadow-[0_0_15px_rgba(0,242,234,0.1)]"
                          : "bg-black/20 border-white/5 text-white/40 hover:border-white/20 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {action.value === "generate" && <Wand2 className="h-3.5 w-3.5" />}
                      {action.value === "upscale" && <ZoomIn className="h-3.5 w-3.5" />}
                      {action.value === "nine_grid" && <Grid3X3 className="h-3.5 w-3.5" />}
                      {action.label}
                      <span className="ml-1 text-[10px] opacity-60 font-mono bg-black/30 px-1.5 py-0.5 rounded text-current">{action.credits}pts</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-12 w-px bg-white/5" />

              {/* 尺寸 */}
              <div className="space-y-3">
                <Label className="text-[10px] uppercase tracking-wider text-white/30 font-bold ml-1 flex items-center gap-2">
                  <Maximize2 className="h-3 w-3" />
                  尺寸比例
                </Label>
                <div className="flex gap-2">
                  {(globalSettings.model === "nano-banana"
                    ? NANO_FAST_ASPECT_OPTIONS
                    : NANO_PRO_ASPECT_OPTIONS
                  ).slice(0, 4).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateGlobalSettings("aspectRatio", opt.value)}
                      className={cn(
                        "h-10 w-10 p-0 rounded-xl border flex items-center justify-center transition-all duration-300",
                        globalSettings.aspectRatio === opt.value
                          ? "bg-white/10 border-white/20 text-white shadow-[0_0_10px_rgba(255,255,255,0.1)] scale-105"
                          : "bg-black/20 border-white/5 text-white/30 hover:border-white/20 hover:text-white hover:bg-white/5"
                      )}
                      title={opt.label}
                    >
                      {AspectRatioIcons[opt.value]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pro 模式分辨率 */}
              {globalSettings.model === "nano-banana-pro" && (
                <>
                  <div className="h-12 w-px bg-white/5" />
                  <div className="space-y-3">
                    <Label className="text-[10px] uppercase tracking-wider text-white/30 font-bold ml-1 flex items-center gap-2">
                      <Monitor className="h-3 w-3" />
                      画质
                    </Label>
                    <div className="flex gap-2">
                      {IMAGE_RESOLUTION_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => updateGlobalSettings("resolution", opt.value)}
                          className={cn(
                            "px-4 py-2.5 rounded-xl text-xs font-bold border transition-all duration-300",
                            globalSettings.resolution === opt.value
                              ? "bg-mermaid-pink/10 border-mermaid-pink/30 text-mermaid-pink shadow-[0_0_10px_rgba(236,72,153,0.1)]"
                              : "bg-black/20 border-white/5 text-white/30 hover:border-white/20 hover:text-white hover:bg-white/5"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 第二行：提示词输入区 - Neon Focus */}
            {globalSettings.action === "generate" && (
              <div className="relative group">
                <div className="absolute -inset-[1px] bg-gradient-to-r from-mermaid-cyan/30 via-mermaid-pink/30 to-mermaid-lime/30 rounded-2xl opacity-0 group-hover:opacity-100 transition duration-500 blur-sm" />
                <div className="relative">
                  <textarea
                    value={globalSettings.prompt}
                    onChange={(e) => updateGlobalSettings("prompt", e.target.value)}
                    placeholder="在此输入图片生成提示词... (支持中英文)"
                    className="w-full h-28 px-6 py-5 text-sm bg-[#050505] border border-white/10 rounded-2xl text-white placeholder:text-white/20 focus:outline-none focus:border-mermaid-cyan/50 focus:ring-1 focus:ring-mermaid-cyan/20 resize-none transition-all duration-300 font-mono leading-relaxed"
                  />
                  <div className="absolute bottom-4 right-4 flex items-center gap-2">
                    <div className="px-2 py-1 rounded bg-white/5 border border-white/5 text-[10px] text-white/30 font-mono">
                      AI 增强
                    </div>
                  </div>
                </div>
              </div>
            )}

            {globalSettings.action !== "generate" && (
              <div className="flex items-center gap-4 p-5 rounded-2xl bg-[#050505] border border-white/5 border-l-4 border-l-mermaid-cyan/50 shadow-inner">
                <div className="h-10 w-10 rounded-full bg-mermaid-cyan/10 flex items-center justify-center">
                  <Info className="h-5 w-5 text-mermaid-cyan" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-white tracking-wide">
                    无需提示词模式
                  </span>
                  <span className="text-xs text-white/40 mt-1">
                    {globalSettings.action === "upscale"
                      ? "高清放大模式将自动增强分辨率和细节，保留原始构图。"
                      : "九宫格模式将去除背景并生成多角度商品展示图。"}
                  </span>
                </div>
              </div>
            )}

            {/* 第三行：操作按钮 (Mermaid Ultra Style) */}
            <div className="flex items-center gap-4 pt-2">
              <input
                type="file"
                accept="image/*.webp,image/*.png,image/*.jpg,image/*.jpeg"
                multiple
                onChange={(e) => e.target.files && handleBatchUpload(e.target.files)}
                className="hidden"
                ref={fileInputRef}
              />

              {/* 启动任务核心按钮 */}
              <button
                onClick={() => setShowStartDialog(true)}
                className="group relative px-8 py-3.5 rounded-full font-bold text-black text-sm transition-all duration-300 bg-gradient-to-r from-mermaid-lime via-mermaid-cyan to-mermaid-pink hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(0,242,234,0.4)] border border-white/20 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
                <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] translate-x-[-100%] group-hover:animate-shimmer transition-opacity duration-300" />
                <span className="relative z-10 flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  启动任务
                </span>
              </button>

              {/* 加载方案按钮 */}
              <button
                onClick={() => setShowTemplateManager(true)}
                className="group relative px-6 py-3.5 rounded-full font-bold text-white text-sm transition-all duration-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-mermaid-cyan/50 hover:shadow-[0_0_20px_rgba(0,242,234,0.15)] overflow-hidden"
              >
                <span className="relative z-10 flex items-center gap-2">
                  <LayoutTemplate className="h-4 w-4 text-mermaid-cyan" />
                  加载方案
                </span>
              </button>

              {tasks.length > 0 && (
                <button
                  onClick={handleApplyToAll}
                  className="px-6 py-3.5 rounded-full text-xs font-bold text-white/60 hover:text-white border border-transparent hover:border-white/20 hover:bg-white/5 transition-all uppercase tracking-wide"
                >
                  <Wand2 className="h-3.5 w-3.5 mr-2 inline-block" />
                  应用配置到全部
                </button>
              )}

              <div className="flex-1" />

              <button
                onClick={() => setShowSaveTemplate(true)}
                className="px-6 py-3 rounded-full text-xs font-medium text-white/40 hover:text-white border border-white/5 hover:border-white/20 bg-black/20 hover:bg-black/40 transition-all flex items-center gap-2"
                title="保存当前配置为方案"
              >
                <Save className="h-4 w-4" />
                保存方案
              </button>
            </div>
          </div>
        </div >

        {/* ============================================ */}
        {/* 任务列表 */}
        {/* ============================================ */}
        {/* ============================================ */}
        {/* 任务列表 */}
        {/* ============================================ */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <LayoutGrid className="h-5 w-5 text-mermaid-cyan" />
                任务队列
              </h2>
              <Badge variant="outline" className="text-xs bg-white/5 border-white/10 text-white/60">
                {tasks.length} 个任务
              </Badge>
              {stats.pending > 0 && (
                <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-xs shadow-[0_0_10px_rgba(245,158,11,0.2)]">
                  {stats.pending} 待处理
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* 线路检测按钮 (Removed) */}

              {selectedCount > 0 && (
                <>
                  {/* 批量下载选中的已完成任务 */}
                  {tasks.filter(t => selectedTaskIds[t.id] && t.status === "completed" && t.resultUrl).length > 0 && (
                    <button
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
                      className="h-8 px-3 rounded-lg text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all flex items-center gap-1.5"
                    >
                      {isDownloading ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3 mr-1" />
                      )}
                      下载选中 ({tasks.filter(t => selectedTaskIds[t.id] && t.status === "completed" && t.resultUrl).length})
                    </button>
                  )}
                  <button
                    onClick={handleApplyToSelected}
                    className="h-8 px-3 rounded-lg text-xs font-medium text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-all flex items-center gap-1.5"
                  >
                    <Wand2 className="h-3 w-3 mr-1" />
                    应用 ({selectedCount})
                  </button>
                  <button
                    onClick={removeSelectedTasks}
                    className="h-8 px-3 rounded-lg text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all flex items-center gap-1.5"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    删除 ({selectedCount})
                  </button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-8 w-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-all">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-[#16181D] border-white/10">
                  <DropdownMenuItem onClick={() => selectAllTasks(true)} className="hover:bg-white/5 focus:bg-white/5">
                    <Check className="h-4 w-4 mr-2" />
                    全选
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={clearSelection} className="hover:bg-white/5 focus:bg-white/5">
                    <X className="h-4 w-4 mr-2" />
                    取消选择
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={resetBatch} className="hover:bg-white/5 focus:bg-white/5">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    重置所有任务
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={clearAllTasks} className="text-red-400 hover:bg-red-500/10 focus:bg-red-500/10">
                    <Trash2 className="h-4 w-4 mr-2" />
                    清空所有
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="bg-transparent">
            {tasks.length === 0 ? (
              // Aurora Card Empty State
              <div
                className="group flex flex-col items-center justify-center py-24 rounded-[2rem] border border-white/5 bg-[#0B0C10] relative overflow-hidden cursor-pointer transition-all duration-500 hover:scale-[1.01] hover:shadow-2xl"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                  fileInputRef.current?.click();
                }}
              >
                {/* Aurora Background Effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-mermaid-cyan/5 via-transparent to-mermaid-pink/5 opacity-50 group-hover:opacity-100 transition-opacity duration-1000" />
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10" />

                {/* Animated Rings */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] border border-white/5 rounded-full animate-[spin_20s_linear_infinite]" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] border border-white/5 rounded-full animate-[spin_15s_linear_infinite_reverse]" />

                <div className="relative z-10 flex flex-col items-center">
                  <div className="h-24 w-24 rounded-3xl bg-[#050505] border border-white/10 flex items-center justify-center mb-8 shadow-2xl group-hover:scale-110 transition-transform duration-500 group-hover:border-mermaid-cyan/30 group-hover:shadow-[0_0_40px_rgba(0,242,234,0.15)]">
                    <div className="absolute inset-0 bg-gradient-to-br from-mermaid-cyan/10 to-mermaid-pink/10 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
                    <FolderUp className="h-10 w-10 text-white/20 group-hover:text-mermaid-cyan transition-colors duration-500" />
                  </div>

                  <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">
                    拖放图片到此处
                  </h3>
                  <p className="text-white/40 text-sm max-w-md text-center leading-relaxed">
                    支持 JPG, PNG, WEBP · 自动处理流水线已就绪
                  </p>

                  <div className="mt-8 px-6 py-2 rounded-full border border-white/5 bg-white/5 text-[10px] uppercase tracking-widest text-white/30 group-hover:bg-mermaid-cyan/10 group-hover:text-mermaid-cyan group-hover:border-mermaid-cyan/20 transition-all">
                    点击浏览文件
                  </div>
                </div>
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
          </div>
        </div>

        {/* ============================================ */}
        {/* 底部状态栏 - 仅显示统计信息，单个任务手动点击开始 */}
        {/* ============================================ */}
        {
          tasks.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/5 bg-[#050505]/80 backdrop-blur-2xl supports-[backdrop-filter]:bg-[#050505]/60 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              <div className="container max-w-7xl mx-auto px-6 py-4">
                <div className="flex items-center justify-between">
                  {/* 统计信息 - Glass Chips */}
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
                      <ImageIcon className="h-4 w-4 text-white/40" />
                      <span className="text-xs text-white/60">
                        <span className="font-bold text-white shadow-black drop-shadow-md">{tasks.length}</span>
                        <span className="text-white/30 ml-1.5 tracking-wide uppercase text-[10px]">Tasks</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/5 border border-amber-500/10">
                      <Zap className="h-4 w-4 text-amber-400" />
                      <span className="text-xs">
                        <span className="font-bold text-amber-400">{stats.totalCost}</span>
                        <span className="text-amber-500/40 ml-1.5 tracking-wide uppercase text-[10px]">Credits</span>
                      </span>
                    </div>

                    {(stats.completed > 0 || stats.failed > 0 || stats.processing > 0) && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-px bg-white/5 mx-2" />

                        {stats.pending > 0 && (
                          <span className="flex items-center gap-1.5 text-xs text-white/30 font-mono">
                            <Clock className="h-3.5 w-3.5" />
                            {stats.pending} WAITING
                          </span>
                        )}
                        {stats.processing > 0 && (
                          <span className="flex items-center gap-1.5 text-xs text-mermaid-cyan font-bold animate-pulse">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {stats.processing} PROCESSING
                          </span>
                        )}
                        {stats.completed > 0 && (
                          <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {stats.completed} DONE
                          </span>
                        )}
                        {stats.failed > 0 && (
                          <span className="flex items-center gap-1.5 text-xs text-red-400 font-bold">
                            <XCircle className="h-3.5 w-3.5" />
                            {stats.failed} FAILED
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 操作按钮组 */}
                  <div className="flex items-center gap-3">
                    {/* 清空按钮 */}
                    <button
                      onClick={clearAllTasks}
                      className="px-4 py-2 rounded-full text-xs font-medium text-white/30 hover:text-red-400 transition-colors flex items-center gap-2 hover:bg-red-500/10"
                    >
                      CLEAR ALL
                    </button>

                    {/* 开始按钮 - Mermaid Ultra Scale */}
                    <button
                      onClick={handleStartAll}
                      disabled={stats.processing > 0 || stats.pending === 0}
                      className={cn(
                        "group relative px-8 py-3 rounded-full font-bold text-black text-xs transition-all duration-300 overflow-hidden",
                        stats.processing > 0 || stats.pending === 0
                          ? "bg-white/5 text-white/20 cursor-not-allowed border border-white/5"
                          : "bg-gradient-to-r from-mermaid-lime via-mermaid-cyan to-mermaid-pink hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(0,242,234,0.4)] border border-white/20"
                      )}
                    >
                      {!(stats.processing > 0 || stats.pending === 0) && (
                        <>
                          <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
                          <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] translate-x-[-100%] group-hover:animate-shimmer transition-opacity duration-300" />
                        </>
                      )}
                      <span className="relative z-10 flex items-center gap-2 tracking-wide">
                        {stats.processing > 0 ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            PROCESSING PIPELINE...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" />
                            START BATCH PIPELINE
                          </>
                        )}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        }

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
                  <Button variant="white-glow">
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

        {/* 统一启动任务弹窗 - 支持三种场景 (JCUI 2.0 Mermaid Edition) */}
        <Dialog open={showStartDialog} onOpenChange={setShowStartDialog}>
          <DialogContent className="max-w-2xl bg-[#16181D]/90 backdrop-blur-2xl border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] p-0 overflow-hidden gap-0">
            {/* Header - Glass Bar */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 bg-white/5 backdrop-blur-md">
              <div className="flex flex-col gap-1">
                <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
                  <div className={cn(
                    "p-1.5 rounded-lg border",
                    scenario === "prompt" && "bg-mermaid-pink/10 border-mermaid-pink/20",
                    scenario === "image" && "bg-mermaid-cyan/10 border-mermaid-cyan/20",
                    scenario === "excel" && "bg-emerald-500/10 border-emerald-500/20"
                  )}>
                    {scenario === "prompt" && <Sparkles className="h-5 w-5 text-mermaid-pink" />}
                    {scenario === "image" && <ImageIcon className="h-5 w-5 text-mermaid-cyan" />}
                    {scenario === "excel" && <FileSpreadsheet className="h-5 w-5 text-emerald-400" />}
                  </div>
                  {scenario === "prompt" && "纯提示词创建"}
                  {scenario === "image" && "图片改造"}
                  {scenario === "excel" && "Excel 批量创建"}
                </DialogTitle>
                <DialogDescription className="text-xs text-white/40 tracking-wide font-medium">
                  {scenario === "prompt" && "PURE PROMPT GENERATION · JCUI STUDIO"}
                  {scenario === "image" && `IMAGE TRANSFORMATION · ${uploadedImages.length} FILES`}
                  {scenario === "excel" && `BATCH CREATION · ${excelData.length} PROMPTS`}
                </DialogDescription>
              </div>
              <button
                onClick={() => setShowTemplateManager(true)}
                className="h-8 px-4 rounded-full bg-mermaid-cyan/5 hover:bg-mermaid-cyan/10 border border-mermaid-cyan/20 text-mermaid-cyan text-xs font-bold transition-all flex items-center gap-2"
              >
                <FolderDown className="h-3.5 w-3.5" />
                加载方案
              </button>
            </div>

            <div className="p-8 space-y-6">
              {/* 提示词预览 - 所有场景通用（只读） */}
              {globalSettings.prompt && (
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-white/40 uppercase tracking-wider">
                    提示词 <span className="text-white/20">PROMPT</span>
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="p-4 rounded-xl bg-black/20 border border-white/5 cursor-help">
                        <p className="text-sm text-white/70 line-clamp-3">{globalSettings.prompt}</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-md bg-[#16181D] border-white/10">
                      <p className="text-sm text-white/80 whitespace-pre-wrap">{globalSettings.prompt}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {!globalSettings.prompt && (
                <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <p className="text-sm text-amber-400/80">⚠️ 请先在配置区域输入提示词</p>
                </div>
              )}

              {/* 已上传图片预览 - 有图片时显示（只读） */}
              {uploadedImages.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-white/40 uppercase tracking-wider">
                      已上传图片 <span className="text-mermaid-cyan">({uploadedImages.length})</span>
                    </Label>
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-3 rounded-xl bg-black/20 border border-white/5">
                    {uploadedImages.slice(0, 12).map((img, i) => (
                      <div key={i} className="w-14 h-14 rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
                        <img src={img.previewUrl} alt={img.name} className="w-full h-full object-cover" />
                      </div>
                    ))}
                    {uploadedImages.length > 12 && (
                      <div className="w-14 h-14 rounded-lg bg-white/10 flex items-center justify-center text-xs text-white/40">
                        +{uploadedImages.length - 12}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 场景3: Excel批量模式 - 数据汇总 */}
              {scenario === "excel" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-white/60 uppercase tracking-wider">
                      Excel 数据汇总
                    </Label>
                    <button
                      onClick={clearExcelData}
                      className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      清除数据
                    </button>
                  </div>
                  <div className="p-4 rounded-xl bg-black/20 border border-white/5 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white/60">提示词条数</span>
                      <span className="text-white font-mono">{excelData.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white/60">任务总数</span>
                      <span className="text-emerald-400 font-mono font-bold">
                        {excelData.reduce((sum, row) => sum + row.count, 0)}
                      </span>
                    </div>
                    <div className="h-px bg-white/5 my-2" />
                    <div className="max-h-24 overflow-y-auto space-y-1">
                      {excelData.slice(0, 5).map((row, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-white/40 truncate max-w-[280px]">{row.prompt}</span>
                          <span className="text-white/60">×{row.count}</span>
                        </div>
                      ))}
                      {excelData.length > 5 && (
                        <div className="text-[10px] text-white/30 text-center">...还有 {excelData.length - 5} 条</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 提示词预览 - 图片/Excel场景显示全局提示词 */}
              {(scenario === "image" || scenario === "excel") && globalSettings.prompt && (
                <div className="p-4 rounded-xl bg-black/20 border border-white/5">
                  <div className="flex items-start gap-3">
                    <FileText className="h-4 w-4 text-mermaid-cyan shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <span className="text-[10px] text-white/30 uppercase tracking-wider">提示词</span>
                      <p className="text-sm text-white/70 line-clamp-2">{globalSettings.prompt}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 配置状态栏 - 所有场景通用 */}
              <div className="p-5 rounded-2xl bg-black/20 border border-white/5 space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="px-3 py-1.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs font-medium flex items-center gap-2">
                    <Film className="h-3.5 w-3.5" />
                    {globalSettings.model === "nano-banana" ? "快速模式" : "专业模式"}
                  </div>
                  <div className="px-3 py-1.5 rounded-full bg-mermaid-cyan/10 text-mermaid-cyan border border-mermaid-cyan/20 text-xs font-medium flex items-center gap-2">
                    <Wand2 className="h-3.5 w-3.5" />
                    {globalSettings.action === "generate" ? "AI 生成" : globalSettings.action === "upscale" ? "高清放大" : "九宫格"}
                  </div>
                  <div className="px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium flex items-center gap-2">
                    <Square className="h-3.5 w-3.5" />
                    {globalSettings.aspectRatio}
                  </div>
                  {globalSettings.model === "nano-banana-pro" && (
                    <div className="px-3 py-1.5 rounded-full bg-mermaid-pink/10 text-mermaid-pink border border-mermaid-pink/20 text-xs font-medium flex items-center gap-2">
                      <Monitor className="h-3.5 w-3.5" />
                      {globalSettings.resolution?.toUpperCase()}
                    </div>
                  )}
                  <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold font-mono">
                    <Zap className="h-3.5 w-3.5" />
                    {getImageTaskCost({
                      ...globalSettings,
                      sourceImageUrl: "",
                      sourceImageName: "",
                      action: globalSettings.action,
                      prompt: "",
                    }) * scenarioTaskCount} PTS
                  </div>
                </div>

                <div className="h-px bg-white/5 w-full" />

                {/* 场景1独有: 数量选择 */}
                {scenario === "prompt" && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white/40 tracking-wider">生成数量</span>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center bg-[#050505] rounded-full border border-white/10 p-1">
                        <button
                          className="h-8 w-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
                          onClick={() => setPromptCount(promptCount - 1)}
                          disabled={promptCount <= 1}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <div className="w-12 text-center text-sm font-bold text-white font-mono">{promptCount}</div>
                        <button
                          className="h-8 w-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
                          onClick={() => setPromptCount(promptCount + 1)}
                          disabled={promptCount >= 50}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 场景2/3: 只显示数量（只读） */}
                {(scenario === "image" || scenario === "excel") && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white/40 tracking-wider">
                      {scenario === "image" ? "图片数量" : "任务总数"}
                    </span>
                    <div className="px-4 py-2 rounded-full bg-[#050505] border border-white/10 text-sm font-bold text-white font-mono">
                      {scenarioTaskCount}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="p-6 pt-0 sm:justify-between bg-transparent border-none">
              <button
                onClick={() => setShowSaveTemplate(true)}
                className="text-white/30 hover:text-white text-xs font-medium flex items-center gap-2 transition-colors group"
              >
                <div className="p-1.5 rounded-md bg-white/5 group-hover:bg-white/10 transition-colors">
                  <Save className="h-3.5 w-3.5" />
                </div>
                保存为方案
              </button>

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    resetScenarioData();
                    setShowStartDialog(false);
                  }}
                  className="px-6 py-3 rounded-full text-xs font-bold text-white/40 hover:text-white hover:bg-white/5 transition-all"
                >
                  取消 Cancel
                </button>

                {/* Mermaid Ultra Button - 启动任务 */}
                <button
                  onClick={() => {
                    // 场景1需要验证提示词
                    if (scenario === "prompt" && !globalSettings.prompt.trim()) {
                      toast({ variant: "destructive", title: "请输入提示词" });
                      return;
                    }
                    // 场景2需要有图片
                    if (scenario === "image" && uploadedImages.length === 0) {
                      toast({ variant: "destructive", title: "请先上传图片" });
                      return;
                    }
                    // 场景3需要有Excel数据
                    if (scenario === "excel" && excelData.length === 0) {
                      toast({ variant: "destructive", title: "请先上传Excel文件" });
                      return;
                    }

                    const ids = createTasksFromScenario();
                    toast({ title: `✅ 已创建 ${ids.length} 个任务` });
                    resetScenarioData();
                    setShowStartDialog(false);
                  }}
                  disabled={
                    (scenario === "prompt" && !globalSettings.prompt.trim()) ||
                    (scenario === "image" && uploadedImages.length === 0) ||
                    (scenario === "excel" && excelData.length === 0)
                  }
                  className="group relative px-8 py-3 rounded-full font-bold text-black text-xs tracking-wide transition-all duration-300 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.5)] border border-white/20 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent pointer-events-none" />
                  <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] translate-x-[-100%] group-hover:animate-shimmer transition-opacity duration-300 pointer-events-none" />
                  <span className="relative z-10 flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    启动任务 START {scenarioTaskCount > 1 && `(${scenarioTaskCount})`}
                  </span>
                </button>
              </div>
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
      </div >
      {/* Templates */}
      < SaveTemplateDialog
        open={showSaveTemplate}
        onOpenChange={setShowSaveTemplate}
        onSave={handleSaveTemplate}
        defaultName={`${globalSettings.model}-${globalSettings.action}-${globalSettings.aspectRatio}`
        }
        configPreview={
          [
            { icon: <Film className="h-3.5 w-3.5" />, label: "模型", value: globalSettings.model === "nano-banana-pro" ? "专业版" : "快速版" },
            { icon: <Wand2 className="h-3.5 w-3.5" />, label: "处理", value: globalSettings.action === "upscale" ? "高清放大" : globalSettings.action === "generate" ? "AI生成" : "九宫格" },
            { icon: <Square className="h-3.5 w-3.5" />, label: "比例", value: globalSettings.aspectRatio || "自动" },
            { icon: <Monitor className="h-3.5 w-3.5" />, label: "分辨率", value: globalSettings.resolution?.toUpperCase() || "1K" },
          ]}
      />
      <TemplateManager
        open={showTemplateManager}
        onOpenChange={setShowTemplateManager}
        type="image_batch"
        onSelect={handleLoadTemplate}
      />
    </TooltipProvider >
  );
}

