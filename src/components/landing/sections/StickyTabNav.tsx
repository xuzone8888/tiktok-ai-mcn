"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useLang } from "@/contexts/LangContext";
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

const tabsZh = [
    { id: "character-engine",     label: "角色引擎",  shortLabel: "角色" },
    { id: "content-creation",     label: "内容创作",  shortLabel: "内容" },
    { id: "efficiency-compliance", label: "效率与合规", shortLabel: "信任" },
] as const;

const tabsEn = [
    { id: "character-engine",     label: "Character Engine",       shortLabel: "Engine"    },
    { id: "content-creation",     label: "Content Creation",       shortLabel: "Content"   },
    { id: "efficiency-compliance", label: "Efficiency & Compliance", shortLabel: "Trust"    },
] as const;

type TabId = (typeof tabsZh)[number]["id"];



// ============================================
// StickyTabNav 组件
// ============================================

export default function StickyTabNav() {
    const { lang } = useLang();
    const tabs = lang === "en" ? tabsEn : tabsZh;
    const [activeTab, setActiveTab] = useState<TabId>("character-engine");
    const [isStuck, setIsStuck] = useState(false);
    const tabBarRef = useRef<HTMLDivElement>(null);

    // 3 个 section 的 ref
    const sectionRefs = useRef<Record<TabId, HTMLElement | null>>({
        "character-engine": null,
        "content-creation": null,
        "efficiency-compliance": null,
    });

    // 检测 Tab 栏是否已吸顶
    useEffect(() => {
        const handleScroll = () => {
            if (tabBarRef.current) {
                const rect = tabBarRef.current.getBoundingClientRect();
                setIsStuck(rect.top <= 66);
            }
        };
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

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
                ref={tabBarRef}
                className={`z-40 border-b transition-all duration-300 ${
                    isStuck
                        ? "border-white/5 backdrop-blur-xl bg-[#0a0a0f]/80"
                        : "border-transparent bg-transparent"
                }`}
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
            </div>

            {/* FeatureModelSection 在 Tab Section 之前 */}
            <FeatureModelSection />

            {/* ========== Section 1: 角色引擎 → "你的角色，千变万化" ========== */}
            <section
                id="character-engine"
                ref={setSectionRef("character-engine")}
                aria-label="角色引擎"
                className="scroll-mt-[120px]"
            >
                <ModelWallSection />
                <FeatureAiCopySection />
            </section>

            {/* ========== Section 2: 内容创作 → "从灵感到成品，极速出片" ========== */}
            <section
                id="content-creation"
                ref={setSectionRef("content-creation")}
                aria-label="内容创作"
                className="scroll-mt-[120px]"
            >
                <GenerationEngineSection />
                <MatrixSection />
                <WhyUsSection />
            </section>

            {/* ========== Section 3: 效率与合规 → "做合规的创作者，走得更远" ========== */}
            <section
                id="efficiency-compliance"
                ref={setSectionRef("efficiency-compliance")}
                aria-label="效率与合规"
                className="scroll-mt-[120px]"
            >
                <LiveStatsSection />
            </section>
        </div>
    );
}
