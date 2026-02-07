/**
 * AI 配音选择器组件 - JCUI 2.0 Mermaid Glass
 * ElevenLabs 音色选择 + 试听
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Mic, Play, Pause, Volume2, AlertCircle, Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';

// 预设推荐音色
export const PRESET_VOICES = [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female' as const, style: '甜美清晰', preview: 'https://api.elevenlabs.io/v1/voices/EXAVITQu4vr4xnSDxMaL/preview' },
    { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male' as const, style: '磁性温暖', preview: 'https://api.elevenlabs.io/v1/voices/IKne3meq5aSn9XLyUdCD/preview' },
    { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female' as const, style: '优雅成熟', preview: 'https://api.elevenlabs.io/v1/voices/XB0fDUnXU5powFXDhCwa/preview' },
    { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', gender: 'male' as const, style: '沉稳专业', preview: 'https://api.elevenlabs.io/v1/voices/pqHfZKP75CvOlQylNhV4/preview' },
    { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male' as const, style: '活力阳光', preview: 'https://api.elevenlabs.io/v1/voices/nPczCjzI2devNBz1zQrb/preview' },
];

export interface VoiceConfig {
    enabled: boolean;
    voiceId: string;
    voiceName: string;
}

interface VoiceSelectorProps {
    config: VoiceConfig;
    onChange: (config: VoiceConfig) => void;
    videoCount?: number;
}

export function VoiceSelector({ config, onChange, videoCount = 1 }: VoiceSelectorProps) {
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // 播放试听
    const playPreview = async (voice: typeof PRESET_VOICES[number]) => {
        if (playingId === voice.id) {
            audioRef.current?.pause();
            setPlayingId(null);
            return;
        }

        try {
            setLoadingId(voice.id);

            if (audioRef.current) {
                audioRef.current.pause();
            }

            // 使用预置的试听 URL
            audioRef.current = new Audio(voice.preview);
            audioRef.current.volume = 0.7;

            audioRef.current.oncanplaythrough = () => {
                setLoadingId(null);
                setPlayingId(voice.id);
                audioRef.current?.play();
            };

            audioRef.current.onended = () => setPlayingId(null);
            audioRef.current.onerror = () => {
                setLoadingId(null);
                setPlayingId(null);
            };

            audioRef.current.load();
        } catch (error) {
            setLoadingId(null);
            console.error('Preview error:', error);
        }
    };

    // 组件卸载时停止播放
    useEffect(() => {
        return () => {
            audioRef.current?.pause();
        };
    }, []);

    const handleToggle = () => {
        if (config.enabled) {
            onChange({ ...config, enabled: false });
        } else {
            // 启用时默认选第一个
            const defaultVoice = PRESET_VOICES[0];
            onChange({
                enabled: true,
                voiceId: defaultVoice.id,
                voiceName: defaultVoice.name,
            });
        }
    };

    const handleSelectVoice = (voice: typeof PRESET_VOICES[number]) => {
        onChange({
            enabled: true,
            voiceId: voice.id,
            voiceName: voice.name,
        });
    };

    return (
        <div className="space-y-3">
            {/* 启用开关 */}
            <div className="flex items-center justify-between">
                <Label className="text-xs text-white/60 flex items-center gap-1.5">
                    <Mic className="h-3.5 w-3.5" />
                    🎙️ AI 配音
                </Label>
                <button
                    onClick={handleToggle}
                    className={cn(
                        "relative w-10 h-5 rounded-full transition-all",
                        config.enabled
                            ? "bg-mermaid-pink/30 border border-mermaid-pink/50"
                            : "bg-white/10 border border-white/20"
                    )}
                >
                    <span
                        className={cn(
                            "absolute top-0.5 w-4 h-4 rounded-full transition-all",
                            config.enabled
                                ? "left-[22px] bg-mermaid-pink"
                                : "left-0.5 bg-white/40"
                        )}
                    />
                </button>
            </div>

            {/* 配音配置面板 */}
            {config.enabled && (
                <div className="space-y-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                    {/* 提示信息 */}
                    <div className="text-xs text-white/40 bg-mermaid-pink/5 border border-mermaid-pink/20 rounded-lg px-3 py-2 flex items-start gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-mermaid-pink shrink-0 mt-0.5" />
                        <span>
                            每条视频将<strong className="text-white/70">独立生成</strong>配音，避免平台判定重复内容
                        </span>
                    </div>

                    {/* 音色列表 */}
                    <div className="grid grid-cols-1 gap-2">
                        {PRESET_VOICES.map((voice) => (
                            <button
                                key={voice.id}
                                onClick={() => handleSelectVoice(voice)}
                                className={cn(
                                    "flex items-center gap-3 p-2.5 rounded-lg transition-all text-left",
                                    config.voiceId === voice.id
                                        ? "bg-mermaid-pink/10 border border-mermaid-pink/30"
                                        : "bg-white/5 border border-transparent hover:bg-white/10"
                                )}
                            >
                                {/* 性别图标 */}
                                <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0",
                                    voice.gender === 'female'
                                        ? "bg-pink-500/20 text-pink-400"
                                        : "bg-blue-500/20 text-blue-400"
                                )}>
                                    {voice.gender === 'female' ? '♀' : '♂'}
                                </div>

                                {/* 音色信息 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-white/90 font-medium">{voice.name}</span>
                                        <span className={cn(
                                            "text-[10px] px-1.5 py-0.5 rounded",
                                            voice.gender === 'female'
                                                ? "bg-pink-500/10 text-pink-400"
                                                : "bg-blue-500/10 text-blue-400"
                                        )}>
                                            {voice.gender === 'female' ? '女声' : '男声'}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-white/40">{voice.style}</div>
                                </div>

                                {/* 试听按钮 */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        playPreview(voice);
                                    }}
                                    disabled={loadingId === voice.id}
                                    className={cn(
                                        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all",
                                        playingId === voice.id
                                            ? "bg-mermaid-pink text-white"
                                            : "bg-white/10 text-white/60 hover:bg-white/20"
                                    )}
                                >
                                    {loadingId === voice.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : playingId === voice.id ? (
                                        <Pause className="h-3.5 w-3.5" />
                                    ) : (
                                        <Play className="h-3.5 w-3.5 ml-0.5" />
                                    )}
                                </button>

                                {/* 选中指示 */}
                                {config.voiceId === voice.id && (
                                    <div className="w-2 h-2 rounded-full bg-mermaid-pink shrink-0" />
                                )}
                            </button>
                        ))}
                    </div>

                    {/* 视频数量提示 */}
                    <div className="text-[10px] text-white/30 text-center pt-1">
                        将为 {videoCount} 条视频分别生成独立配音
                    </div>
                </div>
            )}
        </div>
    );
}
