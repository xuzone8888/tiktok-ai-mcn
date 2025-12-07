"use client";

/**
 * Step 5: 生成最终视频（支持批量生成）
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
  Plus,
  Minus,
  Copy,
} from "lucide-react";
import { getLinkVideoCredits } from "@/types/link-video";

// 批量视频任务
interface BatchVideoTask {
  id: number;
  status: "pending" | "generating" | "completed" | "failed";
  taskId?: string;
  progress: number;
  videoUrl?: string;
  error?: string;
}

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
  
  // 批量生成状态
  const [batchCount, setBatchCount] = useState(1);
  const [batchTasks, setBatchTasks] = useState<BatchVideoTask[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [completedVideos, setCompletedVideos] = useState<string[]>([]);

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
  const totalCredits = credits * batchCount;

  // 批量生成视频
  const handleBatchGenerate = async () => {
    if (!currentJob?.id) {
      setVideoError("任务不存在，请返回上一步");
      return;
    }

    if (batchCount === 1) {
      // 单个生成走原来逻辑
      handleGenerateVideo(false);
      return;
    }

    // 批量模式
    setIsBatchMode(true);
    const tasks: BatchVideoTask[] = Array.from({ length: batchCount }, (_, i) => ({
      id: i + 1,
      status: "pending" as const,
      progress: 0,
    }));
    setBatchTasks(tasks);

    // 依次启动生成任务
    for (let i = 0; i < tasks.length; i++) {
      try {
        setBatchTasks(prev => prev.map((t, idx) => 
          idx === i ? { ...t, status: "generating" } : t
        ));

        const response = await fetch(`/api/link-video/jobs/${currentJob.id}/video`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retry: i > 0, batchIndex: i }),
        });

        const result = await response.json();

        if (result.success && result.task_id) {
          setBatchTasks(prev => prev.map((t, idx) => 
            idx === i ? { ...t, taskId: result.task_id } : t
          ));
          
          // 开始轮询此任务
          pollBatchTask(i, result.task_id);
        } else {
          setBatchTasks(prev => prev.map((t, idx) => 
            idx === i ? { ...t, status: "failed", error: result.error } : t
          ));
        }
      } catch (error) {
        setBatchTasks(prev => prev.map((t, idx) => 
          idx === i ? { ...t, status: "failed", error: "网络错误" } : t
        ));
      }
    }
  };

  // 轮询批量任务状态
  const pollBatchTask = async (index: number, taskId: string) => {
    const maxAttempts = 120; // 最多20分钟
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setBatchTasks(prev => prev.map((t, idx) => 
          idx === index ? { ...t, status: "failed", error: "生成超时" } : t
        ));
        return;
      }

      try {
        const response = await fetch(`/api/link-video/jobs/${currentJob?.id}/video?taskId=${taskId}`);
        const result = await response.json();

        if (result.status === "completed" && result.video_url) {
          setBatchTasks(prev => prev.map((t, idx) => 
            idx === index ? { ...t, status: "completed", videoUrl: result.video_url, progress: 100 } : t
          ));
          setCompletedVideos(prev => [...prev, result.video_url]);
          // 如果是第一个完成的，也设置到主状态
          if (index === 0) {
            setVideoGenerated(result.video_url);
          }
        } else if (result.status === "failed") {
          setBatchTasks(prev => prev.map((t, idx) => 
            idx === index ? { ...t, status: "failed", error: result.error } : t
          ));
        } else {
          setBatchTasks(prev => prev.map((t, idx) => 
            idx === index ? { ...t, progress: result.progress || Math.min(95, 10 + attempts * 2) } : t
          ));
          attempts++;
          setTimeout(poll, 10000);
        }
      } catch (error) {
        attempts++;
        setTimeout(poll, 10000);
      }
    };

    poll();
  };

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h2 className="text-xl font-semibold">生成最终视频</h2>
        <p className="text-sm text-muted-foreground mt-1">
          AI 将脚本和九宫格合成为带货视频，支持批量生成多个变体
        </p>
      </div>

      {/* 生成配置摘要 */}
      <Card className="p-4 bg-muted/30">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">视频时长</p>
            <p className="font-medium">{videoConfig.duration} 秒</p>
          </div>
          <div>
            <p className="text-muted-foreground">画幅比例</p>
            <p className="font-medium">{videoConfig.aspect_ratio}</p>
          </div>
          <div>
            <p className="text-muted-foreground">生成数量</p>
            <p className="font-medium">{batchCount} 个视频</p>
          </div>
          <div>
            <p className="text-muted-foreground">消耗积分</p>
            <p className="font-medium text-tiktok-pink">{totalCredits} 积分</p>
          </div>
        </div>
      </Card>

      {/* 生成状态 */}
      {!videoUrl && !isGeneratingVideo && !isPolling && !isBatchMode && (
        <div className="space-y-6">
          {/* 批量数量选择 */}
          <Card className="p-4 bg-gradient-to-r from-tiktok-cyan/5 to-tiktok-pink/5 border-tiktok-cyan/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium flex items-center gap-2">
                  <Copy className="h-4 w-4 text-tiktok-cyan" />
                  批量生成
                </p>
                <p className="text-sm text-muted-foreground">
                  同时生成多个视频变体，选择最佳效果
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setBatchCount(Math.max(1, batchCount - 1))}
                  disabled={batchCount <= 1}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="text-lg font-bold w-8 text-center">{batchCount}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setBatchCount(Math.min(5, batchCount + 1))}
                  disabled={batchCount >= 5}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>

          {/* 开始生成 */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8">
            <Video className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">
              {batchCount > 1 
                ? `准备批量生成 ${batchCount} 个视频` 
                : "准备就绪，开始生成视频"}
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              生成 {videoConfig.duration} 秒视频，每个预计需要 3-15 分钟
            </p>
            <Button
              onClick={handleBatchGenerate}
              size="lg"
              className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
            >
              <Video className="mr-2 h-5 w-5" />
              开始生成（{totalCredits} 积分）
            </Button>
          </div>
        </div>
      )}

      {/* 单个生成进度 */}
      {(isGeneratingVideo || isPolling) && !isBatchMode && (
        <div className="flex flex-col items-center justify-center rounded-lg border p-8">
          <Loader2 className="h-10 w-10 animate-spin text-tiktok-cyan mb-4" />
          <p className="font-medium mb-2">正在生成视频...</p>
          
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

      {/* 批量生成进度 */}
      {isBatchMode && batchTasks.length > 0 && !completedVideos.length && (
        <div className="space-y-4">
          <div className="text-center mb-4">
            <Loader2 className="h-8 w-8 animate-spin text-tiktok-cyan mx-auto mb-2" />
            <p className="font-medium">正在批量生成 {batchCount} 个视频...</p>
          </div>
          
          <div className="grid gap-3">
            {batchTasks.map((task, index) => (
              <Card key={task.id} className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">视频 #{index + 1}</span>
                  <Badge variant={
                    task.status === "completed" ? "default" :
                    task.status === "failed" ? "destructive" :
                    task.status === "generating" ? "secondary" : "outline"
                  }>
                    {task.status === "completed" && <Check className="h-3 w-3 mr-1" />}
                    {task.status === "generating" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    {task.status === "completed" ? "完成" :
                     task.status === "failed" ? "失败" :
                     task.status === "generating" ? "生成中" : "等待中"}
                  </Badge>
                </div>
                <Progress value={task.progress} className="h-1.5" />
                {task.error && (
                  <p className="text-xs text-destructive mt-1">{task.error}</p>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 批量完成结果 */}
      {isBatchMode && completedVideos.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 text-green-500">
            <PartyPopper className="h-6 w-6" />
            <span className="text-xl font-bold">
              {completedVideos.length}/{batchCount} 个视频生成完成！
            </span>
            <PartyPopper className="h-6 w-6" />
          </div>

          <div className="grid gap-4">
            {completedVideos.map((url, index) => (
              <Card key={index} className="overflow-hidden">
                <div className="p-2 bg-muted/50 flex items-center justify-between">
                  <span className="font-medium text-sm">视频 #{index + 1}</span>
                  <Button size="sm" variant="outline" asChild>
                    <a href={url} download target="_blank" rel="noopener noreferrer">
                      <Download className="h-3 w-3 mr-1" />
                      下载
                    </a>
                  </Button>
                </div>
                <div className="relative aspect-video bg-black">
                  <video src={url} controls className="h-full w-full" />
                </div>
              </Card>
            ))}
          </div>

          <Card className="p-4 bg-gradient-to-r from-tiktok-cyan/10 to-tiktok-pink/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">继续创作</p>
                <p className="text-sm text-muted-foreground">
                  用新的商品链接生成另一批视频
                </p>
              </div>
              <Button variant="outline" onClick={() => {
                setIsBatchMode(false);
                setBatchTasks([]);
                setCompletedVideos([]);
                reset();
              }}>
                新建任务
              </Button>
            </div>
          </Card>
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




