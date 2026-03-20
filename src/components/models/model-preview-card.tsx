"use client";

import { useState, useRef, useCallback, memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Star,
  TrendingUp,
  Sparkles,
  Play,
  Coins,
  CheckCircle2,
  Volume2,
  VolumeX,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicModel } from "@/lib/actions/models";

interface ModelPreviewCardProps {
  model: PublicModel & { is_hired_by_others?: boolean; hired_count?: number };
  hasActiveContract?: boolean;
  onHire?: () => void;
  onManage?: () => void;
}

export const ModelPreviewCard = memo(function ModelPreviewCard({
  model,
  hasActiveContract = false,
  onHire,
  onManage,
}: ModelPreviewCardProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    if (videoRef.current && model.demo_video_url && !videoError) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {
        setVideoError(true);
      });
    }
  }, [model.demo_video_url, videoError]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMuted(!isMuted);
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
    }
  };

  const hasVideo = model.demo_video_url && !videoError;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0B0C10] transition-all duration-300",
        "hover:shadow-[0_0_40px_-10px_rgba(0,242,234,0.3)]",
        "hover:-translate-y-1",
        hasActiveContract && "ring-1 ring-mermaid-cyan/30"
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Media Container */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#0B0C10]">
        {/* Static Image (default) */}
        {model.avatar_url ? (
          <img
            src={model.avatar_url}
            alt={model.name}
            className={cn(
              "h-full w-full object-cover transition-all duration-500",
              isHovering && hasVideo ? "opacity-0 scale-105" : "opacity-100"
            )}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Sparkles className="h-16 w-16 text-muted-foreground/20" />
          </div>
        )}

        {/* Video (on hover) */}
        {hasVideo && (
          <video
            ref={videoRef}
            src={model.demo_video_url!}
            muted={isMuted}
            loop
            playsInline
            preload="metadata"
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
              isHovering ? "opacity-100" : "opacity-0"
            )}
            onError={() => setVideoError(true)}
          />
        )}

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

        {/* Video Playing Indicator */}
        {isHovering && hasVideo && (
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="p-1.5 rounded-full bg-black/60 backdrop-blur-sm hover:bg-black/80 transition-colors"
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4 text-white" />
              ) : (
                <Volume2 className="h-4 w-4 text-white" />
              )}
            </button>
          </div>
        )}

        {/* Has Video Indicator */}
        {hasVideo && !isHovering && (
          <div className="absolute top-3 right-3 p-1.5 rounded-full bg-black/50 backdrop-blur-sm">
            <Play className="h-4 w-4 text-white fill-white" />
          </div>
        )}

        {/* Top Left Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
          {/* 来源标签 */}
          {model.source === "user_created" ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-xs font-bold text-blue-300 backdrop-blur-md">
              👤 社区
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-xs font-bold text-amber-300 backdrop-blur-md">
              🏅 官方
            </span>
          )}
          {model.is_trending && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-mermaid-cyan to-mermaid-pink text-xs font-bold text-black shadow-[0_0_10px_rgba(0,242,234,0.3)]">
              <TrendingUp className="h-3 w-3" />
              热门
            </span>
          )}
          {model.is_featured && !model.is_trending && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-mermaid-lime to-mermaid-cyan text-xs font-bold text-black shadow-[0_0_10px_rgba(204,255,0,0.3)]">
              <Star className="h-3 w-3" />
              推荐
            </span>
          )}
          {hasActiveContract && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-neon-green/20 border border-neon-green/30 text-xs font-bold text-neon-green backdrop-blur-md shadow-[0_0_10px_rgba(34,197,94,0.2)]">
              <CheckCircle2 className="h-3 w-3" />
              已签约
            </span>
          )}
          {/* 社区角色允许多人聘用，不显示“已被聘用”标签 */}
          {!hasActiveContract && model.is_hired_by_others && model.source !== "user_created" && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-medium text-white/70 backdrop-blur-md">
              <Users className="h-3 w-3" />
              已被聘用
            </span>
          )}
        </div>

        {/* Rating Badge */}
        {model.rating > 0 && (
          <div className="absolute top-12 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm">
            <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
            <span className="text-xs font-bold text-white">{model.rating.toFixed(1)}</span>
          </div>
        )}

        {/* Bottom Content */}
        <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
          {/* Name & Category */}
          <h3 className="text-xl font-bold text-white tracking-tight">{model.name}</h3>
          <p className="text-sm text-white/70 font-medium mt-0.5">{model.category}</p>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {model.tags.slice(0, 4).map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="bg-white/15 text-white/90 border-0 backdrop-blur-sm text-xs font-medium hover:bg-white/25"
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-20 -mt-px p-4 space-y-3 bg-[#0B0C10]">
        {/* Price */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {model.source === "user_created" ? "聘用价格" : "Monthly Rate"}
          </span>
          <div className="flex items-center gap-1.5">
            <Coins className="h-4 w-4 text-mermaid-cyan" />
            <span className="font-bold text-lg tracking-tight text-white/90">
              {(model.source === "user_created" ? model.publish_price : model.base_price).toLocaleString()}
            </span>
            <span className="text-xs text-mermaid-cyan/70">
              {model.source === "user_created" ? "积分" : "Credits"}
            </span>
          </div>
        </div>

        {/* Action Button */}
        {hasActiveContract ? (
          <Button
            variant="outline"
            className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-mermaid-cyan/30 hover:text-mermaid-cyan transition-all"
            onClick={onManage}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            管理团队
          </Button>
        ) : model.is_hired_by_others && model.source !== "user_created" ? (
          <Button
            variant="outline"
            className="w-full border-orange-500/50 text-orange-400 cursor-not-allowed opacity-70"
            disabled
            title="该角色已被其他用户签约，请等待签约到期后再试"
          >
            <Users className="mr-2 h-4 w-4" />
            暂不可用
          </Button>
        ) : (
          <button
            className="w-full relative px-6 py-3 rounded-full font-bold text-black text-sm transition-all duration-500 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.5)] border border-white/20 overflow-hidden group/btn shadow-[0_0_20px_rgba(0,242,234,0.2)]"
            onClick={onHire}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
            <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] opacity-0 group-hover/btn:opacity-100 group-hover/btn:animate-shimmer transition-opacity duration-300" />
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Sparkles className="h-4 w-4 fill-black/20" />
              立即聘用
            </span>
          </button>
        )}
      </div>
    </div>
  );
});

