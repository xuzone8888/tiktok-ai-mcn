/**
 * BGM 选择器组件 - JCUI 2.0 Mermaid Glass
 * 预设音乐库 + 随机/指定分配
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Music, Play, Pause, Shuffle, Check, Volume2 } from 'lucide-react';
import { Label } from '@/components/ui/label';

// 预设音乐库 (public/music/) - 已部署
export const PRESET_MUSIC = [
    { id: 'bgm-001', name: "Angel's Dream", artist: 'Aakash Gandhi', url: "/music/Angel's Dream - Aakash Gandhi.mp3", duration: '3:12' },
    { id: 'bgm-002', name: 'Dreamland', artist: 'Aakash Gandhi', url: '/music/Dreamland - Aakash Gandhi.mp3', duration: '3:00' },
    { id: 'bgm-003', name: 'Forever Yours', artist: 'Wayne Jones', url: '/music/Forever Yours - Wayne Jones.mp3', duration: '1:53' },
    { id: 'bgm-004', name: 'Millicent', artist: 'Max Surla', url: '/music/Millicent - Max Surla_Media Right Productions.mp3', duration: '2:18' },
    { id: 'bgm-005', name: 'Quiet Nights', artist: 'Nate Blaze', url: '/music/Quiet Nights - Nate Blaze.mp3', duration: '2:05' },
    { id: 'bgm-006', name: 'Somnia Var.10', artist: 'Reed Mathis', url: '/music/Somnia Variation 10 relax and sleep - Reed Mathis.mp3', duration: '3:14' },
    { id: 'bgm-007', name: 'Somnia Var.3', artist: 'Reed Mathis', url: '/music/Somnia Variation 3 relax and sleep - Reed Mathis.mp3', duration: '2:32' },
    { id: 'bgm-008', name: 'Somnia Var.4', artist: 'Reed Mathis', url: '/music/Somnia Variation 4 relax and sleep - Reed Mathis.mp3', duration: '2:47' },
    { id: 'bgm-009', name: 'Til Death Parts Us', artist: 'Aakash Gandhi', url: '/music/Til Death Parts Us - Aakash Gandhi.mp3', duration: '2:12' },
    { id: 'bgm-010', name: 'We Are the Rain', artist: 'Aakash Gandhi', url: '/music/We Are the Rain - Aakash Gandhi.mp3', duration: '2:50' },
] as const;

export type BGMMode = 'none' | 'random' | 'single';

export interface BGMConfig {
    enabled: boolean;
    mode: BGMMode;
    selectedId?: string;
}

interface BGMSelectorProps {
    config: BGMConfig;
    onChange: (config: BGMConfig) => void;
    videoCount?: number;
}

export function BGMSelector({ config, onChange, videoCount = 1 }: BGMSelectorProps) {
    const [playingId, setPlayingId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // 播放/暂停预览
    const togglePlay = (track: typeof PRESET_MUSIC[number]) => {
        if (playingId === track.id) {
            audioRef.current?.pause();
            setPlayingId(null);
        } else {
            if (audioRef.current) {
                audioRef.current.pause();
            }
            audioRef.current = new Audio(track.url);
            audioRef.current.volume = 0.5;
            audioRef.current.play();
            audioRef.current.onended = () => setPlayingId(null);
            setPlayingId(track.id);
        }
    };

    // 组件卸载时停止播放
    useEffect(() => {
        return () => {
            audioRef.current?.pause();
        };
    }, []);

    const handleModeChange = (mode: BGMMode) => {
        onChange({
            ...config,
            enabled: mode !== 'none',
            mode,
            selectedId: mode === 'single' ? config.selectedId : undefined,
        });
    };

    const handleSelectTrack = (id: string) => {
        onChange({
            ...config,
            enabled: true,
            mode: 'single',
            selectedId: id,
        });
    };

    return (
        <div className="space-y-3">
            {/* 模式选择 */}
            <div className="flex items-center justify-between">
                <Label className="text-xs text-white/60 flex items-center gap-1.5">
                    <Music className="h-3.5 w-3.5" />
                    🎵 背景音乐
                </Label>
            </div>

            <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                {(['random', 'single', 'none'] as const).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => handleModeChange(mode)}
                        className={cn(
                            "flex-1 py-1.5 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1",
                            config.mode === mode
                                ? "bg-mermaid-cyan/20 text-mermaid-cyan shadow-sm"
                                : "text-white/40 hover:text-white/70"
                        )}
                    >
                        {mode === 'none' && '无'}
                        {mode === 'random' && (
                            <>
                                <Shuffle className="h-3 w-3" />
                                随机
                            </>
                        )}
                        {mode === 'single' && '指定'}
                    </button>
                ))}
            </div>

            {/* 随机模式提示 */}
            {config.mode === 'random' && (
                <div className="text-xs text-white/40 bg-white/5 rounded-lg px-3 py-2 flex items-center gap-2">
                    <Shuffle className="h-3 w-3 text-mermaid-cyan" />
                    <span>
                        {videoCount} 条视频将随机分配 {Math.min(videoCount, PRESET_MUSIC.length)} 首不同 BGM
                    </span>
                </div>
            )}

            {/* 音乐列表 */}
            {config.mode === 'single' && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                    {PRESET_MUSIC.map((track) => (
                        <button
                            key={track.id}
                            onClick={() => config.mode === 'single' && handleSelectTrack(track.id)}
                            className={cn(
                                "w-full flex items-center gap-3 p-2 rounded-lg transition-all text-left group",
                                config.mode === 'single' && config.selectedId === track.id
                                    ? "bg-mermaid-cyan/10 border border-mermaid-cyan/30"
                                    : "bg-white/5 border border-transparent hover:bg-white/10",
                                config.mode === 'random' && "cursor-default"
                            )}
                        >
                            {/* 播放按钮 */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    togglePlay(track);
                                }}
                                className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all",
                                    playingId === track.id
                                        ? "bg-mermaid-cyan text-black"
                                        : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"
                                )}
                            >
                                {playingId === track.id ? (
                                    <Pause className="h-3.5 w-3.5" />
                                ) : (
                                    <Play className="h-3.5 w-3.5 ml-0.5" />
                                )}
                            </button>

                            {/* 曲目信息 */}
                            <div className="flex-1 min-w-0">
                                <div className="text-xs text-white/90 truncate">{track.name}</div>
                                <div className="text-[10px] text-white/40 truncate">{track.artist}</div>
                            </div>

                            {/* 时长 */}
                            <span className="text-[10px] text-white/30 shrink-0">{track.duration}</span>

                            {/* 选中标记 */}
                            {config.mode === 'single' && config.selectedId === track.id && (
                                <Check className="h-4 w-4 text-mermaid-cyan shrink-0" />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * 随机分配 BGM（不重复）
 * @param videoCount 视频数量
 * @returns 音乐 URL 数组
 */
export function assignRandomMusic(videoCount: number): string[] {
    const shuffled = [...PRESET_MUSIC].sort(() => Math.random() - 0.5);

    // 如果视频数量超过音乐数量，循环使用
    const result: string[] = [];
    for (let i = 0; i < videoCount; i++) {
        result.push(shuffled[i % shuffled.length].url);
    }

    return result;
}
