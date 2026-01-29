"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Wand2, Sparkles, Zap, ChevronRight, Play, Rocket, Crown, Coins,
    CheckCircle2, AlertTriangle, XCircle, TrendingUp, Search,
    LayoutDashboard, Settings, User, Bell, Menu, Loader2, Eye, EyeOff,
    BarChart3, Layers, CreditCard, ArrowUpRight, Share2, Heart
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

// ============================================================================
// JCUI 2.0 TITANIUM FLOW: MERMAID GLASS EDITION (FINAL MASTER)
// ============================================================================

export default function ColorLabPage() {
    const [activeTab, setActiveTab] = useState("components");
    const [toggleState, setToggleState] = useState(true);
    const [inputValue, setInputValue] = useState("Titanium Mermaid Flow");
    const [isHovered, setIsHovered] = useState(false);

    // Fix Hydration: Ensure component only renders fully on client
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    // Noise Texture Base64
    const noiseBg = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.05'/%3E%3C/svg%3E")`;

    if (!mounted) return <div className="min-h-screen bg-[#050505]" />;

    return (
        <div className="min-h-screen bg-[#050505] text-white selection:bg-[#CCFF00]/30 selection:text-[#CCFF00] relative overflow-x-hidden">

            {/* GLOBAL NOISE OVERLAY */}
            <div className="fixed inset-0 pointer-events-none z-50 opacity-20 mix-blend-overlay" style={{ backgroundImage: noiseBg }}></div>

            {/* HEADER & BRANDING */}
            <header className="fixed top-0 left-0 right-0 z-40 bg-[#050505]/80 backdrop-blur-xl border-b border-white/5 transition-all duration-500">
                <div className="container mx-auto px-8 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#CCFF00] via-[#00F2EA] to-[#EC4899] flex items-center justify-center shadow-[0_0_20px_rgba(204,255,0,0.4)] relative overflow-hidden group hover:scale-105 transition-transform duration-500">
                            <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] animate-shimmer" />
                            <Sparkles className="h-5 w-5 text-black fill-black relative z-10" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight">JCUI 2.0 <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899]">Mermaid Glass</span></h1>
                            <p className="text-[10px] text-white/50 font-mono tracking-widest uppercase group-hover:text-white/70 transition-colors duration-500">Titanium Flow System • Ultra Edition</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-[#CCFF00]/10 to-[#EC4899]/10 border border-[#CCFF00]/20 text-xs font-mono text-[#CCFF00] shadow-[0_0_10px_rgba(204,255,0,0.1)]">
                            <span className="h-2 w-2 rounded-full bg-[#CCFF00] animate-pulse shadow-[0_0_10px_#CCFF00]" />
                            System Active
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-8 pt-32 pb-40 space-y-24 relative z-0">

                {/* 1. LAYER 1: FOUNDATION (Colors & Typography) */}
                <section className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
                    <div className="flex items-end justify-between border-b border-white/10 pb-6">
                        <div>
                            <h2 className="text-4xl font-bold text-white mb-2">01. Foundation</h2>
                            <p className="text-white/60 font-mono text-sm">THE HOLOGRAPHIC SPECTRUM</p>
                        </div>
                        <Badge variant="outline" className="border-[#CCFF00]/30 text-[#CCFF00] bg-[#CCFF00]/5">Core DNA</Badge>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        {/* Primary Gradient (Big Block) */}
                        <div className="col-span-12 lg:col-span-7 relative group cursor-pointer" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
                            {/* Aurora Glow Background */}
                            <div className="absolute -inset-1 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] rounded-3xl blur opacity-20 group-hover:opacity-50 transition-opacity duration-500" />

                            <div className="relative h-80 rounded-2xl bg-[#080808] border border-white/10 overflow-hidden flex flex-col shadow-2xl transition-all duration-500 group-hover:border-white/20">
                                <div className="flex-1 bg-gradient-to-br from-[#CCFF00] via-[#00F2EA] to-[#EC4899] relative overflow-hidden">
                                    {/* Advanced Glass Reflections */}
                                    <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.3),transparent)] bg-[length:200%_100%] animate-shimmer" />
                                    <div className="absolute -inset-[100%] bg-gradient-to-tr from-white/10 to-transparent rotate-45 pointer-events-none mix-blend-overlay" />

                                    {/* Interactive Ripple (Concept) */}
                                    <div className={cn("absolute inset-0 transition-opacity duration-500 flex items-center justify-center", isHovered ? "opacity-100" : "opacity-0")}>
                                        <h3 className="text-4xl font-black text-white tracking-widest drop-shadow-lg scale-110 transition-transform duration-500">MERMAID GLASS</h3>
                                    </div>
                                </div>

                                <div className="p-8 flex justify-between items-end bg-[#050505]/95 backdrop-blur-md border-t border-white/5">
                                    <div>
                                        <h3 className="text-2xl font-bold text-white mb-1">Holographic Flow</h3>
                                        <p className="text-white/60 font-mono text-xs">
                                            The "Bridge" Gradient: Energy (Lime) → Tech (Cyan) → Softness (Pink)
                                        </p>
                                    </div>
                                    <div className="text-right space-y-1 font-mono text-xs opacity-70">
                                        <div className="text-[#CCFF00]">#CCFF00</div>
                                        <div className="text-[#00F2EA]">#00F2EA</div>
                                        <div className="text-[#EC4899]">#EC4899</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Secondary Colors & Surfaces */}
                        <div className="col-span-12 lg:col-span-5 grid grid-cols-2 gap-4">
                            <div className="h-36 rounded-2xl bg-[#0B0C10] border border-white/10 p-6 flex flex-col justify-between hover:border-[#CCFF00]/50 transition-colors duration-500 group relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-br from-[#CCFF00]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                <span className="text-white/50 text-xs font-mono uppercase">Deep Space</span>
                                <div>
                                    <span className="text-white font-bold block">Titanium Dark</span>
                                    <span className="text-white/50 text-xs text-xs">#0B0C10</span>
                                </div>
                            </div>
                            <div className="h-36 rounded-2xl bg-[#16181D] border border-white/10 p-6 flex flex-col justify-between hover:border-[#00F2EA]/50 transition-colors duration-500 group relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-br from-[#00F2EA]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                <span className="text-white/50 text-xs font-mono uppercase">Raised Surface</span>
                                <div>
                                    <span className="text-white font-bold block">Titanium Medium</span>
                                    <span className="text-white/50 text-xs text-xs">#16181D</span>
                                </div>
                            </div>
                            {/* Glass Accent */}
                            <div className="col-span-2 h-36 rounded-2xl border border-white/10 p-6 flex items-center justify-between relative overflow-hidden group hover:border-white/20 transition-all duration-500">
                                <div className="absolute inset-0 bg-white/5 backdrop-blur-md" />
                                <div className="absolute inset-0 bg-gradient-to-r from-[#CCFF00]/10 via-[#00F2EA]/10 to-[#EC4899]/10 opacity-50 group-hover:opacity-70 transition-opacity duration-500" />

                                <div className="relative z-10">
                                    <span className="text-white/60 text-xs font-mono uppercase mb-2 block">Overlay Material</span>
                                    <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899]">
                                        Glass + Blur
                                    </span>
                                </div>
                                <div className="relative z-10 h-10 w-10 rounded-full border border-white/20 bg-white/10 backdrop-blur-xl shadow-lg group-hover:scale-110 transition-transform duration-500" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* 2. LAYER 2: ADVANCED INTERACTION (Buttons) */}
                <section className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-100">
                    <div className="flex items-end justify-between border-b border-white/10 pb-6">
                        <div>
                            <h2 className="text-4xl font-bold text-white mb-2">02. Interaction</h2>
                            <p className="text-white/60 font-mono text-sm">FLUID ENERGY TRANSFER</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                        {/* Buttons & Actions */}
                        <div className="space-y-12">

                            {/* PRIMARY MERMAID ULTRA */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-mono text-[#CCFF00] uppercase tracking-wider flex items-center gap-2">
                                    Primary Action (Mermaid Ultra)
                                </h3>
                                <div className="p-8 rounded-3xl border border-white/5 bg-[#0B0C10] flex items-center justify-center relative overflow-hidden group">
                                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(204,255,0,0.05),transparent_70%)] opacity-50 group-hover:opacity-100 transition-opacity duration-500" />

                                    <button className="relative px-12 py-4 rounded-full font-bold text-black text-lg transition-all duration-500
                                        bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899]
                                        hover:scale-[1.02] hover:shadow-[0_10px_40px_-10px_rgba(0,242,234,0.5),0_0_20px_rgba(204,255,0,0.4)]
                                        border border-white/20 overflow-hidden group"
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
                                        <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] animate-shimmer" />
                                        <span className="relative z-10 flex items-center gap-2">
                                            <Sparkles className="h-5 w-5 fill-black/20" /> GENERATE VIDEO
                                        </span>
                                    </button>
                                </div>
                            </div>

                            {/* SECONDARY & GHOST */}
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <span className="text-xs text-white/50 block">Secondary Prism</span>
                                    <button className="relative w-full py-3 rounded-full font-bold bg-[#050505] text-white overflow-hidden group border border-transparent hover:scale-[1.02] transition-transform duration-500">
                                        {/* Gradient Border Hack */}
                                        <div className="absolute inset-0 rounded-full p-[1px] bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] -z-10 blur-[1px] opacity-70 group-hover:opacity-100 group-hover:blur-[2px] transition-all duration-500" />
                                        <div className="absolute inset-[1px] rounded-full bg-[#050505] -z-10" />

                                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#CCFF00] to-[#00F2EA] group-hover:from-[#CCFF00] group-hover:via-[#00F2EA] group-hover:to-[#EC4899] transition-all duration-500">
                                            EXPLORE
                                        </span>
                                    </button>
                                </div>
                                <div className="space-y-4">
                                    <span className="text-xs text-white/50 block">Glass Ghost</span>
                                    <button className="w-full py-3 rounded-full font-bold bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 transition-all duration-500 flex items-center justify-center gap-2 hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]">
                                        <Settings className="h-4 w-4" /> CONFIG
                                    </button>
                                </div>
                            </div>

                            {/* ICON ACTIONS */}
                            <div className="flex gap-6">
                                <button className="h-14 w-14 rounded-2xl bg-gradient-to-br from-[#CCFF00] to-[#00F2EA] p-[1px] shadow-[0_0_20px_rgba(204,255,0,0.2)] hover:shadow-[0_0_30px_rgba(0,242,234,0.4)] hover:scale-105 transition-all duration-500 group">
                                    <div className="h-full w-full rounded-2xl bg-black/10 backdrop-blur-sm flex items-center justify-center">
                                        <Play className="h-6 w-6 fill-black text-black group-hover:text-white group-hover:fill-white transition-colors duration-500" />
                                    </div>
                                </button>
                                <button className="h-14 w-14 rounded-full border border-white/10 bg-[#0B0C10] flex items-center justify-center text-white/50 hover:text-[#EC4899] hover:border-[#EC4899]/50 hover:bg-[#EC4899]/5 transition-all duration-500 group">
                                    <Heart className="h-6 w-6 group-hover:fill-[#EC4899]/20 transition-colors duration-500" />
                                </button>
                                <button className="h-14 w-14 rounded-full border border-white/10 bg-[#0B0C10] flex items-center justify-center text-white/50 hover:text-[#00F2EA] hover:border-[#00F2EA]/50 hover:bg-[#00F2EA]/5 transition-all duration-500">
                                    <Share2 className="h-6 w-6" />
                                </button>
                            </div>
                        </div>

                        {/* INPUTS & CONTROLS */}
                        <div className="space-y-8 bg-[#0B0C10]/50 p-8 rounded-[32px] border border-white/5 relative overflow-hidden group hover:border-white/10 transition-colors duration-500">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-[#CCFF00]/5 blur-[80px] rounded-full pointer-events-none group-hover:bg-[#CCFF00]/10 transition-colors duration-700" />

                            <h3 className="text-sm font-mono text-[#00F2EA] uppercase tracking-wider flex items-center gap-2 relative z-10">
                                <Settings className="h-4 w-4" /> Active Inputs
                            </h3>

                            {/* Active Input */}
                            <div className="space-y-2 relative z-10">
                                <label className="text-xs font-bold text-white/70 ml-1">WORKFLOW NAME</label>
                                <div className="relative group/input">
                                    <Input
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        className="bg-[#050505] border-[#00F2EA]/30 h-16 rounded-2xl text-white pl-14 text-lg focus:border-[#00F2EA] focus:ring-[#00F2EA]/20 focus:shadow-[0_0_30px_rgba(0,242,234,0.1)] transition-all duration-500 group-hover/input:border-[#00F2EA]/50"
                                    />
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg bg-[#00F2EA]/10 flex items-center justify-center group-hover/input:bg-[#00F2EA]/20 transition-colors duration-500">
                                        <Wand2 className="h-4 w-4 text-[#00F2EA]" />
                                    </div>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                        <div className="flex items-center gap-2 px-2 py-1 rounded bg-[#CCFF00]/10 border border-[#CCFF00]/20 group-hover/input:bg-[#CCFF00]/20 transition-colors duration-500">
                                            <div className="h-1.5 w-1.5 rounded-full bg-[#CCFF00] animate-pulse" />
                                            <span className="text-[10px] font-bold text-[#CCFF00]">ACTIVE</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Slider / Toggle Area */}
                            <div className="p-4 rounded-2xl bg-[#050505] border border-white/10 flex items-center justify-between relative z-10 hover:border-white/20 transition-colors duration-500">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-[#EC4899]/10 flex items-center justify-center text-[#EC4899]">
                                        <Zap className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-bold text-white">Turbo Generation</div>
                                        <div className="text-xs text-white/60">High performance mode</div>
                                    </div>
                                </div>
                                <div
                                    className={cn("w-14 h-8 rounded-full p-1 cursor-pointer transition-all duration-500 flex items-center shadow-inner", toggleState ? "bg-gradient-to-r from-[#CCFF00] to-[#00F2EA]" : "bg-white/10")}
                                    onClick={() => setToggleState(!toggleState)}
                                >
                                    <div className={cn("w-6 h-6 rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.2)] transform transition-transform duration-500", toggleState ? "translate-x-6" : "translate-x-0")} />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* 3. LAYER 3: CONTENT SURFACE (Cards with Aurora) */}
                <section className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-200">
                    <div className="flex items-end justify-between border-b border-white/10 pb-6">
                        <div>
                            <h2 className="text-4xl font-bold text-white mb-2">03. Surfaces</h2>
                            <p className="text-white/60 font-mono text-sm">CONTAINERS WITH SOUL</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {/* Standard Card */}
                        <Card className="p-8 bg-[#0B0C10] border-white/10 hover:border-white/20 transition-all duration-500 group rounded-3xl hover:shadow-2xl hover:shadow-white/5">
                            <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center mb-6 text-white/50 group-hover:text-white group-hover:bg-white/10 transition-all duration-500">
                                <Layers className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Titanium Base</h3>
                            <p className="text-white/60 text-sm leading-relaxed">
                                The essential building block. Matte finish, low noise, distinct hierarchy.
                            </p>
                        </Card>

                        {/* AURORA CARD (The Hero) */}
                        <div className="relative group rounded-3xl p-[1px] bg-gradient-to-br from-[#CCFF00]/30 via-[#00F2EA]/30 to-[#EC4899]/30 hover:from-[#CCFF00] hover:via-[#00F2EA] hover:to-[#EC4899] transition-all duration-500 shadow-2xl hover:shadow-[0_0_50px_-10px_rgba(0,242,234,0.3)]">
                            <div className="absolute inset-0 bg-gradient-to-br from-[#CCFF00] via-[#00F2EA] to-[#EC4899] blur-xl opacity-0 group-hover:opacity-40 transition-opacity duration-500 rounded-3xl" />

                            <div className="relative h-full bg-[#050505] rounded-[23px] p-8 overflow-hidden">
                                <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100 transition-opacity duration-500">
                                    <Sparkles className="h-24 w-24 text-white/5 -rotate-12 group-hover:text-white/10 transition-colors duration-500" />
                                </div>

                                <div className="flex items-center gap-3 mb-6">
                                    <Badge className="bg-gradient-to-r from-[#CCFF00] to-[#00F2EA] text-black border-0 font-bold px-3 py-1 animate-pulse">PRO FEATURE</Badge>
                                </div>

                                <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] to-[#00F2EA] mb-2 selection:bg-[#CCFF00] selection:text-black">
                                    Aurora Card
                                </h3>
                                <p className="text-white/70 text-sm leading-relaxed mb-6">
                                    Breathing border gradients that react to hover. Designed for high-value subscription plans or featured content.
                                </p>

                                <button className="text-sm font-bold text-white flex items-center gap-2 group-hover:gap-3 transition-all duration-500">
                                    Learn More <ChevronRight className="h-4 w-4 text-[#CCFF00]" />
                                </button>
                            </div>
                        </div>

                        {/* Glass Overlay Card */}
                        <Card className="p-8 bg-[#16181D] border-white/10 relative overflow-hidden rounded-3xl group hover:border-[#EC4899]/40 transition-colors duration-500">
                            {/* Top Glass Highlight */}
                            <div className="absolute top-0 inset-x-0 h-1/2 bg-gradient-to-b from-white/5 to-transparent pointer-events-none group-hover:from-white/10 transition-colors duration-500" />

                            <div className="h-12 w-12 rounded-2xl bg-[#EC4899]/10 border border-[#EC4899]/20 flex items-center justify-center mb-6 text-[#EC4899] shadow-[0_0_20px_rgba(236,72,153,0.2)] group-hover:scale-110 transition-transform duration-500">
                                <Crown className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Glass Overlay</h3>
                            <p className="text-white/60 text-sm leading-relaxed">
                                Used for overlays, modals, or floating panels. Retains context with blur.
                            </p>
                        </Card>
                    </div>
                </section>

                {/* 4. SECTION 04: VISUAL SPECS (AUDIT) */}
                <section className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-300">
                    <div className="flex items-end justify-between border-b border-white/10 pb-6">
                        <div>
                            <h2 className="text-4xl font-bold text-white mb-2">04. Visual Specs</h2>
                            <p className="text-white/60 font-mono text-sm">ATOMIC DESIGN TOKENS</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                        {/* 4.1 TYPOGRAPHY */}
                        <div className="space-y-8">
                            <h3 className="text-sm font-bold text-white/50 uppercase tracking-widest border-l-2 border-[#CCFF00] pl-3">Typography (Inter)</h3>
                            <div className="space-y-6">
                                <div>
                                    <div className="text-5xl font-bold tracking-tight text-white">Display H1</div>
                                    <div className="text-xs font-mono text-white/30 mt-1">text-5xl font-bold tracking-tight</div>
                                </div>
                                <div>
                                    <div className="text-3xl font-bold text-white">Section H2</div>
                                    <div className="text-xs font-mono text-white/30 mt-1">text-3xl font-bold</div>
                                </div>
                                <div>
                                    <div className="text-2xl font-bold text-white">Title H3</div>
                                    <div className="text-xs font-mono text-white/30 mt-1">text-2xl font-bold</div>
                                </div>
                                <div>
                                    <div className="text-lg text-white/90">Body Large (Introduction text)</div>
                                    <div className="text-xs font-mono text-white/30 mt-1">text-lg text-white/90</div>
                                </div>
                                <div>
                                    <div className="text-base text-white/70">Body Base (Standard content text should be readable and high contrast enough for long reading sessions.)</div>
                                    <div className="text-xs font-mono text-white/30 mt-1">text-base text-white/70</div>
                                </div>
                                <div>
                                    <div className="text-xs font-mono text-white/50 uppercase tracking-widest">MONOSPACE LABEL</div>
                                    <div className="text-xs font-mono text-white/30 mt-1">font-mono text-xs tracking-widest</div>
                                </div>
                            </div>
                        </div>

                        {/* 4.2 LINES & BORDERS & ICONS */}
                        <div className="space-y-12">
                            <h3 className="text-sm font-bold text-white/50 uppercase tracking-widest border-l-2 border-[#00F2EA] pl-3">Borders & Lines</h3>

                            <div className="space-y-6 bg-[#0B0C10] p-6 rounded-2xl border border-white/5">
                                <div className="space-y-2">
                                    <div className="h-px w-full bg-white/5" />
                                    <div className="text-xs font-mono text-white/30">Divider: white/5</div>
                                </div>
                                <div className="space-y-2">
                                    <div className="h-px w-full bg-white/10" />
                                    <div className="text-xs font-mono text-white/30">Border Subtle: white/10</div>
                                </div>
                                <div className="space-y-2">
                                    <div className="h-px w-full bg-white/20" />
                                    <div className="text-xs font-mono text-white/30">Border Strong: white/20</div>
                                </div>
                                <div className="space-y-2">
                                    <div className="h-px w-full bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899]" />
                                    <div className="text-xs font-mono text-white/30">Border Mermaid: Gradient</div>
                                </div>
                            </div>

                            <h3 className="text-sm font-bold text-white/50 uppercase tracking-widest border-l-2 border-[#EC4899] pl-3">Iconography (Lucide)</h3>
                            <div className="grid grid-cols-4 gap-4">
                                <div className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-xl border border-white/5">
                                    <Settings className="h-6 w-6 text-white/70" />
                                    <span className="text-[10px] text-white/30">Neutral</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-xl border border-white/5">
                                    <Zap className="h-6 w-6 text-[#CCFF00]" />
                                    <span className="text-[10px] text-white/30">Lime</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-xl border border-white/5">
                                    <Wand2 className="h-6 w-6 text-[#00F2EA]" />
                                    <span className="text-[10px] text-white/30">Cyan</span>
                                </div>
                                <div className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-xl border border-white/5">
                                    <Heart className="h-6 w-6 text-[#EC4899] fill-[#EC4899]/20" />
                                    <span className="text-[10px] text-white/30">Pink</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* 5. SECTION 05: COMPLETE COMPONENT LIBRARY */}
                <section className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-400">
                    <div className="flex items-end justify-between border-b border-white/10 pb-6">
                        <div>
                            <h2 className="text-4xl font-bold text-white mb-2">05. Components & Status</h2>
                            <p className="text-white/60 font-mono text-sm">SEMANTIC STATES & FORMS</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                        {/* 5.1 SEMANTIC STATUS COLORS */}
                        <div className="space-y-8">
                            <h3 className="text-sm font-bold text-white/50 uppercase tracking-widest border-l-2 border-white/20 pl-3">Semantic Neon</h3>
                            <div className="grid grid-cols-2 gap-4">
                                {/* Success */}
                                <div className="p-4 bg-[#050505] border border-white/10 rounded-xl flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-[#22c55e]/10 flex items-center justify-center text-[#22c55e] shadow-[0_0_15px_rgba(34,197,94,0.2)]">
                                        <CheckCircle2 className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-bold">Success</div>
                                        <div className="text-[#22c55e] text-xs">#22c55e (Neon Green)</div>
                                    </div>
                                </div>
                                {/* Error */}
                                <div className="p-4 bg-[#050505] border border-white/10 rounded-xl flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-[#ef4444]/10 flex items-center justify-center text-[#ef4444] shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                                        <XCircle className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-bold">Error</div>
                                        <div className="text-[#ef4444] text-xs">#ef4444 (Neon Red)</div>
                                    </div>
                                </div>
                                {/* Warning */}
                                <div className="p-4 bg-[#050505] border border-white/10 rounded-xl flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-[#f59e0b]/10 flex items-center justify-center text-[#f59e0b] shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                                        <AlertTriangle className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-bold">Warning</div>
                                        <div className="text-[#f59e0b] text-xs">#f59e0b (Neon Amber)</div>
                                    </div>
                                </div>
                                {/* Info */}
                                <div className="p-4 bg-[#050505] border border-white/10 rounded-xl flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-[#3b82f6]/10 flex items-center justify-center text-[#3b82f6] shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                                        <Bell className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="text-white font-bold">Info</div>
                                        <div className="text-[#3b82f6] text-xs">#3b82f6 (Neon Blue)</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 5.2 FORM ELEMENTS & TOGGLES */}
                        <div className="space-y-8">
                            <h3 className="text-sm font-bold text-white/50 uppercase tracking-widest border-l-2 border-white/20 pl-3">Form Controls</h3>

                            <div className="space-y-6 bg-[#0B0C10] p-6 rounded-2xl border border-white/5">
                                {/* Toggles */}
                                <div className="flex items-center justify-between">
                                    <span className="text-white/70">Toggle Switch</span>
                                    <div className="flex gap-4">
                                        <div className="w-12 h-7 rounded-full bg-gradient-to-r from-[#CCFF00] to-[#00F2EA] p-1 shadow-[0_0_15px_rgba(0,242,234,0.3)] cursor-pointer">
                                            <div className="w-5 h-5 rounded-full bg-white shadow-sm translate-x-5" />
                                        </div>
                                        <div className="w-12 h-7 rounded-full bg-white/10 p-1 cursor-pointer">
                                            <div className="w-5 h-5 rounded-full bg-white/50 shadow-sm" />
                                        </div>
                                    </div>
                                </div>

                                {/* Checkboxes */}
                                <div className="flex items-center justify-between">
                                    <span className="text-white/70">Checkbox</span>
                                    <div className="flex gap-4">
                                        <div className="h-6 w-6 rounded-md bg-[#00F2EA] flex items-center justify-center text-black shadow-[0_0_10px_rgba(0,242,234,0.3)]">
                                            <div className="h-4 w-4 bg-black/10 rounded-sm" />
                                        </div>
                                        <div className="h-6 w-6 rounded-md border border-white/20 hover:border-white/40 transition-colors" />
                                    </div>
                                </div>

                                {/* Radio */}
                                <div className="flex items-center justify-between">
                                    <span className="text-white/70">Radio Selection</span>
                                    <div className="flex gap-4">
                                        <div className="h-6 w-6 rounded-full border-[6px] border-[#CCFF00] bg-transparent shadow-[0_0_10px_rgba(204,255,0,0.3)]" />
                                        <div className="h-6 w-6 rounded-full border border-white/20" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <footer className="py-20 border-t border-white/5 text-center space-y-4">
                    <div className="flex justify-center items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-[#CCFF00]" />
                        <div className="h-2 w-2 rounded-full bg-[#00F2EA]" />
                        <div className="h-2 w-2 rounded-full bg-[#EC4899]" />
                    </div>
                    <div className="text-white/30 font-mono text-xs">
                        JCUI 2.0 • MERMAID GLASS EDITION • FINAL
                    </div>
                </footer>

            </main>
        </div>
    );
}
