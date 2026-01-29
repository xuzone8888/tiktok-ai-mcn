"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
    Sparkles,
    Zap,
    Box,
    BarChart3,
    Activity,
    Layers,
    Search,
    Settings,
    ArrowRight,
    Gem,
    Check,
    X,
    AlertCircle,
    Clock,
    ChevronRight,
    Command,
    Hash,
    MoreHorizontal
} from "lucide-react";

// ============================================================================
// Crystal Silver (Titanium) Design System
// ============================================================================

const THEME = {
    name: "Titanium Silver (钛空银)",
    description: "纯粹、极致冷静、高精度。以银灰色调构建的专业级生产力工具。",
    bg: "bg-[#0B0C10] [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:40px_40px]",

    // Containers
    cardClass: "bg-[#15161A]/80 backdrop-blur-xl border border-white/[0.08] rounded-xl hover:border-white/20 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.1)] transition-all duration-300 group",
    cardHeader: "border-b border-white/[0.08] p-5",
    cardBody: "p-5",

    // Typography
    fontHeading: "font-sans font-bold tracking-tight text-white",
    fontBody: "font-sans text-sm text-gray-400 leading-relaxed",

    // Interactive Elements
    buttonPrimary: "relative overflow-hidden bg-white text-black hover:bg-white/90 shadow-[0_0_15px_rgba(255,255,255,0.15)] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)] transition-all duration-300 font-bold rounded-lg group/btn",
    buttonSecondary: "bg-white/10 text-white hover:bg-white/20 border border-white/10 hover:border-white/20 transition-all duration-300 font-medium rounded-lg",
    buttonGhost: "text-gray-400 hover:text-white hover:bg-white/5 transition-all duration-300 font-medium rounded-lg",

    // Accents
    accentGradient: "bg-gradient-to-r from-gray-200 to-gray-400",
    accentText: "text-transparent bg-clip-text bg-gradient-to-r from-gray-100 to-gray-400",

    // Borders
    borderSubtle: "border-white/[0.08]",
    borderHighlight: "border-white/20",
};

// Add shimmer animation to global CSS or inline style for demo
const shimmerStyle = `
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  .animate-shimmer {
    animation: shimmer 2s infinite linear;
  }
`;

export default function ThemeLabPage() {
    const [progressVal, setProgressVal] = useState(66);
    const [switchVal, setSwitchVal] = useState(true);

    return (
        <div className={cn("min-h-screen p-8 transition-colors duration-700 font-sans selection:bg-white/20", THEME.bg)}>
            <style dangerouslySetInnerHTML={{ __html: shimmerStyle }} />

            {/* Header */}
            <div className="max-w-7xl mx-auto mb-16 pt-8 space-y-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-gray-400">
                    <Gem className="h-3 w-3" /> Design System v2.0
                </div>
                <div>
                    <h1 className="text-5xl font-bold text-white tracking-tight mb-4">
                        Titanium <span className="text-gray-500">Silver</span>
                    </h1>
                    <p className="text-xl text-gray-400 max-w-2xl font-light">
                        专为高密度工作流打造的极致冷静配色。融合了 "Crystal" 的结构感与 "Obsidian" 的流体排版。
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto grid grid-cols-12 gap-8">

                {/* ================= LEFT COLUMN: COMPONENTS ================= */}
                <div className="col-span-12 lg:col-span-7 space-y-8">

                    {/* 1. BUTTONS & ACTIONS */}
                    <section className="space-y-4">
                        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-widest pl-1">Interactive Elements</h2>
                        <div className={cn(THEME.cardClass, "p-8 space-y-8")}>

                            {/* Primary Actions */}
                            <div className="space-y-4">
                                <h3 className="text-sm text-gray-400">Primary Actions</h3>
                                <div className="flex flex-wrap gap-4 items-center">
                                    <Button className={cn("h-10 px-6", THEME.buttonPrimary)}>
                                        <Sparkles className="mr-2 h-4 w-4" /> Generate
                                    </Button>
                                    <Button className={cn("h-10 px-6 opacity-50 cursor-not-allowed", THEME.buttonPrimary)}>
                                        Processing...
                                    </Button>
                                    <Button size="icon" className={cn("h-10 w-10", THEME.buttonPrimary)}>
                                        <ArrowRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            <div className="h-px bg-white/[0.08]" />

                            {/* Secondary & Ghost */}
                            <div className="grid grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <h3 className="text-sm text-gray-400">Secondary</h3>
                                    <div className="flex flex-wrap gap-3">
                                        <Button className={cn("h-9 px-4", THEME.buttonSecondary)}>Save Draft</Button>
                                        <Button className={cn("h-9 px-4", THEME.buttonSecondary)} variant="outline">
                                            <Settings className="mr-2 h-3.5 w-3.5" /> Config
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <h3 className="text-sm text-gray-400">Ghost / Text</h3>
                                    <div className="flex flex-wrap gap-3">
                                        <Button variant="ghost" className={cn("h-9", THEME.buttonGhost)}>Cancel</Button>
                                        <Button variant="ghost" className={cn("h-9 text-red-400 hover:text-red-300 hover:bg-red-500/10", "transition-all duration-300")}>Delete</Button>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </section>

                    {/* 2. BADGES & STATUS */}
                    <section className="space-y-4">
                        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-widest pl-1">Status & Feedback</h2>
                        <div className={cn(THEME.cardClass, "p-8")}>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Neural / Default */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-center h-8 px-3 rounded text-xs font-medium bg-white/[0.03] text-gray-300 border border-white/[0.05] shadow-sm">
                                        Neutral
                                    </div>
                                    <div className="flex items-center justify-center p-1">
                                        <div className="h-1.5 w-1.5 rounded-full bg-gray-600 ring-4 ring-gray-500/10"></div>
                                    </div>
                                </div>

                                {/* Success - Cyber Mint */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-center h-8 px-3 rounded text-xs font-medium bg-teal-500/10 text-teal-300 border border-teal-500/20 shadow-[0_0_15px_-3px_rgba(94,234,212,0.15)]">
                                        <Check className="mr-1 h-3 w-3" /> Success
                                    </div>
                                    <div className="flex items-center justify-center p-1">
                                        <div className="relative h-2 w-2">
                                            <div className="absolute inset-0 bg-teal-400 rounded-full animate-ping opacity-50"></div>
                                            <div className="relative h-1.5 w-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]"></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Warning - Ionic Gold */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-center h-8 px-3 rounded text-xs font-medium bg-orange-500/10 text-orange-200 border border-orange-500/20 shadow-[0_0_15px_-3px_rgba(251,146,60,0.15)]">
                                        <Clock className="mr-1 h-3 w-3" /> Processing
                                    </div>
                                    <div className="flex items-center justify-center p-1">
                                        <div className="h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.6)]"></div>
                                    </div>
                                </div>

                                {/* Error - Plasma Rose */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-center h-8 px-3 rounded text-xs font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20 shadow-[0_0_15px_-3px_rgba(251,113,133,0.15)]">
                                        <AlertCircle className="mr-1 h-3 w-3" /> Failed
                                    </div>
                                    <div className="flex items-center justify-center p-1">
                                        <div className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* 3. PROGRESS & METRICS */}
                    <section className="space-y-4">
                        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-widest pl-1">Progress & Metrics</h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Progress Card */}
                            <div className={cn(THEME.cardClass, "p-6 space-y-6")}>
                                <div className="flex items-center justify-between">
                                    <h3 className="text-white font-medium">Render Queue</h3>
                                    <span className="text-xs text-gray-400 font-mono">66%</span>
                                </div>

                                {/* Custom Progress Bar Style with Shimmer */}
                                <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className="absolute top-0 left-0 h-full bg-gradient-to-r from-gray-500 to-white rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                                        style={{ width: `${progressVal}%` }}
                                    >
                                        {/* Shimmer Overlay */}
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent w-full -translate-x-full animate-shimmer"></div>
                                    </div>
                                </div>

                                <div className="space-y-3 pt-2">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-500">Video_01.mp4</span>
                                        <span className="text-emerald-400">Complete</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-gray-300">Video_02.mp4</span>
                                        <span className="text-white">Rendering...</span>
                                    </div>
                                    <div className="relative h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                        <div className="absolute h-full w-1/3 bg-gray-400 rounded-full animate-indeterminate"></div>
                                    </div>
                                </div>
                            </div>

                            {/* Slider & Switch */}
                            <div className={cn(THEME.cardClass, "p-6 space-y-8")}>
                                <div className="space-y-4">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-400">Output Quality</span>
                                        <span className="text-white">{progressVal}%</span>
                                    </div>
                                    <Slider
                                        value={[progressVal]}
                                        onValueChange={(v) => setProgressVal(v[0])}
                                        max={100}
                                        step={1}
                                        className="[&_.bg-primary]:bg-white [&_.bg-primary]:shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                                    />
                                </div>

                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="text-sm text-white">Auto-Upload</div>
                                        <div className="text-xs text-gray-500">Upload to TikTok after render</div>
                                    </div>
                                    <Switch
                                        checked={switchVal}
                                        onCheckedChange={setSwitchVal}
                                        className="data-[state=checked]:bg-white data-[state=checked]:shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                </div>

                {/* ================= RIGHT COLUMN: PREVIEW CONTEXT ================= */}
                <div className="col-span-12 lg:col-span-5 space-y-8">

                    {/* MOCKUP: Task Card */}
                    <section className="space-y-4">
                        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-widest pl-1">Live Context</h2>

                        <div className={cn(THEME.cardClass, "relative overflow-hidden group hover:border-white/40 hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-all duration-500")}>
                            {/* Top Decor Line */}
                            <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>

                            <div className={THEME.cardHeader}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-white/10 to-transparent border border-white/5 flex items-center justify-center text-white">
                                            <Box className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-white">批量混剪任务 #A882</h3>
                                            <p className="text-xs text-gray-500">创建于 2 分钟前</p>
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="border-white/10 text-white/60 bg-white/5 hover:bg-white/10">
                                        Draft
                                    </Badge>
                                </div>
                            </div>

                            <div className={THEME.cardBody}>
                                <div className="space-y-4">
                                    <div className="p-4 rounded-lg bg-black/40 border border-white/5 space-y-2">
                                        <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider">
                                            <Hash className="h-3 w-3" /> Prompt
                                        </div>
                                        <p className="text-sm text-gray-300 leading-relaxed">
                                            生成一组充满未来感的科技产品展示视频，使用银灰色调，强调金属质感和光影流动。
                                            <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-white/50 animate-pulse"></span>
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="h-20 rounded bg-white/5 border border-white/5 flex flex-col items-center justify-center gap-2 text-xs text-gray-500 hover:bg-white/10 hover:border-white/20 transition-colors cursor-pointer group/upload">
                                            <div className="p-2 rounded-full bg-white/5 group-hover/upload:bg-white/10 transition-colors">
                                                <Zap className="h-4 w-4 text-gray-400 group-hover/upload:text-white" />
                                            </div>
                                            Add Assets
                                        </div>
                                        <div className="h-20 rounded bg-white/5 border border-white/5 flex items-center justify-center text-xs text-gray-600">
                                            Empty
                                        </div>
                                        <div className="h-20 rounded bg-white/5 border border-white/5 flex items-center justify-center text-xs text-gray-600">
                                            Empty
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 bg-white/[0.02] border-t border-white/5 flex justify-between items-center group-hover:bg-white/[0.04] transition-colors">
                                <span className="text-xs text-gray-500">Est. cost: 120 credits</span>
                                <Button size="sm" className={cn("h-8 px-4 text-xs", THEME.buttonPrimary)}>
                                    Proceed <ChevronRight className="ml-1 h-3 w-3 group-hover/btn:translate-x-1 transition-transform" />
                                </Button>
                            </div>
                        </div>
                    </section>

                    {/* MOCKUP: Typography Scale */}
                    <section className="space-y-4">
                        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-widest pl-1">Typography</h2>
                        <div className="space-y-6 pt-4">
                            <div className="space-y-1">
                                <h1 className="text-4xl font-bold text-white tracking-tight">Heading 1</h1>
                                <p className="text-sm text-gray-500">Inter Bold / 36px / Tight</p>
                            </div>
                            <div className="space-y-1">
                                <h2 className="text-2xl font-semibold text-white tracking-tight">Heading 2</h2>
                                <p className="text-sm text-gray-500">Inter Semibold / 24px / Tight</p>
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-medium text-white">Heading 3</h3>
                                <p className="text-sm text-gray-500">Inter Medium / 18px / Normal</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm text-gray-300 leading-relaxed">
                                    Body Text. The quick brown fox jumps over the lazy dog.
                                    Designed for high readability in dark interfaces.
                                </p>
                                <p className="text-xs text-gray-500">Inter Regular / 14px / Relaxed</p>
                            </div>
                        </div>
                    </section>

                </div>

            </div>

        </div>
    );
}
