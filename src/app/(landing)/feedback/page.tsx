"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, MessageSquare, Shield } from "lucide-react";

export default function FeedbackPage() {
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

            {/* 内容 */}
            <main className="relative z-10 py-20 px-6">
                <div className="container max-w-2xl mx-auto">
                    <div className="text-center mb-12">
                        <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-6 text-white">
                            <MessageSquare className="h-8 w-8" />
                        </div>
                        <h1 className="text-4xl font-bold mb-4">反馈与建议</h1>
                        <p className="text-gray-400">
                            你的建议是我们进步的动力。如果发现 Bug 或有新的功能需求，请告诉我们。
                        </p>
                    </div>

                    <form className="space-y-6 bg-white/5 border border-white/10 rounded-2xl p-8" onSubmit={(e) => e.preventDefault()}>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">反馈类型</label>
                            <div className="grid grid-cols-3 gap-3">
                                <label className="cursor-pointer">
                                    <input type="radio" name="type" className="peer sr-only" defaultChecked />
                                    <div className="text-center py-3 rounded-xl bg-black/20 border border-white/10 peer-checked:bg-white peer-checked:text-black peer-checked:border-white transition-all text-sm font-medium">功能建议</div>
                                </label>
                                <label className="cursor-pointer">
                                    <input type="radio" name="type" className="peer sr-only" />
                                    <div className="text-center py-3 rounded-xl bg-black/20 border border-white/10 peer-checked:bg-white peer-checked:text-black peer-checked:border-white transition-all text-sm font-medium">Bug 报告</div>
                                </label>
                                <label className="cursor-pointer">
                                    <input type="radio" name="type" className="peer sr-only" />
                                    <div className="text-center py-3 rounded-xl bg-black/20 border border-white/10 peer-checked:bg-white peer-checked:text-black peer-checked:border-white transition-all text-sm font-medium">其他</div>
                                </label>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">问题描述</label>
                            <textarea
                                rows={5}
                                className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/30 transition-colors resize-none"
                                placeholder="请详细描述你遇到的问题或建议..."
                            ></textarea>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">联系邮箱 (选填)</label>
                            <input
                                type="email"
                                className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/30 transition-colors"
                                placeholder="your@email.com"
                            />
                        </div>

                        <Button className="w-full h-12 bg-white text-black hover:bg-gray-200 font-bold text-lg rounded-xl mt-4">
                            提交反馈
                        </Button>
                    </form>
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
