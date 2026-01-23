'use client';

import { InputHTMLAttributes, forwardRef, useState } from 'react';
import { Search } from 'lucide-react';
import './ReflectiveInput.css';

interface ReflectiveInputProps extends InputHTMLAttributes<HTMLInputElement> {
    icon?: React.ReactNode;
    rightElement?: React.ReactNode;
    variant?: 'default' | 'search';
}

/**
 * ReflectiveInput - 钛金风格输入框
 * 
 * 特点：
 * 1. 默认深灰背景，低调。
 * 2. Focus 时产生强烈的白色光晕，模拟"通电"效果。
 * 3. 极细的白色边框。
 */
const ReflectiveInput = forwardRef<HTMLInputElement, ReflectiveInputProps>(
    ({ className = '', icon, rightElement, variant = 'default', onFocus, onBlur, ...props }, ref) => {
        const [isFocused, setIsFocused] = useState(false);

        const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
            setIsFocused(true);
            onFocus?.(e);
        };

        const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
            setIsFocused(false);
            onBlur?.(e);
        };

        return (
            <div
                className={`reflective-input-container ${isFocused ? 'is-focused' : ''} ${className}`}
                data-variant={variant}
            >
                {/* 光晕层 */}
                <div className="input-glow" />

                {/* 边框层 */}
                <div className="input-border" />

                {/* 内容层 */}
                <div className="input-content">
                    {(icon || variant === 'search') && (
                        <div className="input-icon">
                            {icon || <Search size={18} />}
                        </div>
                    )}

                    <input
                        ref={ref}
                        className="input-field"
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        {...props}
                    />

                    {rightElement && (
                        <div className="input-right-element">
                            {rightElement}
                        </div>
                    )}
                </div>
            </div>
        );
    }
);

ReflectiveInput.displayName = 'ReflectiveInput';

export default ReflectiveInput;
