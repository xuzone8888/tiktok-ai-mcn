"use client";

/**
 * 左侧面板 - 图片上传和参数设置
 */

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { 
  Upload, 
  X, 
  Image as ImageIcon,
  Settings2,
  Trash2,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useImageFactoryStore, useTaskCredits, useCanStartTask } from "@/stores/image-factory-store";
import { 
  ECOM_MODE_CONFIG,
  ASPECT_RATIO_OPTIONS,
  RESOLUTION_OPTIONS,
  PRODUCT_CATEGORY_OPTIONS,
  SCENE_TYPE_OPTIONS,
  TRY_ON_PRODUCT_OPTIONS,
  BUYER_SHOW_STYLE_OPTIONS,
  PERSONA_AGE_OPTIONS,
  PERSONA_GENDER_OPTIONS,
  PERSONA_REGION_OPTIONS,
  type UploadedImage,
  type EcomAspectRatio,
  type EcomResolution,
  type ProductCategory,
  type SceneType,
  type TryOnProductType,
  type BuyerShowStyle,
  type PersonaAge,
  type PersonaGender,
  type PersonaRegion,
} from "@/types/ecom-image";
import { cn } from "@/lib/utils";

export function LeftPanel() {
  const {
    currentMode,
    modelType,
    setModelType,
    language,
    setLanguage,
    ratio,
    setRatio,
    resolution,
    setResolution,
    isOneClick,
    setIsOneClick,
    uploadedImages,
    addImages,
    removeImage,
    clearImages,
    // 模式配置
    ecomFivePackConfig,
    updateEcomFivePackConfig,
    sceneImageConfig,
    updateSceneImageConfig,
    tryOnConfig,
    updateTryOnConfig,
    buyerShowConfig,
    updateBuyerShowConfig,
  } = useImageFactoryStore();

  const taskCredits = useTaskCredits();
  const canStartTask = useCanStartTask();
  const modeConfig = ECOM_MODE_CONFIG[currentMode];

  // 图片上传处理
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newImages: UploadedImage[] = [];

    for (const file of acceptedFiles) {
      // 验证文件类型
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} 不是有效的图片文件`);
        continue;
      }

      // 验证文件大小 (最大 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} 超过 10MB 大小限制`);
        continue;
      }

      // 创建预览 URL
      const url = URL.createObjectURL(file);
      
      // 获取图片尺寸
      const dimensions = await getImageDimensions(url);

      newImages.push({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        url,
        name: file.name,
        width: dimensions.width,
        height: dimensions.height,
        size: file.size,
      });
    }

    if (newImages.length > 0) {
      addImages(newImages);
      toast.success(`已添加 ${newImages.length} 张图片`);
    }
  }, [addImages]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp"],
    },
    maxFiles: 10,
  });

  // 获取图片尺寸
  const getImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = () => {
        resolve({ width: 0, height: 0 });
      };
      img.src = url;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* 标题 */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">素材 & 参数</span>
        </div>
        {uploadedImages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearImages}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            清空
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* 图片上传区域 */}
          <div className="space-y-3">
            <Label>上传产品图片</Label>
            <div
              {...getRootProps()}
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              )}
            >
              <input {...getInputProps()} />
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isDragActive ? "松开以上传图片" : "拖拽或点击上传图片"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                支持 PNG、JPG、WEBP，最大 10MB
              </p>
            </div>

            {/* 已上传图片列表 */}
            {uploadedImages.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {uploadedImages.map((image, index) => (
                  <div
                    key={image.id}
                    className="relative group aspect-square rounded-lg overflow-hidden border"
                  >
                    <img
                      src={image.url}
                      alt={image.name}
                      className="w-full h-full object-cover"
                    />
                    {/* 序号标记 */}
                    <div className="absolute top-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                      {index + 1}
                    </div>
                    {/* 删除按钮 */}
                    <button
                      onClick={() => removeImage(image.id)}
                      className="absolute top-1 right-1 bg-red-500/80 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {/* 尺寸信息 */}
                    {image.width && image.height && (
                      <div className="absolute bottom-1 left-1 right-1 bg-black/60 text-white text-xs px-1 py-0.5 rounded truncate">
                        {image.width}×{image.height}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 分隔线 */}
          <div className="border-t" />

          {/* 模型选择 */}
          <div className="space-y-3">
            <Label>图片模型</Label>
            <RadioGroup
              value={modelType}
              onValueChange={(v) => setModelType(v as "nano-banana" | "nano-banana-pro")}
              className="grid grid-cols-2 gap-2"
            >
              <Label
                htmlFor="nano-banana"
                className={cn(
                  "flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors",
                  modelType === "nano-banana" && "border-primary bg-primary/5"
                )}
              >
                <RadioGroupItem value="nano-banana" id="nano-banana" />
                <div>
                  <div className="font-medium text-sm">快速版</div>
                  <div className="text-xs text-muted-foreground">10 积分/张</div>
                </div>
              </Label>
              <Label
                htmlFor="nano-banana-pro"
                className={cn(
                  "flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors",
                  modelType === "nano-banana-pro" && "border-primary bg-primary/5"
                )}
              >
                <RadioGroupItem value="nano-banana-pro" id="nano-banana-pro" />
                <div>
                  <div className="font-medium text-sm">专业版</div>
                  <div className="text-xs text-muted-foreground">28 积分/张</div>
                </div>
              </Label>
            </RadioGroup>
          </div>

          {/* 图片比例 */}
          <div className="space-y-3">
            <Label>图片比例</Label>
            <Select value={ratio} onValueChange={(v) => setRatio(v as EcomAspectRatio)}>
              <SelectTrigger>
                <SelectValue placeholder="选择比例" />
              </SelectTrigger>
              <SelectContent>
                {ASPECT_RATIO_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 输出分辨率 (仅 Pro) */}
          {modelType === "nano-banana-pro" && (
            <div className="space-y-3">
              <Label>输出分辨率</Label>
              <Select value={resolution} onValueChange={(v) => setResolution(v as EcomResolution)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择分辨率" />
                </SelectTrigger>
                <SelectContent>
                  {RESOLUTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 语言选择 */}
          <div className="space-y-3">
            <Label>提示词语言</Label>
            <RadioGroup
              value={language}
              onValueChange={(v) => setLanguage(v as "zh" | "en")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="zh" id="lang-zh" />
                <Label htmlFor="lang-zh" className="cursor-pointer">中文</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="en" id="lang-en" />
                <Label htmlFor="lang-en" className="cursor-pointer">English</Label>
              </div>
            </RadioGroup>
          </div>

          {/* 分隔线 */}
          <div className="border-t" />

          {/* 模式特有配置 */}
          {currentMode === "ecom_five_pack" && (
            <div className="space-y-3">
              <Label>产品类目</Label>
              <Select
                value={ecomFivePackConfig.product_category || "other"}
                onValueChange={(v) => updateEcomFivePackConfig({ product_category: v as ProductCategory })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择类目" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {currentMode === "scene_image" && (
            <div className="space-y-3">
              <Label>场景类型</Label>
              <Select
                value={sceneImageConfig.scene_type}
                onValueChange={(v) => updateSceneImageConfig({ scene_type: v as SceneType })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择场景" />
                </SelectTrigger>
                <SelectContent>
                  {SCENE_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {currentMode === "try_on" && (
            <div className="space-y-3">
              <Label>产品类型</Label>
              <Select
                value={tryOnConfig.product_type}
                onValueChange={(v) => updateTryOnConfig({ product_type: v as TryOnProductType })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  {TRY_ON_PRODUCT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* TODO: 添加模特选择器 */}
              <p className="text-xs text-muted-foreground">
                * 模特选择功能即将上线
              </p>
            </div>
          )}

          {currentMode === "buyer_show" && (
            <div className="space-y-4">
              <div className="space-y-3">
                <Label>拍摄风格</Label>
                <Select
                  value={buyerShowConfig.style}
                  onValueChange={(v) => updateBuyerShowConfig({ style: v as BuyerShowStyle })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择风格" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUYER_SHOW_STYLE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label>买家人设</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Select
                    value={buyerShowConfig.persona?.age || "25-35"}
                    onValueChange={(v) => updateBuyerShowConfig({
                      persona: { ...buyerShowConfig.persona, age: v as PersonaAge }
                    })}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="年龄" />
                    </SelectTrigger>
                    <SelectContent>
                      {PERSONA_AGE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={buyerShowConfig.persona?.gender || "female"}
                    onValueChange={(v) => updateBuyerShowConfig({
                      persona: { ...buyerShowConfig.persona, gender: v as PersonaGender }
                    })}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="性别" />
                    </SelectTrigger>
                    <SelectContent>
                      {PERSONA_GENDER_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={buyerShowConfig.persona?.region || "china"}
                    onValueChange={(v) => updateBuyerShowConfig({
                      persona: { ...buyerShowConfig.persona, region: v as PersonaRegion }
                    })}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="地区" />
                    </SelectTrigger>
                    <SelectContent>
                      {PERSONA_REGION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* 一键模式开关 */}
          {modeConfig.needsPromptGeneration && (
            <>
              <div className="border-t" />
              <div className="flex items-center justify-between">
                <div>
                  <Label>一键完成全部步骤</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    关闭后可手动编辑提示词
                  </p>
                </div>
                <Switch checked={isOneClick} onCheckedChange={setIsOneClick} />
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {/* 底部：积分预估 */}
      <div className="p-4 border-t bg-muted/30">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">预估消耗</span>
          <span className="font-bold text-primary">{taskCredits} 积分</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {currentMode === "ecom_five_pack"
            ? "固定生成 5 张图"
            : `${uploadedImages.length || 1} 张图片 × ${modelType === "nano-banana-pro" ? 28 : 10} 积分`}
        </p>
      </div>
    </div>
  );
}

