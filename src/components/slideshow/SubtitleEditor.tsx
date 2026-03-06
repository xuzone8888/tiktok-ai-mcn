/**
 * 字幕可视化编辑器 - 弹窗版 v2
 * 修复：真正可拖拽 + 图片轮播预览
 */

'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Type, X, Move, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Mic, Play, Pause, Loader2, Wand2, Sparkles, Check, AlertCircle, Music, ChevronDown, Palette, FileText, MapPin, Shuffle, Film } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
// ⭐ 类型导入
import { type VoiceConfig, PRESET_VOICES } from './VoiceSelector';
import { type AICaptionConfig, type CaptionStyle } from './AICaptionGenerator';
import { BGMSelector, type BGMConfig } from './BGMSelector';
import { TransitionPicker, type TransitionEffect, TRANSITIONS } from './TransitionPicker';

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
    // 🎬 新增：字幕动画
    animation?: 'none' | 'fade' | 'pop' | 'slide-up' | 'slide-left' | 'glow';
    // AI 图文文本配置
    overlayAiConfig?: {
        prompt: string;
        language: 'en' | 'zh';
        mode: 'uniform' | 'diverse';
    };
    // 图文位置模式：fixed=保持预览位置, random=批量时随机
    overlayPositionMode?: 'fixed' | 'random';
    // 内部字段：实际预览区高度（Python 字号缩放用）
    _previewHeight?: number;
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
    videoDurationSeconds?: number; // Fix 4A: 视频预估时长，用于匹配文案长度
    // 背景音乐（从全局配置移入）
    bgmConfig?: BGMConfig;
    onBgmChange?: (config: BGMConfig) => void;
    // 转场效果
    transition?: TransitionEffect;
    onTransitionChange?: (transition: TransitionEffect) => void;
    // 布局数据传递
    activeMode?: 'random' | 'position';
    totalImageCount?: number;
    sceneCount?: number;
}

// 🎬 字体 ID → CSS font-family 名称 + 文件路径映射
const FONT_CSS_MAP: Record<string, { cssName: string; file?: string }> = {
    'NotoSansSC': { cssName: 'Noto Sans SC', file: '/fonts/NotoSansSC/NotoSansSC-Variable.ttf' },
    'ZCOOLKuaiLe': { cssName: 'ZCOOL KuaiLe', file: '/fonts/ZCOOLKuaiLe/ZCOOLKuaiLe-Regular.ttf' },
    'Montserrat': { cssName: 'Montserrat', file: '/fonts/Montserrat/Montserrat-Bold.ttf' },
    'BebasNeue': { cssName: 'Bebas Neue', file: '/fonts/BebasNeue/BebasNeue-Regular.ttf' },
    'Pacifico': { cssName: 'Pacifico', file: '/fonts/Pacifico/Pacifico-Regular.ttf' },
    'Cinzel': { cssName: 'Cinzel', file: '/fonts/Cinzel/Cinzel-VariableFont_wght.ttf' },
    'EBGaramond': { cssName: 'EB Garamond', file: '/fonts/EB_Garamond/EBGaramond-VariableFont_wght.ttf' },
    'MicrosoftYaHei': { cssName: 'Microsoft YaHei' },  // 系统字体，无需加载
};

// 风格预设配置（不包含字体，字体由独立选择器控制）
const STYLE_PRESETS: Record<SubtitleStyle, {
    label: string;
    icon: string;
    fontSize: number;
    borderWidth: number;
    borderColor: string;
    shadow: boolean;
    fontWeight: string;
}> = {
    classic: {
        label: '经典',
        icon: '🖥️',
        fontSize: 24,
        borderWidth: 4,
        borderColor: '#000000',
        shadow: true,
        fontWeight: '700',
    },
    trending: {
        label: '潮流',
        icon: '🔥',
        fontSize: 24,
        borderWidth: 3,
        borderColor: '#000000',
        shadow: true,
        fontWeight: '700',
    },
    cinema: {
        label: '影视',
        icon: '🎬',
        fontSize: 24,
        borderWidth: 1,
        borderColor: '#000000',
        shadow: true,
        fontWeight: '400',
    },
    neon: {
        label: '霓虹',
        icon: '💜',
        fontSize: 24,
        borderWidth: 0,
        borderColor: 'transparent',
        shadow: true,
        fontWeight: '600',
    },
    minimal: {
        label: '简约',
        icon: '✏️',
        fontSize: 24,
        borderWidth: 0,
        borderColor: 'transparent',
        shadow: true,
        fontWeight: '400',
    },
};

// 色调配色
const TONE_COLORS: Record<SubtitleTone, { label: string; icon: string; colors: { value: string; label: string }[] }> = {
    neutral: {
        label: '中性',
        icon: '⚪',
        colors: [
            { value: '#FFFFFF', label: '白色' },
            { value: '#E0E0E0', label: '灰色' },
            { value: '#FFFACD', label: '米色' },
        ],
    },
    warm: {
        label: '暖调',
        icon: '🌅',
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
    boxX: 4,
    boxY: 75,
    boxWidth: 92,
    style: 'classic',
    tone: 'neutral',
    color: '#FFFFFF',
    position: 75,
    fontSize: 24,
    fontColor: '#FFFFFF',
    fontFamily: 'Microsoft YaHei',
    fontWeight: '700',
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
    videoDurationSeconds,
    bgmConfig,
    onBgmChange,
    transition = 'fade',
    onTransitionChange,
    activeMode,
    totalImageCount,
    sceneCount,
}: SubtitleEditorProps) {
    const enabled = subtitle !== null;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const previewRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [fontScale, setFontScale] = useState(1);
    // 卡片折叠状态
    const [activeTab, setActiveTab] = useState<'aiText' | 'style' | 'sticker' | 'voice' | 'bgm'>('aiText');

    // FFmpeg 真实预览
    const [ffmpegPreviewUrl, setFfmpegPreviewUrl] = useState<string | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const previewAbortRef = useRef<AbortController | null>(null);

    // AI 生成相关状态
    const [aiPrompt, setAiPrompt] = useState('');           // 图文描述
    const [captionPrompt, setCaptionPrompt] = useState(''); // 配音描述
    const [aiMode, setAiMode] = useState<'uniform' | 'diverse'>('diverse');
    const [aiLanguage, setAiLanguage] = useState<'en' | 'zh'>('en');
    const [isGenerating, setIsGenerating] = useState(false);

    // 弹窗打开时恢复 overlay AI 配置（防止 useState 初始值丢失）
    React.useEffect(() => {
        if (isModalOpen && subtitle?.overlayAiConfig) {
            if (subtitle.overlayAiConfig.prompt) setAiPrompt(subtitle.overlayAiConfig.prompt);
            if (subtitle.overlayAiConfig.language) setAiLanguage(subtitle.overlayAiConfig.language);
            if (subtitle.overlayAiConfig.mode) setAiMode(subtitle.overlayAiConfig.mode);
        }
    }, [isModalOpen]);

    // 样式面板 Tab 切换
    const [styleEditTarget, setStyleEditTarget] = useState<'subtitle' | 'overlay'>('subtitle');
    const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
    // 获取当前选中的 overlay 对象
    const selectedOverlay = subtitle?.textOverlays?.find(o => o.id === selectedOverlayId) || null;

    // 🎬 动态加载自定义字体
    const loadedFontsRef = React.useRef<Set<string>>(new Set());
    React.useEffect(() => {
        if (!subtitle?.fontFamily) return;
        const fontId = subtitle.fontFamily;
        const fontInfo = FONT_CSS_MAP[fontId];
        if (!fontInfo?.file || loadedFontsRef.current.has(fontId)) return;

        // 动态创建 @font-face 规则
        const style = document.createElement('style');
        style.textContent = `
            @font-face {
                font-family: '${fontInfo.cssName}';
                src: url('${fontInfo.file}') format('truetype');
                font-display: swap;
            }
        `;
        document.head.appendChild(style);
        loadedFontsRef.current.add(fontId);
        console.log(`[Font] Loaded @font-face: ${fontInfo.cssName} from ${fontInfo.file}`);
    }, [subtitle?.fontFamily]);

    // ⭐ overlay 字体动态加载 — 切换 overlay fontFamily 时加载 @font-face
    React.useEffect(() => {
        const overlays = subtitle?.textOverlays || [];
        overlays.forEach(overlay => {
            const fontId = overlay.fontFamily;
            if (!fontId) return;
            const fontInfo = FONT_CSS_MAP[fontId];
            if (!fontInfo?.file || loadedFontsRef.current.has(fontId)) return;

            const style = document.createElement('style');
            style.textContent = `
                @font-face {
                    font-family: '${fontInfo.cssName}';
                    src: url('${fontInfo.file}') format('truetype');
                    font-display: swap;
                }
            `;
            document.head.appendChild(style);
            loadedFontsRef.current.add(fontId);
            console.log(`[Font] Loaded overlay @font-face: ${fontInfo.cssName} from ${fontInfo.file}`);
        });
    }, [subtitle?.textOverlays?.map(o => o.fontFamily).join(',')]);

    // 🎬 FFmpeg 真实预览 — 智能分类触发
    // 位置拖拽：仅 mouseUp 时刷新（避免每像素触发）
    // 样式属性：1s debounce 自动刷新
    const subtitleRef = useRef(subtitle);
    subtitleRef.current = subtitle;

    // ref 保存当前图片索引，避免 refreshPreview 依赖 currentImageIndex 导致 debounce 重触发
    const imageIndexRef = useRef(currentImageIndex);
    imageIndexRef.current = currentImageIndex;

    const refreshPreview = React.useCallback(async () => {
        if (!subtitleRef.current || !isModalOpen) return;

        const imageUrl = previewImages?.[imageIndexRef.current] || previewImages?.[0] || previewImage || '';
        const hasFile = previewFiles?.length > 0;
        const fileIndex = Math.min(imageIndexRef.current, (previewFiles?.length || 1) - 1);
        const hasUrl = imageUrl && !imageUrl.startsWith('blob:');
        if (!hasFile && !hasUrl) return;

        // 中断上一次渲染，立即开始新渲染（更快响应）
        previewAbortRef.current?.abort();
        const controller = new AbortController();
        previewAbortRef.current = controller;

        setIsLoadingPreview(true);
        try {
            let res: Response;
            const currentSubtitle = subtitleRef.current;

            if (hasFile) {
                const formData = new FormData();
                formData.append('imageFile', previewFiles[fileIndex]);
                formData.append('subtitle', JSON.stringify(currentSubtitle));
                formData.append('aspectRatio', aspectRatio);
                res = await fetch('/api/subtitle-preview', {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal,
                });
            } else {
                res = await fetch('/api/subtitle-preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imagePath: imageUrl, subtitle: currentSubtitle, aspectRatio }),
                    signal: controller.signal,
                });
            }

            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                setFfmpegPreviewUrl(prev => {
                    if (prev) URL.revokeObjectURL(prev);
                    return url;
                });
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                console.log('[Preview] Generation failed:', e.message);
            }
        } finally {
            setIsLoadingPreview(false);
        }
    }, [isModalOpen, previewImages, previewImage, previewFiles, aspectRatio]);

    // 样式属性变化 → 1s debounce 自动刷新（不含位置属性）
    React.useEffect(() => {
        if (!subtitle || !isModalOpen) return;

        const imageUrl = previewImages?.[imageIndexRef.current] || previewImages?.[0] || previewImage || '';
        const hasFile = previewFiles?.length > 0;
        const hasUrl = imageUrl && !imageUrl.startsWith('blob:');
        if (!hasFile && !hasUrl) return;

        const timer = setTimeout(() => {
            refreshPreview();
        }, 1000);

        return () => clearTimeout(timer);
    }, [
        subtitle?.style, subtitle?.color, subtitle?.fontFamily,
        subtitle?.fontSize, subtitle?.fontColor, subtitle?.borderWidth,
        subtitle?.borderColor, subtitle?.shadow, subtitle?.animation,
        subtitle?.text, subtitle?.fontWeight,
        previewImages, previewImage, previewFiles, aspectRatio, isModalOpen,
        refreshPreview,
    ]);

    // 清理 FFmpeg 预览 URL
    React.useEffect(() => {
        return () => {
            if (ffmpegPreviewUrl) URL.revokeObjectURL(ffmpegPreviewUrl);
            previewAbortRef.current?.abort();
        };
    }, []);


    // (editingOverlay 已移除 — 改用 Tab 面板编辑)

    // TextOverlay 拖拽状态
    const [draggingOverlayId, setDraggingOverlayId] = useState<string | null>(null);

    // ⭐ TextOverlay Resize 状态
    const [resizingOverlay, setResizingOverlay] = useState<{
        id: string;
        handle: 'nw' | 'ne' | 'sw' | 'se' | 'e' | 's';
        startMouseX: number;
        startMouseY: number;
        startBoxX: number;
        startBoxY: number;
        startWidth: number;
        startHeight: number;
        startFontSize: number;
    } | null>(null);



    // ⭐ 新增：图文字幕位置/样式模式
    const [overlayPositionMode, setOverlayPositionMode] = useState<'fixed' | 'random'>(subtitle?.overlayPositionMode || 'fixed');
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
        // ⭐ 保存实际预览区高度 + overlay AI 配置
        if (subtitle && previewRef.current) {
            const h = previewRef.current.clientHeight;
            if (h > 0) {
                onChange({
                    ...subtitle,
                    _previewHeight: h,
                    // 保存 overlay AI 配置，供批量生成时独立生成文案
                    overlayAiConfig: aiPrompt.trim() ? {
                        prompt: aiPrompt,
                        language: aiLanguage,
                        mode: aiMode,
                    } : subtitle.overlayAiConfig, // 保留已有配置
                    // ⭐ 保存图文位置模式
                    overlayPositionMode,
                });
            }
        }
        setIsModalOpen(false);
    };

    // 应用风格预设（支持 Tab 模式：字幕 or overlay）
    const applyStyle = (style: SubtitleStyle) => {
        if (!subtitle) return;
        const preset = STYLE_PRESETS[style];
        if (styleEditTarget === 'overlay' && selectedOverlayId) {
            updateTextOverlay(selectedOverlayId, {
                style,
                fontSize: preset.fontSize,
                borderWidth: preset.borderWidth,
                borderColor: preset.borderColor,
                shadow: preset.shadow,
                fontWeight: preset.fontWeight,
                styleMode: 'custom',  // ⭐ 手动修改后切换为 custom，防止 Python inherit 覆盖
            });
        } else {
            onChange({
                ...subtitle,
                style,
                fontSize: preset.fontSize,
                borderWidth: preset.borderWidth,
                borderColor: preset.borderColor,
                shadow: preset.shadow,
                fontWeight: preset.fontWeight,
            });
        }
    };

    // 应用色调（支持 Tab 模式）
    const applyTone = (tone: SubtitleTone) => {
        if (!subtitle) return;
        const firstColor = TONE_COLORS[tone].colors[0].value;
        if (styleEditTarget === 'overlay' && selectedOverlayId) {
            updateTextOverlay(selectedOverlayId, {
                tone,
                color: firstColor,
                styleMode: 'custom',
            });
        } else {
            onChange({
                ...subtitle,
                tone,
                color: firstColor,
                fontColor: firstColor,
            });
        }
    };

    // 应用颜色（支持 Tab 模式）
    const applyColor = (color: string) => {
        if (!subtitle) return;
        if (styleEditTarget === 'overlay' && selectedOverlayId) {
            updateTextOverlay(selectedOverlayId, { color, styleMode: 'custom' });
        } else {
            onChange({
                ...subtitle,
                color,
                fontColor: color,
            });
        }
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
                tone: 'warm',
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
            // 样式（继承 subtitle）
            ...styleProps,
            fontSize: subtitle?.fontSize || 24,
            fontFamily: subtitle?.fontFamily || 'NotoSansSC',
            fontWeight: subtitle?.fontWeight || '700',
            borderWidth: subtitle?.borderWidth ?? 2,
            borderColor: styleProps.borderColor || subtitle?.borderColor || '#000000',
            shadow: subtitle?.shadow ?? true,
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
        // 如果删除的是当前选中的，清空选中
        if (selectedOverlayId === overlayId) setSelectedOverlayId(null);
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

    // 添加自由模式 TextOverlay（继承 subtitle 样式）
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
            style: subtitle.style || 'classic',
            tone: subtitle.tone || 'warm',
            color: subtitle.color || '#FFFFFF',
            fontSize: subtitle.fontSize || 24,
            fontFamily: subtitle.fontFamily || 'NotoSansSC',
            fontWeight: subtitle.fontWeight || '700',
            borderWidth: subtitle.borderWidth ?? 2,
            borderColor: subtitle.borderColor || '#000000',
            shadow: subtitle.shadow ?? true,
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

    // ═══ Resize Handle 交互 ═══
    const handleResizeMouseDown = (e: React.MouseEvent, overlay: TextOverlay, handle: 'nw' | 'ne' | 'sw' | 'se' | 'e' | 's') => {
        e.preventDefault();
        e.stopPropagation();
        setResizingOverlay({
            id: overlay.id,
            handle,
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startBoxX: overlay.boxX,
            startBoxY: overlay.boxY,
            startWidth: overlay.boxWidth,
            startHeight: overlay.boxHeight || 15, // 默认高度 15%
            startFontSize: overlay.fontSize || 24,
        });
        // 同时选中该 overlay
        setSelectedOverlayId(overlay.id);
    };

    const handleResizeMouseMove = React.useCallback((e: MouseEvent) => {
        if (!resizingOverlay || !previewRef.current) return;

        const rect = previewRef.current.getBoundingClientRect();
        const { id, handle, startMouseX, startMouseY, startBoxX, startBoxY, startWidth, startHeight, startFontSize } = resizingOverlay;

        // 鼠标偏移 → 百分比偏移
        const deltaXPercent = ((e.clientX - startMouseX) / rect.width) * 100;
        const deltaYPercent = ((e.clientY - startMouseY) / rect.height) * 100;

        const MIN_SIZE = 10;  // 最小宽高百分比
        const MIN_FONT = 10;  // 预览区最小字号
        const MAX_FONT = 60;  // 预览区最大字号

        let newBoxX = startBoxX;
        let newBoxY = startBoxY;
        let newWidth = startWidth;
        let newHeight = startHeight;
        let newFontSize = startFontSize;

        if (handle === 'e') {
            // 右边: 只改宽度
            newWidth = Math.max(MIN_SIZE, Math.min(100 - startBoxX, startWidth + deltaXPercent));
        } else if (handle === 's') {
            // 下边: 改高度 + fontSize 按比例
            newHeight = Math.max(MIN_SIZE, startHeight + deltaYPercent);
            const heightRatio = newHeight / startHeight;
            newFontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(startFontSize * heightRatio)));
        } else {
            // 角 handle: 等比缩放
            let dw = deltaXPercent;
            let dh = deltaYPercent;

            if (handle === 'nw') {
                dw = -deltaXPercent;
                dh = -deltaYPercent;
                newBoxX = Math.max(0, startBoxX + deltaXPercent);
                newBoxY = Math.max(0, startBoxY + deltaYPercent);
            } else if (handle === 'ne') {
                dh = -deltaYPercent;
                newBoxY = Math.max(0, startBoxY + deltaYPercent);
            } else if (handle === 'sw') {
                dw = -deltaXPercent;
                newBoxX = Math.max(0, startBoxX + deltaXPercent);
            }
            // se: dw=delta, dh=delta (自然方向)

            newWidth = Math.max(MIN_SIZE, startWidth + dw);
            newHeight = Math.max(MIN_SIZE, startHeight + dh);

            // fontSize 按面积根号缩放
            const areaRatio = (newWidth * newHeight) / (startWidth * startHeight);
            newFontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(startFontSize * Math.sqrt(areaRatio))));
        }

        // 边界 clamp
        newBoxX = Math.max(0, Math.min(90, newBoxX));
        newBoxY = Math.max(0, Math.min(90, newBoxY));
        newWidth = Math.min(100 - newBoxX, newWidth);
        newHeight = Math.min(100 - newBoxY, newHeight);

        updateTextOverlayRef.current(id, {
            boxX: Math.round(newBoxX),
            boxY: Math.round(newBoxY),
            boxWidth: Math.round(newWidth),
            boxHeight: Math.round(newHeight),
            fontSize: newFontSize,
        });
    }, [resizingOverlay]);

    const handleResizeMouseUp = React.useCallback(() => {
        setResizingOverlay(null);
    }, []);

    // 监听全局鼠标事件用于 resize
    React.useEffect(() => {
        if (resizingOverlay) {
            window.addEventListener('mousemove', handleResizeMouseMove);
            window.addEventListener('mouseup', handleResizeMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleResizeMouseMove);
                window.removeEventListener('mouseup', handleResizeMouseUp);
            };
        }
    }, [resizingOverlay, handleResizeMouseMove, handleResizeMouseUp]);

    // ═══ 一键 AI 生成（配音字幕 + 图文文案 并行）═══
    const generateAllAI = async () => {
        if (!subtitle) return;
        const hasCaptions = captionPrompt.trim();
        const hasOverlays = aiPrompt.trim() && allImages.length > 0;
        if (!hasCaptions && !hasOverlays) {
            alert('请至少填写一个描述');
            return;
        }

        setIsGenerating(true);
        try {
            const promises: Promise<{ type: string; status: string; data?: any; error?: any }>[] = [];

            // 配音字幕生成
            if (hasCaptions) {
                promises.push(
                    fetch('/api/ai/captions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            keywords: captionPrompt,
                            count: aiMode === 'uniform' ? 1 : videoCount,
                            mode: aiMode === 'uniform' ? 'unified' : 'diverse',
                            language: aiLanguage,
                            videoDurationSeconds: videoDurationSeconds || 8, // Fix 4A
                        }),
                    })
                        .then(r => r.json())
                        .then(data => ({ type: 'caption', status: 'ok', data }))
                        .catch(err => ({ type: 'caption', status: 'error', error: err.message }))
                );
            }

            // 图文文案生成
            if (hasOverlays) {
                promises.push(
                    fetch('/api/ai/generate-text-overlays', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt: aiPrompt,
                            mode: aiMode, // 图文 API 用 uniform/diverse
                            count: aiMode === 'uniform' ? 1 : allImages.length,
                            imageDescriptions: [],
                            language: aiLanguage,
                        }),
                    })
                        .then(r => r.json())
                        .then(data => ({ type: 'overlay', status: 'ok', data }))
                        .catch(err => ({ type: 'overlay', status: 'error', error: err.message }))
                );
            }

            const results = await Promise.all(promises);
            let updatedSubtitle = { ...subtitle };
            const errors: string[] = [];

            for (const result of results) {
                if (result.status === 'error') {
                    errors.push(`${result.type === 'caption' ? '配音字幕' : '图文文案'}生成失败: ${result.error}`);
                    continue;
                }

                if (result.type === 'caption') {
                    const captions: string[] = result.data?.captions || [];
                    if (captions.length > 0) {
                        updatedSubtitle.text = captions[0];
                    }
                    // 同步到 aiCaptionConfig
                    if (onAiCaptionChange && aiCaptionConfig) {
                        onAiCaptionChange({
                            ...aiCaptionConfig,
                            enabled: true,
                            keywords: captionPrompt,
                            mode: aiMode === 'uniform' ? 'unified' : 'diverse',
                            language: aiLanguage,
                            generatedTexts: captions,
                        });
                    }
                }

                if (result.type === 'overlay') {
                    const texts: string[] = result.data?.texts || [];
                    if (result.data?.success && texts.length > 0) {
                        // 创建 TextOverlay，继承 subtitle 样式
                        updatedSubtitle.textOverlays = texts.map(
                            (text: string, idx: number) => createTextOverlay(idx, text)
                        );
                    } else if (!result.data?.success) {
                        errors.push(`图文文案: ${result.data?.error || '生成失败'}`);
                    }
                }
            }

            onChange(updatedSubtitle);

            if (errors.length > 0) {
                alert(`部分生成失败:\n${errors.join('\n')}`);
            }
        } catch (error: any) {
            console.error('[AI Generate Error]:', error);
            alert(error.message || 'AI 生成失败，请重试');
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

            // 限制在 15% - 95% 范围内
            const clampedY = Math.max(15, Math.min(95, percentY));

            onChange({
                ...subtitle,
                boxY: Math.round(clampedY),
                position: Math.round(clampedY),
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            // 拖拽结束后一次性刷新 FFmpeg 预览（避免拖拽过程中每像素触发）
            refreshPreview();
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
                fontSize: Math.min(48, (subtitle.fontSize || 24) + 2),  // 步长 +2，最大48
            });
        }
    };

    const handleZoomOut = () => {
        setFontScale(prev => Math.max(0.5, prev - 0.1));
        if (subtitle) {
            onChange({
                ...subtitle,
                fontSize: Math.max(8, (subtitle.fontSize || 24) - 2),  // 步长 -2，最小 8px
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
            fontFamily: FONT_CSS_MAP[subtitle.fontFamily || '']?.cssName || subtitle.fontFamily || 'Noto Sans SC, sans-serif',
            fontWeight: preset.fontWeight,
            letterSpacing: '0.05em',
        };

        // 每种样式的 CSS 预览效果（匹配 FFmpeg ASS 渲染）
        switch (subtitle.style) {
            case 'classic':
                // 📺 经典: 粗黑描边 + 深阴影（立体浮雕感）
                baseStyle.textShadow = '3px 3px 6px rgba(0,0,0,0.9), -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 0 2px #000';
                baseStyle.WebkitTextStroke = '1px rgba(0,0,0,0.8)';
                break;
            case 'trending':
                // 🔥 潮流: 半透明方框背景
                baseStyle.backgroundColor = 'rgba(0,0,0,0.35)';
                baseStyle.padding = '6px 14px';
                baseStyle.borderRadius = '6px';
                baseStyle.lineHeight = '1.6';
                break;
            case 'cinema':
                // 🎬 影视: 细黑描边 + 宽字间距
                baseStyle.letterSpacing = '0.15em';
                baseStyle.textShadow = '1px 1px 3px rgba(0,0,0,0.6), -1px -1px 0 rgba(0,0,0,0.5), 1px -1px 0 rgba(0,0,0,0.5), -1px 1px 0 rgba(0,0,0,0.5), 1px 1px 0 rgba(0,0,0,0.5)';
                break;
            case 'neon':
                // 💜 霓虹: 彩色发光
                baseStyle.textShadow = `0 0 10px ${subtitle.color}, 0 0 20px ${subtitle.color}, 0 0 30px ${subtitle.color}`;
                break;
            case 'minimal':
                // ✏️ 简约: 极淡阴影
                baseStyle.textShadow = '1px 1px 2px rgba(0,0,0,0.5)';
                break;
            default:
                baseStyle.textShadow = '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
        }

        return baseStyle;
    };



    return (
        <>
            {/* 主入口 */}
            {/* 主入口：流光数据复合按钮 */}
            <button
                onClick={() => {
                    if (!enabled) {
                        onChange(DEFAULT_CONFIG);
                    }
                    openModal();
                }}
                className="w-full relative group overflow-hidden bg-gradient-to-r from-mermaid-pink/10 to-mermaid-purple/10 border border-white/10 hover:border-mermaid-pink/50 rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(255,0,128,0.15)] flex items-center justify-between p-4"
            >
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors"></div>

                {/* 左侧：操作主题 */}
                <div className="flex items-center gap-3 relative z-10">
                    <div className="bg-white/10 p-2 rounded-lg shadow-inner">
                        <Type className="h-5 w-5 text-mermaid-pink drop-shadow-[0_0_5px_rgba(255,0,128,0.5)]" />
                    </div>
                    <span className="text-[14px] font-bold tracking-wide text-white/90 drop-shadow-sm group-hover:text-white transition-colors">配置视频增强</span>
                </div>

                {/* 右侧：预估数据 */}
                <div className="flex flex-col items-end justify-center relative z-10 text-right">
                    <div className="text-[14px] font-black leading-none flex items-baseline gap-1 drop-shadow-sm text-mermaid-cyan">
                        {/* 场景编排：显示分镜数，智能混剪：显示照片数 */}
                        {activeMode === 'position' && sceneCount !== undefined && sceneCount > 0 && (
                            <>
                                <span className="text-white/40 font-medium text-[11px]">分镜总计</span>
                                <span>{sceneCount}</span>
                                <span className="text-[10px] font-medium text-white/40">个</span>
                                <span className="text-white/20 mx-1">|</span>
                            </>
                        )}
                        {activeMode === 'random' && totalImageCount !== undefined && totalImageCount > 0 && (
                            <>
                                <span className="text-white/40 font-medium text-[11px]">图片总计</span>
                                <span>{totalImageCount}</span>
                                <span className="text-[10px] font-medium text-white/40">张</span>
                                <span className="text-white/20 mx-1">|</span>
                            </>
                        )}

                        {/* 视频数量 */}
                        <span className="text-white/40 font-medium text-[11px]">生成</span>
                        <span>{videoCount || 0}</span>
                        <span className="text-[10px] font-medium text-white/40">条</span>
                    </div>
                    <div className="text-[10px] text-white/50 mt-1.5 leading-none font-medium tracking-wider bg-black/40 px-1.5 py-0.5 rounded border border-white/5">
                        每条视频时间约 {videoDurationSeconds?.toFixed(1) || '0.0'}s
                    </div>
                </div>
            </button>

            {/* 弹窗 */}
            {
                isModalOpen && subtitle && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                        <div className="bg-[#0B0C10] border border-white/10 rounded-2xl w-[92vw] max-w-[1100px] h-[85vh] max-h-[850px] overflow-hidden shadow-2xl flex flex-col">
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
                            <div className="px-4 py-3 flex gap-6 flex-1 min-h-0 overflow-hidden">
                                {/* 左侧：预览区 */}
                                <div className="flex-shrink-0 w-[400px] flex flex-col gap-2">
                                    <div className="flex items-center">
                                        <Label className="text-sm text-white/60 flex items-center gap-2">
                                            <Move className="h-4 w-4" />
                                            预览区（拖拽字幕调整位置）
                                        </Label>
                                    </div>

                                    {/* 预览区容器 */}
                                    <div className="relative flex-1 min-h-0">
                                        <div
                                            ref={previewRef}
                                            className={cn(
                                                "relative bg-black rounded-xl overflow-hidden border-2 mx-auto h-full",
                                                isDragging ? "border-white" : "border-white/10",
                                                aspectRatio === '9:16'
                                                    ? 'aspect-[9/16]'
                                                    : 'aspect-video'
                                            )}
                                        >
                                            {/* 背景图片：优先显示 FFmpeg 真实预览（带字幕） */}
                                            {currentPreviewImage ? (
                                                <>
                                                    <img
                                                        src={ffmpegPreviewUrl || currentPreviewImage}
                                                        alt="预览"
                                                        className="absolute inset-0 w-full h-full object-cover"
                                                        draggable={false}
                                                    />
                                                    {/* 真实预览标签（静态，不闪烁） */}
                                                    {ffmpegPreviewUrl && (
                                                        <div className="absolute top-2 right-2 flex items-center gap-1 text-[9px] bg-green-500/80 text-white px-1.5 py-0.5 rounded">
                                                            {isLoadingPreview && (
                                                                <div className="w-2.5 h-2.5 border border-white/40 border-t-white rounded-full animate-spin" />
                                                            )}
                                                            真实预览
                                                        </div>
                                                    )}
                                                    {!ffmpegPreviewUrl && isLoadingPreview && (
                                                        <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">
                                                            <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                                            加载中...
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="absolute inset-0 bg-gradient-to-b from-slate-800 to-slate-900 flex items-center justify-center">
                                                    <span className="text-white/30 text-sm">上传图片后显示预览</span>
                                                </div>
                                            )}

                                            {/* 字幕拖拽层 — 悬停时高亮提示 */}
                                            {allImages.length > 0 && ffmpegPreviewUrl && (
                                                <div
                                                    className={cn(
                                                        "absolute left-0 right-0 cursor-ns-resize select-none transition-all rounded-lg",
                                                        isDragging
                                                            ? "bg-white/15 ring-2 ring-white/40"
                                                            : "hover:bg-white/8 hover:ring-1 hover:ring-white/20"
                                                    )}
                                                    style={{
                                                        top: `${Math.max(0, subtitle.boxY - 10)}%`,
                                                        height: '12%',
                                                    }}
                                                    onMouseDown={handleMouseDown}
                                                />
                                            )}

                                            {/* TextOverlay 可视化层 - Phase 2 */}
                                            {visibleOverlays.map((overlay) => (
                                                <div
                                                    key={overlay.id}
                                                    className={cn(
                                                        "absolute select-none",
                                                        "rounded-lg transition-all duration-75",
                                                        "border-2",
                                                        resizingOverlay?.id === overlay.id
                                                            ? "border-blue-400 shadow-[0_0_15px_rgba(96,165,250,0.5)] z-20"
                                                            : selectedOverlayId === overlay.id
                                                                ? "border-blue-400 shadow-[0_0_15px_rgba(96,165,250,0.5)] z-20"
                                                                : draggingOverlayId === overlay.id
                                                                    ? "border-white shadow-[0_0_15px_rgba(255,255,255,0.4)] z-20"
                                                                    : overlay.timingMode === 'custom'
                                                                        ? "border-white/40 hover:border-white/60 z-10"
                                                                        : "border-white/60 hover:border-white z-10"
                                                    )}
                                                    style={{
                                                        left: `${overlay.boxX}%`,
                                                        top: `${overlay.boxY}%`,
                                                        width: `${overlay.boxWidth}%`,
                                                        minHeight: overlay.boxHeight ? `${overlay.boxHeight}%` : 'auto',
                                                        cursor: resizingOverlay?.id === overlay.id ? 'default' : 'move',
                                                        opacity: selectedOverlayId && selectedOverlayId !== overlay.id ? 0.25 : 1,
                                                        transition: 'opacity 0.2s ease',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                    }}
                                                    onMouseDown={(e) => handleOverlayMouseDown(e, overlay.id)}
                                                    onDoubleClick={() => {
                                                        setSelectedOverlayId(overlay.id);
                                                        setStyleEditTarget('overlay');
                                                        setActiveTab('style');
                                                    }}
                                                >
                                                    {/* 文本内容 — 垂直居中，自适应高度 */}
                                                    <div
                                                        className="px-2 py-1 text-center w-full"
                                                        style={{
                                                            color: overlay.color || '#fff',
                                                            fontSize: `${overlay.fontSize || 24}px`,
                                                            fontFamily: FONT_CSS_MAP[overlay.fontFamily || '']?.cssName || overlay.fontFamily || 'Noto Sans SC, sans-serif',
                                                            fontWeight: overlay.fontWeight || '400',
                                                            textShadow: overlay.shadow ? '1px 1px 2px rgba(0,0,0,0.8)' : 'none',
                                                            wordBreak: 'break-word',
                                                            lineHeight: 1.3,
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

                                                    {/* ⭐ Resize Handles — 仅选中时显示 */}
                                                    {selectedOverlayId === overlay.id && (
                                                        <>
                                                            {/* 4 个角 handle */}
                                                            <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-blue-400 border border-white rounded-full cursor-nw-resize hover:bg-blue-300 transition-colors"
                                                                onMouseDown={(e) => handleResizeMouseDown(e, overlay, 'nw')} />
                                                            <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-blue-400 border border-white rounded-full cursor-ne-resize hover:bg-blue-300 transition-colors"
                                                                onMouseDown={(e) => handleResizeMouseDown(e, overlay, 'ne')} />
                                                            <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-blue-400 border border-white rounded-full cursor-sw-resize hover:bg-blue-300 transition-colors"
                                                                onMouseDown={(e) => handleResizeMouseDown(e, overlay, 'sw')} />
                                                            <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-blue-400 border border-white rounded-full cursor-se-resize hover:bg-blue-300 transition-colors"
                                                                onMouseDown={(e) => handleResizeMouseDown(e, overlay, 'se')} />
                                                            {/* 右边 handle */}
                                                            <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-2.5 h-5 bg-blue-400 border border-white rounded-full cursor-e-resize hover:bg-blue-300 transition-colors"
                                                                onMouseDown={(e) => handleResizeMouseDown(e, overlay, 'e')} />
                                                            {/* 下边 handle */}
                                                            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-2.5 bg-blue-400 border border-white rounded-full cursor-s-resize hover:bg-blue-300 transition-colors"
                                                                onMouseDown={(e) => handleResizeMouseDown(e, overlay, 's')} />
                                                        </>
                                                    )}
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

                                {/* 右侧：配置面板 - Tab 导航 */}
                                <div className="flex-1 min-h-0 flex flex-col">
                                    {/* Tab 内容区 — 填满 */}
                                    <div className="flex-1 min-h-0 overflow-y-auto pr-1">

                                        {/* ═══ Tab: ✨ AI 文案生成 ═══ */}
                                        {activeTab === 'aiText' && (
                                            <div className="h-full flex flex-col p-2 pt-1.5 gap-1.5">
                                                {/* ── 高级药丸控制栏 (Segmented Controls) ── */}
                                                <div className="flex items-center justify-between flex-shrink-0 mb-1 px-1">
                                                    {/* 模式切换 */}
                                                    <div className="flex bg-black/40 p-0.5 rounded-full border border-white/5 shadow-inner">
                                                        <button
                                                            onClick={() => setAiMode('uniform')}
                                                            className={cn(
                                                                "px-4 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200",
                                                                aiMode === 'uniform'
                                                                    ? "bg-white/10 text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                                                                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
                                                            )}
                                                        >
                                                            统一分发
                                                        </button>
                                                        <button
                                                            onClick={() => setAiMode('diverse')}
                                                            className={cn(
                                                                "px-4 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200",
                                                                aiMode === 'diverse'
                                                                    ? "bg-white/10 text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                                                                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
                                                            )}
                                                        >
                                                            多样混排
                                                        </button>
                                                    </div>

                                                    {/* 语言切换 */}
                                                    <div className="flex bg-black/40 p-0.5 rounded-full border border-white/5 shadow-inner">
                                                        <button
                                                            onClick={() => setAiLanguage('zh')}
                                                            className={cn(
                                                                "px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200",
                                                                aiLanguage === 'zh'
                                                                    ? "bg-white/10 text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                                                                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
                                                            )}
                                                        >
                                                            中文
                                                        </button>
                                                        <button
                                                            onClick={() => setAiLanguage('en')}
                                                            className={cn(
                                                                "px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200",
                                                                aiLanguage === 'en'
                                                                    ? "bg-white/10 text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                                                                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
                                                            )}
                                                        >
                                                            英文
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* ── 双栏内容区（外框） ── */}
                                                <div className="flex-1 min-h-0 border border-white/5 rounded-xl p-3.5 overflow-hidden bg-black/20 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] flex flex-col">
                                                    <div className="flex divide-x divide-white/5 flex-1 min-h-0">
                                                        {/* 左栏：配音字幕 */}
                                                        <div className="flex-1 min-w-0 flex flex-col gap-2 pr-4">
                                                            <Label className="text-[11px] text-white/50 flex-shrink-0 flex items-center gap-1.5 font-medium"><Mic className="h-3 w-3" /> 配音字幕需求</Label>
                                                            <textarea
                                                                value={captionPrompt}
                                                                onChange={(e) => setCaptionPrompt(e.target.value)}
                                                                placeholder="描述语气、受众和卖点，例如：'护肤品推广，语气活泼自然，重点强调保湿功效...'"
                                                                rows={3}
                                                                className="w-full bg-black/40 border border-white/5 rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-mermaid-cyan/30 focus:border-mermaid-cyan/30 resize-none flex-shrink-0 shadow-inner transition-all"
                                                            />
                                                            {/* 配音结果 */}
                                                            {aiCaptionConfig?.generatedTexts && aiCaptionConfig.generatedTexts.length > 0 && (
                                                                <div className="flex-1 min-h-0 flex flex-col gap-1.5 mt-1 border-t border-white/[0.02] pt-2">
                                                                    <Label className="text-[10px] text-white/40 flex-shrink-0 flex items-center justify-between">
                                                                        <span>配音生成结果</span>
                                                                        <span className="bg-white/10 px-1.5 py-0.5 rounded text-[9px]">{aiCaptionConfig.generatedTexts.length} 条</span>
                                                                    </Label>
                                                                    <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                                                        {aiCaptionConfig.generatedTexts.map((text: string, i: number) => (
                                                                            <div key={i} className="text-[11px] text-white/80 bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 px-3 py-2 rounded-lg transition-all border-l-[2px] border-l-mermaid-cyan/40 shadow-sm leading-relaxed">
                                                                                <span className="text-mermaid-cyan/60 mr-1.5 font-medium text-[10px]">#{i + 1}</span> {text}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* 右栏：图文文案 */}
                                                        <div className="flex-1 min-w-0 flex flex-col gap-2 pl-4">
                                                            <Label className="text-[11px] text-white/50 flex-shrink-0 flex items-center gap-1.5 font-medium"><FileText className="h-3 w-3" /> 图文排版需求</Label>
                                                            <textarea
                                                                value={aiPrompt}
                                                                onChange={(e) => setAiPrompt(e.target.value)}
                                                                placeholder="描述核心信息，例如：'每张图提取一个产品卖点，并加上关键的数据指标...'"
                                                                rows={3}
                                                                className="w-full bg-black/40 border border-white/5 rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-mermaid-cyan/30 focus:border-mermaid-cyan/30 resize-none flex-shrink-0 shadow-inner transition-all"
                                                            />
                                                            {/* 图文结果 */}
                                                            {(subtitle.textOverlays?.length ?? 0) > 0 && (() => {
                                                                // imagesPerGroup = 每条视频对应的图片数（= 每次生成消耗的数量）
                                                                const imagesPerGroup = videoCount > 1
                                                                    ? Math.ceil(allImages.length / videoCount)
                                                                    : (subtitle.textOverlays?.length ?? 0);
                                                                const firstVideoOverlays = subtitle.textOverlays?.slice(0, imagesPerGroup) ?? [];
                                                                const remainingCount = (subtitle.textOverlays?.length ?? 0) - firstVideoOverlays.length;
                                                                return (
                                                                    <div className="flex-1 min-h-0 flex flex-col gap-1.5 mt-1 border-t border-white/[0.02] pt-2">
                                                                        <Label className="text-[10px] text-white/40 flex-shrink-0 flex items-center justify-between">
                                                                            <span>第1条视频图文</span>
                                                                            <span className="bg-white/10 px-1.5 py-0.5 rounded text-[9px]">{firstVideoOverlays.length} 项 / 现有{subtitle.textOverlays?.length}条</span>
                                                                        </Label>
                                                                        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                                                            {firstVideoOverlays.map((o) => (
                                                                                <div key={o.id} className="text-[11px] text-white/80 bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 px-3 py-2 rounded-lg transition-all border-l-[2px] border-l-mermaid-cyan/40 shadow-sm leading-relaxed">
                                                                                    <span className="text-mermaid-cyan/60 mr-1.5 font-medium text-[10px]">图{(o.imageIndex ?? 0) + 1}</span> {o.text || '(空)'}
                                                                                </div>
                                                                            ))}
                                                                            {remainingCount > 0 && (
                                                                                <div className="text-[9px] text-white/25 text-center bg-white/[0.02] rounded-lg py-1.5 border border-white/5">
                                                                                    ⚙️ 剩余 {remainingCount} 条已自动分配给后续 {videoCount - 1} 条视频
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* ── 底部：提示 + 生成按钮 ── */}
                                                <div className="flex items-center justify-between gap-2 flex-shrink-0 pt-1 border-t border-white/5">
                                                    <span className="text-[9px] text-white/30 truncate">
                                                        {aiMode === 'diverse'
                                                            ? `多样: 配音×${videoCount} 图文×${allImages.length}`
                                                            : '统一模式: 所有视频共用文案'
                                                        }
                                                    </span>
                                                    <Button
                                                        onClick={generateAllAI}
                                                        disabled={isGenerating || (!captionPrompt.trim() && !aiPrompt.trim())}
                                                        className={cn(
                                                            "h-7 px-4 text-[11px] font-medium transition-all duration-300 rounded-lg flex-shrink-0",
                                                            "bg-gradient-to-r from-[#00F2EA] to-[#00D4CE] text-black",
                                                            "shadow-[0_0_10px_rgba(0,242,234,0.25)]",
                                                            "hover:shadow-[0_0_15px_rgba(0,242,234,0.4)]",
                                                            "active:scale-[0.97]",
                                                            "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                                                        )}
                                                    >
                                                        {isGenerating ? (
                                                            <>
                                                                <Loader2 className="h-3 w-3 mr-1 animate-spin text-black" />
                                                                生成中
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Sparkles className="h-3 w-3 mr-1 text-black" />
                                                                生成文案
                                                            </>
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        )}

                                        {/* ═══ Tab: 🎨 字幕样式 ═══ */}
                                        {activeTab === 'style' && (
                                            <div className="p-3 space-y-2">
                                                {/* Tab 切换: 配音字幕 / 图文文本 */}
                                                <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                                                    <button
                                                        onClick={() => { setStyleEditTarget('subtitle'); setSelectedOverlayId(null); }}
                                                        className={cn(
                                                            "flex-1 py-1.5 rounded text-xs font-medium transition-all",
                                                            styleEditTarget === 'subtitle'
                                                                ? "bg-gradient-to-r from-mermaid-pink/20 to-mermaid-pink/5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_0_20px_rgba(255,0,128,0.1)] border border-mermaid-pink/30"
                                                                : "text-white/40 hover:text-white/70 hover:bg-white/[0.02] border border-transparent"
                                                        )}
                                                    >
                                                        <Mic className="h-3 w-3 inline-block mr-1" />配音字幕
                                                    </button>
                                                    <button
                                                        onClick={() => setStyleEditTarget('overlay')}
                                                        className={cn(
                                                            "flex-1 py-1.5 rounded text-xs font-medium transition-all",
                                                            styleEditTarget === 'overlay'
                                                                ? "bg-gradient-to-r from-mermaid-cyan/20 to-mermaid-cyan/5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_0_20px_rgba(0,242,234,0.1)] border border-mermaid-cyan/30"
                                                                : "text-white/40 hover:text-white/70 hover:bg-white/[0.02] border border-transparent"
                                                        )}
                                                    >
                                                        <FileText className="h-3 w-3 inline-block mr-1" />图文文本 {(subtitle.textOverlays?.length ?? 0) > 0 && `(${subtitle.textOverlays?.length})`}
                                                    </button>
                                                </div>

                                                {/* 分割线 */}
                                                <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent my-4" />

                                                {/* 图文 Tab: overlay 列表 */}
                                                {styleEditTarget === 'overlay' && (
                                                    <div className="space-y-1.5">
                                                        <div className="flex items-center justify-between">
                                                            <Label className="text-[10px] text-white/40">选择要编辑的图文</Label>
                                                            <div className="flex items-center gap-2">
                                                                {/* ⭐ 位置模式切换 */}
                                                                <button
                                                                    onClick={() => setOverlayPositionMode(prev => prev === 'fixed' ? 'random' : 'fixed')}
                                                                    className={cn(
                                                                        "text-[10px] px-2 py-0.5 rounded transition-colors flex items-center gap-1",
                                                                        overlayPositionMode === 'random'
                                                                            ? "bg-white/10 text-white border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                                                                            : "bg-transparent text-white/40 hover:text-white/60 hover:bg-white/5 border border-transparent"
                                                                    )}
                                                                    title={overlayPositionMode === 'fixed' ? '当前：固定位置（所有视频使用预览中的位置）' : '当前：随机位置（每条视频自动随机位置）'}
                                                                >
                                                                    {overlayPositionMode === 'fixed' ? <><MapPin className="h-3 w-3" /> 固定位置</> : <><Shuffle className="h-3 w-3" /> 随机位置</>}
                                                                </button>
                                                                <button
                                                                    onClick={addCustomOverlay}
                                                                    className="text-[10px] text-white/40 hover:text-white px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
                                                                >
                                                                    + 添加
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="overflow-y-auto space-y-1" style={{ maxHeight: `${Math.max(Math.ceil((subtitle.textOverlays?.length ?? 0) / Math.max(videoCount, 1)), 2) * 2.5}rem` }}>
                                                            {(subtitle.textOverlays?.length ?? 0) > 0 ? (
                                                                subtitle.textOverlays?.map((overlay) => (
                                                                    <div
                                                                        key={overlay.id}
                                                                        onClick={() => {
                                                                            setSelectedOverlayId(overlay.id);
                                                                            // 同步切换预览图片到 overlay 绑定的图片
                                                                            if ((overlay.timingMode ?? 'image') === 'image' && overlay.imageIndex !== undefined) {
                                                                                setCurrentImageIndex(overlay.imageIndex);
                                                                                // 清除 FFmpeg 预览缓存，让新图片显示出来
                                                                                setFfmpegPreviewUrl(null);
                                                                            }
                                                                        }}
                                                                        className={cn(
                                                                            "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all group border",
                                                                            selectedOverlayId === overlay.id
                                                                                ? "bg-white/10 border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_20px_rgba(255,255,255,0.02)]"
                                                                                : "bg-white/[0.01] hover:bg-white/[0.04] border-transparent"
                                                                        )}
                                                                    >
                                                                        <span className="text-[11px] text-white/30 whitespace-nowrap">{(subtitle.textOverlays?.indexOf(overlay) ?? 0) < Math.ceil((subtitle.textOverlays?.length ?? 0) / Math.max(videoCount, 1)) ? '⭐' : ''}图{(overlay.imageIndex ?? 0) + 1} 文本 -</span>
                                                                        {selectedOverlayId === overlay.id ? (
                                                                            <input
                                                                                type="text"
                                                                                value={overlay.text}
                                                                                onChange={(e) => updateTextOverlay(overlay.id, { text: e.target.value })}
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                className="flex-1 bg-transparent text-xs text-white focus:outline-none min-w-0 placeholder:text-white/20"
                                                                                placeholder="输入文本..."
                                                                                autoFocus
                                                                            />
                                                                        ) : (
                                                                            <span className="flex-1 text-xs text-white/60 truncate select-none">
                                                                                {overlay.text || '(空文本)'}
                                                                            </span>
                                                                        )}
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); deleteTextOverlay(overlay.id); }}
                                                                            className="text-[10px] text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <div className="text-[10px] text-white/20 text-center py-3 italic">
                                                                    请先通过 AI 生成或手动添加图文
                                                                </div>
                                                            )}
                                                        </div>
                                                        {styleEditTarget === 'overlay' && (subtitle.textOverlays?.length ?? 0) > 0 && (
                                                            <div className="text-[10px] text-white/30 bg-white/[0.02] rounded px-2 py-1">
                                                                💡 配置 ⭐ 标记的 {Math.ceil((subtitle.textOverlays?.length ?? 0) / Math.max(videoCount, 1))} 条图文样式即可，批量视频将自动复用
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                <div className="flex flex-col gap-5 pt-2">
                                                    {/* ═══ 样式与颜色 ═══ */}
                                                    <div>
                                                        <div className="text-[10px] text-white/40 mb-1.5 flex items-center gap-1"><Palette className="h-3 w-3" /> 字幕样式 / 色调</div>
                                                        <div className="space-y-2">
                                                            {/* 风格 - 紧凑横排 */}
                                                            <div className="flex gap-1.5">
                                                                {(Object.keys(STYLE_PRESETS) as SubtitleStyle[]).map((style) => {
                                                                    const preset = STYLE_PRESETS[style];
                                                                    const isSelected = (styleEditTarget === 'overlay' && selectedOverlay) ? selectedOverlay.style === style : subtitle.style === style;
                                                                    return (
                                                                        <button
                                                                            key={style}
                                                                            onClick={() => applyStyle(style)}
                                                                            className={cn(
                                                                                "flex-1 py-1.5 px-2 rounded-lg text-center transition-all duration-200",
                                                                                isSelected
                                                                                    ? "bg-white/10 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_20px_rgba(255,255,255,0.02)] text-white font-medium"
                                                                                    : "bg-white/[0.02] border border-white/5 hover:bg-white/[0.06] hover:text-white/80 text-white/40"
                                                                            )}
                                                                        >
                                                                            <span className="text-sm mr-0.5">{preset.icon}</span>
                                                                            <span className="text-[11px]">{preset.label}</span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                            {/* 色调 + 颜色：50% / 50% 布局 */}
                                                            <div className="grid grid-cols-2 gap-3">
                                                                {/* 左半区：色调选择 */}
                                                                <div className="flex gap-1.5">
                                                                    {(Object.keys(TONE_COLORS) as SubtitleTone[]).map((tone) => {
                                                                        const toneData = TONE_COLORS[tone];
                                                                        const isSelected = (styleEditTarget === 'overlay' && selectedOverlay) ? selectedOverlay.tone === tone : subtitle.tone === tone;
                                                                        return (
                                                                            <button
                                                                                key={tone}
                                                                                onClick={() => applyTone(tone)}
                                                                                className={cn(
                                                                                    "flex-1 py-1.5 rounded-lg text-[11px] transition-all flex items-center justify-center gap-1",
                                                                                    isSelected
                                                                                        ? "bg-white/10 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_20px_rgba(255,255,255,0.02)] text-white font-medium"
                                                                                        : "bg-white/[0.02] border border-white/5 text-white/40 hover:text-white/80 hover:bg-white/[0.06]"
                                                                                )}
                                                                            >
                                                                                {toneData.icon} {toneData.label}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>

                                                                {/* 右半区：颜色选择（矩形大按钮） */}
                                                                <div className="flex gap-1.5">
                                                                    {TONE_COLORS[(styleEditTarget === 'overlay' && selectedOverlay) ? (selectedOverlay.tone || 'warm') : subtitle.tone]?.colors.map((colorOption) => (
                                                                        <button
                                                                            key={colorOption.value}
                                                                            onClick={() => applyColor(colorOption.value)}
                                                                            className={cn(
                                                                                "flex-1 rounded-lg transition-all border",
                                                                                ((styleEditTarget === 'overlay' && selectedOverlay) ? selectedOverlay.color : subtitle.color) === colorOption.value
                                                                                    ? "border-white shadow-[0_0_8px_rgba(255,255,255,0.3)] z-10 scale-[1.03]"
                                                                                    : "border-white/10 opacity-60 hover:opacity-100 hover:scale-[1.02]"
                                                                            )}
                                                                            style={{ backgroundColor: colorOption.value }}
                                                                            title={colorOption.label}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>


                                                    {/* ═══ 动画选择（合并到样式卡片内） ═══ */}
                                                    <div>
                                                        <div className="text-[10px] text-white/40 mb-1.5 flex items-center gap-1"><Film className="h-3 w-3" /> 字幕动画</div>
                                                        <div className="grid grid-cols-3 gap-1.5">
                                                            {([
                                                                { id: 'fade', icon: '✨', label: '淡入淡出' },
                                                                { id: 'pop', icon: '🫧', label: '弹出' },
                                                                { id: 'slide-up', icon: '⬆️', label: '上滑' },
                                                                { id: 'slide-left', icon: '📖', label: '展开' },
                                                                { id: 'glow', icon: '💫', label: '闪烁' },
                                                                { id: 'none', icon: '⏹️', label: '无动画' },
                                                            ] as const).map((anim) => (
                                                                <button
                                                                    key={anim.id}
                                                                    onClick={() => onChange({ ...subtitle, animation: anim.id as any })}
                                                                    className={cn(
                                                                        "px-2 py-1.5 rounded-lg text-[11px] transition-all text-center flex items-center justify-center gap-1",
                                                                        subtitle.animation === anim.id || (!subtitle.animation && anim.id === 'fade')
                                                                            ? "bg-white/10 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_20px_rgba(255,255,255,0.02)] text-white font-medium"
                                                                            : "bg-white/[0.02] border border-white/5 text-white/40 hover:text-white/80 hover:bg-white/[0.06]"
                                                                    )}
                                                                >
                                                                    <span className="text-xs">{anim.icon}</span> {anim.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* ═══ 字体 + 字号选择（合并到样式卡片内） ═══ */}
                                                    <div>
                                                        <div className="flex items-center justify-between mb-1.5">
                                                            <div className="text-[10px] text-white/40 flex items-center gap-1"><Type className="h-3 w-3" /> 字体</div>
                                                            {/* 配音字号调整 (仅在配音文本 Tab 时显示) */}
                                                            {styleEditTarget === 'subtitle' && (
                                                                <div className="flex items-center gap-1.5 bg-black/30 rounded-full px-2 py-1 border border-white/5">
                                                                    <button
                                                                        onClick={handleZoomOut}
                                                                        className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white"
                                                                        title="缩小字号"
                                                                    >
                                                                        <span className="text-xs font-bold leading-none select-none w-4 h-4 flex items-center justify-center">−</span>
                                                                    </button>
                                                                    <span className="text-xs text-white/60 font-medium w-6 text-center tabular-nums">{subtitle.fontSize}</span>
                                                                    <button
                                                                        onClick={handleZoomIn}
                                                                        className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white"
                                                                        title="放大字号"
                                                                    >
                                                                        <span className="text-xs font-bold leading-none select-none w-4 h-4 flex items-center justify-center">+</span>
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-1.5">
                                                            {([
                                                                { id: 'NotoSansSC', label: '思源黑体', lang: 'zh' },
                                                                { id: 'ZCOOLKuaiLe', label: '站酷快乐', lang: 'zh' },
                                                                { id: 'MicrosoftYaHei', label: '微软雅黑', lang: 'zh' },
                                                                { id: 'Montserrat', label: 'Montserrat', lang: 'en' },
                                                                { id: 'BebasNeue', label: 'Bebas Neue', lang: 'en' },
                                                                { id: 'Pacifico', label: 'Pacifico', lang: 'en' },
                                                                { id: 'Cinzel', label: 'Cinzel', lang: 'en' },
                                                                { id: 'EBGaramond', label: 'EB Garamond', lang: 'en' },
                                                            ]).map((font) => (
                                                                <button
                                                                    key={font.id}
                                                                    onClick={() => {
                                                                        if (styleEditTarget === 'overlay' && selectedOverlayId) {
                                                                            updateTextOverlay(selectedOverlayId, { fontFamily: font.id, styleMode: 'custom' });
                                                                            // ⭐ 立即加载字体，不等 useEffect
                                                                            const fontInfo = FONT_CSS_MAP[font.id];
                                                                            if (fontInfo?.file && !loadedFontsRef.current.has(font.id)) {
                                                                                const s = document.createElement('style');
                                                                                s.textContent = `@font-face { font-family: '${fontInfo.cssName}'; src: url('${fontInfo.file}') format('truetype'); font-display: swap; }`;
                                                                                document.head.appendChild(s);
                                                                                loadedFontsRef.current.add(font.id);
                                                                            }
                                                                        } else {
                                                                            onChange({ ...subtitle, fontFamily: font.id });
                                                                        }
                                                                    }}
                                                                    className={cn(
                                                                        "px-2.5 py-1.5 rounded-lg text-left transition-all flex items-center justify-between",
                                                                        ((styleEditTarget === 'overlay' && selectedOverlay) ? selectedOverlay.fontFamily : subtitle.fontFamily) === font.id
                                                                            ? "bg-white/10 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_20px_rgba(255,255,255,0.02)]"
                                                                            : "bg-white/[0.02] border border-white/5 hover:bg-white/[0.06]"
                                                                    )}
                                                                >
                                                                    <span className={cn(
                                                                        "text-[11px] transition-colors",
                                                                        ((styleEditTarget === 'overlay' && selectedOverlay) ? selectedOverlay.fontFamily : subtitle.fontFamily) === font.id ? "text-white font-medium" : "text-white/50"
                                                                    )}>{font.label}</span>
                                                                    <span className="text-[9px] text-white/30 bg-white/5 px-1 rounded uppercase">{font.lang === 'zh' ? '中' : 'EN'}</span>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* ═══ Tab: 🎈 转场效果 ═══ */}
                                        {activeTab === 'sticker' && (
                                            <div className="p-3">
                                                {onTransitionChange ? (
                                                    <TransitionPicker
                                                        value={transition}
                                                        onChange={onTransitionChange}
                                                    />
                                                ) : (
                                                    <div className="text-center text-xs text-white/30 py-12">
                                                        🎈 转场效果配置暂不支持
                                                    </div>
                                                )}
                                            </div>
                                        )}


                                        {/* ═══ Tab: 🎙️ AI 配音 ═══ */}
                                        {activeTab === 'voice' && voiceConfig && onVoiceChange && (
                                            <div className="p-3 space-y-3">
                                                {/* 三选一模式 (Segmented Control) */}
                                                <div className="relative flex p-1 bg-black/40 rounded-full border border-white/5 shadow-inner mb-4">
                                                    {/* 滑块背景 (根据当前选中状态计算绝对定位) */}
                                                    <div
                                                        className={cn(
                                                            "absolute top-1 bottom-1 w-[calc(33.33%-2.6px)] rounded-full transition-all duration-300 ease-out shadow-sm",
                                                            voiceConfig.enabled && voiceConfig.voiceId === 'random'
                                                                ? "bg-gradient-to-r from-mermaid-cyan/20 to-mermaid-cyan/5 border border-mermaid-cyan/30 left-1 shadow-[inset_0_1px_0_rgba(0,242,234,0.3),0_0_15px_rgba(0,242,234,0.1)]"
                                                                : voiceConfig.enabled && voiceConfig.voiceId !== 'random'
                                                                    ? "bg-gradient-to-r from-purple-500/20 to-purple-500/5 border border-purple-500/30 left-[33.33%] shadow-[inset_0_1px_0_rgba(168,85,247,0.3),0_0_15px_rgba(168,85,247,0.1)]"
                                                                    : "bg-white/[0.08] border border-white/10 left-[calc(66.66%+1px)]"
                                                        )}
                                                    />
                                                    <button
                                                        onClick={() => onVoiceChange({ enabled: true, voiceId: 'random', voiceName: '随机' })}
                                                        className={cn(
                                                            "relative z-10 flex-1 py-1.5 text-xs font-medium transition-colors rounded-full",
                                                            voiceConfig.enabled && voiceConfig.voiceId === 'random' ? "text-mermaid-cyan drop-shadow-[0_0_8px_rgba(0,242,234,0.8)]" : "text-white/40 hover:text-white/70"
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
                                                            "relative z-10 flex-1 py-1.5 text-xs font-medium transition-colors rounded-full flex items-center justify-center gap-1",
                                                            voiceConfig.enabled && voiceConfig.voiceId !== 'random' ? "text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]" : "text-white/40 hover:text-white/70"
                                                        )}
                                                    >
                                                        <Mic className="h-3 w-3" /> 指定配音
                                                    </button>
                                                    <button
                                                        onClick={() => onVoiceChange({ ...voiceConfig, enabled: false, voiceId: '', voiceName: '' })}
                                                        className={cn(
                                                            "relative z-10 flex-1 py-1.5 text-xs font-medium transition-colors rounded-full",
                                                            !voiceConfig.enabled ? "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]" : "text-white/40 hover:text-white/70"
                                                        )}
                                                    >
                                                        无
                                                    </button>
                                                </div>

                                                {/* 指定配音列表 */}
                                                {voiceConfig.enabled && voiceConfig.voiceId !== 'random' && (
                                                    <div className="space-y-3">
                                                        {/* 语言 Tab (Segmented Control) */}
                                                        <div className="flex gap-1 p-0.5 bg-black/40 rounded-lg shadow-inner border border-white/5 w-fit">
                                                            {(['zh', 'en'] as const).map(lang => {
                                                                const isActive = PRESET_VOICES.find(v => v.id === voiceConfig.voiceId)?.lang === lang
                                                                    || (!PRESET_VOICES.find(v => v.id === voiceConfig.voiceId) && lang === 'zh');
                                                                return (
                                                                    <button
                                                                        key={lang}
                                                                        onClick={() => {
                                                                            const firstOfLang = PRESET_VOICES.find(v => v.lang === lang);
                                                                            if (firstOfLang) onVoiceChange({ enabled: true, voiceId: firstOfLang.id, voiceName: firstOfLang.name });
                                                                        }}
                                                                        className={cn(
                                                                            "px-4 py-1.5 rounded-[6px] text-[10px] font-medium transition-all relative overflow-hidden",
                                                                            isActive
                                                                                ? "text-purple-400 bg-purple-500/10 border border-purple-500/20 shadow-sm"
                                                                                : "text-white/40 hover:text-white/70 border border-transparent hover:bg-white/5"
                                                                        )}
                                                                    >
                                                                        {lang === 'zh' ? '🇨🇳 中文' : '🇺🇸 English'}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                                                            {PRESET_VOICES
                                                                .filter(v => v.lang === (PRESET_VOICES.find(pv => pv.id === voiceConfig.voiceId)?.lang || 'zh'))
                                                                .map((voice) => (
                                                                    <button
                                                                        key={voice.id}
                                                                        onClick={() => onVoiceChange({ enabled: true, voiceId: voice.id, voiceName: voice.name })}
                                                                        className={cn(
                                                                            "flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all duration-300 border group",
                                                                            voiceConfig.voiceId === voice.id
                                                                                ? "bg-purple-500/10 border-purple-500/30 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]"
                                                                                : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10 shadow-inner"
                                                                        )}
                                                                    >
                                                                        <div className={cn(
                                                                            "h-6 w-6 rounded-full flex items-center justify-center bg-black/20 border transition-colors flex-shrink-0",
                                                                            voiceConfig.voiceId === voice.id
                                                                                ? "border-purple-500/50 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]"
                                                                                : voice.gender === 'female' ? "border-pink-500/20 text-pink-400/70 group-hover:text-pink-400 gap-1 group-hover:border-pink-500/40" : "border-blue-500/20 text-blue-400/70 group-hover:text-blue-400 group-hover:border-blue-500/40"
                                                                        )}>
                                                                            <span className="text-[10px] font-bold">{voice.gender === 'female' ? '♀' : '♂'}</span>
                                                                        </div>

                                                                        <div className="flex flex-col min-w-0 flex-1">
                                                                            <div className="flex items-center justify-between gap-1">
                                                                                <span className={cn(
                                                                                    "text-xs truncate font-medium transition-colors",
                                                                                    voiceConfig.voiceId === voice.id ? "text-purple-300 drop-shadow-[0_0_5px_rgba(168,85,247,0.4)]" : "text-white/80 group-hover:text-white"
                                                                                )}>{voice.name}</span>
                                                                                {voiceConfig.voiceId === voice.id && (
                                                                                    <Check className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />
                                                                                )}
                                                                            </div>
                                                                            <span className="text-[10px] text-white/40 truncate">{voice.style}</span>
                                                                        </div>
                                                                    </button>
                                                                ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* 提示 */}
                                                {voiceConfig.enabled && (
                                                    <div className="text-[10px] text-white/40 flex items-center gap-1">
                                                        <AlertCircle className="h-3 w-3" />
                                                        {voiceConfig.voiceId === 'random'
                                                            ? `AI 将为 ${videoCount} 条视频智能匹配最佳音色`
                                                            : `将为所有视频使用 ${voiceConfig.voiceName} 配音`
                                                        }
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* ═══ Tab: 🎵 背景音乐 ═══ */}
                                        {activeTab === 'bgm' && bgmConfig && onBgmChange && (
                                            <div className="p-3">
                                                <BGMSelector config={bgmConfig} onChange={onBgmChange} videoCount={videoCount} />
                                            </div>
                                        )}

                                    </div>

                                    {/* ═══ 底部 Tab 导航栏 (进度管线风格) ═══ */}
                                    <div className="flex-shrink-0 flex items-center justify-center gap-1 py-3 border-t border-white/10 bg-black/40 backdrop-blur-xl">
                                        {(() => {
                                            const tabs = [
                                                {
                                                    id: 'aiText' as const,
                                                    icon: '✨',
                                                    label: '文案',
                                                    subLabel: aiCaptionConfig?.enabled ? 'AI生成' : '自定义'
                                                },
                                                {
                                                    id: 'style' as const,
                                                    icon: '🎨',
                                                    label: '样式',
                                                    subLabel: subtitle?.style ? STYLE_PRESETS[subtitle.style]?.label || '经典' : '经典'
                                                },
                                                {
                                                    id: 'sticker' as const,
                                                    icon: '🎞',
                                                    label: '转场',
                                                    subLabel: transition === 'none' ? '无' : TRANSITIONS.find(t => t.value === transition)?.label || ''
                                                },
                                                ...(voiceConfig && onVoiceChange ? [{
                                                    id: 'voice' as const,
                                                    icon: '🎙',
                                                    label: '配音',
                                                    subLabel: !voiceConfig.enabled ? '无' : voiceConfig.voiceId === 'random' ? '随机' : voiceConfig.voiceName
                                                }] : []),
                                                ...(bgmConfig && onBgmChange ? [{
                                                    id: 'bgm' as const,
                                                    icon: '🎵',
                                                    label: '音乐',
                                                    subLabel: bgmConfig.mode === 'none' ? '无' : bgmConfig.mode === 'random' ? '随机' : '已指定'
                                                }] : []),
                                            ];

                                            return tabs.map((tab, index) => {
                                                const isActive = activeTab === tab.id;
                                                const activeIndex = tabs.findIndex(t => t.id === activeTab);
                                                const isPast = index < activeIndex;

                                                return (
                                                    <React.Fragment key={tab.id}>
                                                        <button
                                                            onClick={() => setActiveTab(tab.id as any)}
                                                            className={cn(
                                                                "relative flex flex-col items-center justify-center px-4 py-1.5 rounded-full transition-all duration-300 min-w-[72px]",
                                                                isActive
                                                                    ? "bg-gradient-to-r from-mermaid-cyan/20 to-mermaid-cyan/5 border border-mermaid-cyan/30 shadow-[inset_0_1px_0_rgba(0,242,234,0.3),0_0_15px_rgba(0,242,234,0.1)] scale-105"
                                                                    : isPast
                                                                        ? "bg-white/[0.03] hover:bg-white/[0.08]"
                                                                        : "bg-transparent hover:bg-white/[0.05]"
                                                            )}
                                                        >
                                                            <div className={cn(
                                                                "flex items-center gap-1.5 transition-colors",
                                                                isActive ? "text-mermaid-cyan" : isPast ? "text-white/70 hover:text-white" : "text-white/40 hover:text-white/60"
                                                            )}>
                                                                <span className={cn(
                                                                    "text-sm drop-shadow-sm transition-transform",
                                                                    isActive ? "scale-110" : ""
                                                                )}>
                                                                    {tab.icon}
                                                                </span>
                                                                <span className={cn(
                                                                    "text-[11px] font-medium tracking-wide",
                                                                    isActive ? "drop-shadow-[0_0_5px_rgba(0,242,234,0.5)]" : ""
                                                                )}>
                                                                    {tab.label}
                                                                </span>
                                                            </div>
                                                            {/* 动态状态小尾巴 */}
                                                            {tab.subLabel && (
                                                                <span className={cn(
                                                                    "text-[9px] mt-0.5 max-w-[56px] truncate transition-colors",
                                                                    isActive ? "text-mermaid-cyan/70" : "text-white/30"
                                                                )}>
                                                                    {tab.subLabel}
                                                                </span>
                                                            )}
                                                        </button>

                                                        {/* 分隔箭头 */}
                                                        {index < tabs.length - 1 && (
                                                            <div className={cn(
                                                                "flex items-center justify-center shrink-0 w-4 transition-colors",
                                                                index < activeIndex ? "text-mermaid-cyan/50" : "text-white/10"
                                                            )}>
                                                                <ChevronRight className="h-3.5 w-3.5" />
                                                            </div>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>

                            </div>

                            {/* 弹窗底部 - 固定在弹窗底部 */}
                            <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-3 bg-[#0B0C10]/95 backdrop-blur-sm flex-shrink-0">
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
                                        "bg-gradient-to-r from-[#00F2EA] to-[#00D4CE] text-black",
                                        "shadow-[0_0_20px_rgba(0,242,234,0.3)]",
                                        "hover:shadow-[0_0_25px_rgba(0,242,234,0.5)] hover:scale-[1.02]",
                                        "active:scale-[0.98]"
                                    )}
                                >
                                    确认应用
                                </button>
                            </div>
                        </div>
                    </div >
                )
            }
        </>
    );
}




