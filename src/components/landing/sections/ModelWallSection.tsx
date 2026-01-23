"use client";

import Image from "next/image";
import ReflectiveCard from "@/components/ui/ReflectiveCard";

// 24张高质量单人头像 - 全部独特
const singleAvatars = [
    '/images/landing/avatar-1.png',
    '/images/landing/avatar-2.png',
    '/images/landing/avatar-3.png',
    '/images/landing/avatar-4.png',
    '/images/landing/avatar-5.png',
    '/images/landing/avatar-6.png',
    '/images/landing/avatar-7.png',
    '/images/landing/avatar-8.png',
    '/images/landing/avatar-9-v2.png',
    '/images/landing/avatar-10-v2.png',
    '/images/landing/avatar-11.png',
    '/images/landing/avatar-12-v2.png',
    '/images/landing/avatar-13.png',
    '/images/landing/avatar-14.png',
    '/images/landing/avatar-15-v2.png',
    '/images/landing/avatar-16.png',
    '/images/landing/avatar-17.png',
    '/images/landing/avatar-18.png',
    '/images/landing/avatar-19.png',
    '/images/landing/avatar-20.png',
    '/images/landing/avatar-21.png',
    '/images/landing/avatar-22.png',
    '/images/landing/avatar-23.png',
    '/images/landing/avatar-24.png',
];

// 创建24个头像显示位置
const modelAvatars = singleAvatars.map((src, i) => ({
    id: i + 1,
    src,
    name: `Model ${i + 1}`,
}));

export default function ModelWallSection() {
    return (
        <section className="relative z-10 py-24">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        不是 1 个达人，是 <span className="font-mono">1000</span> 个 AI 模特
                    </h2>
                    <p className="text-gray-500 text-lg">
                        24/7 不眠不休 · 无需沟通 · 无需寄样
                    </p>
                </div>

                {/* 头像墙 */}
                <div className="max-w-6xl mx-auto">
                    <ReflectiveCard className="!rounded-3xl p-8">
                        <div className="grid grid-cols-6 md:grid-cols-8 gap-4">
                            {modelAvatars.map((avatar) => (
                                <div
                                    key={avatar.id}
                                    className="aspect-square rounded-xl overflow-hidden border border-white/10 group hover:border-white/30 hover:scale-105 transition-all cursor-pointer relative bg-[#1a1a1a]"
                                >
                                    {/* 头像显示逻辑 */}
                                    <div className="relative w-full h-full">
                                        <Image
                                            src={avatar.src}
                                            alt={avatar.name}
                                            fill
                                            className="object-cover grayscale group-hover:grayscale-0 transition-all duration-300"
                                        />
                                    </div>

                                    {/* Hover overlay */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-2 pointer-events-none">
                                        <span className="text-xs text-white font-medium">#{avatar.id}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* 底部统计 */}
                        <div className="mt-8 pt-6 border-t border-white/10 flex justify-center gap-12">
                            <div className="text-center">
                                <div className="text-3xl font-mono font-bold text-white">
                                    1000+
                                </div>
                                <div className="text-sm text-gray-500">可用模特</div>
                            </div>
                            <div className="text-center">
                                <div className="text-3xl font-mono font-bold text-white">
                                    50+
                                </div>
                                <div className="text-sm text-gray-500">风格类型</div>
                            </div>
                            <div className="text-center">
                                <div className="text-3xl font-mono font-bold text-white">
                                    24/7
                                </div>
                                <div className="text-sm text-gray-500">全天候在线</div>
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>
            </div>
        </section>
    );
}
