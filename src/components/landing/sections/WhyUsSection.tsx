"use client";

import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { comparisonData, comparisonDataEn } from "../data/landing-data";
import { useLang } from "@/contexts/LangContext";

export default function WhyUsSection() {
    const { lang } = useLang();
    const data = lang === "en" ? comparisonDataEn : comparisonData;

    return (
        <div className="py-16">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        {lang === "en" ? "A Smarter Way to Create" : "更聪明的创作方式"}
                    </h2>
                    <p className="text-gray-500 text-lg">
                        {lang === "en"
                            ? "Same professional short video — which workflow do you choose?"
                            : "同样一条优质短视频，你选哪种方式？"}
                    </p>
                </div>

                {/* 对比表 */}
                <div className="max-w-4xl mx-auto">
                    <ReflectiveCard className="!rounded-3xl">
                        <div className="p-8">
                            {/* 传统模式 */}
                            <div className="mb-8 pb-8 border-b border-white/10">
                                <div className="text-sm text-gray-500 uppercase tracking-widest mb-4">
                                    {data.traditional.label}
                                </div>
                                <div className="flex items-center gap-4 flex-wrap">
                                    {data.traditional.steps.map((step, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400">
                                                {step}
                                            </div>
                                            {index < data.traditional.steps.length - 1 && (
                                                <span className="text-gray-600">+</span>
                                            )}
                                        </div>
                                    ))}
                                    <span className="text-gray-600">=</span>
                                    <div className="px-6 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-300 font-mono font-bold text-xl">
                                        {data.traditional.total}
                                    </div>
                                </div>
                            </div>

                            {/* ToryX */}
                            <div className="mb-8">
                                <div className="text-sm text-gray-500 uppercase tracking-widest mb-4">
                                    {data.toryx.label}
                                </div>
                                <div className="flex items-center gap-4 flex-wrap">
                                    {data.toryx.steps.map((step, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
                                                {step}
                                            </div>
                                            {index < data.toryx.steps.length - 1 && (
                                                <span className="text-gray-600">+</span>
                                            )}
                                        </div>
                                    ))}
                                    <span className="text-gray-600">=</span>
                                    <div className="px-6 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 font-mono font-bold text-xl">
                                        {data.toryx.total}
                                    </div>
                                </div>
                            </div>

                            {/* 结论 */}
                            <div className="text-center pt-6 border-t border-white/10">
                                <div className="text-2xl font-bold text-white">
                                    {data.improvement}
                                </div>
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>
            </div>
        </div>
    );
}
