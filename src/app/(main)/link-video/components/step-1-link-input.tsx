"use client";

/**
 * Step 1: 链接输入与解析
 */

import { useState } from "react";
import { useLinkVideoStore } from "@/stores/link-video-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Link2, 
  Search, 
  Loader2, 
  Check, 
  X, 
  Upload,
  AlertCircle,
  ArrowRight,
  ImageIcon,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORM_NAMES, detectPlatform } from "@/types/link-video";
import type { ProductImage } from "@/types/link-video";

export function Step1LinkInput() {
  const {
    inputUrl,
    setInputUrl,
    isParsingLink,
    startParseLink,
    setParsedData,
    setParseError,
    parseError,
    parsedData,
    selectedImages,
    primaryImageUrl,
    toggleImageSelection,
    setPrimaryImage,
    setSelectedImages,
    isManualMode,
    enableManualMode,
    setManualProductInfo,
    nextStep,
  } = useLinkVideoStore();

  const [manualTitle, setManualTitle] = useState("");
  const [manualPoints, setManualPoints] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualImages, setManualImages] = useState<string[]>([]);

  // 解析链接
  const handleParseLink = async () => {
    if (!inputUrl.trim()) return;

    startParseLink();

    try {
      const response = await fetch("/api/link-video/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputUrl }),
      });

      const result = await response.json();

      if (result.success && result.data) {
        setParsedData(result.data.parsed_data, result.data.product_link_id);
      } else {
        setParseError(result.error || "解析失败");
      }
    } catch (error) {
      setParseError("网络错误，请稍后重试");
    }
  };

  // 提交手动输入
  const handleManualSubmit = () => {
    if (!manualTitle.trim()) return;

    setManualProductInfo({
      title: manualTitle,
      selling_points: manualPoints,
      price: manualPrice,
      images: manualImages,
    });
  };

  // 检查是否可以继续
  const canProceed = 
    (parsedData !== null || (isManualMode && manualTitle.trim())) &&
    primaryImageUrl !== null;

  // 获取平台信息
  const platform = inputUrl ? detectPlatform(inputUrl) : null;

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h2 className="text-xl font-semibold">粘贴商品链接</h2>
        <p className="text-sm text-muted-foreground mt-1">
          支持抖音、淘宝、京东、天猫、TikTok、亚马逊等平台
        </p>
      </div>

      {/* 链接输入 */}
      {!isManualMode && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="粘贴商品链接..."
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="pl-10"
                onKeyDown={(e) => e.key === "Enter" && handleParseLink()}
              />
              {platform && platform !== "other" && (
                <Badge 
                  variant="secondary" 
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  {PLATFORM_NAMES[platform]}
                </Badge>
              )}
            </div>
            <Button
              onClick={handleParseLink}
              disabled={!inputUrl.trim() || isParsingLink}
              className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
            >
              {isParsingLink ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span className="ml-2">解析</span>
            </Button>
          </div>

          {/* 错误提示 */}
          {parseError && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p>{parseError}</p>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-destructive underline"
                  onClick={enableManualMode}
                >
                  改用手动输入
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 解析结果 */}
      {parsedData && (
        <Card className="p-4 border-tiktok-cyan/30 bg-tiktok-cyan/5">
          <div className="flex items-start gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <Check className="h-5 w-5 text-tiktok-cyan" />
                <span className="font-medium text-tiktok-cyan">解析成功</span>
              </div>
              
              <h3 className="font-semibold line-clamp-2">{parsedData.title}</h3>
              
              {parsedData.selling_points.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {parsedData.selling_points.slice(0, 3).map((point, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {point.length > 20 ? point.slice(0, 20) + "..." : point}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="text-lg font-bold text-tiktok-pink">
                ¥{parsedData.price.current}
                {parsedData.price.original && (
                  <span className="ml-2 text-sm text-muted-foreground line-through">
                    ¥{parsedData.price.original}
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 图片选择 */}
      {(parsedData || isManualMode) && selectedImages.length > 0 && (
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            选择商品图片
            <span className="text-xs text-muted-foreground">
              (点击星标设为主图，用于生成九宫格)
            </span>
          </Label>
          
          <div className="grid grid-cols-3 gap-3">
            {selectedImages.map((img, index) => (
              <div
                key={img.url}
                className={cn(
                  "relative aspect-square rounded-lg overflow-hidden border-2 cursor-pointer transition-all",
                  img.is_primary && "border-amber-500 ring-2 ring-amber-500/30",
                  img.selected && !img.is_primary && "border-tiktok-cyan",
                  !img.selected && "border-transparent opacity-50"
                )}
                onClick={() => toggleImageSelection(img.url)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={`商品图 ${index + 1}`}
                  className="h-full w-full object-cover"
                />
                
                {/* 主图标记 */}
                {img.is_primary && (
                  <div className="absolute top-1 left-1 rounded bg-amber-500 px-1.5 py-0.5 text-xs font-medium text-white">
                    主图
                  </div>
                )}
                
                {/* 选中标记 */}
                {img.selected && (
                  <div className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-tiktok-cyan text-white">
                    <Check className="h-4 w-4" />
                  </div>
                )}

                {/* 设为主图按钮 */}
                <button
                  className={cn(
                    "absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full transition-all",
                    img.is_primary 
                      ? "bg-amber-500 text-white" 
                      : "bg-black/50 text-white hover:bg-amber-500"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPrimaryImage(img.url);
                  }}
                >
                  <Star className={cn("h-3.5 w-3.5", img.is_primary && "fill-current")} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 手动输入模式 */}
      {isManualMode && (
        <div className="space-y-4 rounded-lg border border-dashed p-4">
          <div className="flex items-center justify-between">
            <Label>手动输入商品信息</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                useLinkVideoStore.getState().reset();
              }}
            >
              <X className="h-4 w-4 mr-1" />
              取消
            </Button>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="manual-title">商品标题 *</Label>
              <Input
                id="manual-title"
                placeholder="输入商品标题"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="manual-points">卖点描述</Label>
              <Textarea
                id="manual-points"
                placeholder="输入商品卖点，用逗号或换行分隔"
                value={manualPoints}
                onChange={(e) => setManualPoints(e.target.value)}
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="manual-price">价格</Label>
              <Input
                id="manual-price"
                placeholder="输入价格，如 99.00"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
              />
            </div>

            <div>
              <Label>上传商品图片</Label>
              <div className="mt-2 flex items-center justify-center rounded-lg border border-dashed p-6 text-center">
                <div className="space-y-2">
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    点击上传或拖拽图片到此处
                  </p>
                  <p className="text-xs text-muted-foreground">
                    支持 JPG、PNG，最多 3 张
                  </p>
                </div>
              </div>
            </div>

            <Button onClick={handleManualSubmit} disabled={!manualTitle.trim()}>
              确认
            </Button>
          </div>
        </div>
      )}

      {/* 下一步按钮 */}
      <div className="flex justify-end pt-4 border-t">
        <Button
          onClick={nextStep}
          disabled={!canProceed}
          className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
        >
          下一步：配置参数
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

