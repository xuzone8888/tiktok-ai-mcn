'use client';

import { useEffect, useState, useRef } from 'react';

interface AnimatedCounterProps {
    /** 目标数值 */
    end: number;
    /** 动画时长 (ms) */
    duration?: number;
    /** 前缀 (如 "+") */
    prefix?: string;
    /** 后缀 (如 "%", " Views") */
    suffix?: string;
    /** 千分位分隔符 */
    separator?: boolean;
    /** 额外的 className */
    className?: string;
}

/**
 * AnimatedCounter - 动态数字计数器
 * 
 * 特点：
 * - IntersectionObserver 触发 (进入视口时开始)
 * - 平滑的数字滚动动画
 * - 支持千分位分隔符
 */
export const AnimatedCounter = ({
    end,
    duration = 2000,
    prefix = '',
    suffix = '',
    separator = false,
    className = ''
}: AnimatedCounterProps) => {
    const [count, setCount] = useState(0);
    const [hasAnimated, setHasAnimated] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !hasAnimated) {
                    setHasAnimated(true);
                    animateCount();
                }
            },
            { threshold: 0.3 }
        );

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => observer.disconnect();
    }, [hasAnimated]);

    const animateCount = () => {
        const startTime = Date.now();
        const startValue = 0;

        const tick = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const currentValue = Math.floor(startValue + (end - startValue) * easeOut);

            setCount(currentValue);

            if (progress < 1) {
                requestAnimationFrame(tick);
            }
        };

        requestAnimationFrame(tick);
    };

    const formatNumber = (num: number): string => {
        if (separator) {
            return num.toLocaleString('en-US');
        }
        return num.toString();
    };

    return (
        <span
            ref={ref}
            className={`font-mono text-5xl md:text-6xl font-bold tabular-nums ${className}`}
        >
            {prefix}{formatNumber(count)}{suffix}
        </span>
    );
};

export default AnimatedCounter;
