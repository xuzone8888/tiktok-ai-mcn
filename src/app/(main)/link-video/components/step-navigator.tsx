"use client";

/**
 * 步骤导航组件
 */

import { cn } from "@/lib/utils";
import { useLinkVideoStore } from "@/stores/link-video-store";
import { Check, Link2, Settings, FileText, Grid3X3, Video } from "lucide-react";

const steps = [
  { step: 1, title: "粘贴链接", icon: Link2 },
  { step: 2, title: "配置参数", icon: Settings },
  { step: 3, title: "生成脚本", icon: FileText },
  { step: 4, title: "九宫格图", icon: Grid3X3 },
  { step: 5, title: "生成视频", icon: Video },
];

export function StepNavigator() {
  const { currentStep, setStep } = useLinkVideoStore();

  return (
    <nav className="py-4">
      <ol className="flex items-center justify-between">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = currentStep === step.step;
          const isCompleted = currentStep > step.step;
          const isClickable = step.step <= currentStep;

          return (
            <li
              key={step.step}
              className={cn(
                "flex flex-1 items-center",
                index !== steps.length - 1 && "after:content-['']"
              )}
            >
              <button
                onClick={() => isClickable && setStep(step.step)}
                disabled={!isClickable}
                className={cn(
                  "group flex flex-col items-center gap-2 transition-all",
                  isClickable ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                )}
              >
                {/* 图标圆圈 */}
                <div
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all",
                    isCompleted && "border-tiktok-cyan bg-tiktok-cyan text-white",
                    isActive && "border-tiktok-pink bg-tiktok-pink/10 text-tiktok-pink",
                    !isActive && !isCompleted && "border-muted-foreground/30 bg-muted/50 text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                  
                  {/* 活跃状态光晕 */}
                  {isActive && (
                    <div className="absolute inset-0 animate-pulse rounded-full bg-tiktok-pink/20 blur-md" />
                  )}
                </div>

                {/* 标题 */}
                <span
                  className={cn(
                    "text-xs font-medium transition-colors",
                    isActive && "text-tiktok-pink",
                    isCompleted && "text-tiktok-cyan",
                    !isActive && !isCompleted && "text-muted-foreground"
                  )}
                >
                  {step.title}
                </span>
              </button>

              {/* 连接线 */}
              {index !== steps.length - 1 && (
                <div className="mx-2 h-0.5 flex-1 bg-muted">
                  <div
                    className={cn(
                      "h-full transition-all duration-500",
                      isCompleted ? "w-full bg-gradient-to-r from-tiktok-cyan to-tiktok-pink" : "w-0"
                    )}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}






