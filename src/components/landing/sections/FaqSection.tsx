"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { faqItems, faqItemsEn } from "../data/landing-data";
import { useLang } from "@/contexts/LangContext";

export default function FaqSection() {
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const { lang } = useLang();
    const faqs = lang === "en" ? faqItemsEn : faqItems;

    return (
        <section className="relative z-10 py-24">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        {lang === "en" ? "Frequently Asked Questions" : "常见问题"}
                    </h2>
                    <p className="text-gray-500 text-lg">
                        {lang === "en" ? "Clear up your doubts" : "消除您的疑虑"}
                    </p>
                </div>

                {/* FAQ 列表 */}
                <div className="max-w-3xl mx-auto space-y-4">
                    {faqs.map((item, index) => (
                        <ReflectiveCard
                            key={index}
                            className="!rounded-xl cursor-pointer"
                        >
                            <div
                                onClick={() =>
                                    setOpenIndex(openIndex === index ? null : index)
                                }
                            >
                                {/* 问题 */}
                                <div className="flex items-center justify-between p-6">
                                    <span className="text-white font-medium">{item.question}</span>
                                    <ChevronDown
                                        className={`h-5 w-5 text-gray-400 transition-transform ${openIndex === index ? "rotate-180" : ""
                                            }`}
                                    />
                                </div>

                                {/* 答案 */}
                                {openIndex === index && (
                                    <div className="px-6 pb-6 pt-0 border-t border-white/10">
                                        <p className="text-gray-400 pt-4">{item.answer}</p>
                                    </div>
                                )}
                            </div>
                        </ReflectiveCard>
                    ))}
                </div>
            </div>
        </section>
    );
}
