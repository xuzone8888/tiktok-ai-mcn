"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Zap,
  Sparkles,
  Upload,
  Play,
  Loader2,
  Download,
  Smartphone,
  Monitor,
  ImageIcon,
  Video,
  User,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Grid3X3,
  Check,
  Wand2,
  ZoomIn,
  Users,
  Bot,
  ArrowLeft,
  ChevronRight,
  FileImage,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
// 不再使用 Server Action，直接调用 API 路由
// import { generateVideo, getVideoTaskStatus } from "@/lib/actions/generate-video";
import { 
  getMarketplaceModels,
} from "@/lib/actions/models";
import { 
  useQuickGenStore, 
  useQuickGenActiveTask, 
  useQuickGenIsGenerating,
  useQuickGenActiveImageTask,
  useQuickGenIsImageGenerating,
  useQuickGenProcessedGridImages,
  useQuickGenSelectedGridIndex,
} from "@/stores/quick-gen-store";

// ============================================================================
// 类型定义 - 从共享模块导入
// ============================================================================

import {
  type OutputMode,
  type SourceType,
  type ProcessingType,
  type VideoModel,
  type VideoAspectRatio,
  type ImageAspectRatio,
  type ImageResolution,
  type AiCastMode,
  type CanvasState,
  type DisplayModel,
  VIDEO_MODEL_PRICING,
  IMAGE_ASPECT_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  calculateVideoCost,
  calculateImageCost,
  calculateEnhancementCost,
} from "@/types/generation";

// 本地类型 (仅用于此页面)
type BatchCount = 1 | 2;

// ============================================================================
// Quick Generator 页面
// ============================================================================

export default function QuickGeneratorPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ================================================================
  // 全局模式
  // ================================================================
  const [outputMode, setOutputMode] = useState<OutputMode>("video");

  // ================================================================
  // Video Mode: Step 1 - Image Source & Enhancement
  // ================================================================
  const [sourceType, setSourceType] = useState<SourceType>("local_upload");
  const [processingType, setProcessingType] = useState<ProcessingType>("9grid");
  const [batchCount, setBatchCount] = useState<BatchCount>(2);
  const [uploadedFile, setUploadedFile] = useState<{ url: string; name: string } | null>(null);

  // ================================================================
  // Image Mode: Settings
  // ================================================================
  const [imageNanoTier, setImageNanoTier] = useState<NanoTier>("fast");
  const [imageAspectRatio, setImageAspectRatio] = useState<ImageAspectRatio>("auto");
  const [imageResolution, setImageResolution] = useState<ImageResolution>("1k");
  
  // Image Mode: 多图上传 (最多4张)
  const [imageUploadedFiles, setImageUploadedFiles] = useState<Array<{ url: string; name: string }>>([]);

  // ================================================================
  // Video Mode: Step 2 - Content Configuration
  // ================================================================
  const [prompt, setPrompt] = useState("");
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [videoModel, setVideoModel] = useState<VideoModel>("sora2-15s");
  const [videoAspectRatio, setVideoAspectRatio] = useState<VideoAspectRatio>("9:16");
  const [useAiModel, setUseAiModel] = useState(false);
  const [aiCastMode, setAiCastMode] = useState<AiCastMode>("auto");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [autoDownload, setAutoDownload] = useState(false);

  // ================================================================
  // Model Selector Dialog
  // ================================================================
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [tempSelectedMode, setTempSelectedMode] = useState<AiCastMode>("auto");
  const [tempSelectedModelId, setTempSelectedModelId] = useState<string | null>(null);

  // ================================================================
  // Canvas State
  // ================================================================
  const [canvasState, setCanvasState] = useState<CanvasState>("empty");
  const [processedImages, setProcessedImages] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0); // 当前显示的图片索引
  const [processingProgress, setProcessingProgress] = useState(0);
  const [generatingProgress, setGeneratingProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // ================================================================
  // Quick Gen Store - 后台任务状态
  // ================================================================
  const quickGenActiveTask = useQuickGenActiveTask();
  const isQuickGenRunning = useQuickGenIsGenerating();
  const createVideoTask = useQuickGenStore((state) => state.createVideoTask);
  const clearActiveTask = useQuickGenStore((state) => state.clearActiveTask);
  
  // 图片任务
  const quickGenImageTask = useQuickGenActiveImageTask();
  const isQuickGenImageRunning = useQuickGenIsImageGenerating();
  const createImageTask = useQuickGenStore((state) => state.createImageTask);
  const clearActiveImageTask = useQuickGenStore((state) => state.clearActiveImageTask);
  
  // 九宫格处理结果（从 store 恢复）
  const storedGridImages = useQuickGenProcessedGridImages();
  const storedGridIndex = useQuickGenSelectedGridIndex();
  const setStoredGridImages = useQuickGenStore((state) => state.setProcessedGridImages);
  const setStoredGridIndex = useQuickGenStore((state) => state.setSelectedGridIndex);
  const clearStoredGridImages = useQuickGenStore((state) => state.clearProcessedGridImages);
  
  // 全屏预览弹窗
  const [fullscreenPreview, setFullscreenPreview] = useState<{
    open: boolean;
    url: string;
    type: "video" | "image";
  }>({ open: false, url: "", type: "image" });

  // ================================================================
  // User Data
  // ================================================================
  const [userCredits, setUserCredits] = useState(5000);
  
  // 模特数据
  const [myTeamModels, setMyTeamModels] = useState<DisplayModel[]>([]);
  const [allModels, setAllModels] = useState<DisplayModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // ================================================================
  // 计费计算 - 使用共享计费函数
  // ================================================================
  
  // Video Mode: Process Image Cost (图片增强费用)
  const processImageCost = useMemo(() => {
    // 使用共享的计费函数
    return calculateEnhancementCost(processingType, "2k", batchCount);
  }, [processingType, batchCount]);

  // Video Mode: Generate Video Cost
  const generateVideoCost = useMemo(() => {
    return calculateVideoCost(videoModel);
  }, [videoModel]);

  // Image Mode: Generate Image Cost (基于 tier)
  const generateImageCost = useMemo(() => {
    return calculateImageCost(imageNanoTier, imageResolution, imageNanoTier === "pro");
  }, [imageNanoTier, imageResolution]);

  // 当前总费用
  const totalCost = useMemo(() => {
    if (outputMode === "video") {
      return generateVideoCost;
    } else {
      return generateImageCost;
    }
  }, [outputMode, generateVideoCost, generateImageCost]);

  // ================================================================
  // 状态派生
  // ================================================================
  
  // Video Mode: 是否可以处理图片
  const canProcessImage = outputMode === "video" && sourceType === "nano_banana" && uploadedFile && 
    (canvasState === "preview" || canvasState === "selected" || canvasState === "uploaded");
  
  // 是否有可用底图 (用于显示，不用于禁用生成按钮)
  const hasBaseImage = selectedImage || (sourceType === "local_upload" && uploadedFile);
  
  // ============================================
  // 【修复1】解锁生成按钮：支持纯文本生成
  // 按钮可用条件：(Prompt 不为空) OR (Image 已上传)
  // ============================================
  const canGenerate = useMemo(() => {
    // 基本条件：不在处理中
    if (canvasState === "processing" || canvasState === "generating") return false;
    
    // 视频模式：后台任务正在运行时禁用
    if (outputMode === "video" && isQuickGenRunning) return false;
    
    // 图片模式：后台任务正在运行时禁用
    if (outputMode === "image" && isQuickGenImageRunning) return false;
    
    // 积分检查
    if (userCredits < totalCost) return false;
    
    if (outputMode === "video") {
      // Video Mode: Prompt 或 Image 至少有一个
      const hasPrompt = prompt.trim().length > 0;
      const hasImage = hasBaseImage;
      return hasPrompt || hasImage;
    } else {
      // Image Mode: Prompt 或 Image 至少有一个
      const hasPrompt = prompt.trim().length > 0;
      const hasImage = imageUploadedFiles.length > 0;
      return hasPrompt || hasImage;
    }
  }, [canvasState, userCredits, totalCost, outputMode, prompt, hasBaseImage, imageUploadedFiles, isQuickGenRunning, isQuickGenImageRunning]);

  // 获取已选模特信息 (从所有模特中查找)
  const selectedModel = useMemo(() => {
    if (!selectedModelId) return null;
    // 先从 My Team 找，再从 All Models 找
    return myTeamModels.find((m) => m.id === selectedModelId) 
      || allModels.find((m) => m.id === selectedModelId)
      || null;
  }, [selectedModelId, myTeamModels, allModels]);

  // ================================================================
  // 数据获取
  // ================================================================

  // 获取用户积分和 userId
  useEffect(() => {
    fetch("/api/user/credits")
      .then((res) => res.json())
      .then((data) => {
        if (data.credits !== undefined) setUserCredits(data.credits);
        if (data.userId) setUserId(data.userId);
      })
      .catch(console.error);
  }, []);
  
  // 监听后台视频任务状态变化
  // 注意：只在视频模式下更新画布状态，让用户可以自由切换模式
  useEffect(() => {
    if (!quickGenActiveTask) return;
    
    // 同步任务状态到 UI（仅在当前是视频模式时更新画布状态）
    if (quickGenActiveTask.status === "generating" || quickGenActiveTask.status === "polling") {
      if (outputMode === "video") {
        setCanvasState("generating");
        setGeneratingProgress(quickGenActiveTask.progress);
      }
    } else if (quickGenActiveTask.status === "completed" && quickGenActiveTask.resultUrl) {
      if (outputMode === "video") {
        setResultUrl(quickGenActiveTask.resultUrl);
        setCanvasState("result");
        setGeneratingProgress(100);
      }
      // 刷新积分
      window.dispatchEvent(new CustomEvent("credits-updated"));
      // 清除已完成的任务
      clearActiveTask();
    } else if (quickGenActiveTask.status === "failed") {
      if (outputMode === "video") {
        setError(quickGenActiveTask.errorMessage || "生成失败");
        setCanvasState("failed");
      }
      // 清除失败的任务
      clearActiveTask();
    }
  }, [quickGenActiveTask, clearActiveTask, outputMode]);

  // 监听后台图片任务状态变化
  // 注意：不再强制切换 outputMode，让用户可以自由切换
  useEffect(() => {
    if (!quickGenImageTask) return;
    
    // 同步任务状态到 UI（仅在当前是图片模式时更新画布状态）
    if (quickGenImageTask.status === "generating" || quickGenImageTask.status === "polling") {
      // 只在图片模式下更新画布状态，不强制切换模式
      if (outputMode === "image") {
        setCanvasState("generating");
        setGeneratingProgress(quickGenImageTask.progress);
      }
    } else if (quickGenImageTask.status === "completed" && quickGenImageTask.resultUrl) {
      // 任务完成时，只在图片模式下显示结果
      if (outputMode === "image") {
        setResultUrl(quickGenImageTask.resultUrl);
        setCanvasState("result");
        setGeneratingProgress(100);
      }
      // 刷新积分
      window.dispatchEvent(new CustomEvent("credits-updated"));
      // 清除已完成的任务
      clearActiveImageTask();
    } else if (quickGenImageTask.status === "failed") {
      if (outputMode === "image") {
        setError(quickGenImageTask.errorMessage || "生成失败");
        setCanvasState("failed");
      }
      // 清除失败的任务
      clearActiveImageTask();
    }
  }, [quickGenImageTask, clearActiveImageTask, outputMode]);
  
  // 页面加载时，恢复最近完成的任务结果
  const recentTasks = useQuickGenStore((state) => state.recentTasks);
  const isInitialMount = useRef(true);
  
  useEffect(() => {
    // 只在初始加载时执行一次
    if (!isInitialMount.current) return;
    isInitialMount.current = false;
    
    // 如果已经有结果URL（从其他地方设置的），不需要恢复
    if (resultUrl) return;
    
    // 查找最近完成的任务（1小时内）
    const recentCompleted = recentTasks.find(t => {
      if (t.status !== "completed" || !t.resultUrl) return false;
      const completedTime = new Date(t.completedAt || t.createdAt).getTime();
      const now = Date.now();
      return now - completedTime < 3600000; // 1小时内完成的任务
    });
    
    if (recentCompleted) {
      // 恢复结果
      console.log("[QuickGen] Restoring recent completed task:", recentCompleted.id);
      setResultUrl(recentCompleted.resultUrl!);
      setCanvasState("result");
      
      // 根据任务类型切换模式
      if ("tier" in recentCompleted) {
        // 图片任务
        setOutputMode("image");
      } else {
        // 视频任务
        setOutputMode("video");
      }
      return;
    }
    
    // 如果没有最近完成的任务，尝试恢复九宫格处理结果
    if (storedGridImages.length > 0) {
      setProcessedImages(storedGridImages);
      setCurrentImageIndex(storedGridIndex);
      setCanvasState("selection");
      setOutputMode("video"); // 九宫格是视频模式的前置步骤
      console.log("[QuickGen] Restored grid images from store:", storedGridImages.length);
    }
  }, [recentTasks, storedGridImages, storedGridIndex]); // 依赖 recentTasks 以便数据加载后触发

  // 获取模特数据 (My Team + All Models) - 使用 Server Actions
  useEffect(() => {
    const fetchModels = async () => {
      setIsLoadingModels(true);
      try {
        // 获取 All Models (市场公开模特)
        const marketResult = await getMarketplaceModels({ limit: 50 });
        if (marketResult.success && marketResult.data?.models) {
          const displayModels: DisplayModel[] = marketResult.data.models.map((m) => ({
            id: m.id,
            name: m.name,
            avatar_url: m.avatar_url,
            demo_video_url: m.demo_video_url,
            tags: m.tags,
            category: m.category,
            gender: m.gender,
            price_monthly: m.base_price,
            rating: m.rating,
            is_featured: m.is_featured,
            is_trending: m.is_trending,
            is_hired: false,
          }));
          setAllModels(displayModels);
        }
      } catch (error) {
        console.error("[Quick Gen] Failed to fetch marketplace models:", error);
      } finally {
        setIsLoadingModels(false);
      }
    };

    fetchModels();
  }, []);

  // 获取 My Team 模特 - 使用 /api/contracts API
  useEffect(() => {
    const fetchMyTeam = async () => {
      try {
        const response = await fetch("/api/contracts?status=active");
        const result = await response.json();
        
        if (result.success && result.data) {
          // 将合约数据转换为 DisplayModel 格式
          const hiredModels: DisplayModel[] = result.data
            .filter((contract: any) => contract.ai_models)
            .map((contract: any) => {
              const model = contract.ai_models;
              const endDate = new Date(contract.end_date);
              const now = new Date();
              const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
              
              // 处理 style_tags
              let tags: string[] = [];
              if (model.style_tags) {
                if (typeof model.style_tags === "string") {
                  try { tags = JSON.parse(model.style_tags); } catch { tags = [model.style_tags]; }
                } else if (Array.isArray(model.style_tags)) {
                  tags = model.style_tags;
                }
              }
              
              return {
                id: model.id,
                name: model.name,
                avatar_url: model.avatar_url || null,
                demo_video_url: null,
                tags,
                category: model.category || "general",
                gender: model.gender || null,
                price_monthly: 0,
                rating: 0,
                is_featured: false,
                is_trending: false,
                is_hired: true,
                days_remaining: daysRemaining,
                contract_end_date: contract.end_date,
              };
            });
          
          setMyTeamModels(hiredModels);
          console.log(`[Quick Gen] Loaded ${hiredModels.length} hired models (active & not expired)`);
        }
      } catch (error) {
        console.error("[Quick Gen] Failed to fetch hired models:", error);
      }
    };

    fetchMyTeam();
  }, []);

  // ================================================================
  // Prompt Enhancement
  // ================================================================

  const handleEnhancePrompt = useCallback(async () => {
    if (!prompt.trim()) {
      toast({ variant: "destructive", title: "请先输入提示词" });
      return;
    }
    setIsEnhancingPrompt(true);
    await new Promise((r) => setTimeout(r, 1500));
    const enhanced = `${prompt}\n\n[AI Enhanced] Cinematic lighting, professional composition, viral TikTok style.`;
    setPrompt(enhanced);
    setIsEnhancingPrompt(false);
    toast({ title: "✨ Prompt 已优化" });
  }, [prompt, toast]);

  // ================================================================
  // 图片上传
  // ================================================================

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (uploadedFile?.url) URL.revokeObjectURL(uploadedFile.url);
      const url = URL.createObjectURL(file);
      setUploadedFile({ url, name: file.name });
      setProcessedImages([]);
      setResultUrl(null);
      
      if (outputMode === "video") {
        if (sourceType === "local_upload") {
          setSelectedImage(url);
          setCanvasState("selected");
        } else {
          setSelectedImage(null);
          setCanvasState("preview");
        }
      } else {
        // Image Mode: 直接进入 preview 状态
        setCanvasState("preview");
      }
    }
  }, [uploadedFile, outputMode, sourceType]);

  const handleRemoveUpload = useCallback(() => {
    if (uploadedFile?.url) URL.revokeObjectURL(uploadedFile.url);
    setUploadedFile(null);
    setProcessedImages([]);
    clearStoredGridImages(); // 清除 store 中的九宫格图片
    setSelectedImage(null);
    setResultUrl(null);
    setCanvasState("empty");
    setError(null);
  }, [uploadedFile]);

  // ================================================================
  // Video Mode: Process Image (Nano Banana)
  // ================================================================

  const handleProcessImage = useCallback(async () => {
    if (!canProcessImage || !uploadedFile) return;
    
    if (userCredits < processImageCost) {
      toast({ variant: "destructive", title: "积分不足" });
      return;
    }

    setCanvasState("processing");
    setProcessingProgress(0);
    // 清空之前的处理结果
    setProcessedImages([]);

    try {
      // 先上传图片到 Supabase 获取公网 URL
      let remoteImageUrl = uploadedFile.url;
      
      if (uploadedFile.url.startsWith("blob:")) {
        try {
          const blobResponse = await fetch(uploadedFile.url);
          const blob = await blobResponse.blob();
          
          const formData = new FormData();
          formData.append("file", blob, uploadedFile.name);
          
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
          console.error("[Quick Gen] Image upload error:", uploadError);
          toast({ variant: "destructive", title: "图片上传失败" });
          setCanvasState("uploaded");
          return;
        }
      }

      setProcessingProgress(10);

      // 调用图片增强 API
      const mode = processingType === "upscale" ? "upscale" : "nine_grid";
      
      // 九宫格模式：根据 batchCount 生成多张图片
      const tasksToGenerate = processingType === "9grid" ? batchCount : 1;
      
      console.log(`[Quick Gen] Starting ${tasksToGenerate} ${mode} task(s), batchCount=${batchCount}, processingType=${processingType}`);
      
      toast({ 
        title: mode === "upscale" ? "🔍 正在高清放大..." : `🎨 正在生成 ${tasksToGenerate} 张九宫格...`,
        description: `预计需要 ${tasksToGenerate * 30}-${tasksToGenerate * 60} 秒`,
      });

      // 并行提交所有任务
      const taskPromises = [];
      for (let i = 0; i < tasksToGenerate; i++) {
        const submitTask = async () => {
          const response = await fetch("/api/generate/image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode,
              sourceImageUrl: remoteImageUrl,
              resolution: processingType === "upscale" ? "2k" : undefined,
              prompt: processingType === "9grid" ? "高清产品展示，适配Sora2视频生成" : undefined,
              userId,
            }),
          });

          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || "提交任务失败");
          }
          return { taskId: result.data.taskId, model: result.data.model, index: i };
        };
        taskPromises.push(submitTask());
      }

      const tasks = await Promise.all(taskPromises);
      console.log("[Quick Gen] All tasks submitted:", tasks);

      setProcessingProgress(20);

      // 轮询单个任务直到完成
      const pollSingleTask = async (task: { taskId: string; model: string; index: number }): Promise<string | null> => {
        const maxPolls = 60; // 60 * 3s = 180 秒
        const pollIntervalMs = 3000;
        
        for (let pollCount = 0; pollCount < maxPolls; pollCount++) {
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          
          try {
            const statusResponse = await fetch(`/api/generate/image?taskId=${task.taskId}&model=${task.model}`);
            const statusResult = await statusResponse.json();
            
            if (!statusResult.success) {
              console.error(`[Quick Gen] Task ${task.index} status query failed:`, statusResult.error);
              continue;
            }

            const taskData = statusResult.data;
            console.log(`[Quick Gen] Task ${task.index} status:`, taskData.status, `(poll ${pollCount + 1})`);

            if (taskData.status === "completed" && taskData.imageUrl) {
              console.log(`[Quick Gen] Task ${task.index} completed with URL:`, taskData.imageUrl);
              return taskData.imageUrl;
            } else if (taskData.status === "failed") {
              console.error(`[Quick Gen] Task ${task.index} failed:`, taskData.errorMessage);
              return null;
            }
          } catch (pollError) {
            console.error(`[Quick Gen] Task ${task.index} polling error:`, pollError);
          }
        }
        
        console.error(`[Quick Gen] Task ${task.index} timed out`);
        return null;
      };

      // 并行轮询所有任务
      console.log(`[Quick Gen] Starting to poll ${tasks.length} tasks in parallel`);
      
      // 使用 Promise.allSettled 等待所有任务完成
      const progressInterval = setInterval(() => {
        setProcessingProgress(prev => Math.min(90, prev + 1));
      }, 2000);

      const results = await Promise.allSettled(tasks.map(task => pollSingleTask(task)));
      
      clearInterval(progressInterval);
      
      // 收集成功的图片
      const successfulImages: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
          successfulImages.push(result.value);
          console.log(`[Quick Gen] Task ${index} result: success`);
        } else {
          console.log(`[Quick Gen] Task ${index} result: failed or null`);
        }
      });

      console.log(`[Quick Gen] All tasks completed. Success: ${successfulImages.length}/${tasksToGenerate}`);

      if (successfulImages.length > 0) {
        setProcessingProgress(100);
        setUserCredits((prev) => prev - processImageCost);
        window.dispatchEvent(new CustomEvent("credits-updated"));
        
        if (processingType === "upscale") {
          setProcessedImages(successfulImages);
          setStoredGridImages(successfulImages); // 保存到 store
          setSelectedImage(successfulImages[0]);
          setCanvasState("selected");
          toast({ title: "✨ Ultra-HD 高清放大完成！" });
        } else {
          setProcessedImages(successfulImages);
          setStoredGridImages(successfulImages); // 保存到 store
          setCurrentImageIndex(0);
          setStoredGridIndex(0); // 保存选中索引到 store
          setCanvasState("selection");
          toast({ title: `🎨 已生成 ${successfulImages.length} 张九宫格图片，点击选择使用` });
        }
      } else {
        setError("所有任务都失败或超时了");
        setCanvasState("failed");
        toast({ variant: "destructive", title: "处理失败", description: "图片生成失败，请稍后重试" });
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "处理失败";
      console.error("[Quick Gen] Image processing error:", errorMessage);
      setError(errorMessage);
      setCanvasState("failed");
      toast({ variant: "destructive", title: "处理失败", description: errorMessage });
    }
  }, [canProcessImage, uploadedFile, userCredits, processImageCost, processingType, batchCount, userId, toast]);

  const handleSelectImage = useCallback((url: string) => {
    setSelectedImage(url);
    setCanvasState("selected");
    toast({ title: "✅ 已选中底图" });
  }, [toast]);

  const handleBackToSelection = useCallback(() => {
    if (processedImages.length > 0) {
      setSelectedImage(null);
      setCanvasState("selection");
    }
  }, [processedImages]);

  // 全屏预览
  const handleOpenFullscreen = useCallback((url: string, type: "video" | "image") => {
    setFullscreenPreview({ open: true, url, type });
  }, []);

  const handleCloseFullscreen = useCallback(() => {
    setFullscreenPreview({ open: false, url: "", type: "image" });
  }, []);

  // 下载内容
  const handleDownloadContent = useCallback(async (url: string, type: "video" | "image") => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `quick-gen-${Date.now()}.${type === "video" ? "mp4" : "jpg"}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      toast({ title: "✅ 下载成功" });
    } catch {
      toast({ variant: "destructive", title: "下载失败" });
    }
  }, [toast]);

  // 删除内容（重置状态）
  const handleDeleteContent = useCallback(() => {
    setResultUrl(null);
    setProcessedImages([]);
    clearStoredGridImages(); // 清除 store 中的九宫格图片
    setSelectedImage(null);
    setCanvasState("empty");
    setFullscreenPreview({ open: false, url: "", type: "image" });
    toast({ title: "🗑️ 已删除" });
  }, [toast]);

  // ================================================================
  // Model Dialog Handlers
  // ================================================================

  const handleOpenModelDialog = useCallback(() => {
    setTempSelectedMode(aiCastMode);
    setTempSelectedModelId(selectedModelId);
    setShowModelDialog(true);
  }, [aiCastMode, selectedModelId]);

  const handleConfirmModel = useCallback(() => {
    setAiCastMode(tempSelectedMode);
    setSelectedModelId(tempSelectedMode === "auto" ? null : tempSelectedModelId);
    setShowModelDialog(false);
    
    // 找到选中的模特
    const foundModel = tempSelectedMode !== "auto" 
      ? myTeamModels.find(m => m.id === tempSelectedModelId) 
        || allModels.find(m => m.id === tempSelectedModelId)
      : null;
    
    toast({ 
      title: tempSelectedMode === "auto" 
        ? "✨ 已选择自动匹配模式" 
        : `✅ 已选择模特: ${foundModel?.name || "Unknown"}`
    });
  }, [tempSelectedMode, tempSelectedModelId, myTeamModels, allModels, toast]);

  // ================================================================
  // Generate (Video / Image)
  // ================================================================

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;

    setCanvasState("generating");
    setGeneratingProgress(0);
    setError(null);

    if (outputMode === "video") {
      // ============================================
      // Video Mode: 使用后台任务管理器执行 (支持页面切换)
      // ============================================
      try {
        // 从配置获取 API 时长
        const modelConfig = VIDEO_MODEL_PRICING[videoModel];
        const apiDuration = modelConfig.apiDuration;
        const costCredits = modelConfig.credits;

        // 确定模特 ID
        const modelIdToSend = useAiModel 
          ? (aiCastMode === "auto" ? "auto" : selectedModelId)
          : null;

        // ============================================
        // 处理图片上传：如果有本地图片，先上传到服务器获取公网 URL
        // ============================================
        let remoteImageUrl: string | undefined = undefined;
        
        if (hasBaseImage && uploadedFile) {
          // 检查是否是本地 blob URL
          if (uploadedFile.url.startsWith("blob:")) {
            console.log("[Quick Gen] Uploading local image to server...");
            setGeneratingProgress(5);
            
            try {
              // 将 blob URL 转换为 File 对象
              const blobResponse = await fetch(uploadedFile.url);
              const blob = await blobResponse.blob();
              
              const formData = new FormData();
              formData.append("file", blob, uploadedFile.name);
              
              const uploadResponse = await fetch("/api/upload/image", {
                method: "POST",
                body: formData,
              });
              
              const uploadResult = await uploadResponse.json();
              
              if (uploadResult.success && uploadResult.data?.url) {
                remoteImageUrl = uploadResult.data.url;
                console.log("[Quick Gen] Image uploaded:", remoteImageUrl);
              } else {
                console.warn("[Quick Gen] Image upload failed, proceeding without image:", uploadResult.error);
                toast({
                  variant: "destructive",
                  title: "图片上传失败",
                  description: "将使用纯文本模式生成",
                });
              }
            } catch (uploadError) {
              console.error("[Quick Gen] Image upload error:", uploadError);
              toast({
                variant: "destructive",
                title: "图片上传失败",
                description: "将使用纯文本模式生成",
              });
            }
          } else if (uploadedFile.url.startsWith("http")) {
            // 已经是公网 URL
            remoteImageUrl = uploadedFile.url;
          }
        }

        console.log("[Quick Gen] Creating background video task:", {
          prompt: prompt.trim().substring(0, 50) + "...",
          duration: `${apiDuration}s`,
          aspectRatio: videoAspectRatio,
          modelId: modelIdToSend,
          hasSourceImage: !!remoteImageUrl,
          cost: costCredits,
        });

        // 创建后台任务 - 由 BackgroundTaskManager 执行
        createVideoTask({
          prompt: prompt.trim(),
          model: videoModel,
          aspectRatio: videoAspectRatio,
          quality: modelConfig.quality,
          apiModel: modelConfig.apiModel,
          duration: apiDuration,
          sourceImageUrl: remoteImageUrl,
          modelId: modelIdToSend || undefined,
          creditCost: costCredits,
        });

        toast({ 
          title: "🚀 视频生成已启动", 
          description: "任务将在后台执行，可以切换页面",
        });

        // 立即扣除积分（乐观更新）
        setUserCredits((prev) => prev - costCredits);

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error("[Quick Gen] Generation error:", errorMessage);
        
        setError(errorMessage);
        setCanvasState("failed");
        
        toast({ 
          variant: "destructive",
          title: "生成失败", 
          description: errorMessage,
        });
      }
    } else {
      // ============================================
      // Image Mode: 使用后台任务管理器执行 (支持页面切换)
      // ============================================
      try {
        // 准备参考图片 URL 数组 (最多4张)
        const sourceImageUrls: string[] = [];
        
        // 上传所有参考图片
        for (const file of imageUploadedFiles) {
          if (file.url.startsWith("blob:")) {
            try {
              const blobResponse = await fetch(file.url);
              const blob = await blobResponse.blob();
              
              const formData = new FormData();
              formData.append("file", blob, file.name || "source-image.jpg");
              
              const uploadResponse = await fetch("/api/upload/image", {
                method: "POST",
                body: formData,
              });
              
              const uploadResult = await uploadResponse.json();
              
              if (uploadResult.success && uploadResult.data?.url) {
                sourceImageUrls.push(uploadResult.data.url);
              }
            } catch (uploadError) {
              console.error("[Quick Gen] Image upload error:", uploadError);
            }
          } else if (file.url.startsWith("http")) {
            sourceImageUrls.push(file.url);
          }
        }

        // 创建后台任务 - 由 BackgroundTaskManager 执行
        const model = imageNanoTier === "pro" ? "nano-banana-pro" : "nano-banana";
        
        createImageTask({
          prompt: prompt.trim() || "高质量产品照片，专业灯光，干净背景",
          model: model as "nano-banana" | "nano-banana-pro",
          tier: imageNanoTier,
          aspectRatio: imageAspectRatio,
          resolution: imageNanoTier === "pro" ? imageResolution : "1k",
          sourceImageUrls,
          creditCost: totalCost,
        });

        toast({ 
          title: "🎨 图片生成已启动", 
          description: "任务将在后台执行，可以切换页面",
        });

        // 立即扣除积分（乐观更新）
        setUserCredits((prev) => prev - totalCost);

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error("[Quick Gen] Image generation error:", errorMessage);
        
        setError(errorMessage);
        setCanvasState("failed");
        
        toast({ 
          variant: "destructive",
          title: "生成失败", 
          description: errorMessage,
        });
      }
    }
  }, [canGenerate, outputMode, prompt, hasBaseImage, selectedImage, uploadedFile, videoModel, videoAspectRatio, useAiModel, aiCastMode, selectedModelId, imageNanoTier, imageAspectRatio, imageResolution, totalCost, autoDownload, toast, createVideoTask, createImageTask, imageUploadedFiles]);

  // ================================================================
  // 渲染
  // ================================================================

  return (
    <div className="flex h-[calc(100vh-100px)] gap-6">
      {/* ============================================================ */}
      {/* LEFT PANEL - Control Center */}
      {/* ============================================================ */}
      <div className="w-[400px] flex-shrink-0 flex flex-col space-y-4 overflow-y-auto pr-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-400" />
              Quick Generator
            </h1>
            <p className="text-xs text-muted-foreground">AI 内容创作工作流</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span className="font-semibold text-amber-400 text-sm">{userCredits}</span>
          </div>
        </div>

        {/* Global Mode Switcher */}
        <div className="flex p-1 rounded-xl panel-surface">
          <Button
            variant="ghost"
            onClick={() => {
              setOutputMode("image");
              setCanvasState(imageUploadedFiles.length > 0 ? "preview" : "empty");
            }}
            className={cn(
              "flex-1 py-2 rounded-lg gap-2",
              outputMode === "image"
                ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold"
                : "text-muted-foreground"
            )}
          >
            <ImageIcon className="h-4 w-4" /> Image
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOutputMode("video");
              setCanvasState(uploadedFile ? (sourceType === "local_upload" ? "selected" : "preview") : "empty");
            }}
            className={cn(
              "flex-1 py-2 rounded-lg gap-2",
              outputMode === "video"
                ? "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold"
                : "text-muted-foreground"
            )}
          >
            <Video className="h-4 w-4" /> Video
          </Button>
        </div>

        {/* ======================================== */}
        {/* VIDEO MODE: Configuration */}
        {/* ======================================== */}
        {outputMode === "video" && (
          <>
            {/* Step 1: Image Source */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-tiktok-cyan/20 text-tiktok-cyan text-xs font-bold">1</span>
                  Image Source
                  <span className="text-xs text-muted-foreground font-normal ml-1">(可选)</span>
                </CardTitle>
                <CardDescription className="text-xs">上传参考图或留空使用纯文本生成</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Upload Area - Compact */}
                {!uploadedFile ? (
                  <label className="dropzone flex items-center justify-center gap-3 h-16 px-4">
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
                    <Upload className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-medium">上传参考图片</p>
                      <p className="text-xs text-muted-foreground">可选 - 用于图生视频</p>
                    </div>
                  </label>
                ) : (
                  <div className="flex items-center gap-3 p-2.5 rounded-xl panel-surface">
                    <div className="h-12 w-12 rounded-lg overflow-hidden flex-shrink-0 thumb-surface">
                      <img src={uploadedFile.url} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{uploadedFile.name}</p>
                      <p className="text-xs text-muted-foreground">Ready</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={handleRemoveUpload} className="h-8 w-8">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Source Type Tabs (只有上传了图片才显示) */}
                {uploadedFile && (
                  <>
                    <Tabs value={sourceType} onValueChange={(v) => {
                      setSourceType(v as SourceType);
                      if (v === "local_upload") {
                        setSelectedImage(uploadedFile.url);
                        setCanvasState("selected");
                      } else {
                        setSelectedImage(null);
                        setCanvasState("preview");
                      }
                    }}>
                      <TabsList className="grid w-full grid-cols-2 tabs-surface h-9">
                        <TabsTrigger value="local_upload" className="text-xs">
                          <FileImage className="h-3.5 w-3.5 mr-1.5" /> Direct Use
                        </TabsTrigger>
                        <TabsTrigger value="nano_banana" className="text-xs">
                          <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Nano Banana
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>

                    {/* Nano Banana Pro Settings - 图片增强只支持 Pro 版本 */}
                    {sourceType === "nano_banana" && (
                      <div className="space-y-3 p-3 rounded-lg panel-surface">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span className="flex items-center gap-1">
                            <Sparkles className="h-3 w-3 text-tiktok-pink" />
                            NanoBanana Pro 图片增强
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setProcessingType("upscale")}
                            className={cn("flex-1 h-8 gap-1", processingType === "upscale" ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan" : "btn-subtle")}>
                            <ZoomIn className="h-3.5 w-3.5" /> 高清放大 (40 pts)
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setProcessingType("9grid")}
                            className={cn("flex-1 h-8 gap-1", processingType === "9grid" ? "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink" : "btn-subtle")}>
                            <Grid3X3 className="h-3.5 w-3.5" /> 九宫格 (60 pts)
                          </Button>
                        </div>
                        {processingType === "9grid" && (
                          <div className="flex gap-2">
                            <span className="text-xs text-muted-foreground self-center mr-2">生成数量:</span>
                            {([1, 2] as BatchCount[]).map((count) => (
                              <Button key={count} variant="outline" size="sm" onClick={() => setBatchCount(count)}
                                className={cn("flex-1 h-8", batchCount === count ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "btn-subtle")}>
                                {count}
                              </Button>
                            ))}
                          </div>
                        )}
                        <Button onClick={handleProcessImage} disabled={!canProcessImage}
                          className={cn("w-full h-9 font-semibold", canProcessImage ? "bg-gradient-to-r from-tiktok-cyan to-blue-500 text-black" : "bg-white/10 text-muted-foreground")}>
                          <Sparkles className="h-4 w-4 mr-2" />开始处理 ({processImageCost} pts)
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Step 2: Video Configuration */}
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-tiktok-pink/20 text-tiktok-pink text-xs font-bold">2</span>
                  Video Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Prompt - Prominent Input */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1.5">
                    <Wand2 className="h-3.5 w-3.5 text-amber-400" />
                    <span className="font-medium">Prompt</span>
                    {!uploadedFile && <span className="text-amber-400 ml-1">(必填)</span>}
                  </Label>
                  <div className="relative">
                    <Textarea 
                      value={prompt} 
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={uploadedFile ? "描述你想要生成的视频内容..." : "详细描述你的视频内容（文生视频必填）..."}
                      disabled={canvasState === "generating"} 
                      className="input-surface resize-none text-sm pr-16 min-h-[180px]" 
                    />
                    <Button size="sm" variant="ghost" onClick={handleEnhancePrompt}
                      disabled={isEnhancingPrompt || !prompt.trim()}
                      className="absolute bottom-2 right-2 h-7 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 px-2">
                      {isEnhancingPrompt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      <span className="ml-1">Enhance</span>
                    </Button>
                  </div>
                </div>

                {/* Video Specs */}
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">模型 & 时长</Label>
                    <div className="space-y-1.5">
                      {(Object.entries(VIDEO_MODEL_PRICING) as [VideoModel, typeof VIDEO_MODEL_PRICING[VideoModel]][]).map(([key, value]) => (
                        <Button key={key} variant="outline" size="sm" onClick={() => setVideoModel(key)}
                          className={cn("w-full justify-between h-8", videoModel === key ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan" : "btn-subtle")}>
                          <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{value.label}</span>
                          <span className="text-xs">{value.credits} pts</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Aspect Ratio</Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setVideoAspectRatio("9:16")}
                        className={cn("flex-1 h-8", videoAspectRatio === "9:16" ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan" : "btn-subtle")}>
                        <Smartphone className="h-3.5 w-3.5 mr-1" /> 9:16
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setVideoAspectRatio("16:9")}
                        className={cn("flex-1 h-8", videoAspectRatio === "16:9" ? "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink" : "btn-subtle")}>
                        <Monitor className="h-3.5 w-3.5 mr-1" /> 16:9
                      </Button>
                    </div>
                  </div>
                </div>

                {/* AI Cast */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-tiktok-pink" /> AI Cast
                    </Label>
                    <Switch checked={useAiModel} onCheckedChange={setUseAiModel} className="data-[state=checked]:bg-tiktok-pink scale-90" />
                  </div>
                  {useAiModel && (
                    <Button 
                      variant="outline" 
                      onClick={handleOpenModelDialog} 
                      className={cn(
                        "w-full h-auto min-h-[44px] justify-between border-white/20 hover:border-tiktok-pink/50 py-2",
                        selectedModel && "bg-gradient-to-r from-tiktok-pink/5 to-purple-500/5"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {aiCastMode === "auto" ? (
                          <>
                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-tiktok-cyan/30 to-blue-500/30 flex items-center justify-center border border-tiktok-cyan/30">
                              <Bot className="h-4 w-4 text-tiktok-cyan" />
                            </div>
                            <div className="text-left">
                              <p className="text-sm font-medium">Auto Match</p>
                              <p className="text-[10px] text-muted-foreground">AI selects best model</p>
                            </div>
                          </>
                        ) : selectedModel ? (
                          <>
                            {selectedModel.avatar_url ? (
                              <img 
                                src={selectedModel.avatar_url} 
                                alt={selectedModel.name} 
                                className="h-8 w-8 rounded-full object-cover border border-tiktok-pink/30" 
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-tiktok-pink/30 to-purple-500/30 flex items-center justify-center border border-tiktok-pink/30">
                                <User className="h-4 w-4 text-tiktok-pink" />
                              </div>
                            )}
                            <div className="text-left">
                              <p className="text-sm font-medium">{selectedModel.name}</p>
                              {selectedModel.tags && selectedModel.tags.length > 0 && (
                                <div className="flex gap-1 mt-0.5">
                                  {selectedModel.tags.slice(0, 2).map((tag, idx) => (
                                    <span key={idx} className="text-[9px] px-1 py-0.5 rounded tag-surface">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="h-8 w-8 rounded-full thumb-surface flex items-center justify-center">
                              <User className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <span className="text-sm text-muted-foreground">Select a Model</span>
                          </>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </Button>
                  )}
                </div>

                {/* Auto Download */}
                <div className="flex items-center justify-between py-2 px-3 rounded-lg panel-surface">
                  <Label className="text-xs flex items-center gap-1.5"><Download className="h-3.5 w-3.5 text-tiktok-cyan" />Auto-Download</Label>
                  <Switch checked={autoDownload} onCheckedChange={setAutoDownload} className="data-[state=checked]:bg-tiktok-cyan scale-90" />
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* ======================================== */}
        {/* IMAGE MODE: Configuration */}
        {/* ======================================== */}
        {outputMode === "image" && (
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-tiktok-pink" />
                Image Generation Settings
              </CardTitle>
              <CardDescription className="text-xs">使用 Nano Banana AI 生成/增强图片 (最多支持 4 张参考图)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 多图上传区域 - 最多4张 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1.5">
                  <FileImage className="h-3.5 w-3.5 text-purple-400" />
                  <span className="font-medium">参考图片</span>
                  <span className="text-muted-foreground ml-1">(可选，最多4张)</span>
                </Label>
                <div className="grid grid-cols-4 gap-2">
                  {/* 已上传的图片 */}
                  {imageUploadedFiles.map((file, index) => (
                    <div key={index} className="relative aspect-square rounded-lg overflow-hidden thumb-surface group">
                      <img src={file.url} alt={file.name} className="w-full h-full object-cover" />
                      <button
                        onClick={() => {
                          URL.revokeObjectURL(file.url);
                          setImageUploadedFiles(prev => {
                            const updated = prev.filter((_, i) => i !== index);
                            // 如果删除后没有图片了，重置 canvas 状态
                            if (updated.length === 0) {
                              setCanvasState("empty");
                            }
                            return updated;
                          });
                        }}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full thumb-overlay text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <div className="absolute bottom-1 left-1 thumb-overlay px-1.5 py-0.5 rounded text-[10px] text-white">
                        #{index + 1}
                      </div>
                    </div>
                  ))}
                  {/* 添加更多图片按钮 */}
                  {imageUploadedFiles.length < 4 && (
                    <label className="dropzone aspect-square flex flex-col items-center justify-center gap-1">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          const remainingSlots = 4 - imageUploadedFiles.length;
                          const filesToAdd = files.slice(0, remainingSlots);
                          
                          const newFiles = filesToAdd.map(file => ({
                            url: URL.createObjectURL(file),
                            name: file.name
                          }));
                          
                          setImageUploadedFiles(prev => {
                            const updated = [...prev, ...newFiles];
                            // 上传图片后设置预览状态
                            if (updated.length > 0) {
                              setCanvasState("preview");
                            }
                            return updated;
                          });
                          e.target.value = ""; // Reset input
                        }}
                        className="hidden"
                      />
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">
                        {imageUploadedFiles.length === 0 ? "上传图片" : "添加更多"}
                      </span>
                    </label>
                  )}
                </div>
                {imageUploadedFiles.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    已上传 {imageUploadedFiles.length}/4 张图片
                  </p>
                )}
              </div>

              {/* 【修复2】Prompt Input for Image Mode - Prominent */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1.5">
                  <Wand2 className="h-3.5 w-3.5 text-amber-400" />
                  <span className="font-medium">Prompt</span>
                  <span className="text-muted-foreground ml-1">(Recommended)</span>
                </Label>
                <div className="relative">
                  <Textarea 
                    value={prompt} 
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="描述你想要生成的图片效果... (例如：'摄影棚灯光、白色背景、产品摄影')"
                    disabled={canvasState === "generating"} 
                    className="input-surface resize-none text-sm pr-16 min-h-[180px]" 
                  />
                  <Button size="sm" variant="ghost" onClick={handleEnhancePrompt}
                    disabled={isEnhancingPrompt || !prompt.trim()}
                    className="absolute bottom-2 right-2 h-7 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 px-2">
                    {isEnhancingPrompt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    <span className="ml-1">Enhance</span>
                  </Button>
                </div>
              </div>

              {/* Quality Tier Selection */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Quality Tier</Label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setImageNanoTier("fast")}
                    className={cn("flex-1 h-10 flex-col gap-0.5", imageNanoTier === "fast" ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan" : "btn-subtle")}>
                    <span className="font-semibold">Fast</span>
                    <span className="text-xs opacity-70">10 Credits</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setImageNanoTier("pro")}
                    className={cn("flex-1 h-10 flex-col gap-0.5", imageNanoTier === "pro" ? "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink" : "btn-subtle")}>
                    <span className="font-semibold">Pro</span>
                    <span className="text-xs opacity-70">28 Credits</span>
                  </Button>
                </div>
              </div>

              {/* Aspect Ratio */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Aspect Ratio</Label>
                <Select value={imageAspectRatio} onValueChange={(v) => setImageAspectRatio(v as ImageAspectRatio)}>
                  <SelectTrigger className="input-surface h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover/95 border-border/50 backdrop-blur-xl">
                    {IMAGE_ASPECT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Resolution (仅 Pro 模式显示) */}
              {imageNanoTier === "pro" && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Resolution</Label>
                  <Select value={imageResolution} onValueChange={(v) => setImageResolution(v as ImageResolution)}>
                    <SelectTrigger className="input-surface h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover/95 border-border/50 backdrop-blur-xl">
                      {IMAGE_RESOLUTION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Auto Download */}
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5">
                <Label className="text-xs flex items-center gap-1.5"><Download className="h-3.5 w-3.5 text-tiktok-cyan" />Auto-Download</Label>
                <Switch checked={autoDownload} onCheckedChange={setAutoDownload} className="data-[state=checked]:bg-tiktok-cyan scale-90" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ======================================== */}
        {/* Generate Button (共用) */}
        {/* ======================================== */}
        <div className="sticky bottom-0 pt-2 pb-4 bg-background">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="text-muted-foreground">Estimated Cost:</span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-400">{totalCost} Credits</span>
              {userCredits < totalCost && (
                <span className="text-xs text-red-400">(余额: {userCredits})</span>
              )}
            </div>
          </div>
          <Button onClick={handleGenerate} disabled={!canGenerate || canvasState === "generating" || (outputMode === "video" && isQuickGenRunning) || (outputMode === "image" && isQuickGenImageRunning)}
            className={cn("w-full h-12 font-semibold transition-all text-base",
              canGenerate && !(outputMode === "video" && isQuickGenRunning) && !(outputMode === "image" && isQuickGenImageRunning) ? "bg-gradient-to-r from-tiktok-pink to-purple-500 text-white shadow-[0_0_20px_rgba(255,0,80,0.3)]" : "bg-white/10 text-muted-foreground")}>
            {canvasState === "generating" || (outputMode === "video" && isQuickGenRunning) || (outputMode === "image" && isQuickGenImageRunning) ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" />生成中... {outputMode === "video" ? (quickGenActiveTask?.progress || generatingProgress) : (quickGenImageTask?.progress || generatingProgress)}%</>
            ) : (
              <><Play className="h-5 w-5 mr-2" />生成 {outputMode === "video" ? "视频" : "图片"}</>
            )}
          </Button>
          {/* 显示禁用原因 */}
          {!canGenerate && canvasState !== "generating" && !(outputMode === "video" && isQuickGenRunning) && !(outputMode === "image" && isQuickGenImageRunning) && (
            <p className="text-xs text-center mt-2">
              {!userId ? (
                <a href="/auth/login" className="text-tiktok-cyan hover:underline">
                  🔐 请先登录以使用生成功能
                </a>
              ) : userCredits < totalCost ? (
                <span className="text-red-400">❌ 积分不足！需要 {totalCost} Credits，当前余额 {userCredits}</span>
              ) : outputMode === "video" && !uploadedFile && !prompt.trim() ? (
                <span className="text-amber-400">请输入 Prompt 或上传图片</span>
              ) : (
                <span className="text-amber-400">请完成必填项</span>
              )}
            </p>
          )}
          {/* 后台任务运行中提示 - 只在对应模式下显示 */}
          {outputMode === "video" && isQuickGenRunning && (
            <p className="text-xs text-center mt-2 text-tiktok-cyan">
              🎬 视频正在后台生成中，可以切换到其他页面
            </p>
          )}
          {outputMode === "image" && isQuickGenImageRunning && (
            <p className="text-xs text-center mt-2 text-violet-400">
              🎨 图片正在后台生成中，可以切换到其他页面
            </p>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* RIGHT PANEL - Canvas/Preview */}
      {/* ============================================================ */}
      <div className="flex-1 rounded-2xl border border-border/50 bg-muted/30 dark:bg-black/30 overflow-hidden relative">
        
        {/* Empty State */}
        {canvasState === "empty" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="h-24 w-24 rounded-3xl bg-muted/50 dark:bg-white/5 flex items-center justify-center mb-6">
              {outputMode === "video" ? <Video className="h-12 w-12 text-muted-foreground/50" /> : <ImageIcon className="h-12 w-12 text-muted-foreground/50" />}
            </div>
            <p className="text-xl font-medium text-muted-foreground/70 mb-2">Preview Area</p>
            <p className="text-sm text-muted-foreground/50">
              {outputMode === "video" ? "Upload an image or just use prompt" : "输入提示词或上传参考图片开始生成"}
            </p>
          </div>
        )}

        {/* Preview State - Video Mode */}
        {canvasState === "preview" && outputMode === "video" && uploadedFile && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
            <div className="relative">
              <img src={uploadedFile.url} alt="Preview" className="max-w-full max-h-[500px] object-contain rounded-xl border border-white/20" />
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500/90 text-black px-3 py-1 rounded-full text-xs font-semibold">
                Original Image
              </div>
            </div>
            {sourceType === "nano_banana" && (
              <p className="mt-6 text-muted-foreground text-center text-sm">
                Click <span className="text-tiktok-cyan font-semibold">&quot;Process&quot;</span> to enhance
              </p>
            )}
          </div>
        )}

        {/* Preview State - Image Mode (多图预览) */}
        {canvasState === "preview" && outputMode === "image" && imageUploadedFiles.length > 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-purple-500/90 text-white px-4 py-1.5 rounded-full text-sm font-semibold">
              {imageUploadedFiles.length} 张参考图片
            </div>
            <div className={cn(
              "grid gap-3 max-w-[500px]",
              imageUploadedFiles.length === 1 ? "grid-cols-1" :
              imageUploadedFiles.length === 2 ? "grid-cols-2" :
              "grid-cols-2"
            )}>
              {imageUploadedFiles.map((file, index) => (
                <div key={index} className="relative rounded-xl overflow-hidden border border-white/20">
                  <img 
                    src={file.url} 
                    alt={`Reference ${index + 1}`} 
                    className={cn(
                      "w-full object-cover",
                      imageUploadedFiles.length === 1 ? "max-h-[400px]" : "h-[180px]"
                    )} 
                  />
                  <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-0.5 rounded text-xs">
                    #{index + 1}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 text-muted-foreground text-center text-sm">
              输入提示词并点击 <span className="text-purple-400 font-semibold">&quot;Generate Image&quot;</span> 开始生成
            </p>
          </div>
        )}

        {/* Processing State */}
        {canvasState === "processing" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="relative h-32 w-32 mb-8">
              <div className="absolute inset-0 rounded-full border-4 border-tiktok-cyan/30 animate-ping" />
              <div className="absolute inset-2 rounded-full border-4 border-tiktok-pink/30 animate-ping" style={{ animationDelay: "0.2s" }} />
              <div className="absolute inset-4 rounded-full border-4 border-purple-500/30 animate-ping" style={{ animationDelay: "0.4s" }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="h-12 w-12 text-tiktok-cyan animate-pulse" />
              </div>
            </div>
            <p className="text-2xl font-semibold text-tiktok-cyan mb-2">Processing...</p>
            <div className="w-64 h-2 bg-white/10 rounded-full mt-4 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink transition-all" style={{ width: `${processingProgress}%` }} />
            </div>
          </div>
        )}

        {/* Selection State - 支持多图轮换 */}
        {canvasState === "selection" && processedImages.length > 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
            <p className="text-xl font-semibold mb-4">选择处理结果</p>
            
            {/* 单图大图预览模式 */}
            {processedImages.length === 1 ? (
              <div className="relative flex flex-col items-center">
                <div 
                  className="relative cursor-pointer group"
                  onClick={() => handleOpenFullscreen(processedImages[0], "image")}
                >
                  <img 
                    src={processedImages[0]} 
                    alt="Processed" 
                    className="max-w-full max-h-[400px] object-contain rounded-xl border-2 border-white/20 group-hover:border-tiktok-cyan/50 transition-all" 
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all rounded-xl">
                    <span className="opacity-0 group-hover:opacity-100 text-white text-sm font-medium">点击放大</span>
                  </div>
                </div>
                <Button 
                  onClick={() => handleSelectImage(processedImages[0])}
                  className="mt-4 bg-gradient-to-r from-tiktok-cyan to-blue-500 text-black font-semibold"
                >
                  <Check className="h-4 w-4 mr-2" />使用此图片
                </Button>
              </div>
            ) : (
              <>
                {/* 多图轮换模式 */}
                <div className="relative flex items-center gap-6">
                  {/* 左箭头 - 更醒目 */}
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => setCurrentImageIndex(prev => (prev - 1 + processedImages.length) % processedImages.length)}
                    className="h-14 w-14 rounded-full bg-gradient-to-r from-tiktok-cyan/80 to-blue-500/80 border-2 border-white/30 hover:from-tiktok-cyan hover:to-blue-500 shadow-lg shadow-tiktok-cyan/30"
                  >
                    <ArrowLeft className="h-7 w-7 text-white" />
                  </Button>
                  
                  {/* 当前图片 - 点击可全屏预览 */}
                  <div 
                    className="relative cursor-pointer group"
                    onClick={() => handleOpenFullscreen(processedImages[currentImageIndex], "image")}
                  >
                    <img 
                      src={processedImages[currentImageIndex]} 
                      alt={`Option ${currentImageIndex + 1}`} 
                      className="max-w-[400px] max-h-[400px] object-contain rounded-xl border-2 border-white/20 group-hover:border-tiktok-cyan/50 transition-all" 
                    />
                    <div className="absolute top-3 left-3 bg-black/70 px-3 py-1 rounded-full text-sm font-semibold">
                      {currentImageIndex + 1} / {processedImages.length}
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all rounded-xl">
                      <span className="opacity-0 group-hover:opacity-100 text-white text-sm font-medium">点击放大</span>
                    </div>
                  </div>
                  
                  {/* 右箭头 - 更醒目 */}
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => setCurrentImageIndex(prev => (prev + 1) % processedImages.length)}
                    className="h-14 w-14 rounded-full bg-gradient-to-r from-tiktok-pink/80 to-purple-500/80 border-2 border-white/30 hover:from-tiktok-pink hover:to-purple-500 shadow-lg shadow-tiktok-pink/30"
                  >
                    <ChevronRight className="h-7 w-7 text-white" />
                  </Button>
                </div>
                
                {/* 缩略图导航 */}
                <div className="flex gap-3 mt-5">
                  {processedImages.map((img, index) => (
                    <button 
                      key={index} 
                      onClick={() => setCurrentImageIndex(index)}
                      className={cn(
                        "w-18 h-18 rounded-lg overflow-hidden border-2 transition-all",
                        currentImageIndex === index 
                          ? "border-tiktok-cyan ring-2 ring-tiktok-cyan/50 scale-110" 
                          : "border-white/20 hover:border-white/40 opacity-70 hover:opacity-100"
                      )}
                    >
                      <img src={img} alt={`Thumb ${index + 1}`} className="w-16 h-16 object-cover" />
                    </button>
                  ))}
                </div>
                
                {/* 选择按钮 */}
                <Button 
                  onClick={() => handleSelectImage(processedImages[currentImageIndex])}
                  className="mt-5 bg-gradient-to-r from-tiktok-cyan to-blue-500 text-black font-semibold px-6 py-2"
                >
                  <Check className="h-4 w-4 mr-2" />使用图片 #{currentImageIndex + 1}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Selected State */}
        {canvasState === "selected" && (selectedImage || uploadedFile) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
            <div className="relative">
              <img src={selectedImage || uploadedFile?.url} alt="Selected" className="max-w-full max-h-[500px] object-contain rounded-xl ring-2 ring-tiktok-cyan" />
              <div className="absolute -top-3 -right-3 bg-tiktok-cyan text-black px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1">
                <Check className="h-4 w-4" /> Ready
              </div>
            </div>
            {processedImages.length > 1 && (
              <Button variant="ghost" onClick={handleBackToSelection} className="mt-4 text-muted-foreground">
                <ArrowLeft className="h-4 w-4 mr-2" />Choose another
              </Button>
            )}
          </div>
        )}

        {/* Generating State */}
        {canvasState === "generating" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="relative h-40 w-40 mb-8">
              <svg className="w-full h-full -rotate-90">
                <circle cx="80" cy="80" r="70" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                <circle cx="80" cy="80" r="70" fill="none" stroke="url(#soraGrad)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${generatingProgress * 4.4} 440`} />
                <defs><linearGradient id="soraGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#ff0050" /><stop offset="100%" stopColor="#8b5cf6" /></linearGradient></defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center"><span className="text-4xl font-bold">{generatingProgress}%</span></div>
            </div>
            <p className="text-2xl font-semibold text-tiktok-pink mb-2">{outputMode === "video" ? "Sora is dreaming..." : "Enhancing image..."}</p>
          </div>
        )}

        {/* Result State */}
        {canvasState === "result" && resultUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
            {/* 点击可全屏预览 */}
            <div 
              className="relative max-w-full max-h-[65%] cursor-pointer group"
              onClick={() => handleOpenFullscreen(resultUrl, outputMode)}
            >
              {outputMode === "video" ? (
                <video src={resultUrl} controls autoPlay loop className="max-w-full max-h-[450px] rounded-xl group-hover:ring-2 group-hover:ring-tiktok-cyan/50 transition-all" />
              ) : (
                <img src={resultUrl} alt="Generated" className="max-w-full max-h-[450px] object-contain rounded-xl group-hover:ring-2 group-hover:ring-tiktok-cyan/50 transition-all" />
              )}
              <div className="absolute top-3 right-3 bg-black/70 px-3 py-1.5 rounded-full text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                🔍 点击全屏查看
              </div>
            </div>
            {/* 操作按钮 */}
            <div className="flex gap-3 mt-5">
              <Button 
                onClick={() => handleDownloadContent(resultUrl, outputMode)}
                className="bg-gradient-to-r from-tiktok-cyan to-blue-500 text-black font-semibold px-5"
              >
                <Download className="h-4 w-4 mr-2" />保留它
              </Button>
              <Button 
                variant="outline" 
                onClick={handleDeleteContent} 
                className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300 px-5"
              >
                <X className="h-4 w-4 mr-2" />删除它
              </Button>
              <Button 
                variant="outline" 
                onClick={handleRemoveUpload} 
                className="border-white/20 px-5"
              >
                <RotateCcw className="h-4 w-4 mr-2" />重新生成
              </Button>
            </div>
          </div>
        )}

        {/* Failed State */}
        {canvasState === "failed" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <XCircle className="h-20 w-20 text-red-500 mb-6" />
            <p className="text-2xl font-semibold text-red-500 mb-2">Failed</p>
            <p className="text-muted-foreground mb-6">{error || "Please try again"}</p>
            <Button variant="outline" onClick={handleRemoveUpload}><RotateCcw className="h-4 w-4 mr-2" />Try Again</Button>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* AI Model Selector Dialog */}
      {/* ============================================================ */}
      <Dialog open={showModelDialog} onOpenChange={setShowModelDialog}>
        <DialogContent className="max-w-2xl bg-black/95 border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-tiktok-pink" />
              Choose Your AI Model
            </DialogTitle>
            <DialogDescription>Select a model to present your product</DialogDescription>
          </DialogHeader>
          
          <Tabs value={tempSelectedMode} onValueChange={(v) => setTempSelectedMode(v as AiCastMode)} className="mt-4">
            <TabsList className="grid w-full grid-cols-3 bg-black/30 h-10">
              <TabsTrigger value="auto" className="data-[state=active]:bg-tiktok-cyan/20 data-[state=active]:text-tiktok-cyan">
                <Bot className="h-4 w-4 mr-2" />Auto Match
              </TabsTrigger>
              <TabsTrigger value="team" className="data-[state=active]:bg-tiktok-pink/20 data-[state=active]:text-tiktok-pink">
                <Users className="h-4 w-4 mr-2" />My Team
                {myTeamModels.length > 0 && (
                  <span className="ml-1.5 text-xs bg-tiktok-pink/30 px-1.5 py-0.5 rounded-full">{myTeamModels.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="all" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">
                <Sparkles className="h-4 w-4 mr-2" />All Models
              </TabsTrigger>
            </TabsList>

            {/* Auto Match Tab */}
            <TabsContent value="auto" className="mt-4">
              <div className="p-8 rounded-xl bg-gradient-to-br from-tiktok-cyan/10 to-blue-500/10 border border-tiktok-cyan/20 text-center">
                <div className="relative h-20 w-20 mx-auto mb-4">
                  <div className="absolute inset-0 rounded-full bg-tiktok-cyan/20 animate-ping" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Bot className="h-10 w-10 text-tiktok-cyan" />
                  </div>
                </div>
                <p className="text-xl font-semibold text-tiktok-cyan mb-2">Smart Auto Match</p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  AI will analyze your product and automatically pick the best fitting model for your content.
                </p>
              </div>
            </TabsContent>

            {/* My Team Tab - Only shows hired & active (not expired) models */}
            <TabsContent value="team" className="mt-4">
              {isLoadingModels ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : myTeamModels.length > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground mb-3">
                    Showing {myTeamModels.length} model{myTeamModels.length > 1 ? "s" : ""} with active contracts
                  </p>
                  <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-1">
                    {myTeamModels.map((model) => {
                      const isExpiringSoon = model.days_remaining !== undefined && model.days_remaining <= 7;
                      return (
                        <button
                          key={model.id}
                          onClick={() => setTempSelectedModelId(model.id)}
                          className={cn(
                            "flex flex-col items-center p-4 rounded-xl border-2 transition-all hover:scale-[1.02]",
                            tempSelectedModelId === model.id
                              ? "border-tiktok-pink bg-tiktok-pink/10 ring-2 ring-tiktok-pink/30"
                              : isExpiringSoon
                                ? "border-amber-500/50 bg-amber-500/5 hover:border-amber-500"
                                : "border-white/10 hover:border-white/30 bg-white/5"
                          )}
                        >
                          {/* Avatar */}
                          <div className="relative">
                            {model.avatar_url ? (
                              <img
                                src={model.avatar_url}
                                alt={model.name}
                                className="h-20 w-20 rounded-full object-cover border-2 border-white/20"
                              />
                            ) : (
                              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-tiktok-pink/30 to-purple-500/30 flex items-center justify-center border-2 border-white/20">
                                <User className="h-10 w-10 text-muted-foreground" />
                              </div>
                            )}
                            {/* Selection Indicator */}
                            {tempSelectedModelId === model.id && (
                              <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-tiktok-pink flex items-center justify-center shadow-lg">
                                <Check className="h-4 w-4 text-white" />
                              </div>
                            )}
                            {/* Active Badge */}
                            <div className={cn(
                              "absolute -bottom-1 left-1/2 -translate-x-1/2 text-white text-[10px] px-2 py-0.5 rounded-full font-medium",
                              isExpiringSoon ? "bg-amber-500" : "bg-emerald-500"
                            )}>
                              {isExpiringSoon ? `${model.days_remaining}d left` : "Active"}
                            </div>
                          </div>
                          {/* Name */}
                          <p className="mt-3 text-sm font-semibold truncate w-full text-center">{model.name}</p>
                          {/* Tags */}
                          {model.tags && model.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2 justify-center">
                              {model.tags.slice(0, 2).map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground"
                                >
                                  {tag}
                                </span>
                              ))}
                              {model.tags.length > 2 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">
                                  +{model.tags.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="p-8 rounded-xl bg-white/5 border border-white/10 text-center">
                  <Users className="h-14 w-14 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground mb-2 font-medium">No active contracts</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Hire models from the market to use them in your creations
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowModelDialog(false);
                      window.location.href = "/models";
                    }}
                    className="border-tiktok-pink/50 text-tiktok-pink hover:bg-tiktok-pink/10"
                  >
                    Browse Model Market
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* All Models Tab */}
            <TabsContent value="all" className="mt-4">
              {isLoadingModels ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : allModels.length > 0 ? (
                <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-1">
                  {allModels.map((model) => {
                    const isHired = myTeamModels.some((m) => m.id === model.id);
                    return (
                      <button
                        key={model.id}
                        onClick={() => setTempSelectedModelId(model.id)}
                        className={cn(
                          "flex flex-col items-center p-4 rounded-xl border-2 transition-all hover:scale-[1.02]",
                          tempSelectedModelId === model.id
                            ? "border-purple-500 bg-purple-500/10 ring-2 ring-purple-500/30"
                            : "border-white/10 hover:border-white/30 bg-white/5"
                        )}
                      >
                        {/* Avatar */}
                        <div className="relative">
                          {model.avatar_url ? (
                            <img
                              src={model.avatar_url}
                              alt={model.name}
                              className="h-20 w-20 rounded-full object-cover border-2 border-white/20"
                            />
                          ) : (
                            <div className="h-20 w-20 rounded-full bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center border-2 border-white/20">
                              <User className="h-10 w-10 text-muted-foreground" />
                            </div>
                          )}
                          {/* Selection Indicator */}
                          {tempSelectedModelId === model.id && (
                            <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-purple-500 flex items-center justify-center shadow-lg">
                              <Check className="h-4 w-4 text-white" />
                            </div>
                          )}
                          {/* Featured/Trending Badges */}
                          {model.is_featured && (
                            <div className="absolute -top-1 -left-1 h-5 w-5 rounded-full bg-amber-500 flex items-center justify-center shadow-lg">
                              <Sparkles className="h-3 w-3 text-white" />
                            </div>
                          )}
                          {/* Hired Badge */}
                          {isHired && (
                            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
                              In Team
                            </div>
                          )}
                        </div>
                        {/* Name */}
                        <p className="mt-3 text-sm font-semibold truncate w-full text-center">{model.name}</p>
                        {/* Tags */}
                        {model.tags && model.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2 justify-center">
                            {model.tags.slice(0, 2).map((tag, idx) => (
                              <span
                                key={idx}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                            {model.tags.length > 2 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">
                                +{model.tags.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Rating */}
                        <div className="flex items-center gap-1 mt-1.5">
                          <span className="text-amber-400 text-xs">★</span>
                          <span className="text-xs text-muted-foreground">{model.rating.toFixed(1)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 rounded-xl bg-white/5 border border-white/10 text-center">
                  <Sparkles className="h-14 w-14 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground mb-2 font-medium">No models available</p>
                  <p className="text-xs text-muted-foreground">
                    Models will appear here once they are added
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {tempSelectedMode === "auto" ? (
                <span className="flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5 text-tiktok-cyan" />
                  AI will choose the best model
                </span>
              ) : tempSelectedModelId ? (
                <span className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-green-400" />
                  Model selected
                </span>
              ) : (
                <span className="text-amber-400">Please select a model</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowModelDialog(false)} className="border-white/20">
                Cancel
              </Button>
              <Button
                onClick={handleConfirmModel}
                disabled={(tempSelectedMode === "team" || tempSelectedMode === "all") && !tempSelectedModelId}
                className="bg-gradient-to-r from-tiktok-pink to-purple-500 text-white font-semibold"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Confirm
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* 全屏预览弹窗 */}
      {/* ============================================================ */}
      <Dialog open={fullscreenPreview.open} onOpenChange={(open) => !open && handleCloseFullscreen()}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-black/95 border-white/10 overflow-hidden">
          <div className="relative flex flex-col items-center justify-center min-h-[80vh]">
            {/* 关闭按钮 */}
            <button
              onClick={handleCloseFullscreen}
              className="absolute top-4 right-4 z-50 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              <X className="h-5 w-5 text-white" />
            </button>
            
            {/* 内容 - 增大预览区域 */}
            <div className="flex-1 flex items-center justify-center p-4">
              {fullscreenPreview.type === "video" ? (
                <video 
                  src={fullscreenPreview.url} 
                  controls 
                  autoPlay 
                  loop 
                  className="max-w-[92vw] max-h-[80vh] rounded-xl"
                />
              ) : (
                <img 
                  src={fullscreenPreview.url} 
                  alt="Full preview" 
                  className="max-w-[92vw] max-h-[80vh] object-contain rounded-xl"
                />
              )}
            </div>
            
            {/* 底部操作栏 */}
            <div className="w-full px-8 py-4 bg-black/50 border-t border-white/10 flex items-center justify-center gap-4">
              <Button 
                onClick={() => handleDownloadContent(fullscreenPreview.url, fullscreenPreview.type)}
                className="bg-gradient-to-r from-tiktok-cyan to-blue-500 text-black font-semibold px-6"
              >
                <Download className="h-4 w-4 mr-2" />保留它 (下载)
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  handleDeleteContent();
                  handleCloseFullscreen();
                }} 
                className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300 px-6"
              >
                <X className="h-4 w-4 mr-2" />删除它
              </Button>
              <Button 
                variant="outline" 
                onClick={handleCloseFullscreen}
                className="border-white/20 px-6"
              >
                返回
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
