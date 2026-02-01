"use client";

import Link from "next/link";
import { ArrowRight, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { heroData } from "../data/landing-data";

export default function HeroSection() {
    return (
        <section className="relative z-10 pt-24 pb-32">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 导航栏 */}
                <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/30">
                    <div className="container max-w-7xl mx-auto px-6 py-4">
                        <nav className="flex items-center justify-between">
                            <Link href="/" className="flex items-center gap-3 group">
                                {/* ToryX Logo */}
                                <img
                                    src="/images/toryx_logo_icon.png"
                                    alt="ToryX Logo"
                                    className="w-10 h-10 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                />
                                {/* Text Logo */}
                                <div className="flex flex-col">
                                    <div className="flex items-baseline">
                                        <span className="text-2xl font-bold text-white">Tory</span>
                                        <span className="text-2xl font-bold text-[#00c853]">X</span>
                                        <span className="text-sm text-white/60 ml-1">AI</span>
                                    </div>
                                    <span className="text-[10px] text-white/40 tracking-wider">
                                        AI 内容智造工厂
                                    </span>
                                </div>
                            </Link>

                            {/* 导航链接 */}
                            <div className="hidden md:flex items-center gap-1">
                                <Link
                                    href="/pricing"
                                    className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                                >
                                    价格
                                </Link>
                                <Link
                                    href="/privacy"
                                    className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                                >
                                    隐私政策
                                </Link>
                                <Link
                                    href="/terms"
                                    className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                                >
                                    服务条款
                                </Link>
                            </div>

                            <div className="flex items-center gap-3">
                                <Link href="/auth/login">
                                    <Button
                                        variant="ghost"
                                        className="text-gray-300 hover:text-white hover:bg-white/10"
                                    >
                                        登录
                                    </Button>
                                </Link>
                                <Link href="/auth/register">
                                    <ReflectiveCard
                                        width="auto"
                                        height="auto"
                                        className="!rounded-lg"
                                        roughness={0.5}
                                    >
                                        <div className="px-4 py-2 text-sm font-medium">
                                            免费注册
                                        </div>
                                    </ReflectiveCard>
                                </Link>
                            </div>
                        </nav>
                    </div>
                </header>

                {/* Hero 内容 */}
                <div className="text-center max-w-5xl mx-auto pt-16">
                    {/* 徽章 */}
                    <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 border border-white/10 mb-10">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-sm text-gray-400">{heroData.badge}</span>
                    </div>

                    {/* 主标题 */}
                    <h1 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold leading-[1.1] mb-6 text-white whitespace-nowrap">
                        从商品链接，到 TikTok 爆款视频
                    </h1>

                    {/* 副标题 */}
                    <p className="text-xl md:text-2xl text-gray-400 mb-12 max-w-3xl mx-auto">
                        {heroData.subheadline}
                    </p>

                    {/* Reflective 输入框 */}
                    <div className="max-w-2xl mx-auto mb-10">
                        <ReflectiveCard className="!rounded-2xl" roughness={0.6}>
                            <div className="flex items-center p-2">
                                <input
                                    type="text"
                                    placeholder={heroData.inputPlaceholder}
                                    className="flex-1 bg-transparent text-white placeholder-gray-500 px-4 py-3 text-lg outline-none"
                                />
                                <button className="bg-gradient-to-b from-white to-gray-100 text-black hover:to-white px-6 py-3 rounded-xl font-medium flex items-center shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] transition-all duration-300 border-t border-white">
                                    生成视频
                                    <ArrowRight className="h-4 w-4 ml-2" />
                                </button>
                            </div>
                        </ReflectiveCard>
                    </div>

                    {/* CTA 按钮组 */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link href="/auth/register">
                            <ReflectiveCard
                                width="auto"
                                height="auto"
                                className="!rounded-xl group"
                                active={true}
                            >
                                <div className="flex items-center px-8 py-4 text-lg font-medium">
                                    <Play className="h-5 w-5 mr-3" />
                                    {heroData.ctaPrimary}
                                    <ArrowRight className="h-5 w-5 ml-3 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </ReflectiveCard>
                        </Link>
                        <Link href="/contact">
                            <Button
                                variant="outline"
                                size="lg"
                                className="h-14 px-8 text-lg border-white/20 text-white hover:bg-white/10"
                            >
                                {heroData.ctaSecondary}
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
}
