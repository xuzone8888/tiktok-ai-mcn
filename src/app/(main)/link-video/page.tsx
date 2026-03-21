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
    <div className="h-full flex flex-col bg-[#050505]">
      {/* 页面标题 - JCUI 2.0 Titanium Bar */}
      <div className="border-b border-white/5 bg-[#050505]/80 backdrop-blur-xl sticky top-0 z-10 transition-all duration-500">
        <div className="px-6 py-4">
          <div className="mb-3 animate-in fade-in slide-in-from-top-4 duration-500">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
              <span className="text-white drop-shadow-lg">链接生成视频</span>
            </h1>
            <p className="mt-1 text-white/60 ml-[19px]">
              粘贴商品链接，AI 自动生成带货短视频
            </p>
          </div>
        </div>
      </div>

      {/* 步骤导航 */}
      <div className="border-b border-white/5 bg-[#0B0C10]/60 backdrop-blur-xl">
        <div className="px-6 py-2">
          <StepNavigator />
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 overflow-auto">
        <div className="px-6 py-6">
          <div className="mx-auto max-w-4xl">
            <div className="bg-[#16181D]/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
              <div className="p-5">
                {/* 步骤内容 */}
                {currentStep === 1 && <Step1LinkInput />}
                {currentStep === 2 && <Step2Config />}
                {currentStep === 3 && <Step3Script />}
                {currentStep === 4 && <Step4Grid />}
                {currentStep === 5 && <Step5Video />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}






