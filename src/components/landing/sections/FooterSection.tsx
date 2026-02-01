"use client";

import Link from "next/link";
import { Zap, Shield } from "lucide-react";
import { footerLinks, partnerLogos } from "../data/landing-data";

export default function FooterSection() {
    return (
        <footer className="relative z-10 border-t border-white/5 py-16 bg-black/50 backdrop-blur-sm">
            <div className="container max-w-7xl mx-auto px-6">
                {/* Logo 带 */}
                <div className="mb-12 pb-12 border-b border-white/5">
                    <div className="text-center text-xs text-gray-500 uppercase tracking-widest mb-6">
                        受到领先品牌信赖
                    </div>
                    <div className="flex items-center justify-center gap-12 flex-wrap">
                        {partnerLogos.map((logo, index) => (
                            <span
                                key={index}
                                className="text-gray-600 text-sm font-medium opacity-50 hover:opacity-100 transition-opacity"
                            >
                                {logo}
                            </span>
                        ))}
                    </div>
                </div>

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
                            AI 驱动的短视频创作平台，让每一个创作者都能高效产出专业级内容。
                        </p>
                    </div>

                    <div>
                        <h4 className="text-white font-semibold mb-5">产品功能</h4>
                        <ul className="space-y-3 text-sm text-gray-500">
                            {footerLinks.product.map((link, index) => (
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
                        <h4 className="text-white font-semibold mb-5">支持</h4>
                        <ul className="space-y-3 text-sm text-gray-500">
                            {footerLinks.support.map((link, index) => (
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
                        <h4 className="text-white font-semibold mb-5">法律</h4>
                        <ul className="space-y-3 text-sm text-gray-500">
                            {footerLinks.legal.map((link, index) => (
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
                        © {new Date().getFullYear()} 武汉观星文化传媒有限公司 版权所有
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
