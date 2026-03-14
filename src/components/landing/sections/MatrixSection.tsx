"use client";

import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { Lock } from "lucide-react";
import { possibilitiesData } from "../data/landing-data";

export default function MatrixSection() {
    return (
        <div className="py-16">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        一个角色，无限可能
                    </h2>
                    <p className="text-gray-500 text-lg">
                        优质内容是起点，你的角色能做的远不止一件事
                    </p>
                </div>

                {/* 4 方向卡片 */}
                <div className="max-w-5xl mx-auto">
                    <ReflectiveCard className="!rounded-3xl" active={true}>
                        <div className="p-8">
                            <div className="grid md:grid-cols-2 gap-6">
                                {possibilitiesData.map((item, index) => (
                                    <div
                                        key={index}
                                        className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all group"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0 mt-1">
                                                <item.icon className="w-5 h-5 text-gray-400" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <h3 className="text-lg font-bold text-white">
                                                        {item.title}
                                                    </h3>
                                                    {item.status === "coming" && (
                                                        <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                                            即将推出
                                                        </span>
                                                    )}
                                                    {item.status === "ready" && (
                                                        <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                                            已上线
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-gray-400 text-sm leading-relaxed">
                                                    {item.desc}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>

                {/* 底标 */}
                <div className="mt-8 text-center">
                    <p className="text-gray-600 text-sm inline-flex items-center justify-center w-full gap-1">
                        <Lock className="w-4 h-4" /> 严格遵循平台准则 · AI 内容透明标注
                    </p>
                </div>
            </div>
        </div>
    );
}
