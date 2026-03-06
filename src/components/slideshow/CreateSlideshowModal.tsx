"use client";

/**
 * 新建成片方案弹窗
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
    ChevronUp,
    ChevronDown,
    Check,
    Type,
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
    const [imagesPerVideo, setImagesPerVideo] = useState(1);

    // 场景编排状态
    const [positions, setPositions] = useState<Position[]>([
        { id: "1", name: "位置 1", images: [] },
    ]);

    // 配置状态 (新结构)
    const [config, setConfig] = useState<SlideshowConfig>({
        duration: 5,
        transition: "fade",
        aspectRatio: "9:16",
        subtitle: {  // 视频增强默认启用
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
            fontFamily: "NotoSansSC",
            borderWidth: 0,
            borderColor: "#000000",
            shadow: false,
            textOverlays: [],
            animation: 'fade',
        },
        bgm: {
            enabled: true,
            mode: "random",
        },
        voice: {
            enabled: true,
            voiceId: "random",
            voiceName: "随机",
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
    const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");

    // 计算每条视频的图片数
    const getImagesPerVideoForPosition = () => positions.length || 1;

    // 计算预计生成视频数（position模式）
    const getPositionVideoCount = () => {
        const counts = positions.map(p => p.images.length).filter(n => n > 0);
        return counts.length > 0 ? Math.min(...counts) : 0;
    };

    // 计算总时长
    const calculateTotalDuration = () => {
        const imageCount =
            activeTab === "random"
                ? Math.min(randomImages.length, imagesPerVideo) || 1
                : getImagesPerVideoForPosition();
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

    // 移动位置（上下排序）
    const movePosition = (id: string, direction: 'up' | 'down') => {
        setPositions((prev) => {
            const idx = prev.findIndex(p => p.id === id);
            if (idx < 0) return prev;
            const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
            if (targetIdx < 0 || targetIdx >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
            return next;
        });
    };

    // 重命名位置
    const startRename = (pos: { id: string; name: string }) => {
        setEditingPositionId(pos.id);
        setEditingName(pos.name);
    };
    const confirmRename = () => {
        if (editingPositionId && editingName.trim()) {
            setPositions(prev => prev.map(p =>
                p.id === editingPositionId ? { ...p, name: editingName.trim() } : p
            ));
        }
        setEditingPositionId(null);
    };

    // 提交
    const handleSubmit = () => {
        // 检查是否配置了文案内容（防止手滑生成无文本的视频）
        const hasAiCaption = config.aiCaption?.enabled && !!config.aiCaption?.keywords;
        const hasTextOverlays = (config.subtitle?.textOverlays?.length ?? 0) > 0;
        const hasTextContent = hasAiCaption || hasTextOverlays;

        if (!hasTextContent) {
            const shouldContinue = confirm(
                "⚠️ 您还未配置文案内容\n\n" +
                "请先点击「配置视频增强」→ 填写描述 → 点击「生成文案」，为视频添加配音文案和图文字幕。\n\n" +
                "确定要不配置文案直接生成吗？"
            );
            if (!shouldContinue) return;
        }

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
            {/* 1. Modal Shell: Titanium V2 Aesthetics - Split-Pane Layout left-70 right-30 */}
            <DialogContent className="max-w-[95vw] w-[1400px] h-[85vh] flex flex-row overflow-hidden bg-[#0B0C10] border-white/10 rounded-2xl p-0 gap-0 shadow-2xl [&>button]:hidden">

                {/* ==================== 左侧：沉浸式素材流 (70%) ==================== */}
                <div className="w-[70%] h-full flex flex-col min-w-0 bg-transparent flex-shrink-0 relative">
                    {/* 左侧顶栏：融合标题和导航 */}
                    <div className="shrink-0 px-6 py-5 flex items-center justify-between z-10">
                        <DialogTitle className="text-white flex items-center gap-2 m-0 text-xl font-medium tracking-wide">
                            <Sparkles className="h-6 w-6 text-mermaid-pink" />
                            <span>新建成片方案</span>
                        </DialogTitle>

                        {/* Central Segmented Control for Tabs - moved to right of left header */}
                        <div className="flex bg-white/5 rounded-xl p-1 border border-white/5 shadow-inner">
                            <button
                                onClick={() => setActiveTab("random")}
                                className={cn(
                                    "px-6 py-2 rounded-lg text-sm font-medium transition-all duration-300 flex items-center gap-2 relative z-10",
                                    activeTab === "random"
                                        ? "text-white"
                                        : "text-white/40 hover:text-white/70"
                                )}
                            >
                                {activeTab === "random" && (
                                    <div className="absolute inset-0 bg-white/10 rounded-lg -z-10 shadow-[0_2px_10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]" />
                                )}
                                <Shuffle className={cn("h-4 w-4", activeTab === "random" && "text-mermaid-cyan drop-shadow-[0_0_8px_rgba(0,242,234,0.5)]")} />
                                智能混剪
                            </button>
                            <button
                                onClick={() => setActiveTab("position")}
                                className={cn(
                                    "px-6 py-2 rounded-lg text-sm font-medium transition-all duration-300 flex items-center gap-2 relative z-10",
                                    activeTab === "position"
                                        ? "text-white"
                                        : "text-white/40 hover:text-white/70"
                                )}
                            >
                                {activeTab === "position" && (
                                    <div className="absolute inset-0 bg-white/10 rounded-lg -z-10 shadow-[0_2px_10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]" />
                                )}
                                <Layers className={cn("h-4 w-4", activeTab === "position" && "text-mermaid-pink drop-shadow-[0_0_8px_rgba(255,64,129,0.5)]")} />
                                场景编排
                            </button>
                        </div>
                    </div>

                    {/* 左侧主内容区 */}
                    <div className="flex-1 overflow-y-auto px-6 pb-6 min-h-0 relative scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                        {activeTab === "random" ? (
                            <>
                                {/* 智能混剪：超宽沉浸式图片排版网格 */}
                                <div className="flex-1 overflow-y-auto min-h-0 bg-white/[0.01] rounded-2xl border border-white/[0.03] p-6 relative">
                                    <div className="flex items-center gap-3 mb-6 sticky top-0 bg-[#0B0C10]/80 backdrop-blur-sm p-1 z-10 w-fit rounded-lg">
                                        <div className="w-1 h-3.5 bg-mermaid-pink rounded-full shadow-[0_0_8px_rgba(255,0,128,0.5)]" />
                                        <h3 className="text-sm font-bold text-white/90 tracking-wide">横排图片素材库</h3>
                                        <div className="flex items-center bg-white/5 rounded-full px-2 py-0.5 ml-2">
                                            <span className="text-[10px] text-white/40 mr-1">合计上传</span>
                                            <span className="text-xs text-white/90 font-mono font-medium">{randomImages.length}</span>
                                            <span className="text-[10px] text-white/40 ml-1">张</span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-3 auto-rows-[80px]">
                                        {/* 上传按钮 (宽屏虚线框风格) */}
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="w-full h-full rounded-xl bg-white/[0.01] border-[1.5px] border-dashed border-white/10 hover:border-mermaid-cyan/40 hover:bg-mermaid-cyan/5 flex flex-col items-center justify-center gap-1.5 text-white/30 hover:text-mermaid-cyan transition-all duration-300 group"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-white/5 border border-white/5 flex items-center justify-center group-hover:bg-mermaid-cyan/10 group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(0,242,234,0.3)] transition-transform duration-300">
                                                <Plus className="h-4 w-4" />
                                            </div>
                                            <span className="text-[10px] font-medium tracking-wide">添加素材</span>
                                        </button>

                                        {randomImages.map((file, idx) => (
                                            <div
                                                key={idx}
                                                className="w-full h-full rounded-xl bg-black border border-white/5 overflow-hidden relative group hover:border-white/20 hover:shadow-lg transition-all"
                                            >
                                                {/* Image Thumbnail */}
                                                <img
                                                    src={URL.createObjectURL(file)}
                                                    alt={`Upload ${idx + 1}`}
                                                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity duration-300 group-hover:scale-105"
                                                />

                                                {/* Hover Overlay Gradient */}
                                                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                                                {/* Index Badge */}
                                                <span className="absolute bottom-1 left-1.5 text-[9px] text-white/60 font-mono font-medium drop-shadow-md z-10 transition-colors group-hover:text-white">#{idx + 1}</span>

                                                {/* Delete Button (Floating Pill on Top Right) */}
                                                <button
                                                    onClick={() =>
                                                        setRandomImages((prev) =>
                                                            prev.filter((_, i) => i !== idx)
                                                        )
                                                    }
                                                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white/50 hover:bg-red-500/80 hover:border-red-500/50 hover:text-white hover:shadow-[0_0_10px_rgba(239,68,68,0.5)] transition-all duration-200 opacity-0 group-hover:opacity-100 translate-y-[-5px] group-hover:translate-y-0"
                                                    title="删除"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Large Empty State (when exactly 0 images) */}
                                    {randomImages.length === 0 && (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center bottom-12 pointer-events-none">
                                            <div className="w-16 h-16 rounded-3xl bg-white/[0.02] border border-white/5 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(255,255,255,0.02)] relative overflow-hidden">
                                                {/* Animated breathing glow behind icon */}
                                                <div className="absolute inset-0 bg-gradient-to-br from-mermaid-cyan/10 to-transparent opacity-50 animate-pulse" />
                                                <ImageIcon className="h-7 w-7 text-white/30 relative z-10" />
                                            </div>
                                            <p className="text-sm text-white/50 font-medium tracking-wide mb-1">图片走廊有点空旷</p>
                                            <p className="text-[11px] text-white/20">点击上方大号虚线框，批量倒入素材 (支持 JPG, PNG, WebP)</p>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
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
                                                    {/* 位置名称：编辑 / 显示 */}
                                                    {editingPositionId === pos.id ? (
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="text"
                                                                value={editingName}
                                                                onChange={(e) => setEditingName(e.target.value)}
                                                                onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setEditingPositionId(null); }}
                                                                onBlur={confirmRename}
                                                                autoFocus
                                                                className="text-sm font-medium text-white bg-white/10 border border-mermaid-cyan/50 rounded px-2 py-0.5 outline-none w-32"
                                                            />
                                                            <button onClick={confirmRename} className="p-1 text-mermaid-cyan hover:bg-mermaid-cyan/10 rounded transition-colors">
                                                                <Check className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span className="text-sm font-medium text-white/90">{pos.name}</span>
                                                    )}
                                                    <span className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">
                                                        {pos.images.length} 张
                                                    </span>
                                                </div>
                                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-0.5">
                                                    {/* 上移 */}
                                                    <button
                                                        onClick={() => movePosition(pos.id, 'up')}
                                                        disabled={idx === 0}
                                                        className="p-1.5 text-white/40 hover:text-white rounded-md hover:bg-white/10 transition-colors disabled:opacity-20"
                                                    >
                                                        <ChevronUp className="h-3.5 w-3.5" />
                                                    </button>
                                                    {/* 下移 */}
                                                    <button
                                                        onClick={() => movePosition(pos.id, 'down')}
                                                        disabled={idx === positions.length - 1}
                                                        className="p-1.5 text-white/40 hover:text-white rounded-md hover:bg-white/10 transition-colors disabled:opacity-20"
                                                    >
                                                        <ChevronDown className="h-3.5 w-3.5" />
                                                    </button>
                                                    {/* 重命名 */}
                                                    <button
                                                        onClick={() => startRename(pos)}
                                                        className="p-1.5 text-white/40 hover:text-white rounded-md hover:bg-white/10 transition-colors"
                                                    >
                                                        <Edit2 className="h-3.5 w-3.5" />
                                                    </button>
                                                    {/* 删除 */}
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

                                    <button
                                        onClick={addPosition}
                                        className="w-full py-3 rounded-xl border border-dashed border-white/10 hover:border-mermaid-cyan/30 hover:bg-mermaid-cyan/5 flex items-center justify-center gap-2 text-white/30 hover:text-mermaid-cyan transition-all"
                                    >
                                        <Plus className="h-4 w-4" />
                                        <span className="text-xs font-medium">添加新分镜位置</span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                </div> {/* 结束左侧素材流 div */}

                {/* ==================== 右侧：配置总署 (30%) ==================== */}
                <div className="w-[30%] h-full flex flex-col min-w-[360px] bg-white/[0.02] border-l border-white/5 relative z-20 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
                    {/* 顶部：关闭按钮 */}
                    <div className="shrink-0 h-[68px] flex items-center justify-end px-4">
                        <button
                            onClick={() => onOpenChange(false)}
                            className="p-2.5 hover:bg-white/10 rounded-xl transition-colors text-white/40 hover:text-white"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6 scrollbar-hide">
                        {/* A. 节奏控制 (紧凑版大型 Stepper) */}
                        <div className="space-y-3">
                            <h3 className="text-[11px] text-white/30 tracking-widest font-semibold uppercase flex items-center gap-2">
                                <Clock className="h-3.5 w-3.5" /> 节奏控制
                            </h3>

                            <div className="bg-black/30 rounded-2xl border border-white/5 shadow-inner flex flex-col divide-y divide-white/[0.04]">
                                {activeTab === 'random' && (
                                    <div className="py-3.5 px-4 flex items-center justify-between gap-4">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[13px] font-medium text-white/80">每次成片消耗</span>
                                            <span className="text-[10px] text-white/40">张/视频</span>
                                        </div>
                                        <div className="flex items-center justify-between bg-black rounded-xl p-1 border border-white/5 shrink-0">
                                            <button
                                                onClick={() => setImagesPerVideo(Math.max(1, imagesPerVideo - 1))}
                                                className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-20 bg-white/[0.02]"
                                                disabled={imagesPerVideo <= 1}
                                            >
                                                <Minus className="h-4 w-4" />
                                            </button>
                                            <div className="w-12 text-center font-mono text-mermaid-cyan font-bold text-2xl tabular-nums tracking-tighter drop-shadow-[0_0_15px_rgba(0,242,234,0.4)]">
                                                {imagesPerVideo}
                                            </div>
                                            <button
                                                onClick={() => setImagesPerVideo(Math.min(15, imagesPerVideo + 1))}
                                                className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-20 bg-white/[0.02]"
                                                disabled={imagesPerVideo >= 15}
                                            >
                                                <Plus className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="py-3.5 px-4 flex items-center justify-between gap-4">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[13px] font-medium text-white/80">单图停留时长</span>
                                        <span className="text-[10px] text-white/40">秒/图片</span>
                                    </div>
                                    <div className="flex items-center justify-between bg-black rounded-xl p-1 border border-white/5 shrink-0">
                                        <button
                                            onClick={() => setConfig((c) => ({ ...c, duration: Math.max(2, c.duration - 1) }))}
                                            className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-20 bg-white/[0.02]"
                                            disabled={config.duration <= 2}
                                        >
                                            <Minus className="h-4 w-4" />
                                        </button>
                                        <div className="w-12 text-center font-mono text-mermaid-pink font-bold text-2xl tabular-nums tracking-tighter drop-shadow-[0_0_15px_rgba(255,0,128,0.4)] flex items-baseline justify-center gap-0.5">
                                            {config.duration}<span className="text-xs text-mermaid-pink/60 font-medium relative -top-[1px]">s</span>
                                        </div>
                                        <button
                                            onClick={() => setConfig((c) => ({ ...c, duration: Math.min(10, c.duration + 1) }))}
                                            className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-20 bg-white/[0.02]"
                                            disabled={config.duration >= 10}
                                        >
                                            <Plus className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* B. 画面设定 */}
                        <div className="space-y-3">
                            <h3 className="text-[11px] text-white/30 tracking-widest font-semibold uppercase flex items-center gap-2">
                                <Monitor className="h-3.5 w-3.5" /> 画面设定
                            </h3>
                            <div className="grid grid-cols-2 gap-2 p-1.5 bg-black/40 rounded-xl border border-white/5">
                                {(["9:16", "16:9"] as const).map((ratio) => (
                                    <button
                                        key={ratio}
                                        onClick={() => setConfig((c) => ({ ...c, aspectRatio: ratio }))}
                                        className={cn(
                                            "py-2.5 rounded-lg text-[13px] transition-all flex flex-col items-center justify-center gap-1.5",
                                            config.aspectRatio === ratio
                                                ? "bg-white/10 text-white border border-mermaid-cyan/30 shadow-[inset_0_0_15px_rgba(0,242,234,0.1)] scale-[1.02]"
                                                : "text-white/40 hover:text-white/80 hover:bg-white/5 border border-transparent"
                                        )}
                                    >
                                        {ratio === "9:16" ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
                                        <span className="font-medium whitespace-nowrap">{ratio === "9:16" ? "竖版 (9:16)" : "横版 (16:9)"}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* C. 内容装扮 */}
                        <div className="space-y-3">
                            <h3 className="text-[11px] text-white/30 tracking-widest font-semibold uppercase flex items-center gap-2">
                                <Type className="h-3.5 w-3.5" /> 内容装扮
                            </h3>
                            <div className="relative group p-0.5 rounded-xl bg-gradient-to-r from-mermaid-pink/20 to-mermaid-purple/20 border border-white/5 shadow-[0_0_15px_rgba(255,0,128,0.1)] hover:shadow-[0_0_20px_rgba(255,0,128,0.2)] transition-all">
                                <div className="absolute inset-0 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-r from-mermaid-pink/10 via-mermaid-purple/10 to-mermaid-cyan/10 pointer-events-none rounded-xl" />
                                <SubtitleEditor
                                    subtitle={config.subtitle || {
                                        text: "", boxX: 10, boxY: 80, boxWidth: 80, style: 'classic', tone: 'neutral', color: '#FFFFFF', position: 80, fontSize: 36, fontColor: "#FFFFFF", fontFamily: "Cinzel-VariableFont_wght", borderWidth: 0, borderColor: "#000000", shadow: false, textOverlays: [], animation: 'fade'
                                    }}
                                    onChange={(subtitleConfig) => setConfig((c) => ({ ...c, subtitle: subtitleConfig }))}
                                    previewFiles={activeTab === 'position'
                                        ? positions.flatMap(p => p.images).slice(0, 10)
                                        : randomImages.slice(0, 10)}
                                    aspectRatio={config.aspectRatio}
                                    voiceConfig={config.voice}
                                    onVoiceChange={(voiceConfig) => setConfig((c) => ({ ...c, voice: voiceConfig }))}
                                    aiCaptionConfig={config.aiCaption}
                                    onAiCaptionChange={(aiConfig) => setConfig((c) => ({ ...c, aiCaption: aiConfig }))}
                                    videoCount={activeTab === 'random' ? Math.ceil(randomImages.length / imagesPerVideo) || 0 : getPositionVideoCount()}
                                    videoDurationSeconds={parseFloat(calculateTotalDuration()) || 8}
                                    bgmConfig={config.bgm}
                                    onBgmChange={(bgmConfig) => setConfig((c) => ({ ...c, bgm: bgmConfig }))}
                                    transition={(config.transition as any) || 'fade'}
                                    onTransitionChange={(t) => setConfig((c) => ({ ...c, transition: t }))}
                                    activeMode={activeTab}
                                    totalImageCount={activeTab === 'position'
                                        ? positions.reduce((sum, p) => sum + p.images.length, 0)
                                        : randomImages.length}
                                    sceneCount={positions.length}
                                />
                            </div>
                        </div>
                    </div>

                    {/* 右侧底部看板 & 操作 */}
                    <div className="shrink-0 p-6 bg-[#0B0C10] border-t border-white/5 flex flex-col gap-3 z-30 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
                        <Button
                            onClick={handleSubmit}
                            className="w-full bg-gradient-to-r from-mermaid-pink to-mermaid-purple hover:from-mermaid-pink/90 hover:to-mermaid-purple/90 h-[52px] text-[15px] font-semibold border-none shadow-[0_0_20px_rgba(255,0,128,0.4)] hover:shadow-[0_0_30px_rgba(255,0,128,0.6)] text-white transition-all duration-300 hover:scale-[1.02] rounded-xl flex items-center justify-center gap-2"
                        >
                            <Sparkles className="h-5 w-5 animate-pulse" />
                            立即生成视频
                        </Button>
                        <Button variant="ghost" className="w-full text-white/30 hover:text-white/80 hover:bg-white/5 h-10 text-[13px] font-medium transition-colors">
                            <Save className="h-4 w-4 mr-2" />
                            保存当前方案配置
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
        </Dialog >
    );
}

export default CreateSlideshowModal;
