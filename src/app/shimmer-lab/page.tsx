'use client'

import { useState } from 'react'
import './fold-button.css'
import './ripple-button.css'

// 颜色配置
const colorOptions = [
    {
        name: 'Violet (紫色)',
        id: 'violet',
        primary: '#7a5af8',
        glow: 'rgba(223, 113, 255, 0.8)',
        hex: '#8B5CF6'
    },
    {
        name: 'Blue (蓝色)',
        id: 'blue',
        primary: '#3B82F6',
        glow: 'rgba(59, 130, 246, 0.8)',
        hex: '#3B82F6'
    },
    {
        name: 'Cyan (青色)',
        id: 'cyan',
        primary: '#06B6D4',
        glow: 'rgba(6, 182, 212, 0.8)',
        hex: '#06B6D4'
    },
    {
        name: 'Emerald (翡翠绿)',
        id: 'emerald',
        primary: '#10B981',
        glow: 'rgba(16, 185, 129, 0.8)',
        hex: '#10B981'
    },
    {
        name: 'Rose (玫瑰红)',
        id: 'rose',
        primary: '#F43F5E',
        glow: 'rgba(244, 63, 94, 0.8)',
        hex: '#F43F5E'
    },
    {
        name: 'Amber (琥珀橙)',
        id: 'amber',
        primary: '#F59E0B',
        glow: 'rgba(245, 158, 11, 0.8)',
        hex: '#F59E0B'
    },
]

type ButtonType = 'white' | 'glow' | 'shimmer' | 'fold' | 'ripple'

export default function ShimmerButtonLabPage() {
    const [selectedColor, setSelectedColor] = useState('violet')
    const [activeTab, setActiveTab] = useState<ButtonType>('white')

    const tabConfig = {
        white: { label: '⚪ 主页原版', desc: '纯白发光 (不带颜色)' },
        glow: { label: '🌟 Glow', desc: '白色发光 + 彩色光晕' },
        shimmer: { label: '✨ Shimmer', desc: '光条扫过效果' },
        fold: { label: '📄 Fold', desc: '折角 + 上升粒子' },
        ripple: { label: '🌊 Ripple', desc: '深色高级 + 圆形波纹' }
    }

    const renderButton = (type: ButtonType, color: string, size: 'sm' | 'default' | 'lg', children: React.ReactNode) => {
        switch (type) {
            case 'white':
                return <WhiteGlowButton size={size}>{children}</WhiteGlowButton>
            case 'glow':
                return <GlowButton color={color} size={size}>{children}</GlowButton>
            case 'shimmer':
                return <ShimmerButton color={color} size={size}>{children}</ShimmerButton>
            case 'fold':
                return <FoldButton color={color} size={size}>{children}</FoldButton>
            case 'ripple':
                return <RippleButton color={color} size={size}>{children}</RippleButton>
        }
    }

    return (
        <div className="min-h-screen bg-gray-950 text-white p-8">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl font-bold mb-2">🧪 Button 实验室</h1>
                <p className="text-gray-400 mb-8">选择按钮类型和颜色，悬停/点击查看动画效果</p>

                {/* 按钮类型切换 */}
                <div className="flex flex-wrap gap-4 mb-8">
                    {(Object.keys(tabConfig) as ButtonType[]).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-6 py-3 rounded-xl font-medium transition-all ${activeTab === tab
                                ? 'bg-white/20 border-white/50'
                                : 'bg-white/5 border-white/10 hover:bg-white/10'
                                } border`}
                        >
                            {tabConfig[tab].label}
                        </button>
                    ))}
                </div>

                {/* 颜色选择器 */}
                <div className="mb-12">
                    <h2 className="text-xl font-semibold mb-4">选择主题色</h2>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                        {colorOptions.map((color) => (
                            <button
                                key={color.id}
                                onClick={() => setSelectedColor(color.id)}
                                className={`p-4 rounded-xl border-2 transition-all ${selectedColor === color.id
                                    ? 'border-white scale-105'
                                    : 'border-white/20 hover:border-white/50'
                                    }`}
                            >
                                <div
                                    className="w-full h-8 rounded-lg mb-2"
                                    style={{ backgroundColor: color.hex }}
                                />
                                <span className="text-xs">{color.name}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 按钮预览 */}
                <div className="space-y-12">
                    {/* 选中的颜色预览 */}
                    <div className="p-8 rounded-2xl bg-white/5 border border-white/10">
                        <h3 className="text-lg font-medium mb-6 text-center">
                            {tabConfig[activeTab].label} - {colorOptions.find(c => c.id === selectedColor)?.name}
                        </h3>

                        <div className="flex flex-wrap justify-center gap-8">
                            {renderButton(activeTab, selectedColor, 'sm', '保存')}
                            {renderButton(activeTab, selectedColor, 'default', '创建发布')}
                            {renderButton(activeTab, selectedColor, 'lg', '立即开始使用')}
                        </div>
                    </div>

                    {/* 所有颜色对比 */}
                    <div>
                        <h2 className="text-xl font-semibold mb-4">
                            {tabConfig[activeTab].label} - 所有颜色对比
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                            {colorOptions.map((color) => (
                                <div key={color.id} className="p-6 rounded-xl bg-white/5 border border-white/10 text-center">
                                    <p className="text-sm text-gray-400 mb-4">{color.name}</p>
                                    {renderButton(activeTab, color.id, 'default', 'Button')}
                                    <p className="text-xs text-gray-500 mt-4 font-mono">{color.hex}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 三种按钮对比 */}
                    <div>
                        <h2 className="text-xl font-semibold mb-4">三种按钮对比</h2>
                        <div className="grid grid-cols-3 gap-6">
                            {(Object.keys(tabConfig) as ButtonType[]).map(type => (
                                <div key={type} className="p-8 rounded-xl bg-white/5 border border-white/10 text-center">
                                    <p className="text-sm text-gray-400 mb-4">{tabConfig[type].label}</p>
                                    {renderButton(type, selectedColor, 'default', '创建发布')}
                                    <p className="text-xs text-gray-500 mt-4">{tabConfig[type].desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 选择结果 */}
                <div className="mt-12 p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                    <h3 className="font-semibold text-emerald-400 mb-2">✅ 确认选择</h3>
                    <p className="text-gray-300">
                        选择 <strong className="text-white">{tabConfig[activeTab].label}</strong> +
                        <strong className="text-white"> {colorOptions.find(c => c.id === selectedColor)?.name}</strong> 后，
                        告诉我即可开始全站替换！
                    </p>
                </div>
            </div>
        </div>
    )
}

// ========================
// Shimmer Button 组件
// ========================
function ShimmerButton({
    children,
    color = 'blue',
    size = 'default'
}: {
    children: React.ReactNode
    color?: string
    size?: 'sm' | 'default' | 'lg'
}) {
    const colorConfig = colorOptions.find(c => c.id === color) || colorOptions[0]

    const sizeClasses = {
        sm: 'px-5 py-2.5 text-sm rounded-lg',
        default: 'px-8 py-3.5 text-base rounded-xl',
        lg: 'px-10 py-4 text-lg rounded-2xl'
    }

    const gradientConfig: Record<string, string> = {
        blue: 'bg-gradient-to-b from-blue-400/60 to-blue-600/50',
        cyan: 'bg-gradient-to-b from-cyan-400/60 to-cyan-600/50',
        violet: 'bg-gradient-to-b from-violet-400/60 to-violet-600/50',
        emerald: 'bg-gradient-to-b from-emerald-400/60 to-emerald-600/50',
        rose: 'bg-gradient-to-b from-rose-400/60 to-rose-600/50',
        amber: 'bg-gradient-to-b from-amber-400/60 to-amber-600/50',
    }

    return (
        <button
            className={`group/button relative inline-flex items-center justify-center overflow-hidden ${sizeClasses[size]} ${gradientConfig[color] || gradientConfig.blue} backdrop-blur-lg font-semibold text-white transition-all duration-300 ease-in-out hover:scale-105 border border-white/30`}
            style={{
                boxShadow: `
                    inset 0 1px 0 rgba(255,255,255,0.4),
                    inset 0 -2px 4px rgba(0,0,0,0.15),
                    0 4px 15px rgba(0,0,0,0.25),
                    0 0 25px ${colorConfig.hex}40
                `
            }}
        >
            <span className="relative z-10 drop-shadow-sm">{children}</span>
            <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-13deg)_translateX(-100%)] group-hover/button:duration-1000 group-hover/button:[transform:skew(-13deg)_translateX(100%)]">
                <div className="relative h-full w-12 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
            </div>
        </button>
    )
}

// ========================
// Fold Button 组件 (粒子效果)
// ========================
function FoldButton({
    children,
    color = 'violet',
    size = 'default'
}: {
    children: React.ReactNode
    color?: string
    size?: 'sm' | 'default' | 'lg'
}) {
    const colorConfig = colorOptions.find(c => c.id === color) || colorOptions[0]

    const sizeClasses = {
        sm: 'px-4 py-2.5 text-sm',
        default: 'px-6 py-3',
        lg: 'px-8 py-4 text-lg'
    }

    return (
        <button
            className={`fold-button group ${sizeClasses[size]}`}
            style={{
                '--primary-color': colorConfig.primary,
                '--glow-color': colorConfig.glow,
            } as React.CSSProperties}
        >
            <span className="fold" />
            <span className="points_wrapper">
                {[...Array(10)].map((_, i) => (
                    <span key={i} className="point" />
                ))}
            </span>
            <span className="inner">{children}</span>
        </button>
    )
}

// ========================
// Ripple Button 组件 (深色高级+波纹)
// ========================
function RippleButton({
    children,
    color = 'violet',
    size = 'default'
}: {
    children: React.ReactNode
    color?: string
    size?: 'sm' | 'default' | 'lg'
}) {
    const colorConfig = colorOptions.find(c => c.id === color) || colorOptions[0]

    const sizeClasses = {
        sm: 'text-sm',
        default: 'text-base',
        lg: 'text-lg'
    }

    const paddingClasses = {
        sm: 'padding: 0.6em 1em',
        default: 'padding: 0.8em 1.3em',
        lg: 'padding: 1em 1.6em'
    }

    return (
        <button
            className={`ripple-button ${sizeClasses[size]}`}
            style={{
                '--accent-color': colorConfig.primary,
                '--glow-color': colorConfig.glow,
            } as React.CSSProperties}
        >
            <span style={{ [paddingClasses[size].split(':')[0]]: paddingClasses[size].split(':')[1] }}>
                {children}
            </span>
            <span className="button-overlay" />
        </button>
    )
}

// ========================
// Glow Button 组件 (主页白色发光按钮)
// ========================
function GlowButton({
    children,
    color = 'violet',
    size = 'default'
}: {
    children: React.ReactNode
    color?: string
    size?: 'sm' | 'default' | 'lg'
}) {
    const colorConfig = colorOptions.find(c => c.id === color) || colorOptions[0]

    const sizeClasses = {
        sm: 'px-4 py-2 text-sm rounded-lg',
        default: 'px-6 py-3 text-base rounded-xl',
        lg: 'px-8 py-4 text-lg rounded-xl'
    }

    // 根据颜色生成渐变和阴影
    const getGradient = () => {
        if (color === 'violet') return 'from-white to-violet-100'
        if (color === 'blue') return 'from-white to-blue-100'
        if (color === 'cyan') return 'from-white to-cyan-100'
        if (color === 'emerald') return 'from-white to-emerald-100'
        if (color === 'rose') return 'from-white to-rose-100'
        if (color === 'amber') return 'from-white to-amber-100'
        return 'from-white to-gray-100'
    }

    return (
        <button
            className={`bg-gradient-to-b ${getGradient()} text-gray-800 hover:to-white ${sizeClasses[size]} font-medium flex items-center justify-center transition-all duration-300 border-t border-white`}
            style={{
                boxShadow: `
                    0 0 20px ${colorConfig.glow.replace('0.8', '0.4')},
                    inset 0 1px 0 rgba(255,255,255,1)
                `,
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `
                    0 0 30px ${colorConfig.glow.replace('0.8', '0.6')},
                    inset 0 1px 0 rgba(255,255,255,1)
                `
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = `
                    0 0 20px ${colorConfig.glow.replace('0.8', '0.4')},
                    inset 0 1px 0 rgba(255,255,255,1)
                `
            }}
        >
            {children}
        </button>
    )
}

// ========================
// White Glow Button 组件 (主页原版 - 完全复刻)
// ========================
function WhiteGlowButton({
    children,
    size = 'default'
}: {
    children: React.ReactNode
    size?: 'sm' | 'default' | 'lg'
}) {
    const sizeClasses = {
        sm: 'px-4 py-2 text-sm rounded-lg',
        default: 'px-6 py-3 text-base rounded-xl',
        lg: 'px-8 py-4 text-lg rounded-xl'
    }

    return (
        <button
            className={`bg-gradient-to-b from-white to-gray-100 text-black hover:to-white ${sizeClasses[size]} font-medium flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] transition-all duration-300 border-t border-white`}
        >
            {children}
        </button>
    )
}
