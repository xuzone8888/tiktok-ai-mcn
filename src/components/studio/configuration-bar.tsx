"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Smartphone,
  Monitor,
  Zap,
  Download,
  User,
  UserX,
  Sparkles,
  Settings2,
} from "lucide-react";
import type { 
  AspectRatio, 
  VideoDuration,
  ProjectGlobalSettings 
} from "@/types/database";

// ============================================================================
// 类型定义
// ============================================================================

export interface ConfigurationBarProps {
  // Video Specs
  aspectRatio: AspectRatio;
  duration: VideoDuration;
  
  // Model Toggle
  useModel: boolean;
  selectedModelId?: string | null;
  
  // Auto Download
  autoDownload: boolean;
  
  // Nano Banana Version
  nanoBananaVersion: "V1" | "V2";
  
  // 回调函数
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onDurationChange: (duration: VideoDuration) => void;
  onUseModelChange: (useModel: boolean) => void;
  onModelChange?: (modelId: string | null) => void;
  onAutoDownloadChange: (enabled: boolean) => void;
  onNanoBananaVersionChange: (version: "V1" | "V2") => void;
  
  // 可用模特列表
  availableModels?: Array<{
    id: string;
    name: string;
    avatar_url?: string | null;
    category?: string;
  }>;
  
  // 是否禁用（生成中）
  disabled?: boolean;
  
  // 类名
  className?: string;
}

// ============================================================================
// 积分定价
// ============================================================================

const DURATION_CREDITS: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

// 支持的时长选项
const DURATION_OPTIONS: { value: VideoDuration; label: string }[] = [
  { value: "10s", label: "10s" },
  { value: "15s", label: "15s" },
  { value: "20s", label: "25s" },
];

// ============================================================================
// Configuration Bar 组件
// ============================================================================

export function ConfigurationBar({
  aspectRatio,
  duration,
  useModel,
  selectedModelId,
  autoDownload,
  nanoBananaVersion,
  onAspectRatioChange,
  onDurationChange,
  onUseModelChange,
  onModelChange,
  onAutoDownloadChange,
  onNanoBananaVersionChange,
  availableModels = [],
  disabled = false,
  className,
}: ConfigurationBarProps) {
  const currentCredits = DURATION_CREDITS[duration] || 50;

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex flex-col gap-4 p-4 rounded-2xl",
          "bg-gradient-to-r from-white/[0.03] to-white/[0.06]",
          "border border-white/10 backdrop-blur-xl",
          "shadow-[0_0_40px_rgba(0,242,234,0.05)]",
          disabled && "opacity-60 pointer-events-none",
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 pb-2 border-b border-white/10">
          <Settings2 className="h-4 w-4 text-tiktok-cyan" />
          <span className="text-sm font-semibold">Global Configuration</span>
          <span className="text-xs text-muted-foreground">全局默认设置</span>
        </div>

        {/* Controls Row */}
        <div className="flex flex-wrap items-center gap-4">
          {/* ================================================================ */}
          {/* Model Toggle */}
          {/* ================================================================ */}
          <div className="flex items-center gap-3 p-2 rounded-xl bg-black/20 border border-white/5">
            <div className="flex items-center gap-2">
              <Switch
                id="use-model"
                checked={useModel}
                onCheckedChange={onUseModelChange}
                className="data-[state=checked]:bg-tiktok-pink"
              />
              <Label
                htmlFor="use-model"
                className="text-sm cursor-pointer flex items-center gap-1.5"
              >
                {useModel ? (
                  <User className="h-3.5 w-3.5 text-tiktok-pink" />
                ) : (
                  <UserX className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className={useModel ? "text-foreground" : "text-muted-foreground"}>
                  Use AI Model
                </span>
              </Label>
            </div>

            {/* Model Selector (when enabled) */}
            {useModel && availableModels.length > 0 && onModelChange && (
              <Select
                value={selectedModelId || "auto"}
                onValueChange={(value) =>
                  onModelChange(value === "auto" ? null : value)
                }
              >
                <SelectTrigger className="w-[160px] h-8 bg-black/30 border-white/10 rounded-lg text-sm">
                  <SelectValue placeholder="选择模特" />
                </SelectTrigger>
                <SelectContent className="bg-black/95 border-white/10 backdrop-blur-xl">
                  <SelectItem value="auto">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      自动匹配
                    </div>
                  </SelectItem>
                  {availableModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex items-center gap-2">
                        {model.avatar_url ? (
                          <img
                            src={model.avatar_url}
                            alt={model.name}
                            className="h-5 w-5 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-5 w-5 rounded-full bg-white/10 flex items-center justify-center">
                            <User className="h-3 w-3" />
                          </div>
                        )}
                        <span>{model.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-white/10 hidden sm:block" />

          {/* ================================================================ */}
          {/* Video Specs: Duration */}
          {/* ================================================================ */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Duration
            </span>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-black/30 border border-white/10">
              {DURATION_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant="ghost"
                  size="sm"
                  onClick={() => onDurationChange(option.value)}
                  className={cn(
                    "h-7 px-3 rounded-md text-xs font-medium transition-all duration-200",
                    duration === option.value
                      ? "bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/50"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            {/* Credits */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30">
              <Zap className="h-3 w-3 text-amber-500" />
              <span className="text-xs font-semibold text-amber-400">{currentCredits}</span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-white/10 hidden sm:block" />

          {/* ================================================================ */}
          {/* Video Specs: Aspect Ratio */}
          {/* ================================================================ */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Ratio
            </span>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-black/30 border border-white/10">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onAspectRatioChange("9:16")}
                    className={cn(
                      "h-7 w-9 p-0 rounded-md transition-all duration-200",
                      aspectRatio === "9:16"
                        ? "bg-tiktok-cyan/20 text-tiktok-cyan border border-tiktok-cyan/50"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>竖屏 9:16 (TikTok/Reels)</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onAspectRatioChange("16:9")}
                    className={cn(
                      "h-7 w-9 p-0 rounded-md transition-all duration-200",
                      aspectRatio === "16:9"
                        ? "bg-tiktok-pink/20 text-tiktok-pink border border-tiktok-pink/50"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    <Monitor className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>横屏 16:9 (YouTube)</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-white/10 hidden md:block" />

          {/* ================================================================ */}
          {/* Nano Banana Version */}
          {/* ================================================================ */}
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-tiktok-pink" />
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Nano Banana
            </span>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-black/30 border border-white/10">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNanoBananaVersionChange("V1")}
                className={cn(
                  "h-7 px-2.5 rounded-md text-xs font-medium transition-all duration-200",
                  nanoBananaVersion === "V1"
                    ? "bg-tiktok-pink/20 text-tiktok-pink border border-tiktok-pink/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                V1
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNanoBananaVersionChange("V2")}
                className={cn(
                  "h-7 px-2.5 rounded-md text-xs font-medium transition-all duration-200",
                  nanoBananaVersion === "V2"
                    ? "bg-purple-500/20 text-purple-400 border border-purple-500/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                V2
              </Button>
            </div>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-white/10 hidden md:block" />

          {/* ================================================================ */}
          {/* Auto-Download Toggle */}
          {/* ================================================================ */}
          <div className="flex items-center gap-2">
            <Switch
              id="auto-download"
              checked={autoDownload}
              onCheckedChange={onAutoDownloadChange}
              className="data-[state=checked]:bg-tiktok-cyan"
            />
            <Label
              htmlFor="auto-download"
              className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1"
            >
              <Download className="h-3 w-3" />
              Auto-save
            </Label>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ============================================================================
// 默认配置
// ============================================================================

export const DEFAULT_CONFIG: ProjectGlobalSettings = {
  aspect_ratio: "9:16",
  duration: "10s",
  auto_download: false,
};

// ============================================================================
// 辅助函数
// ============================================================================

export function getCreditsForDuration(duration: VideoDuration): number {
  return DURATION_CREDITS[duration] || 50;
}

export { DURATION_CREDITS };
