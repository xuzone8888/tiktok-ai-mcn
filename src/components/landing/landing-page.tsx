"use client";

// ============================================
// Landing Page - 主入口组件
// Titanium V2 Design System
// ============================================

import HeroSection from "./sections/HeroSection";
import FeatureAiCopySection from "./sections/FeatureAiCopySection";
import FeatureModelSection from "./sections/FeatureModelSection";
import ModelWallSection from "./sections/ModelWallSection";
import MatrixSection from "./sections/MatrixSection";
import WhyUsSection from "./sections/WhyUsSection";
import LiveStatsSection from "./sections/LiveStatsSection";
import FaqSection from "./sections/FaqSection";
import CtaSection from "./sections/CtaSection";
import FooterSection from "./sections/FooterSection";

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden">
            {/* 背景层 - Titanium 风格 */}
            <div className="fixed inset-0 pointer-events-none">
                {/* 微妙的网格背景 */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
                {/* 顶部渐变 */}
                <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-b from-white/[0.02] to-transparent" />
            </div>

            {/* 10 个板块 */}
            <HeroSection />
            <FeatureAiCopySection />
            <FeatureModelSection />
            <ModelWallSection />
            <MatrixSection />
            <WhyUsSection />
            <LiveStatsSection />
            <FaqSection />
            <CtaSection />
            <FooterSection />
        </div>
    );
}
