'use client';

import { CSSProperties, ReactNode } from 'react';
import './ReflectiveCard.css';

interface ReflectiveCardProps {
    /** 金属光泽不透明度 (0-1) */
    metalness?: number;
    /** 噪点层不透明度 (0-1) */
    roughness?: number;
    /** 内容背景遮罩颜色 */
    overlayColor?: string;
    /** 文字颜色 */
    color?: string;
    /** 自定义宽度 */
    width?: string | number;
    /** 自定义高度 */
    height?: string | number;
    /** 额外的 className */
    className?: string;
    /** 额外的 style */
    style?: CSSProperties;
    /** 子内容 */
    /** 是否激活（脉冲效果） */
    active?: boolean;
    children?: ReactNode;
}

/**
 * ReflectiveCard - 反光卡片组件
 * ...
 */
const ReflectiveCard = ({
    metalness = 1,
    roughness = 0.5,
    overlayColor = 'rgba(255, 255, 255, 0.08)',
    color = '#ffffff',
    width,
    height,
    active = false,
    className = '',
    style = {},
    children
}: ReflectiveCardProps) => {

    const cssVariables = {
        '--metalness': metalness,
        '--roughness': roughness,
        '--overlay-color': overlayColor,
        '--text-color': color,
    } as CSSProperties;

    const sizeStyle: CSSProperties = {
        ...(width && { width: typeof width === 'number' ? `${width}px` : width }),
        ...(height && { height: typeof height === 'number' ? `${height}px` : height }),
    };

    return (
        <div
            className={`reflective-card-container ${active ? 'is-active' : ''} ${className}`}
            style={{ ...style, ...cssVariables, ...sizeStyle }}
        >
            {/* 噪点纹理层 */}
            <div className="reflective-noise" />

            {/* 金属光泽层 */}
            <div className="reflective-sheen" />

            {/* 渐变边框层 */}
            <div className="reflective-border" />

            {/* 内容层 */}
            <div className="reflective-content">
                {children}
            </div>
        </div>
    );
};

export default ReflectiveCard;
