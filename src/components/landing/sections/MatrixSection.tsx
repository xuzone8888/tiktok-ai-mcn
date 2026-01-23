"use client";

import ReflectiveCard from "@/components/ui/ReflectiveCard";

// 模拟账号数据 (50 个)
const accounts = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    online: Math.random() > 0.2, // 80% 在线
}));

export default function MatrixSection() {
    const onlineCount = accounts.filter((a) => a.online).length;

    return (
        <section className="relative z-10 py-24 bg-gradient-to-b from-transparent via-white/[0.01] to-transparent">
            <div className="container max-w-7xl mx-auto px-6">
                {/* 标题 */}
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        让 AI 帮你打理 <span className="font-mono">100</span> 个账号
                    </h2>
                    <p className="text-gray-500 text-lg">
                        一个人 = 一支队伍，自动化矩阵运营
                    </p>
                </div>

                {/* 矩阵仪表盘 */}
                <div className="max-w-5xl mx-auto">
                    <ReflectiveCard className="!rounded-3xl" active={true}>
                        <div className="p-8">
                            {/* 顶部状态栏 */}
                            <div className="flex items-center justify-between mb-8">
                                <div className="text-sm text-gray-400">账号矩阵监控</div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    <span className="text-sm text-emerald-400">
                                        {onlineCount}/{accounts.length} 在线
                                    </span>
                                </div>
                            </div>

                            {/* 账号网格 */}
                            <div className="grid grid-cols-10 gap-2 mb-8">
                                {accounts.map((account) => (
                                    <div
                                        key={account.id}
                                        className={`aspect-square rounded-lg border ${account.online
                                            ? "bg-emerald-500/20 border-emerald-500/50"
                                            : "bg-white/5 border-white/10"
                                            } flex items-center justify-center text-xs ${account.online ? "text-emerald-400" : "text-gray-600"
                                            }`}
                                    >
                                        {account.id}
                                    </div>
                                ))}
                            </div>

                            {/* 进度条 */}
                            <div className="mb-8">
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-gray-400">今日发布进度</span>
                                    <span className="text-white font-mono">48/50</span>
                                </div>
                                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-white/80 to-white/60 rounded-full"
                                        style={{ width: "96%" }}
                                    />
                                </div>
                            </div>

                            {/* 全球分发地图占位 */}
                            <div className="h-48 bg-[#1f1f23] rounded-2xl border border-white/10 flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-4xl font-mono font-bold text-white mb-2">
                                        42
                                    </div>
                                    <div className="text-sm text-gray-500">
                                        覆盖国家/地区，全球分发中...
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>
            </div>
        </section>
    );
}
