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
  Type,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
// 不再使用 Server Action，直接调用 API 路由
// import { generateVideo, getVideoTaskStatus } from "@/lib/actions/generate-video";
import { 
  getUserHiredModels, 
  getMarketplaceModels,
  type HiredModel,
  type PublicModel as ServerPublicModel,
} from "@/lib/actions/models";

// ============================================================================
// 类型定义
// ============================================================================

type OutputMode = "video" | "image";
type SourceType = "local_upload" | "nano_banana";
type NanoTier = "fast" | "pro";
type ProcessingType = "upscale" | "9grid";
// 只保留 API 支持的时长: 10s 和 15s
type VideoModel = "sora-2" | "sora-2-pro-15";
type VideoAspectRatio = "9:16" | "16:9";
type ImageAspectRatio = "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
type ImageResolution = "1k" | "2k" | "4k";
type AiCastMode = "auto" | "team" | "all";
type BatchCount = 1 | 2 | 3 | 4;

// 公开模特类型 (用于 UI 显示)
interface DisplayModel {
  id: string;
  name: string;
  avatar_url: string | null;
  demo_video_url?: string | null;
  tags: string[];
  category: string;
  gender: "male" | "female" | "neutral" | null;
  price_monthly: number;
  rating: number;
  is_featured: boolean;
  is_trending: boolean;
  is_hired?: boolean;
  days_remaining?: number;
  contract_end_date?: string | null;
}

type CanvasState = 
  | "empty"
  | "preview"
  | "processing"
  | "selection"
  | "selected"
  | "generating"
  | "result"
  | "failed";

// ============================================================================
// 计费配置
// ============================================================================

const NANO_PRICING = {
  fast: { label: "Fast", credits: 10 },
  pro: { label: "Pro", credits: 28 },
};

// 速创 API 支持的时长选项: 10s, 15s
// 定价策略：10秒便宜，15秒贵 (API 实际消耗)
const VIDEO_MODEL_PRICING: Record<VideoModel, { label: string; duration: string; credits: number; apiDuration: 10 | 15 }> = {
  "sora-2": { label: "Sora 2 Standard", duration: "10s", credits: 30, apiDuration: 10 },
  "sora-2-pro-15": { label: "Sora 2 Pro", duration: "15s", credits: 50, apiDuration: 15 },
};

const IMAGE_ASPECT_OPTIONS: { value: ImageAspectRatio; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

const IMAGE_RESOLUTION_OPTIONS: { value: ImageResolution; label: string }[] = [
  { value: "1k", label: "1K (Default)" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

// ============================================================================
// Mock 生成图片
// ============================================================================

const generateMockGridImages = (count: number): string[] => {
  const baseImages = [
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&h=600&fit=crop",
    "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&h=600&fit=crop",
    "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&h=600&fit=crop",
    "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600&h=600&fit=crop",
  ];
  return baseImages.slice(0, count).map((url, i) => `${url}&sig=${Date.now()}-${i}`);
};

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
  const [nanoTier, setNanoTier] = useState<NanoTier>("fast");
  const [processingType, setProcessingType] = useState<ProcessingType>("9grid");
  const [batchCount, setBatchCount] = useState<BatchCount>(2);
  const [uploadedFile, setUploadedFile] = useState<{ url: string; name: string } | null>(null);

  // ================================================================
  // Image Mode: Settings
  // ================================================================
  const [imageNanoTier, setImageNanoTier] = useState<NanoTier>("fast");
  const [imageAspectRatio, setImageAspectRatio] = useState<ImageAspectRatio>("auto");
  const [imageResolution, setImageResolution] = useState<ImageResolution>("1k");

  // ================================================================
  // Video Mode: Step 2 - Content Configuration
  // ================================================================
  const [prompt, setPrompt] = useState("");
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [videoModel, setVideoModel] = useState<VideoModel>("sora-2");
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
  const [processingProgress, setProcessingProgress] = useState(0);
  const [generatingProgress, setGeneratingProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  // 计费计算
  // ================================================================
  
  // Video Mode: Process Image Cost
  const processImageCost = useMemo(() => {
    if (sourceType === "local_upload") return 0;
    return NANO_PRICING[nanoTier].credits;
  }, [sourceType, nanoTier]);

  // Video Mode: Generate Video Cost
  const generateVideoCost = useMemo(() => {
    return VIDEO_MODEL_PRICING[videoModel].credits;
  }, [videoModel]);

  // Image Mode: Generate Image Cost (基于 tier)
  const generateImageCost = useMemo(() => {
    return NANO_PRICING[imageNanoTier].credits;
  }, [imageNanoTier]);

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
    (canvasState === "preview" || canvasState === "selected");
  
  // 是否有可用底图 (用于显示，不用于禁用生成按钮)
  const hasBaseImage = selectedImage || (sourceType === "local_upload" && uploadedFile);
  
  // ============================================
  // 【修复1】解锁生成按钮：支持纯文本生成
  // 按钮可用条件：(Prompt 不为空) OR (Image 已上传)
  // ============================================
  const canGenerate = useMemo(() => {
    // 基本条件：不在处理中
    if (canvasState === "processing" || canvasState === "generating") return false;
    
    // 积分检查
    if (userCredits < totalCost) return false;
    
    if (outputMode === "video") {
      // Video Mode: Prompt 或 Image 至少有一个
      const hasPrompt = prompt.trim().length > 0;
      const hasImage = hasBaseImage;
      return hasPrompt || hasImage;
    } else {
      // Image Mode: 必须有上传的图片
      return !!uploadedFile;
    }
  }, [canvasState, userCredits, totalCost, outputMode, prompt, hasBaseImage, uploadedFile]);

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

  // 获取 My Team 模特 - 仅已签约且未过期的模特
  useEffect(() => {
    const fetchMyTeam = async () => {
      if (!userId) return;
      
      try {
        const teamResult = await getUserHiredModels(userId);
        if (teamResult.success && teamResult.data?.models) {
          // 转换为 DisplayModel 格式
          // getUserHiredModels 已经只返回 status='active' 且 end_date > now() 的合约
          const hiredModels: DisplayModel[] = teamResult.data.models.map((m) => ({
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
            is_hired: true,
            days_remaining: m.days_remaining,
            contract_end_date: m.contract_end_date,
          }));
          setMyTeamModels(hiredModels);
          console.log(`[Quick Gen] Loaded ${hiredModels.length} hired models (active & not expired)`);
        }
      } catch (error) {
        console.error("[Quick Gen] Failed to fetch hired models:", error);
      }
    };

    fetchMyTeam();
  }, [userId]);

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

    for (let i = 0; i <= 100; i += 5) {
      await new Promise((r) => setTimeout(r, 100));
      setProcessingProgress(i);
    }

    setUserCredits((prev) => prev - processImageCost);

    if (processingType === "upscale") {
      const upscaledUrl = `${uploadedFile.url}&upscaled=true&t=${Date.now()}`;
      setProcessedImages([upscaledUrl]);
      setSelectedImage(upscaledUrl);
      setCanvasState("selected");
      toast({ title: "✨ Ultra-HD 增强完成" });
    } else {
      const images = generateMockGridImages(batchCount);
      setProcessedImages(images);
      setCanvasState("selection");
      toast({ title: `🎨 已生成 ${batchCount} 张方案，请选择` });
    }
  }, [canProcessImage, uploadedFile, userCredits, processImageCost, processingType, batchCount, toast]);

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
      // Video Mode: 调用真实 Sora API
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

        console.log("[Quick Gen] Starting video generation:", {
          prompt: prompt.trim().substring(0, 50) + "...",
          duration: `${apiDuration}s`,
          aspectRatio: videoAspectRatio,
          modelId: modelIdToSend,
          hasSourceImage: !!remoteImageUrl,
          cost: costCredits,
        });

        setGeneratingProgress(10);

        // 调用真实 API
        const response = await fetch("/api/generate/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            duration: apiDuration,
            aspectRatio: videoAspectRatio,
            size: "small",
            modelId: modelIdToSend,
            sourceImageUrl: remoteImageUrl,
            userId,
          }),
        });

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || "提交生成任务失败");
        }

        const taskId = result.data.taskId;
        console.log("[Quick Gen] Task submitted:", taskId, "Estimated:", result.data.estimatedTime);

        toast({ 
          title: "🚀 视频生成已启动", 
          description: `预计需要 ${result.data.estimatedTime}`,
        });

        // 立即扣除积分（乐观更新）
        setUserCredits((prev) => prev - costCredits);

        // 轮询任务状态 (每 10 秒查询一次，最多 8 分钟)
        let pollCount = 0;
        const maxPolls = 48; // 48 * 10s = 8 分钟
        const pollIntervalMs = 10000; // 10 秒
        
        const pollTimer = setInterval(async () => {
          pollCount++;
          
          // 模拟进度 (基于时间估算)
          const estimatedProgress = Math.min(95, Math.round((pollCount / 30) * 100));
          setGeneratingProgress(estimatedProgress);

          try {
            const statusResponse = await fetch(`/api/generate/video?taskId=${taskId}`);
            const statusResult = await statusResponse.json();
            
            if (!statusResult.success) {
              console.error("[Quick Gen] Status query failed:", statusResult.error);
              // 继续轮询
              return;
            }

            const task = statusResult.data;
            console.log("[Quick Gen] Task status:", task.status, `(poll ${pollCount})`);

            if (task.status === "completed") {
              clearInterval(pollTimer);
              setGeneratingProgress(100);
              
              // 设置结果
              setResultUrl(task.videoUrl);
              setCanvasState("result");
              
              // 触发全局积分刷新事件
              window.dispatchEvent(new CustomEvent("credits-updated"));
              
              toast({ 
                title: "🎉 视频生成成功！", 
                description: `消耗 ${costCredits} Credits`,
              });

              // 自动下载
              if (autoDownload && task.videoUrl) {
                setTimeout(() => {
                  const link = document.createElement("a");
                  link.href = task.videoUrl;
                  link.download = `quick-gen-${Date.now()}.mp4`;
                  link.click();
                  toast({ title: "📥 视频已自动下载" });
                }, 500);
              }
            } else if (task.status === "failed") {
              clearInterval(pollTimer);
              
              // 退还积分
              setUserCredits((prev) => prev + costCredits);
              
              setError(task.errorMessage || "生成失败");
              setCanvasState("failed");
              
              toast({ 
                variant: "destructive",
                title: "生成失败", 
                description: task.errorMessage || "请重试",
              });
            } else if (pollCount >= maxPolls) {
              clearInterval(pollTimer);
              setError("生成超时，请稍后查看结果");
              setCanvasState("failed");
              toast({ 
                variant: "destructive",
                title: "生成超时", 
                description: "Sora 2 视频生成需要 4-6 分钟，请稍后刷新查看",
              });
            }
          } catch (pollError) {
            console.error("[Quick Gen] Polling error:", pollError);
            // 继续轮询，不中断
          }
        }, pollIntervalMs);

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
      // Image Mode: 保持原有逻辑
      // ============================================
      const payload = {
        mode: outputMode,
        prompt: prompt.trim() || null,
        source_image: hasBaseImage ? (selectedImage || uploadedFile?.url) : null,
        nano_tier: imageNanoTier,
        aspect_ratio: imageAspectRatio,
        resolution: imageNanoTier === "pro" ? imageResolution : null,
        enhancement_prompt: prompt.trim() || null,
      };

      console.log("Generate payload:", payload);

      const steps = 15;
      for (let i = 0; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, 200));
        setGeneratingProgress(Math.round((i / steps) * 100));
      }

      setUserCredits((prev) => prev - totalCost);

      const mockResult = selectedImage || uploadedFile?.url || "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1024";

      setResultUrl(mockResult);
      setCanvasState("result");

      toast({ title: "🎉 图片生成成功！", description: `消耗 ${totalCost} Credits` });

      if (autoDownload && mockResult) {
        const link = document.createElement("a");
        link.href = mockResult;
        link.download = `quick-gen-${Date.now()}.jpg`;
        link.click();
      }
    }
  }, [canGenerate, outputMode, prompt, hasBaseImage, selectedImage, uploadedFile, videoModel, videoAspectRatio, useAiModel, aiCastMode, selectedModelId, imageNanoTier, imageAspectRatio, imageResolution, totalCost, autoDownload, toast]);

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
        <div className="flex p-1 rounded-xl bg-white/5 border border-white/10">
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
          <Button
            variant="ghost"
            onClick={() => {
              setOutputMode("image");
              setCanvasState(uploadedFile ? "preview" : "empty");
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
                  <label className="flex items-center justify-center gap-3 h-16 rounded-xl border-2 border-dashed border-white/20 cursor-pointer hover:border-tiktok-cyan/50 hover:bg-tiktok-cyan/5 transition-all px-4">
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
                    <Upload className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-medium">Upload Reference Image</p>
                      <p className="text-xs text-muted-foreground">Optional - for Image-to-Video</p>
                    </div>
                  </label>
                ) : (
                  <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 border border-white/10">
                    <div className="h-12 w-12 rounded-lg overflow-hidden flex-shrink-0 bg-black/30">
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
                      <TabsList className="grid w-full grid-cols-2 bg-black/30 h-9">
                        <TabsTrigger value="local_upload" className="text-xs">
                          <FileImage className="h-3.5 w-3.5 mr-1.5" /> Direct Use
                        </TabsTrigger>
                        <TabsTrigger value="nano_banana" className="text-xs">
                          <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Nano Banana
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>

                    {/* Nano Banana Settings */}
                    {sourceType === "nano_banana" && (
                      <div className="space-y-3 p-3 rounded-lg bg-white/5 border border-white/10">
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setNanoTier("fast")}
                            className={cn("flex-1 h-8", nanoTier === "fast" ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan" : "border-white/20")}>
                            Fast (10 pts)
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setNanoTier("pro")}
                            className={cn("flex-1 h-8", nanoTier === "pro" ? "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink" : "border-white/20")}>
                            Pro (28 pts)
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setProcessingType("upscale")}
                            className={cn("flex-1 h-8 gap-1", processingType === "upscale" ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan" : "border-white/20")}>
                            <ZoomIn className="h-3.5 w-3.5" /> Upscale
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setProcessingType("9grid")}
                            className={cn("flex-1 h-8 gap-1", processingType === "9grid" ? "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink" : "border-white/20")}>
                            <Grid3X3 className="h-3.5 w-3.5" /> 9-Grid
                          </Button>
                        </div>
                        {processingType === "9grid" && (
                          <div className="flex gap-2">
                            {([1, 2, 3, 4] as BatchCount[]).map((count) => (
                              <Button key={count} variant="outline" size="sm" onClick={() => setBatchCount(count)}
                                className={cn("flex-1 h-8", batchCount === count ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "border-white/20")}>
                                {count}
                              </Button>
                            ))}
                          </div>
                        )}
                        <Button onClick={handleProcessImage} disabled={!canProcessImage || canvasState === "processing"}
                          className={cn("w-full h-9 font-semibold", canProcessImage ? "bg-gradient-to-r from-tiktok-cyan to-blue-500 text-black" : "bg-white/10 text-muted-foreground")}>
                          {canvasState === "processing" ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{processingProgress}%</> : <><Sparkles className="h-4 w-4 mr-2" />Process ({processImageCost} pts)</>}
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
                      placeholder={uploadedFile ? "Describe the video content you want to generate..." : "Describe your video in detail (required for text-to-video)..."}
                      disabled={canvasState === "generating"} 
                      className="bg-black/30 border-white/10 resize-none text-sm pr-16 min-h-[140px]" 
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
                    <Label className="text-xs text-muted-foreground mb-2 block">Model & Duration</Label>
                    <div className="space-y-1.5">
                      {(Object.entries(VIDEO_MODEL_PRICING) as [VideoModel, typeof VIDEO_MODEL_PRICING[VideoModel]][]).map(([key, value]) => (
                        <Button key={key} variant="outline" size="sm" onClick={() => setVideoModel(key)}
                          className={cn("w-full justify-between h-8", videoModel === key ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan" : "border-white/20")}>
                          <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{value.duration} ({value.label})</span>
                          <span className="text-xs">{value.credits} pts</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Aspect Ratio</Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setVideoAspectRatio("9:16")}
                        className={cn("flex-1 h-8", videoAspectRatio === "9:16" ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan" : "border-white/20")}>
                        <Smartphone className="h-3.5 w-3.5 mr-1" /> 9:16
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setVideoAspectRatio("16:9")}
                        className={cn("flex-1 h-8", videoAspectRatio === "16:9" ? "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink" : "border-white/20")}>
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
                                    <span key={idx} className="text-[9px] px-1 py-0.5 rounded bg-white/10 text-muted-foreground">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center border border-white/20">
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
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5">
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
              <CardDescription className="text-xs">使用 Nano Banana AI 增强图片</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Upload Area - Compact */}
              {!uploadedFile ? (
                <label className="flex items-center justify-center gap-3 h-16 rounded-xl border-2 border-dashed border-white/20 cursor-pointer hover:border-tiktok-pink/50 hover:bg-tiktok-pink/5 transition-all px-4">
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
                  <Upload className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div className="text-left">
                    <p className="text-sm font-medium">Upload Source Image</p>
                    <p className="text-xs text-muted-foreground">Required for image generation</p>
                  </div>
                </label>
              ) : (
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 border border-white/10">
                  <div className="h-12 w-12 rounded-lg overflow-hidden flex-shrink-0 bg-black/30">
                    <img src={uploadedFile.url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{uploadedFile.name}</p>
                    <p className="text-xs text-muted-foreground">Ready for enhancement</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleRemoveUpload} className="h-8 w-8">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

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
                    placeholder="Describe how you want the image enhanced... (e.g., 'studio lighting, white background, product photography')"
                    disabled={canvasState === "generating"} 
                    className="bg-black/30 border-white/10 resize-none text-sm pr-16 min-h-[120px]" 
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
                    className={cn("flex-1 h-10 flex-col gap-0.5", imageNanoTier === "fast" ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan" : "border-white/20")}>
                    <span className="font-semibold">Fast</span>
                    <span className="text-xs opacity-70">10 Credits</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setImageNanoTier("pro")}
                    className={cn("flex-1 h-10 flex-col gap-0.5", imageNanoTier === "pro" ? "bg-tiktok-pink/20 border-tiktok-pink/50 text-tiktok-pink" : "border-white/20")}>
                    <span className="font-semibold">Pro</span>
                    <span className="text-xs opacity-70">28 Credits</span>
                  </Button>
                </div>
              </div>

              {/* Aspect Ratio */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Aspect Ratio</Label>
                <Select value={imageAspectRatio} onValueChange={(v) => setImageAspectRatio(v as ImageAspectRatio)}>
                  <SelectTrigger className="bg-black/30 border-white/10 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black/95 border-white/10">
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
                    <SelectTrigger className="bg-black/30 border-white/10 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-black/95 border-white/10">
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
          <Button onClick={handleGenerate} disabled={!canGenerate || canvasState === "generating"}
            className={cn("w-full h-12 font-semibold transition-all text-base",
              canGenerate ? "bg-gradient-to-r from-tiktok-pink to-purple-500 text-white shadow-[0_0_20px_rgba(255,0,80,0.3)]" : "bg-white/10 text-muted-foreground")}>
            {canvasState === "generating" ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" />Generating... {generatingProgress}%</>
            ) : (
              <><Play className="h-5 w-5 mr-2" />Generate {outputMode === "video" ? "Video" : "Image"}</>
            )}
          </Button>
          {/* 显示禁用原因 */}
          {!canGenerate && canvasState !== "generating" && (
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
        </div>
      </div>

      {/* ============================================================ */}
      {/* RIGHT PANEL - Canvas/Preview */}
      {/* ============================================================ */}
      <div className="flex-1 rounded-2xl border border-border/50 bg-black/30 overflow-hidden relative">
        
        {/* Empty State */}
        {canvasState === "empty" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="h-24 w-24 rounded-3xl bg-white/5 flex items-center justify-center mb-6">
              {outputMode === "video" ? <Video className="h-12 w-12 text-muted-foreground/50" /> : <ImageIcon className="h-12 w-12 text-muted-foreground/50" />}
            </div>
            <p className="text-xl font-medium text-muted-foreground/70 mb-2">Preview Area</p>
            <p className="text-sm text-muted-foreground/50">
              {outputMode === "video" ? "Upload an image or just use prompt" : "Upload an image to get started"}
            </p>
          </div>
        )}

        {/* Preview State */}
        {canvasState === "preview" && uploadedFile && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
            <div className="relative">
              <img src={uploadedFile.url} alt="Preview" className="max-w-full max-h-[500px] object-contain rounded-xl border border-white/20" />
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500/90 text-black px-3 py-1 rounded-full text-xs font-semibold">
                Original Image
              </div>
            </div>
            {outputMode === "video" && sourceType === "nano_banana" && (
              <p className="mt-6 text-muted-foreground text-center text-sm">
                Click <span className="text-tiktok-cyan font-semibold">&quot;Process&quot;</span> to enhance
              </p>
            )}
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

        {/* Selection State */}
        {canvasState === "selection" && processedImages.length > 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
            <p className="text-xl font-semibold mb-6">Select a result</p>
            <div className="grid grid-cols-2 gap-4">
              {processedImages.map((img, index) => (
                <button key={index} onClick={() => handleSelectImage(img)}
                  className="relative group rounded-xl overflow-hidden border-2 border-white/20 hover:border-tiktok-cyan transition-all hover:scale-[1.02]">
                  <img src={img} alt={`Option ${index + 1}`} className="w-full h-auto max-h-[280px] object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-tiktok-cyan text-black px-4 py-2 rounded-lg font-semibold">Select</div>
                  </div>
                  <div className="absolute top-3 left-3 bg-black/70 px-2 py-1 rounded text-sm">#{index + 1}</div>
                </button>
              ))}
            </div>
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
            <div className="relative max-w-full max-h-[70%]">
              {outputMode === "video" ? (
                <video src={resultUrl} controls autoPlay loop className="max-w-full max-h-[500px] rounded-xl" />
              ) : (
                <img src={resultUrl} alt="Generated" className="max-w-full max-h-[500px] object-contain rounded-xl" />
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={() => { const link = document.createElement("a"); link.href = resultUrl; link.download = `quick-gen-${Date.now()}.${outputMode === "video" ? "mp4" : "jpg"}`; link.click(); }}
                className="bg-tiktok-cyan text-black font-semibold"><Download className="h-4 w-4 mr-2" />Download</Button>
              <Button variant="outline" onClick={handleRemoveUpload} className="border-white/20"><RotateCcw className="h-4 w-4 mr-2" />New</Button>
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
    </div>
  );
}
