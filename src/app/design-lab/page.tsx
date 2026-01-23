'use client';

import { Sparkles, ArrowRight, Zap, Check } from 'lucide-react';
import ReflectiveCard from '@/components/ui/ReflectiveCard';
import { ReflectiveButton } from '@/components/landing/shared';

/**
 * DesignLab - 配色方案实验室
 * 用于展示不同主题色的搭配效果
 */
export default function DesignLab() {
    const themes = [
        {
            id: 'theme-monochrome',
            name: 'Option A: Titanium (钛金)',
            description: '极致的黑白灰，工业感强，专业、冷峻。',
            colors: {
                accent: '#ffffff',
                accentGradient: 'from-white to-gray-400',
                cardOverlay: 'rgba(255, 255, 255, 0.05)',
                buttonVariant: 'primary' // standard
            }
        },
        {
            id: 'theme-blue',
            name: 'Option B: Deep Sea (深海)',
            description: '科技蓝，稳重且具有未来感，不仅是亮蓝，而是深蓝。',
            colors: {
                accent: '#38bdf8', // sky-400
                accentGradient: 'from-blue-500 to-cyan-400',
                cardOverlay: 'rgba(56, 189, 248, 0.1)',
                buttonVariant: 'primary'
            }
        },
        {
            id: 'theme-purple',
            name: 'Option C: Nebula (星云)',
            description: '神秘紫，更具 AI 智能感和创造力，适合创意工具。',
            colors: {
                accent: '#c084fc', // purple-400
                accentGradient: 'from-purple-500 to-pink-500',
                cardOverlay: 'rgba(192, 132, 252, 0.1)',
                buttonVariant: 'primary'
            }
        }
    ];

    return (
        <div className="min-h-screen bg-black text-white p-12">
            <h1 className="text-3xl font-bold mb-2">UI 配色方案实验室</h1>
            <p className="text-white/50 mb-12">请选择最符合您预期的整体色调氛围。</p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {themes.map((theme) => (
                    <div key={theme.id} className="space-y-6">
                        {/* 主题说明 */}
                        <div className="border-b border-white/10 pb-4">
                            <h2 className="text-xl font-bold mb-1" style={{ color: theme.colors.accent }}>{theme.name}</h2>
                            <p className="text-sm text-white/50">{theme.description}</p>
                        </div>

                        {/* 组件展示区 */}
                        <div className="space-y-4">

                            {/* 1. Hero Input Card (模拟) */}
                            <ReflectiveCard
                                width="100%"
                                overlayColor={theme.colors.cardOverlay}
                                className="group"
                            >
                                <div className="p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Sparkles size={16} style={{ color: theme.colors.accent }} />
                                        <span className="text-sm font-medium tracking-wide">AI GENERATION</span>
                                    </div>
                                    <h3 className="text-2xl font-bold mb-2">生成爆款视频</h3>
                                    <div className="h-1 w-12 rounded-full mb-6 bg-gradient-to-r" style={{ backgroundImage: `linear-gradient(to right, ${theme.colors.accent}, transparent)` }} />

                                    <div className="flex gap-2">
                                        <div className="flex-1 h-10 rounded-lg border border-white/10 bg-white/5 flex items-center px-3 text-sm text-white/40">
                                            粘贴商品链接...
                                        </div>
                                        <button
                                            className="h-10 px-4 rounded-lg font-medium text-sm flex items-center gap-2 transition-transform hover:scale-105"
                                            style={{
                                                background: theme.colors.accent,
                                                color: theme.id === 'theme-monochrome' ? 'black' : 'white',
                                                boxShadow: `0 0 20px ${theme.colors.accent}40`
                                            }}
                                        >
                                            生成 <ArrowRight size={14} />
                                        </button>
                                    </div>
                                </div>
                            </ReflectiveCard>

                            {/* 2. Feature Highlight */}
                            <ReflectiveCard width="100%" roughness={0.5}>
                                <div className="p-5 flex items-center gap-4">
                                    <div
                                        className="w-12 h-12 rounded-xl flex items-center justify-center"
                                        style={{ background: `${theme.colors.accent}20` }}
                                    >
                                        <Zap size={24} style={{ color: theme.colors.accent }} />
                                    </div>
                                    <div>
                                        <div className="text-lg font-bold">极速渲染</div>
                                        <div className="text-white/40 text-sm">60秒完成 4K 导出</div>
                                    </div>
                                </div>
                            </ReflectiveCard>

                            {/* 3. Stat Card */}
                            <div
                                className="p-6 rounded-2xl border border-white/10 relative overflow-hidden"
                            >
                                <div className="absolute inset-0 opacity-10 bg-gradient-to-br" style={{ backgroundImage: `linear-gradient(135deg, ${theme.colors.accent}, transparent)` }} />
                                <div className="text-3xl font-mono font-bold mb-1" style={{ color: theme.colors.accent }}>99.9%</div>
                                <div className="text-sm text-white/60">商用版权安全</div>
                            </div>

                            {/* 4. List Items */}
                            <div className="space-y-2 p-4">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="flex items-center gap-3">
                                        <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: `${theme.colors.accent}30` }}>
                                            <Check size={10} style={{ color: theme.colors.accent }} />
                                        </div>
                                        <span className="text-white/70 text-sm">优势功能展示项 {i}</span>
                                    </div>
                                ))}
                            </div>

                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
