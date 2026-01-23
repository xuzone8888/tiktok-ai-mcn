"use client";

import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { comparisonData } from "../data/landing-data";

export default function WhyUsSection() {
    return (
        <section className="relative z-10 py-24">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        更聪明的选择
                    </h2>
                    <p className="text-gray-500 text-lg">降维打击，效率碾压</p>
                </div>

                {/* 对比表 */}
                <div className="max-w-4xl mx-auto">
                    <ReflectiveCard className="!rounded-3xl">
                        <div className="p-8">
                            {/* 传统模式 */}
                            <div className="mb-8 pb-8 border-b border-white/10">
                                <div className="text-sm text-gray-500 uppercase tracking-widest mb-4">
                                    {comparisonData.traditional.label}
                                </div>
                                <div className="flex items-center gap-4 flex-wrap">
                                    {comparisonData.traditional.steps.map((step, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400">
                                                {step}
                                            </div>
                                            {index < comparisonData.traditional.steps.length - 1 && (
                                                <span className="text-gray-600">+</span>
                                            )}
                                        </div>
                                    ))}
                                    <span className="text-gray-600">=</span>
                                    <div className="px-6 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-300 font-mono font-bold text-xl">
                                        {comparisonData.traditional.total}
                                    </div>
                                </div>
                            </div>

                            {/* ToryX */}
                            <div className="mb-8">
                                <div className="text-sm text-gray-500 uppercase tracking-widest mb-4">
                                    {comparisonData.toryx.label}
                                </div>
                                <div className="flex items-center gap-4 flex-wrap">
                                    {comparisonData.toryx.steps.map((step, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
                                                {step}
                                            </div>
                                            {index < comparisonData.toryx.steps.length - 1 && (
                                                <span className="text-gray-600">+</span>
                                            )}
                                        </div>
                                    ))}
                                    <span className="text-gray-600">=</span>
                                    <div className="px-6 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 font-mono font-bold text-xl">
                                        {comparisonData.toryx.total}
                                    </div>
                                </div>
                            </div>

                            {/* 结论 */}
                            <div className="text-center pt-6 border-t border-white/10">
                                <div className="text-2xl font-bold text-white">
                                    {comparisonData.improvement}
                                </div>
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>
            </div>
        </section>
    );
}
