"use client";

import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Upload,
  ImagePlus,
  X,
  Check,
  Loader2,
  FileImage,
} from "lucide-react";

// ============================================================================
// 类型定义
// ============================================================================

export interface DirectUploadProps {
  onUpload: (files: File[]) => void;
  disabled?: boolean;
  maxFiles?: number;
  acceptedTypes?: string[];
}

interface PreviewFile {
  file: File;
  preview: string;
  id: string;
}

// ============================================================================
// Direct Upload 组件
// ============================================================================

export function DirectUpload({
  onUpload,
  disabled = false,
  maxFiles = 10,
  acceptedTypes = ["image/jpeg", "image/png", "image/webp"],
}: DirectUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previews, setPreviews] = useState<PreviewFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 处理文件选择
  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(
      (file) => acceptedTypes.includes(file.type)
    ).slice(0, maxFiles);

    if (fileArray.length === 0) return;

    // 创建预览
    const newPreviews: PreviewFile[] = fileArray.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      id: `${file.name}-${Date.now()}-${Math.random()}`,
    }));

    setPreviews((prev) => [...prev, ...newPreviews].slice(0, maxFiles));
  }, [acceptedTypes, maxFiles]);

  // 拖拽处理
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
    handleFiles(e.dataTransfer.files);
  }, [disabled, handleFiles]);

  // 点击上传
  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  // 文件输入改变
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  }, [handleFiles]);

  // 移除预览
  const handleRemovePreview = useCallback((id: string) => {
    setPreviews((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  // 确认添加到备料台
  const handleConfirm = useCallback(() => {
    if (previews.length === 0) return;
    
    setIsUploading(true);
    
    // 模拟上传延迟
    setTimeout(() => {
      onUpload(previews.map((p) => p.file));
      // 清理预览
      previews.forEach((p) => URL.revokeObjectURL(p.preview));
      setPreviews([]);
      setIsUploading(false);
    }, 500);
  }, [previews, onUpload]);

  // 清空所有
  const handleClearAll = useCallback(() => {
    previews.forEach((p) => URL.revokeObjectURL(p.preview));
    setPreviews([]);
  }, [previews]);

  return (
    <div className="space-y-4">
      {/* 拖拽上传区域 */}
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
            ? "border-tiktok-cyan bg-tiktok-cyan/10 scale-[1.02]"
            : "border-white/20 hover:border-tiktok-cyan/50 hover:bg-white/5",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(",")}
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
            "bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20",
            "border border-white/10"
          )}>
            <Upload className={cn(
              "h-8 w-8",
              isDragging ? "text-tiktok-cyan" : "text-muted-foreground"
            )} />
          </div>
          
          <div className="text-center">
            <p className="text-lg font-medium">
              {isDragging ? "释放以上传" : "拖拽图片到此处"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              或点击选择文件 · 支持 JPG, PNG, WebP · 最多 {maxFiles} 张
            </p>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            className="border-tiktok-cyan/50 text-tiktok-cyan hover:bg-tiktok-cyan/10"
            disabled={disabled}
          >
            <ImagePlus className="h-4 w-4 mr-2" />
            选择图片
          </Button>
        </div>
      </div>

      {/* 预览区域 */}
      {previews.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              已选择 <span className="font-semibold text-foreground">{previews.length}</span> 张图片
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="text-muted-foreground hover:text-red-400"
            >
              <X className="h-4 w-4 mr-1" />
              清空
            </Button>
          </div>

          {/* 预览网格 */}
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
            {previews.map((preview) => (
              <div
                key={preview.id}
                className="relative aspect-square rounded-lg overflow-hidden group"
              >
                <img
                  src={preview.preview}
                  alt={preview.file.name}
                  className="w-full h-full object-cover"
                />
                {/* 删除按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemovePreview(preview.id);
                  }}
                  className={cn(
                    "absolute top-1 right-1 h-6 w-6 rounded-full",
                    "bg-black/70 flex items-center justify-center",
                    "opacity-0 group-hover:opacity-100 transition-opacity",
                    "hover:bg-red-500"
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
                {/* 文件名 */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1">
                  <p className="text-[10px] truncate">{preview.file.name}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 确认按钮 */}
          <Button
            onClick={handleConfirm}
            disabled={isUploading || disabled}
            className="w-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                添加中...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                添加 {previews.length} 张图片到备料台
              </>
            )}
          </Button>
        </div>
      )}

      {/* 提示信息 */}
      {previews.length === 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-tiktok-cyan/5 border border-tiktok-cyan/20">
          <FileImage className="h-4 w-4 text-tiktok-cyan flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            <span className="text-tiktok-cyan font-medium">Fast Mode</span>: 直接上传已处理好的图片，跳过 AI 增强步骤，快速进入视频生成流程。
          </p>
        </div>
      )}
    </div>
  );
}

export default DirectUpload;

