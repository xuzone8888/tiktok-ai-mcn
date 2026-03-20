"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Video,
  Image as ImageIcon,
  FileText,
  Sparkles,
  ChevronRight,
  Zap,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
/** @deprecated 旧版类型，仅供 /studio 旧页面兼容 */
type VideoDuration = "5s" | "10s" | "15s" | "20s";

export type GenerationType = "video" | "image";

// 积分定价配置
const CREDITS_PRICING: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

// 时长选项
const DURATION_OPTIONS: { value: VideoDuration; label: string }[] = [
  { value: "5s", label: "5 秒" },
  { value: "10s", label: "10 秒" },
  { value: "15s", label: "15 秒" },
  { value: "20s", label: "20 秒" },
];

interface GenerationConfigProps {
  type: GenerationType;
  onTypeChange: (type: GenerationType) => void;
  duration: VideoDuration;
  onDurationChange: (duration: VideoDuration) => void;
  script: string;
  onScriptChange: (script: string) => void;
  selectedTemplate: string | null;
  onTemplateSelect: (template: string | null) => void;
}

// TikTok 爆款脚本模板
const scriptTemplates = [
  {
    id: "product-showcase",
    title: "产品展示",
    icon: "📦",
    script: `【开场】
"你们要的[产品名称]测评来了！"

【展示】
"先看看这个包装，质感真的绝了"
"打开看看里面是什么样的"

【体验】
"上手试了一下，[描述感受]"
"这个[特点]真的太惊艳了"

【总结】
"总的来说，[产品名称]真的值得入手！"
"链接放评论区了，想要的姐妹冲！"`,
    tags: ["带货", "种草", "测评"],
  },
  {
    id: "ootd",
    title: "穿搭分享",
    icon: "👗",
    script: `【开场】
"今日穿搭分享～"

【单品介绍】
"上衣是[品牌]的[款式]"
"裤子/裙子选的是[描述]"
"鞋子搭配的[款式]"

【穿搭技巧】
"这套的重点是[技巧]"
"[身材特点]的姐妹可以参考"

【结尾】
"喜欢的话记得点赞收藏哦～"`,
    tags: ["穿搭", "OOTD", "时尚"],
  },
  {
    id: "skincare",
    title: "护肤分享",
    icon: "✨",
    script: `【开场】
"分享我最近回购的护肤好物！"

【产品介绍】
"这款[产品名称]我已经用了[时间]"
"质地是[描述]，很好推开"

【使用感受】
"用完之后皮肤[效果描述]"
"特别适合[肤质]的姐妹"

【对比展示】
"看看使用前后的对比"

【结尾】
"有什么问题评论区问我～"`,
    tags: ["护肤", "美妆", "好物"],
  },
  {
    id: "unboxing",
    title: "开箱视频",
    icon: "📬",
    script: `【开场】
"今天来开箱[品牌/产品]！"

【外观展示】
"先看看包装，[描述]"
"打开之后是这样的"

【细节展示】
"来看看细节"
"这个[部分]做工真的很精致"

【惊喜时刻】
"还有一个小惊喜..."

【总结】
"这次开箱体验我打[评分]分！"`,
    tags: ["开箱", "测评", "分享"],
  },
  {
    id: "tutorial",
    title: "教程类",
    icon: "📚",
    script: `【开场】
"手把手教你[主题]！"

【步骤一】
"首先，我们需要[步骤描述]"

【步骤二】
"然后，[步骤描述]"
"注意这里的小技巧是[技巧]"

【步骤三】
"最后，[步骤描述]"

【成果展示】
"看，完成了！是不是很简单"

【结尾】
"学会了记得点赞，有问题评论区见～"`,
    tags: ["教程", "技巧", "干货"],
  },
  {
    id: "vlog",
    title: "日常 Vlog",
    icon: "🎬",
    script: `【开场】
"记录今天的一天～"

【场景一】
"早上起来先[活动]"

【场景二】
"中午去了[地点]"
"这家店的[特色]真的绝了"

【场景三】
"下午[活动描述]"

【结尾】
"今天就是这样充实的一天"
"明天见啦～"`,
    tags: ["Vlog", "日常", "生活"],
  },
];

export function GenerationConfig({
  type,
  onTypeChange,
  duration,
  onDurationChange,
  script,
  onScriptChange,
  selectedTemplate,
  onTemplateSelect,
}: GenerationConfigProps) {
  const [showAllTemplates, setShowAllTemplates] = useState(false);

  const displayedTemplates = showAllTemplates
    ? scriptTemplates
    : scriptTemplates.slice(0, 4);

  const handleTemplateClick = (template: typeof scriptTemplates[0]) => {
    if (selectedTemplate === template.id) {
      onTemplateSelect(null);
      onScriptChange("");
    } else {
      onTemplateSelect(template.id);
      onScriptChange(template.script);
    }
  };

  const currentCredits = type === "video" ? CREDITS_PRICING[duration] : 10;

  return (
    <div className="space-y-6">
      {/* Generation Type */}
      <div className="space-y-3">
        <label className="text-sm font-medium">生成类型</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onTypeChange("video")}
            className={cn(
              "relative flex flex-col items-center gap-3 p-6 rounded-xl border transition-all duration-200",
              type === "video"
                ? "border-tiktok-cyan bg-tiktok-cyan/10 ring-2 ring-tiktok-cyan/30"
                : "border-border/50 hover:border-tiktok-cyan/30 hover:bg-white/5"
            )}
          >
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl",
              type === "video"
                ? "bg-tiktok-cyan text-black"
                : "bg-white/5"
            )}>
              <Video className="h-7 w-7" />
            </div>
            <div className="text-center">
              <p className="font-semibold">Video</p>
              <p className="text-xs text-muted-foreground mt-1">
                Sora 2 AI 视频
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <Zap className="h-3 w-3 text-amber-500" />
              <span className="text-amber-500 font-medium">
                {type === "video" ? `${CREDITS_PRICING[duration]}` : "30-120"} Credits
              </span>
            </div>
          </button>

          <button
            onClick={() => onTypeChange("image")}
            className={cn(
              "relative flex flex-col items-center gap-3 p-6 rounded-xl border transition-all duration-200",
              type === "image"
                ? "border-tiktok-pink bg-tiktok-pink/10 ring-2 ring-tiktok-pink/30"
                : "border-border/50 hover:border-tiktok-pink/30 hover:bg-white/5"
            )}
          >
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl",
              type === "image"
                ? "bg-tiktok-pink text-black"
                : "bg-white/5"
            )}>
              <ImageIcon className="h-7 w-7" />
            </div>
            <div className="text-center">
              <p className="font-semibold">Photo</p>
              <p className="text-xs text-muted-foreground mt-1">
                生成产品展示图
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <Zap className="h-3 w-3 text-emerald-500" />
              <span className="text-emerald-500 font-medium">10 Credits</span>
            </div>
          </button>
        </div>
      </div>

      {/* Video Duration (Video only) */}
      {type === "video" && (
        <div className="space-y-3">
          <label className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-tiktok-cyan" />
            视频时长
          </label>
          <div className="grid grid-cols-4 gap-2">
            {DURATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => onDurationChange(option.value)}
                className={cn(
                  "flex flex-col items-center gap-1 p-3 rounded-xl border transition-all duration-200",
                  duration === option.value
                    ? "border-tiktok-cyan bg-tiktok-cyan/10 ring-1 ring-tiktok-cyan/30"
                    : "border-border/50 hover:border-tiktok-cyan/30 hover:bg-white/5"
                )}
              >
                <span className="font-semibold text-sm">{option.label}</span>
                <span className="text-xs text-amber-500 flex items-center gap-0.5">
                  <Zap className="h-3 w-3" />
                  {CREDITS_PRICING[option.value]}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            💡 更长的视频需要更多积分和生成时间（约 {duration === "5s" ? "30秒" : duration === "10s" ? "1分钟" : duration === "15s" ? "2分钟" : "3-5分钟"}）
          </p>
        </div>
      )}

      {/* Script Templates (Video only) */}
      {type === "video" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-tiktok-cyan" />
              TikTok 爆款脚本模板
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllTemplates(!showAllTemplates)}
              className="text-xs text-muted-foreground hover:text-white"
            >
              {showAllTemplates ? "收起" : "查看全部"}
              <ChevronRight className={cn(
                "ml-1 h-3 w-3 transition-transform",
                showAllTemplates && "rotate-90"
              )} />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {displayedTemplates.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateClick(template)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-200",
                  selectedTemplate === template.id
                    ? "border-tiktok-cyan bg-tiktok-cyan/10"
                    : "border-border/50 hover:border-tiktok-cyan/30 hover:bg-white/5"
                )}
              >
                <span className="text-2xl">{template.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{template.title}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {template.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-xs rounded bg-white/5 text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Script Input (Video only) */}
      {type === "video" && (
        <div className="space-y-3">
          <label className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-tiktok-pink" />
            脚本/提示词
          </label>
          <div className="relative">
            <textarea
              value={script}
              onChange={(e) => {
                onScriptChange(e.target.value);
                if (selectedTemplate) onTemplateSelect(null);
              }}
              placeholder="输入视频脚本或提示词...&#10;&#10;例如：&#10;- 展示产品的主要特点&#10;- 分享使用体验&#10;- 推荐给适合的人群"
              className="w-full h-48 p-4 rounded-xl bg-muted/50 border border-border/50 resize-none focus:outline-none focus:border-tiktok-cyan/50 focus:ring-1 focus:ring-tiktok-cyan/20 text-sm"
            />
            <div className="absolute bottom-3 right-3 text-xs text-muted-foreground">
              {script.length} 字
            </div>
          </div>
        </div>
      )}

      {/* Image description (Image only) */}
      {type === "image" && (
        <div className="space-y-3">
          <label className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-tiktok-pink" />
            图片描述（可选）
          </label>
          <textarea
            value={script}
            onChange={(e) => onScriptChange(e.target.value)}
            placeholder="描述您想要的图片风格...&#10;&#10;例如：简约白底产品图，突出产品质感"
            className="w-full h-24 p-4 rounded-xl bg-muted/50 border border-border/50 resize-none focus:outline-none focus:border-tiktok-pink/50 focus:ring-1 focus:ring-tiktok-pink/20 text-sm"
          />
        </div>
      )}
    </div>
  );
}

export { CREDITS_PRICING };
