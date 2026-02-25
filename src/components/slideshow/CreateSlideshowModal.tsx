"use client";

/**
 * 创建轮播任务弹窗
 * 两个Tab: 智能混剪 / 场景编排
 * 增强版：集成 AI 文案、配音、BGM
 */

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
    Clock,
    Smartphone,
    Monitor,
} from "lucide-react";

// 新增组件导入
import { SubtitleEditor, type SubtitleConfig } from './SubtitleEditor';
import { type BGMConfig } from './BGMSelector';
import { type VoiceConfig } from './VoiceSelector';
import { type AICaptionConfig } from './AICaptionGenerator';

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



interface Position {
    id: string;
    name: string;
    images: File[];
}

// 扩展的轮播配置 - 集成所有新功能
interface SlideshowConfig {
    duration: number;
    transition: string;
    aspectRatio: "9:16" | "16:9";
    // 新增：字幕 (使用 SubtitleEditor 的类型)
    subtitle: SubtitleConfig | null;
    // 新增：BGM
    bgm: BGMConfig;
    // 新增：配音
    voice: VoiceConfig;
    // 新增：AI 文案
    aiCaption: AICaptionConfig;
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

    // 配置状态 (新结构)
    const [config, setConfig] = useState<SlideshowConfig>({
        duration: 3,
        transition: "fade",
        aspectRatio: "9:16",
        subtitle: null, // 字幕默认关闭
        bgm: {
            enabled: false,
            mode: "none",
        },
        voice: {
            enabled: false,
            voiceId: "",
            voiceName: "",
        },
        aiCaption: {
            enabled: false,
            mode: "unified",
            keywords: "",
            style: "lively",
            language: "en", // 默认英文
        },
    });



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

    // 注意: Canvas 预览已移至 SubtitleEditor 组件内部


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
            <DialogContent className="max-w-[90vw] w-[1400px] h-[85vh] flex flex-col overflow-hidden bg-black/95 border-white/10">
                <DialogHeader className="border-b border-white/10 pb-4">
                    <DialogTitle className="text-white flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-mermaid-pink" />
                            <span>创建轮播任务</span>
                        </div>

                        {/* 顶部 Tab 居右显示，更轻量化 */}
                        <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
                            <button
                                onClick={() => setActiveTab("random")}
                                className={cn(
                                    "px-4 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2",
                                    activeTab === "random"
                                        ? "bg-mermaid-pink/20 text-mermaid-pink shadow-[0_0_10px_rgba(255,0,128,0.2)]"
                                        : "text-white/40 hover:text-white/80"
                                )}
                            >
                                <Shuffle className="h-3.5 w-3.5" />
                                智能混剪
                            </button>
                            <button
                                onClick={() => setActiveTab("position")}
                                className={cn(
                                    "px-4 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2",
                                    activeTab === "position"
                                        ? "bg-mermaid-cyan/20 text-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.2)]"
                                        : "text-white/40 hover:text-white/80"
                                )}
                            >
                                <Layers className="h-3.5 w-3.5" />
                                场景编排
                            </button>
                        </div>
                    </DialogTitle>
                </DialogHeader>



                {/* 主内容区 */}
                <div className="flex gap-6 mt-3 flex-1 min-h-0 overflow-hidden">
                    {/* 左侧：内容主区域 (Flex 7) */}
                    <div className="flex-[7] flex flex-col min-w-0 pr-6 border-r border-white/5 h-full overflow-hidden">
                        {activeTab === "random" ? (
                            <>
                                {/* 顶部工具栏 - 上下文相关 */}
                                <div className="flex items-center gap-4 bg-white/5 rounded-xl p-3 border border-white/5 mb-4 shrink-0">
                                    {/* 每视频图片数 */}
                                    <div className="flex items-center gap-3 pr-4 border-r border-white/10">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">每次生成消耗</span>
                                            <span className="text-xs text-white/80">每组图片数量</span>
                                        </div>
                                        <div className="flex items-center bg-black/40 rounded-lg p-0.5 border border-white/10">
                                            <button
                                                onClick={() => setImagesPerVideo(Math.max(1, imagesPerVideo - 1))}
                                                className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-md transition-all disabled:opacity-30"
                                                disabled={imagesPerVideo <= 1}
                                            >
                                                <Minus className="h-3 w-3" />
                                            </button>
                                            <div className="min-w-[40px] text-center font-mono text-mermaid-cyan font-bold text-sm">
                                                {imagesPerVideo}
                                            </div>
                                            <button
                                                onClick={() => setImagesPerVideo(Math.min(15, imagesPerVideo + 1))}
                                                className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-md transition-all disabled:opacity-30"
                                                disabled={imagesPerVideo >= 15}
                                            >
                                                <Plus className="h-3 w-3" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 每张时长 */}
                                    <div className="flex items-center gap-3">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">节奏控制</span>
                                            <span className="text-xs text-white/80">单图停留时长</span>
                                        </div>
                                        <div className="flex items-center bg-black/40 rounded-lg p-0.5 border border-white/10">
                                            <button
                                                onClick={() => setConfig((c) => ({ ...c, duration: Math.max(2, c.duration - 1) }))}
                                                className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-md transition-all disabled:opacity-30"
                                                disabled={config.duration <= 2}
                                            >
                                                <Minus className="h-3 w-3" />
                                            </button>
                                            <div className="min-w-[40px] text-center font-mono text-mermaid-pink font-bold text-sm">
                                                {config.duration}s
                                            </div>
                                            <button
                                                onClick={() => setConfig((c) => ({ ...c, duration: Math.min(10, c.duration + 1) }))}
                                                className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-md transition-all disabled:opacity-30"
                                                disabled={config.duration >= 10}
                                            >
                                                <Plus className="h-3 w-3" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="ml-auto flex items-center gap-6 text-right">
                                        {/* 预估视频时长 */}
                                        <div>
                                            <div className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">每视频时长</div>
                                            <div className="text-sm font-medium flex items-center gap-1">
                                                <Clock className="h-3 w-3 text-mermaid-cyan" />
                                                <span className="text-mermaid-cyan">{calculateTotalDuration()}</span>
                                                <span className="text-white/50">秒</span>
                                            </div>
                                        </div>
                                        {/* 预计生成视频数 */}
                                        <div>
                                            <div className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">预计生成</div>
                                            <div className="text-sm font-medium">
                                                <span className="text-white">{Math.ceil(randomImages.length / imagesPerVideo) || 0}</span>
                                                <span className="text-white/50 mx-1">条视频</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 智能混剪：图片上传网格 */}
                                <div className="flex-1 overflow-y-auto min-h-0 bg-black/20 rounded-xl border border-white/5 p-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <ImageIcon className="h-4 w-4 text-mermaid-cyan" />
                                            <span className="text-sm font-medium text-white/90">图片素材库</span>
                                        </div>
                                        <span className="text-xs text-white/40 px-2 py-1 rounded bg-white/5">
                                            已上传 <span className="text-white">{randomImages.length}</span> 张
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-3">
                                        {/* 上传按钮 - 固定在第一个 */}
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="aspect-square rounded-xl bg-white/5 border border-dashed border-white/20 hover:border-mermaid-cyan/50 hover:bg-mermaid-cyan/5 flex flex-col items-center justify-center gap-2 text-white/40 hover:text-mermaid-cyan transition-all group"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-mermaid-cyan/20 transition-colors">
                                                <Plus className="h-4 w-4" />
                                            </div>
                                            <span className="text-xs">添加图片</span>
                                        </button>

                                        {randomImages.map((file, idx) => (
                                            <div
                                                key={idx}
                                                className="aspect-square rounded-xl bg-black border border-white/10 overflow-hidden relative group hover:border-mermaid-cyan/50 transition-colors"
                                            >
                                                <img
                                                    src={URL.createObjectURL(file)}
                                                    alt=""
                                                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                                />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <span className="absolute bottom-1.5 left-2 text-[10px] text-white/80 font-mono">#{idx + 1}</span>
                                                    <button
                                                        onClick={() =>
                                                            setRandomImages((prev) =>
                                                                prev.filter((_, i) => i !== idx)
                                                            )
                                                        }
                                                        className="absolute top-1.5 right-1.5 p-1 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-colors"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {randomImages.length === 0 && (
                                        <div className="flex flex-col items-center justify-center h-48 text-white/30">
                                            <Upload className="h-8 w-8 mb-3 opacity-50" />
                                            <p className="text-sm">点击上方 "+" 添加图片素材</p>
                                            <p className="text-xs mt-1 opacity-50">支持 JPG, PNG, WebP 格式</p>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
                                {/* 场景编排：顶部说明 */}
                                <div className="flex items-center justify-between mb-4 px-1">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-medium text-white/90 flex items-center gap-2">
                                            <Layers className="h-4 w-4 text-mermaid-cyan" />
                                            场景剧本编排
                                        </h3>
                                        <p className="text-xs text-white/40">每个"位置"代表一个视频分镜，可为该分镜指定多张备选图片</p>
                                    </div>
                                    <Button
                                        onClick={addPosition}
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs border-dashed border-mermaid-cyan/30 text-mermaid-cyan hover:bg-mermaid-cyan/10 hover:border-mermaid-cyan/50 hover:text-mermaid-cyan"
                                    >
                                        <Plus className="h-3 w-3 mr-1.5" />
                                        添加新位置
                                    </Button>
                                </div>

                                {/* 场景编排：位置列表 */}
                                <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-2">
                                    {positions.map((pos, idx) => (
                                        <div
                                            key={pos.id}
                                            className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-colors group"
                                        >
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center text-xs font-mono text-white/60">
                                                        {idx + 1}
                                                    </div>
                                                    <span className="text-sm font-medium text-white/90">{pos.name}</span>
                                                </div>
                                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                                                    <button className="p-1.5 text-white/40 hover:text-white rounded-md hover:bg-white/10 transition-colors">
                                                        <Edit2 className="h-3.5 w-3.5" />
                                                    </button>
                                                    {positions.length > 1 && (
                                                        <button
                                                            onClick={() => removePosition(pos.id)}
                                                            className="p-1.5 text-white/40 hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 横向滚动图片流 */}
                                            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                                                <button
                                                    onClick={() => {
                                                        setUploadTargetPosition(pos.id);
                                                        fileInputRef.current?.click();
                                                    }}
                                                    className="w-16 h-16 shrink-0 rounded-lg bg-black/20 border border-dashed border-white/10 hover:border-mermaid-pink/50 hover:bg-mermaid-pink/5 flex items-center justify-center text-white/30 hover:text-mermaid-pink transition-all"
                                                >
                                                    <Plus className="h-5 w-5" />
                                                </button>

                                                {pos.images.map((file, imgIdx) => (
                                                    <div
                                                        key={imgIdx}
                                                        className="w-16 h-16 shrink-0 rounded-lg bg-black border border-white/10 overflow-hidden relative group/img"
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
                                                            className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                                                        >
                                                            <X className="h-4 w-4 text-white hover:text-red-400 transition-colors" />
                                                        </button>
                                                    </div>
                                                ))}

                                                {pos.images.length === 0 && (
                                                    <div className="flex items-center text-xs text-white/20 italic pl-2">
                                                        暂无素材...
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}

                                    <div className="h-8 w-full flex items-center justify-center border-t border-white/5 mt-4 pt-2">
                                        <div className="text-xs text-white/30 flex items-center gap-2">
                                            <Clock className="h-3 w-3" />
                                            <span>总时长预估: <span className="text-mermaid-pink">{calculateTotalDuration()}</span> 秒</span>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* 右侧：配置区 (Flex 3) */}
                    <div className="flex-[3] flex flex-col min-w-[320px] overflow-hidden bg-white/[0.02] -mr-6 -my-3 p-6 border-l border-white/5">
                        <div className="flex items-center gap-2 mb-6 text-white/90">
                            <div className="w-1 h-4 bg-mermaid-cyan rounded-full shadow-[0_0_8px_rgba(0,242,234,0.5)]" />
                            <h4 className="text-sm font-bold">全局配置</h4>
                        </div>

                        <div className="space-y-6 overflow-y-auto pr-2 pb-10">
                            {/* 视频比例 */}
                            <div className="space-y-2">
                                <Label className="text-xs text-white/40 font-medium tracking-wide uppercase">视频比例</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    {(["9:16", "16:9"] as const).map((ratio) => (
                                        <button
                                            key={ratio}
                                            onClick={() => setConfig((c) => ({ ...c, aspectRatio: ratio }))}
                                            className={cn(
                                                "relative py-3 px-2 rounded-lg text-xs transition-all border group overflow-hidden",
                                                config.aspectRatio === ratio
                                                    ? "bg-gradient-to-br from-mermaid-pink/10 to-mermaid-purple/10 border-mermaid-pink/50 text-white"
                                                    : "bg-white/5 border-white/5 text-white/50 hover:bg-white/10"
                                            )}
                                        >
                                            <div className="flex flex-col items-center gap-1.5 z-10 relative">
                                                {ratio === "9:16" ? (
                                                    <Smartphone className="h-4 w-4" />
                                                ) : (
                                                    <Monitor className="h-4 w-4" />
                                                )}
                                                <span className="font-medium">{ratio === "9:16" ? "竖版 9:16" : "横版 16:9"}</span>
                                            </div>
                                            {config.aspectRatio === ratio && (
                                                <div className="absolute inset-0 bg-mermaid-pink/5 blur-xl group-hover:bg-mermaid-pink/10 transition-colors" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 转场效果 */}
                            <div className="space-y-2">
                                <Label className="text-xs text-white/40 font-medium tracking-wide uppercase">转场效果</Label>
                                <Select
                                    value={config.transition}
                                    onValueChange={(v) => setConfig((c) => ({ ...c, transition: v }))}
                                >
                                    <SelectTrigger className="h-10 bg-white/5 border-white/10 text-white text-sm hover:border-mermaid-cyan/30 transition-colors">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#1A1B20] border-white/10">
                                        {TRANSITION_OPTIONS.map((t) => (
                                            <SelectItem key={t.value} value={t.value} className="text-white">
                                                {t.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>



                            <SubtitleEditor
                                subtitle={config.subtitle || {
                                    text: "",
                                    boxX: 10,
                                    boxY: 80,
                                    boxWidth: 80,
                                    style: 'classic',
                                    tone: 'neutral',
                                    color: '#FFFFFF',
                                    position: 80,
                                    fontSize: 36,
                                    fontColor: "#FFFFFF",
                                    fontFamily: "Cinzel-VariableFont_wght",
                                    borderWidth: 0,
                                    borderColor: "#000000",
                                    shadow: false,
                                    textOverlays: [],
                                }}
                                onChange={(subtitleConfig) => setConfig((c) => ({ ...c, subtitle: subtitleConfig }))}
                                previewFiles={
                                    activeTab === "random"
                                        ? randomImages.slice(0, 10)
                                        : positions.flatMap(p => p.images).slice(0, 10)
                                }
                                aspectRatio={config.aspectRatio}
                                // AI 配音配置
                                voiceConfig={config.voice}
                                onVoiceChange={(voiceConfig) => setConfig((c) => ({ ...c, voice: voiceConfig }))}
                                // AI 字幕配置
                                aiCaptionConfig={config.aiCaption}
                                onAiCaptionChange={(aiConfig) => setConfig((c) => ({ ...c, aiCaption: aiConfig }))}
                                videoCount={activeTab === "random" ? Math.ceil(randomImages.length / imagesPerVideo) : 1}
                                // 背景音乐（整合到 SubtitleEditor 内部卡片）
                                bgmConfig={config.bgm}
                                onBgmChange={(bgmConfig) => setConfig((c) => ({ ...c, bgm: bgmConfig }))}
                            />
                        </div>
                    </div>
                </div>

                {/* 底部按钮 */}
                <DialogFooter className="border-t border-white/10 pt-4 shrink-0">
                    <div className="flex w-full items-center justify-between">
                        <Button variant="ghost" className="text-white/40 hover:text-white h-9 text-xs">
                            <Save className="h-4 w-4 mr-1.5" />
                            保存方案
                        </Button>

                        <div className="flex gap-2">
                            <Button
                                variant="ghost"
                                onClick={() => onOpenChange(false)}
                                className="text-white/60 hover:text-white h-9"
                            >
                                取消
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                className="bg-gradient-to-r from-mermaid-pink to-mermaid-purple hover:from-mermaid-pink/90 hover:to-mermaid-purple/90 h-9 shadow-[0_0_20px_rgba(255,0,128,0.3)] transition-all hover:scale-105"
                            >
                                <Sparkles className="h-4 w-4 mr-1.5 animate-pulse" />
                                立即创建
                                {(randomImages.length > 0 || positions.length > 0) && (
                                    <span className="ml-2 pl-2 border-l border-white/20 text-xs opacity-80">
                                        {activeTab === 'random' ? Math.ceil(randomImages.length / imagesPerVideo) : (positions.length > 0 ? 1 : 0)} 条
                                    </span>
                                )}
                            </Button>
                        </div>
                    </div>
                </DialogFooter>

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
