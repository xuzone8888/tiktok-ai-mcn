"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Download,
  Share2,
  RotateCcw,
  CheckCircle2,
  Loader2,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Sparkles,
  ExternalLink,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GenerationStatus } from "@/hooks/use-sora-generation";

interface GenerationResultProps {
  status: GenerationStatus;
  progress: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  creditsUsed: number;
  creditsRefunded: number;
  elapsedTime: string;
  onReset: () => void;
  onCancel?: () => void;
}

export function GenerationResult({
  status,
  progress,
  videoUrl,
  thumbnailUrl,
  error,
  creditsUsed,
  creditsRefunded,
  elapsedTime,
  onReset,
  onCancel,
}: GenerationResultProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 处理视频播放
  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  }, [isPlaying]);

  const handleDownload = () => {
    if (videoUrl) {
      const link = document.createElement("a");
      link.href = videoUrl;
      link.download = `tiktok-ai-mcn-video-${Date.now()}.mp4`;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleShare = async () => {
    if (videoUrl) {
      try {
        await navigator.clipboard.writeText(videoUrl);
        // TODO: Show toast
      } catch {
        window.open(videoUrl, "_blank");
      }
    }
  };

  // 处理中状态
  if (status === "creating" || status === "processing") {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
        <div className="p-8">
          <div className="flex flex-col items-center text-center space-y-6">
            {/* Animated loader */}
            <div className="relative">
              <div className="h-24 w-24 rounded-full border-4 border-tiktok-cyan/20" />
              <div 
                className="absolute inset-0 h-24 w-24 rounded-full border-4 border-transparent border-t-tiktok-cyan border-r-tiktok-pink animate-spin"
                style={{ animationDuration: "1.5s" }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-tiktok-cyan animate-pulse" />
              </div>
            </div>

            {/* Progress info */}
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">
                {status === "creating" ? "正在初始化..." : "Sora AI 正在创作中..."}
              </h3>
              <p className="text-sm text-muted-foreground">
                正在使用 Sora 2 生成高质量视频
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-xs space-y-2">
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-tiktok-cyan">{progress}%</span>
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {elapsedTime}
                </span>
              </div>
            </div>

            {/* Steps */}
            <div className="flex items-center gap-6 text-xs text-muted-foreground">
              <div className={cn(
                "flex items-center gap-2",
                progress > 0 && "text-tiktok-cyan"
              )}>
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  progress > 0 ? "bg-tiktok-cyan" : "bg-white/20"
                )} />
                分析脚本
              </div>
              <div className={cn(
                "flex items-center gap-2",
                progress > 30 && "text-tiktok-cyan"
              )}>
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  progress > 30 ? "bg-tiktok-cyan" : "bg-white/20"
                )} />
                生成画面
              </div>
              <div className={cn(
                "flex items-center gap-2",
                progress > 70 && "text-tiktok-cyan"
              )}>
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  progress > 70 ? "bg-tiktok-cyan" : "bg-white/20"
                )} />
                渲染输出
              </div>
            </div>

            {/* Cancel button */}
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                className="text-muted-foreground hover:text-red-500"
              >
                <XCircle className="mr-2 h-4 w-4" />
                取消生成
              </Button>
            )}

            {/* Tips */}
            <div className="text-xs text-muted-foreground bg-white/5 px-4 py-2 rounded-lg">
              💡 视频生成可能需要几分钟，请耐心等待
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // 超时状态
  if (status === "timeout") {
    return (
      <Card className="border-amber-500/50 bg-amber-500/5">
        <div className="p-8">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">生成超时</h3>
              <p className="text-sm text-muted-foreground mt-1">
                视频生成时间超过 10 分钟限制
              </p>
            </div>
            
            {/* 积分退还信息 */}
            {creditsRefunded > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <Coins className="h-4 w-4 text-emerald-500" />
                <span className="text-sm text-emerald-500">
                  已退还 {creditsRefunded} 积分
                </span>
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={onReset} variant="outline">
                <RotateCcw className="mr-2 h-4 w-4" />
                重新开始
              </Button>
              <Button 
                onClick={onReset}
                className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                重试
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // 失败状态
  if (status === "failed" || status === "cancelled") {
    return (
      <Card className="border-red-500/50 bg-red-500/5">
        <div className="p-8">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">
                {status === "cancelled" ? "已取消" : "生成失败"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {error || (status === "cancelled" ? "您已取消本次生成" : "请稍后重试，或联系客服支持")}
              </p>
            </div>

            {/* 积分退还信息 */}
            {creditsRefunded > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <Coins className="h-4 w-4 text-emerald-500" />
                <span className="text-sm text-emerald-500">
                  已退还 {creditsRefunded} 积分
                </span>
              </div>
            )}

            <Button onClick={onReset} variant="outline">
              <RotateCcw className="mr-2 h-4 w-4" />
              重新开始
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // 完成状态
  if (status === "completed" && videoUrl) {
    return (
      <Card className="border-emerald-500/30 bg-card/50 backdrop-blur-sm overflow-hidden">
        {/* Success header */}
        <div className="p-4 border-b border-border/50 bg-emerald-500/5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="font-semibold">生成完成！</h3>
              <p className="text-xs text-muted-foreground">
                视频已成功生成，消耗 {creditsUsed} 积分
              </p>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="p-4">
          <div className="relative aspect-[9/16] max-h-[400px] mx-auto rounded-xl overflow-hidden bg-black">
            <video
              ref={videoRef}
              src={videoUrl}
              poster={thumbnailUrl || undefined}
              className="w-full h-full object-contain"
              muted={isMuted}
              loop
              playsInline
              onClick={() => setIsPlaying(!isPlaying)}
            />
            
            {/* Video controls overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              {!isPlaying && (
                <button
                  onClick={() => setIsPlaying(true)}
                  className="h-16 w-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors"
                >
                  <Play className="h-8 w-8 text-white ml-1" />
                </button>
              )}
            </div>

            {/* Bottom controls */}
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="p-2 rounded-full hover:bg-white/20 transition-colors"
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5 text-white" />
                  ) : (
                    <Play className="h-5 w-5 text-white" />
                  )}
                </button>
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="p-2 rounded-full hover:bg-white/20 transition-colors"
                >
                  {isMuted ? (
                    <VolumeX className="h-5 w-5 text-white" />
                  ) : (
                    <Volume2 className="h-5 w-5 text-white" />
                  )}
                </button>
              </div>
            </div>

            {/* Sora badge */}
            <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/50 text-xs text-white flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-tiktok-cyan" />
              Sora 2
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-border/50">
          <div className="flex gap-3">
            <Button
              onClick={handleDownload}
              className="flex-1 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold"
            >
              <Download className="mr-2 h-4 w-4" />
              下载
            </Button>
            <Button
              onClick={handleShare}
              variant="outline"
              className="border-border/50 hover:bg-white/5"
            >
              <Share2 className="mr-2 h-4 w-4" />
              分享
            </Button>
            <Button
              onClick={() => window.open(videoUrl, "_blank")}
              variant="outline"
              size="icon"
              className="border-border/50 hover:bg-white/5"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>

          <Button
            onClick={onReset}
            variant="ghost"
            className="w-full mt-3 text-muted-foreground hover:text-white"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            创作新内容
          </Button>
        </div>
      </Card>
    );
  }

  // Idle 状态（不应该到这里）
  return null;
}
