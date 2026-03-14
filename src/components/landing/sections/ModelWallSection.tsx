"use client";

import { useState } from "react";
import Image from "next/image";
import { Plus } from "lucide-react";
import {
    characterShowcase,
    styleFilters,
    type CharacterStyle,
} from "../data/landing-data";

export default function ModelWallSection() {
    const [activeFilter, setActiveFilter] = useState<CharacterStyle | "all">(
        "all"
    );

    const filtered =
        activeFilter === "all"
            ? characterShowcase
            : characterShowcase.filter((c) => c.style === activeFilter);

    return (
        <div className="py-16">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-8">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        你的角色，
                        <span className="font-mono">千变万化</span>
                    </h2>
                    <p className="text-gray-500 text-lg">
                        任何风格、任何人设，60 秒打造专属 AI 角色
                    </p>
                </div>

                {/* 风格筛选 pill */}
                <div className="flex gap-2 justify-center mb-10 flex-wrap">
                    {styleFilters.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => setActiveFilter(f.id)}
                            className={`px-4 py-2 text-sm rounded-full transition-all ${
                                activeFilter === f.id
                                    ? "bg-white text-black font-medium"
                                    : "border border-white/20 text-gray-400 hover:text-white hover:border-white/40"
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {/* 名片网格 */}
                <div className="max-w-5xl mx-auto">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {filtered.map((char) => (
                            <div
                                key={char.id}
                                className="group rounded-2xl overflow-hidden border border-white/10 bg-[#111] hover:border-white/30 hover:scale-[1.02] transition-all cursor-pointer"
                            >
                                {/* 图片区 */}
                                <div className="aspect-[4/5] relative overflow-hidden">
                                    <Image
                                        src={char.src}
                                        alt={`${char.name} - ${char.role}`}
                                        fill
                                        sizes="(max-width: 768px) 50vw, 25vw"
                                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                                    />
                                </div>
                                {/* 信息区 */}
                                <div className="p-3">
                                    <div className="text-white text-sm font-medium">
                                        {char.name}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-0.5">
                                        {char.role}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 创建 CTA（网格外部，避免对齐问题） */}
                <div className="max-w-5xl mx-auto mt-6">
                    <button className="w-full py-4 rounded-2xl border-2 border-dashed border-white/20 flex items-center justify-center gap-3 hover:border-white/50 hover:bg-white/5 transition-all cursor-pointer group">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                            <Plus className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-sm text-gray-400 group-hover:text-white transition-colors">
                            创建我的角色
                        </span>
                    </button>
                </div>

                {/* 底部号召 */}
                <p className="text-center text-gray-500 text-sm mt-8">
                    写实 · 动漫 · 3D · 插画 — 你想要的风格，AI 都能实现
                </p>
            </div>
        </div>
    );
}
