"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X, Sparkles, Zap, Crown, Building2 } from "lucide-react";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import {
    pricingPlans,
    creditPackages,
    featureComparison,
    pricingFaqs,
    marketingCopy,
} from "../data/pricing-data";

export default function PricingSection() {
    const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
    const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

    const getPlanIcon = (planId: string) => {
        switch (planId) {
            case "free":
                return <Sparkles className="w-6 h-6" />;
            case "creator":
                return <Zap className="w-6 h-6" />;
            case "pro":
                return <Crown className="w-6 h-6" />;
            case "enterprise":
                return <Building2 className="w-6 h-6" />;
            default:
                return <Sparkles className="w-6 h-6" />;
        }
    };

    return (
        <section className="relative z-10 py-24">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题区 */}
                <div className="text-center mb-16">
                    <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
                        {marketingCopy.hero.title}
                    </h1>
                    <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto">
                        {marketingCopy.hero.subtitle}
                    </p>

                    {/* 月付/年付切换 */}
                    <div className="mt-8 inline-flex items-center gap-4 p-1 bg-white/5 rounded-xl border border-white/10">
                        <button
                            onClick={() => setBillingCycle("monthly")}
                            className={`px-6 py-2 rounded-lg font-medium transition-all ${billingCycle === "monthly"
                                    ? "bg-white text-black"
                                    : "text-gray-400 hover:text-white"
                                }`}
                        >
                            月付
                        </button>
                        <button
                            onClick={() => setBillingCycle("yearly")}
                            className={`px-6 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${billingCycle === "yearly"
                                    ? "bg-white text-black"
                                    : "text-gray-400 hover:text-white"
                                }`}
                        >
                            年付
                            <span className="text-xs px-2 py-0.5 bg-emerald-500 text-white rounded-full">
                                省20%
                            </span>
                        </button>
                    </div>
                </div>

                {/* 套餐卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
                    {pricingPlans.map((plan) => (
                        <ReflectiveCard
                            key={plan.id}
                            className={`!rounded-2xl relative ${plan.recommended ? "ring-2 ring-emerald-500/50" : ""
                                }`}
                            active={plan.recommended}
                        >
                            <div className="p-6 flex flex-col h-full">
                                {/* 推荐标签 */}
                                {plan.recommended && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                        <span className="px-4 py-1 bg-emerald-500 text-white text-sm font-medium rounded-full">
                                            最受欢迎
                                        </span>
                                    </div>
                                )}

                                {/* 图标和名称 */}
                                <div className="flex items-center gap-3 mb-4">
                                    <div
                                        className={`p-2 rounded-lg ${plan.recommended
                                                ? "bg-emerald-500/20 text-emerald-400"
                                                : "bg-white/10 text-white"
                                            }`}
                                    >
                                        {getPlanIcon(plan.id)}
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                                        <p className="text-sm text-gray-500">{plan.subtitle}</p>
                                    </div>
                                </div>

                                {/* 价格 */}
                                <div className="mb-6">
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-gray-400">¥</span>
                                        <span className="text-4xl font-bold text-white font-mono">
                                            {billingCycle === "monthly"
                                                ? plan.monthlyPrice
                                                : plan.yearlyPrice}
                                        </span>
                                        <span className="text-gray-500">/月</span>
                                    </div>
                                    {billingCycle === "yearly" && plan.monthlyPrice > 0 && (
                                        <p className="text-sm text-gray-500 mt-1">
                                            年付 ¥{plan.yearlyPrice * 12}
                                            <span className="text-emerald-400 ml-2">
                                                省 ¥{(plan.monthlyPrice - plan.yearlyPrice) * 12}
                                            </span>
                                        </p>
                                    )}
                                </div>

                                {/* 功能列表 */}
                                <ul className="space-y-3 flex-1 mb-6">
                                    {plan.features.map((feature, idx) => (
                                        <li key={idx} className="flex items-start gap-2 text-sm text-gray-300">
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                    {plan.limitations?.map((limit, idx) => (
                                        <li key={`limit-${idx}`} className="flex items-start gap-2 text-sm text-gray-500">
                                            <span>{limit}</span>
                                        </li>
                                    ))}
                                </ul>

                                {/* CTA 按钮 */}
                                <Link href={plan.ctaLink} className="block">
                                    <button
                                        className={`w-full py-3 rounded-xl font-medium transition-all ${plan.recommended
                                                ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-white hover:from-emerald-300 hover:to-emerald-500 shadow-lg shadow-emerald-500/20"
                                                : plan.id === "free"
                                                    ? "bg-white text-black hover:bg-gray-100"
                                                    : "bg-white/10 text-white border border-white/20 hover:bg-white/20"
                                            }`}
                                    >
                                        {plan.cta}
                                    </button>
                                </Link>
                            </div>
                        </ReflectiveCard>
                    ))}
                </div>

                {/* 积分充值区 */}
                <div className="mb-20">
                    <div className="text-center mb-10">
                        <h2 className="text-3xl font-bold text-white mb-2">积分充值</h2>
                        <p className="text-gray-400">
                            会员积分用完？随时补充，买得越多越划算
                        </p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                        {creditPackages.map((pkg) => (
                            <ReflectiveCard
                                key={pkg.id}
                                className={`!rounded-xl cursor-pointer hover:scale-105 transition-transform ${pkg.popular ? "ring-2 ring-amber-500/50" : ""
                                    }`}
                            >
                                <div className="p-4 text-center relative">
                                    {/* 徽章 */}
                                    {(pkg.badge || pkg.popular) && (
                                        <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                                            <span
                                                className={`px-2 py-0.5 text-xs font-medium rounded-full ${pkg.popular
                                                        ? "bg-amber-500 text-white"
                                                        : "bg-blue-500 text-white"
                                                    }`}
                                            >
                                                {pkg.popular ? "最受欢迎" : pkg.badge}
                                            </span>
                                        </div>
                                    )}

                                    {/* 积分数 */}
                                    <div className="text-2xl font-bold text-white font-mono mt-2">
                                        {pkg.credits.toLocaleString()}
                                    </div>
                                    <div className="text-xs text-gray-500 mb-3">积分</div>

                                    {/* 价格 */}
                                    <div className="text-lg font-bold text-white">
                                        ¥{pkg.price}
                                    </div>
                                    {pkg.discount && (
                                        <div className="text-xs text-emerald-400">{pkg.discount}</div>
                                    )}
                                    {pkg.originalPrice && pkg.originalPrice > pkg.price && (
                                        <div className="text-xs text-gray-600 line-through">
                                            ¥{pkg.originalPrice}
                                        </div>
                                    )}
                                </div>
                            </ReflectiveCard>
                        ))}
                    </div>
                </div>

                {/* 功能对比表 */}
                <div className="mb-20">
                    <div className="text-center mb-10">
                        <h2 className="text-3xl font-bold text-white mb-2">功能对比</h2>
                        <p className="text-gray-400">详细了解各套餐包含的功能</p>
                    </div>

                    <ReflectiveCard className="!rounded-2xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/10">
                                        <th className="text-left p-4 text-gray-400 font-medium">功能</th>
                                        <th className="p-4 text-center text-white font-medium">免费版</th>
                                        <th className="p-4 text-center text-white font-medium">创作者</th>
                                        <th className="p-4 text-center text-emerald-400 font-medium">
                                            专业版 ⭐
                                        </th>
                                        <th className="p-4 text-center text-white font-medium">企业版</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {featureComparison.categories.map((category, catIdx) => (
                                        <>
                                            <tr key={`cat-${catIdx}`} className="bg-white/5">
                                                <td
                                                    colSpan={5}
                                                    className="p-3 text-sm font-medium text-gray-400 uppercase tracking-wider"
                                                >
                                                    {category.name}
                                                </td>
                                            </tr>
                                            {category.features.map((feature, featIdx) => (
                                                <tr
                                                    key={`feat-${catIdx}-${featIdx}`}
                                                    className="border-b border-white/5 hover:bg-white/5"
                                                >
                                                    <td className="p-4 text-gray-300">{feature.name}</td>
                                                    <td className="p-4 text-center">
                                                        {renderFeatureValue(feature.free)}
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        {renderFeatureValue(feature.creator)}
                                                    </td>
                                                    <td className="p-4 text-center bg-emerald-500/5">
                                                        {renderFeatureValue(feature.pro)}
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        {renderFeatureValue(feature.enterprise)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </ReflectiveCard>
                </div>

                {/* 成本对比 */}
                <div className="mb-20">
                    <ReflectiveCard className="!rounded-2xl">
                        <div className="p-8 md:p-12">
                            <div className="text-center mb-8">
                                <h2 className="text-3xl font-bold text-white mb-2">
                                    {marketingCopy.comparison.title}
                                </h2>
                            </div>

                            <div className="grid md:grid-cols-3 gap-8 items-center">
                                {/* 传统方式 */}
                                <div className="text-center">
                                    <div className="text-sm text-gray-500 uppercase tracking-wider mb-4">
                                        {marketingCopy.comparison.traditional.label}
                                    </div>
                                    <div className="text-4xl font-bold text-gray-400 font-mono mb-4">
                                        {marketingCopy.comparison.traditional.cost}
                                    </div>
                                    <div className="space-y-2">
                                        {marketingCopy.comparison.traditional.items.map((item, idx) => (
                                            <div key={idx} className="text-gray-500">
                                                {item}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* VS */}
                                <div className="text-center">
                                    <div className="text-6xl font-bold text-gray-700">VS</div>
                                </div>

                                {/* AI 方式 */}
                                <div className="text-center">
                                    <div className="text-sm text-emerald-400 uppercase tracking-wider mb-4">
                                        {marketingCopy.comparison.ai.label}
                                    </div>
                                    <div className="text-4xl font-bold text-emerald-400 font-mono mb-4">
                                        {marketingCopy.comparison.ai.cost}
                                    </div>
                                    <div className="space-y-2">
                                        {marketingCopy.comparison.ai.items.map((item, idx) => (
                                            <div key={idx} className="text-gray-300">
                                                {item}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="text-center mt-8">
                                <span className="inline-block px-6 py-3 bg-emerald-500/20 border border-emerald-500/30 rounded-full text-emerald-400 font-bold text-xl">
                                    {marketingCopy.comparison.savings}
                                </span>
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>

                {/* FAQ */}
                <div className="mb-20">
                    <div className="text-center mb-10">
                        <h2 className="text-3xl font-bold text-white mb-2">常见问题</h2>
                    </div>

                    <div className="max-w-3xl mx-auto space-y-4">
                        {pricingFaqs.map((faq, idx) => (
                            <ReflectiveCard key={idx} className="!rounded-xl">
                                <button
                                    onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                                    className="w-full p-5 text-left flex items-center justify-between"
                                >
                                    <span className="font-medium text-white">{faq.question}</span>
                                    <span
                                        className={`text-gray-400 transition-transform ${expandedFaq === idx ? "rotate-180" : ""
                                            }`}
                                    >
                                        ▼
                                    </span>
                                </button>
                                {expandedFaq === idx && (
                                    <div className="px-5 pb-5 text-gray-400">{faq.answer}</div>
                                )}
                            </ReflectiveCard>
                        ))}
                    </div>
                </div>

                {/* 信任标识 */}
                <div className="text-center">
                    <div className="flex flex-wrap items-center justify-center gap-6">
                        {marketingCopy.trust.map((item, idx) => (
                            <span key={idx} className="text-gray-500">
                                {item}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

// 渲染功能值
function renderFeatureValue(value: boolean | string) {
    if (value === true) {
        return <Check className="w-5 h-5 text-emerald-400 mx-auto" />;
    }
    if (value === false) {
        return <X className="w-5 h-5 text-gray-600 mx-auto" />;
    }
    return <span className="text-gray-300 text-sm">{value}</span>;
}
