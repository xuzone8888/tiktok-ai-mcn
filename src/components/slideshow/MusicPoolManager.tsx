/**
 * 音乐池管理器 - JCUI 2.0 Mermaid Glass
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Music, Upload, X, Volume2, VolumeX } from 'lucide-react';

export type MusicMode = 'none' | 'preset' | 'custom';

interface MusicPoolManagerProps {
    mode: MusicMode;
    onModeChange: (mode: MusicMode) => void;
    customMusic: File[];
    onCustomMusicChange: (files: File[]) => void;
    recommendedCount?: number;
}

const PRESET_OPTIONS = [
    { id: 'upbeat', name: '🎵 轻快节奏' },
    { id: 'warm', name: '🌅 温馨舒缓' },
    { id: 'business', name: '💼 商务专业' },
    { id: 'dynamic', name: '⚡ 动感活力' },
];

export function MusicPoolManager({
    mode,
    onModeChange,
    customMusic,
    onCustomMusicChange,
    recommendedCount = 5,
}: MusicPoolManagerProps) {

    // 添加自定义音乐
    const handleUpload = (files: FileList | null) => {
        if (!files) return;
        const newFiles = Array.from(files).filter(f =>
            f.type.includes('audio') && f.size <= 10 * 1024 * 1024
        );
        onCustomMusicChange([...customMusic, ...newFiles]);
    };

    // 删除音乐
    const removeMusic = (index: number) => {
        onCustomMusicChange(customMusic.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-3">
            <label className="text-xs text-white/60">🎵 背景音乐</label>

            {/* 模式选择 */}
            <div className="flex items-center gap-2">
                <button
                    onClick={() => onModeChange('none')}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all",
                        mode === 'none'
                            ? "bg-white/10 text-white border border-white/20"
                            : "text-white/50 hover:text-white hover:bg-white/5"
                    )}
                >
                    <VolumeX className="h-3.5 w-3.5" />
                    无
                </button>
                <button
                    onClick={() => onModeChange('preset')}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all",
                        mode === 'preset'
                            ? "bg-mermaid-cyan/20 text-mermaid-cyan border border-mermaid-cyan/30"
                            : "text-white/50 hover:text-white hover:bg-white/5"
                    )}
                >
                    <Music className="h-3.5 w-3.5" />
                    预设
                </button>
                <button
                    onClick={() => onModeChange('custom')}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all",
                        mode === 'custom'
                            ? "bg-mermaid-pink/20 text-mermaid-pink border border-mermaid-pink/30"
                            : "text-white/50 hover:text-white hover:bg-white/5"
                    )}
                >
                    <Upload className="h-3.5 w-3.5" />
                    自定义
                </button>
            </div>

            {/* 预设音乐说明 */}
            {mode === 'preset' && (
                <div className="p-3 bg-mermaid-cyan/5 border border-mermaid-cyan/20 rounded-lg">
                    <p className="text-sm text-mermaid-cyan/80">
                        系统将从预设音乐库中随机分配不同曲目
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {PRESET_OPTIONS.map(opt => (
                            <span key={opt.id} className="text-xs px-2 py-1 bg-white/5 rounded text-white/60">
                                {opt.name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* 自定义音乐上传 */}
            {mode === 'custom' && (
                <div className="space-y-3">
                    {/* 已上传列表 */}
                    {customMusic.length > 0 && (
                        <div className="space-y-2">
                            {customMusic.map((file, index) => (
                                <div
                                    key={index}
                                    className="flex items-center gap-2 p-2 bg-white/5 border border-white/10 rounded-lg"
                                >
                                    <Volume2 className="h-4 w-4 text-mermaid-pink shrink-0" />
                                    <span className="flex-1 text-sm text-white/80 truncate">{file.name}</span>
                                    <span className="text-xs text-white/40">
                                        {(file.size / 1024 / 1024).toFixed(1)}MB
                                    </span>
                                    <button
                                        onClick={() => removeMusic(index)}
                                        className="p-1 hover:bg-red-500/20 rounded transition-colors"
                                    >
                                        <X className="h-3.5 w-3.5 text-red-400" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 上传按钮 */}
                    <label className="block">
                        <input
                            type="file"
                            multiple
                            accept="audio/mp3,audio/wav,audio/mpeg"
                            className="hidden"
                            onChange={(e) => handleUpload(e.target.files)}
                        />
                        <div className="flex items-center justify-center gap-2 py-3 border-2 border-dashed border-white/20 rounded-lg text-sm text-white/50 hover:border-mermaid-pink/50 hover:text-mermaid-pink cursor-pointer transition-colors">
                            <Upload className="h-4 w-4" />
                            上传音乐 (MP3/WAV, ≤10MB)
                        </div>
                    </label>

                    {/* 建议提示 */}
                    <p className={cn(
                        "text-xs",
                        customMusic.length >= recommendedCount ? "text-emerald-400" : "text-amber-400"
                    )}>
                        💡 已上传 {customMusic.length} 首
                        {customMusic.length < recommendedCount && `，建议上传 ${recommendedCount} 首以上`}
                    </p>
                </div>
            )}
        </div>
    );
}
