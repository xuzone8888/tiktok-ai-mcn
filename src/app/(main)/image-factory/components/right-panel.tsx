"use client";

/**
 * 右侧面板 - 结果预览 (JCUI 2.0 Titanium Edition)
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
  Sparkles
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

// 状态颜色配置
const STATUS_BADGES = {
  pending: { variant: "secondary" as const, label: "PENDING", className: "bg-white/10 text-white/60 border-white/10" },
  processing: { variant: "default" as const, label: "GENERATING", className: "bg-mermaid-cyan/10 text-mermaid-cyan border-mermaid-cyan/20 animate-pulse" },
  completed: { variant: "default" as const, label: "DONE", className: "bg-neon-green/10 text-neon-green border-neon-green/20" },
  failed: { variant: "destructive" as const, label: "FAILED", className: "bg-neon-red/10 text-neon-red border-neon-red/20" },
};

export function RightPanel() {
  const { currentMode, currentTask, uploadedImages, isGeneratingImages } = useImageFactoryStore();
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>("");
  const [selectedImage, setSelectedImage] = useState<OutputItem | null>(null);

  const modeConfig = ECOM_MODE_CONFIG[currentMode];
  const outputItems = (currentTask?.output_items || []) as OutputItem[];

  // 仅显示已生成的图片用于显示列表（排除 generating_prompts 阶段的空项，如果有的话）
  const results = outputItems;

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

      toast.success("Saved to Downloads");
    } catch {
      toast.error("Download Failed");
    }
  };

  // 打包下载所有图片
  const handleDownloadAll = async () => {
    const completedItems = outputItems.filter(item => item.status === "completed" && item.url);

    if (completedItems.length === 0) {
      toast.error("No images available to download");
      return;
    }

    // 逐个下载
    for (let i = 0; i < completedItems.length; i++) {
      const item = completedItems[i];
      if (item.url) {
        await handleDownload(item.url, `${item.label || item.type}_${i + 1}.png`);
      }
    }

    toast.success(`Started downloading ${completedItems.length} images`);
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
    <div className="flex flex-col h-full bg-[#16181D]/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
      {/* 标题 */}
      <div className="p-3 border-b border-white/5 flex items-center justify-between bg-white/5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-mermaid-cyan/70" />
          <span className="font-bold text-white tracking-wide text-xs">输出画廊</span>
        </div>
        {(results.length > 0 || isGeneratingImages) && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleDownloadAll} className="h-7 text-xs text-white/60 hover:text-white hover:bg-white/10">
              <Download className="h-3 w-3 mr-1" />
              BATCH SAVE
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 h-full flex flex-col">
          {results.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
              {isGeneratingImages ? (
                // 生成中 - Neon Pulse
                <div className="relative">
                  <div className="absolute inset-0 bg-mermaid-cyan/20 blur-xl rounded-full animate-pulse" />
                  <Loader2 className="h-10 w-10 text-mermaid-cyan animate-spin relative z-10" />
                  <p className="mt-3 text-xs font-bold text-mermaid-cyan animate-pulse">GENERATING ASSETS...</p>
                </div>
              ) : (
                // 空状态 - Aurora Hero
                <div className="relative group p-6 rounded-2xl border border-white/5 bg-gradient-to-br from-white/5 to-transparent overflow-hidden max-w-xs mx-auto">
                  <div className="absolute inset-0 bg-gradient-to-br from-mermaid-cyan/5 via-mermaid-pink/5 to-mermaid-lime/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative z-10 space-y-4">
                    <div className="h-14 w-14 rounded-xl bg-[#0B0C10] border border-white/10 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(0,0,0,0.2)] group-hover:scale-110 transition-transform duration-500">
                      <div className="absolute inset-0 bg-gradient-to-br from-mermaid-cyan/20 to-mermaid-pink/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl" />
                      <ImageIcon className="h-6 w-6 text-white/20 group-hover:text-white transition-colors" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white mb-1">准备就绪</h3>
                      <p className="text-[10px] text-white/40 max-w-[180px] mx-auto leading-relaxed">
                        请配置参数并启动流水线以生成素材。
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // 结果列表 - Titanium Cards
            <div className="grid grid-cols-1 gap-3 animate-in fade-in slide-in-from-bottom-4">
              {results.map((item, index) => {
                const badgeConfig = STATUS_BADGES[item.status as keyof typeof STATUS_BADGES] || STATUS_BADGES.pending;

                return (
                  <div
                    key={`${item.type}-${index}`}
                    className="group relative bg-[#0B0C10] border border-white/5 rounded-2xl overflow-hidden hover:border-mermaid-cyan/30 transition-all duration-300 shadow-lg hover:shadow-[0_0_30px_rgba(0,0,0,0.3)]"
                  >
                    <div className="flex gap-3 p-3">
                      {/* 图片预览 */}
                      <div
                        className="relative w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-black/50 cursor-pointer"
                        onClick={() => item.url && handlePreview(item.url, item.label || "")}
                      >
                        {item.url ? (
                          <img
                            src={item.url}
                            alt={`Result ${index + 1}`}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full w-full">
                            <Loader2 className="h-6 w-6 text-white/20 animate-spin" />
                          </div>
                        )}

                        {item.url && (
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <Eye className="h-6 w-6 text-white drop-shadow-md" />
                          </div>
                        )}
                      </div>

                      {/* 信息 */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-bold text-white truncate max-w-[120px]">
                              {item.label || item.type || `ASSET_${String(index + 1).padStart(3, '0')}`}
                            </span>
                            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5", badgeConfig.className)}>
                              {badgeConfig.label}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-white/40 font-mono truncate">
                            {new Date().toLocaleTimeString()} · HQ
                          </p>
                        </div>

                        <div className="flex items-center gap-2 mt-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!item.url}
                            className="flex-1 h-8 text-xs bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/5"
                            onClick={() => item.url && handlePreview(item.url, item.label || "")}
                          >
                            <Eye className="h-3 w-3 mr-1.5" /> PREVIEW
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!item.url}
                            className="flex-1 h-8 text-xs bg-mermaid-cyan/10 hover:bg-mermaid-cyan/20 text-mermaid-cyan hover:text-white border border-mermaid-cyan/20"
                            onClick={() => item.url && handleDownload(item.url, `${item.label || item.type}.png`)}
                          >
                            <Download className="h-3 w-3 mr-1.5" /> SAVE
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 底部：摘要信息 (仅在有任务时显示) */}
      {currentTask && (
        <div className="p-3 border-t border-white/5 bg-[#0B0C10]/50 backdrop-blur-md">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider block mb-1">Task Context</span>
              <div className="text-xs text-white font-medium flex items-center gap-1.5">
                <div className="p-1 rounded bg-white/10">
                  <Sparkles className="h-3 w-3 text-mermaid-lime" />
                </div>
                {modeConfig.title}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider block mb-1">Total Cost</span>
              <div className="text-xs text-mermaid-cyan font-mono font-bold">
                -{currentTask.credits_cost} PTS
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 图片预览对话框 */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl bg-[#16181D]/95 backdrop-blur-xl border-white/10 p-0 overflow-hidden shadow-2xl">
          <DialogHeader className="px-6 py-4 border-b border-white/5 bg-white/5">
            <DialogTitle className="text-white font-bold flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-mermaid-cyan" />
              {previewTitle || "Image Preview"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-[#050505] p-4 relative min-h-[400px]">
            {/* 棋盘格背景 */}
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(45deg, #1a1a1a 25%, transparent 25%), linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1a 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px' }} />

            {previewImage && (
              <img
                src={previewImage}
                alt={previewTitle}
                className="max-h-[70vh] w-auto object-contain rounded-lg shadow-2xl relative z-10"
              />
            )}
          </div>
          <div className="p-6 bg-white/5 border-t border-white/5 flex gap-4 justify-end">
            <Button
              variant="ghost"
              className="text-white/60 hover:text-white"
              onClick={() => setPreviewImage(null)}
            >
              Close
            </Button>
            {previewImage && (
              <Button
                className="bg-mermaid-cyan text-black hover:bg-mermaid-cyan/80 font-bold"
                onClick={() => handleDownload(previewImage, `${previewTitle}.png`)}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Asset
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
