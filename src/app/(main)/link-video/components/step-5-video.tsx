"use client";

/**
 * Step 5: 生成最终视频
 */

import { useState, useEffect, useCallback } from "react";
import { useLinkVideoStore } from "@/stores/link-video-store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Video,
  Loader2,
  Check,
  AlertCircle,
  Download,
  Share2,
  Play,
  RefreshCw,
  PartyPopper,
} from "lucide-react";
import { getLinkVideoCredits } from "@/types/link-video";

export function Step5Video() {
  const {
    currentJob,
    videoConfig,
    gridImageUrl,
    scriptText,
    videoUrl,
    isGeneratingVideo,
    startGenerateVideo,
    setVideoGenerated,
    setVideoTaskId,
    setVideoProgress,
    setVideoError,
    videoError,
    videoProgress,
    videoTaskId,
    prevStep,
    reset,
  } = useLinkVideoStore();

  const [isPolling, setIsPolling] = useState(false);

  // 生成视频
  const handleGenerateVideo = async (retry = false) => {
    if (!currentJob?.id) {
      setVideoError("任务不存在，请返回上一步");
      return;
    }

    startGenerateVideo();

    try {
      const response = await fetch(`/api/link-video/jobs/${currentJob.id}/video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retry }),
      });

      const result = await response.json();

      if (result.success && result.task_id) {
        setVideoTaskId(result.task_id);
        setIsPolling(true);
      } else {
        setVideoError(result.error || "视频生成失败");
      }
    } catch (error) {
      setVideoError("网络错误，请稍后重试");
    }
  };

  // 轮询状态
  const pollStatus = useCallback(async () => {
    if (!currentJob?.id || !isPolling) return;

    try {
      const response = await fetch(`/api/link-video/jobs/${currentJob.id}/video`);
      const result = await response.json();

      if (result.status === "completed" && result.video_url) {
        setVideoGenerated(result.video_url);
        setIsPolling(false);
      } else if (result.status === "failed") {
        setVideoError(result.error || "视频生成失败");
        setIsPolling(false);
      } else if (result.progress !== undefined) {
        setVideoProgress(result.progress);
      }
    } catch (error) {
      console.error("Poll error:", error);
    }
  }, [currentJob?.id, isPolling, setVideoGenerated, setVideoError, setVideoProgress]);

  // 轮询效果
  useEffect(() => {
    if (!isPolling) return;

    const interval = setInterval(pollStatus, 10000); // 10秒轮询
    pollStatus();

    return () => clearInterval(interval);
  }, [isPolling, pollStatus]);

  const credits = getLinkVideoCredits(videoConfig.duration);

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h2 className="text-xl font-semibold">生成最终视频</h2>
        <p className="text-sm text-muted-foreground mt-1">
          AI 将脚本和九宫格合成为带货视频
        </p>
      </div>

      {/* 生成配置摘要 */}
      <Card className="p-4 bg-muted/30">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">视频时长</p>
            <p className="font-medium">{videoConfig.duration} 秒</p>
          </div>
          <div>
            <p className="text-muted-foreground">画幅比例</p>
            <p className="font-medium">{videoConfig.aspect_ratio}</p>
          </div>
          <div>
            <p className="text-muted-foreground">消耗积分</p>
            <p className="font-medium text-tiktok-pink">{credits} 积分</p>
          </div>
        </div>
      </Card>

      {/* 生成状态 */}
      {!videoUrl && !isGeneratingVideo && !isPolling && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8">
          <Video className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-2">准备就绪，开始生成视频</p>
          <p className="text-xs text-muted-foreground mb-4">
            生成 {videoConfig.duration} 秒视频，预计需要 3-15 分钟
          </p>
          <Button
            onClick={() => handleGenerateVideo(false)}
            size="lg"
            className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
          >
            <Video className="mr-2 h-5 w-5" />
            开始生成（{credits} 积分）
          </Button>
        </div>
      )}

      {(isGeneratingVideo || isPolling) && (
        <div className="flex flex-col items-center justify-center rounded-lg border p-8">
          <Loader2 className="h-10 w-10 animate-spin text-tiktok-cyan mb-4" />
          <p className="font-medium mb-2">正在生成视频...</p>
          
          {/* 进度条 */}
          <div className="w-full max-w-xs mb-4">
            <Progress value={videoProgress} className="h-2" />
            <p className="text-center text-sm text-muted-foreground mt-1">
              {videoProgress}%
            </p>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            使用 {videoConfig.duration === 10 ? "Sora2" : "Sora2 Pro"} 模型生成
            <br />
            预计需要 3-15 分钟，请耐心等待
          </p>
        </div>
      )}

      {videoError && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p>{videoError}</p>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-destructive"
              onClick={() => handleGenerateVideo(true)}
            >
              重试
            </Button>
          </div>
        </div>
      )}

      {/* 视频结果 */}
      {videoUrl && (
        <div className="space-y-4">
          {/* 成功提示 */}
          <div className="flex items-center justify-center gap-2 text-green-500">
            <PartyPopper className="h-6 w-6" />
            <span className="text-xl font-bold">视频生成成功！</span>
            <PartyPopper className="h-6 w-6" />
          </div>

          {/* 视频播放器 */}
          <Card className="overflow-hidden">
            <div className="relative aspect-video bg-black">
              <video
                src={videoUrl}
                controls
                className="h-full w-full"
                poster={gridImageUrl || undefined}
              />
            </div>
          </Card>

          {/* 操作按钮 */}
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild>
              <a href={videoUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                下载视频
              </a>
            </Button>
            <Button variant="outline">
              <Share2 className="mr-2 h-4 w-4" />
              分享
            </Button>
            <Button variant="outline" onClick={() => handleGenerateVideo(true)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              重新生成
            </Button>
          </div>

          {/* 再创建一个 */}
          <Card className="p-4 bg-gradient-to-r from-tiktok-cyan/10 to-tiktok-pink/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">继续创作</p>
                <p className="text-sm text-muted-foreground">
                  用新的商品链接生成另一个视频
                </p>
              </div>
              <Button
                variant="outline"
                onClick={reset}
              >
                新建任务
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={prevStep} disabled={isGeneratingVideo || isPolling}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          上一步
        </Button>
        
        {videoUrl && (
          <Button
            onClick={reset}
            className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
          >
            创建新任务
          </Button>
        )}
      </div>
    </div>
  );
}


