"use client";

import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Upload,
  Sparkles,
  Zap,
  ImagePlus,
  Loader2,
  Check,
  X,
  Grid3X3,
  CheckCircle2,
  Images,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";

// ============================================================================
// 类型定义
// ============================================================================

export interface ResourceInputBatchProps {
  nanoBananaVersion: "V1" | "V2";
  onAddTasks: (images: { url: string; name: string }[]) => void;
  disabled?: boolean;
}

interface ProcessedImage {
  url: string;
  name: string;
  angle: string;
  selected: boolean;
}

// ============================================================================
// Mock 九宫格数据
// ============================================================================

const ANGLE_NAMES = [
  "正面 Front",
  "左侧 Left",
  "右侧 Right",
  "背面 Back",
  "俯视 Top",
  "仰视 Bottom",
  "左前 Front-Left",
  "右前 Front-Right",
  "特写 Close-up",
];

function generateMockGridImages(originalName: string): ProcessedImage[] {
  const baseUrls = [
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1560343090-f0409e92791a?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1491553895911-0055uj-8b8be?w=400&h=400&fit=crop",
  ];

  return ANGLE_NAMES.map((angle, index) => ({
    url: baseUrls[index % baseUrls.length] + `&sig=${Date.now()}-${index}`,
    name: `${originalName.replace(/\.[^.]+$/, "")}_${angle.split(" ")[0]}.jpg`,
    angle,
    selected: false,
  }));
}

// ============================================================================
// Resource Input Batch 组件
// ============================================================================

export function ResourceInputBatch({
  nanoBananaVersion,
  onAddTasks,
  disabled = false,
}: ResourceInputBatchProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"direct" | "nanoBanana">("direct");

  // Direct Upload 状态
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ file: File; preview: string }>>([]);

  // Nano Banana 状态
  const [nanoBananaFile, setNanoBananaFile] = useState<File | null>(null);
  const [nanoBananaPreview, setNanoBananaPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedImages, setProcessedImages] = useState<ProcessedImage[]>([]);
  const [showGridSelector, setShowGridSelector] = useState(false);

  // ================================================================
  // Direct Upload 处理
  // ================================================================

  const handleDirectFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (fileArray.length === 0) return;

    const newFiles = fileArray.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setUploadedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    handleDirectFiles(e.dataTransfer.files);
  }, [disabled, handleDirectFiles]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleDirectFiles(e.target.files);
    }
    // Reset input
    e.target.value = "";
  }, [handleDirectFiles]);

  const handleRemoveFile = useCallback((index: number) => {
    setUploadedFiles((prev) => {
      const item = prev[index];
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleAddDirectToStaging = useCallback(() => {
    if (uploadedFiles.length === 0) return;

    onAddTasks(
      uploadedFiles.map((f) => ({
        url: f.preview,
        name: f.file.name,
      }))
    );

    setUploadedFiles([]);
  }, [uploadedFiles, onAddTasks]);

  // ================================================================
  // Nano Banana 处理
  // ================================================================

  const handleNanoBananaUpload = useCallback((file: File) => {
    const preview = URL.createObjectURL(file);
    setNanoBananaFile(file);
    setNanoBananaPreview(preview);
  }, []);

  const handleNanoBananaDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleNanoBananaUpload(file);
    }
  }, [disabled, handleNanoBananaUpload]);

  const handleStartProcessing = useCallback(() => {
    if (!nanoBananaFile) return;

    setIsProcessing(true);

    // 模拟 3 秒处理
    setTimeout(() => {
      const mockImages = generateMockGridImages(nanoBananaFile.name);
      setProcessedImages(mockImages);
      setIsProcessing(false);
      setShowGridSelector(true);
    }, 3000);
  }, [nanoBananaFile]);

  const handleToggleSelect = useCallback((index: number) => {
    setProcessedImages((prev) =>
      prev.map((img, i) =>
        i === index ? { ...img, selected: !img.selected } : img
      )
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    const allSelected = processedImages.every((img) => img.selected);
    setProcessedImages((prev) =>
      prev.map((img) => ({ ...img, selected: !allSelected }))
    );
  }, [processedImages]);

  const handleConfirmSelection = useCallback(() => {
    const selected = processedImages.filter((img) => img.selected);
    if (selected.length === 0) return;

    onAddTasks(selected.map((img) => ({ url: img.url, name: img.name })));

    // Reset
    setShowGridSelector(false);
    setProcessedImages([]);
    if (nanoBananaPreview) URL.revokeObjectURL(nanoBananaPreview);
    setNanoBananaFile(null);
    setNanoBananaPreview(null);

    toast({
      title: "素材已添加",
      description: `${selected.length} 张图片已加入备料台`,
    });
  }, [processedImages, onAddTasks, nanoBananaPreview, toast]);

  const handleCancelNanoBanana = useCallback(() => {
    if (nanoBananaPreview) URL.revokeObjectURL(nanoBananaPreview);
    setNanoBananaFile(null);
    setNanoBananaPreview(null);
    setProcessedImages([]);
    setShowGridSelector(false);
    setIsProcessing(false);
  }, [nanoBananaPreview]);

  const selectedCount = processedImages.filter((img) => img.selected).length;

  // ================================================================
  // 渲染
  // ================================================================

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "direct" | "nanoBanana")} className="flex flex-col h-full">
        <CardHeader className="pb-0 border-b border-border/50 flex-shrink-0">
          <CardTitle className="text-lg flex items-center gap-2">
            <ImagePlus className="h-5 w-5 text-tiktok-cyan" />
            批量素材输入
          </CardTitle>
          <CardDescription>
            上传多张图片或使用 Nano Banana 批量生成
          </CardDescription>

          <TabsList className="mt-4 grid w-full grid-cols-2 bg-black/30 p-1 h-auto">
            <TabsTrigger
              value="direct"
              disabled={disabled}
              className={cn(
                "flex items-center gap-2 py-2.5 px-3",
                "data-[state=active]:bg-gradient-to-r data-[state=active]:from-tiktok-cyan/20 data-[state=active]:to-tiktok-cyan/10",
                "data-[state=active]:text-tiktok-cyan"
              )}
            >
              <Zap className="h-4 w-4" />
              <span className="font-medium">批量上传</span>
            </TabsTrigger>

            <TabsTrigger
              value="nanoBanana"
              disabled={disabled}
              className={cn(
                "flex items-center gap-2 py-2.5 px-3",
                "data-[state=active]:bg-gradient-to-r data-[state=active]:from-tiktok-pink/20 data-[state=active]:to-tiktok-pink/10",
                "data-[state=active]:text-tiktok-pink"
              )}
            >
              <Sparkles className="h-4 w-4" />
              <span className="font-medium">Nano Banana</span>
            </TabsTrigger>
          </TabsList>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4">
          {/* ============================================ */}
          {/* Tab: Direct Upload (Batch) */}
          {/* ============================================ */}
          <TabsContent value="direct" className="mt-0 h-full">
            <div className="space-y-4 h-full flex flex-col">
              {/* Dropzone */}
              <label
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "flex flex-col items-center justify-center cursor-pointer",
                  "min-h-[150px] rounded-xl border-2 border-dashed",
                  "transition-all duration-300",
                  isDragging
                    ? "border-tiktok-cyan bg-tiktok-cyan/10 scale-[1.02]"
                    : "border-white/20 hover:border-tiktok-cyan/50 hover:bg-white/5",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleInputChange}
                  className="hidden"
                  disabled={disabled}
                />
                <div className="flex flex-col items-center gap-3 p-4">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20 flex items-center justify-center">
                    <Images className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">拖拽多张图片到此处</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      或点击选择文件 · 支持批量上传
                    </p>
                  </div>
                </div>
              </label>

              {/* Preview Grid */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-3 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      已选择 <span className="font-semibold text-foreground">{uploadedFiles.length}</span> 张
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        uploadedFiles.forEach((f) => URL.revokeObjectURL(f.preview));
                        setUploadedFiles([]);
                      }}
                      className="text-muted-foreground hover:text-red-400"
                    >
                      清空
                    </Button>
                  </div>

                  <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto">
                    {uploadedFiles.map((item, index) => (
                      <div key={index} className="relative aspect-square rounded-lg overflow-hidden group">
                        <Image
                          src={item.preview}
                          alt={item.file.name}
                          fill
                          className="object-cover"
                        />
                        <button
                          onClick={() => handleRemoveFile(index)}
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <Button
                    onClick={handleAddDirectToStaging}
                    disabled={disabled}
                    className="w-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    添加 {uploadedFiles.length} 张到备料台
                  </Button>
                </div>
              )}

              {uploadedFiles.length === 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-tiktok-cyan/5 border border-tiktok-cyan/20">
                  <Zap className="h-4 w-4 text-tiktok-cyan flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    <span className="text-tiktok-cyan font-medium">批量模式</span>：一次上传多张图片，全部自动加入备料台等待批量处理。
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ============================================ */}
          {/* Tab: Nano Banana (Multi-select) */}
          {/* ============================================ */}
          <TabsContent value="nanoBanana" className="mt-0 h-full">
            <div className="space-y-4">
              {/* Upload Area */}
              {!nanoBananaFile && (
                <label
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleNanoBananaDrop}
                  className={cn(
                    "flex flex-col items-center justify-center cursor-pointer",
                    "min-h-[150px] rounded-xl border-2 border-dashed",
                    "transition-all duration-300",
                    isDragging
                      ? "border-tiktok-pink bg-tiktok-pink/10 scale-[1.02]"
                      : "border-white/20 hover:border-tiktok-pink/50 hover:bg-white/5",
                    disabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleNanoBananaUpload(file);
                      e.target.value = "";
                    }}
                    className="hidden"
                    disabled={disabled}
                  />
                  <div className="flex flex-col items-center gap-3 p-4">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-tiktok-pink/20 to-purple-500/20 flex items-center justify-center">
                      <Sparkles className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium">上传原图进行 AI 增强</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Nano Banana {nanoBananaVersion} 生成 9 个角度
                      </p>
                    </div>
                  </div>
                </label>
              )}

              {/* Uploaded Preview */}
              {nanoBananaFile && !showGridSelector && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="h-20 w-20 rounded-lg overflow-hidden flex-shrink-0">
                      <img
                        src={nanoBananaPreview!}
                        alt={nanoBananaFile.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{nanoBananaFile.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {(nanoBananaFile.size / 1024).toFixed(1)} KB
                      </p>

                      <div className="flex items-center gap-2 mt-3">
                        {isProcessing ? (
                          <div className="flex items-center gap-2 text-tiktok-pink">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-sm">Processing...</span>
                          </div>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={handleStartProcessing}
                              className="bg-gradient-to-r from-tiktok-pink to-purple-500 text-white"
                            >
                              <Grid3X3 className="h-4 w-4 mr-1" />
                              生成九宫格
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleCancelNanoBanana}
                            >
                              取消
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {isProcessing && (
                    <div className="p-4 rounded-xl bg-tiktok-pink/5 border border-tiktok-pink/20">
                      <div className="flex items-center gap-3">
                        <div className="relative h-10 w-10">
                          <div className="absolute inset-0 rounded-full border-2 border-tiktok-pink/30" />
                          <div className="absolute inset-0 rounded-full border-2 border-tiktok-pink border-t-transparent animate-spin" />
                        </div>
                        <div>
                          <p className="font-medium text-tiktok-pink">Nano Banana AI 处理中</p>
                          <p className="text-xs text-muted-foreground">
                            生成多角度产品图...
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!nanoBananaFile && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-tiktok-pink/5 border border-tiktok-pink/20">
                  <Sparkles className="h-4 w-4 text-tiktok-pink flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    <span className="text-tiktok-pink font-medium">增强模式</span>：上传一张原图，AI 生成 9 个角度，你可以<strong>多选</strong>需要的图片批量加入备料台。
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </CardContent>
      </Tabs>

      {/* ============================================ */}
      {/* Grid Selector Dialog (Multi-select) */}
      {/* ============================================ */}
      <Dialog open={showGridSelector} onOpenChange={setShowGridSelector}>
        <DialogContent className="max-w-4xl bg-black/95 border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Grid3X3 className="h-5 w-5 text-tiktok-pink" />
              选择多个角度 (Multi-Select)
            </DialogTitle>
            <DialogDescription>
              点击选择多张图片，它们将全部加入备料台进行批量处理
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3 my-4">
            {processedImages.map((img, index) => (
              <button
                key={index}
                onClick={() => handleToggleSelect(index)}
                className={cn(
                  "relative aspect-square rounded-xl overflow-hidden",
                  "border-2 transition-all duration-200",
                  img.selected
                    ? "border-tiktok-pink shadow-[0_0_20px_rgba(255,0,80,0.3)] scale-[1.02]"
                    : "border-white/10 hover:border-white/30"
                )}
              >
                <img
                  src={img.url}
                  alt={img.angle}
                  className="w-full h-full object-cover"
                />

                {img.selected && (
                  <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-tiktok-pink flex items-center justify-center">
                    <Check className="h-4 w-4 text-white" />
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
                  <p className="text-xs font-medium">{img.angle}</p>
                </div>
              </button>
            ))}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                {processedImages.every((img) => img.selected) ? "取消全选" : "全选 9 张"}
              </Button>
              <span className="text-sm text-muted-foreground">
                已选择 <span className="font-semibold text-tiktok-pink">{selectedCount}</span> 张
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowGridSelector(false)} className="border-white/10">
                取消
              </Button>
              <Button
                onClick={handleConfirmSelection}
                disabled={selectedCount === 0}
                className="bg-gradient-to-r from-tiktok-pink to-purple-500 text-white font-semibold"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                添加 {selectedCount} 张到备料台
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default ResourceInputBatch;

