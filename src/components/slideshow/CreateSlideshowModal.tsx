"use client";

/**
 * 创建轮播任务弹窗
 * 两个Tab: 智能混剪 / 场景编排
 */

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Shuffle,
    Layers,
    Plus,
    Minus,
    X,
    Upload,
    Trash2,
    Edit2,
    Image as ImageIcon,
    Sparkles,
    Save,
    Film,
    Clock,
} from "lucide-react";

// 转场效果
const TRANSITION_OPTIONS = [
    { value: "fade", label: "淡入淡出" },
    { value: "wipeleft", label: "向左擦除" },
    { value: "wiperight", label: "向右擦除" },
    { value: "slideleft", label: "向左滑动" },
    { value: "slideright", label: "向右滑动" },
    { value: "circleopen", label: "圆形展开" },
    { value: "circleclose", label: "圆形收缩" },
    { value: "dissolve", label: "溶解" },
    { value: "fadeblack", label: "黑屏过渡" },
    { value: "fadewhite", label: "白屏过渡" },
];

// 字体选项
const FONT_OPTIONS = [
    { value: "NotoSansSC", label: "思源黑体" },
    { value: "ZCOOLXiaoWei", label: "站酷小薇" },
    { value: "MaShanZheng", label: "马善正楷" },
    { value: "ZCOOLQingKeHuangYou", label: "庆科黄油" },
];

// 颜色选项
const COLOR_OPTIONS = [
    { value: "white", label: "白色", class: "bg-white" },
    { value: "black", label: "黑色", class: "bg-black border border-white/30" },
    { value: "#FFD700", label: "金色", class: "bg-yellow-400" },
    { value: "#00F2EA", label: "青色", class: "bg-cyan-400" },
    { value: "#FE2C55", label: "粉色", class: "bg-pink-500" },
];

interface Position {
    id: string;
    name: string;
    images: File[];
}

interface SubtitleConfig {
    enabled: boolean;
    text: string;
    position: "top" | "center" | "bottom";
    fontFamily: string;
    fontSize: number;
    fontColor: string;
}

interface SlideshowConfig {
    duration: number;
    transition: string;
    aspectRatio: "9:16" | "16:9";
    musicMode: "none" | "preset" | "custom";
    subtitle: SubtitleConfig;
}

interface CreateSlideshowModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: {
        mode: "random" | "position";
        images?: File[];
        imagesPerVideo?: number;
        positions?: Position[];
        config: SlideshowConfig;
    }) => void;
}

export function CreateSlideshowModal({
    open,
    onOpenChange,
    onSubmit,
}: CreateSlideshowModalProps) {
    // Tab 状态
    const [activeTab, setActiveTab] = useState<"random" | "position">("random");

    // 智能混剪状态
    const [randomImages, setRandomImages] = useState<File[]>([]);
    const [imagesPerVideo, setImagesPerVideo] = useState(5);

    // 场景编排状态
    const [positions, setPositions] = useState<Position[]>([
        { id: "1", name: "位置 1", images: [] },
    ]);

    // 配置状态
    const [config, setConfig] = useState<SlideshowConfig>({
        duration: 3,
        transition: "fade",
        aspectRatio: "9:16",
        musicMode: "preset",
        subtitle: {
            enabled: false,
            text: "",
            position: "bottom",
            fontFamily: "NotoSansSC",
            fontSize: 48,
            fontColor: "white",
        },
    });

    // Canvas 预览 ref
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // 文件上传 ref
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadTargetPosition, setUploadTargetPosition] = useState<string | null>(null);

    // 计算总时长
    const calculateTotalDuration = () => {
        const imageCount =
            activeTab === "random"
                ? Math.min(randomImages.length, imagesPerVideo) || 1
                : positions.reduce((sum, p) => sum + (p.images.length || 1), 0);
        const total = imageCount * config.duration - (imageCount - 1) * 0.5;
        return total > 0 ? total.toFixed(1) : "0";
    };

    // 更新预览 Canvas
    useEffect(() => {
        if (!canvasRef.current || !config.subtitle.enabled) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const width = canvas.clientWidth * 2;
        const height = canvas.clientHeight * 2;
        canvas.width = width;
        canvas.height = height;

        // 背景
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        ctx.fillRect(10, 10, width - 20, height - 20);

        if (config.subtitle.text) {
            const fontSize = (config.subtitle.fontSize / 48) * 24;
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = config.subtitle.fontColor;
            ctx.textAlign = "center";
            ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
            ctx.shadowBlur = 4;

            let y: number;
            if (config.subtitle.position === "top") y = height * 0.15;
            else if (config.subtitle.position === "center") y = height / 2;
            else y = height * 0.85;

            ctx.fillText(config.subtitle.text, width / 2, y);
        }
    }, [config.subtitle]);

    // 处理文件上传
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        if (activeTab === "random") {
            setRandomImages((prev) => [...prev, ...files]);
        } else if (uploadTargetPosition) {
            setPositions((prev) =>
                prev.map((p) =>
                    p.id === uploadTargetPosition
                        ? { ...p, images: [...p.images, ...files] }
                        : p
                )
            );
            setUploadTargetPosition(null);
        }
        e.target.value = "";
    };

    // 添加位置
    const addPosition = () => {
        setPositions((prev) => [
            ...prev,
            { id: Date.now().toString(), name: `位置 ${prev.length + 1}`, images: [] },
        ]);
    };

    // 删除位置
    const removePosition = (id: string) => {
        if (positions.length <= 1) return;
        setPositions((prev) => prev.filter((p) => p.id !== id));
    };

    // 提交
    const handleSubmit = () => {
        if (activeTab === "random") {
            onSubmit({
                mode: "random",
                images: randomImages,
                imagesPerVideo,
                config,
            });
        } else {
            onSubmit({
                mode: "position",
                positions,
                config,
            });
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[90vw] w-[1400px] max-h-[85vh] overflow-hidden bg-black/95 border-white/10">
                <DialogHeader>
                    <DialogTitle className="text-white flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-pink-400" />
                        创建轮播任务
                    </DialogTitle>
                </DialogHeader>

                {/* Tab 切换 - 紧凑版 */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab("random")}
                        className={cn(
                            "flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all text-sm",
                            activeTab === "random"
                                ? "bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/50 text-white"
                                : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
                        )}
                    >
                        <Shuffle className="h-3.5 w-3.5" />
                        <span className="font-medium">智能混剪</span>
                    </button>
                    <button
                        onClick={() => setActiveTab("position")}
                        className={cn(
                            "flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all text-sm",
                            activeTab === "position"
                                ? "bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/50 text-white"
                                : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
                        )}
                    >
                        <Layers className="h-3.5 w-3.5" />
                        <span className="font-medium">场景编排</span>
                    </button>
                </div>

                {/* 主内容区 */}
                <div className="flex gap-6 mt-3 max-h-[72vh] overflow-hidden">
                    {/* 左侧：上传区 */}
                    <div className="flex-[6] overflow-y-auto pr-2 space-y-3">
                        {activeTab === "random" ? (
                            <>
                                {/* 顶部控制栏 - sticky */}
                                <div className="sticky top-0 z-10 bg-black/95 pb-3 border-b border-white/5">
                                    <div className="flex items-center gap-6">
                                        {/* 每视频图片数 */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-white/50">📊 每视频图片数</span>
                                            <button
                                                onClick={() => setImagesPerVideo(Math.max(1, imagesPerVideo - 1))}
                                                className="w-7 h-7 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors disabled:opacity-30"
                                                disabled={imagesPerVideo <= 1}
                                            >
                                                <Minus className="h-3.5 w-3.5" />
                                            </button>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={imagesPerVideo}
                                                onChange={(e) => {
                                                    const val = parseInt(e.target.value) || 1;
                                                    setImagesPerVideo(Math.min(15, Math.max(1, val)));
                                                }}
                                                className="w-10 h-7 rounded-md bg-white/5 border border-white/10 text-white text-center text-sm focus:outline-none focus:ring-1 focus:ring-pink-500/50"
                                            />
                                            <button
                                                onClick={() => setImagesPerVideo(Math.min(15, imagesPerVideo + 1))}
                                                className="w-7 h-7 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors disabled:opacity-30"
                                                disabled={imagesPerVideo >= 15}
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                            </button>
                                            <span className="text-xs text-white/30">张</span>
                                        </div>

                                        {/* 分隔符 */}
                                        <div className="w-px h-5 bg-white/10" />

                                        {/* 每张时长 */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-white/50">⏱️ 每张时长</span>
                                            <button
                                                onClick={() => setConfig((c) => ({ ...c, duration: Math.max(2, c.duration - 1) }))}
                                                className="w-7 h-7 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors disabled:opacity-30"
                                                disabled={config.duration <= 2}
                                            >
                                                <Minus className="h-3.5 w-3.5" />
                                            </button>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={config.duration}
                                                onChange={(e) => {
                                                    const val = parseInt(e.target.value) || 2;
                                                    setConfig((c) => ({ ...c, duration: Math.min(10, Math.max(2, val)) }));
                                                }}
                                                className="w-10 h-7 rounded-md bg-white/5 border border-white/10 text-white text-center text-sm focus:outline-none focus:ring-1 focus:ring-pink-500/50"
                                            />
                                            <button
                                                onClick={() => setConfig((c) => ({ ...c, duration: Math.min(10, c.duration + 1) }))}
                                                className="w-7 h-7 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors disabled:opacity-30"
                                                disabled={config.duration >= 10}
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                            </button>
                                            <span className="text-xs text-white/30">秒</span>
                                        </div>
                                    </div>
                                </div>

                                {/* 智能混剪：图片上传 */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs text-white/60">📸 上传图片</Label>
                                        <span className="text-xs text-white/40">
                                            已上传 {randomImages.length} 张
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-6 gap-2">
                                        {randomImages.map((file, idx) => (
                                            <div
                                                key={idx}
                                                className="aspect-square rounded-lg bg-white/5 border border-white/10 overflow-hidden relative group"
                                            >
                                                <img
                                                    src={URL.createObjectURL(file)}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                />
                                                <button
                                                    onClick={() =>
                                                        setRandomImages((prev) =>
                                                            prev.filter((_, i) => i !== idx)
                                                        )
                                                    }
                                                    className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="aspect-square rounded-lg bg-white/5 border border-dashed border-white/20 hover:border-pink-500/50 flex items-center justify-center text-white/40 hover:text-pink-400 transition-colors"
                                        >
                                            <Plus className="h-6 w-6" />
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* 场景编排：位置列表 */}
                                <div className="space-y-3">
                                    <Label className="text-xs text-white/60">🎯 位置配置</Label>
                                    {positions.map((pos, idx) => (
                                        <div
                                            key={pos.id}
                                            className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-white/80">{pos.name}</span>
                                                <div className="flex items-center gap-1">
                                                    <button className="p-1 text-white/40 hover:text-white">
                                                        <Edit2 className="h-3.5 w-3.5" />
                                                    </button>
                                                    {positions.length > 1 && (
                                                        <button
                                                            onClick={() => removePosition(pos.id)}
                                                            className="p-1 text-white/40 hover:text-red-400"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex gap-2 flex-wrap">
                                                {pos.images.map((file, imgIdx) => (
                                                    <div
                                                        key={imgIdx}
                                                        className="w-12 h-12 rounded bg-white/10 overflow-hidden relative group"
                                                    >
                                                        <img
                                                            src={URL.createObjectURL(file)}
                                                            alt=""
                                                            className="w-full h-full object-cover"
                                                        />
                                                        <button
                                                            onClick={() =>
                                                                setPositions((prev) =>
                                                                    prev.map((p) =>
                                                                        p.id === pos.id
                                                                            ? {
                                                                                ...p,
                                                                                images: p.images.filter(
                                                                                    (_, i) => i !== imgIdx
                                                                                ),
                                                                            }
                                                                            : p
                                                                    )
                                                                )
                                                            }
                                                            className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <X className="h-3 w-3 text-white" />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button
                                                    onClick={() => {
                                                        setUploadTargetPosition(pos.id);
                                                        fileInputRef.current?.click();
                                                    }}
                                                    className="w-12 h-12 rounded bg-white/5 border border-dashed border-white/20 hover:border-pink-500/50 flex items-center justify-center text-white/40 hover:text-pink-400"
                                                >
                                                    <Plus className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    <button
                                        onClick={addPosition}
                                        className="w-full py-2 rounded-lg bg-white/5 border border-dashed border-white/20 hover:border-pink-500/50 text-white/50 hover:text-pink-400 text-xs transition-colors"
                                    >
                                        <Plus className="h-3.5 w-3.5 inline mr-1" />
                                        添加新位置
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* 右侧：配置区 - 紧凑布局 */}
                    <div className="flex-[4] overflow-y-auto pl-4 border-l border-white/10 space-y-3">
                        <h4 className="text-sm font-medium text-white/80 sticky top-0 bg-black/95 pb-2 z-10">⚙️ 轮播配置</h4>

                        {/* 视频比例 */}
                        <div className="space-y-1">
                            <Label className="text-xs text-white/50">视频比例</Label>
                            <div className="flex gap-2">
                                {(["9:16", "16:9"] as const).map((ratio) => (
                                    <button
                                        key={ratio}
                                        onClick={() => setConfig((c) => ({ ...c, aspectRatio: ratio }))}
                                        className={cn(
                                            "flex-1 py-2 rounded-lg text-sm transition-all",
                                            config.aspectRatio === ratio
                                                ? "bg-pink-500/20 text-pink-400 border border-pink-500/30"
                                                : "bg-white/5 text-white/50 hover:bg-white/10"
                                        )}
                                    >
                                        {ratio === "9:16" ? "竖版 9:16" : "横版 16:9"}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 第二行: 转场 + 音乐 */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* 转场效果 */}
                            <div className="space-y-1">
                                <Label className="text-xs text-white/50">转场效果</Label>
                                <Select
                                    value={config.transition}
                                    onValueChange={(v) => setConfig((c) => ({ ...c, transition: v }))}
                                >
                                    <SelectTrigger className="h-8 bg-white/5 border-white/10 text-white text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-black/95 border-white/10">
                                        {TRANSITION_OPTIONS.map((t) => (
                                            <SelectItem key={t.value} value={t.value} className="text-white text-xs">
                                                {t.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* 背景音乐 */}
                            <div className="space-y-1">
                                <Label className="text-xs text-white/50">🎵 背景音乐</Label>
                                <div className="flex gap-1">
                                    {(["none", "preset", "custom"] as const).map((mode) => (
                                        <button
                                            key={mode}
                                            onClick={() => setConfig((c) => ({ ...c, musicMode: mode }))}
                                            className={cn(
                                                "flex-1 py-1.5 rounded-lg text-[10px] transition-all",
                                                config.musicMode === mode
                                                    ? "bg-pink-500/20 text-pink-400 border border-pink-500/30"
                                                    : "bg-white/5 text-white/50 hover:bg-white/10"
                                            )}
                                        >
                                            {mode === "none" ? "无" : mode === "preset" ? "预设" : "自定义"}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* 分隔线 */}
                        <div className="border-t border-white/5 pt-2" />

                        {/* 字幕设置 */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-white/50">📝 字幕设置</Label>
                                <button
                                    onClick={() =>
                                        setConfig((c) => ({
                                            ...c,
                                            subtitle: { ...c.subtitle, enabled: !c.subtitle.enabled },
                                        }))
                                    }
                                    className={cn(
                                        "relative w-9 h-5 rounded-full transition-all",
                                        config.subtitle.enabled
                                            ? "bg-pink-500/30 border border-pink-500/50"
                                            : "bg-white/10 border border-white/20"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "absolute top-0.5 w-4 h-4 rounded-full transition-all",
                                            config.subtitle.enabled
                                                ? "left-[18px] bg-pink-400"
                                                : "left-0.5 bg-white/40"
                                        )}
                                    />
                                </button>
                            </div>

                            {config.subtitle.enabled && (
                                <div className="space-y-2 p-2 bg-white/5 rounded-lg">
                                    {/* 预览和输入 */}
                                    <div className="grid grid-cols-[80px_1fr] gap-2">
                                        {/* 迷你预览 */}
                                        <canvas
                                            ref={canvasRef}
                                            className="w-full aspect-[9/16] bg-black/50 rounded-lg"
                                        />
                                        {/* 右侧配置 */}
                                        <div className="space-y-2">
                                            {/* 文字输入 */}
                                            <Input
                                                value={config.subtitle.text}
                                                onChange={(e) =>
                                                    setConfig((c) => ({
                                                        ...c,
                                                        subtitle: { ...c.subtitle, text: e.target.value },
                                                    }))
                                                }
                                                placeholder="输入字幕..."
                                                className="h-7 bg-white/5 border-white/10 text-white text-xs"
                                            />
                                            {/* 字体 */}
                                            <Select
                                                value={config.subtitle.fontFamily}
                                                onValueChange={(v) =>
                                                    setConfig((c) => ({
                                                        ...c,
                                                        subtitle: { ...c.subtitle, fontFamily: v },
                                                    }))
                                                }
                                            >
                                                <SelectTrigger className="h-7 bg-white/5 border-white/10 text-white text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-black/95 border-white/10">
                                                    {FONT_OPTIONS.map((f) => (
                                                        <SelectItem key={f.value} value={f.value} className="text-white text-xs">
                                                            {f.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            {/* 位置 */}
                                            <div className="flex gap-1">
                                                {(["top", "center", "bottom"] as const).map((pos) => (
                                                    <button
                                                        key={pos}
                                                        onClick={() =>
                                                            setConfig((c) => ({
                                                                ...c,
                                                                subtitle: { ...c.subtitle, position: pos },
                                                            }))
                                                        }
                                                        className={cn(
                                                            "flex-1 py-1 rounded text-[10px] transition-all",
                                                            config.subtitle.position === pos
                                                                ? "bg-pink-500/20 text-pink-400"
                                                                : "bg-white/5 text-white/50"
                                                        )}
                                                    >
                                                        {pos === "top" ? "顶部" : pos === "center" ? "居中" : "底部"}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    {/* 颜色选择 - 单独一行 */}
                                    <div className="flex items-center gap-2 pt-1">
                                        <span className="text-[10px] text-white/40">颜色:</span>
                                        <div className="flex gap-1.5">
                                            {COLOR_OPTIONS.map((c) => (
                                                <button
                                                    key={c.value}
                                                    onClick={() =>
                                                        setConfig((cfg) => ({
                                                            ...cfg,
                                                            subtitle: { ...cfg.subtitle, fontColor: c.value },
                                                        }))
                                                    }
                                                    className={cn(
                                                        "w-5 h-5 rounded-full transition-all",
                                                        c.class,
                                                        config.subtitle.fontColor === c.value
                                                            ? "ring-2 ring-pink-400 scale-110"
                                                            : ""
                                                    )}
                                                    title={c.label}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* 底部按钮 */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
                    <Button variant="ghost" className="text-white/60">
                        <Save className="h-4 w-4 mr-1.5" />
                        保存方案
                    </Button>

                    {/* 中间：预估信息 */}
                    <div className="flex items-center gap-6">
                        {activeTab === "random" && randomImages.length > 0 && (
                            <>
                                <div className="flex items-center gap-2 text-sm">
                                    <Film className="h-4 w-4 text-pink-400" />
                                    <span className="text-white/50">可生成</span>
                                    <span className="text-pink-400 font-bold">
                                        {Math.floor(randomImages.length / imagesPerVideo) || 0}
                                    </span>
                                    <span className="text-white/50">条视频</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    <Clock className="h-4 w-4 text-purple-400" />
                                    <span className="text-white/50">每条约</span>
                                    <span className="text-purple-400 font-bold">
                                        {(imagesPerVideo * config.duration - (imagesPerVideo - 1) * 0.5).toFixed(1)}
                                    </span>
                                    <span className="text-white/50">秒</span>
                                </div>
                            </>
                        )}
                        {activeTab === "position" && positions.length > 0 && (
                            <>
                                <div className="flex items-center gap-2 text-sm">
                                    <Film className="h-4 w-4 text-pink-400" />
                                    <span className="text-white/50">可生成</span>
                                    <span className="text-pink-400 font-bold">
                                        {positions.filter(p => p.images.length > 0).length > 0 ? 1 : 0}
                                    </span>
                                    <span className="text-white/50">条视频</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    <Clock className="h-4 w-4 text-purple-400" />
                                    <span className="text-white/50">每条约</span>
                                    <span className="text-purple-400 font-bold">
                                        {calculateTotalDuration()}
                                    </span>
                                    <span className="text-white/50">秒</span>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-white/60">
                            取消
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
                        >
                            <Sparkles className="h-4 w-4 mr-1.5" />
                            立即创建
                        </Button>
                    </div>
                </div>

                {/* 隐藏的文件输入 */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                />
            </DialogContent>
        </Dialog>
    );
}

export default CreateSlideshowModal;
