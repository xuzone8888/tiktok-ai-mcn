"use client";

import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { contentWorkshopExamples } from "../data/landing-data";

export default function FeatureAiCopySection() {
    return (
        <div className="py-16">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        不只是快，更是<span className="text-gray-400">懂内容</span>
                    </h2>
                    <p className="text-gray-500 text-lg">
                        AI 帮你把想法变成打动人的故事
                    </p>
                </div>

                {/* 对比卡片 */}
                <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                    {/* 左: 输入 */}
                    <ReflectiveCard className="!rounded-2xl">
                        <div className="p-8">
                            <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">
                                你的输入
                            </div>
                            <div className="space-y-4">
                                {[
                                    { label: "一个主题", example: "「健身入门指南」" },
                                    { label: "几张产品图", example: "「新品 3 张白底图」" },
                                    { label: "一段想法", example: "「想做一个搞笑科普系列」" },
                                    { label: "一条商品链接", example: "「https://shop.com/...」" },
                                ].map((item, index) => (
                                    <div
                                        key={index}
                                        className="flex justify-between items-center py-3 border-b border-white/10"
                                    >
                                        <span className="text-gray-400">{item.label}</span>
                                        <span className="text-gray-600 text-sm">{item.example}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </ReflectiveCard>

                    {/* 右: AI 角色创作 */}
                    <ReflectiveCard className="!rounded-2xl" active={true}>
                        <div className="p-8">
                            <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">
                                AI 角色创作
                            </div>
                            <div className="space-y-4">
                                {contentWorkshopExamples.map((item, index) => (
                                    <div
                                        key={index}
                                        className="py-3 border-b border-white/10 text-white text-lg flex items-center gap-3 group cursor-default"
                                    >
                                        <div className="p-2 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center text-gray-300 group-hover:bg-white/10 transition-colors">
                                            <item.icon className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <span className="text-xs text-gray-500 uppercase tracking-wider">{item.label}</span>
                                            <p className="text-white text-base group-hover:translate-x-1 transition-transform">
                                                {item.text}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>

                {/* 底部注释 */}
                <div className="text-center mt-8">
                    <p className="text-gray-600 text-sm">
                        种草只是众多内容类型之一，AI 角色可创作任意主题
                    </p>
                </div>
            </div>
        </div>
    );
}
