/**
 * AI 文案生成器组件 - JCUI 2.0 Mermaid Glass
 * DeepSeek API 集成 + 统一/多样模式
 */

'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Wand2, Sparkles, Loader2, Check, AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export type CaptionStyle = 'lively' | 'professional' | 'humorous' | 'poetic' | 'minimal';
export type CaptionMode = 'unified' | 'diverse';
export type CaptionLanguage = 'en' | 'zh';

export interface AICaptionConfig {
    enabled: boolean;
    mode: CaptionMode;
    keywords: string;
    style: CaptionStyle;
    language: CaptionLanguage; // 默认英文
    generatedTexts?: string[]; // AI 生成的字幕结果
}

interface AICaptionGeneratorProps {
    config: AICaptionConfig;
    onChange: (config: AICaptionConfig) => void;
    videoCount: number;
    onGenerate?: (captions: string[]) => void;
}

const STYLE_OPTIONS: { value: CaptionStyle; label: string; emoji: string }[] = [
    { value: 'lively', label: '活泼', emoji: '🎉' },
    { value: 'professional', label: '专业', emoji: '💼' },
    { value: 'humorous', label: '幽默', emoji: '😄' },
    { value: 'poetic', label: '诗意', emoji: '🌸' },
    { value: 'minimal', label: '极简', emoji: '✨' },
];

export function AICaptionGenerator({
    config,
    onChange,
    videoCount,
    onGenerate,
}: AICaptionGeneratorProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedCaptions, setGeneratedCaptions] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const handleToggle = () => {
        onChange({ ...config, enabled: !config.enabled });
    };

    const handleGenerate = async () => {
        if (!config.keywords.trim()) {
            setError('请输入文案关键词');
            return;
        }

        setIsGenerating(true);
        setError(null);

        try {
            // 调用后端 API
            const response = await fetch('/api/ai/captions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keywords: config.keywords,
                    style: config.style,
                    count: videoCount,
                    mode: config.mode,
                    language: config.language || 'en',
                }),
            });

            if (!response.ok) {
                throw new Error('生成失败，请重试');
            }

            const data = await response.json();
            const captions: string[] = data.captions || [];

            setGeneratedCaptions(captions);
            onGenerate?.(captions);
        } catch (err) {
            setError(err instanceof Error ? err.message : '生成失败');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-3">
            {/* 启用开关 */}
            <div className="flex items-center justify-between">
                <Label className="text-xs text-white/60 flex items-center gap-1.5">
                    <Wand2 className="h-3.5 w-3.5" />
                    🤖 AI 文案
                </Label>
                <button
                    onClick={handleToggle}
                    className={cn(
                        "relative w-10 h-5 rounded-full transition-all",
                        config.enabled
                            ? "bg-mermaid-purple/30 border border-mermaid-purple/50"
                            : "bg-white/10 border border-white/20"
                    )}
                >
                    <span
                        className={cn(
                            "absolute top-0.5 w-4 h-4 rounded-full transition-all",
                            config.enabled
                                ? "left-[22px] bg-mermaid-purple"
                                : "left-0.5 bg-white/40"
                        )}
                    />
                </button>
            </div>

            {/* AI 配置面板 */}
            {config.enabled && (
                <div className="space-y-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                    {/* 关键词输入 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">主题/关键词</Label>
                        <input
                            type="text"
                            value={config.keywords}
                            onChange={(e) => onChange({ ...config, keywords: e.target.value })}
                            placeholder="例如：美好生活、产品推荐、旅行日记"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-mermaid-purple/50"
                        />
                    </div>

                    {/* 风格选择 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">文案风格</Label>
                        <div className="flex gap-1">
                            {STYLE_OPTIONS.map((style) => (
                                <button
                                    key={style.value}
                                    onClick={() => onChange({ ...config, style: style.value })}
                                    className={cn(
                                        "flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all flex flex-col items-center gap-0.5",
                                        config.style === style.value
                                            ? "bg-mermaid-purple/20 text-mermaid-purple border border-mermaid-purple/30"
                                            : "bg-white/5 text-white/50 border border-transparent hover:bg-white/10"
                                    )}
                                >
                                    <span>{style.emoji}</span>
                                    <span>{style.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 语言选择 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">输出语言</Label>
                        <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                            <button
                                onClick={() => onChange({ ...config, language: 'en' })}
                                className={cn(
                                    "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                    config.language === 'en'
                                        ? "bg-white/10 text-white shadow-sm"
                                        : "text-white/40 hover:text-white/70"
                                )}
                            >
                                🌍 English
                            </button>
                            <button
                                onClick={() => onChange({ ...config, language: 'zh' })}
                                className={cn(
                                    "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                    config.language === 'zh'
                                        ? "bg-white/10 text-white shadow-sm"
                                        : "text-white/40 hover:text-white/70"
                                )}
                            >
                                🇨🇳 中文
                            </button>
                        </div>
                    </div>

                    {/* 模式选择 */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-white/50">生成模式</Label>
                        <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                            <button
                                onClick={() => onChange({ ...config, mode: 'unified' })}
                                className={cn(
                                    "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                    config.mode === 'unified'
                                        ? "bg-white/10 text-white shadow-sm"
                                        : "text-white/40 hover:text-white/70"
                                )}
                            >
                                统一文案
                            </button>
                            <button
                                onClick={() => onChange({ ...config, mode: 'diverse' })}
                                className={cn(
                                    "flex-1 py-1.5 rounded-md text-xs font-medium transition-all",
                                    config.mode === 'diverse'
                                        ? "bg-white/10 text-white shadow-sm"
                                        : "text-white/40 hover:text-white/70"
                                )}
                            >
                                多样文案
                            </button>
                        </div>
                        <p className="text-[10px] text-white/30">
                            {config.mode === 'unified'
                                ? `所有 ${videoCount} 条视频使用相同文案`
                                : `每条视频使用不同文案 (共 ${videoCount} 条)`}
                        </p>
                    </div>

                    {/* 错误提示 */}
                    {error && (
                        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {error}
                        </div>
                    )}

                    {/* 生成按钮 */}
                    <Button
                        onClick={handleGenerate}
                        disabled={isGenerating || !config.keywords.trim()}
                        className="w-full bg-gradient-to-r from-mermaid-purple to-mermaid-pink hover:opacity-90 text-white text-xs h-9"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                生成中...
                            </>
                        ) : (
                            <>
                                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                                AI 生成文案
                            </>
                        )}
                    </Button>

                    {/* 生成结果预览 */}
                    {generatedCaptions.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-white/5">
                            <Label className="text-xs text-white/50 flex items-center gap-1">
                                <Check className="h-3 w-3 text-green-400" />
                                已生成 {generatedCaptions.length} 条文案
                            </Label>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                                {generatedCaptions.slice(0, 3).map((caption, idx) => (
                                    <div
                                        key={idx}
                                        className="text-[10px] text-white/60 bg-white/5 rounded px-2 py-1 truncate"
                                    >
                                        #{idx + 1}: {caption}
                                    </div>
                                ))}
                                {generatedCaptions.length > 3 && (
                                    <div className="text-[10px] text-white/30 text-center">
                                        ... 还有 {generatedCaptions.length - 3} 条
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
