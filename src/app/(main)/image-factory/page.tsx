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

  return (
    <div className="h-full flex flex-col">
      {/* 顶部：标题和模式切换 */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-6 py-4">
          {/* 标题 */}
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-pink-500">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">电商图片工厂</h1>
              <p className="text-sm text-muted-foreground">
                AI 驱动的电商图片一站式生成工具
              </p>
            </div>
          </div>

          {/* 模式切换 Tabs */}
          <Tabs value={currentMode} onValueChange={handleModeChange}>
            <TabsList className="grid grid-cols-5 w-full max-w-3xl">
              {(Object.keys(ECOM_MODE_CONFIG) as EcomImageMode[]).map((mode) => (
                <TabsTrigger
                  key={mode}
                  value={mode}
                  className="flex items-center gap-2 text-xs sm:text-sm"
                >
                  {MODE_ICONS[mode]}
                  <span className="hidden sm:inline">
                    {ECOM_MODE_CONFIG[mode].title}
                  </span>
                  <span className="sm:hidden">
                    {ECOM_MODE_CONFIG[mode].title.slice(0, 4)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* 主内容区：三栏布局 */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-12 gap-4 p-4">
          {/* 左侧面板：素材 & 参数 */}
          <Card className="col-span-12 lg:col-span-3 overflow-hidden flex flex-col">
            <LeftPanel />
          </Card>

          {/* 中间面板：步骤流 */}
          <Card className="col-span-12 lg:col-span-4 overflow-hidden flex flex-col">
            <CenterPanel />
          </Card>

          {/* 右侧面板：结果预览 */}
          <Card className="col-span-12 lg:col-span-5 overflow-hidden flex flex-col">
            <RightPanel />
          </Card>
        </div>
      </div>
    </div>
  );
}


