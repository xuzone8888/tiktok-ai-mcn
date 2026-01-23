'use client';

import { useState } from 'react';
import {
    Search, Bell, User, Settings, Check, ChevronRight,
    Menu, X, Fingerprint, Lock, Shield, Zap, Power
} from 'lucide-react';
import ReflectiveCard from '@/components/ui/ReflectiveCard';
import ReflectiveInput from '@/components/ui/ReflectiveInput';
import { ReflectiveButton } from '@/components/landing/shared';

// Titanium Design System
export default function TitaniumSystem() {
    const [isActive, setIsActive] = useState(false);

    return (
        <div className="min-h-screen bg-black text-white p-12 font-sans selection:bg-white selection:text-black">

            {/* 头部说明 */}
            <div className="max-w-7xl mx-auto mb-20">
                <div className="flex justify-between items-end mb-4">
                    <h1 className="text-5xl font-bold tracking-tight">Titanium Design System v2</h1>
                    <ReflectiveButton
                        variant={isActive ? "primary" : "ghost"}
                        onClick={() => setIsActive(!isActive)}
                    >
                        <Power size={18} className={isActive ? "text-green-400" : "text-gray-400"} />
                        {isActive ? "SYSTEM ONLINE" : "SYSTEM STANDBY"}
                    </ReflectiveButton>
                </div>
                <p className="text-xl text-white/50 max-w-2xl">
                    工业级精密感。点击右侧按钮启动 "Active Mode" 查看动态反馈。
                </p>
            </div>

            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-16">

                {/* 左侧导航 (Sticky) */}
                <div className="lg:col-span-3">
                    <div className="sticky top-12 space-y-2">
                        {['Playground', 'Inputs', 'Buttons', 'Cards'].map((item) => (
                            <a
                                key={item}
                                href={`#${item.toLowerCase()}`}
                                className="block px-4 py-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                            >
                                {item}
                            </a>
                        ))}
                    </div>
                </div>

                {/* 右侧内容 */}
                <div className="lg:col-span-9 space-y-32">

                    {/* 0. Playground */}
                    <section id="playground" className="space-y-8">
                        <div className="border-b border-white/10 pb-4 mb-8">
                            <h2 className="text-2xl font-bold flex items-center gap-3">
                                <Zap className={isActive ? "text-white fill-white" : "text-gray-600"} />
                                Interactive Playground
                            </h2>
                            <p className="text-white/40">Toggle the system state above to see components react.</p>
                        </div>

                        <div className="grid md:grid-cols-2 gap-8">
                            <ReflectiveCard
                                width="100%"
                                className="min-h-[200px]"
                                active={isActive}
                                roughness={0.8}
                            >
                                <div className="p-8 h-full flex flex-col justify-between">
                                    <div className="flex justify-between items-start">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all duration-500 ${isActive ? 'bg-white text-black scale-110 shadow-[0_0_20px_white]' : 'bg-white/10 text-white/30'}`}>
                                            01
                                        </div>
                                        <div className={`px-2 py-1 rounded text-xs font-mono transition-colors ${isActive ? 'bg-white text-black' : 'bg-white/5 text-white/30'}`}>
                                            {isActive ? 'PROCESSING' : 'IDLE'}
                                        </div>
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold mb-2">Turbo Engine</h3>
                                        <p className="text-white/50 text-sm">High-performance rendering core.</p>
                                    </div>
                                </div>
                            </ReflectiveCard>

                            <ReflectiveCard width="100%" className="min-h-[200px]">
                                <div className="p-8 h-full flex flex-col justify-center space-y-6">
                                    <ReflectiveInput
                                        placeholder="Type to see glow..."
                                        icon={<Search size={18} />}
                                    />
                                    <div className="flex justify-end">
                                        <ReflectiveButton variant="primary" size="sm">Execute</ReflectiveButton>
                                    </div>
                                </div>
                            </ReflectiveCard>
                        </div>
                    </section>


                    {/* 1. Inputs (New) */}
                    <section id="inputs" className="space-y-8">
                        <div className="border-b border-white/10 pb-4 mb-8">
                            <h2 className="text-2xl font-bold">Reflective Inputs</h2>
                            <p className="text-white/40">Enhanced focus states with glow effects.</p>
                        </div>

                        <div className="space-y-6 max-w-2xl">
                            <ReflectiveInput
                                placeholder="带图标的输入框..."
                                icon={<User size={18} />}
                            />
                            <ReflectiveInput
                                placeholder="右侧带快捷键..."
                                icon={<Search size={18} />}
                                rightElement={<kbd className="px-2 py-1 text-xs border border-white/20 rounded text-white/50">⌘K</kbd>}
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <ReflectiveInput placeholder="First Name" />
                                <ReflectiveInput type="password" placeholder="Password" icon={<Lock size={18} />} />
                            </div>
                        </div>
                    </section>


                    {/* 2. Buttons */}
                    <section id="buttons" className="space-y-8">
                        <div className="border-b border-white/10 pb-4 mb-8">
                            <h2 className="text-2xl font-bold">Buttons</h2>
                        </div>
                        <div className="flex gap-4">
                            <ReflectiveButton variant="primary">Primary Action</ReflectiveButton>
                            <ReflectiveButton variant="ghost">Secondary</ReflectiveButton>
                        </div>
                    </section>

                    {/* 3. Cards */}
                    <section id="cards" className="space-y-8">
                        <div className="border-b border-white/10 pb-4 mb-8">
                            <h2 className="text-2xl font-bold">Cards</h2>
                        </div>
                        <div className="grid md:grid-cols-3 gap-6">
                            <ReflectiveCard className="aspect-square flex items-center justify-center">
                                <div className="text-center p-6">
                                    <Shield size={32} className="mx-auto mb-4 text-white/50" />
                                    <h3 className="font-bold">Static Frame</h3>
                                </div>
                            </ReflectiveCard>
                            <ReflectiveCard active={true} className="aspect-square flex items-center justify-center">
                                <div className="text-center p-6">
                                    <Zap size={32} className="mx-auto mb-4 text-white drop-shadow-[0_0_10px_white]" />
                                    <h3 className="font-bold">Active Pulse</h3>
                                </div>
                            </ReflectiveCard>
                        </div>
                    </section>

                </div>
            </div>
        </div>
    );
}
