"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/contexts/LangContext";

// 定价页顶部导航（客户端，随语言切换）。
// 定价页本体是 Server Component（需 export metadata），故把需要 useLang 的导航拆到这里。
export default function PricingTopNav() {
    const { lang } = useLang();
    return (
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
                            {lang === "en" ? "Back to Home" : "返回首页"}
                        </Button>
                    </Link>
                </nav>
            </div>
        </header>
    );
}
