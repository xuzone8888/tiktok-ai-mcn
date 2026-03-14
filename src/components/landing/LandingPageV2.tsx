'use client';

import {
    HeroSection,
    StickyTabNav,
    FaqSection,
    CtaSection,
    FooterSection,
} from './sections';

/**
 * LandingPageV2 - 首页主组件
 * Titanium V2 Design System
 * 
 * 5 层结构（角色驱动 · 内容为本）：
 * 1. Hero - 主视觉 + 场景轮播
 * 2. StickyTabNav - 吸顶 Tab 导航 + 3 个内容分区
 *    ├─ 角色引擎 (FeatureModel + ModelWall)
 *    ├─ 内容创作 (FeatureAiCopy + GenerationEngine)
 *    └─ 效率与合规 (Matrix + WhyUs + LiveStats)
 * 3. FAQ - 常见问题
 * 4. CTA - 转化区域
 * 5. Footer - 页脚
 */
export const LandingPageV2 = () => {
    return (
        <div className="bg-black text-white min-h-screen relative">
            {/* 背景装饰 - Titanium 风格 */}
            <div className="fixed inset-0 pointer-events-none">
                {/* 微妙的网格背景 */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
                {/* 顶部渐变 */}
                <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-b from-white/[0.02] to-transparent" />
            </div>

            {/* --- 渐变光晕 (Gradient Orbs) --- */}
            {/* 独立 overflow-hidden 容器，完美避免破坏主容器内 sticky 导航的吸顶效果 */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                {/* 1. Hero 区域：紫偏蓝，科技与创意 */}
                <div 
                    className="absolute top-0 right-0 w-[900px] h-[900px] translate-x-[30%] -translate-y-[20%] mix-blend-screen"
                    style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, rgba(168,85,247,0) 60%)' }} // purple-500
                />
                
                {/* 2. Hero 左侧辅助：深蓝，增加层次 */}
                <div 
                    className="absolute top-[5%] left-0 w-[800px] h-[800px] -translate-x-[40%] translate-y-[10%] mix-blend-screen"
                    style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0) 60%)' }} // blue-500
                />

                {/* 3. 角色/合规区域 (35%)：翠绿色调，呼应组件里的 emerald 主题色 */}
                <div 
                    className="absolute top-[35%] right-0 w-[800px] h-[800px] translate-x-[30%] mix-blend-screen"
                    style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0) 60%)' }} // emerald-500
                />

                {/* 4. 工坊/功能区域 (60%)：偏紫与天蓝 */}
                <div 
                    className="absolute top-[60%] left-0 w-[700px] h-[700px] -translate-x-[30%] mix-blend-screen"
                    style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, rgba(99,102,241,0) 60%)' }} // indigo-500
                />

                {/* 5. 底部 CTA：品红粉，情绪放大，促转化 */}
                <div 
                    className="absolute bottom-0 right-0 w-[800px] h-[800px] translate-x-[30%] translate-y-[20%] mix-blend-screen"
                    style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.15) 0%, rgba(236,72,153,0) 60%)' }} // pink-500
                />
            </div>

            {/* 主要内容 */}
            <main className="relative z-10">
                {/* 第 1 层：Hero */}
                <HeroSection />

                {/* 第 2 层：Sticky Tab (角色引擎 / 内容创作 / 效率与合规) */}
                <StickyTabNav />

                {/* 第 3 层：FAQ */}
                <FaqSection />

                {/* 第 4 层：CTA */}
                <CtaSection />

                {/* 第 5 层：Footer */}
                <FooterSection />
            </main>
        </div>
    );
};

export default LandingPageV2;
