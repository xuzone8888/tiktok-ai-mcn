"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Factory,
  ImageIcon,
  Video,
  Zap,
  Sparkles,
  ZoomIn,
  Grid3X3,
  ArrowRight,
  Clock,
  CheckCircle2,
} from "lucide-react";

// ============================================================================
// 功能模块配置
// ============================================================================

const MODULES = [
  {
    id: "image-batch",
    title: "图片批量处理",
    description: "批量上传图片，使用 AI 进行高清放大、九宫格生成等处理",
    href: "/pro-studio/image-batch",
    icon: ImageIcon,
    gradient: "from-tiktok-pink to-purple-500",
    bgGradient: "from-tiktok-pink/10 to-purple-500/10",
    borderColor: "border-tiktok-pink/30",
    features: [
      { icon: Zap, label: "Nano Banana 快速", desc: "快速生成、高清放大、九宫格" },
      { icon: Sparkles, label: "Nano Banana Pro 专业", desc: "高质量输出，1K/2K/4K 分辨率" },
      { icon: ZoomIn, label: "高清放大", desc: "提升产品图片清晰度" },
      { icon: Grid3X3, label: "九宫格多角度", desc: "适配Sora2视频，纯白背景+9角度高清展示" },
    ],
    stats: {
      speed: "15-90秒/张",
      costRange: "10-180 Credits",
    },
    tag: "推荐",
    tagColor: "bg-tiktok-pink text-white",
  },
  {
    id: "video-batch",
    title: "视频批量生成",
    description: "上传产品图片 → 豆包生成脚本 → Sora2 生成15秒视频",
    href: "/pro-studio/video-batch",
    icon: Video,
    gradient: "from-tiktok-cyan to-blue-500",
    bgGradient: "from-tiktok-cyan/10 to-blue-500/10",
    borderColor: "border-tiktok-cyan/30",
    features: [
      { icon: Clock, label: "完整流水线", desc: "图片→脚本→提示词→视频" },
      { icon: Video, label: "Sora 2 Pro", desc: "15秒高质量视频生成" },
      { icon: Sparkles, label: "豆包 AI", desc: "智能口播脚本生成" },
      { icon: CheckCircle2, label: "批量处理", desc: "支持批量创建和执行" },
    ],
    stats: {
      speed: "5-8分钟/个",
      costRange: "60 Credits/个",
    },
    tag: "新功能",
    tagColor: "bg-tiktok-cyan text-black",
    disabled: false,
  },
];

// ============================================================================
// 主页面
// ============================================================================

export default function ProStudioPage() {
  return (
    <div className="space-y-8">
      {/* 页面头部 */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-tiktok-cyan to-tiktok-pink flex items-center justify-center">
            <Factory className="h-5 w-5 text-white" />
          </div>
          <span className="gradient-tiktok-text">批量产线区</span>
        </h1>
        <p className="text-muted-foreground">
          高效处理大量图片和视频内容的智能生产线
        </p>
      </div>

      {/* 模块选择 */}
      <div className="grid md:grid-cols-2 gap-6">
        {MODULES.map((module) => {
          const Icon = module.icon;
          
          return (
            <Card
              key={module.id}
              className={cn(
                "group relative overflow-hidden transition-all duration-300",
                module.disabled
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:border-transparent hover:shadow-xl cursor-pointer",
                module.borderColor
              )}
            >
              {/* 背景渐变效果 */}
                <div
                  className={cn(
                  "absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300",
                  !module.disabled && "group-hover:opacity-100",
                  module.bgGradient
                  )}
              />

              <CardHeader className="relative z-10">
                <div className="flex items-start justify-between">
                  <div
                    className={cn(
                      "h-14 w-14 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-lg",
                      module.gradient
                    )}
                  >
                    <Icon className="h-7 w-7 text-white" />
                </div>
                  <Badge className={cn("text-xs", module.tagColor)}>
                    {module.tag}
                  </Badge>
                </div>
                <CardTitle className="text-xl mt-4">{module.title}</CardTitle>
                <CardDescription className="text-sm">
                  {module.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="relative z-10 space-y-4">
                {/* 功能列表 */}
                <div className="space-y-2">
                  {module.features.map((feature, idx) => {
                    const FeatureIcon = feature.icon;
                    return (
                      <div key={idx} className="flex items-start gap-3">
                        <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                          <FeatureIcon className="h-4 w-4 text-muted-foreground" />
              </div>
                        <div>
                          <p className="text-sm font-medium">{feature.label}</p>
                          <p className="text-xs text-muted-foreground">{feature.desc}</p>
      </div>
    </div>
  );
                  })}
        </div>

                {/* 统计信息 */}
                <div className="flex items-center gap-4 pt-2 border-t border-border/50">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{module.stats.speed}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-400" />
                    <span className="text-xs text-amber-400">{module.stats.costRange}</span>
                  </div>
                </div>

                {/* 进入按钮 */}
                {module.disabled ? (
                  <Button disabled className="w-full mt-4 h-11">
                    即将推出
                  </Button>
                ) : (
                  <Link href={module.href}>
                    <Button
                      className={cn(
                        "w-full mt-4 h-11 font-semibold transition-all",
                        `bg-gradient-to-r ${module.gradient} hover:opacity-90 text-white`
                      )}
                    >
                      进入工作台
                      <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 使用提示 */}
      <Card className="glass-card">
        <CardContent className="py-6">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">使用建议</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• <strong>图片批量处理</strong>：先上传产品图片，生成九宫格多角度图，再用于视频生成效果更佳</li>
                <li>• <strong>九宫格功能</strong>：生成的9角度展示图可直接作为 Sora2 的输入，提升视频质量</li>
                <li>• <strong>高清放大</strong>：适合将小尺寸产品图提升至高清画质</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
