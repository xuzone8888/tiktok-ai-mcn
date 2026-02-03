/**
 * 字幕配置组件 - JCUI 2.0 Mermaid Glass
 * 增强版：字体选择 + 实时预览
 */

'use client';

import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Type } from 'lucide-react';
import { Label } from '@/components/ui/label';

export interface SubtitleConfig {
    text: string;
    position: 'top' | 'center' | 'bottom';
    fontSize: number;
    fontColor: string;
    fontFamily: string;
}

interface SubtitleEditorProps {
    subtitle: SubtitleConfig | null;
    onChange: (subtitle: SubtitleConfig | null) => void;
}

const POSITION_OPTIONS = [
    { value: 'top', label: '顶部' },
    { value: 'center', label: '居中' },
    { value: 'bottom', label: '底部' },
] as const;

const COLOR_OPTIONS = [
    { value: 'white', label: '白色', class: 'bg-white' },
    { value: 'black', label: '黑色', class: 'bg-black' },
    { value: '#FFD700', label: '金色', class: 'bg-yellow-400' },
    { value: '#00F2EA', label: '青色', class: 'bg-cyan-400' },
    { value: '#FE2C55', label: '粉色', class: 'bg-pink-500' },
];

const FONT_OPTIONS = [
    { value: 'NotoSansSC', label: '思源黑体', style: 'font-sans' },
    { value: 'ZCOOLXiaoWei', label: '站酷小薇', style: 'italic' },
    { value: 'MaShanZheng', label: '马善正楷', style: 'font-serif' },
    { value: 'ZCOOLQingKeHuangYou', label: '庆科黄油', style: 'font-bold' },
];

const SIZE_OPTIONS = [24, 36, 48, 64, 72];

export function SubtitleEditor({ subtitle, onChange }: SubtitleEditorProps) {
    const enabled = subtitle !== null;
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const handleEnable = () => {
        if (!enabled) {
            onChange({
                text: '',
                position: 'bottom',
                fontSize: 48,
                fontColor: 'white',
                fontFamily: 'NotoSansSC',
            });
        } else {
            onChange(null);
        }
    };

    const updateField = <K extends keyof SubtitleConfig>(key: K, value: SubtitleConfig[K]) => {
        if (!subtitle) return;
        onChange({ ...subtitle, [key]: value });
    };

    // 实时预览绘制
    useEffect(() => {
        if (!canvasRef.current || !subtitle) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 设置 canvas 尺寸 (9:16 比例)
        const width = canvas.clientWidth * 2;
        const height = canvas.clientHeight * 2;
        canvas.width = width;
        canvas.height = height;

        // 清空并绘制背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, width, height);

        // 模拟图片区域
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(20, 20, width - 40, height - 40);

        if (subtitle.text) {
            // 设置字体
            const fontSize = (subtitle.fontSize / 48) * 32; // 缩放到预览尺寸
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = subtitle.fontColor;
            ctx.textAlign = 'center';

            // 添加阴影
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            // 计算位置
            let y: number;
            if (subtitle.position === 'top') {
                y = height * 0.12;
            } else if (subtitle.position === 'center') {
                y = height / 2;
            } else {
                y = height * 0.88;
            }

            // 绘制文字
            ctx.fillText(subtitle.text, width / 2, y);
        }
    }, [subtitle]);

    return (
        <div className="space-y-3">
            {/* 启用开关 */}
            <div className="flex items-center justify-between">
                <Label className="text-xs text-white/60 flex items-center gap-1.5">
                    <Type className="h-3.5 w-3.5" />
                    📝 添加字幕
                </Label>
                <button
                    onClick={handleEnable}
                    className={cn(
                        "relative w-10 h-5 rounded-full transition-all",
                        enabled
                            ? "bg-mermaid-cyan/30 border border-mermaid-cyan/50"
                            : "bg-white/10 border border-white/20"
                    )}
                >
                    <span
                        className={cn(
                            "absolute top-0.5 w-4 h-4 rounded-full transition-all",
                            enabled
                                ? "left-[22px] bg-mermaid-cyan"
                                : "left-0.5 bg-white/40"
                        )}
                    />
                </button>
            </div>

            {/* 字幕配置面板 */}
            {enabled && subtitle && (
                <div className="space-y-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                    {/* 预览区域 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">👁️ 实时预览</Label>
                        <canvas
                            ref={canvasRef}
                            className="w-full aspect-[9/16] bg-black/50 rounded-lg"
                            style={{ maxHeight: '200px' }}
                        />
                    </div>

                    {/* 字幕文字 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">字幕内容</Label>
                        <input
                            type="text"
                            value={subtitle.text}
                            onChange={(e) => updateField('text', e.target.value)}
                            placeholder="输入字幕文字..."
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-mermaid-cyan/50"
                        />
                    </div>

                    {/* 字体选择 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">🔤 字体</Label>
                        <div className="grid grid-cols-2 gap-1.5">
                            {FONT_OPTIONS.map(font => (
                                <button
                                    key={font.value}
                                    onClick={() => updateField('fontFamily', font.value)}
                                    className={cn(
                                        "py-1.5 px-2 rounded-lg text-xs transition-all",
                                        font.style,
                                        subtitle.fontFamily === font.value
                                            ? "bg-mermaid-cyan/20 text-mermaid-cyan border border-mermaid-cyan/30"
                                            : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                                    )}
                                >
                                    {font.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 位置选择 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">📍 位置</Label>
                        <div className="flex gap-2">
                            {POSITION_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => updateField('position', opt.value)}
                                    className={cn(
                                        "flex-1 py-1.5 rounded-lg text-xs transition-all",
                                        subtitle.position === opt.value
                                            ? "bg-mermaid-cyan/20 text-mermaid-cyan border border-mermaid-cyan/30"
                                            : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 字号选择 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">字号大小</Label>
                        <div className="flex gap-1.5">
                            {SIZE_OPTIONS.map(size => (
                                <button
                                    key={size}
                                    onClick={() => updateField('fontSize', size)}
                                    className={cn(
                                        "w-10 h-8 rounded-lg text-xs transition-all",
                                        subtitle.fontSize === size
                                            ? "bg-mermaid-cyan/20 text-mermaid-cyan border border-mermaid-cyan/30"
                                            : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                                    )}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 颜色选择 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">🎨 颜色</Label>
                        <div className="flex gap-2">
                            {COLOR_OPTIONS.map(color => (
                                <button
                                    key={color.value}
                                    onClick={() => updateField('fontColor', color.value)}
                                    className={cn(
                                        "w-8 h-8 rounded-full border-2 transition-all",
                                        color.class,
                                        subtitle.fontColor === color.value
                                            ? "border-mermaid-cyan scale-110"
                                            : "border-transparent hover:border-white/30"
                                    )}
                                    title={color.label}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
