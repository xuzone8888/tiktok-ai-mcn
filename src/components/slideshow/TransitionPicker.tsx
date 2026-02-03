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

const transitions: TransitionOption[] = [
    { value: "none", label: "无", icon: <Square className="h-4 w-4" /> },
    { value: "fade", label: "淡入淡出", icon: <Blend className="h-4 w-4" /> },
    { value: "wipeleft", label: "向左擦除", icon: <ArrowLeft className="h-4 w-4" /> },
    { value: "wiperight", label: "向右擦除", icon: <ArrowRight className="h-4 w-4" /> },
    { value: "wipeup", label: "向上擦除", icon: <ArrowUp className="h-4 w-4" /> },
    { value: "wipedown", label: "向下擦除", icon: <ArrowDown className="h-4 w-4" /> },
    { value: "slideleft", label: "向左滑动", icon: <ArrowLeft className="h-4 w-4" /> },
    { value: "slideright", label: "向右滑动", icon: <ArrowRight className="h-4 w-4" /> },
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
        <div className="space-y-2">
            <Label className="text-xs text-white/60">🎬 转场效果</Label>
            <div className="grid grid-cols-4 gap-1.5">
                {transitions.map((t) => (
                    <button
                        key={t.value}
                        onClick={() => onChange(t.value)}
                        className={cn(
                            "flex flex-col items-center gap-1 p-2 rounded-lg transition-all text-xs",
                            value === t.value
                                ? "bg-mermaid-cyan/20 text-mermaid-cyan border border-mermaid-cyan/30 shadow-sm"
                                : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70"
                        )}
                        title={t.label}
                    >
                        {t.icon}
                        <span className="truncate w-full text-center text-[10px]">{t.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
