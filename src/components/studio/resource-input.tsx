"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Upload,
  Sparkles,
  Zap,
  ImagePlus,
} from "lucide-react";
import { DirectUpload } from "./direct-upload";
import { NanoBananaEnhance } from "./nano-banana-enhance";
import type { TaskData } from "./task-card";
import type { VideoDuration, AspectRatio } from "@/types/database";

// ============================================================================
// 类型定义
// ============================================================================

export interface ResourceInputProps {
  // 全局配置
  duration: VideoDuration;
  aspectRatio: AspectRatio;
  useModel: boolean;
  selectedModelId?: string | null;
  nanoBananaVersion: "V1" | "V2";
  
  // 回调
  onAddTasks: (tasks: Omit<TaskData, "id" | "status" | "costCredits">[]) => void;
  
  // 禁用状态
  disabled?: boolean;
}

// ============================================================================
// Resource Input 组件
// ============================================================================

export function ResourceInput({
  duration,
  aspectRatio,
  useModel,
  selectedModelId,
  nanoBananaVersion,
  onAddTasks,
  disabled = false,
}: ResourceInputProps) {
  const [activeTab, setActiveTab] = useState<"direct" | "nanoBanana">("direct");

  // 处理直接上传的图片
  const handleDirectUpload = useCallback((files: File[]) => {
    const newTasks = files.map((file) => ({
      imageUrl: URL.createObjectURL(file),
      imageName: file.name,
      prompt: "",
      duration,
      aspectRatio,
    }));
    onAddTasks(newTasks);
  }, [duration, aspectRatio, onAddTasks]);

  // 处理 Nano Banana 选中的图片
  const handleNanoBananaSelect = useCallback((selectedImages: { url: string; name: string }[]) => {
    const newTasks = selectedImages.map((img) => ({
      imageUrl: img.url,
      imageName: img.name,
      prompt: "",
      duration,
      aspectRatio,
    }));
    onAddTasks(newTasks);
  }, [duration, aspectRatio, onAddTasks]);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "direct" | "nanoBanana")}>
        {/* Tab 选择器 */}
        <CardHeader className="pb-0 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <ImagePlus className="h-5 w-5 text-tiktok-cyan" />
                素材输入 Resource Input
              </CardTitle>
              <CardDescription className="mt-1">
                选择一种模式添加素材到备料台
              </CardDescription>
            </div>
          </div>
          
          <TabsList className="mt-4 grid w-full grid-cols-2 bg-black/30 p-1 h-auto">
            <TabsTrigger
              value="direct"
              disabled={disabled}
              className={cn(
                "flex items-center gap-2 py-3 px-4 data-[state=active]:bg-gradient-to-r data-[state=active]:from-tiktok-cyan/20 data-[state=active]:to-tiktok-cyan/10",
                "data-[state=active]:text-tiktok-cyan data-[state=active]:shadow-[0_0_20px_rgba(0,242,234,0.2)]"
              )}
            >
              <Zap className="h-4 w-4" />
              <div className="text-left">
                <p className="font-semibold">Direct Upload</p>
                <p className="text-xs opacity-70">Fast Mode - 直接上传</p>
              </div>
            </TabsTrigger>
            
            <TabsTrigger
              value="nanoBanana"
              disabled={disabled}
              className={cn(
                "flex items-center gap-2 py-3 px-4 data-[state=active]:bg-gradient-to-r data-[state=active]:from-tiktok-pink/20 data-[state=active]:to-tiktok-pink/10",
                "data-[state=active]:text-tiktok-pink data-[state=active]:shadow-[0_0_20px_rgba(255,0,80,0.2)]"
              )}
            >
              <Sparkles className="h-4 w-4" />
              <div className="text-left">
                <p className="font-semibold">Nano Banana AI</p>
                <p className="text-xs opacity-70">Enhance Mode - 九宫格增强</p>
              </div>
            </TabsTrigger>
          </TabsList>
        </CardHeader>

        <CardContent className="p-6">
          {/* 模式 A: Direct Upload */}
          <TabsContent value="direct" className="mt-0">
            <DirectUpload
              onUpload={handleDirectUpload}
              disabled={disabled}
            />
          </TabsContent>

          {/* 模式 B: Nano Banana AI */}
          <TabsContent value="nanoBanana" className="mt-0">
            <NanoBananaEnhance
              version={nanoBananaVersion}
              onSelect={handleNanoBananaSelect}
              disabled={disabled}
            />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

export default ResourceInput;

