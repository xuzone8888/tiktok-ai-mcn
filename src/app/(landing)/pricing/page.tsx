import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import PricingSection from "@/components/landing/sections/PricingSection";
import FooterSection from "@/components/landing/sections/FooterSection";

export const metadata = {
    title: "价格 - Star Gaze",
    description: "选择适合你的方案，从个人创作者到企业团队，总有一款适合你",
};

export default function PricingPage() {
    return (
        <div className="bg-black text-white min-h-screen overflow-hidden">
            {/* 背景装饰 */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
                <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-b from-white/[0.02] to-transparent" />
            </div>

            {/* 导航栏 */}
            <header className="relative z-50 border-b border-white/5 backdrop-blur-xl bg-black/20">
                <div className="container max-w-7xl mx-auto px-6 py-4">
                    <nav className="flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-3 group">
                            <span className="text-lg font-bold text-white drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                Star Gaze
                            </span>
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

            {/* 主要内容 */}
            <main className="relative z-10 pt-8">
                <PricingSection />
                <FooterSection />
            </main>
        </div>
    );
}
