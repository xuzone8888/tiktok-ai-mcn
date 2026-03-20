"use client";

import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { complianceCards } from "../data/landing-data";

export default function LiveStatsSection() {
    return (
        <div className="py-16">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">
                        合规保障
                    </div>
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        做合规的创作者，走得更远
                    </h2>
                    <p className="text-gray-500 text-lg">
                        我们比你更重视平台规则
                    </p>
                </div>

                {/* 合规卡片 */}
                <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-4 max-w-6xl mx-auto">
                    {complianceCards.map((card, index) => (
                        <ReflectiveCard key={index} className="!rounded-2xl" active={card.status === "ready"}>
                            <div className="p-6 text-center">
                                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-3 mx-auto">
                                    <card.icon className="w-5 h-5 text-gray-400" />
                                </div>
                                <h3 className="text-base font-bold text-white mb-2">
                                    {card.title}
                                </h3>
                                <p className="text-gray-400 text-sm leading-relaxed">
                                    {card.desc}
                                </p>
                                {card.status === "coming" && (
                                    <div className="mt-3">
                                        <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                            即将推出
                                        </span>
                                    </div>
                                )}
                            </div>
                        </ReflectiveCard>
                    ))}
                </div>
            </div>
        </div>
    );
}
