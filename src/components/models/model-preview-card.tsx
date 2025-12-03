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
        "group relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300",
        "hover:border-tiktok-cyan/50 hover:shadow-xl hover:shadow-tiktok-cyan/10",
        "hover:-translate-y-1",
        hasActiveContract && "ring-2 ring-emerald-500/50"
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Media Container */}
      <div className="relative aspect-[3/4] overflow-hidden bg-gradient-to-br from-tiktok-cyan/5 to-tiktok-pink/5">
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
          {model.is_trending && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-xs font-semibold text-black shadow-lg">
              <TrendingUp className="h-3 w-3" />
              热门
            </span>
          )}
          {model.is_featured && !model.is_trending && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500 text-xs font-semibold text-black shadow-lg">
              <Star className="h-3 w-3" />
              推荐
            </span>
          )}
          {hasActiveContract && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500 text-xs font-semibold text-black shadow-lg">
              <CheckCircle2 className="h-3 w-3" />
              已签约
            </span>
          )}
          {!hasActiveContract && model.is_hired_by_others && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500 text-xs font-semibold text-black shadow-lg">
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
      <div className="p-4 space-y-3 bg-gradient-to-b from-transparent to-black/20">
        {/* Price */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Monthly Rate</span>
          <div className="flex items-center gap-1.5">
            <Coins className="h-4 w-4 text-tiktok-cyan" />
            <span className="font-bold text-lg tracking-tight">
              {model.base_price.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">Credits</span>
          </div>
        </div>

        {/* Action Button */}
        {hasActiveContract ? (
          <Button
            variant="outline"
            className="w-full border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
            onClick={onManage}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            管理团队
          </Button>
        ) : model.is_hired_by_others ? (
          <Button
            variant="outline"
            className="w-full border-orange-500/50 text-orange-400 cursor-not-allowed opacity-70"
            disabled
          >
            <Users className="mr-2 h-4 w-4" />
            已被聘用 ({model.hired_count}人)
          </Button>
        ) : (
          <Button
            className="w-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-bold hover:opacity-90 hover:scale-[1.02] transition-all shadow-lg shadow-tiktok-cyan/20"
            onClick={onHire}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            立即聘用
          </Button>
        )}
      </div>
    </div>
  );
});

