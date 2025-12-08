"use client";

/**
 * 右侧面板 - 结果预览
 */

import { useState } from "react";
import { 
  ImageIcon, 
  Download, 
  Eye,
  Package,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useImageFactoryStore } from "@/stores/image-factory-store";
import { ECOM_MODE_CONFIG, type OutputItem } from "@/types/ecom-image";
import { cn } from "@/lib/utils";

// 状态图标
const STATUS_ICONS = {
  pending: Clock,
  processing: Loader2,
  completed: CheckCircle,
  failed: XCircle,
};

// 状态颜色
const STATUS_BADGES = {
  pending: { variant: "secondary" as const, label: "等待中" },
  processing: { variant: "default" as const, label: "生成中" },
  completed: { variant: "default" as const, label: "已完成" },
  failed: { variant: "destructive" as const, label: "失败" },
};

export function RightPanel() {
  const { currentMode, currentTask, uploadedImages } = useImageFactoryStore();
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>("");

  const modeConfig = ECOM_MODE_CONFIG[currentMode];
  const outputItems = (currentTask?.output_items || []) as OutputItem[];

  // 下载单张图片
  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename || "image.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      toast.success("下载成功");
    } catch {
      toast.error("下载失败");
    }
  };

  // 打包下载所有图片
  const handleDownloadAll = async () => {
    const completedItems = outputItems.filter(item => item.status === "completed" && item.url);
    
    if (completedItems.length === 0) {
      toast.error("没有可下载的图片");
      return;
    }

    // 逐个下载
    for (let i = 0; i < completedItems.length; i++) {
      const item = completedItems[i];
      if (item.url) {
        await handleDownload(item.url, `${item.label || item.type}_${i + 1}.png`);
      }
    }

    toast.success(`已下载 ${completedItems.length} 张图片`);
  };

  // 预览图片
  const handlePreview = (url: string, title: string) => {
    setPreviewImage(url);
    setPreviewTitle(title);
  };

  // 获取完成数量
  const completedCount = outputItems.filter(item => item.status === "completed").length;
  const totalCount = outputItems.length;

  return (
    <div className="flex flex-col h-full">
      {/* 标题 */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">生成结果</span>
          {totalCount > 0 && (
            <Badge variant="outline" className="ml-2">
              {completedCount}/{totalCount}
            </Badge>
          )}
        </div>
        {completedCount > 0 && (
          <Button variant="outline" size="sm" onClick={handleDownloadAll}>
            <Package className="h-4 w-4 mr-1" />
            打包下载
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {outputItems.length === 0 ? (
            // 空状态
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg mb-2">等待生成</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                上传产品图片并点击开始，AI 将为您生成
                {modeConfig.title}
              </p>
              
              {/* 预览上传的图片 */}
              {uploadedImages.length > 0 && (
                <div className="mt-6 w-full">
                  <p className="text-sm text-muted-foreground mb-3">已上传的图片：</p>
                  <div className="grid grid-cols-4 gap-2">
                    {uploadedImages.slice(0, 8).map((image, index) => (
                      <div
                        key={image.id}
                        className="aspect-square rounded-lg overflow-hidden border cursor-pointer hover:ring-2 ring-primary"
                        onClick={() => handlePreview(image.url, image.name)}
                      >
                        <img
                          src={image.url}
                          alt={image.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // 结果列表
            <div className="grid grid-cols-2 gap-4">
              {outputItems.map((item, index) => {
                const StatusIcon = STATUS_ICONS[item.status] || Clock;
                const badgeConfig = STATUS_BADGES[item.status] || STATUS_BADGES.pending;

                return (
                  <div
                    key={`${item.type}-${index}`}
                    className="rounded-lg border overflow-hidden"
                  >
                    {/* 图片区域 */}
                    <div className="aspect-square relative bg-muted">
                      {item.status === "completed" && item.url ? (
                        <>
                          <img
                            src={item.url}
                            alt={item.label || item.type}
                            className="w-full h-full object-cover"
                          />
                          {/* 悬浮操作 */}
                          <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button
                              size="icon"
                              variant="secondary"
                              onClick={() => handlePreview(item.url!, item.label || item.type)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="secondary"
                              onClick={() => handleDownload(item.url!, `${item.label || item.type}.png`)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      ) : item.status === "processing" ? (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                          <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
                          <span className="text-sm text-muted-foreground">生成中...</span>
                        </div>
                      ) : item.status === "failed" ? (
                        <div className="w-full h-full flex flex-col items-center justify-center p-4">
                          <XCircle className="h-8 w-8 text-red-500 mb-2" />
                          <span className="text-sm text-red-500 text-center">
                            {item.error || "生成失败"}
                          </span>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Clock className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    {/* 信息区域 */}
                    <div className="p-3 bg-background">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm truncate">
                          {item.label || item.type}
                        </span>
                        <Badge variant={badgeConfig.variant} className="text-xs">
                          {badgeConfig.label}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 底部：摘要信息 */}
      {currentTask && (
        <div className="p-4 border-t bg-muted/30">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">任务模式</span>
              <p className="font-medium">{modeConfig.title}</p>
            </div>
            <div>
              <span className="text-muted-foreground">模型</span>
              <p className="font-medium">
                {currentTask.model_type === "nano-banana-pro" ? "专业版" : "快速版"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">消耗积分</span>
              <p className="font-medium text-primary">{currentTask.credits_cost}</p>
            </div>
            <div>
              <span className="text-muted-foreground">状态</span>
              <p className="font-medium capitalize">
                {currentTask.status === "success" ? "✅ 完成" :
                 currentTask.status === "partial_success" ? "⚠️ 部分完成" :
                 currentTask.status === "failed" ? "❌ 失败" :
                 currentTask.status === "generating_images" ? "🎨 生成中" :
                 currentTask.status === "generating_prompts" ? "✍️ 生成提示词" :
                 "⏳ 准备中"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 图片预览对话框 */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center">
            {previewImage && (
              <img
                src={previewImage}
                alt={previewTitle}
                className="max-h-[70vh] object-contain rounded-lg"
              />
            )}
          </div>
          {previewImage && (
            <div className="flex justify-center gap-2 mt-4">
              <Button
                variant="outline"
                onClick={() => handleDownload(previewImage, `${previewTitle}.png`)}
              >
                <Download className="h-4 w-4 mr-2" />
                下载图片
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

