'use client';

import { CSSProperties, ReactNode, useRef, useState, useCallback } from 'react';
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
    /** 是否激活（脉冲效果） */
    active?: boolean;
    /** 是否启用鼠标跟踪高光 */
    enableMouseTracking?: boolean;
    /** 子内容 */
    children?: ReactNode;
}

/**
 * ReflectiveCard - 反光卡片组件
 * 带鼠标跟踪高光效果
 */
const ReflectiveCard = ({
    metalness = 1,
    roughness = 0.4,
    overlayColor = 'rgba(255, 255, 255, 0.1)',
    color = '#ffffff',
    width,
    height,
    active = false,
    enableMouseTracking = false,
    className = '',
    style = {},
    children
}: ReflectiveCardProps) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
    const [isHovering, setIsHovering] = useState(false);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!cardRef.current || !enableMouseTracking) return;

        const rect = cardRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        setMousePos({ x, y });
    }, [enableMouseTracking]);

    const handleMouseEnter = useCallback(() => {
        setIsHovering(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
        setIsHovering(false);
        setMousePos({ x: 50, y: 50 }); // Reset to center
    }, []);

    const cssVariables = {
        '--metalness': metalness,
        '--roughness': roughness,
        '--overlay-color': overlayColor,
        '--text-color': color,
        '--mouse-x': `${mousePos.x}%`,
        '--mouse-y': `${mousePos.y}%`,
    } as CSSProperties;

    const sizeStyle: CSSProperties = {
        ...(width && { width: typeof width === 'number' ? `${width}px` : width }),
        ...(height && { height: typeof height === 'number' ? `${height}px` : height }),
    };

    return (
        <div
            ref={cardRef}
            className={`reflective-card-container ${active ? 'is-active' : ''} ${isHovering ? 'is-hovering' : ''} ${className}`}
            style={{ ...style, ...cssVariables, ...sizeStyle }}
            onMouseMove={handleMouseMove}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* 噪点纹理层 */}
            <div className="reflective-noise" />

            {/* 鼠标跟踪高光层 */}
            {enableMouseTracking && (
                <div className="reflective-mouse-highlight" />
            )}

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
