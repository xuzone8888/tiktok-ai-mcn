'use client';

import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef, useState } from 'react';
import { Search } from 'lucide-react';
import './ReflectiveInput.css';

type InputProps = InputHTMLAttributes<HTMLInputElement>;
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

interface ReflectiveInputBaseProps {
    icon?: React.ReactNode;
    rightElement?: React.ReactNode;
    variant?: 'default' | 'search';
}

type ReflectiveInputProps = ReflectiveInputBaseProps & (
    | ({ as?: 'input' } & InputProps)
    | ({ as: 'textarea' } & TextareaProps)
);

/**
 * ReflectiveInput - 钛金风格输入框
 * 
 * 特点：
 * 1. 默认深灰背景，低调。
 * 2. Focus 时产生强烈的白色光晕，模拟"通电"效果。
 * 3. 极细的白色边框。
 * 4. 支持 input 和 textarea 两种模式 (via `as` prop)
 */
const ReflectiveInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, ReflectiveInputProps>(
    ({ className = '', icon, rightElement, variant = 'default', as = 'input', ...props }, ref) => {
        const [isFocused, setIsFocused] = useState(false);

        const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            setIsFocused(true);
            (props as any).onFocus?.(e);
        };

        const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            setIsFocused(false);
            (props as any).onBlur?.(e);
        };

        const Component = as;

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

                    {as === 'textarea' ? (
                        <textarea
                            ref={ref as React.Ref<HTMLTextAreaElement>}
                            className="input-field textarea-field"
                            onFocus={handleFocus as any}
                            onBlur={handleBlur as any}
                            {...(props as TextareaProps)}
                        />
                    ) : (
                        <input
                            ref={ref as React.Ref<HTMLInputElement>}
                            className="input-field"
                            onFocus={handleFocus as any}
                            onBlur={handleBlur as any}
                            {...(props as InputProps)}
                        />
                    )}

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

