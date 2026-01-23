"use client";

import { useEffect, useState, useRef } from "react";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { liveStats } from "../data/landing-data";

// 解析数字字符串（如 "28,942"）为数字
function parseStatValue(value: string): number {
    return parseInt(value.replace(/,/g, ""), 10);
}

// 格式化数字为带逗号的字符串
function formatNumber(num: number): string {
    return num.toLocaleString("en-US");
}

// CountUp Hook
function useCountUp(target: number, duration: number = 2000) {
    const [count, setCount] = useState(0);
    const [hasStarted, setHasStarted] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !hasStarted) {
                    setHasStarted(true);
                }
            },
            { threshold: 0.3 }
        );

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => observer.disconnect();
    }, [hasStarted]);

    useEffect(() => {
        if (!hasStarted) return;

        const startTime = Date.now();
        const endTime = startTime + duration;

        const tick = () => {
            const now = Date.now();
            const progress = Math.min((now - startTime) / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));

            if (now < endTime) {
                requestAnimationFrame(tick);
            } else {
                setCount(target);
            }
        };

        requestAnimationFrame(tick);
    }, [hasStarted, target, duration]);

    return { count, ref };
}

export default function LiveStatsSection() {
    return (
        <section className="relative z-10 py-24 bg-gradient-to-b from-transparent via-white/[0.01] to-transparent">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">
                        实时数据
                    </div>
                    <h2 className="text-4xl md:text-5xl font-bold text-white">
                        运转中的 AI 工厂
                    </h2>
                </div>

                {/* 统计卡片 */}
                <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                    {liveStats.map((stat, index) => {
                        const targetValue = parseStatValue(stat.value);
                        const { count, ref } = useCountUp(targetValue, 2000);

                        return (
                            <ReflectiveCard key={index} className="!rounded-2xl" active={true}>
                                <div className="p-8 text-center" ref={ref}>
                                    <stat.icon className="h-8 w-8 text-gray-500 mx-auto mb-4" />
                                    <div className="text-4xl md:text-5xl font-mono font-bold text-white mb-2">
                                        {formatNumber(count)}
                                    </div>
                                    <div className="text-sm text-gray-500 uppercase tracking-wider">
                                        {stat.label}
                                    </div>
                                </div>
                            </ReflectiveCard>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
