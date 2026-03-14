"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import FeatureModelSection from "./FeatureModelSection";
import ModelWallSection from "./ModelWallSection";
import FeatureAiCopySection from "./FeatureAiCopySection";
import GenerationEngineSection from "./GenerationEngineSection";
import MatrixSection from "./MatrixSection";
import WhyUsSection from "./WhyUsSection";
import LiveStatsSection from "./LiveStatsSection";

// ============================================
// Tab 配置
// ============================================

const tabs = [
    { id: "character-engine", label: "角色引擎", shortLabel: "角色" },
    { id: "content-creation", label: "内容创作", shortLabel: "内容" },
    { id: "efficiency-compliance", label: "效率与合规", shortLabel: "信任" },
] as const;

type TabId = (typeof tabs)[number]["id"];

// ============================================
// StickyTabNav 组件
// ============================================

export default function StickyTabNav() {
    const [activeTab, setActiveTab] = useState<TabId>("character-engine");

    // 3 个 section 的 ref
    const sectionRefs = useRef<Record<TabId, HTMLElement | null>>({
        "character-engine": null,
        "content-creation": null,
        "efficiency-compliance": null,
    });

    // IntersectionObserver 监听
    useEffect(() => {
        const entries = new Map<TabId, number>();

        const observer = new IntersectionObserver(
            (observerEntries) => {
                observerEntries.forEach((entry) => {
                    const id = entry.target.id as TabId;
                    entries.set(id, entry.intersectionRatio);
                });

                // 取 intersectionRatio 最大的 section
                let maxRatio = 0;
                let maxId: TabId = "character-engine";
                entries.forEach((ratio, id) => {
                    if (ratio > maxRatio) {
                        maxRatio = ratio;
                        maxId = id;
                    }
                });

                if (maxRatio > 0) {
                    setActiveTab(maxId);
                }
            },
            {
                threshold: [0, 0.1, 0.25, 0.5],
                rootMargin: "-65px 0px -30% 0px",
            }
        );

        // 注册观察
        Object.values(sectionRefs.current).forEach((el) => {
            if (el) observer.observe(el);
        });

        return () => observer.disconnect();
    }, []);

    // 点击 Tab 跳转
    const handleTabClick = useCallback((tabId: TabId) => {
        setActiveTab(tabId);
        const el = sectionRefs.current[tabId];
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, []);

    // ref 回调
    const setSectionRef = useCallback(
        (tabId: TabId) => (el: HTMLElement | null) => {
            sectionRefs.current[tabId] = el;
        },
        []
    );

    return (
        <div>
            {/* ========== Sticky Tab 栏 ========== */}
            <div
                className="z-40 border-b border-white/5 backdrop-blur-xl bg-black/80"
                style={{
                    position: "sticky",
                    // @ts-expect-error -webkit-sticky for iOS Safari
                    WebkitPosition: "sticky",
                    top: "65px",
                }}
            >
                <div className="container max-w-7xl mx-auto px-6">
                    <div className="flex gap-1 overflow-x-auto scrollbar-hide py-1">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => handleTabClick(tab.id)}
                                className={`
                                    px-5 py-3 text-sm font-medium rounded-lg transition-all whitespace-nowrap
                                    ${
                                        activeTab === tab.id
                                            ? "text-white bg-white/10"
                                            : "text-gray-500 hover:text-white hover:bg-white/5"
                                    }
                                `}
                            >
                                {/* 桌面显示完整标签 */}
                                <span className="hidden md:inline">{tab.label}</span>
                                {/* 手机显示短标签 */}
                                <span className="md:hidden">{tab.shortLabel}</span>
                            </button>
                        ))}
                    </div>
                </div>
                {/* 当前 Tab 底部指示条 */}
                <div className="container max-w-7xl mx-auto px-6">
                    <div className="flex gap-1">
                        {tabs.map((tab) => (
                            <div
                                key={tab.id}
                                className={`h-0.5 flex-1 transition-colors duration-300 ${
                                    activeTab === tab.id
                                        ? "bg-white"
                                        : "bg-transparent"
                                }`}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* ========== Section 1: 角色引擎 ========== */}
            <section
                id="character-engine"
                ref={setSectionRef("character-engine")}
                aria-label="角色引擎"
                className="scroll-mt-[120px]"
            >
                <FeatureModelSection />
                <ModelWallSection />
            </section>

            {/* ========== Section 2: 内容创作 ========== */}
            <section
                id="content-creation"
                ref={setSectionRef("content-creation")}
                aria-label="内容创作"
                className="scroll-mt-[120px]"
            >
                <FeatureAiCopySection />
                <GenerationEngineSection />
            </section>

            {/* ========== Section 3: 效率与合规 ========== */}
            <section
                id="efficiency-compliance"
                ref={setSectionRef("efficiency-compliance")}
                aria-label="效率与合规"
                className="scroll-mt-[120px]"
            >
                <MatrixSection />
                <WhyUsSection />
                <LiveStatsSection />
            </section>
        </div>
    );
}
