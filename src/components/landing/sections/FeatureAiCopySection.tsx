"use client";

import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { CloudRain, Zap, Rocket, Eye } from "lucide-react";

export default function FeatureAiCopySection() {
    return (
        <section className="relative z-10 py-24">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        不只是快，更是<span className="text-gray-400">懂行</span>
                    </h2>
                    <p className="text-gray-500 text-lg">
                        AI 深度理解产品卖点，自动生成高转化脚本
                    </p>
                </div>

                {/* 对比卡片 */}
                <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                    {/* 左: 技术参数 */}
                    <ReflectiveCard className="!rounded-2xl">
                        <div className="p-8">
                            <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">
                                技术参数
                            </div>
                            <div className="space-y-4">
                                {[
                                    { param: "防水等级", value: "IP68" },
                                    { param: "电池容量", value: "5000mAh" },
                                    { param: "充电功率", value: "67W 快充" },
                                    { param: "屏幕刷新率", value: "120Hz" },
                                ].map((item, index) => (
                                    <div
                                        key={index}
                                        className="flex justify-between items-center py-3 border-b border-white/10"
                                    >
                                        <span className="text-gray-400">{item.param}</span>
                                        <span className="font-mono text-white">{item.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </ReflectiveCard>

                    {/* 右: AI 文案 */}
                    <ReflectiveCard className="!rounded-2xl" active={true}>
                        <div className="p-8">
                            <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">
                                AI 生成文案
                            </div>
                            <div className="space-y-4">
                                {[
                                    { text: "下雨天也不怕湿鞋", icon: CloudRain, color: "text-gray-300" },
                                    { text: "充电 30 分钟，刷剧一整天", icon: Zap, color: "text-gray-300" },
                                    { text: "告别卡顿，丝滑如新", icon: Rocket, color: "text-gray-300" },
                                    { text: "高清护眼，越看越舒服", icon: Eye, color: "text-gray-300" },
                                ].map((item, index) => (
                                    <div
                                        key={index}
                                        className="py-3 border-b border-white/10 text-white text-lg flex items-center gap-3 group cursor-default"
                                    >
                                        <div className={`p-2 rounded-lg bg-white/5 border border-white/5 ${item.color} group-hover:bg-white/10 transition-colors`}>
                                            <item.icon className="w-5 h-5" />
                                        </div>
                                        <span className="group-hover:translate-x-1 transition-transform">{item.text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>
            </div>
        </section>
    );
}
