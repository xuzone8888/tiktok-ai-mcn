"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Play, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { heroData, scenarioCarousel } from "../data/landing-data";
import { createClient } from "@/lib/supabase/client";

export default function HeroSection() {
    const router = useRouter();
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [currentScenario, setCurrentScenario] = useState(0);

    useEffect(() => {
        const checkAuth = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            setIsLoggedIn(!!user);
        };
        checkAuth();
    }, []);

    // 场景轮播
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentScenario((prev) => (prev + 1) % scenarioCarousel.length);
        }, 3500);
        return () => clearInterval(timer);
    }, []);

    const handleStartCreate = () => {
        if (isLoggedIn) {
            router.push("/models");
        } else {
            setShowLoginModal(true);
        }
    };

    return (
        <section className="relative z-10 pt-24 pb-32">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 导航栏 */}
                <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/30">
                    <div className="container max-w-7xl mx-auto px-6 py-4">
                        <nav className="flex items-center justify-between">
                            <Link href="/" className="flex items-center gap-3 group">
                                <img
                                    src="/images/toryx_logo_text.png"
                                    alt="ToryX AI"
                                    className="h-8 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                />
                            </Link>

                            {/* 导航链接 */}
                            <div className="hidden md:flex items-center gap-1">
                                <Link
                                    href="/models"
                                    className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                                >
                                    角色市场
                                </Link>
                                <Link
                                    href="#character-engine"
                                    className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                                >
                                    功能
                                </Link>
                                <Link
                                    href="/pricing"
                                    className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                                >
                                    价格
                                </Link>
                                {/* 更多下拉 */}
                                <div className="relative group/more">
                                    <button className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all flex items-center gap-1">
                                        更多
                                        <ChevronDown className="h-3 w-3" />
                                    </button>
                                    <div className="absolute top-full right-0 mt-2 w-40 py-2 bg-black/90 border border-white/10 rounded-xl backdrop-blur-xl opacity-0 invisible group-hover/more:opacity-100 group-hover/more:visible transition-all">
                                        <Link
                                            href="/privacy"
                                            className="block px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                                        >
                                            隐私政策
                                        </Link>
                                        <Link
                                            href="/terms"
                                            className="block px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                                        >
                                            服务条款
                                        </Link>
                                    </div>
                                </div>
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
                    <h1 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold leading-[1.1] mb-6 text-white">
                        {heroData.headline}
                    </h1>

                    {/* 副标题 */}
                    <p className="text-xl md:text-2xl text-gray-400 mb-12 max-w-3xl mx-auto">
                        {heroData.subheadline}
                    </p>

                    {/* Reflective 输入框 */}
                    <div className="max-w-2xl mx-auto mb-6">
                        <ReflectiveCard className="!rounded-2xl" roughness={0.6}>
                            <div className="flex items-center p-2">
                                <input
                                    type="text"
                                    placeholder={heroData.inputPlaceholder}
                                    className="flex-1 bg-transparent text-white placeholder-gray-500 px-4 py-3 text-lg outline-none"
                                />
                                <button
                                    onClick={handleStartCreate}
                                    className="bg-gradient-to-b from-white to-gray-100 text-black hover:to-white px-6 py-3 rounded-xl font-medium flex items-center shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] transition-all duration-300 border-t border-white"
                                >
                                    开始创作
                                    <ArrowRight className="h-4 w-4 ml-2" />
                                </button>
                            </div>
                        </ReflectiveCard>
                    </div>

                    {/* 场景轮播 */}
                    <div className="h-8 mb-10 flex items-center justify-center overflow-hidden">
                        <div
                            className="transition-all duration-500 ease-in-out"
                            key={currentScenario}
                        >
                            {(() => {
                                const Icon = scenarioCarousel[currentScenario].icon;
                                return (
                                    <span className="text-gray-500 text-sm inline-flex items-center gap-1.5">
                                        <Icon className="w-4 h-4" />
                                        「{scenarioCarousel[currentScenario].text}」
                                    </span>
                                );
                            })()}
                        </div>
                    </div>

                    {/* 登录弹窗 */}
                    {showLoginModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                            <ReflectiveCard className="!rounded-2xl max-w-md w-full mx-4">
                                <div className="p-8 text-center">
                                    <h3 className="text-2xl font-bold text-white mb-4">请先登录</h3>
                                    <p className="text-gray-400 mb-6">登录后即可创建 AI 角色，开始生成内容</p>
                                    <div className="flex flex-col gap-3">
                                        <Link href="/auth/login?redirect=/models">
                                            <button className="w-full bg-gradient-to-b from-white to-gray-100 text-black hover:to-white py-3 rounded-xl font-medium transition-all">
                                                立即登录
                                            </button>
                                        </Link>
                                        <Link href="/auth/register?redirect=/models">
                                            <button className="w-full bg-white/10 text-white border border-white/20 py-3 rounded-xl font-medium hover:bg-white/20 transition-all">
                                                免费注册
                                            </button>
                                        </Link>
                                        <button
                                            onClick={() => setShowLoginModal(false)}
                                            className="text-gray-500 hover:text-white text-sm mt-2"
                                        >
                                            取消
                                        </button>
                                    </div>
                                </div>
                            </ReflectiveCard>
                        </div>
                    )}

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
                        <Link href="#character-engine">
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
