"use client";

/**
 * 电商图片工厂 - 主页面
 * 
 * 路由: /image-factory
 */

import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import {
  LayoutGrid,
  Square,
  Image,
  User,
  Camera,
  Sparkles,
} from "lucide-react";
import { useImageFactoryStore } from "@/stores/image-factory-store";
import { ECOM_MODE_CONFIG, type EcomImageMode } from "@/types/ecom-image";
import { IMAGE_FACTORY_UPGRADING_MESSAGE, isImageFactoryUiEnabled } from "@/lib/feature-flags";

// 组件导入
import { LeftPanel } from "./components/left-panel";
import { CenterPanel } from "./components/center-panel";
import { RightPanel } from "./components/right-panel";

// 模式图标映射
const MODE_ICONS: Record<EcomImageMode, React.ReactNode> = {
  ecom_five_pack: <LayoutGrid className="h-4 w-4" />,
  white_background: <Square className="h-4 w-4" />,
  scene_image: <Image className="h-4 w-4" />,
  try_on: <User className="h-4 w-4" />,
  buyer_show: <Camera className="h-4 w-4" />,
};

export default function ImageFactoryPage() {
  const { currentMode, setCurrentMode, resetTask } = useImageFactoryStore();
  const [mounted, setMounted] = useState(false);

  // 客户端挂载检测
  useEffect(() => {
    setMounted(true);
  }, []);

  // 切换模式时重置任务
  const handleModeChange = (mode: string) => {
    if (mode !== currentMode) {
      resetTask();
      setCurrentMode(mode as EcomImageMode);
    }
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="animate-pulse flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary animate-spin" />
          <span className="text-muted-foreground">加载中...</span>
        </div>
      </div>
    );
  }

  if (!isImageFactoryUiEnabled()) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center px-6">
        <Card className="max-w-md border-white/10 bg-[#0B0C10]/80 p-8 text-center text-white shadow-2xl">
          <Sparkles className="mx-auto mb-4 h-8 w-8 text-mermaid-cyan" />
          <h1 className="text-2xl font-bold">商图精修正在升级中</h1>
          <p className="mt-3 text-sm text-white/60">
            {IMAGE_FACTORY_UPGRADING_MESSAGE}，本次先开放单图生成和多图生成。
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶部：标题和模式切换 - Titanium Bar */}
      <div className="border-b border-white/5 bg-[#050505]/80 backdrop-blur-xl sticky top-0 z-10 transition-all duration-500">
        <div className="px-6 py-4">
          {/* 标题 */}
          <div className="mb-4 animate-in fade-in slide-in-from-top-4 duration-500">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
              <span className="text-white drop-shadow-lg">商图精修</span>
            </h1>
            <p className="mt-2 text-white/60">
              AI 电商影像处理中心 · E-COMMERCE IMAGING CENTER
            </p>
          </div>

          {/* 模式切换 Tabs - JCUI 2.0 Mermaid Glass Pills */}
          <Tabs value={currentMode} onValueChange={handleModeChange} className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
            <TabsList className="grid grid-cols-5 w-full max-w-4xl bg-[#0B0C10]/80 border border-white/10 h-12 p-1.5 rounded-2xl backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              {(Object.keys(ECOM_MODE_CONFIG) as EcomImageMode[]).map((mode) => (
                <TabsTrigger
                  key={mode}
                  value={mode}
                  className="relative flex items-center justify-center gap-2 text-xs font-bold transition-all duration-300 rounded-xl overflow-hidden
                    text-white/40 hover:text-white/70 hover:bg-white/5
                    data-[state=active]:text-black data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#CCFF00] data-[state=active]:via-[#00F2EA] data-[state=active]:to-[#CCFF00]
                    data-[state=active]:shadow-[0_0_20px_rgba(204,255,0,0.3),inset_0_1px_0_rgba(255,255,255,0.3)]
                    data-[state=active]:border-0"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {MODE_ICONS[mode]}
                    <span className="hidden sm:inline">
                      {ECOM_MODE_CONFIG[mode].title}
                    </span>
                    <span className="sm:hidden">
                      {ECOM_MODE_CONFIG[mode].title.slice(0, 4)}
                    </span>
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* 主内容区：三栏布局 */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-12 gap-3 p-3">
          {/* 左侧面板：素材 & 参数 */}
          <Card className="col-span-12 lg:col-span-3 overflow-hidden flex flex-col bg-transparent border-0 shadow-none">
            <LeftPanel />
          </Card>

          {/* 中间面板：步骤流 */}
          <Card className="col-span-12 lg:col-span-4 overflow-hidden flex flex-col bg-transparent border-0 shadow-none">
            <CenterPanel />
          </Card>

          {/* 右侧面板：结果预览 */}
          <Card className="col-span-12 lg:col-span-5 overflow-hidden flex flex-col bg-transparent border-0 shadow-none">
            <RightPanel />
          </Card>
        </div>
      </div>
    </div>
  );
}
