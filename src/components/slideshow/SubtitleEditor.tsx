/**
 * 字幕可视化编辑器 - 弹窗版 v2
 * 修复：真正可拖拽 + 图片轮播预览
 */

'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Type, X, Move, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Mic, Play, Pause, Loader2, Wand2, Sparkles, Check, AlertCircle, Music, ChevronDown } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
// ⭐ 类型导入
import { type VoiceConfig, PRESET_VOICES } from './VoiceSelector';
import { type AICaptionConfig, type CaptionStyle } from './AICaptionGenerator';
import { BGMSelector, type BGMConfig } from './BGMSelector';

// 类型定义
export type SubtitleStyle = 'classic' | 'trending' | 'cinema' | 'neon' | 'minimal';
export type SubtitleTone = 'warm' | 'cool' | 'neutral';

// 图文字幕 - 单个文本叠加层
export interface TextOverlay {
    id: string;                     // 唯一标识
    text: string;                   // 文本内容

    // 时间模式
    timingMode: 'image' | 'custom'; // 图片绑定 vs 自由时间

    // 模式A: 图片绑定 (timingMode='image')
    imageIndex?: number;            // 绑定图片序号 (0-based)

    // 模式B: 自由时间 (timingMode='custom', 百分比 0-100)
    startPercent?: number;          // 开始位置 (视频时长百分比)
    endPercent?: number;            // 结束位置 (视频时长百分比)

    // 定位 (百分比 0-100)
    boxX: number;
    boxY: number;
    boxWidth: number;
    boxHeight?: number;           // 可选高度 (仅前端预览用)

    // ⭐ 新增：位置模式 (默认 'fixed')
    positionMode?: 'fixed' | 'random';

    // ⭐ 新增：样式模式 (默认 'custom')
    styleMode?: 'custom' | 'inherit' | 'random';

    // 样式（保持必填，兼容旧代码）
    style: SubtitleStyle;
    tone: SubtitleTone;
    color: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string;
    borderWidth?: number;
    borderColor?: string;
    shadow?: boolean;
}

// AI 文本生成配置
export interface AITextConfig {
    prompt: string;                 // 用户提示词
    mode: 'uniform' | 'diverse';    // 统一文案 vs 多样文案
    count: number;                  // 生成数量
    imageDescriptions?: string[];   // 图片描述
}

export interface SubtitleConfig {
    text: string;
    boxX: number;
    boxY: number;
    boxWidth: number;
    style: SubtitleStyle;
    tone: SubtitleTone;
    color: string;
    // 兼容字段
    position?: number;
    fontSize?: number;
    fontColor?: string;
    fontFamily?: string;
    borderWidth?: number;
    borderColor?: string;
    shadow?: boolean;
    fontWeight?: string;
    voiceDuration?: number;
    wordTimestamps?: Array<{ word: string; start: number; end: number }>;
    // 新增：图文字幕
    textOverlays?: TextOverlay[];
}

interface SubtitleEditorProps {
    subtitle: SubtitleConfig | null;
    onChange: (subtitle: SubtitleConfig | null) => void;
    previewImages?: string[];
    previewImage?: string;
    previewFiles?: File[];
    aspectRatio?: '9:16' | '16:9';
    voiceConfig?: VoiceConfig;
    onVoiceChange?: (config: VoiceConfig) => void;
    aiCaptionConfig?: AICaptionConfig;
    onAiCaptionChange?: (config: AICaptionConfig) => void;
    videoCount?: number;
    // 背景音乐（从全局配置移入）
    bgmConfig?: BGMConfig;
    onBgmChange?: (config: BGMConfig) => void;
}

// 风格预设配置
const STYLE_PRESETS: Record<SubtitleStyle, {
    label: string;
    icon: string;
    fontFamily: string;
    fontSize: number;
    borderWidth: number;
    borderColor: string;
    shadow: boolean;
    fontWeight: string;
}> = {
    classic: {
        label: '经典',
        icon: '📺',
        fontFamily: 'Microsoft YaHei',
        fontSize: 14,
        borderWidth: 2,
        borderColor: '#000000',
        shadow: true,
        fontWeight: '600',
    },
    trending: {
        label: '潮流',
        icon: '🔥',
        fontFamily: 'Microsoft YaHei',
        fontSize: 18,
        borderWidth: 3,
        borderColor: '#000000',
        shadow: true,
        fontWeight: '700',
    },
    cinema: {
        label: '影视',
        icon: '🎬',
        fontFamily: 'Georgia',
        fontSize: 12,
        borderWidth: 1,
        borderColor: '#000000',
        shadow: true,
        fontWeight: '400',
    },
    neon: {
        label: '霓虹',
        icon: '💜',
        fontFamily: 'Microsoft YaHei',
        fontSize: 14,
        borderWidth: 0,
        borderColor: 'transparent',
        shadow: true,
        fontWeight: '600',
    },
    minimal: {
        label: '简约',
        icon: '✏️',
        fontFamily: 'Georgia',
        fontSize: 12,
        borderWidth: 0,
        borderColor: 'transparent',
        shadow: false,
        fontWeight: '400',
    },
};

// 色调配色
const TONE_COLORS: Record<SubtitleTone, { label: string; icon: string; colors: { value: string; label: string }[] }> = {
    warm: {
        label: '暖调',
        icon: '🌞',
        colors: [
            { value: '#FFD700', label: '金色' },
            { value: '#FFA500', label: '橙色' },
            { value: '#FF69B4', label: '粉色' },
        ],
    },
    cool: {
        label: '冷调',
        icon: '❄️',
        colors: [
            { value: '#00F2EA', label: '青色' },
            { value: '#4DA6FF', label: '蓝色' },
            { value: '#8B5CF6', label: '紫色' },
        ],
    },
    neutral: {
        label: '中性',
        icon: '⚪',
        colors: [
            { value: '#FFFFFF', label: '白色' },
            { value: '#E0E0E0', label: '灰色' },
            { value: '#FFFACD', label: '米色' },
        ],
    },
};



// ⭐ 新增：AI 字幕风格选项
const AI_SUBTITLE_STYLES = [
    { id: 'lively', label: '🎉 活泼' },
    { id: 'professional', label: '💼 专业' },
    { id: 'humor', label: '😄 幽默' },
    { id: 'poetic', label: '📖 诗意' },
    { id: 'minimal', label: '✨ 极简' },
] as const;

// 默认配置
const DEFAULT_CONFIG: SubtitleConfig = {
    text: '',
    boxX: 10,
    boxY: 75,
    boxWidth: 80,
    style: 'classic',
    tone: 'neutral',
    color: '#FFFFFF',
    position: 75,
    fontSize: 14,
    fontColor: '#FFFFFF',
    fontFamily: 'Microsoft YaHei',
    borderWidth: 2,
    borderColor: '#000000',
    shadow: true,
};

export function SubtitleEditor({
    subtitle,
    onChange,
    previewImages = [],
    previewImage,
    previewFiles = [],
    aspectRatio = '9:16',
    voiceConfig,
    onVoiceChange,
    aiCaptionConfig,
    onAiCaptionChange,
    videoCount = 1,
    bgmConfig,
    onBgmChange
}: SubtitleEditorProps) {
    const enabled = subtitle !== null;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const previewRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [fontScale, setFontScale] = useState(1);
    // 卡片折叠状态
    const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({ bgm: false, voice: true, style: true, overlay: false });

    // AI 生成相关状态
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiMode, setAiMode] = useState<'uniform' | 'diverse'>('uniform');
    const [aiLanguage, setAiLanguage] = useState<'en' | 'zh'>('en');  // 语言选择
    const [isGenerating, setIsGenerating] = useState(false);

    // 编辑弹窗状态
    const [editingOverlay, setEditingOverlay] = useState<TextOverlay | null>(null);

    // TextOverlay 拖拽状态
    const [draggingOverlayId, setDraggingOverlayId] = useState<string | null>(null);



    // ⭐ 新增：图文字幕位置/样式模式
    const [overlayPositionMode, setOverlayPositionMode] = useState<'fixed' | 'random'>('fixed');
    const [overlayStyleMode, setOverlayStyleMode] = useState<'custom' | 'inherit' | 'random'>('inherit');





    // 使用 useMemo 缓存 File 对象的 blob URLs
    const fileUrls = React.useMemo(() => {
        return previewFiles.slice(0, 10).map(file => URL.createObjectURL(file));
    }, [previewFiles]);

    // 清理 blob URLs
    React.useEffect(() => {
        return () => {
            fileUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [fileUrls]);

    // 合并所有图片来源：File URLs > previewImages > 单个 previewImage
    const allImages = React.useMemo(() => {
        if (fileUrls.length > 0) return fileUrls;
        if (previewImages.length > 0) return previewImages;
        if (previewImage) return [previewImage];
        return [];
    }, [fileUrls, previewImages, previewImage]);

    const currentPreviewImage = allImages[Math.min(currentImageIndex, allImages.length - 1)];

    // 计算预览区相对于实际视频的缩放比例
    // 实际视频尺寸：9:16 = 1080x1920, 16:9 = 1920x1080
    const [previewScale, setPreviewScale] = useState(1);
    const ACTUAL_VIDEO_HEIGHT = aspectRatio === '9:16' ? 1920 : 1080;

    // 监听预览区大小变化，动态计算缩放比例
    React.useEffect(() => {
        if (!previewRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const height = entry.contentRect.height;
                if (height > 0) {
                    setPreviewScale(height / ACTUAL_VIDEO_HEIGHT);
                }
            }
        });

        observer.observe(previewRef.current);
        return () => observer.disconnect();
    }, [ACTUAL_VIDEO_HEIGHT]);

    // 启用/禁用
    const handleEnable = () => {
        if (!enabled) {
            onChange(DEFAULT_CONFIG);
        } else {
            onChange(null);
        }
    };

    // 打开编辑弹窗
    const openModal = () => {
        if (enabled) {
            setIsModalOpen(true);
        }
    };

    // 关闭弹窗
    const closeModal = () => {
        setIsModalOpen(false);
    };

    // 应用风格预设
    const applyStyle = (style: SubtitleStyle) => {
        if (!subtitle) return;
        const preset = STYLE_PRESETS[style];
        onChange({
            ...subtitle,
            style,
            fontFamily: preset.fontFamily,
            fontSize: preset.fontSize,
            borderWidth: preset.borderWidth,
            borderColor: preset.borderColor,
            shadow: preset.shadow,
            fontWeight: preset.fontWeight,
        });
    };

    // 应用色调
    const applyTone = (tone: SubtitleTone) => {
        if (!subtitle) return;
        const firstColor = TONE_COLORS[tone].colors[0].value;
        onChange({
            ...subtitle,
            tone,
            color: firstColor,
            fontColor: firstColor,
        });
    };

    // 应用颜色
    const applyColor = (color: string) => {
        if (!subtitle) return;
        onChange({
            ...subtitle,
            color,
            fontColor: color,
        });
    };

    // === 图文字幕 CRUD 函数 ===

    // 创建新的 TextOverlay
    const createTextOverlay = (imageIndex: number, text: string = ''): TextOverlay => {
        // 根据 styleMode 决定样式
        let styleProps: { style: SubtitleStyle; tone: SubtitleTone; color: string; borderColor?: string };

        if (overlayStyleMode === 'inherit' && subtitle) {
            // 继承配音字幕风格
            styleProps = {
                style: subtitle.style,
                tone: subtitle.tone,
                color: subtitle.color,
            };
        } else if (overlayStyleMode === 'random') {
            // 纯随机风格
            const styles: SubtitleStyle[] = ['classic', 'trending', 'cinema', 'neon', 'minimal'];
            const tones: SubtitleTone[] = ['warm', 'cool', 'neutral'];
            const allColors = ['#FFD700', '#FFA500', '#FF69B4', '#00F2EA', '#4DA6FF', '#8B5CF6', '#FFFFFF', '#E0E0E0', '#FFFACD'];
            const randomColor = allColors[Math.floor(Math.random() * allColors.length)];
            const isLight = ['#FFD700', '#FFFFFF', '#E0E0E0', '#FFFACD', '#FF69B4'].includes(randomColor);
            styleProps = {
                style: styles[Math.floor(Math.random() * styles.length)],
                tone: tones[Math.floor(Math.random() * tones.length)],
                color: randomColor,
                borderColor: isLight ? '#000000' : '#FFFFFF',
            };
        } else {
            // 自定义模式 - 默认值
            styleProps = {
                style: 'classic',
                tone: 'neutral',
                color: '#FFFFFF',
            };
        }

        return {
            id: crypto.randomUUID(),
            text,
            timingMode: 'image' as const,
            imageIndex,
            boxX: 10,
            boxY: 20,
            boxWidth: 80,
            // ⭐ 新增字段
            positionMode: overlayPositionMode,
            styleMode: overlayStyleMode,
            // 样式
            ...styleProps,
            fontSize: 14,
            fontFamily: 'Microsoft YaHei',
            fontWeight: '400',
            borderWidth: 2,
            borderColor: styleProps.borderColor || '#000000',
            shadow: true,
        };
    };

    // 添加 TextOverlay
    const addTextOverlay = (imageIndex: number) => {
        if (!subtitle) return;
        const newOverlay = createTextOverlay(imageIndex);
        const existingOverlays = subtitle.textOverlays || [];
        onChange({
            ...subtitle,
            textOverlays: [...existingOverlays, newOverlay],
        });
    };

    // 删除 TextOverlay
    const deleteTextOverlay = (overlayId: string) => {
        if (!subtitle) return;
        const existingOverlays = subtitle.textOverlays || [];
        onChange({
            ...subtitle,
            textOverlays: existingOverlays.filter(o => o.id !== overlayId),
        });
    };

    // 更新 TextOverlay
    const updateTextOverlay = (overlayId: string, updates: Partial<TextOverlay>) => {
        if (!subtitle) return;
        const existingOverlays = subtitle.textOverlays || [];
        onChange({
            ...subtitle,
            textOverlays: existingOverlays.map(o =>
                o.id === overlayId ? { ...o, ...updates } : o
            ),
        });
    };

    // 添加自由模式 TextOverlay
    const addCustomOverlay = () => {
        if (!subtitle) return;
        const newOverlay: TextOverlay = {
            id: crypto.randomUUID(),
            text: '',
            timingMode: 'custom',
            startPercent: 0,
            endPercent: 100,
            boxX: 10,
            boxY: 20,
            boxWidth: 80,
            style: 'classic',
            tone: 'neutral',
            color: '#FFFFFF',
            fontSize: 14,
            fontFamily: 'Microsoft YaHei',
            fontWeight: '400',
            borderWidth: 2,
            borderColor: '#000000',
            shadow: true,
        };
        const existingOverlays = subtitle.textOverlays || [];
        onChange({
            ...subtitle,
            textOverlays: [...existingOverlays, newOverlay],
        });
    };

    // 获取按模式分组的 overlays
    const imageOverlays = subtitle?.textOverlays?.filter(o => (o.timingMode ?? 'image') === 'image') || [];
    const customOverlays = subtitle?.textOverlays?.filter(o => o.timingMode === 'custom') || [];

    // 当前图片显示的 overlays（用于预览区可视化）
    const visibleOverlays = React.useMemo(() => {
        // 图片模式：显示绑定到当前图片的 overlay
        const imageBindings = imageOverlays.filter(o => o.imageIndex === currentImageIndex);
        // 自由模式：始终显示（因为它们的时间是动态的）
        return [...imageBindings, ...customOverlays];
    }, [imageOverlays, customOverlays, currentImageIndex]);

    // TextOverlay 拖拽处理
    const handleOverlayMouseDown = (e: React.MouseEvent, overlayId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDraggingOverlayId(overlayId);
    };

    // 使用 ref 存储更新函数以避免 useCallback 依赖问题
    const updateTextOverlayRef = React.useRef(updateTextOverlay);
    updateTextOverlayRef.current = updateTextOverlay;

    const handleOverlayMouseMove = React.useCallback((e: MouseEvent) => {
        if (!draggingOverlayId || !previewRef.current) return;

        const rect = previewRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        // 限制在预览区内（左上角定位，防止超出边界）
        // 找到当前拖拽的 overlay 获取其宽度
        const currentOverlay = subtitle?.textOverlays?.find(o => o.id === draggingOverlayId);
        const overlayWidth = currentOverlay?.boxWidth || 20;
        // X: 不能超出右边界 (100 - width)
        const clampedX = Math.max(0, Math.min(100 - overlayWidth, x));
        // Y: 最多到 95% 防止超出底部
        const clampedY = Math.max(0, Math.min(95, y));

        updateTextOverlayRef.current(draggingOverlayId, { boxX: Math.round(clampedX), boxY: Math.round(clampedY) });
    }, [draggingOverlayId, subtitle?.textOverlays]); // 添加 textOverlays 依赖以获取正确的 boxWidth

    const handleOverlayMouseUp = React.useCallback(() => {
        setDraggingOverlayId(null);
    }, []);

    // 监听全局鼠标事件用于 overlay 拖拽
    React.useEffect(() => {
        if (draggingOverlayId) {
            window.addEventListener('mousemove', handleOverlayMouseMove);
            window.addEventListener('mouseup', handleOverlayMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleOverlayMouseMove);
                window.removeEventListener('mouseup', handleOverlayMouseUp);
            };
        }
    }, [draggingOverlayId, handleOverlayMouseMove, handleOverlayMouseUp]);

    // AI 生成图文字幕
    const generateAITexts = async () => {
        if (!subtitle || !aiPrompt.trim() || allImages.length === 0) return;

        setIsGenerating(true);
        try {
            const response = await fetch('/api/ai/generate-text-overlays', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: aiPrompt,
                    mode: aiMode,
                    count: allImages.length,
                    imageDescriptions: [],
                    language: aiLanguage,  // Bug #1 修复：传递语言参数
                }),
            });

            const data = await response.json();

            if (!data.success || !data.texts) {
                throw new Error(data.error || 'AI 生成失败');
            }

            // 为每张图片创建 TextOverlay
            const newOverlays: TextOverlay[] = data.texts.map((text: string, idx: number) => ({
                id: crypto.randomUUID(),
                text,
                timingMode: 'image' as const,    // AI 生成固定为图片模式
                imageIndex: idx,
                boxX: 10,
                boxY: 20,
                boxWidth: 80,
                style: 'classic' as SubtitleStyle,
                tone: 'neutral' as SubtitleTone,
                color: '#FFFFFF',
                fontSize: 14,
                fontFamily: 'Microsoft YaHei',
                fontWeight: '400',
                borderWidth: 2,
                borderColor: '#000000',
                shadow: true,
            }));

            // 替换现有的 textOverlays
            onChange({
                ...subtitle,
                textOverlays: newOverlays,
            });

        } catch (error: any) {
            console.error('[AI Generate Error]:', error);
            alert(error.message || 'AI 生成失败，请重试');
        } finally {
            setIsGenerating(false);
        }
    };

    // AI 字幕生成（卡片2 - 配音字幕文案）
    const generateAICaptions = async () => {
        if (!aiCaptionConfig || !onAiCaptionChange) return;
        if (!aiCaptionConfig.keywords?.trim()) {
            alert('请先输入主题/关键词');
            return;
        }
        setIsGenerating(true);
        try {
            const response = await fetch('/api/ai/captions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keywords: aiCaptionConfig.keywords,
                    style: aiCaptionConfig.style || 'lively',
                    count: videoCount,
                    mode: aiCaptionConfig.mode || 'unified',
                    language: aiCaptionConfig.language || 'en',
                }),
            });
            if (!response.ok) throw new Error('AI 生成失败');
            const data = await response.json();
            const captions: string[] = data.captions || [];
            // 将生成的文案设置为字幕文本
            if (subtitle && captions.length > 0) {
                onChange({ ...subtitle, text: captions[0] });
            }
            onAiCaptionChange({ ...aiCaptionConfig, generatedTexts: captions });
        } catch (error: any) {
            console.error('[AI Caption Generate Error]:', error);
            alert(error.message || 'AI 字幕生成失败，请重试');
        } finally {
            setIsGenerating(false);
        }
    };

    // 真正的拖拽处理
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    // 拖拽移动 - 使用 document 级别监听
    useEffect(() => {
        if (!isDragging || !subtitle) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!previewRef.current) return;

            const rect = previewRef.current.getBoundingClientRect();
            // 计算鼠标相对于预览区的 Y 位置百分比
            const relativeY = e.clientY - rect.top;
            const percentY = (relativeY / rect.height) * 100;

            // 限制在 5% - 95% 范围内
            const clampedY = Math.max(5, Math.min(95, percentY));

            onChange({
                ...subtitle,
                boxY: Math.round(clampedY),
                position: Math.round(clampedY),
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        // 添加到 document 以支持鼠标移出预览区
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, subtitle, onChange]);

    // 字号放大/缩小
    const handleZoomIn = () => {
        setFontScale(prev => Math.min(2, prev + 0.1));
        if (subtitle) {
            onChange({
                ...subtitle,
                fontSize: Math.min(36, (subtitle.fontSize || 14) + 2),  // 步长 +2，最大36
            });
        }
    };

    const handleZoomOut = () => {
        setFontScale(prev => Math.max(0.5, prev - 0.1));
        if (subtitle) {
            onChange({
                ...subtitle,
                fontSize: Math.max(8, (subtitle.fontSize || 14) - 2),  // 步长 -2，最小 8px
            });
        }
    };

    // 切换预览图片
    const prevImage = () => {
        setCurrentImageIndex(prev => (prev > 0 ? prev - 1 : allImages.length - 1));
    };

    const nextImage = () => {
        setCurrentImageIndex(prev => (prev < allImages.length - 1 ? prev + 1 : 0));
    };

    // 获取当前风格的文字样式
    const getTextStyle = (): React.CSSProperties => {
        if (!subtitle) return {};
        const preset = STYLE_PRESETS[subtitle.style] || STYLE_PRESETS.classic;

        const baseStyle: React.CSSProperties = {
            color: subtitle.color,
            fontFamily: preset.fontFamily,
            fontWeight: preset.fontWeight,
            letterSpacing: '0.05em',
        };

        // 文字阴影效果
        if (preset.shadow) {
            if (subtitle.style === 'neon') {
                baseStyle.textShadow = `0 0 10px ${subtitle.color}, 0 0 20px ${subtitle.color}, 0 0 30px ${subtitle.color}`;
            } else {
                baseStyle.textShadow = '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
            }
        }

        return baseStyle;
    };



    return (
        <>
            {/* 主入口 */}
            <div className="space-y-3">
                {/* 启用开关 */}
                <div className="flex items-center justify-between">
                    <Label className="text-sm text-white/80 flex items-center gap-2">
                        <Type className="h-4 w-4" />
                        🎬 视频增强
                    </Label>
                    <button
                        onClick={handleEnable}
                        className={cn(
                            "relative w-12 h-6 rounded-full transition-all",
                            enabled
                                ? "bg-white/20 border border-white/40 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                                : "bg-white/10 border border-white/20"
                        )}
                    >
                        <span
                            className={cn(
                                "absolute top-1 w-4 h-4 rounded-full transition-all bg-white shadow-md",
                                enabled ? "left-7" : "left-1"
                            )}
                        />
                    </button>
                </div>

                {/* 配置按钮 */}
                {enabled && (
                    <button
                        onClick={openModal}
                        className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white/80 hover:bg-white/10 hover:border-white/20 transition-all flex items-center justify-center gap-2"
                    >
                        <Type className="h-4 w-4" />
                        配置视频增强
                    </button>
                )}
            </div>

            {/* 弹窗 */}
            {
                isModalOpen && subtitle && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                        <div className="bg-slate-900 border border-white/10 rounded-2xl w-[92vw] max-w-[1100px] h-[88vh] max-h-[800px] overflow-hidden shadow-2xl flex flex-col">
                            {/* 弹窗头部 */}
                            <div className="flex items-center justify-between p-4 border-b border-white/10">
                                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <Type className="h-5 w-5" />
                                    视频增强编辑器
                                </h2>
                                <button
                                    onClick={closeModal}
                                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                                >
                                    <X className="h-5 w-5 text-white/60" />
                                </button>
                            </div>

                            {/* 弹窗内容 */}
                            <div className="p-6 flex gap-6 flex-1 overflow-hidden">
                                {/* 左侧：预览区 */}
                                <div className="flex-shrink-0 w-[300px] space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-sm text-white/60 flex items-center gap-2">
                                            <Move className="h-4 w-4" />
                                            预览区（拖拽字幕调整位置）
                                        </Label>
                                        {/* 字号缩放控制 */}
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={handleZoomOut}
                                                className="p-1.5 hover:bg-white/10 rounded transition-colors"
                                                title="缩小字号"
                                            >
                                                <ZoomOut className="h-4 w-4 text-white/60" />
                                            </button>
                                            <span className="text-xs text-white/40 w-8 text-center">{subtitle.fontSize}</span>
                                            <button
                                                onClick={handleZoomIn}
                                                className="p-1.5 hover:bg-white/10 rounded transition-colors"
                                                title="放大字号"
                                            >
                                                <ZoomIn className="h-4 w-4 text-white/60" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 预览区容器 - 限制高度 */}
                                    <div className="relative">
                                        <div
                                            ref={previewRef}
                                            className={cn(
                                                "relative bg-black rounded-xl overflow-hidden border-2 mx-auto",
                                                isDragging ? "border-white" : "border-white/10",
                                                aspectRatio === '9:16'
                                                    ? 'aspect-[9/16] max-h-[680px] w-auto'
                                                    : 'aspect-video max-h-[320px] w-auto'
                                            )}
                                        >
                                            {/* 背景图片 */}
                                            {currentPreviewImage ? (
                                                <img
                                                    src={currentPreviewImage}
                                                    alt="预览"
                                                    className="absolute inset-0 w-full h-full object-cover"
                                                    draggable={false}
                                                />
                                            ) : (
                                                <div className="absolute inset-0 bg-gradient-to-b from-slate-800 to-slate-900 flex items-center justify-center">
                                                    <span className="text-white/30 text-sm">上传图片后显示预览</span>
                                                </div>
                                            )}

                                            {/* 可拖拽字幕区域 */}
                                            <div
                                                className={cn(
                                                    "absolute left-4 right-4 cursor-ns-resize select-none",
                                                    "bg-black/30 backdrop-blur-sm rounded-lg",
                                                    "border-2 border-dashed transition-all",
                                                    isDragging
                                                        ? "border-white shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                                                        : "border-white/40 hover:border-white/60"
                                                )}
                                                style={{
                                                    top: `${subtitle.boxY}%`,
                                                    transform: 'translateY(-50%)',
                                                }}
                                                onMouseDown={handleMouseDown}
                                            >
                                                {/* 拖拽提示 */}
                                                <div className="absolute -left-1 top-1/2 -translate-y-1/2 -translate-x-full pr-1">
                                                    <Move className="h-4 w-4 text-white" />
                                                </div>

                                                {/* 字幕文字 - 简化预览（模拟播放时效果） */}
                                                <div
                                                    className="text-center py-2 px-3 line-clamp-2"
                                                    style={{
                                                        ...getTextStyle(),
                                                        // 直接显示用户设置的字号 (WYSIWYG)
                                                        // fontSize 是相对于预览区的，FFmpeg 会自动根据视频尺寸调整
                                                        fontSize: `${subtitle.fontSize || 14}px`,
                                                    }}
                                                >
                                                    {/* 只显示前几个词模拟实际播放效果 */}
                                                    {(subtitle.text || '字幕预览效果').split(' ').slice(0, 6).join(' ')}
                                                    {(subtitle.text || '').split(' ').length > 6 ? '...' : ''}
                                                </div>
                                            </div>

                                            {/* TextOverlay 可视化层 - Phase 2 */}
                                            {visibleOverlays.map((overlay) => (
                                                <div
                                                    key={overlay.id}
                                                    className={cn(
                                                        "absolute cursor-move select-none",
                                                        "rounded-lg transition-all duration-75",
                                                        "border-2",
                                                        draggingOverlayId === overlay.id
                                                            ? "border-white shadow-[0_0_15px_rgba(255,255,255,0.4)] z-20"
                                                            : overlay.timingMode === 'custom'
                                                                ? "border-white/40 hover:border-white/60 z-10"
                                                                : "border-white/60 hover:border-white z-10"
                                                    )}
                                                    style={{
                                                        left: `${overlay.boxX}%`,
                                                        top: `${overlay.boxY}%`,
                                                        width: `${overlay.boxWidth}%`,
                                                        height: overlay.boxHeight ? `${overlay.boxHeight}%` : 'auto',
                                                        // 左上角定位（与 FFmpeg ASS \pos() 一致）
                                                    }}
                                                    onMouseDown={(e) => handleOverlayMouseDown(e, overlay.id)}
                                                    onDoubleClick={() => setEditingOverlay(overlay)}
                                                >
                                                    {/* 文本内容 */}
                                                    <div
                                                        className="px-2 py-1 text-center truncate"
                                                        style={{
                                                            color: overlay.color || '#fff',
                                                            fontSize: `${overlay.fontSize || 12}px`,
                                                            fontFamily: overlay.fontFamily || 'Microsoft YaHei',
                                                            fontWeight: overlay.fontWeight || '400',
                                                            textShadow: overlay.shadow ? '1px 1px 2px rgba(0,0,0,0.8)' : 'none',
                                                        }}
                                                    >
                                                        {overlay.text || '(空文本)'}
                                                    </div>

                                                    {/* 模式标签 */}
                                                    <div className={cn(
                                                        "absolute -top-5 left-0 text-[10px] px-1 rounded",
                                                        overlay.timingMode === 'custom'
                                                            ? "bg-white/70 text-black"
                                                            : "bg-white/90 text-black"
                                                    )}>
                                                        {overlay.timingMode === 'custom' ? '⏱️自由' : `📌图${(overlay.imageIndex ?? 0) + 1}`}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* 图片切换按钮 */}
                                        {allImages.length > 1 && (
                                            <>
                                                <button
                                                    onClick={prevImage}
                                                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                                                >
                                                    <ChevronLeft className="h-5 w-5 text-white" />
                                                </button>
                                                <button
                                                    onClick={nextImage}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors"
                                                >
                                                    <ChevronRight className="h-5 w-5 text-white" />
                                                </button>
                                            </>
                                        )}
                                    </div>

                                    {/* 状态信息 */}
                                    <div className="flex items-center justify-between text-xs text-white/40">
                                        <span>位置: {subtitle.boxY}%</span>
                                        <span>字号: {subtitle.fontSize}</span>
                                        {allImages.length > 1 && (
                                            <span>图片: {currentImageIndex + 1}/{allImages.length}</span>
                                        )}
                                    </div>
                                </div>

                                {/* 右侧：配置面板 */}
                                <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                                    {/* ═══ 卡片 1：🎵 背景音乐 ═══ */}
                                    {bgmConfig && onBgmChange && (
                                        <div className="border border-white/10 rounded-xl overflow-hidden">
                                            <button
                                                onClick={() => setExpandedCards(s => ({ ...s, bgm: !s.bgm }))}
                                                className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
                                            >
                                                <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                                                    <Music className="h-4 w-4" />
                                                    🎵 背景音乐
                                                    {bgmConfig.enabled && (
                                                        <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/50">
                                                            {bgmConfig.mode === 'random' ? '随机' : bgmConfig.mode === 'single' ? '指定' : '关闭'}
                                                        </span>
                                                    )}
                                                </div>
                                                <ChevronDown className={cn("h-4 w-4 text-white/40 transition-transform", expandedCards.bgm && "rotate-180")} />
                                            </button>
                                            {expandedCards.bgm && (
                                                <div className="px-3 pb-3 border-t border-white/5">
                                                    <div className="pt-3">
                                                        <BGMSelector config={bgmConfig} onChange={onBgmChange} videoCount={videoCount} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ═══ 卡片 2：🎙️ AI 配音 ═══ */}
                                    {voiceConfig && onVoiceChange && (
                                        <div className="border border-white/10 rounded-xl overflow-hidden">
                                            <button
                                                onClick={() => setExpandedCards(s => ({ ...s, voice: !s.voice }))}
                                                className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
                                            >
                                                <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                                                    <Mic className="h-4 w-4" />
                                                    🎙️ AI 配音
                                                    {voiceConfig.enabled && (
                                                        <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/50">
                                                            {voiceConfig.voiceId === 'random' ? '随机' : voiceConfig.voiceName || '已开启'}
                                                        </span>
                                                    )}
                                                </div>
                                                <ChevronDown className={cn("h-4 w-4 text-white/40 transition-transform", expandedCards.voice && "rotate-180")} />
                                            </button>
                                            {expandedCards.voice && (
                                                <div className="px-3 pb-3 border-t border-white/5 space-y-3 pt-3">
                                                    {/* 三选一模式 */}
                                                    <div className="flex gap-2 p-1 bg-black/20 rounded-xl border border-white/5">
                                                        <button
                                                            onClick={() => onVoiceChange({ enabled: true, voiceId: 'random', voiceName: '随机' })}
                                                            className={cn(
                                                                "flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all",
                                                                voiceConfig.enabled && voiceConfig.voiceId === 'random'
                                                                    ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                                                                    : "text-white/40 hover:text-white hover:bg-white/5"
                                                            )}
                                                        >
                                                            🎲 随机
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                const defaultVoice = PRESET_VOICES[0];
                                                                onVoiceChange({ enabled: true, voiceId: defaultVoice.id, voiceName: defaultVoice.name });
                                                            }}
                                                            className={cn(
                                                                "flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all",
                                                                voiceConfig.enabled && voiceConfig.voiceId !== 'random'
                                                                    ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                                                                    : "text-white/40 hover:text-white hover:bg-white/5"
                                                            )}
                                                        >
                                                            指定配音
                                                        </button>
                                                        <button
                                                            onClick={() => onVoiceChange({ ...voiceConfig, enabled: false, voiceId: '', voiceName: '' })}
                                                            className={cn(
                                                                "flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all",
                                                                !voiceConfig.enabled
                                                                    ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                                                                    : "text-white/40 hover:text-white hover:bg-white/5"
                                                            )}
                                                        >
                                                            无
                                                        </button>
                                                    </div>

                                                    {/* 指定配音列表 */}
                                                    {voiceConfig.enabled && voiceConfig.voiceId !== 'random' && (
                                                        <div className="grid grid-cols-1 gap-1.5 max-h-32 overflow-y-auto">
                                                            {PRESET_VOICES.map((voice) => (
                                                                <button
                                                                    key={voice.id}
                                                                    onClick={() => onVoiceChange({ enabled: true, voiceId: voice.id, voiceName: voice.name })}
                                                                    className={cn(
                                                                        "flex items-center gap-2 p-2 rounded-lg text-left transition-all border",
                                                                        voiceConfig.voiceId === voice.id
                                                                            ? "bg-white/10 border-white/40 shadow-inner"
                                                                            : "bg-transparent border-transparent hover:bg-white/5"
                                                                    )}
                                                                >
                                                                    <span className={cn("text-xs", voice.gender === 'female' ? "text-pink-400" : "text-blue-400")}>
                                                                        {voice.gender === 'female' ? '♀' : '♂'}
                                                                    </span>
                                                                    <span className="text-xs text-white/80">{voice.name}</span>
                                                                    <span className="text-[10px] text-white/40">{voice.style}</span>
                                                                    {voiceConfig.voiceId === voice.id && (
                                                                        <Check className="h-3 w-3 text-white ml-auto" />
                                                                    )}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* 提示 */}
                                                    {voiceConfig.enabled && (
                                                        <div className="text-[10px] text-white/40 flex items-center gap-1">
                                                            <AlertCircle className="h-3 w-3" />
                                                            {voiceConfig.voiceId === 'random'
                                                                ? `将为 ${videoCount} 条视频随机分配不同配音`
                                                                : `将为所有视频使用 ${voiceConfig.voiceName} 配音`
                                                            }
                                                        </div>
                                                    )}

                                                    {/* AI 字幕生成（配音文案） */}
                                                    {aiCaptionConfig && onAiCaptionChange && (
                                                        <div className="space-y-3 p-3 bg-[#1a1a1a] border border-white/10 rounded-xl">
                                                            <div className="flex items-center justify-between">
                                                                <Label className="text-sm text-white/90 flex items-center gap-2 font-medium">
                                                                    <Wand2 className="h-4 w-4 text-white" />
                                                                    AI 字幕
                                                                </Label>
                                                                <button
                                                                    onClick={() => onAiCaptionChange({ ...aiCaptionConfig, enabled: !aiCaptionConfig.enabled })}
                                                                    className={cn(
                                                                        "relative w-10 h-5 rounded-full transition-all duration-300",
                                                                        aiCaptionConfig.enabled
                                                                            ? "bg-white/20 border border-white/30"
                                                                            : "bg-white/5 border border-white/10"
                                                                    )}
                                                                >
                                                                    <span className={cn(
                                                                        "absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 shadow",
                                                                        aiCaptionConfig.enabled
                                                                            ? "left-[22px] bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                                                                            : "left-0.5 bg-white/40"
                                                                    )} />
                                                                </button>
                                                            </div>
                                                            {aiCaptionConfig.enabled && (
                                                                <div className="space-y-3 pt-1">
                                                                    <input
                                                                        type="text"
                                                                        value={aiCaptionConfig.keywords}
                                                                        onChange={(e) => onAiCaptionChange({ ...aiCaptionConfig, keywords: e.target.value })}
                                                                        placeholder="输入主题/关键词..."
                                                                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
                                                                    />
                                                                    {/* 统一/多样模式切换 */}
                                                                    <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                                                                        <button
                                                                            onClick={() => onAiCaptionChange({ ...aiCaptionConfig, mode: 'unified' })}
                                                                            className={cn(
                                                                                "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                                                                aiCaptionConfig.mode === 'unified'
                                                                                    ? "bg-white/10 text-white shadow-sm border border-white/10"
                                                                                    : "text-white/40 hover:text-white/70"
                                                                            )}
                                                                        >
                                                                            📋 统一文案
                                                                        </button>
                                                                        <button
                                                                            onClick={() => onAiCaptionChange({ ...aiCaptionConfig, mode: 'diverse' })}
                                                                            className={cn(
                                                                                "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                                                                aiCaptionConfig.mode === 'diverse'
                                                                                    ? "bg-white/10 text-white shadow-sm border border-white/10"
                                                                                    : "text-white/40 hover:text-white/70"
                                                                            )}
                                                                        >
                                                                            🎭 多样文案
                                                                        </button>
                                                                    </div>
                                                                    {aiCaptionConfig.mode === 'diverse' && (
                                                                        <div className="text-[10px] text-white/40 bg-white/5 rounded-lg px-2 py-1.5">
                                                                            将为 {videoCount} 条视频分别生成不同内容的字幕文案
                                                                        </div>
                                                                    )}
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 flex-1">
                                                                            <button
                                                                                onClick={() => onAiCaptionChange({ ...aiCaptionConfig, language: 'en' })}
                                                                                className={cn(
                                                                                    "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                                                                    aiCaptionConfig.language === 'en'
                                                                                        ? "bg-white/10 text-white shadow-sm border border-white/10"
                                                                                        : "text-white/40 hover:text-white/70"
                                                                                )}
                                                                            >
                                                                                🌐 EN
                                                                            </button>
                                                                            <button
                                                                                onClick={() => onAiCaptionChange({ ...aiCaptionConfig, language: 'zh' })}
                                                                                className={cn(
                                                                                    "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                                                                    aiCaptionConfig.language === 'zh'
                                                                                        ? "bg-white/10 text-white shadow-sm border border-white/10"
                                                                                        : "text-white/40 hover:text-white/70"
                                                                                )}
                                                                            >
                                                                                CN 中文
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <Button
                                                                        onClick={generateAICaptions}
                                                                        disabled={isGenerating || !aiCaptionConfig.keywords?.trim()}
                                                                        className={cn(
                                                                            "w-full h-9 text-xs font-medium transition-all duration-300 rounded-xl",
                                                                            "bg-gradient-to-b from-white to-gray-200 text-black border-t border-white/60",
                                                                            "shadow-[0_0_15px_rgba(255,255,255,0.25)]",
                                                                            "hover:shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:scale-[1.01]",
                                                                            "active:scale-[0.98]",
                                                                            "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                                                                        )}
                                                                    >
                                                                        {isGenerating ? (
                                                                            <>
                                                                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin text-black" />
                                                                                生成中...
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <Sparkles className="h-3.5 w-3.5 mr-1.5 text-black fill-black/10" />
                                                                                ✨ AI 智能生成文案
                                                                            </>
                                                                        )}
                                                                    </Button>
                                                                    {/* 显示已生成的字幕文案 */}
                                                                    {aiCaptionConfig.generatedTexts && aiCaptionConfig.generatedTexts.length > 0 && (
                                                                        <div className="space-y-1.5 mt-2">
                                                                            <Label className="text-[10px] text-white/40">已生成 {aiCaptionConfig.generatedTexts.length} 条字幕：</Label>
                                                                            <div className="max-h-32 overflow-y-auto space-y-1">
                                                                                {aiCaptionConfig.generatedTexts.map((text: string, i: number) => (
                                                                                    <div key={i} className="text-xs text-white/60 bg-black/30 px-2 py-1.5 rounded-md">
                                                                                        <span className="text-white/30 mr-1">#{i + 1}</span> {text}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ═══ 卡片 3：🎨 字幕样式 ═══ */}
                                    <div className="border border-white/10 rounded-xl overflow-hidden">
                                        <button
                                            onClick={() => setExpandedCards(s => ({ ...s, style: !s.style }))}
                                            className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
                                        >
                                            <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                                                🎨 字幕样式
                                            </div>
                                            <ChevronDown className={cn("h-4 w-4 text-white/40 transition-transform", expandedCards.style && "rotate-180")} />
                                        </button>
                                        {expandedCards.style && (
                                            <div className="px-3 pb-3 border-t border-white/5 space-y-3 pt-3">
                                                {/* 风格 - 紧凑横排 */}
                                                <div className="flex gap-1.5">
                                                    {(Object.keys(STYLE_PRESETS) as SubtitleStyle[]).map((style) => {
                                                        const preset = STYLE_PRESETS[style];
                                                        const isSelected = subtitle.style === style;
                                                        return (
                                                            <button
                                                                key={style}
                                                                onClick={() => applyStyle(style)}
                                                                className={cn(
                                                                    "flex-1 py-2 px-1 rounded-lg text-center transition-all duration-200",
                                                                    isSelected
                                                                        ? "bg-white/15 border border-white/60 text-white"
                                                                        : "bg-white/5 border border-white/5 hover:bg-white/10 text-white/50"
                                                                )}
                                                            >
                                                                <div className="text-lg">{preset.icon}</div>
                                                                <div className="text-[10px] mt-0.5">{preset.label}</div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                {/* 色调 + 颜色 */}
                                                <div className="flex items-center gap-2">
                                                    {(Object.keys(TONE_COLORS) as SubtitleTone[]).map((tone) => {
                                                        const toneData = TONE_COLORS[tone];
                                                        const isSelected = subtitle.tone === tone;
                                                        return (
                                                            <button
                                                                key={tone}
                                                                onClick={() => applyTone(tone)}
                                                                className={cn(
                                                                    "py-1.5 px-3 rounded-lg text-xs transition-all",
                                                                    isSelected
                                                                        ? "bg-white/15 border border-white/40 text-white"
                                                                        : "bg-white/5 border border-transparent text-white/40 hover:text-white/70"
                                                                )}
                                                            >
                                                                {toneData.icon} {toneData.label}
                                                            </button>
                                                        );
                                                    })}
                                                    <div className="border-l border-white/10 h-6 mx-1" />
                                                    {TONE_COLORS[subtitle.tone]?.colors.map((colorOption) => (
                                                        <button
                                                            key={colorOption.value}
                                                            onClick={() => applyColor(colorOption.value)}
                                                            className={cn(
                                                                "w-7 h-7 rounded-full transition-all border-2",
                                                                subtitle.color === colorOption.value
                                                                    ? "border-white scale-110"
                                                                    : "border-transparent opacity-70 hover:opacity-100 hover:scale-105"
                                                            )}
                                                            style={{ backgroundColor: colorOption.value }}
                                                            title={colorOption.label}
                                                        />
                                                    ))}
                                                </div>
                                                {/* 效果预览 */}
                                                <div className="p-2 bg-black/30 rounded-lg">
                                                    <div
                                                        className="text-center py-1.5"
                                                        style={{
                                                            ...getTextStyle(),
                                                            fontSize: '18px',
                                                        }}
                                                    >
                                                        {subtitle.text || '字幕效果预览'}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* ═══ 卡片 4：📝 图文叠加 ═══ */}
                                    <div className="border border-white/10 rounded-xl overflow-hidden">
                                        <button
                                            onClick={() => setExpandedCards(s => ({ ...s, overlay: !s.overlay }))}
                                            className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
                                        >
                                            <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                                                📝 图文叠加
                                                {(subtitle.textOverlays?.length ?? 0) > 0 && (
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/50">
                                                        {subtitle.textOverlays?.length} 条
                                                    </span>
                                                )}
                                            </div>
                                            <ChevronDown className={cn("h-4 w-4 text-white/40 transition-transform", expandedCards.overlay && "rotate-180")} />
                                        </button>
                                        {expandedCards.overlay && (
                                            <div className="px-3 pb-3 border-t border-white/5 space-y-3 pt-3">
                                                {/* AI 文案生成 */}
                                                <div className="p-3 bg-[#1a1a1a] border border-white/10 rounded-xl space-y-3 relative overflow-hidden">
                                                    <div className="absolute inset-0 pointer-events-none rounded-xl border border-white/5" />
                                                    <Label className="text-sm text-white/80 flex items-center gap-2 relative z-10">
                                                        <Sparkles className="h-4 w-4" />
                                                        ✨ AI 文案生成
                                                    </Label>
                                                    <textarea
                                                        value={aiPrompt}
                                                        onChange={(e) => setAiPrompt(e.target.value)}
                                                        placeholder="请输入提示词，如：生成产品促销文案..."
                                                        className="w-full h-16 bg-[#101012] border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-white/20 resize-none focus:outline-none focus:border-white/30 transition-all shadow-inner relative z-10"
                                                    />
                                                    <div className="flex items-center gap-3 relative z-10">
                                                        {/* 文案策略 */}
                                                        <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 flex-1">
                                                            <button
                                                                onClick={() => setAiMode('uniform')}
                                                                className={cn(
                                                                    "flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-all",
                                                                    aiMode === 'uniform'
                                                                        ? "bg-white text-black shadow-sm"
                                                                        : "text-white/40 hover:text-white/70"
                                                                )}
                                                            >
                                                                统一文案
                                                            </button>
                                                            <button
                                                                onClick={() => setAiMode('diverse')}
                                                                className={cn(
                                                                    "flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-all",
                                                                    aiMode === 'diverse'
                                                                        ? "bg-white text-black shadow-sm"
                                                                        : "text-white/40 hover:text-white/70"
                                                                )}
                                                            >
                                                                多样文案
                                                            </button>
                                                        </div>
                                                        {/* 语言 */}
                                                        <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 flex-none w-28">
                                                            <button
                                                                onClick={() => setAiLanguage('en')}
                                                                className={cn(
                                                                    "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                                                    aiLanguage === 'en'
                                                                        ? "bg-white/10 text-white shadow-sm border border-white/10"
                                                                        : "text-white/40 hover:text-white/70"
                                                                )}
                                                            >
                                                                EN
                                                            </button>
                                                            <button
                                                                onClick={() => setAiLanguage('zh')}
                                                                className={cn(
                                                                    "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                                                    aiLanguage === 'zh'
                                                                        ? "bg-white/10 text-white shadow-sm border border-white/10"
                                                                        : "text-white/40 hover:text-white/70"
                                                                )}
                                                            >
                                                                中文
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        onClick={generateAITexts}
                                                        disabled={isGenerating || !aiPrompt.trim() || allImages.length === 0}
                                                        className={cn(
                                                            "w-full h-9 text-xs font-medium transition-all duration-300 rounded-xl relative z-10",
                                                            "bg-gradient-to-b from-white to-gray-200 text-black border-t border-white/60",
                                                            "shadow-[0_0_15px_rgba(255,255,255,0.25)]",
                                                            "hover:shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:scale-[1.01]",
                                                            "active:scale-[0.98]",
                                                            "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                                                        )}
                                                    >
                                                        {isGenerating ? (
                                                            <>
                                                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin text-black" />
                                                                生成中...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Sparkles className="h-3.5 w-3.5 mr-1.5 text-black fill-black/10" />
                                                                ✨ AI 生成文案
                                                            </>
                                                        )}
                                                    </Button>
                                                </div>

                                                {/* 按图片分组列表 */}
                                                <div className="space-y-2">
                                                    <Label className="text-sm text-white/60">📷 按图片分组</Label>
                                                    <div className="max-h-[250px] overflow-y-auto space-y-2 pr-1">
                                                        {allImages.length > 0 ? (
                                                            allImages.map((_, idx) => {
                                                                const overlays = imageOverlays.filter(o => o.imageIndex === idx);
                                                                return (
                                                                    <div key={idx} className="p-2.5 bg-white/5 rounded-lg border border-white/5 space-y-1.5">
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="text-xs text-white/60 flex items-center gap-1.5">
                                                                                📷 图片 {idx + 1}
                                                                            </span>
                                                                            <button
                                                                                onClick={() => addTextOverlay(idx)}
                                                                                className="text-[10px] text-white/40 hover:text-white px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
                                                                            >
                                                                                + 添加文本
                                                                            </button>
                                                                        </div>
                                                                        {overlays.length > 0 ? (
                                                                            overlays.map((overlay) => (
                                                                                <div
                                                                                    key={overlay.id}
                                                                                    className="flex items-center gap-2 p-2 bg-black/20 rounded-md group"
                                                                                >
                                                                                    <span className="flex-1 text-xs text-white/70 truncate">
                                                                                        {overlay.text || '(空文本)'}
                                                                                    </span>
                                                                                    <button
                                                                                        onClick={() => setEditingOverlay({ ...overlay })}
                                                                                        className="text-[10px] text-white/30 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                                                                                    >
                                                                                        编辑
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => deleteTextOverlay(overlay.id)}
                                                                                        className="text-[10px] text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                                                                                    >
                                                                                        删除
                                                                                    </button>
                                                                                </div>
                                                                            ))
                                                                        ) : (
                                                                            <div className="text-[10px] text-white/20 italic pl-1">
                                                                                暂无文本
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })
                                                        ) : (
                                                            <div className="text-xs text-white/30 text-center py-4">
                                                                请先上传图片
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                            </div>

                            {/* 弹窗底部 - 固定在弹窗底部 */}
                            <div className="p-4 border-t border-white/10 flex justify-end gap-3 bg-slate-900/95 backdrop-blur-sm flex-shrink-0">
                                <button
                                    onClick={closeModal}
                                    className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-xl transition-colors text-sm border border-white/5"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={closeModal}
                                    className={cn(
                                        "px-6 py-2 rounded-xl transition-all duration-300 text-sm font-medium",
                                        "bg-gradient-to-b from-white to-gray-200 text-black border-t border-white/60",
                                        "shadow-[0_0_20px_rgba(255,255,255,0.2)]",
                                        "hover:shadow-[0_0_25px_rgba(255,255,255,0.4)] hover:scale-[1.02]",
                                        "active:scale-[0.98]"
                                    )}
                                >
                                    确认应用
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* TextOverlay 编辑弹窗 */}
            {
                editingOverlay && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                        <div className="bg-slate-900 border border-white/10 rounded-2xl w-[500px] max-h-[80vh] overflow-hidden shadow-2xl">
                            {/* 弹窗头部 */}
                            <div className="flex items-center justify-between p-4 border-b border-white/10">
                                <h3 className="text-lg font-semibold text-white">📝 编辑文本</h3>
                                <button
                                    onClick={() => setEditingOverlay(null)}
                                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                                >
                                    <X className="h-5 w-5 text-white/60" />
                                </button>
                            </div>

                            {/* 弹窗内容 */}
                            <div className="p-6 space-y-4 overflow-y-auto">
                                {/* 文本编辑 */}
                                <div className="space-y-2">
                                    <Label className="text-sm text-white/60">文本内容</Label>
                                    <textarea
                                        value={editingOverlay.text}
                                        onChange={(e) => setEditingOverlay({ ...editingOverlay, text: e.target.value })}
                                        className="w-full h-24 bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white resize-none focus:outline-none focus:border-white/30"
                                        placeholder="输入文本..."
                                    />
                                </div>

                                {/* 位置调整 */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs text-white/40">X 位置: {editingOverlay.boxX}%</Label>
                                        <input
                                            type="range" min="0" max="100"
                                            value={editingOverlay.boxX}
                                            onChange={(e) => setEditingOverlay({ ...editingOverlay, boxX: Number(e.target.value) })}
                                            className="w-full h-2 rounded-full bg-white/10 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs text-white/40">Y 位置: {editingOverlay.boxY}%</Label>
                                        <input
                                            type="range" min="0" max="100"
                                            value={editingOverlay.boxY}
                                            onChange={(e) => setEditingOverlay({ ...editingOverlay, boxY: Number(e.target.value) })}
                                            className="w-full h-2 rounded-full bg-white/10 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                        />
                                    </div>
                                </div>

                                {/* 宽度 */}
                                <div className="space-y-2">
                                    <Label className="text-xs text-white/40">宽度: {editingOverlay.boxWidth}%</Label>
                                    <input
                                        type="range" min="20" max="100"
                                        value={editingOverlay.boxWidth}
                                        onChange={(e) => setEditingOverlay({ ...editingOverlay, boxWidth: Number(e.target.value) })}
                                        className="w-full h-2 rounded-full bg-white/10 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                    />
                                </div>

                                {/* 高度 */}
                                <div className="space-y-2">
                                    <Label className="text-xs text-white/40">
                                        高度: {editingOverlay.boxHeight ?? 'auto'}%
                                        <span className="text-white/20 ml-2">(仅预览参考)</span>
                                    </Label>
                                    <input
                                        type="range" min="5" max="50"
                                        value={editingOverlay.boxHeight ?? 15}
                                        onChange={(e) => setEditingOverlay({ ...editingOverlay, boxHeight: Number(e.target.value) })}
                                        className="w-full h-2 rounded-full bg-white/10 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                    />
                                </div>

                                {/* 🎨 字体样式区 */}
                                <div className="p-3 bg-white/5 rounded-lg space-y-3">
                                    <Label className="text-sm text-white/60">🎨 文本样式</Label>

                                    {/* 字体 + 字重 */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-white/40">字体</Label>
                                            <select
                                                value={editingOverlay.fontFamily || 'Microsoft YaHei'}
                                                onChange={(e) => setEditingOverlay({ ...editingOverlay, fontFamily: e.target.value })}
                                                className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-white/30"
                                            >
                                                <option value="Microsoft YaHei">微软雅黑</option>
                                                <option value="SimHei">黑体</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-white/40">字重</Label>
                                            <select
                                                value={editingOverlay.fontWeight || '400'}
                                                onChange={(e) => setEditingOverlay({ ...editingOverlay, fontWeight: e.target.value })}
                                                className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-white/30"
                                            >
                                                <option value="400">常规</option>
                                                <option value="700">粗体</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* 字号 */}
                                    <div className="space-y-1">
                                        <Label className="text-xs text-white/40">字号: {editingOverlay.fontSize ?? 14}px</Label>
                                        <input
                                            type="range" min="10" max="48"
                                            value={editingOverlay.fontSize ?? 14}
                                            onChange={(e) => setEditingOverlay({ ...editingOverlay, fontSize: Number(e.target.value) })}
                                            className="w-full h-2 rounded-full bg-white/10 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                        />
                                    </div>

                                    {/* 颜色 + 阴影 */}
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <Label className="text-xs text-white/40">颜色</Label>
                                            <input
                                                type="color"
                                                value={editingOverlay.color || '#FFFFFF'}
                                                onChange={(e) => setEditingOverlay({ ...editingOverlay, color: e.target.value })}
                                                className="w-8 h-6 rounded border border-white/20 cursor-pointer"
                                            />
                                            <span className="text-xs text-white/40">{editingOverlay.color || '#FFFFFF'}</span>
                                        </div>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={editingOverlay.shadow ?? true}
                                                onChange={(e) => setEditingOverlay({ ...editingOverlay, shadow: e.target.checked })}
                                                className="w-4 h-4 rounded accent-white"
                                            />
                                            <span className="text-xs text-white/40">阴影</span>
                                        </label>
                                    </div>

                                    {/* 描边 */}
                                    <div className="flex items-center gap-4">
                                        <div className="flex-1 space-y-1">
                                            <Label className="text-xs text-white/40">描边: {editingOverlay.borderWidth ?? 2}px</Label>
                                            <input
                                                type="range" min="0" max="5"
                                                value={editingOverlay.borderWidth ?? 2}
                                                onChange={(e) => setEditingOverlay({ ...editingOverlay, borderWidth: Number(e.target.value) })}
                                                className="w-full h-2 rounded-full bg-white/10 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Label className="text-xs text-white/40">描边色</Label>
                                            <input
                                                type="color"
                                                value={editingOverlay.borderColor || '#000000'}
                                                onChange={(e) => setEditingOverlay({ ...editingOverlay, borderColor: e.target.value })}
                                                className="w-8 h-6 rounded border border-white/20 cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 时间范围 (仅自由模式) */}
                                {editingOverlay.timingMode === 'custom' && (
                                    <div className="space-y-2 p-3 bg-white/5 rounded-lg">
                                        <Label className="text-xs text-white/40">时间范围: {editingOverlay.startPercent ?? 0}% - {editingOverlay.endPercent ?? 100}%</Label>
                                        <div className="flex gap-2">
                                            <input
                                                type="range" min="0" max="100"
                                                value={editingOverlay.startPercent ?? 0}
                                                onChange={(e) => setEditingOverlay({
                                                    ...editingOverlay,
                                                    startPercent: Math.min(Number(e.target.value), (editingOverlay.endPercent ?? 100) - 5)
                                                })}
                                                className="flex-1 h-2 rounded-full bg-white/10 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                            />
                                            <input
                                                type="range" min="0" max="100"
                                                value={editingOverlay.endPercent ?? 100}
                                                onChange={(e) => setEditingOverlay({
                                                    ...editingOverlay,
                                                    endPercent: Math.max(Number(e.target.value), (editingOverlay.startPercent ?? 0) + 5)
                                                })}
                                                className="flex-1 h-2 rounded-full bg-white/20 appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 弹窗底部 */}
                            <div className="flex items-center justify-between p-4 border-t border-white/10">
                                <button
                                    onClick={() => {
                                        deleteTextOverlay(editingOverlay.id);
                                        setEditingOverlay(null);
                                    }}
                                    className="px-4 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                >
                                    删除
                                </button>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setEditingOverlay(null)}
                                        className="px-4 py-2 text-white/60 hover:bg-white/10 rounded-lg transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={() => {
                                            updateTextOverlay(editingOverlay.id, editingOverlay);
                                            setEditingOverlay(null);
                                        }}
                                        className="px-4 py-2 bg-gradient-to-b from-white to-gray-200 text-black font-medium rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:shadow-[0_0_20px_rgba(255,255,255,0.5)] transition-all"
                                    >
                                        保存
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </>
    );
}

