"use client";

/**
 * Step 1: 链接输入与解析
 * 
 * 支持三种模式：
 * 1. 自动解析（服务端）
 * 2. 浏览器提取（用户打开商品页面，点击提取）
 * 3. 手动输入
 */

import { useState, useRef, useCallback } from "react";
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
  Globe,
  Copy,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORM_NAMES, detectPlatform } from "@/types/link-video";
import type { ProductImage, ParsedProductData } from "@/types/link-video";

// 浏览器提取脚本 - 用户复制到浏览器控制台执行
const EXTRACT_SCRIPT = `
(function() {
  const data = {
    title: document.title || document.querySelector('h1')?.innerText || '',
    description: document.querySelector('meta[name="description"]')?.content || '',
    price: '',
    images: []
  };
  
  // 提取价格
  const pricePatterns = [
    /[¥$]\\s*([\\d,.]+)/,
    /price[^>]*>([^<]*[\\d,.]+[^<]*)</i
  ];
  const bodyText = document.body.innerText;
  for (const p of pricePatterns) {
    const m = bodyText.match(p);
    if (m) { data.price = m[1]; break; }
  }
  
  // 提取图片
  const imgs = document.querySelectorAll('img[src*="http"]');
  imgs.forEach(img => {
    if (img.width > 200 && img.height > 200) {
      data.images.push(img.src);
    }
  });
  data.images = [...new Set(data.images)].slice(0, 5);
  
  // 复制到剪贴板
  const json = JSON.stringify(data, null, 2);
  navigator.clipboard.writeText('TOKFACTORY_DATA:' + json);
  alert('商品数据已复制！请返回 Tok Factory 粘贴');
  return data;
})();
`;

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
  const [showBrowserMode, setShowBrowserMode] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 从剪贴板粘贴提取的数据
  const handlePasteExtractedData = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith('TOKFACTORY_DATA:')) {
        const jsonStr = text.replace('TOKFACTORY_DATA:', '');
        const data = JSON.parse(jsonStr);
        
        // 转换为 ParsedProductData 格式
        const parsedData: ParsedProductData = {
          title: data.title || '商品',
          selling_points: data.description ? data.description.split(/[。，,;；]/).filter((s: string) => s.trim()) : [],
          price: { current: data.price || '0' },
          images: (data.images || []).map((url: string, idx: number) => ({
            url,
            type: idx === 0 ? 'main' : 'detail',
            selected: true,
            is_primary: idx === 0,
          })),
        };

        setParsedData(parsedData, null);
        setShowBrowserMode(false);
      } else {
        alert('剪贴板中没有检测到商品数据，请先在商品页面执行提取脚本');
      }
    } catch (error) {
      alert('读取剪贴板失败，请检查浏览器权限');
    }
  }, [setParsedData]);

  // 复制提取脚本
  const copyExtractScript = useCallback(() => {
    navigator.clipboard.writeText(EXTRACT_SCRIPT);
    alert('脚本已复制！请在商品页面按 F12 打开控制台，粘贴执行');
  }, []);

  // 处理图片上传
  const handleImageUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setUploadingImage(true);
    const newImages: string[] = [...manualImages];

    for (const file of Array.from(files).slice(0, 3 - manualImages.length)) {
      try {
        // 上传到服务器
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/upload/image', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();
        if (result.success && result.data?.url) {
          newImages.push(result.data.url);
        }
      } catch (error) {
        console.error('Upload error:', error);
      }
    }

    setManualImages(newImages);
    
    // 更新 selectedImages
    const productImages: ProductImage[] = newImages.map((url, idx) => ({
      url,
      type: idx === 0 ? 'main' : 'detail',
      selected: true,
      is_primary: idx === 0,
    }));
    setSelectedImages(productImages);
    
    setUploadingImage(false);
  }, [manualImages, setSelectedImages]);

  // 处理图片 URL 输入
  const handleImageUrlAdd = useCallback((url: string) => {
    if (!url.trim() || manualImages.length >= 3) return;
    
    const newImages = [...manualImages, url.trim()];
    setManualImages(newImages);
    
    const productImages: ProductImage[] = newImages.map((u, idx) => ({
      url: u,
      type: idx === 0 ? 'main' : 'detail',
      selected: true,
      is_primary: idx === 0,
    }));
    setSelectedImages(productImages);
  }, [manualImages, setSelectedImages]);

  const [imageUrlInput, setImageUrlInput] = useState("");

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

          {/* 错误提示 - 增强版 */}
          {parseError && (
            <div className="rounded-lg bg-destructive/10 p-4 space-y-3">
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>{parseError}</p>
              </div>
              
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">无法解析？试试以下方法：</p>
                <div className="grid gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => setShowBrowserMode(true)}
                  >
                    <Globe className="h-4 w-4 mr-2" />
                    方法1：浏览器提取（推荐）
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={enableManualMode}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    方法2：手动输入
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 浏览器提取模式 */}
      {showBrowserMode && (
        <Card className="p-4 border-blue-500/30 bg-blue-500/5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-500" />
              <span className="font-medium">浏览器提取模式</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBrowserMode(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-sm space-y-3">
            <p className="text-muted-foreground">
              通过您的浏览器直接提取商品数据，像平时浏览一样获取信息：
            </p>

            <ol className="space-y-3 text-muted-foreground">
              <li className="flex items-start gap-2">
                <Badge className="shrink-0 mt-0.5">1</Badge>
                <div>
                  <span>打开商品页面（</span>
                  {inputUrl ? (
                    <a
                      href={inputUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline inline-flex items-center gap-1"
                    >
                      点击前往 <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span>淘宝、京东、TikTok Shop 等</span>
                  )}
                  <span>）</span>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Badge className="shrink-0 mt-0.5">2</Badge>
                <div className="flex-1">
                  <span>按 F12 打开控制台，粘贴脚本并执行</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ml-2"
                    onClick={copyExtractScript}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    复制脚本
                  </Button>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Badge className="shrink-0 mt-0.5">3</Badge>
                <div className="flex-1">
                  <span>回到这里点击粘贴数据</span>
                  <Button
                    variant="default"
                    size="sm"
                    className="ml-2 bg-blue-500 hover:bg-blue-600"
                    onClick={handlePasteExtractedData}
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    粘贴数据
                  </Button>
                </div>
              </li>
            </ol>
          </div>
        </Card>
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
              <Label>商品图片（最多 3 张）</Label>
              
              {/* 已上传的图片预览 */}
              {manualImages.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {manualImages.map((img, idx) => (
                    <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={`商品图 ${idx + 1}`} className="h-full w-full object-cover" />
                      <button
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                        onClick={() => {
                          const newImages = manualImages.filter((_, i) => i !== idx);
                          setManualImages(newImages);
                          setSelectedImages(newImages.map((u, i) => ({
                            url: u, type: i === 0 ? 'main' : 'detail', selected: true, is_primary: i === 0
                          })));
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                      {idx === 0 && (
                        <span className="absolute bottom-1 left-1 text-[10px] bg-amber-500 text-white px-1 rounded">主图</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 上传区域 */}
              {manualImages.length < 3 && (
                <div className="mt-2 space-y-3">
                  {/* 文件上传 */}
                  <div 
                    className="flex items-center justify-center rounded-lg border border-dashed p-4 text-center cursor-pointer hover:border-primary transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleImageUpload(e.target.files)}
                    />
                    <div className="space-y-1">
                      {uploadingImage ? (
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                      ) : (
                        <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
                      )}
                      <p className="text-xs text-muted-foreground">
                        点击上传图片 (JPG/PNG)
                      </p>
                    </div>
                  </div>

                  {/* 图片URL输入 */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="或粘贴图片 URL"
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      className="text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        handleImageUrlAdd(imageUrlInput);
                        setImageUrlInput("");
                      }}
                      disabled={!imageUrlInput.trim()}
                    >
                      添加
                    </Button>
                  </div>
                </div>
              )}
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

