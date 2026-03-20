"use client";

import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { workflowSteps } from "../data/landing-data";

export default function GenerationEngineSection() {
    return (
        <div className="py-16">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        从灵感到成品，<span className="text-gray-400">极速出片</span>
                    </h2>
                    <p className="text-gray-500 text-lg">
                        你负责想法，AI 角色负责执行
                    </p>
                </div>

                {/* 3 步流程 */}
                <div className="grid md:grid-cols-3 gap-8 lg:gap-12 max-w-5xl mx-auto">
                    {workflowSteps.map((item, index) => (
                        <div key={index} className="relative group">
                            {/* 连接线 */}
                            {index < 2 && (
                                <div className="hidden md:block absolute top-16 left-[60%] w-[80%] h-[2px] bg-gradient-to-r from-white/10 to-transparent" />
                            )}

                            <ReflectiveCard className="!rounded-2xl">
                                <div className="p-8 relative">
                                    {/* 步骤数字背景 */}
                                    <div className="absolute -top-4 -left-2 text-8xl font-bold text-white/[0.03] select-none font-mono">
                                        {item.step}
                                    </div>

                                    <div className="relative z-10">
                                        <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                            <item.icon className="h-7 w-7 text-gray-400" />
                                        </div>
                                        <div className="text-sm font-mono text-gray-500 mb-2">
                                            STEP {item.step}
                                        </div>
                                        <h3 className="text-2xl font-bold text-white mb-3">
                                            {item.title}
                                        </h3>
                                        <p className="text-gray-400 leading-relaxed">
                                            {item.desc}
                                        </p>
                                    </div>
                                </div>
                            </ReflectiveCard>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
