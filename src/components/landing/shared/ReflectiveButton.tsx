'use client';

import { ReactNode, ButtonHTMLAttributes } from 'react';
import Link from 'next/link';
import './ReflectiveButton.css';

interface ReflectiveButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** 按钮变体 */
    variant?: 'primary' | 'ghost';
    /** 按钮尺寸 */
    size?: 'sm' | 'md' | 'lg';
    /** 链接地址 (如果提供则渲染为 Link) */
    href?: string;
    /** 子内容 */
    children: ReactNode;
}

/**
 * ReflectiveButton - 反光按钮组件
 * 
 * 基于 Reflective Card 设计系统
 * - primary: 实心按钮，带噪点+光泽
 * - ghost: 透明按钮，带渐变边框
 */
export const ReflectiveButton = ({
    variant = 'primary',
    size = 'md',
    href,
    children,
    className = '',
    ...props
}: ReflectiveButtonProps) => {
    const baseClass = `reflective-button reflective-button-${variant} reflective-button-${size} ${className}`;

    if (href) {
        return (
            <Link href={href} className={baseClass}>
                {children}
            </Link>
        );
    }

    return (
        <button className={baseClass} {...props}>
            {children}
        </button>
    );
};

export default ReflectiveButton;
