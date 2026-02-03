/**
 * 轮播模式选择面板 - JCUI 2.0 Mermaid Glass
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Shuffle, Layers } from 'lucide-react';

export type SlideshowMode = 'random' | 'position';

interface SlideshowModePanelProps {
    mode: SlideshowMode;
    onChange: (mode: SlideshowMode) => void;
}

export function SlideshowModePanel({ mode, onChange }: SlideshowModePanelProps) {
    return (
        <div className="space-y-2">
            <label className="text-xs text-white/60">📁 组合模式</label>
            <div className="grid grid-cols-2 gap-3">
                {/* 智能混剪 */}
                <button
                    onClick={() => onChange('random')}
                    className={cn(
                        "relative p-4 rounded-xl border transition-all duration-300 text-left group",
                        mode === 'random'
                            ? "bg-gradient-to-br from-mermaid-lime/10 via-mermaid-cyan/10 to-mermaid-pink/10 border-mermaid-cyan/50 shadow-[0_0_20px_rgba(0,242,234,0.15)]"
                            : "bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10"
                    )}
                >
                    <div className="flex items-center gap-3 mb-2">
                        <div className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                            mode === 'random'
                                ? "bg-mermaid-cyan/20 text-mermaid-cyan"
                                : "bg-white/10 text-white/50 group-hover:text-white/70"
                        )}>
                            <Shuffle className="h-5 w-5" />
                        </div>
                        <div>
                            <div className={cn(
                                "font-semibold transition-colors",
                                mode === 'random' ? "text-mermaid-cyan" : "text-white/80"
                            )}>
                                ✨ 智能混剪
                            </div>
                            <div className="text-xs text-white/40">打乱后随机分组</div>
                        </div>
                    </div>
                </button>

                {/* 场景编排 */}
                <button
                    onClick={() => onChange('position')}
                    className={cn(
                        "relative p-4 rounded-xl border transition-all duration-300 text-left group",
                        mode === 'position'
                            ? "bg-gradient-to-br from-mermaid-pink/10 via-purple-500/10 to-mermaid-cyan/10 border-mermaid-pink/50 shadow-[0_0_20px_rgba(236,72,153,0.15)]"
                            : "bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10"
                    )}
                >
                    <div className="flex items-center gap-3 mb-2">
                        <div className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                            mode === 'position'
                                ? "bg-mermaid-pink/20 text-mermaid-pink"
                                : "bg-white/10 text-white/50 group-hover:text-white/70"
                        )}>
                            <Layers className="h-5 w-5" />
                        </div>
                        <div>
                            <div className={cn(
                                "font-semibold transition-colors",
                                mode === 'position' ? "text-mermaid-pink" : "text-white/80"
                            )}>
                                🎯 场景编排
                            </div>
                            <div className="text-xs text-white/40">分位置上传，精准控制</div>
                        </div>
                    </div>
                </button>
            </div>
        </div>
    );
}
