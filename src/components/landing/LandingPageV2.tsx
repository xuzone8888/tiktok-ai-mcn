'use client';

import {
    HeroSection,
    FeatureAiCopySection,
    FeatureModelSection,
    ModelWallSection,
    MatrixSection,
    WhyUsSection,
    LiveStatsSection,
    FaqSection,
    CtaSection,
    FooterSection,
} from './sections';

/**
 * LandingPageV2 - 首页主组件
 * Titanium V2 Design System
 * 
 * 10 板块完整组装：
 * 1. Hero - 主视觉 (Reflective Card 输入框)
 * 2. FeatureAiCopy - AI 懂带货
 * 3. FeatureModel - 省钱对比 (AI 模特)
 * 4. ModelWall - 数字人墙
 * 5. Matrix - 矩阵仪表盘
 * 6. WhyUs - 效率对比
 * 7. LiveStats - 实时数据
 * 8. FAQ - 常见问题
 * 9. CTA - 转化区域
 * 10. Footer - 页脚
 */
export const LandingPageV2 = () => {
    return (
        <div className="bg-black text-white min-h-screen overflow-hidden">
            {/* 背景装饰 - Titanium 风格 */}
            <div className="fixed inset-0 pointer-events-none">
                {/* 微妙的网格背景 */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
                {/* 顶部渐变 */}
                <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-b from-white/[0.02] to-transparent" />
            </div>

            {/* 主要内容 */}
            <main className="relative z-10">
                {/* 第 1 屏：Hero */}
                <HeroSection />

                {/* 第 2 屏：AI 懂带货 */}
                <FeatureAiCopySection />

                {/* 第 3 屏：省钱对比 */}
                <FeatureModelSection />

                {/* 第 4 屏：AI 模特墙 */}
                <ModelWallSection />

                {/* 第 5 屏：矩阵仪表盘 */}
                <MatrixSection />

                {/* 第 6 屏：效率对比 */}
                <WhyUsSection />

                {/* 第 7 屏：实时数据 */}
                <LiveStatsSection />

                {/* 第 8 屏：FAQ */}
                <FaqSection />

                {/* 第 9 屏：CTA */}
                <CtaSection />

                {/* 第 10 屏：Footer */}
                <FooterSection />
            </main>
        </div>
    );
};

export default LandingPageV2;
