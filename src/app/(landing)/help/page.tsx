"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Search, MessageSquare, Book, Zap, Shield } from "lucide-react";

export default function HelpPage() {
    return (
        <div className="min-h-screen bg-[#0a0a0f] text-white">
            {/* 背景装饰 */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-[120px]" />
                <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-[120px]" />
            </div>

            {/* 导航栏 */}
            <header className="relative z-50 border-b border-white/5 backdrop-blur-xl bg-black/20">
                <div className="container max-w-7xl mx-auto px-6 py-4">
                    <nav className="flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-3 group">
                            <div className="w-11 h-11 rounded-xl bg-[#1a1a1a] border border-white/20 flex items-center justify-center">
                                <Sparkles className="h-6 w-6 text-white" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xl font-bold text-white">ToryX</span>
                                <span className="text-[10px] text-gray-500 tracking-wider uppercase">
                                    AI 内容智造工厂
                                </span>
                            </div>
                        </Link>
                        <Link href="/">
                            <Button variant="ghost" className="text-gray-300 hover:text-white">
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                返回首页
                            </Button>
                        </Link>
                    </nav>
                </div>
            </header>

            {/* Hero Section */}
            <main className="relative z-10 py-20 px-6 text-center">
                <h1 className="text-4xl md:text-5xl font-bold mb-6">我们能帮你什么？</h1>
                <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
                    搜索问题，浏览指南，或直接联系我们
                </p>

                {/* 搜索框 */}
                <div className="max-w-xl mx-auto mb-16 relative">
                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                        <Search className="h-5 w-5 text-gray-500" />
                    </div>
                    <input
                        type="text"
                        placeholder="搜索常见问题..."
                        className="w-full pl-12 pr-4 py-4 bg-white/5 border border-white/10 rounded-2xl text-white placeholder:text-gray-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/30 transition-all font-medium"
                    />
                </div>

                {/* 帮助分类 */}
                <div className="container max-w-5xl mx-auto grid md:grid-cols-3 gap-6 text-left">
                    <Link href="#" className="group">
                        <div className="h-full bg-white/5 border border-white/10 rounded-2xl p-8 hover:bg-white/10 transition-all">
                            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                                <Zap className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-bold mb-3">快速入门</h3>
                            <p className="text-gray-400 leading-relaxed">了解如何注册账号，绑定 TikTok，并生成你的第一条视频。</p>
                        </div>
                    </Link>
                    <Link href="#" className="group">
                        <div className="h-full bg-white/5 border border-white/10 rounded-2xl p-8 hover:bg-white/10 transition-all">
                            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                                <Book className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-bold mb-3">使用指南</h3>
                            <p className="text-gray-400 leading-relaxed">深入了解 AI 模特库、视频编辑器和批量生成工具的高级用法。</p>
                        </div>
                    </Link>
                    <Link href="#" className="group">
                        <div className="h-full bg-white/5 border border-white/10 rounded-2xl p-8 hover:bg-white/10 transition-all">
                            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                                <Shield className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-bold mb-3">常见问题</h3>
                            <p className="text-gray-400 leading-relaxed">关于账号计费、版权归属和平台规则的常见疑问解答。</p>
                        </div>
                    </Link>
                </div>

                {/* 底部联系 */}
                <div className="mt-24">
                    <h2 className="text-2xl font-bold mb-6">没找到答案？</h2>
                    <div className="flex items-center justify-center gap-4">
                        <Link href="/contact">
                            <Button className="h-12 px-8 rounded-xl bg-white text-black hover:bg-gray-200 font-bold text-base">
                                联系客服
                            </Button>
                        </Link>
                        <Link href="/feedback">
                            <Button variant="outline" className="h-12 px-8 rounded-xl border-white/20 bg-transparent text-white hover:bg-white/10 font-bold text-base">
                                提交反馈
                            </Button>
                        </Link>
                    </div>
                </div>
            </main>

            {/* 页脚 */}
            <footer className="relative z-10 border-t border-white/5 py-8 bg-black/30">
                <div className="container max-w-7xl mx-auto px-6">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="text-gray-500 text-sm">
                            © {new Date().getFullYear()} Wuhan Guanxing Cultural Media Co., Ltd. All Rights Reserved.
                        </div>
                        <div className="flex items-center gap-6 text-gray-500 text-sm">
                            <Link href="/terms" className="hover:text-white transition-colors">服务条款</Link>
                            <Link href="/privacy" className="hover:text-white transition-colors">隐私政策</Link>
                            <Link href="/legal" className="hover:text-white transition-colors">法律声明</Link>
                            <Link href="https://beian.miit.gov.cn/" target="_blank" className="hover:text-white transition-colors flex items-center gap-1">
                                <Shield className="h-4 w-4" />
                                鄂ICP备2023007484号
                            </Link>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
