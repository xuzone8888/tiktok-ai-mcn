"use client";

/**
 * 链接秒变视频 - 主页面
 * 
 * 5 步骤流程：
 * 1. 粘贴链接 & 解析
 * 2. 配置视频参数
 * 3. 生成带货脚本
 * 4. 生成九宫格图片
 * 5. 生成最终视频
 */

import { useEffect } from "react";
import { useLinkVideoStore } from "@/stores/link-video-store";
import { StepNavigator } from "./components/step-navigator";
import { Step1LinkInput } from "./components/step-1-link-input";
import { Step2Config } from "./components/step-2-config";
import { Step3Script } from "./components/step-3-script";
import { Step4Grid } from "./components/step-4-grid";
import { Step5Video } from "./components/step-5-video";
import { Card } from "@/components/ui/card";
import { Link2, Sparkles } from "lucide-react";

export default function LinkVideoPage() {
  const { currentStep, reset } = useLinkVideoStore();

  // 页面卸载时不重置状态（保留进度）
  // 如果需要重置，可以调用 reset()

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20">
      {/* 页面标题 */}
      <div className="border-b border-border/50 bg-gradient-to-r from-tiktok-cyan/5 via-transparent to-tiktok-pink/5">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-tiktok-cyan to-tiktok-pink shadow-lg">
              <Link2 className="h-7 w-7 text-white" />
              <div className="absolute -right-1 -top-1">
                <Sparkles className="h-5 w-5 text-amber-400" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                链接秒变视频
              </h1>
              <p className="text-muted-foreground">
                粘贴商品链接，AI 自动生成带货短视频
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 步骤导航 */}
      <div className="sticky top-0 z-40 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container mx-auto px-4">
          <StepNavigator />
        </div>
      </div>

      {/* 主内容区 */}
      <div className="container mx-auto px-4 py-8">
        <Card className="mx-auto max-w-4xl border-border/50 bg-card/50 backdrop-blur">
          <div className="p-6 md:p-8">
            {/* 步骤内容 */}
            {currentStep === 1 && <Step1LinkInput />}
            {currentStep === 2 && <Step2Config />}
            {currentStep === 3 && <Step3Script />}
            {currentStep === 4 && <Step4Grid />}
            {currentStep === 5 && <Step5Video />}
          </div>
        </Card>
      </div>
    </div>
  );
}




