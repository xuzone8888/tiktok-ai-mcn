"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Upload, 
  Image as ImageIcon, 
  X, 
  Loader2, 
  Sparkles,
  CheckCircle2,
  Grid3X3
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";

interface UploadProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadSuccess?: (product: Product) => void;
}

type UploadStep = "idle" | "uploading" | "analyzing" | "generating" | "complete";

const stepMessages: Record<UploadStep, { title: string; description: string }> = {
  idle: { title: "", description: "" },
  uploading: { title: "Uploading image...", description: "正在上传您的产品图片" },
  analyzing: { title: "AI is analyzing product structure...", description: "正在分析产品结构和特征" },
  generating: { title: "Generating 9-grid angles...", description: "正在生成多角度九宫格图集" },
  complete: { title: "Processing complete!", description: "产品已添加到您的素材库" },
};

export function UploadProductDialog({
  open,
  onOpenChange,
  onUploadSuccess,
}: UploadProductDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [step, setStep] = useState<UploadStep>("idle");
  const [progress, setProgress] = useState(0);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
      // Auto-fill product name from filename
      const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, "");
      setProductName(nameWithoutExt);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp"],
    },
    maxFiles: 1,
    disabled: step !== "idle",
  });

  const clearFile = () => {
    setFile(null);
    setPreview(null);
    setProductName("");
  };

  const handleUpload = async () => {
    if (!file || !productName.trim()) return;

    try {
      // Step 1: Uploading
      setStep("uploading");
      setProgress(0);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", productName.trim());

      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch("/api/products/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();

      // Step 2: Analyzing
      setStep("analyzing");
      setProgress(0);
      
      // Simulate analysis progress
      await simulateProgress(2000);

      // Step 3: Generating
      setStep("generating");
      setProgress(0);

      // Poll for completion or wait for mock processing
      await pollForCompletion(data.product.id);

      // Step 4: Complete
      setStep("complete");
      setProgress(100);

      // Notify parent
      if (onUploadSuccess) {
        onUploadSuccess(data.product);
      }

      // Auto close after success
      setTimeout(() => {
        handleClose();
      }, 1500);

    } catch (error) {
      console.error("Upload error:", error);
      setStep("idle");
      setProgress(0);
    }
  };

  const simulateProgress = (duration: number) => {
    return new Promise<void>((resolve) => {
      const steps = 10;
      const stepDuration = duration / steps;
      let currentStep = 0;

      const interval = setInterval(() => {
        currentStep++;
        setProgress((currentStep / steps) * 100);
        if (currentStep >= steps) {
          clearInterval(interval);
          resolve();
        }
      }, stepDuration);
    });
  };

  const pollForCompletion = async (productId: string) => {
    const maxAttempts = 15;
    const pollInterval = 500;

    for (let i = 0; i < maxAttempts; i++) {
      setProgress((i / maxAttempts) * 100);
      
      try {
        const response = await fetch(`/api/products/${productId}`);
        if (response.ok) {
          const product = await response.json();
          if (product.status === "ready" && product.processed_images) {
            return product;
          }
        }
      } catch (error) {
        console.error("Poll error:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Even if polling times out, continue (mock will complete server-side)
    return null;
  };

  const handleClose = () => {
    // Prevent closing during upload (allow closing when idle or complete)
    if (step !== "idle" && step !== "complete") return;
    setFile(null);
    setPreview(null);
    setProductName("");
    setStep("idle");
    setProgress(0);
    onOpenChange(false);
  };

  const showProgressUI = step === "uploading" || step === "analyzing" || step === "generating" || step === "complete";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] bg-card border-border/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-tiktok-cyan" />
            Upload Product
          </DialogTitle>
          <DialogDescription>
            上传产品图片，AI 将自动生成多角度九宫格展示图
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Processing Status */}
          {showProgressUI && (
            <div className="rounded-xl border border-border/50 bg-gradient-to-br from-tiktok-cyan/5 to-tiktok-pink/5 p-6">
              <div className="flex flex-col items-center text-center space-y-4">
                {step === "complete" ? (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  </div>
                ) : (
                  <div className="relative">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20">
                      {step === "generating" ? (
                        <Grid3X3 className="h-8 w-8 text-tiktok-cyan animate-pulse" />
                      ) : (
                        <Sparkles className="h-8 w-8 text-tiktok-cyan animate-pulse" />
                      )}
                    </div>
                    <Loader2 className="absolute -inset-2 h-20 w-20 text-tiktok-cyan animate-spin opacity-30" />
                  </div>
                )}

                <div>
                  <h3 className="font-semibold text-lg">
                    {stepMessages[step].title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {stepMessages[step].description}
                  </p>
                </div>

                {/* Progress Bar */}
                <div className="w-full">
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {Math.round(progress)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Upload Area - Only show when idle */}
          {step === "idle" && (
            <>
              {/* Dropzone */}
              <div
                {...getRootProps()}
                className={cn(
                  "relative rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer",
                  isDragActive
                    ? "border-tiktok-cyan bg-tiktok-cyan/5"
                    : "border-border/50 hover:border-tiktok-cyan/50 hover:bg-white/5",
                  preview && "border-solid"
                )}
              >
                <input {...getInputProps()} />

                {preview ? (
                  <div className="relative aspect-video">
                    <img
                      src={preview}
                      alt="Preview"
                      className="w-full h-full object-contain rounded-lg"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/50 hover:bg-black/70"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFile();
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20 mb-4">
                      <ImageIcon className="h-7 w-7 text-tiktok-cyan" />
                    </div>
                    <p className="text-sm font-medium">
                      {isDragActive ? "释放以上传" : "拖拽图片到此处"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      或点击选择文件 (PNG, JPG, WEBP)
                    </p>
                  </div>
                )}
              </div>

              {/* Product Name Input */}
              {file && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">产品名称</label>
                  <Input
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="输入产品名称..."
                    className="bg-muted/50 border-border/50"
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        {step === "idle" && (
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={handleClose}>
              取消
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!file || !productName.trim()}
              className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold hover:opacity-90"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              开始处理
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

