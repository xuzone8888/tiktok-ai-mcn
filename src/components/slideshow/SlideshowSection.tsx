"use client";

/**
 * 批量图片转视频 - 任务队列板块
 * 含：页面标题、组Tab、选择管理、任务卡片网格
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
    RotateCcw,
    Check,
    X,
    ChevronDown,
    Loader2,
    Mic,
    Music,
    Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SlideshowTask } from "@/stores/slideshow-store";

// Re-export for backward compat
export type { SlideshowTask } from "@/stores/slideshow-store";

// 转场效果值 → 中文名称
const TRANSITION_LABELS: Record<string, string> = {
    none: "无转场",
    fade: "淡入",
    wipeleft: "左擦除",
    wiperight: "右擦除",
    wipeup: "上擦除",
    wipedown: "下擦除",
    slideleft: "左滑",
    slideright: "右滑",
    circleopen: "圆形展开",
    circleclose: "圆形收缩",
    dissolve: "溶解",
    pixelize: "像素化",
    radial: "放射",
    smoothleft: "柔和左滑",
    smoothright: "柔和右滑",
    fadeblack: "黑屏过渡",
    fadewhite: "白屏过渡",
};

function transitionLabel(value: string): string {
    return TRANSITION_LABELS[value] || value || "无";
}

interface SlideshowSectionProps {
    tasks: SlideshowTask[];
    selectedTaskIds: Record<string, boolean>;
    activeGroupName: string | null;
    onCreateClick: () => void;
    onTaskDelete?: (id: string) => void;
    onTaskDownload?: (id: string) => void;
    onTaskPlay?: (id: string) => void;
    onTaskRetry?: (id: string) => void;
    // 选择管理
    onToggleSelect?: (id: string) => void;
    onSelectAll?: (selected: boolean) => void;
    onClearSelection?: () => void;
    onRemoveSelected?: () => void;
    // 分组
    onSetActiveGroup?: (groupName: string | null) => void;
    onRemoveGroup?: (groupName: string) => void;
    getGroups?: () => Array<{
        name: string;
        count: number;
        completed: number;
        failed: number;
        createdAt: string;
    }>;
    getActiveGroupTasks?: () => SlideshowTask[];
    getActiveGroupStats?: () => {
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    };
    // 批量下载
    onBatchDownload?: (ids: string[]) => void;
}

export function SlideshowSection({
    tasks,
    selectedTaskIds,
    activeGroupName,
    onCreateClick,
    onTaskDelete,
    onTaskDownload,
    onTaskPlay,
    onTaskRetry,
    onToggleSelect,
    onSelectAll,
    onClearSelection,
    onRemoveSelected,
    onSetActiveGroup,
    onRemoveGroup,
    getGroups,
    getActiveGroupTasks,
    getActiveGroupStats,
    onBatchDownload,
}: SlideshowSectionProps) {
    // 当前组的任务
    const displayTasks = getActiveGroupTasks
        ? getActiveGroupTasks()
        : tasks;
    const groups = getGroups ? getGroups() : [];
    const stats = getActiveGroupStats
        ? getActiveGroupStats()
        : {
            total: tasks.length,
            pending: tasks.filter((t) => t.status === "pending").length,
            processing: tasks.filter(
                (t) => t.status === "uploading" || t.status === "generating"
            ).length,
            completed: tasks.filter((t) => t.status === "completed").length,
            failed: tasks.filter((t) => t.status === "failed").length,
        };

    // 选中计数
    const selectedCount = displayTasks.filter(
        (t) => selectedTaskIds[t.id]
    ).length;
    const selectedCompletedIds = displayTasks
        .filter(
            (t) =>
                selectedTaskIds[t.id] &&
                t.status === "completed" &&
                t.outputUrl
        )
        .map((t) => t.id);

    return (
        <div className="space-y-4 mt-8">
            {/* ============================================ */}
            {/* 页面头部 */}
            {/* ============================================ */}
            <div className="mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                    <div className="h-7 w-1.5 rounded-full bg-gradient-to-b from-pink-500 to-purple-500 shadow-[0_0_10px_rgba(236,72,153,0.5)]" />
                    <span className="text-white drop-shadow-lg">
                        批量图片转视频
                    </span>
                </h1>
                <p className="mt-2 text-white/60 text-sm">
                    多张图片自动合成轮播视频，支持智能混剪与场景编排
                </p>
            </div>

            {/* ============================================ */}
            {/* 任务队列 */}
            {/* ============================================ */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Images className="h-5 w-5 text-pink-400" />
                            任务队列
                        </h2>
                        <span className="text-xs bg-white/5 border border-white/10 text-white/60 px-2 py-0.5 rounded-full">
                            {stats.total} 个任务
                        </span>
                        {stats.completed > 0 && (
                            <span className="text-xs text-green-400/80">
                                ✓ {stats.completed}
                            </span>
                        )}
                        {stats.failed > 0 && (
                            <span className="text-xs text-red-400/80">
                                ✕ {stats.failed}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {/* 批量操作 - 选中时显示 */}
                        {selectedCount > 0 && (
                            <>
                                {selectedCompletedIds.length > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            onBatchDownload?.(
                                                selectedCompletedIds
                                            )
                                        }
                                        className="h-7 text-xs text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                                    >
                                        <Download className="h-3 w-3 mr-1" />
                                        下载 ({selectedCompletedIds.length})
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={onRemoveSelected}
                                    className="h-7 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                                >
                                    <Trash2 className="h-3 w-3 mr-1" />
                                    删除 ({selectedCount})
                                </Button>
                            </>
                        )}

                        {/* 选择管理 */}
                        {tasks.length > 0 && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-white/60 hover:text-white h-7 text-xs"
                                    >
                                        <Settings2 className="h-3.5 w-3.5 mr-1" />
                                        选择管理
                                        <ChevronDown className="h-3 w-3 ml-1" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="bg-black/90 border-white/10 w-36"
                                >
                                    <DropdownMenuItem
                                        onClick={() => onSelectAll?.(true)}
                                        className="text-white/70 hover:text-white cursor-pointer"
                                    >
                                        <Check className="h-4 w-4 mr-2 text-emerald-400" />
                                        全选
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={onClearSelection}
                                        className="text-white/70 hover:text-white cursor-pointer"
                                    >
                                        <X className="h-4 w-4 mr-2 text-orange-400" />
                                        取消选择
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-white/10" />
                                    <DropdownMenuItem
                                        onClick={() =>
                                            activeGroupName
                                                ? onRemoveGroup?.(
                                                    activeGroupName
                                                )
                                                : undefined
                                        }
                                        className="text-red-400 cursor-pointer"
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        清空当前组
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        {/* 新建成片按钮 */}
                        <button
                            onClick={onCreateClick}
                            className="group relative rounded-xl px-4 py-2 font-medium text-xs sm:text-sm text-black transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_24px_rgba(236,72,153,0.3)] hover:shadow-[0_0_32px_rgba(236,72,153,0.5)] overflow-hidden bg-gradient-to-r from-pink-500 to-purple-500"
                        >
                            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
                            <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-300" />
                            <span className="relative z-10 flex items-center justify-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 fill-black/20" />
                                新建成片
                            </span>
                        </button>
                    </div>
                </div>

                {/* 分组 Tab 栏 */}
                {groups.length > 1 && (
                    <div className="flex items-center gap-1 px-2 overflow-x-auto scrollbar-hide pb-1">
                        {groups.map((group) => (
                            <div key={group.name} className="relative group/tab flex items-center">
                                <button
                                    onClick={() =>
                                        onSetActiveGroup?.(group.name)
                                    }
                                    className={cn(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all pr-7",
                                        activeGroupName === group.name
                                            ? "bg-pink-500/20 text-pink-400 border border-pink-500/30"
                                            : "bg-white/5 text-white/50 hover:text-white/80 hover:bg-white/10 border border-transparent"
                                    )}
                                >
                                    {group.name}
                                    <span
                                        className={cn(
                                            "px-1.5 py-0.5 rounded text-[10px]",
                                            activeGroupName === group.name
                                                ? "bg-pink-500/20"
                                                : "bg-white/5"
                                        )}
                                    >
                                        {group.completed}/{group.count}
                                    </span>
                                </button>
                                {/* 组删除按钮 */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm(`确定删除任务组「${group.name}」的全部 ${group.count} 个任务吗？`)) {
                                            onRemoveGroup?.(group.name);
                                            // 切到第一个剩余组
                                            const remaining = groups.filter(g => g.name !== group.name);
                                            if (remaining.length > 0) {
                                                onSetActiveGroup?.(remaining[0].name);
                                            } else {
                                                onSetActiveGroup?.(null);
                                            }
                                        }
                                    }}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white/30 hover:text-red-400 hover:bg-red-500/20 opacity-0 group-hover/tab:opacity-100 transition-all"
                                    title={`删除组「${group.name}」`}
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* 自动激活第一个组 */}
                {groups.length > 0 && !activeGroupName && (() => {
                    // 副作用：自动选中第一个组
                    setTimeout(() => onSetActiveGroup?.(groups[0].name), 0);
                    return null;
                })()}

                {/* 任务列表 */}
                {tasks.length === 0 ? (
                    <div
                        className="group flex flex-col items-center justify-center py-16 rounded-[2rem] border border-white/5 bg-[#0B0C10] relative overflow-hidden cursor-pointer transition-all duration-500 hover:border-pink-500/30 hover:shadow-[0_0_30px_rgba(236,72,153,0.1)]"
                        onClick={onCreateClick}
                    >
                        <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 via-transparent to-purple-500/5 opacity-50" />
                        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-white/5 rounded-full animate-[spin_20s_linear_infinite]" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[250px] border border-white/5 rounded-full animate-[spin_15s_linear_infinite_reverse]" />
                        <div className="relative z-10 flex flex-col items-center">
                            <div className="relative mb-4">
                                <div className="absolute inset-0 bg-pink-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                <div className="relative w-16 h-16 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-inner">
                                    <Images className="h-8 w-8 text-white/20 group-hover:text-pink-400 transition-colors duration-300" />
                                </div>
                            </div>
                            <h3 className="text-lg font-bold text-white mb-2 group-hover:text-pink-400 transition-colors tracking-tight">
                                暂无成片任务
                            </h3>
                            <p className="text-sm text-white/40 group-hover:text-white/80 transition-colors">
                                点击{" "}
                                <span className="text-pink-400 font-medium">
                                    &quot;新建成片&quot;
                                </span>{" "}
                                开始制作
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-[2rem] border border-white/5 bg-[#0B0C10] p-5">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            {[...displayTasks].reverse().map((task) => (
                                <SlideshowTaskCard
                                    key={task.id}
                                    task={task}
                                    isSelected={!!selectedTaskIds[task.id]}
                                    onToggleSelect={() =>
                                        onToggleSelect?.(task.id)
                                    }
                                    onDelete={() =>
                                        onTaskDelete?.(task.id)
                                    }
                                    onDownload={() =>
                                        onTaskDownload?.(task.id)
                                    }
                                    onPlay={() =>
                                        onTaskPlay?.(task.id)
                                    }
                                    onRetry={() =>
                                        onTaskRetry?.(task.id)
                                    }
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================================================
// 任务卡片
// ============================================================================

interface SlideshowTaskCardProps {
    task: SlideshowTask;
    isSelected: boolean;
    onToggleSelect?: () => void;
    onDelete?: () => void;
    onDownload?: () => void;
    onPlay?: () => void;
    onRetry?: () => void;
}

function SlideshowTaskCard({
    task,
    isSelected,
    onToggleSelect,
    onDelete,
    onDownload,
    onPlay,
    onRetry,
}: SlideshowTaskCardProps) {
    const statusConfig = {
        pending: {
            label: "等待中",
            color: "text-yellow-400",
            bg: "bg-yellow-400/20",
        },
        uploading: {
            label: "上传中",
            color: "text-blue-400",
            bg: "bg-blue-400/20",
        },
        generating: {
            label: "生成中",
            color: "text-blue-400",
            bg: "bg-blue-400/20",
        },
        completed: {
            label: "已完成",
            color: "text-green-400",
            bg: "bg-green-400/20",
        },
        failed: {
            label: "失败",
            color: "text-red-400",
            bg: "bg-red-400/20",
        },
    };

    const status = statusConfig[task.status] || statusConfig.pending;
    const hasVideo =
        task.outputUrl || (task.outputUrls && task.outputUrls.length > 0);
    const videoUrl = task.outputUrls?.[0] || task.outputUrl;
    const isProcessing =
        task.status === "uploading" || task.status === "generating";

    return (
        <div
            className={cn(
                "group relative rounded-xl overflow-hidden border bg-white/5 transition-all",
                isSelected
                    ? "border-pink-500/50 ring-1 ring-pink-500/20"
                    : "border-white/10 hover:border-white/20"
            )}
        >
            {/* 选择 checkbox */}
            <button
                onClick={onToggleSelect}
                className={cn(
                    "absolute top-2 left-2 z-20 w-5 h-5 rounded border flex items-center justify-center transition-all",
                    isSelected
                        ? "bg-pink-500 border-pink-500 text-white"
                        : "bg-black/30 border-white/30 text-transparent hover:border-white/60"
                )}
            >
                <Check className="h-3 w-3" />
            </button>

            {/* 视频预览区域 */}
            <div className="aspect-[3/4] relative bg-black/30">
                {hasVideo && videoUrl ? (
                    <video
                        src={`${videoUrl}#t=0.5`}
                        className="w-full h-full object-cover"
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        onMouseEnter={(e) => {
                            e.currentTarget.currentTime = 0;
                            e.currentTarget.play();
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.pause();
                            e.currentTarget.currentTime = 0.5;
                        }}
                    />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                        {isProcessing ? (
                            <>
                                <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
                                <span className="text-xs text-blue-400/80">
                                    {task.stage === "uploading"
                                        ? "上传中..."
                                        : task.stage === "caption"
                                            ? "生成文案..."
                                            : task.stage === "voiceover"
                                                ? "生成配音..."
                                                : task.stage === "composing"
                                                    ? "合成视频..."
                                                    : task.stage === "uploading_oss"
                                                        ? "上传结果..."
                                                        : "处理中..."}
                                </span>
                            </>
                        ) : (
                            <Images className="h-8 w-8 text-white/20" />
                        )}
                    </div>
                )}

                {/* 进度条 */}
                {isProcessing && task.progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
                        <div
                            className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-500"
                            style={{ width: `${task.progress}%` }}
                        />
                    </div>
                )}

                {/* 状态标签 */}
                <div
                    className={cn(
                        "absolute top-2 right-2 px-2 py-0.5 rounded text-xs font-medium",
                        status.bg,
                        status.color
                    )}
                >
                    {status.label}
                    {isProcessing && task.progress > 0 && (
                        <span className="ml-1">{task.progress}%</span>
                    )}
                </div>

                {/* 播放按钮覆盖层 */}
                {task.status === "completed" && hasVideo && (
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
            <div className="p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                    <span className="text-white/50 font-medium">
                        {task.mode === "random" ? "智能混剪" : "场景编排"}
                    </span>
                    <span className="text-white/35 text-[10px]">
                        {task.imageCount}张 · {task.duration}s
                    </span>
                </div>

                {/* 配置标签行 */}
                <div className="flex items-center justify-between">
                    {/* 左侧：比例 + 转场 */}
                    <div className="flex items-center gap-1">
                        {task.aspectRatio && (
                            <span className="text-[10px] text-purple-300/80 bg-purple-500/10 border border-purple-500/15 px-1.5 py-[1px] rounded-md">
                                {task.aspectRatio}
                            </span>
                        )}
                        <span className="text-[10px] text-blue-300/70 bg-blue-500/8 border border-blue-500/10 px-1.5 py-[1px] rounded-md truncate max-w-[70px]">
                            {transitionLabel(task.transition)}
                        </span>
                    </div>
                    {/* 右侧：功能小圆点图标 */}
                    <div className="flex items-center gap-1">
                        {task.hasVoice && (
                            <span title="配音" className="w-[18px] h-[18px] rounded-full bg-violet-500/15 flex items-center justify-center">
                                <Mic className="h-2.5 w-2.5 text-violet-400/70" />
                            </span>
                        )}
                        {task.hasBgm && (
                            <span title="BGM" className="w-[18px] h-[18px] rounded-full bg-amber-500/15 flex items-center justify-center">
                                <Music className="h-2.5 w-2.5 text-amber-400/70" />
                            </span>
                        )}
                        {task.hasSubtitle && (
                            <span title="字幕" className="w-[18px] h-[18px] rounded-full bg-cyan-500/15 flex items-center justify-center">
                                <Type className="h-2.5 w-2.5 text-cyan-400/70" />
                            </span>
                        )}
                    </div>
                </div>

                {/* 错误信息 */}
                {task.status === "failed" && task.errorMessage && (
                    <p className="text-[10px] text-red-400/70 truncate">
                        {task.errorMessage}
                    </p>
                )}

                {/* 操作按钮 */}
                <div className="flex items-center gap-1 pt-0.5">
                    {task.status === "completed" && hasVideo && (
                        <button
                            onClick={onDownload}
                            className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs transition-colors"
                        >
                            <Download className="h-3.5 w-3.5 inline mr-1" />
                            下载
                        </button>
                    )}
                    {task.status === "failed" && (
                        <button
                            onClick={onRetry}
                            className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-orange-500/20 text-white/60 hover:text-orange-400 text-xs transition-colors"
                        >
                            <RotateCcw className="h-3.5 w-3.5 inline mr-1" />
                            重试
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
