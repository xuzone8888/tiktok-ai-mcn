"use client";

/**
 * Step 2: 视频参数配置
 */

import { useState, useEffect } from "react";
import { useLinkVideoStore } from "@/stores/link-video-store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Monitor,
  Mic,
  Globe,
  User,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VIDEO_STYLE_NAMES,
  PLATFORM_STYLE_NAMES,
  LANGUAGE_NAMES,
  getLinkVideoCredits,
  type VideoStyle,
  type PlatformStyle,
  type ScriptLanguage,
  type LinkVideoDuration,
} from "@/types/link-video";

// 时长选项
const DURATION_OPTIONS: { value: LinkVideoDuration; label: string; model: string; credits: number }[] = [
  { value: 10, label: "10 秒", model: "Sora2 标清", credits: getLinkVideoCredits(10) },
  { value: 15, label: "15 秒", model: "Sora2 Pro 高清", credits: getLinkVideoCredits(15) },
  { value: 25, label: "25 秒", model: "Sora2 Pro", credits: getLinkVideoCredits(25) },
];

// 比例选项
const ASPECT_OPTIONS: { value: "9:16" | "16:9"; label: string; icon: string }[] = [
  { value: "9:16", label: "竖屏 9:16", icon: "📱" },
  { value: "16:9", label: "横屏 16:9", icon: "🖥️" },
];

export function Step2Config() {
  const {
    videoConfig,
    setVideoConfig,
    selectedModelId,
    setSelectedModelId,
    prevStep,
    nextStep,
  } = useLinkVideoStore();

  const [hiredModels, setHiredModels] = useState<any[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // 加载已签约的模特
  useEffect(() => {
    const loadModels = async () => {
      setLoadingModels(true);
      try {
        const response = await fetch("/api/contracts");
        const result = await response.json();
        if (result.success) {
          setHiredModels(result.data || []);
        }
      } catch (error) {
        console.error("Failed to load models:", error);
      } finally {
        setLoadingModels(false);
      }
    };
    loadModels();
  }, []);

  const selectedDuration = DURATION_OPTIONS.find(d => d.value === videoConfig.duration);

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h2 className="text-xl font-semibold">配置视频参数</h2>
        <p className="text-sm text-muted-foreground mt-1">
          根据需求调整视频风格和生成参数
        </p>
      </div>

      {/* 视频时长 */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          视频时长
        </Label>
        <div className="grid grid-cols-3 gap-3">
          {DURATION_OPTIONS.map((option) => (
            <Card
              key={option.value}
              className={cn(
                "relative cursor-pointer p-4 transition-all hover:border-tiktok-cyan/50",
                videoConfig.duration === option.value &&
                "border-tiktok-cyan bg-tiktok-cyan/5 ring-1 ring-tiktok-cyan/30"
              )}
              onClick={() => setVideoConfig({ duration: option.value })}
            >
              <div className="space-y-2">
                <div className="text-2xl font-bold">{option.label}</div>
                <div className="text-xs text-muted-foreground">{option.model}</div>
                <Badge variant="secondary" className="text-xs">
                  {option.credits} 积分
                </Badge>
              </div>
              {videoConfig.duration === option.value && (
                <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-tiktok-cyan" />
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* 画幅比例 */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Monitor className="h-4 w-4" />
          画幅比例
        </Label>
        <div className="grid grid-cols-2 gap-3">
          {ASPECT_OPTIONS.map((option) => (
            <Card
              key={option.value}
              className={cn(
                "cursor-pointer p-4 transition-all hover:border-tiktok-pink/50",
                videoConfig.aspect_ratio === option.value &&
                "border-tiktok-pink bg-tiktok-pink/5 ring-1 ring-tiktok-pink/30"
              )}
              onClick={() => setVideoConfig({ aspect_ratio: option.value })}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{option.icon}</span>
                <span className="font-medium">{option.label}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* 视频风格 */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Mic className="h-4 w-4" />
          视频风格
        </Label>
        <Select
          value={videoConfig.video_style}
          onValueChange={(value: VideoStyle) => setVideoConfig({ video_style: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(VIDEO_STYLE_NAMES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 目标平台 */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Globe className="h-4 w-4" />
          目标平台
        </Label>
        <Select
          value={videoConfig.platform_style}
          onValueChange={(value: PlatformStyle) => setVideoConfig({ platform_style: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PLATFORM_STYLE_NAMES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 语言 */}
      <div className="space-y-3">
        <Label>脚本语言</Label>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(LANGUAGE_NAMES).map(([value, label]) => (
            <Card
              key={value}
              className={cn(
                "cursor-pointer p-3 text-center transition-all",
                videoConfig.language === value &&
                "border-tiktok-cyan bg-tiktok-cyan/5"
              )}
              onClick={() => setVideoConfig({ language: value as ScriptLanguage })}
            >
              {label}
            </Card>
          ))}
        </div>
      </div>

      {/* AI 模特选择 */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <User className="h-4 w-4" />
          AI 模特
          <span className="text-xs text-muted-foreground">(可选)</span>
        </Label>

        {loadingModels ? (
          <div className="text-sm text-muted-foreground">加载中...</div>
        ) : hiredModels.length === 0 ? (
          <Card className="p-4 border-dashed">
            <p className="text-sm text-muted-foreground text-center">
              暂无已签约模特，
              <a href="/models" className="text-tiktok-cyan hover:underline">
                前往签约
              </a>
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {/* 不使用模特 */}
            <Card
              className={cn(
                "cursor-pointer p-3 transition-all",
                !selectedModelId && "border-tiktok-cyan bg-tiktok-cyan/5"
              )}
              onClick={() => setSelectedModelId(null)}
            >
              <div className="text-center">
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Sparkles className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="text-xs font-medium">不使用模特</div>
              </div>
            </Card>

            {/* 已签约模特 */}
            {hiredModels.slice(0, 5).map((contract: any) => (
              <Card
                key={contract.id}
                className={cn(
                  "cursor-pointer p-3 transition-all",
                  selectedModelId === contract.model_id &&
                  "border-tiktok-pink bg-tiktok-pink/5"
                )}
                onClick={() => setSelectedModelId(contract.model_id)}
              >
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={contract.ai_models?.avatar_url || "/placeholder-avatar.png"}
                    alt={contract.ai_models?.name}
                    className="mx-auto mb-2 h-12 w-12 rounded-full object-cover"
                  />
                  <div className="text-xs font-medium line-clamp-1">
                    {contract.ai_models?.name}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 积分预估 */}
      <Card className="bg-gradient-to-r from-tiktok-cyan/10 to-tiktok-pink/10 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">预估消耗积分</span>
          <span className="text-2xl font-bold bg-gradient-to-r from-tiktok-cyan to-tiktok-pink bg-clip-text text-transparent">
            {selectedDuration?.credits || 50} 积分
          </span>
        </div>
      </Card>

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={prevStep}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          上一步
        </Button>
        <Button
          onClick={nextStep}
          variant="white-glow"
        >
          下一步：生成脚本
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}






