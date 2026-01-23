"use client";

import Image from "next/image";
import ReflectiveCard from "@/components/ui/ReflectiveCard";

export default function FeatureModelSection() {
    return (
        <section className="relative z-10 py-24 bg-gradient-to-b from-transparent via-white/[0.01] to-transparent">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        告别昂贵的外拍模特
                    </h2>
                    <p className="text-gray-500 text-lg">
                        AI 数字人模特，成本降低 99%，效果不打折
                    </p>
                </div>

                {/* 对比展示 */}
                <div className="max-w-5xl mx-auto">
                    <ReflectiveCard className="!rounded-3xl overflow-hidden">
                        <div className="grid md:grid-cols-2">
                            {/* 左: 白底图 */}
                            <div className="p-8 flex flex-col items-center justify-center border-r border-white/10 relative group">
                                <div className="text-xs text-gray-500 uppercase tracking-widest mb-6">
                                    原始素材
                                </div>
                                <div className="relative w-48 h-64 rounded-xl overflow-hidden border border-white/10 bg-[#27272a]">
                                    <Image
                                        src="/images/landing/white-hoodie.png"
                                        alt="Original White Background Product"
                                        fill
                                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                </div>
                                <div className="mt-6 text-gray-400 text-sm">
                                    传统拍摄: <span className="text-red-400">$2000/天</span>
                                </div>
                            </div>

                            {/* 右: AI 模特图 */}
                            <div className="p-8 flex flex-col items-center justify-center bg-white/[0.02] relative group">
                                <div className="text-xs text-gray-500 uppercase tracking-widest mb-6">
                                    AI 生成
                                </div>
                                <div className="relative w-48 h-64 rounded-xl overflow-hidden border border-white/20 bg-[#27272a] shadow-2xl shadow-emerald-500/10">
                                    <Image
                                        src="/images/landing/ai-model-hoodie-final.png"
                                        alt="AI Generated Model Wearing White Hoodie with Drawstrings"
                                        fill
                                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                    {/* 闪光特效 */}
                                    <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                                </div>
                                <div className="mt-6 text-gray-400 text-sm">
                                    ToryX: <span className="text-emerald-400">$0.1/张</span>
                                </div>
                            </div>
                        </div>

                        {/* 底部徽章 */}
                        <div className="border-t border-white/10 p-4 flex justify-center">
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                                <span className="text-sm text-emerald-400 font-medium">
                                    Commercial Safe · 商用安全
                                </span>
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>
            </div>
        </section>
    );
}
