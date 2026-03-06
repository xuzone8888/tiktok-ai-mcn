"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
    Blend,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowDown,
    Circle,
    Square,
    Sparkles,
    Waves,
    Zap,
    Moon,
    Sun,
    Target,
    Layers
} from "lucide-react";
import { Label } from "@/components/ui/label";

export type TransitionEffect =
    | "none" | "fade"
    | "wipeleft" | "wiperight" | "wipeup" | "wipedown"
    | "slideleft" | "slideright" | "slideup" | "slidedown"
    | "circleopen" | "circleclose" | "dissolve" | "pixelize"
    | "radial" | "smoothleft" | "smoothright" | "fadeblack" | "fadewhite";

interface TransitionOption {
    value: TransitionEffect;
    label: string;
    icon: React.ReactNode;
}

export const TRANSITIONS: TransitionOption[] = [
    { value: "none", label: "无", icon: <Square className="h-4 w-4" /> },
    { value: "fade", label: "淡入", icon: <Blend className="h-4 w-4" /> },
    { value: "wipeleft", label: "左擦除", icon: <ArrowLeft className="h-4 w-4" /> },
    { value: "wiperight", label: "右擦除", icon: <ArrowRight className="h-4 w-4" /> },
    { value: "wipeup", label: "上擦除", icon: <ArrowUp className="h-4 w-4" /> },
    { value: "wipedown", label: "下擦除", icon: <ArrowDown className="h-4 w-4" /> },
    { value: "slideleft", label: "左滑", icon: <ArrowLeft className="h-4 w-4" /> },
    { value: "slideright", label: "右滑", icon: <ArrowRight className="h-4 w-4" /> },
    { value: "circleopen", label: "圆形展开", icon: <Circle className="h-4 w-4" /> },
    { value: "circleclose", label: "圆形收缩", icon: <Target className="h-4 w-4" /> },
    { value: "dissolve", label: "溶解", icon: <Sparkles className="h-4 w-4" /> },
    { value: "pixelize", label: "像素化", icon: <Layers className="h-4 w-4" /> },
    { value: "radial", label: "放射", icon: <Sun className="h-4 w-4" /> },
    { value: "smoothleft", label: "柔和左滑", icon: <Waves className="h-4 w-4" /> },
    { value: "smoothright", label: "柔和右滑", icon: <Waves className="h-4 w-4" /> },
    { value: "fadeblack", label: "黑屏过渡", icon: <Moon className="h-4 w-4" /> },
    { value: "fadewhite", label: "白屏过渡", icon: <Zap className="h-4 w-4" /> },
];

interface TransitionPickerProps {
    value: TransitionEffect;
    onChange: (value: TransitionEffect) => void;
}

export function TransitionPicker({ value, onChange }: TransitionPickerProps) {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2 pl-1">
                <Blend className="h-4 w-4 text-white/50" />
                <Label className="text-[13px] font-medium text-white/70 tracking-wide">转场效果</Label>
            </div>
            <div className="grid grid-cols-4 gap-3">
                {TRANSITIONS.map((t) => {
                    const isSelected = value === t.value;
                    return (
                        <button
                            key={t.value}
                            onClick={() => onChange(t.value)}
                            className={cn(
                                "relative flex flex-col items-center justify-center gap-2 p-3 rounded-xl transition-all duration-300 group overflow-hidden",
                                isSelected
                                    ? "bg-gradient-to-b from-mermaid-cyan/20 to-mermaid-cyan/5 border-mermaid-cyan/40 shadow-[inset_0_1px_0_rgba(0,242,234,0.3),0_0_15px_rgba(0,242,234,0.15)] text-mermaid-cyan"
                                    : "bg-white/[0.02] border-white/5 hover:bg-white/[0.06] hover:border-white/10 text-white/50 hover:text-white/80 shadow-inner"
                            )}
                            style={{
                                borderWidth: '1px'
                            }}
                            title={t.label}
                        >
                            {/* Hover 扫光效果 */}
                            {!isSelected && (
                                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.05] to-transparent translate-x-[-100%] group-hover:animate-shimmer" />
                            )}

                            <div className={cn(
                                "transition-transform duration-300",
                                isSelected ? "scale-110" : "group-hover:scale-110"
                            )}>
                                {React.cloneElement(t.icon as React.ReactElement, {
                                    className: cn(
                                        "h-5 w-5 transition-colors",
                                        isSelected ? "text-mermaid-cyan drop-shadow-[0_0_8px_rgba(0,242,234,0.8)]" : "text-white/40 group-hover:text-white/70"
                                    )
                                })}
                            </div>
                            <span className={cn(
                                "truncate w-full text-center text-[10px] font-medium transition-colors",
                                isSelected ? "text-white drop-shadow-[0_0_2px_rgba(255,255,255,0.5)]" : ""
                            )}>
                                {t.label}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    );
}
