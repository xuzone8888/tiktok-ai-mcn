"use client";

import Link from "next/link";
import { ArrowRight, Rocket } from "lucide-react";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { useLang } from "@/contexts/LangContext";

export default function CtaSection() {
    const { lang } = useLang();

    return (
        <section className="relative z-10 py-24">
            <div className="container max-w-5xl mx-auto px-6">
                <ReflectiveCard className="!rounded-[2.5rem]" active={true}>
                    <div className="p-12 md:p-16 text-center">
                        {/* 徽章 */}
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/20 mb-8">
                            <Rocket className="h-4 w-4 text-white" />
                            <span className="text-sm text-gray-300">
                                {lang === "en" ? "Get Started Now" : "立即开始"}
                            </span>
                        </div>

                        {/* 标题 */}
                        <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
                            {lang === "en"
                                ? "Create Your First AI Character"
                                : "创建你的第一个 AI 角色"}
                        </h2>
                        <p className="text-gray-400 text-lg md:text-xl mb-10 max-w-2xl mx-auto">
                            {lang === "en"
                                ? "Join creators already producing consistently with ToryX"
                                : "加入正在用 ToryX 持续创作的创作者们"}
                        </p>

                        {/* CTA 按钮 */}
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                            <Link href="/auth/register">
                                <button className="bg-gradient-to-b from-white to-gray-100 text-black hover:to-white px-10 py-4 rounded-xl font-bold text-lg flex items-center shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] transition-all duration-300 border-t border-white group">
                                    {lang === "en" ? "Start for Free" : "免费开始"}
                                    <ArrowRight className="h-5 w-5 ml-3 group-hover:translate-x-1 transition-transform" />
                                </button>
                            </Link>
                            <Link href="/pricing">
                                <div className="px-10 py-4 border border-white/20 text-white rounded-xl font-medium text-lg hover:bg-white/10 transition-all">
                                    {lang === "en" ? "View Pricing" : "了解价格"}
                                </div>
                            </Link>
                        </div>

                        {/* 底标 */}
                        <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-sm text-emerald-400">
                                {lang === "en"
                                    ? "Sign up and get 100 free credits to create your first AI character"
                                    : "注册送 100 积分，可创建首个 AI 角色"}
                            </span>
                        </div>
                    </div>
                </ReflectiveCard>
            </div>
        </section>
    );
}
