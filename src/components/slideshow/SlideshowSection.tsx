"use client";

/**
 * 批量图片转视频 - 独立板块
 * 任务队列 + 创建按钮
 */

import React from "react";
import { cn } from "@/lib/utils";
import {
    Images,
    Sparkles,
    Settings2,
    Play,
    Trash2,
    Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface SlideshowTask {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    mode: 'random' | 'position';
    imageCount: number;
    duration: number;
    transition: string;
    outputUrl?: string;
    thumbnailUrl?: string;
    createdAt: Date;
}

interface SlideshowSectionProps {
    tasks: SlideshowTask[];
    onCreateClick: () => void;
    onTaskDelete?: (id: string) => void;
    onTaskDownload?: (id: string) => void;
    onTaskPlay?: (id: string) => void;
}

export function SlideshowSection({
    tasks,
    onCreateClick,
    onTaskDelete,
    onTaskDownload,
    onTaskPlay
}: SlideshowSectionProps) {

    return (
        <div className="space-y-4 mt-8">
            {/* ============================================ */}
            {/* 页面头部 - 与批量视频线样式一致 */}
            {/* ============================================ */}
            <div className="mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                    <div className="h-7 w-1.5 rounded-full bg-gradient-to-b from-pink-500 to-purple-500 shadow-[0_0_10px_rgba(236,72,153,0.5)]" />
                    <span className="text-white drop-shadow-lg">批量图片转视频</span>
                </h1>
                <p className="mt-2 text-white/60 text-sm">
                    多张图片自动合成轮播视频，支持智能混剪与场景编排
                </p>
            </div>

            {/* ============================================ */}
            {/* 任务队列 - 与批量视频线样式一致 */}
            {/* ============================================ */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Images className="h-5 w-5 text-pink-400" />
                            任务队列
                        </h2>
                        <span className="text-xs bg-white/5 border border-white/10 text-white/60 px-2 py-0.5 rounded-full">
                            {tasks.length} 个任务
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        {tasks.length > 0 && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="text-white/60 hover:text-white">
                                        <Settings2 className="h-4 w-4 mr-1" />
                                        选择管理
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="bg-black/90 border-white/10">
                                    <DropdownMenuItem className="text-white/70 hover:text-white">
                                        全选
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="text-white/70 hover:text-white">
                                        批量删除
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="text-white/70 hover:text-white">
                                        批量下载
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        <button
                            onClick={onCreateClick}
                            className="group relative rounded-xl px-4 py-2 font-medium text-xs sm:text-sm text-black transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_24px_rgba(236,72,153,0.3)] hover:shadow-[0_0_32px_rgba(236,72,153,0.5)] overflow-hidden bg-gradient-to-r from-pink-500 to-purple-500"
                        >
                            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
                            <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-300" />
                            <span className="relative z-10 flex items-center justify-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 fill-black/20" />
                                创建轮播任务
                            </span>
                        </button>
                    </div>
                </div>

                {/* 任务列表容器 - 与批量视频线空状态样式一致 */}
                {tasks.length === 0 ? (
                    <div
                        className="group flex flex-col items-center justify-center py-16 rounded-[2rem] border border-white/5 bg-[#0B0C10] relative overflow-hidden cursor-pointer transition-all duration-500 hover:border-pink-500/30 hover:shadow-[0_0_30px_rgba(236,72,153,0.1)]"
                        onClick={onCreateClick}
                    >
                        {/* Aurora Background Effect */}
                        <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 via-transparent to-purple-500/5 opacity-50" />
                        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10" />

                        {/* Animated Rings */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-white/5 rounded-full animate-[spin_20s_linear_infinite]" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[250px] border border-white/5 rounded-full animate-[spin_15s_linear_infinite_reverse]" />

                        <div className="relative z-10 flex flex-col items-center">
                            <div className="relative mb-4">
                                <div className="absolute inset-0 bg-pink-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                <div className="relative w-16 h-16 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-inner">
                                    <Images className="h-8 w-8 text-white/20 group-hover:text-pink-400 transition-colors duration-300" />
                                </div>
                            </div>
                            <h3 className="text-lg font-bold text-white mb-2 group-hover:text-pink-400 transition-colors tracking-tight">暂无轮播任务</h3>
                            <p className="text-sm text-white/40 group-hover:text-white/80 transition-colors">
                                点击 <span className="text-pink-400 font-medium">"创建轮播任务"</span> 开始制作
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-[2rem] border border-white/5 bg-[#0B0C10] p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {tasks.map((task) => (
                                <SlideshowTaskCard
                                    key={task.id}
                                    task={task}
                                    onDelete={() => onTaskDelete?.(task.id)}
                                    onDownload={() => onTaskDownload?.(task.id)}
                                    onPlay={() => onTaskPlay?.(task.id)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

interface SlideshowTaskCardProps {
    task: SlideshowTask;
    onDelete?: () => void;
    onDownload?: () => void;
    onPlay?: () => void;
}

function SlideshowTaskCard({ task, onDelete, onDownload, onPlay }: SlideshowTaskCardProps) {
    const statusConfig = {
        pending: { label: '等待中', color: 'text-yellow-400', bg: 'bg-yellow-400/20' },
        processing: { label: '生成中', color: 'text-blue-400', bg: 'bg-blue-400/20' },
        completed: { label: '已完成', color: 'text-green-400', bg: 'bg-green-400/20' },
        failed: { label: '失败', color: 'text-red-400', bg: 'bg-red-400/20' },
    };

    const status = statusConfig[task.status];

    return (
        <div className="group relative rounded-xl overflow-hidden border border-white/10 bg-white/5 hover:border-white/20 transition-all">
            {/* 缩略图区域 */}
            <div className="aspect-[9/16] relative bg-black/30">
                {task.thumbnailUrl ? (
                    <img
                        src={task.thumbnailUrl}
                        alt="预览"
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Images className="h-8 w-8 text-white/20" />
                    </div>
                )}

                {/* 状态标签 */}
                <div className={cn(
                    "absolute top-2 right-2 px-2 py-0.5 rounded text-xs font-medium",
                    status.bg, status.color
                )}>
                    {status.label}
                </div>

                {/* 播放按钮 */}
                {task.status === 'completed' && task.outputUrl && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={onPlay}
                            className="p-3 rounded-full bg-white/20 hover:bg-white/30 transition-colors hover:scale-110"
                        >
                            <Play className="h-6 w-6 text-white fill-white" />
                        </button>
                    </div>
                )}
            </div>

            {/* 信息区域 */}
            <div className="p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                    <span className="text-white/50">
                        {task.mode === 'random' ? '智能混剪' : '场景编排'}
                    </span>
                    <span className="text-white/40">
                        {task.imageCount}张 · {task.duration}s
                    </span>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1">
                    {task.status === 'completed' && (
                        <button
                            onClick={onDownload}
                            className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs transition-colors"
                        >
                            <Download className="h-3.5 w-3.5 inline mr-1" />
                            下载
                        </button>
                    )}
                    <button
                        onClick={onDelete}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default SlideshowSection;
