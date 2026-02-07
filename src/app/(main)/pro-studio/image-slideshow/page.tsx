"use client";

/**
 * 批量图片转视频 - 独立页面
 * 路由: /pro-studio/image-slideshow
 */

import React, { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
    SlideshowSection,
    CreateSlideshowModal,
    type SlideshowTask,
} from "@/components/slideshow";

export default function ImageSlideshowPage() {
    const { toast } = useToast();

    // 任务状态
    const [slideshowTasks, setSlideshowTasks] = useState<SlideshowTask[]>([]);
    const [showModal, setShowModal] = useState(false);

    // 上传图片到 OSS
    const uploadImages = async (files: File[]): Promise<string[]> => {
        const urls: string[] = [];
        for (const file of files) {
            try {
                // 获取预签名 URL
                const formData = new FormData();
                formData.append('file', file);

                const uploadRes = await fetch('/api/upload/image', {
                    method: 'POST',
                    body: formData,
                });

                if (uploadRes.ok) {
                    const { data } = await uploadRes.json();
                    if (data?.url) {
                        urls.push(data.url);
                    }
                }
            } catch (error) {
                console.error('Upload error:', error);
            }
        }
        return urls;
    };

    // 处理创建任务
    const handleCreateTask = async (data: {
        mode: "random" | "position";
        images?: File[];
        imagesPerVideo?: number;
        positions?: { id: string; name: string; images: File[] }[];
        config: {
            duration: number;
            transition: string;
            aspectRatio: "9:16" | "16:9";
            // 字幕配置 (增强版)
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
            // 背景音乐
            bgm: {
                enabled: boolean;
                mode: "none" | "random" | "single";
                selectedId?: string;
            };
            // 配音
            voice: {
                enabled: boolean;
                voiceId: string;
                voiceName: string;
            };
            // AI 文案
            aiCaption: {
                enabled: boolean;
                mode: "unified" | "diverse";
                keywords: string;
                style: string;
                language?: "en" | "zh"; // 语言选项
            };
        };
    }) => {
        // 计算将要生成的视频数量
        const totalImages = data.mode === "random"
            ? data.images?.length || 0
            : data.positions?.reduce((sum, p) => sum + p.images.length, 0) || 0;
        const imagesPerVideo = data.imagesPerVideo || 5;
        const videoCount = data.mode === "random"
            ? Math.ceil(totalImages / imagesPerVideo)
            : data.positions?.length || 1;

        // 创建基础任务ID
        const baseTaskId = crypto.randomUUID();

        // 为每个视频创建独立的"等待中"任务卡片
        const pendingTasks: SlideshowTask[] = Array.from({ length: videoCount }, (_, index) => ({
            id: `${baseTaskId}-video-${index + 1}`,
            status: "pending" as const,
            mode: data.mode,
            imageCount: data.mode === "random"
                ? Math.min(imagesPerVideo, totalImages - index * imagesPerVideo)
                : data.positions?.[index]?.images.length || 0,
            duration: data.config.duration,
            transition: data.config.transition,
            createdAt: new Date(),
        }));

        setSlideshowTasks((prev) => [...prev, ...pendingTasks]);

        toast({
            title: "任务已创建",
            description: `正在上传图片，将生成 ${videoCount} 个视频...`,
        });

        try {
            // 更新所有相关任务卡片状态为处理中
            setSlideshowTasks((prev) =>
                prev.map((t) => (t.id.startsWith(baseTaskId) ? { ...t, status: "processing" as const } : t))
            );

            // 上传图片
            let imageUrls: string[] = [];
            let positionsData: { name: string; images: string[] }[] | undefined;

            if (data.mode === "random" && data.images) {
                toast({ title: "正在上传图片...", description: `共 ${data.images.length} 张` });
                imageUrls = await uploadImages(data.images);
            } else if (data.mode === "position" && data.positions) {
                positionsData = [];
                for (const pos of data.positions) {
                    toast({ title: "正在上传图片...", description: `位置: ${pos.name}` });
                    const urls = await uploadImages(pos.images);
                    positionsData.push({ name: pos.name, images: urls });
                }
            }

            // 调用 API 生成视频 - 传递完整的新配置
            toast({ title: "正在生成视频...", description: "这可能需要一些时间" });

            const apiResponse = await fetch("/api/video-batch/generate-slideshow", {
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
                    // 新增：完整的 AI 配置
                    bgm: data.config.bgm,
                    voice: data.config.voice,
                    aiCaption: data.config.aiCaption,
                    subtitle: data.config.subtitle,
                }),
            });

            const result = await apiResponse.json();

            if (!apiResponse.ok) {
                throw new Error(result.error || "生成失败");
            }

            // 收集所有视频 URL
            const allVideoUrls: string[] = result.videos?.map((v: { url: string }) => v.url) || [];

            if (allVideoUrls.length === 0) {
                throw new Error("未生成任何视频");
            }

            // 用视频 URL 更新对应的任务卡片
            setSlideshowTasks((prev) =>
                prev.map((t) => {
                    if (!t.id.startsWith(baseTaskId)) return t;
                    // 从任务 ID 中提取索引 (格式: baseTaskId-video-N)
                    const match = t.id.match(/-video-(\d+)$/);
                    if (!match) return t;
                    const videoIndex = parseInt(match[1], 10) - 1;
                    const videoUrl = allVideoUrls[videoIndex];
                    if (!videoUrl) {
                        return { ...t, status: "failed" as const };
                    }
                    return {
                        ...t,
                        status: "completed" as const,
                        outputUrl: videoUrl,
                        outputUrls: [videoUrl],
                        videoCount: 1,
                        thumbnailUrl: videoUrl,
                    };
                })
            );

            toast({
                title: "生成成功！",
                description: `成功生成 ${allVideoUrls.length} 个视频`,
            });

        } catch (error: any) {
            console.error("Slideshow generation error:", error);

            // 更新所有相关任务卡片状态为失败
            setSlideshowTasks((prev) =>
                prev.map((t) => (t.id.startsWith(baseTaskId) ? { ...t, status: "failed" as const } : t))
            );

            toast({
                title: "生成失败",
                description: error.message || "请稍后重试",
                variant: "destructive",
            });
        }
    };

    return (
        <div className="min-h-screen bg-[#0B0C10] text-white p-6 pb-24">
            {/* 任务队列区 - 包含完整的标题和任务列表 */}
            <SlideshowSection
                tasks={slideshowTasks}
                onCreateClick={() => setShowModal(true)}
                onTaskDelete={(id) =>
                    setSlideshowTasks((prev) => prev.filter((t) => t.id !== id))
                }
                onTaskDownload={(id) => {
                    const task = slideshowTasks.find((t) => t.id === id);
                    if (task?.outputUrl) {
                        window.open(task.outputUrl, "_blank");
                    }
                }}
                onTaskPlay={(id) => {
                    const task = slideshowTasks.find((t) => t.id === id);
                    if (task?.outputUrl) {
                        window.open(task.outputUrl, "_blank");
                    }
                }}
            />

            {/* 创建任务弹窗 */}
            <CreateSlideshowModal
                open={showModal}
                onOpenChange={setShowModal}
                onSubmit={handleCreateTask}
            />
        </div>
    );
}
