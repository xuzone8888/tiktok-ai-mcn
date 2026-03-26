"use client";

import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { Shield } from "lucide-react";
import { characterEngineCards, characterEngineCardsEn } from "../data/landing-data";
import { useLang } from "@/contexts/LangContext";

export default function FeatureModelSection() {
    const { lang } = useLang();
    const cards = lang === "en" ? characterEngineCardsEn : characterEngineCards;

    return (
        <div className="py-16">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        {lang === "en"
                            ? "Build Your Exclusive AI Character from Scratch"
                            : "从零打造你的专属 AI 角色"}
                    </h2>
                    <p className="text-gray-500 text-lg">
                        {lang === "en"
                            ? "Your creative partner — online 24/7, never takes a day off"
                            : "你的创作搭档，24 小时在线，永不请假"}
                    </p>
                </div>

                {/* 4 能力卡片 */}
                <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
                    {cards.map((card, index) => (
                        <ReflectiveCard
                            key={index}
                            className="!rounded-2xl group"
                        >
                            <div className="p-8">
                                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                                    <card.icon className="w-5 h-5 text-gray-400" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">
                                    {card.title}
                                </h3>
                                <p className="text-gray-400 leading-relaxed">
                                    {card.desc}
                                </p>
                            </div>
                        </ReflectiveCard>
                    ))}
                </div>

                {/* 底标 */}
                <div className="mt-10 flex justify-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-sm text-emerald-400 font-medium inline-flex items-center">
                            <Shield className="w-4 h-4 mr-1" />
                            {lang === "en"
                                ? "Original Generation · Commercial Safe · AIGC Compliant"
                                : "原创生成 · 商用安全 · AIGC 合规标注"}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
