"use client";

import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  Loader2,
  Check,
  X,
  ImagePlus,
  Grid3X3,
  CheckCircle2,
} from "lucide-react";

// ============================================================================
// 类型定义
// ============================================================================

export interface NanoBananaEnhanceProps {
  version: "V1" | "V2";
  onSelect: (images: { url: string; name: string }[]) => void;
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
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&h=300&fit=crop",
    "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&h=300&fit=crop",
    "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=300&h=300&fit=crop",
    "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=300&h=300&fit=crop",
    "https://images.unsplash.com/photo-1560343090-f0409e92791a?w=300&h=300&fit=crop",
    "https://images.unsplash.com/photo-1491553895911-0055uj-8b8be?w=300&h=300&fit=crop",
    "https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=300&h=300&fit=crop",
    "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=300&h=300&fit=crop",
    "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=300&h=300&fit=crop",
  ];

  return ANGLE_NAMES.map((angle, index) => ({
    url: baseUrls[index % baseUrls.length] + `&sig=${Date.now()}-${index}`,
    name: `${originalName.replace(/\.[^.]+$/, "")}_${angle.split(" ")[0]}.jpg`,
    angle,
    selected: false,
  }));
}

// ============================================================================
// Nano Banana Enhance 组件
// ============================================================================

export function NanoBananaEnhance({
  version,
  onSelect,
  disabled = false,
}: NanoBananaEnhanceProps) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedImages, setProcessedImages] = useState<ProcessedImage[]>([]);
  const [showSelectionGrid, setShowSelectionGrid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 处理文件上传
  const handleFileUpload = useCallback((file: File) => {
    const preview = URL.createObjectURL(file);
    setUploadedFile(file);
    setUploadedPreview(preview);
  }, []);

  // 拖拽处理
  const [isDragging, setIsDragging] = useState(false);

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
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleFileUpload(file);
    }
  }, [disabled, handleFileUpload]);

  // 点击上传
  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  // 开始 Nano Banana 处理
  const handleStartProcessing = useCallback(() => {
    if (!uploadedFile) return;

    setIsProcessing(true);

    // 模拟 3 秒处理时间
    setTimeout(() => {
      const mockImages = generateMockGridImages(uploadedFile.name);
      setProcessedImages(mockImages);
      setIsProcessing(false);
      setShowSelectionGrid(true);
    }, 3000);
  }, [uploadedFile]);

  // 切换选择
  const handleToggleSelect = useCallback((index: number) => {
    setProcessedImages((prev) =>
      prev.map((img, i) =>
        i === index ? { ...img, selected: !img.selected } : img
      )
    );
  }, []);

  // 全选/取消全选
  const handleSelectAll = useCallback(() => {
    const allSelected = processedImages.every((img) => img.selected);
    setProcessedImages((prev) =>
      prev.map((img) => ({ ...img, selected: !allSelected }))
    );
  }, [processedImages]);

  // 确认选择
  const handleConfirmSelection = useCallback(() => {
    const selected = processedImages.filter((img) => img.selected);
    if (selected.length === 0) return;

    onSelect(selected.map((img) => ({ url: img.url, name: img.name })));
    
    // 重置状态
    setShowSelectionGrid(false);
    setProcessedImages([]);
    if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
    setUploadedFile(null);
    setUploadedPreview(null);
  }, [processedImages, onSelect, uploadedPreview]);

  // 取消/重置
  const handleCancel = useCallback(() => {
    if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
    setUploadedFile(null);
    setUploadedPreview(null);
    setProcessedImages([]);
    setShowSelectionGrid(false);
    setIsProcessing(false);
  }, [uploadedPreview]);

  const selectedCount = processedImages.filter((img) => img.selected).length;

  return (
    <div className="space-y-4">
      {/* 上传区域 */}
      {!uploadedFile && (
        <div
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative flex flex-col items-center justify-center",
            "min-h-[200px] rounded-xl border-2 border-dashed",
            "transition-all duration-300 cursor-pointer",
            isDragging
              ? "border-tiktok-pink bg-tiktok-pink/10 scale-[1.02]"
              : "border-white/20 hover:border-tiktok-pink/50 hover:bg-white/5",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleInputChange}
            className="hidden"
            disabled={disabled}
          />
          
          <div className={cn(
            "flex flex-col items-center gap-4 p-6",
            isDragging && "scale-110 transition-transform"
          )}>
            <div className={cn(
              "h-16 w-16 rounded-2xl flex items-center justify-center",
              "bg-gradient-to-br from-tiktok-pink/20 to-purple-500/20",
              "border border-white/10"
            )}>
              <Sparkles className={cn(
                "h-8 w-8",
                isDragging ? "text-tiktok-pink" : "text-muted-foreground"
              )} />
            </div>
            
            <div className="text-center">
              <p className="text-lg font-medium">
                {isDragging ? "释放以上传" : "上传原图进行 AI 增强"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Nano Banana {version} 将生成 9 个角度的产品图
              </p>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              className="border-tiktok-pink/50 text-tiktok-pink hover:bg-tiktok-pink/10"
              disabled={disabled}
            >
              <ImagePlus className="h-4 w-4 mr-2" />
              选择原图
            </Button>
          </div>
        </div>
      )}

      {/* 已上传图片预览 */}
      {uploadedFile && !showSelectionGrid && (
        <div className="space-y-4">
          <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="relative w-32 h-32 rounded-lg overflow-hidden flex-shrink-0">
              <img
                src={uploadedPreview!}
                alt={uploadedFile.name}
                className="w-full h-full object-cover"
              />
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{uploadedFile.name}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {(uploadedFile.size / 1024).toFixed(1)} KB
              </p>
              
              <div className="flex items-center gap-2 mt-4">
                {isProcessing ? (
                  <div className="flex items-center gap-2 text-tiktok-pink">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Processing with Nano Banana {version}...</span>
                  </div>
                ) : (
                  <>
                    <Button
                      onClick={handleStartProcessing}
                      className="bg-gradient-to-r from-tiktok-pink to-purple-500 text-white font-semibold"
                    >
                      <Grid3X3 className="h-4 w-4 mr-2" />
                      生成九宫格
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancel}
                      className="text-muted-foreground"
                    >
                      <X className="h-4 w-4 mr-1" />
                      取消
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 处理进度 */}
          {isProcessing && (
            <div className="p-4 rounded-xl bg-tiktok-pink/5 border border-tiktok-pink/20">
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-12">
                  <div className="absolute inset-0 rounded-full border-2 border-tiktok-pink/30" />
                  <div className="absolute inset-0 rounded-full border-2 border-tiktok-pink border-t-transparent animate-spin" />
                  <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-tiktok-pink" />
                </div>
                <div>
                  <p className="font-medium text-tiktok-pink">Nano Banana AI 正在处理</p>
                  <p className="text-sm text-muted-foreground">
                    分析产品结构，生成多角度视图...
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 九宫格选择器 Dialog */}
      <Dialog open={showSelectionGrid} onOpenChange={setShowSelectionGrid}>
        <DialogContent className="max-w-4xl bg-black/95 border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Grid3X3 className="h-5 w-5 text-tiktok-pink" />
              Selection Grid - 选择要使用的角度
            </DialogTitle>
            <DialogDescription>
              Nano Banana AI 已生成 9 个角度。点击选择你需要的图片，它们将被添加到备料台。
            </DialogDescription>
          </DialogHeader>

          {/* 九宫格 */}
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
                
                {/* 选中指示器 */}
                {img.selected && (
                  <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-tiktok-pink flex items-center justify-center">
                    <Check className="h-4 w-4 text-white" />
                  </div>
                )}
                
                {/* 角度标签 */}
                <div className={cn(
                  "absolute bottom-0 left-0 right-0 px-2 py-1.5",
                  "bg-gradient-to-t from-black/80 to-transparent"
                )}>
                  <p className="text-xs font-medium">{img.angle}</p>
                </div>

                {/* 悬停效果 */}
                <div className={cn(
                  "absolute inset-0 bg-tiktok-pink/20 opacity-0 transition-opacity",
                  !img.selected && "hover:opacity-100"
                )} />
              </button>
            ))}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                className="text-muted-foreground"
              >
                {processedImages.every((img) => img.selected) ? "取消全选" : "全选"}
              </Button>
              
              <span className="text-sm text-muted-foreground">
                已选择 <span className="font-semibold text-tiktok-pink">{selectedCount}</span> 张
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowSelectionGrid(false)}
                className="border-white/10"
              >
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

      {/* 提示信息 */}
      {!uploadedFile && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-tiktok-pink/5 border border-tiktok-pink/20">
          <Sparkles className="h-4 w-4 text-tiktok-pink flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            <span className="text-tiktok-pink font-medium">Enhance Mode</span>: 上传单张原图，Nano Banana AI 将自动生成 9 个角度的产品图，你可以选择其中几张用于视频生成。
          </p>
        </div>
      )}
    </div>
  );
}

export default NanoBananaEnhance;

