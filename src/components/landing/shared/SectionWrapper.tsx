'use client';

import { ReactNode } from 'react';

interface SectionWrapperProps {
    /** 板块 ID (用于锚点导航) */
    id: string;
    /** 板块标题 */
    title?: string;
    /** 板块副标题 */
    subtitle?: string;
    /** 是否全宽 (默认有 max-w-7xl 限制) */
    fullWidth?: boolean;
    /** 额外的 className */
    className?: string;
    /** 子内容 */
    children: ReactNode;
}

/**
 * SectionWrapper - 板块容器组件
 * 
 * 统一的板块布局：
 * - 垂直 padding
 * - 水平居中
 * - 标题/副标题样式
 */
export const SectionWrapper = ({
    id,
    title,
    subtitle,
    fullWidth = false,
    className = '',
    children
}: SectionWrapperProps) => {
    return (
        <section
            id={id}
            className={`py-24 md:py-32 ${className}`}
        >
            <div className={fullWidth ? '' : 'max-w-7xl mx-auto px-6'}>
                {/* 标题区域 */}
                {(title || subtitle) && (
                    <div className="text-center mb-16">
                        {title && (
                            <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4">
                                {title}
                            </h2>
                        )}
                        {subtitle && (
                            <p className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto">
                                {subtitle}
                            </p>
                        )}
                    </div>
                )}

                {/* 内容区域 */}
                {children}
            </div>
        </section>
    );
};

export default SectionWrapper;
