"use client";

/**
 * 批量图片转视频 - 独立页面
 * 路由: /pro-studio/image-slideshow
 * 
 * 使用 zustand store (slideshow-store) 管理任务状态
 */

import React, { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
    SlideshowSection,
    CreateSlideshowModal,
} from "@/components/slideshow";
import {
    useSlideshowStore,
    type SlideshowTask,
} from "@/stores/slideshow-store";

export default function ImageSlideshowPage() {
    const { toast } = useToast();

    // ==================== Store ====================
    const tasks = useSlideshowStore((s) => s.tasks);
    const selectedTaskIds = useSlideshowStore((s) => s.selectedTaskIds);
    const activeGroupName = useSlideshowStore((s) => s.activeGroupName);

    const {
        addTasks,
        updateTaskStatus,
        updateGroupTaskStatus,
        completeVideoByIndex,
        removeTask,
        removeTasks,
        clearAllTasks,
        retryTask,
        toggleSelection,
        selectAll,
        clearSelection,
        removeSelected,
        setActiveGroup,
        removeGroup,
        getGroups,
        getActiveGroupTasks,
        getActiveGroupStats,
    } = useSlideshowStore();

    // ==================== Local State ====================
    const [showModal, setShowModal] = useState(false);

    // ==================== 页面离开警告 ====================
    useEffect(() => {
        const hasRunning = tasks.some(
            (t) => t.status === "uploading" || t.status === "generating"
        );

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasRunning) {
                e.preventDefault();
                e.returnValue = "有视频正在生成中，确定要离开吗？";
                return e.returnValue;
            }
        };

        if (hasRunning) {
            window.addEventListener("beforeunload", handleBeforeUnload);
        }

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    }, [tasks]);

    // ==================== 上传图片到 OSS ====================
    const uploadImages = async (files: File[]): Promise<string[]> => {
        const urls: string[] = [];
        for (const file of files) {
            try {
                const formData = new FormData();
                formData.append("file", file);

                const uploadRes = await fetch("/api/upload/image", {
                    method: "POST",
                    body: formData,
                });

                if (uploadRes.ok) {
                    const { data } = await uploadRes.json();
                    if (data?.url) {
                        urls.push(data.url);
                    }
                }
            } catch (error) {
                console.error("Upload error:", error);
            }
        }
        return urls;
    };

    // ==================== 智能下载 ====================
    const downloadVideo = useCallback(async (url: string, filename: string) => {
        try {
            // 通过代理下载（解决 OSS 跨域问题，同时设置正确的 Content-Disposition）
            const proxyUrl = `/api/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
            const link = document.createElement("a");
            link.href = proxyUrl;
            link.download = filename;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return true;
        } catch {
            // 回退：直接打开 URL
            try {
                window.open(url, "_blank");
                return true;
            } catch {
                return false;
            }
        }
    }, []);

    // ==================== 处理创建任务 ====================
    const handleCreateTask = async (data: {
        mode: "random" | "position";
        images?: File[];
        imagesPerVideo?: number;
        positions?: { id: string; name: string; images: File[] }[];
        config: {
            duration: number;
            transition: string;
            aspectRatio: "9:16" | "16:9";
            subtitle: {
                text: string;
                position: number;
                fontSize: number;
                fontColor: string;
                fontFamily: string;
                borderWidth: number;
                borderColor: string;
                shadow: boolean;
            } | null;
            bgm: {
                enabled: boolean;
                mode: "none" | "random" | "single";
                selectedId?: string;
            };
            voice: {
                enabled: boolean;
                voiceId: string;
                voiceName: string;
            };
            aiCaption: {
                enabled: boolean;
                mode: "unified" | "diverse";
                keywords: string;
                style: string;
                language?: "en" | "zh";
                generatedTexts?: string[];
            };
        };
    }) => {
        // 计算将要生成的视频数量
        const totalImages =
            data.mode === "random"
                ? data.images?.length || 0
                : data.positions?.reduce((sum, p) => sum + p.images.length, 0) || 0;
        const imagesPerVideo = data.imagesPerVideo || 5;
        const videoCount =
            data.mode === "random"
                ? Math.ceil(totalImages / imagesPerVideo)
                : Math.min(
                    ...(data.positions
                        ?.map((p) => p.images.length)
                        .filter((n) => n > 0) || [1])
                );

        // 创建基础任务ID
        const baseTaskId = crypto.randomUUID();
        // 生成分组名
        const now = new Date();
        const groupName = `成片-${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

        // 保存原始配置（用于重试）
        const originalConfig = {
            mode: data.mode,
            imagesPerVideo: data.imagesPerVideo,
            config: data.config,
        };

        // 为每个视频创建"等待中"任务卡片
        const pendingTasks: SlideshowTask[] = Array.from(
            { length: videoCount },
            (_, index) => ({
                id: `${baseTaskId}-video-${index + 1}`,
                groupName,
                status: "pending" as const,
                mode: data.mode,
                imageCount:
                    data.mode === "random"
                        ? Math.min(
                            imagesPerVideo,
                            totalImages - index * imagesPerVideo
                        )
                        : data.positions?.length || 0,
                duration: data.config.duration,
                transition: data.config.transition,
                aspectRatio: data.config.aspectRatio || "9:16",
                progress: 0,
                hasVoice: data.config.voice.enabled,
                hasBgm: data.config.bgm.enabled && data.config.bgm.mode !== "none",
                hasSubtitle: !!data.config.subtitle,
                originalConfig,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })
        );

        // 添加到 store
        addTasks(pendingTasks);

        // 自动激活新分组
        setActiveGroup(groupName);

        toast({
            title: "任务已创建",
            description: `正在上传图片，将生成 ${videoCount} 个视频...`,
        });

        try {
            // 更新为上传中
            updateGroupTaskStatus(baseTaskId, "uploading", {
                stage: "uploading",
                progress: 5,
            });

            // 上传图片
            let imageUrls: string[] = [];
            let positionsData: { name: string; images: string[] }[] | undefined;

            if (data.mode === "random" && data.images) {
                toast({
                    title: "正在上传图片...",
                    description: `共 ${data.images.length} 张`,
                });
                imageUrls = await uploadImages(data.images);
            } else if (data.mode === "position" && data.positions) {
                positionsData = [];
                for (const pos of data.positions) {
                    toast({
                        title: "正在上传图片...",
                        description: `位置: ${pos.name}`,
                    });
                    const urls = await uploadImages(pos.images);
                    positionsData.push({ name: pos.name, images: urls });
                }
            }

            // 更新为生成中
            updateGroupTaskStatus(baseTaskId, "generating", {
                stage: "composing",
                progress: 30,
            });

            toast({
                title: "正在生成视频...",
                description: "这可能需要一些时间",
            });

            const apiResponse = await fetch(
                "/api/video-batch/generate-slideshow",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        mode: data.mode,
                        images: imageUrls,
                        imagesPerVideo: data.imagesPerVideo || 5,
                        positions: positionsData,
                        aspectRatio: data.config.aspectRatio,
                        durationPerImage: data.config.duration,
                        transition: data.config.transition,
                        bgm: data.config.bgm,
                        voice: data.config.voice,
                        aiCaption: data.config.aiCaption,
                        subtitle: data.config.subtitle,
                    }),
                }
            );

            const result = await apiResponse.json();

            if (!apiResponse.ok) {
                throw new Error(result.error || "生成失败");
            }

            // 收集所有视频 URL
            const allVideoUrls: string[] =
                result.videos?.map((v: { url: string }) => v.url) || [];

            if (allVideoUrls.length === 0) {
                throw new Error("未生成任何视频");
            }

            // 逐个标记完成
            allVideoUrls.forEach((videoUrl, idx) => {
                completeVideoByIndex(baseTaskId, idx, videoUrl);
            });

            // 标记剩余的为失败（如果后端生成的比预期少）
            for (let i = allVideoUrls.length; i < videoCount; i++) {
                const taskId = `${baseTaskId}-video-${i + 1}`;
                updateTaskStatus(taskId, "failed", {
                    errorMessage: "后端未生成对应视频",
                });
            }

            toast({
                title: "生成成功！",
                description: `成功生成 ${allVideoUrls.length} 个视频`,
            });
        } catch (error: unknown) {
            console.error("Slideshow generation error:", error);

            // 更新所有相关任务为失败
            updateGroupTaskStatus(baseTaskId, "failed", {
                errorMessage:
                    error instanceof Error ? error.message : "生成失败",
            });

            toast({
                title: "生成失败",
                description:
                    error instanceof Error ? error.message : "请稍后重试",
                variant: "destructive",
            });
        }
    };

    // ==================== 处理重试 ====================
    const handleRetryTask = useCallback(
        async (id: string) => {
            const task = tasks.find((t) => t.id === id);
            if (!task || task.status !== "failed") return;

            // 重置为等待中
            retryTask(id);

            toast({
                title: "重新生成中...",
                description: "已将任务重新加入队列",
            });

            // 如果有 originalConfig，可以直接重新提交
            // 但目前图片 URL 已经在 OSS 上，所以需要后端支持单任务重试
            // 暂时先标记为 pending，后续 SSE 版本可以自动重新执行
        },
        [tasks, retryTask, toast]
    );

    // ==================== 处理下载 ====================
    const handleDownloadTask = useCallback(
        async (id: string) => {
            const task = tasks.find((t) => t.id === id);
            if (!task?.outputUrl) {
                toast({
                    variant: "destructive",
                    title: "视频未生成",
                });
                return;
            }

            const modeStr = task.mode === "random" ? "混剪" : "编排";
            const idx =
                task.id.match(/-video-(\d+)$/)?.[1] || "1";
            const filename = `成片-${modeStr}-${idx}-${task.duration}s.mp4`;

            toast({
                title: "正在下载...",
                description: filename,
            });

            const success = await downloadVideo(task.outputUrl, filename);
            if (success) {
                toast({ title: "✅ 下载成功", description: filename });
            } else {
                toast({
                    variant: "destructive",
                    title: "下载失败",
                    description: "请尝试右键视频另存为",
                });
            }
        },
        [tasks, downloadVideo, toast]
    );

    // ==================== 视频播放器 ====================
    const [playingTask, setPlayingTask] = useState<SlideshowTask | null>(null);

    return (
        <div className="min-h-screen bg-[#0B0C10] text-white p-6 pb-24">
            {/* 任务队列区 - 包含完整的标题和任务列表 */}
            <SlideshowSection
                tasks={tasks}
                selectedTaskIds={selectedTaskIds}
                activeGroupName={activeGroupName}
                onCreateClick={() => setShowModal(true)}
                onTaskDelete={(id) => removeTask(id)}
                onTaskDownload={handleDownloadTask}
                onTaskPlay={(id) => {
                    const task = tasks.find((t) => t.id === id);
                    if (task?.outputUrl) {
                        setPlayingTask(task);
                    }
                }}
                onTaskRetry={handleRetryTask}
                onToggleSelect={toggleSelection}
                onSelectAll={(selected) =>
                    selectAll(selected, activeGroupName || undefined)
                }
                onClearSelection={clearSelection}
                onRemoveSelected={removeSelected}
                onSetActiveGroup={setActiveGroup}
                onRemoveGroup={removeGroup}
                getGroups={getGroups}
                getActiveGroupTasks={getActiveGroupTasks}
                getActiveGroupStats={getActiveGroupStats}
                onBatchDownload={async (ids) => {
                    let successCount = 0;
                    for (const id of ids) {
                        await handleDownloadTask(id);
                        successCount++;
                        // 小间隔避免浏览器限流
                        await new Promise((r) => setTimeout(r, 300));
                    }
                    toast({
                        title: `✅ 批量下载完成`,
                        description: `成功 ${successCount} 个视频`,
                    });
                }}
            />

            {/* 视频播放器弹窗 */}
            {playingTask && playingTask.outputUrl && (
                <div
                    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 sm:p-8"
                    onClick={() => setPlayingTask(null)}
                >
                    <div
                        className="relative w-auto max-w-lg rounded-2xl overflow-hidden bg-black shadow-2xl flex flex-col"
                        style={{ maxHeight: "80vh" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <video
                            src={playingTask.outputUrl}
                            className="w-full h-full object-contain"
                            style={{ maxHeight: "calc(80vh - 56px)" }}
                            controls
                            autoPlay
                        />
                        <div className="absolute top-3 right-3 z-10">
                            <button
                                onClick={() => setPlayingTask(null)}
                                className="p-2 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="shrink-0 px-4 py-3 bg-black/80 border-t border-white/5">
                            <div className="flex items-center justify-between text-sm text-white/70">
                                <span>
                                    {playingTask.mode === "random"
                                        ? "智能混剪"
                                        : "场景编排"}{" "}
                                    · {playingTask.imageCount}张 ·{" "}
                                    {playingTask.duration}s
                                </span>
                                <button
                                    onClick={() =>
                                        handleDownloadTask(playingTask.id)
                                    }
                                    className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors text-xs"
                                >
                                    下载
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 创建任务弹窗 */}
            <CreateSlideshowModal
                open={showModal}
                onOpenChange={setShowModal}
                onSubmit={handleCreateTask as never}
            />
        </div>
    );
}
