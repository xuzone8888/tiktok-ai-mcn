"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { 
  Grid3X3, 
  Download, 
  Copy, 
  ExternalLink, 
  Calendar,
  Tag,
  Image as ImageIcon,
  Loader2,
  CheckCircle2,
  Clock,
  Sparkles,
  Play
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";

interface ProductDetailSheetProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusConfig = {
  pending: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted", label: "待处理" },
  processing: { icon: Loader2, color: "text-amber-500", bg: "bg-amber-500/10", label: "处理中" },
  ready: { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "已完成" },
  failed: { icon: Clock, color: "text-red-500", bg: "bg-red-500/10", label: "处理失败" },
};

export function ProductDetailSheet({
  product,
  open,
  onOpenChange,
}: ProductDetailSheetProps) {
  if (!product) return null;

  const status = statusConfig[product.status];
  const StatusIcon = status.icon;
  const hasProcessedImages = (product.processed_images?.grid_images?.length ?? 0) > 0;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    // TODO: Show toast notification
  };

  const handleDownload = (url: string, index: number) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${product.name}-${index + 1}.jpg`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[600px] overflow-y-auto bg-card border-border/50">
        <SheetHeader className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <SheetTitle className="text-xl">{product.name}</SheetTitle>
              <SheetDescription className="flex items-center gap-2 mt-2">
                <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium", status.bg, status.color)}>
                  <StatusIcon className={cn("h-3 w-3", product.status === "processing" && "animate-spin")} />
                  {status.label}
                </div>
                {product.category && (
                  <span className="text-xs text-muted-foreground">
                    {product.category}
                  </span>
                )}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Original Image */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-tiktok-cyan" />
              原始图片
            </h3>
            <div className="relative aspect-video rounded-xl overflow-hidden border border-border/50 bg-black/20">
              <img
                src={product.original_image_url}
                alt={product.name}
                className="w-full h-full object-contain"
              />
              <div className="absolute bottom-2 right-2 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 bg-black/50 hover:bg-black/70 backdrop-blur-sm"
                  onClick={() => handleCopyUrl(product.original_image_url)}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  复制链接
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 bg-black/50 hover:bg-black/70 backdrop-blur-sm"
                  onClick={() => window.open(product.original_image_url, "_blank")}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* 9-Grid Images */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Grid3X3 className="h-4 w-4 text-tiktok-pink" />
              AI 九宫格图集
              {hasProcessedImages && (
                <span className="text-xs text-muted-foreground">
                  ({product.processed_images!.grid_images.length} 张)
                </span>
              )}
            </h3>

            {product.status === "processing" ? (
              <div className="rounded-xl border border-border/50 bg-gradient-to-br from-tiktok-cyan/5 to-tiktok-pink/5 p-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="relative">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20">
                      <Sparkles className="h-8 w-8 text-tiktok-cyan animate-pulse" />
                    </div>
                    <Loader2 className="absolute -inset-2 h-20 w-20 text-tiktok-cyan animate-spin opacity-30" />
                  </div>
                  <div>
                    <p className="font-medium">AI 正在生成中...</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      正在分析产品结构并生成多角度展示图
                    </p>
                  </div>
                </div>
              </div>
            ) : hasProcessedImages ? (
              <div className="grid grid-cols-3 gap-2">
                {product.processed_images!.grid_images.map((url, index) => (
                  <div
                    key={index}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border/50 bg-black/20 cursor-pointer hover:border-tiktok-cyan/50 transition-all"
                  >
                    <img
                      src={url}
                      alt={`${product.name} - ${index + 1}`}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-white hover:bg-white/20"
                        onClick={() => handleDownload(url, index)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-white hover:bg-white/20"
                        onClick={() => window.open(url, "_blank")}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="absolute top-1 left-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded">
                      {index + 1}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
                <Grid3X3 className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">暂无生成的图集</p>
              </div>
            )}
          </div>

          {/* Tags */}
          {product.tags && product.tags.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                标签
              </h3>
              <div className="flex flex-wrap gap-2">
                {product.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="px-2.5 py-1 rounded-full bg-white/5 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Meta Info */}
          <div className="rounded-xl border border-border/50 p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                上传时间
              </span>
              <span>{formatDate(product.created_at)}</span>
            </div>
            {product.processed_images?.processed_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  处理完成
                </span>
                <span>{formatDate(product.processed_images.processed_at)}</span>
              </div>
            )}
            {product.usage_count !== undefined && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Play className="h-4 w-4" />
                  使用次数
                </span>
                <span>{product.usage_count} 次</span>
              </div>
            )}
          </div>

          {/* Actions */}
          {hasProcessedImages && (
            <div className="flex gap-3">
              <Button
                className="flex-1 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold hover:opacity-90"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                使用此产品创作
              </Button>
              <Button variant="outline" className="border-border/50 hover:bg-white/5">
                <Download className="mr-2 h-4 w-4" />
                下载全部
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

