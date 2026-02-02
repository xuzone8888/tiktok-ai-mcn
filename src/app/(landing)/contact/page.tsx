"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Mail, MapPin, Globe, Clock, Shield } from "lucide-react";

export default function ContactPage() {
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
                            <img
                                src="/images/toryx_logo_text.png"
                                alt="ToryX AI"
                                className="h-8 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                            />
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
                <div className="container max-w-4xl mx-auto">
                    <h1 className="text-4xl font-bold mb-4 text-center">联系我们</h1>
                    <p className="text-gray-400 text-center mb-16 max-w-2xl mx-auto">
                        无论是商务合作、技术支持还是一般咨询，我们随时为您提供帮助
                    </p>

                    <div className="grid md:grid-cols-2 gap-6">
                        {/* 商务合作 */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
                            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-6 text-white">
                                <Mail className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-bold mb-2">邮件联系</h3>
                            <p className="text-gray-400 text-sm mb-6">通常在 24 小时内回复</p>
                            <div className="space-y-4">
                                <div>
                                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">商务合作</div>
                                    <div className="text-lg font-mono text-white select-all">toryxai@outlook.com</div>
                                </div>
                                <div>
                                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">客户支持</div>
                                    <div className="text-lg font-mono text-white select-all">toryxai@outlook.com</div>
                                </div>
                            </div>
                        </div>

                        {/* 公司地址 */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
                            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-6 text-white">
                                <MapPin className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-bold mb-2">公司地址</h3>
                            <p className="text-gray-400 text-sm mb-6">欢迎莅临指导</p>
                            <div className="space-y-4 text-gray-300">
                                <p className="leading-relaxed">
                                    <strong>武汉观星文化传媒有限公司</strong><br />
                                    中国湖北省武汉市<br />
                                    光谷科技港 2 栋
                                </p>
                                <div className="flex items-center gap-2 text-sm text-gray-500 pt-2 border-t border-white/10">
                                    <Clock className="h-4 w-4" />
                                    <span>工作日 9:30 - 18:30 (UTC+8)</span>
                                </div>
                            </div>
                        </div>

                        {/* 社交媒体 */}
                        <div className="md:col-span-2 bg-gradient-to-r from-gray-900 to-black border border-white/10 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white">
                                    <Globe className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold">关注 ToryX 官方账号</h3>
                                    <p className="text-gray-400 text-sm">获取最新 AI 视频生成教程与案例</p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <Button variant="outline" className="border-white/20 hover:bg-white/10">TikTok</Button>
                                <Button variant="outline" className="border-white/20 hover:bg-white/10">YouTube</Button>
                                <Button variant="outline" className="border-white/20 hover:bg-white/10">Twitter</Button>
                            </div>
                        </div>
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
