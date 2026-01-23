'use client';

import ReflectiveCard from '@/components/ui/ReflectiveCard';

export default function ReflectiveDemoPage() {
    return (
        <div className="min-h-screen bg-black flex items-center justify-center p-8">
            <div className="text-center">
                <h1 className="text-white text-3xl font-bold mb-8">Reflective Card 材质预览</h1>
                <p className="text-gray-400 mb-12">ReactBits 原版组件 - 完全相同的材质效果</p>

                <div className="flex justify-center gap-8 flex-wrap">
                    {/* 原版卡片 */}
                    <ReflectiveCard
                        overlayColor="rgba(0, 0, 0, 0.2)"
                        blurStrength={12}
                        glassDistortion={30}
                        metalness={1}
                        roughness={0.75}
                        displacementStrength={20}
                        noiseScale={1}
                        specularConstant={5}
                        grayscale={0.15}
                        color="#ffffff"
                    />

                    {/* 自定义内容版本 - 使用完全相同的参数 */}
                    <ReflectiveCard
                        overlayColor="rgba(0, 0, 0, 0.2)"
                        blurStrength={12}
                        glassDistortion={30}
                        metalness={1}
                        roughness={0.75}
                        displacementStrength={20}
                        noiseScale={1}
                        specularConstant={5}
                        grayscale={0.15}
                        color="#ffffff"
                    >
                        <div className="flex flex-col h-full justify-between">
                            <div className="flex items-center gap-2 border-b border-white/20 pb-4">
                                <span className="text-xs font-bold tracking-widest bg-white/10 px-2 py-1 rounded">AI POWERED</span>
                            </div>

                            <div className="flex-1 flex flex-col justify-center items-center text-center">
                                <h2 className="text-2xl font-bold tracking-wide mb-2">从商品链接</h2>
                                <h2 className="text-2xl font-bold tracking-wide mb-4">到爆款视频</h2>
                                <p className="text-xs tracking-widest opacity-70 uppercase">60秒 AI 生成</p>
                            </div>

                            <div className="border-t border-white/20 pt-4 flex justify-between items-end">
                                <div>
                                    <span className="text-[9px] tracking-widest opacity-60 block">效率提升</span>
                                    <span className="font-mono text-sm">8000%</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-[9px] tracking-widest opacity-60 block">成本降低</span>
                                    <span className="font-mono text-sm">99%</span>
                                </div>
                            </div>
                        </div>
                    </ReflectiveCard>
                </div>

                <p className="text-gray-500 mt-12 text-sm">
                    注意：此组件需要摄像头权限以实现实时反射效果
                </p>
            </div>
        </div>
    );
}
