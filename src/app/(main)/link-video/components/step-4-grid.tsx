"use client";

/**
 * Step 4: 生成九宫格图片
 */

import { useState, useEffect, useCallback } from "react";
import { useLinkVideoStore } from "@/stores/link-video-store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Loader2,
  Check,
  Grid3X3,
  AlertCircle,
  Download,
  ZoomIn,
} from "lucide-react";

export function Step4Grid() {
  const {
    currentJob,
    primaryImageUrl,
    gridImageUrl,
    isGeneratingGrid,
    startGenerateGrid,
    setGridGenerated,
    setGridTaskId,
    setGridError,
    gridError,
    gridTaskId,
    prevStep,
    nextStep,
  } = useLinkVideoStore();

  const [isPolling, setIsPolling] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // 生成九宫格
  const handleGenerateGrid = async (retry = false) => {
    if (!currentJob?.id) {
      setGridError("任务不存在，请返回上一步");
      return;
    }

    startGenerateGrid();

    try {
      const response = await fetch(`/api/link-video/jobs/${currentJob.id}/grid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retry }),
      });

      const result = await response.json();

      if (result.success && result.task_id) {
        setGridTaskId(result.task_id);
        setIsPolling(true);
      } else {
        setGridError(result.error || "九宫格生成失败");
      }
    } catch (error) {
      setGridError("网络错误，请稍后重试");
    }
  };

  // 轮询状态
  const pollStatus = useCallback(async () => {
    if (!currentJob?.id || !isPolling) return;

    try {
      const response = await fetch(`/api/link-video/jobs/${currentJob.id}/grid`);
      const result = await response.json();

      if (result.status === "completed" && result.grid_image_url) {
        setGridGenerated(result.grid_image_url);
        setIsPolling(false);
      } else if (result.status === "failed") {
        setGridError(result.error || "九宫格生成失败");
        setIsPolling(false);
      }
      // processing 状态继续轮询
    } catch (error) {
      console.error("Poll error:", error);
    }
  }, [currentJob?.id, isPolling, setGridGenerated, setGridError]);

  // 轮询效果
  useEffect(() => {
    if (!isPolling) return;

    const interval = setInterval(pollStatus, 5000);
    // 立即执行一次
    pollStatus();

    return () => clearInterval(interval);
  }, [isPolling, pollStatus]);

  const canProceed = gridImageUrl !== null;

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h2 className="text-xl font-semibold">生成九宫格图片</h2>
        <p className="text-sm text-muted-foreground mt-1">
          AI 根据主图生成多角度产品展示图
        </p>
      </div>

      {/* 主图预览 */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={primaryImageUrl || ""}
              alt="主图"
              className="h-24 w-24 rounded-lg object-cover"
            />
          </div>
          <div>
            <p className="text-sm font-medium">选中的主图</p>
            <p className="text-xs text-muted-foreground mt-1">
              将基于此图生成 3×3 多角度九宫格
            </p>
          </div>
        </div>
      </Card>

      {/* 生成状态 */}
      {!gridImageUrl && !isGeneratingGrid && !isPolling && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8">
          <Grid3X3 className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">点击下方按钮生成九宫格</p>
          <Button
            onClick={() => handleGenerateGrid(false)}
            className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
          >
            <Grid3X3 className="mr-2 h-4 w-4" />
            生成九宫格
          </Button>
        </div>
      )}

      {(isGeneratingGrid || isPolling) && (
        <div className="flex flex-col items-center justify-center rounded-lg border p-8">
          <Loader2 className="h-8 w-8 animate-spin text-tiktok-pink mb-4" />
          <p className="text-muted-foreground">正在生成九宫格图片...</p>
          <p className="text-xs text-muted-foreground mt-1">
            使用 Nano Banana Pro 生成，预计 30-60 秒
          </p>
        </div>
      )}

      {gridError && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p>{gridError}</p>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-destructive"
              onClick={() => handleGenerateGrid(true)}
            >
              重试
            </Button>
          </div>
        </div>
      )}

      {/* 九宫格结果 */}
      {gridImageUrl && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500" />
              <span className="font-medium">九宫格生成完成</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPreview(true)}
              >
                <ZoomIn className="mr-1 h-3 w-3" />
                放大
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={gridImageUrl} download target="_blank" rel="noopener noreferrer">
                  <Download className="mr-1 h-3 w-3" />
                  下载
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleGenerateGrid(true)}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                重新生成
              </Button>
            </div>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gridImageUrl}
            alt="九宫格"
            className="w-full rounded-lg border cursor-pointer"
            onClick={() => setShowPreview(true)}
          />

          <p className="text-xs text-muted-foreground">
            九宫格将作为视频生成的参考图，展示产品多角度细节
          </p>
        </div>
      )}

      {/* 放大预览弹窗 */}
      {showPreview && gridImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setShowPreview(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gridImageUrl}
            alt="九宫格预览"
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
          />
        </div>
      )}

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={prevStep}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          上一步
        </Button>
        <Button
          onClick={nextStep}
          disabled={!canProceed}
          className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
        >
          下一步：生成视频
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}




