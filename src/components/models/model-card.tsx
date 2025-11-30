"use client";

import { Button } from "@/components/ui/button";
import {
  Star,
  TrendingUp,
  Sparkles,
  Users,
  Video,
  CheckCircle2,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIModel, Contract } from "@/types/model";

interface ModelCardProps {
  model: AIModel & {
    has_active_contract?: boolean;
    contract?: Contract | null;
  };
  onHire?: (model: AIModel) => void;
  onManage?: (model: AIModel) => void;
}

export function ModelCard({ model, onHire, onManage }: ModelCardProps) {
  const hasContract = model.has_active_contract;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300",
        "hover:border-tiktok-cyan/30 hover:shadow-lg hover:shadow-tiktok-cyan/5",
        hasContract && "ring-2 ring-emerald-500/30"
      )}
    >
      {/* Image */}
      <div className="relative aspect-[3/4] overflow-hidden bg-gradient-to-br from-tiktok-cyan/10 to-tiktok-pink/10">
        {model.avatar_url ? (
          <img
            src={model.avatar_url}
            alt={model.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Sparkles className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-2">
          {model.is_trending && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-xs font-medium text-black">
              <TrendingUp className="h-3 w-3" />
              热门
            </span>
          )}
          {model.is_featured && !model.is_trending && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500 text-xs font-medium text-black">
              <Star className="h-3 w-3" />
              精选
            </span>
          )}
          {hasContract && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500 text-xs font-medium text-black">
              <CheckCircle2 className="h-3 w-3" />
              已签约
            </span>
          )}
        </div>

        {/* Rating */}
        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm">
          <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
          <span className="text-xs font-medium text-white">{model.rating}</span>
        </div>

        {/* Content overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          {/* Name & Category */}
          <h3 className="text-lg font-bold text-white">{model.name}</h3>
          <p className="text-sm text-white/70">{model.category}</p>

          {/* Tags */}
          <div className="flex flex-wrap gap-1 mt-2">
            {model.style_tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs rounded-full bg-white/10 text-white/80 backdrop-blur-sm"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mt-3 text-xs text-white/60">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {(model.total_rentals / 1000).toFixed(1)}K
            </span>
            <span className="flex items-center gap-1">
              <Video className="h-3 w-3" />
              {(model.total_generations / 1000).toFixed(1)}K
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 space-y-3">
        {/* Price */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">月薪</span>
          <div className="flex items-center gap-1">
            <Coins className="h-4 w-4 text-tiktok-cyan" />
            <span className="font-bold text-lg">
              {model.price_monthly.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">/月</span>
          </div>
        </div>

        {/* Action Button */}
        {hasContract ? (
          <Button
            variant="outline"
            className="w-full border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10"
            onClick={() => onManage?.(model)}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            In Team
          </Button>
        ) : (
          <Button
            className="w-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold hover:opacity-90"
            onClick={() => onHire?.(model)}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Hire
          </Button>
        )}
      </div>
    </div>
  );
}



