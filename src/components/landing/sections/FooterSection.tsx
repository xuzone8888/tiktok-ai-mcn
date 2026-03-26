"use client";

import Link from "next/link";
import { Shield } from "lucide-react";
import { footerLinks, footerLinksEn } from "../data/landing-data";
import { useLang } from "@/contexts/LangContext";

export default function FooterSection() {
    const { lang } = useLang();
    const links = lang === "en" ? footerLinksEn : footerLinks;

    return (
        <footer className="relative z-10 border-t border-white/5 py-16 bg-black/50 backdrop-blur-sm">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 链接区域 */}
                <div className="grid md:grid-cols-5 gap-8 mb-12">
                    <div className="md:col-span-2">
                        <Link href="/" className="flex items-center gap-3 mb-6">
                            <img
                                src="/images/toryx_logo_text.png"
                                alt="ToryX AI"
                                className="h-8 drop-shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                            />
                        </Link>
                        <p className="text-gray-500 text-sm leading-relaxed max-w-xs">
                            {lang === "en"
                                ? "AI character-driven content creation platform — helping every creator produce professional content consistently."
                                : "AI 角色驱动的内容创作平台，帮助每位创作者持续产出专业级内容。"}
                        </p>
                    </div>

                    <div>
                        <h4 className="text-white font-semibold mb-5">
                            {lang === "en" ? "Product" : "产品功能"}
                        </h4>
                        <ul className="space-y-3 text-sm text-gray-500">
                            {links.product.map((link, index) => (
                                <li key={index}>
                                    <Link
                                        href={link.href}
                                        className="hover:text-white transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h4 className="text-white font-semibold mb-5">
                            {lang === "en" ? "Support" : "支持"}
                        </h4>
                        <ul className="space-y-3 text-sm text-gray-500">
                            {links.support.map((link, index) => (
                                <li key={index}>
                                    <Link
                                        href={link.href}
                                        className="hover:text-white transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h4 className="text-white font-semibold mb-5">
                            {lang === "en" ? "Legal" : "法律"}
                        </h4>
                        <ul className="space-y-3 text-sm text-gray-500">
                            {links.legal.map((link, index) => (
                                <li key={index}>
                                    <Link
                                        href={link.href}
                                        className="hover:text-white transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* 版权 */}
                <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="text-gray-500 text-sm">
                        {lang === "en"
                            ? `© ${new Date().getFullYear()} Wuhan Guanxing Cultural Media Co., Ltd. All rights reserved.`
                            : `© ${new Date().getFullYear()} 武汉观星文化传媒有限公司 版权所有`}
                    </div>
                    <div className="flex items-center gap-6 text-gray-500 text-sm">
                        <Link
                            href="https://beian.miit.gov.cn/"
                            target="_blank"
                            className="hover:text-white transition-colors flex items-center gap-1.5"
                        >
                            <Shield className="h-4 w-4" />
                            鄂ICP备2023007484号
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
