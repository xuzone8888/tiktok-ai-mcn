/**
 * 图片轮播视频生成 API
 * POST /api/video-batch/generate-slideshow
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
    generateSlideshowBatch,
    shuffleAndGroup,
    positionExtract,
    calculateCredits,
    getPresetMusicList,
} from '@/lib/ffmpeg-slideshow';
import { uploadBuffer } from '@/lib/oss';
import { generateCaptions, generateTextOverlays, CaptionStyle, CaptionMode } from '@/lib/deepseek-api';
import { textToSpeechWithTimestamps, WordTimestamp } from '@/lib/elevenlabs-api';
import { doubaoTextToSpeechWithTimestamps } from '@/lib/doubao-tts-api';
import { PRESET_VOICES } from '@/lib/voice-data';
import type { SubtitleConfig } from '@/lib/ffmpeg-slideshow';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';

// 请求类型 - 与前端 CreateSlideshowModal 配置对齐
interface SlideshowRequest {
    mode: 'random' | 'position';
    // 智能混剪模式
    images?: string[];
    imagesPerVideo?: number;
    // 场景编排模式
    positions?: {
        name: string;
        images: string[];
    }[];
    // 通用配置
    aspectRatio: '9:16' | '16:9';
    durationPerImage?: number;
    transition: string;

    // 新增：BGM 配置
    bgm?: {
        enabled: boolean;
        mode: 'none' | 'random' | 'single';
        selectedId?: string;
    };

    // 新增：配音配置
    voice?: {
        enabled: boolean;
        voiceId: string;
        voiceName: string;
    };

    // 新增：AI 文案配置
    aiCaption?: {
        enabled: boolean;
        mode: 'unified' | 'diverse';
        keywords: string;
        style: string;
        language?: 'en' | 'zh';
        generatedTexts?: string[]; // 前端预生成的文案
    };

    // 增强版字幕配置 - 与 FFmpeg drawtext 参数对齐
    subtitle?: {
        text: string;
        position: number;          // Y轴位置 0-100
        fontSize: number;
        fontColor: string;
        fontFamily: string;
        borderWidth: number;
        borderColor: string;
        shadow: boolean;
        // 图文字幕支持
        textOverlays?: Array<{
            id: string;
            text: string;
            timingMode: 'image' | 'custom';
            imageIndex?: number;
            startPercent?: number;
            endPercent?: number;
            boxX: number;
            boxY: number;
            boxWidth: number;
            style: string;
            tone: string;
            color: string;
            fontSize?: number;
            fontFamily?: string;
            fontWeight?: string;
            borderWidth?: number;
            borderColor?: string;
            shadow?: boolean;
            positionMode?: 'fixed' | 'random';
            styleMode?: 'inherit' | 'custom' | 'random';
            animation?: string;
        }>;
        // overlay AI 生成配置（批量生成时使用）
        overlayAiConfig?: {
            prompt: string;
            language: 'en' | 'zh';
            mode: 'uniform' | 'diverse';
        };
        // 图文位置模式
        overlayPositionMode?: 'fixed' | 'random';
    } | null;
}

/**
 * AI 智能选声：根据文案内容选择最合适的配音音色
 * 支持去重：通过 usageCounts 跟踪已使用次数，优先选使用少的音色
 * 策略：AI 返回 top-3 推荐，从中挑使用次数最少的
 */
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1/chat/completions';

async function smartVoiceSelect(
    text: string,
    language: string,
    pool: typeof PRESET_VOICES,
    usageCounts: Map<string, number>,  // 已分配计数器
): Promise<string> {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('DeepSeek API key not configured');
    }

    const voiceList = pool.map((v, i) => `${i + 1}.${v.name}(${v.style})`).join(' ');
    const prompt = `根据视频配音文本，从以下音色中选3个最合适的。只返回3个编号数字，用逗号分隔，不要解释。
文本："${text.substring(0, 150)}"
音色：${voiceList}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8 秒超时

    try {
        const response = await fetch(DEEPSEEK_API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 20,
                temperature: 0.3,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`DeepSeek API error: ${response.status}`);
        }

        const data = await response.json();
        const resultText = data.choices?.[0]?.message?.content?.trim() || '';

        // 解析 top-3 推荐（如 "2,5,8" 或 "2、5、8"）
        const nums = resultText.split(/[,，、\s]+/).map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n) && n >= 1 && n <= pool.length);

        if (nums.length === 0) {
            console.warn(`[SmartVoice] Invalid AI response "${resultText}", using least-used`);
            return pickLeastUsed(pool, usageCounts);
        }

        // 从 top-3 中选使用次数最少的（去重）
        const candidates = nums.map((n: number) => pool[n - 1]);
        candidates.sort((a: typeof pool[number], b: typeof pool[number]) => (usageCounts.get(a.id) || 0) - (usageCounts.get(b.id) || 0));
        const selected = candidates[0];

        // 更新计数
        usageCounts.set(selected.id, (usageCounts.get(selected.id) || 0) + 1);

        console.log(`[SmartVoice] AI top-3: [${nums.join(',')}] → selected: ${selected.name} (used ${usageCounts.get(selected.id)}x) for "${text.substring(0, 30)}..."`);
        return selected.id;
    } catch (error: any) {
        clearTimeout(timeout);
        throw error;
    }
}

/** 从音色池中选使用次数最少的（纯随机 fallback） */
function pickLeastUsed(pool: typeof PRESET_VOICES, usageCounts: Map<string, number>): string {
    const sorted = [...pool].sort((a, b) => (usageCounts.get(a.id) || 0) - (usageCounts.get(b.id) || 0));
    const selected = sorted[0];
    usageCounts.set(selected.id, (usageCounts.get(selected.id) || 0) + 1);
    return selected.id;
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    const log = (step: string, data?: any) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n========== [${elapsed}s] SLIDESHOW: ${step} ==========`);
        if (data) console.log(JSON.stringify(data, null, 2));
    };
    // 🔍 持久化诊断日志（不会被终端滚丢）
    const debugLogPath = path.join(process.cwd(), '.temp', 'slideshow', 'output', 'api_debug.log');
    const dbg = async (msg: string) => {
        const ts = new Date().toISOString();
        const line = `[${ts}] ${msg}\n`;
        try { await fs.appendFile(debugLogPath, line); } catch { }
    };

    log('📥 REQUEST RECEIVED');
    try {
        const supabase = await createClient();
        log('✅ Supabase client created');

        // 验证用户
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        log('🔐 Auth check', { userId: user?.id, email: user?.email, error: authError?.message });
        if (authError || !user) {
            log('❌ AUTH FAILED');
            return NextResponse.json({ error: '请先登录' }, { status: 401 });
        }

        const body: SlideshowRequest = await req.json();
        const {
            mode,
            images,
            imagesPerVideo = 5,
            positions,
            aspectRatio = '9:16',
            durationPerImage = 2,
            transition = 'fade',
            bgm,
            voice,
            aiCaption,
            subtitle,
        } = body;

        log('📋 REQUEST BODY', {
            mode,
            imageCount: images?.length,
            imagesPerVideo,
            positionCount: positions?.length,
            aspectRatio,
            durationPerImage,
            transition,
            bgm: bgm ? { enabled: bgm.enabled, mode: bgm.mode } : null,
            voice: voice ? { enabled: voice.enabled, voiceId: voice.voiceId } : null,
            aiCaption: aiCaption ? { enabled: aiCaption.enabled, language: aiCaption.language, mode: aiCaption.mode } : null,
            subtitleEnabled: !!subtitle?.text,
        });

        // 详细调试日志：打印完整 subtitle 配置
        log('🔤 SUBTITLE CONFIG (FULL)', subtitle);

        // 验证参数
        if (mode === 'random') {
            if (!images || images.length === 0) {
                return NextResponse.json({ error: '请上传图片' }, { status: 400 });
            }
            if (imagesPerVideo < 1 || imagesPerVideo > 15) {
                return NextResponse.json({ error: '每视频图片数需在 1-15 之间' }, { status: 400 });
            }
        } else if (mode === 'position') {
            if (!positions || positions.length === 0) {
                return NextResponse.json({ error: '请设置位置并上传图片' }, { status: 400 });
            }
            // 每个位置至少要有1张图片
            const counts = positions.map(p => p.images.length);
            if (counts.some(c => c === 0)) {
                return NextResponse.json({ error: '每个位置至少需要1张图片' }, { status: 400 });
            }
        } else {
            return NextResponse.json({ error: '无效的模式' }, { status: 400 });
        }

        // 计算视频数量和积分
        let imageGroups: string[][];
        let creditsPerVideo: number;

        if (mode === 'random') {
            imageGroups = shuffleAndGroup(images!, imagesPerVideo);
            creditsPerVideo = calculateCredits(imagesPerVideo);
        } else {
            const positionImages = positions!.map(p => p.images);
            const minCount = Math.min(...positionImages.map(p => p.length));
            imageGroups = positionExtract(positionImages, minCount);
            creditsPerVideo = calculateCredits(positions!.length);
        }

        const totalVideos = imageGroups.length;
        const totalCredits = totalVideos * creditsPerVideo;

        // 检查积分
        const { data: profile } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', user.id)
            .single() as { data: { credits: number } | null };

        if (!profile || profile.credits < totalCredits) {
            return NextResponse.json({
                error: `积分不足，需要 ${totalCredits} 积分，当前余额 ${profile?.credits || 0}`,
            }, { status: 400 });
        }

        // 准备音乐池 - 使用新的 BGM 配置
        let musicPool: string[] = [];
        console.log('[Slideshow API] BGM config:', JSON.stringify(bgm, null, 2));
        if (bgm?.enabled && bgm.mode !== 'none') {
            // random 或 single 模式都从预设音乐库获取
            musicPool = await getPresetMusicList();
            console.log(`[Slideshow API] Music pool loaded: ${musicPool.length} tracks`);
            if (musicPool.length > 0) {
                console.log('[Slideshow API] Available tracks:', musicPool.map(p => p.split('/').pop()));
            }
            // 如果是指定单曲模式，过滤到选定的曲目
            if (bgm.mode === 'single' && bgm.selectedId) {
                // selectedId 是如 'bgm-001' 格式，需要匹配到对应的文件
                console.log(`[Slideshow API] Using single BGM track: ${bgm.selectedId}`);
            }
        } else {
            console.log('[Slideshow API] BGM disabled or mode is none');
        }

        // 下载图片到本地
        console.log('[Slideshow API] Downloading images...');
        const localImageGroups = await Promise.all(
            imageGroups.map(group => downloadFiles(group, 'images'))
        );
        console.log('[Slideshow API] Images downloaded, groups:', localImageGroups.map(g => g.length));

        // === AI 文案生成 ===
        let generatedCaptions: string[] = [];
        const captionLanguage = aiCaption?.language || 'en';

        // 计算预估视频时长（所有路径都需要）
        const avgImagesPerVideo = Math.ceil(localImageGroups.reduce((sum, g) => sum + g.length, 0) / localImageGroups.length);
        const estimatedVideoDuration = avgImagesPerVideo * durationPerImage;
        // 中文 TTS 实测 ≈ 4.5 字/秒（豆包含标点和停顿），英文 ≈ 2.5 词/秒
        const wordsPerSec = captionLanguage === 'zh' ? 4.5 : 2.5;
        const minCharsForVideo = Math.round(estimatedVideoDuration * wordsPerSec * 0.8); // 至少填满视频 80%

        console.log(`[Slideshow API] 📊 Caption sizing: ${estimatedVideoDuration.toFixed(1)}s video, lang=${captionLanguage}, minChars=${minCharsForVideo}`);
        await dbg(`📊 CAPTION SIZING: durationPerImage=${durationPerImage}, avgImages=${avgImagesPerVideo}, estDuration=${estimatedVideoDuration.toFixed(1)}s, lang=${captionLanguage}, minChars=${minCharsForVideo}`);

        // Fix 4B: 优先使用前端已生成的文案 — 但要验证长度是否匹配视频时长
        const preGenTexts = aiCaption?.generatedTexts;
        if (preGenTexts && preGenTexts.length >= localImageGroups.length) {
            const avgLen = preGenTexts.reduce((sum, t) => sum + t.length, 0) / preGenTexts.length;
            console.log(`[Slideshow API] 📝 Frontend generatedTexts: ${preGenTexts.length} items, avgLen=${avgLen.toFixed(0)} chars (need >=${minCharsForVideo})`);

            if (avgLen >= minCharsForVideo * 0.6) {
                generatedCaptions = preGenTexts.slice(0, localImageGroups.length);
                console.log(`[Slideshow API] ✅ Using pre-generated captions from frontend (avgLen=${avgLen.toFixed(0)} >= ${Math.round(minCharsForVideo * 0.6)})`);
                await dbg(`✅ USING FRONTEND CAPTIONS: avgLen=${avgLen.toFixed(0)} >= ${Math.round(minCharsForVideo * 0.6)} (60% threshold). Texts: ${preGenTexts.map(t => `[${t.length}]"${t.substring(0, 30)}"`).join(', ')}`);
            } else {
                console.warn(`[Slideshow API] ⚠️ Frontend captions too short (avgLen=${avgLen.toFixed(0)} < ${Math.round(minCharsForVideo * 0.6)}), regenerating...`);
                await dbg(`⚠️ FRONTEND CAPTIONS TOO SHORT: avgLen=${avgLen.toFixed(0)} < ${Math.round(minCharsForVideo * 0.6)}. Will regenerate.`);
            }
        }

        // 如果没有可用文案，使用 AI 生成（带长度验证重试）
        if (generatedCaptions.length === 0 && aiCaption?.enabled && aiCaption.keywords) {
            // 🔧 中文倍数 5（TTS 4.5字/秒 → 14s×5=70字 → 70/4.5=15.6s ≈ 视频时长）
            // 英文倍数 3（TTS 2.5词/秒 → 14s×3=42词 → 42/2.5=16.8s ≈ 视频时长）
            const dynamicMaxLength = Math.round(estimatedVideoDuration * (captionLanguage === 'zh' ? 5 : 3));

            for (let captionAttempt = 0; captionAttempt < 2; captionAttempt++) {
                try {
                    // 第二次尝试时增大 maxLength 50%，迫使 AI 写更长
                    const attemptMaxLength = captionAttempt === 0 ? dynamicMaxLength : Math.round(dynamicMaxLength * 1.5);
                    console.log(`[Slideshow API] 🤖 Caption generation attempt ${captionAttempt + 1}, maxLength=${attemptMaxLength}...`);

                    generatedCaptions = await generateCaptions({
                        keywords: aiCaption.keywords,
                        style: aiCaption.style as CaptionStyle || 'lively',
                        count: localImageGroups.length,
                        mode: aiCaption.mode as CaptionMode || 'diverse',
                        maxLength: Math.max(attemptMaxLength, 30),
                        language: captionLanguage,
                        videoDurationSeconds: estimatedVideoDuration,
                    });

                    const avgLen = generatedCaptions.reduce((s, c) => s + c.length, 0) / generatedCaptions.length;
                    console.log(`[Slideshow API] Attempt ${captionAttempt + 1}: avgLen=${avgLen.toFixed(0)}, minRequired=${minCharsForVideo}`);
                    await dbg(`🤖 CAPTION ATTEMPT ${captionAttempt + 1}: maxLength=${attemptMaxLength}, avgLen=${avgLen.toFixed(0)}, items=${generatedCaptions.length}: ${generatedCaptions.map(c => `[${c.length}]"${c.substring(0, 40)}"`).join(', ')}`);

                    if (avgLen >= minCharsForVideo) {
                        console.log(`[Slideshow API] ✅ Caption length OK (${avgLen.toFixed(0)} >= ${minCharsForVideo})`);
                        break;
                    } else if (captionAttempt === 0) {
                        console.warn(`[Slideshow API] ⚠️ Captions too short (${avgLen.toFixed(0)} < ${minCharsForVideo}), retrying with larger maxLength...`);
                        generatedCaptions = []; // 清空，触发重试
                    }
                    // 第二次无论如何都用（总比没有好）
                } catch (captionError: any) {
                    console.error(`[Slideshow API] Caption generation attempt ${captionAttempt + 1} failed:`, captionError.message);
                    await dbg(`❌ CAPTION ERROR attempt ${captionAttempt + 1}: ${captionError.message}`);
                    if (captionAttempt === 1) break;
                }
            }
        }

        // === AI 配音生成 (先于视频生成，以获取配音时长用于字幕同步) ===
        interface VoiceoverData {
            buffer: Buffer;
            duration: number; // 秒
            timestamps: WordTimestamp[]; // 词级时间戳
        }
        const voiceovers: (VoiceoverData | null)[] = [];

        /**
         * 安全保障：移除 emoji 和特殊字符
         * 注意：AI 文案生成已在 prompt 中禁止使用 emoji
         * 此函数作为备份层，处理用户手动输入的文本或 AI 遗漏的情况
         */
        const stripEmoji = (text: string): string => {
            // 使用字符码点过滤
            let result = '';
            for (const char of text) {
                const code = char.codePointAt(0) || 0;
                // 过滤掉所有 emoji 范围的字符
                const isEmoji =
                    (code >= 0x1F300 && code <= 0x1F5FF) || // Miscellaneous Symbols and Pictographs
                    (code >= 0x1F600 && code <= 0x1F64F) || // Emoticons
                    (code >= 0x1F680 && code <= 0x1F6FF) || // Transport and Map Symbols
                    (code >= 0x1F700 && code <= 0x1F77F) || // Alchemical Symbols
                    (code >= 0x1F780 && code <= 0x1F7FF) || // Geometric Shapes Extended
                    (code >= 0x1F800 && code <= 0x1F8FF) || // Supplemental Arrows-C
                    (code >= 0x1F900 && code <= 0x1F9FF) || // Supplemental Symbols and Pictographs
                    (code >= 0x1FA00 && code <= 0x1FA6F) || // Chess Symbols
                    (code >= 0x1FA70 && code <= 0x1FAFF) || // Symbols and Pictographs Extended-A
                    (code >= 0x2600 && code <= 0x26FF) ||   // Miscellaneous Symbols
                    (code >= 0x2700 && code <= 0x27BF) ||   // Dingbats
                    (code >= 0x1F1E0 && code <= 0x1F1FF);   // Flags

                if (!isEmoji) {
                    result += char;
                }
            }
            // 清理多余空格
            return result.replace(/\s+/g, ' ').trim();
        };

        console.log('[Slideshow API] 🎤 Voice config check:', JSON.stringify({ enabled: voice?.enabled, voiceId: voice?.voiceId, voiceName: (voice as any)?.voiceName }));
        if (voice?.enabled && voice.voiceId) {
            console.log('[Slideshow API] ✅ Voice ENABLED - Pre-generating voiceovers...');

            // 处理 random 模式：为每个视频分配真实的 voiceId
            const isRandomVoice = voice.voiceId === 'random';
            let assignedVoiceIds: string[];
            if (isRandomVoice) {
                // AI 智能选声（串行执行避免并发超时）+ 去重
                const language = aiCaption?.language || 'en';
                const langPool = PRESET_VOICES.filter(v => v.lang === language);
                const fallbackPool = langPool.length > 0 ? langPool : PRESET_VOICES;
                const usageCounts = new Map<string, number>();
                assignedVoiceIds = [];

                for (let i = 0; i < localImageGroups.length; i++) {
                    const voiceText = generatedCaptions[i] || subtitle?.text || '';
                    if (!voiceText.trim()) {
                        assignedVoiceIds.push(pickLeastUsed(fallbackPool, usageCounts));
                        continue;
                    }
                    try {
                        const vid = await smartVoiceSelect(voiceText, language, fallbackPool, usageCounts);
                        assignedVoiceIds.push(vid);
                    } catch (err: any) {
                        console.warn(`[Slideshow API] Smart voice select failed for video ${i + 1}, using least-used:`, err.message);
                        assignedVoiceIds.push(pickLeastUsed(fallbackPool, usageCounts));
                    }
                }
                console.log('[Slideshow API] AI smart voice assigned:', assignedVoiceIds);
                await dbg(`🎤 VOICE ASSIGN (random): ${assignedVoiceIds.map((v, i) => `V${i + 1}=${v}`).join(', ')}`);
            } else {
                // 指定音色：所有视频使用同一个
                assignedVoiceIds = Array(localImageGroups.length).fill(voice.voiceId);
                await dbg(`🎤 VOICE ASSIGN (fixed): all=${voice.voiceId}`);
            }

            // 🔧 跟踪 TTS 失败的音色 ID（55000 错误），后续视频自动避开
            const blacklistedVoiceIds = new Set<string>();

            for (let i = 0; i < localImageGroups.length; i++) {
                const rawVoiceText = generatedCaptions[i] || subtitle?.text || '';
                let voiceText = stripEmoji(rawVoiceText); // 过滤 emoji

                // ℹ️ 文本长度由 AI 端 fixCaptionLength 控制 + 合并端 outputDuration 弹性延长
                // 不再在此裁剪（之前的 charsPerSec 值对英文严重错误，导致文本被过度截断）

                console.log(`[Slideshow API] 🎤 TTS ${i + 1} voiceText="${voiceText.substring(0, 80)}" (len=${voiceText.length})`);
                await dbg(`📝 TTS V${i + 1} INPUT: len=${voiceText.length}, text="${voiceText.substring(0, 60)}"`);
                if (!voiceText) {
                    console.warn(`[Slideshow API] ❌ TTS ${i + 1}: SKIPPED — no text for voiceover`);
                    voiceovers.push(null);
                    continue;
                }

                if (voiceText !== rawVoiceText) {
                    console.log(`[Slideshow API] Stripped emojis from TTS text: "${rawVoiceText}" -> "${voiceText}"`);
                }

                try {
                    let actualVoiceId = assignedVoiceIds[i];

                    // 如果分配的音色已在黑名单中，立即切换
                    if (blacklistedVoiceIds.has(actualVoiceId)) {
                        const language = aiCaption?.language || 'en';
                        const langPool = PRESET_VOICES.filter(v => v.lang === language && !blacklistedVoiceIds.has(v.id));
                        if (langPool.length > 0) {
                            actualVoiceId = langPool[Math.floor(Math.random() * langPool.length)].id;
                            console.log(`[Slideshow API] ⚠️ TTS ${i + 1}: assigned voice blacklisted, switched to ${actualVoiceId}`);
                        }
                    }

                    console.log(`[Slideshow API] Generating TTS ${i + 1}/${localImageGroups.length} with voiceId=${actualVoiceId}...`);

                    // 🔧 TTS 间隔：测试证实豆包无限流（0s也能3/3成功），保留 2s 安全间隔
                    if (i > 0) {
                        const waitSec = 2;
                        console.log(`[Slideshow API] ⏳ Waiting ${waitSec}s before TTS ${i + 1}...`);
                        await new Promise(r => setTimeout(r, waitSec * 1000));
                    }

                    // TTS 重试机制 — 3次重试，遇到 55000 自动切换音色
                    let ttsResult: { audio: Buffer; duration: number; timestamps: any[] } | null = null;
                    const maxAttempts = 3;
                    for (let attempt = 0; attempt < maxAttempts; attempt++) {
                        try {
                            const isDoubaoVoice = actualVoiceId.startsWith('zh_');
                            await dbg(`🔊 TTS V${i + 1} attempt ${attempt + 1}: voiceId=${actualVoiceId}, engine=${isDoubaoVoice ? 'doubao' : 'elevenlabs'}`);

                            ttsResult = isDoubaoVoice
                                ? await doubaoTextToSpeechWithTimestamps(actualVoiceId, voiceText)
                                : await textToSpeechWithTimestamps(actualVoiceId, voiceText, {
                                    stability: 0.5,
                                    similarity_boost: 0.75,
                                });
                            break; // 成功就跳出
                        } catch (retryErr: any) {
                            const errMsg = retryErr.message || '';
                            const is55000 = errMsg.includes('55000') || errMsg.includes('mismatched');

                            await dbg(`⚠️ TTS V${i + 1} attempt ${attempt + 1}/${maxAttempts} failed: ${errMsg} (is55000=${is55000})`);

                            if (is55000) {
                                // 55000 错误：音色不可用，加入黑名单，立即切换到其他音色
                                blacklistedVoiceIds.add(actualVoiceId);
                                console.warn(`[Slideshow API] 🔴 TTS ${i + 1}: voice "${actualVoiceId}" → 55000 error, blacklisting and switching...`);

                                const language = aiCaption?.language || 'en';
                                const availablePool = PRESET_VOICES.filter(v => v.lang === language && !blacklistedVoiceIds.has(v.id));
                                if (availablePool.length > 0) {
                                    actualVoiceId = availablePool[Math.floor(Math.random() * availablePool.length)].id;
                                    console.log(`[Slideshow API] 🔄 TTS ${i + 1}: switched to "${actualVoiceId}", retrying...`);
                                    await dbg(`🔄 TTS V${i + 1}: switched to ${actualVoiceId}`);
                                    // 切换后立即重试（不等待）
                                    continue;
                                } else {
                                    console.error(`[Slideshow API] ❌ TTS ${i + 1}: no available voices left after blacklisting`);
                                    break;
                                }
                            }

                            if (attempt < maxAttempts - 1) {
                                console.warn(`[Slideshow API] ⚠️ TTS ${i + 1} attempt ${attempt + 1} failed: ${errMsg}, retrying in 3s...`);
                                await new Promise(r => setTimeout(r, 3000));
                            } else {
                                throw retryErr; // 最后一次失败才抛出
                            }
                        }
                    }

                    if (ttsResult) {
                        console.log(`[Slideshow API] ✅ TTS ${i + 1} generated: ${ttsResult.audio.length} bytes, ${ttsResult.duration.toFixed(2)}s, ${ttsResult.timestamps.length} words`);
                        voiceovers.push({
                            buffer: ttsResult.audio,
                            duration: ttsResult.duration,
                            timestamps: ttsResult.timestamps,
                        });
                    } else {
                        console.error(`[Slideshow API] ❌ TTS ${i + 1}: no result after retries`);
                        voiceovers.push(null);
                    }
                } catch (voiceError: any) {
                    console.error(`[Slideshow API] ❌ TTS ${i + 1} FAILED after retries:`, voiceError.message);
                    await dbg(`❌ TTS V${i + 1} FAILED: ${voiceError.message}`);
                    voiceovers.push(null);
                }
            }
            console.log(`\n🟡🟡🟡 CHECK-3: ALL TTS SUMMARY 🟡🟡🟡`);
            for (let vi = 0; vi < voiceovers.length; vi++) {
                const vo = voiceovers[vi];
                console.log(`  V${vi + 1}: ${vo ? `✅ ${vo.buffer.length} bytes, ${vo.duration.toFixed(2)}s` : '❌ NULL (no audio)'}`);
            }
            console.log(`[Slideshow API] 🎤 Voiceover generation complete: ${voiceovers.filter(v => v !== null).length}/${voiceovers.length} successful`);
            await dbg(`🎤 TTS COMPLETE: ${voiceovers.map((v, i) => `V${i + 1}=${v ? `${v.duration.toFixed(1)}s` : 'NULL'}`).join(', ')}`);
        } else {
            console.log('[Slideshow API] ⚠️ Voice DISABLED or no voiceId — skipping TTS entirely');
        }

        // 生成视频
        console.log('[Slideshow API] Calling FFmpeg...');
        console.log('[Slideshow API] Total image groups:', localImageGroups.length);
        console.log('[Slideshow API] Images per group:', localImageGroups.map(g => g.length));
        console.log('[Slideshow API] Subtitle config:', JSON.stringify(subtitle, null, 2));
        console.log('[Slideshow API] Voice config:', JSON.stringify(voice, null, 2));
        console.log('[Slideshow API] AI Caption config:', JSON.stringify(aiCaption, null, 2));
        console.log('[Slideshow API] Generated captions:', generatedCaptions);

        // === AI 图文文本生成（与 caption 一致：批量时 always 重新生成以尊重 language 设置） ===
        let generatedOverlayTexts: string[] = [];
        const overlayAiConfig = subtitle?.overlayAiConfig;
        // ⭐ 修复：始终重新生成图文文案，确保 language 设置生效（和 caption 行为一致）
        if (overlayAiConfig?.prompt) {
            console.log(`[Slideshow API] Generating AI overlay texts (language=${overlayAiConfig.language || 'en'}, existing overlays=${subtitle?.textOverlays?.length ?? 0})...`);
            try {
                // 计算总图片数（每张图 1 条文案）
                const totalImageCount = localImageGroups.reduce((sum, g) => sum + g.length, 0);
                // uniform=所有图用同一条, diverse=每张图独立生成
                const isUniform = overlayAiConfig.mode === 'uniform';
                generatedOverlayTexts = await generateTextOverlays({
                    prompt: overlayAiConfig.prompt,
                    mode: isUniform ? 'uniform' : 'diverse',
                    count: isUniform ? 1 : totalImageCount,
                    language: overlayAiConfig.language || 'en',
                    maxLength: 60,
                });
                // uniform 模式：将单条文案复制为 N 条（每张图一条）
                if (isUniform && generatedOverlayTexts.length === 1) {
                    generatedOverlayTexts = Array(totalImageCount)
                        .fill(generatedOverlayTexts[0]);
                }
                console.log(`[Slideshow API] AI overlay texts generated: ${generatedOverlayTexts.length} texts for ${totalImageCount} images`);
                generatedOverlayTexts.forEach((t, i) => {
                    console.log(`[Slideshow API]   Image ${i + 1}: ${t.substring(0, 60)}`);
                });
            } catch (err: any) {
                console.error('[Slideshow API] Overlay text generation failed:', err.message);
                // 继续执行，降级为复用已有文本
            }
        }

        // 为每个视频组准备字幕配置
        let textCursor = 0; // AI 文本游标：按图片顺序分配
        const subtitleConfigs = localImageGroups.map((group, index) => {
            // 配音字幕文本：优先 AI 生成，否则用户手动输入
            const rawCaptionText = generatedCaptions[index] || subtitle?.text || '';
            if (!rawCaptionText) return undefined;

            // 过滤 emoji 和特殊字符
            const captionText = stripEmoji(rawCaptionText);

            // 获取配音时长
            const voiceoverData = voiceovers[index];
            const voiceDuration = voiceoverData?.duration || 0;

            // === 图文文本分发：每张图 1 个 overlay，按位置继承样式 ===
            const existingOverlays = subtitle?.textOverlays || [];
            const groupImageCount = group.length;
            let videoOverlays: any[] = [];

            if (existingOverlays.length > 0) {
                // 🔍 DEBUG: 打印所有原始 overlay 的样式字段
                if (index === 0) {
                    existingOverlays.forEach((ov, oi) => {
                        console.log(`[Slideshow API] Original overlay[${oi}] style:`, JSON.stringify({
                            style: ov.style, tone: ov.tone, color: ov.color,
                            fontSize: ov.fontSize, fontFamily: ov.fontFamily,
                            fontWeight: ov.fontWeight, borderWidth: ov.borderWidth,
                            borderColor: ov.borderColor, shadow: ov.shadow,
                            styleMode: ov.styleMode, animation: ov.animation,
                        }));
                    });
                }

                for (let imgIdx = 0; imgIdx < groupImageCount; imgIdx++) {
                    // ⭐ 按位置继承样式：图片位置 0 → overlay[0] 的样式，位置 1 → overlay[1] 的样式
                    const styleTemplate = existingOverlays[imgIdx % existingOverlays.length];

                    // 文本优先级：AI 新生成 > 已有 overlays 循环复用
                    const overlayText = generatedOverlayTexts[textCursor + imgIdx]
                        || existingOverlays[(textCursor + imgIdx) % existingOverlays.length]?.text
                        || '';

                    if (overlayText) {
                        const finalFontWeight = styleTemplate.fontWeight || '700';
                        console.log(`[Slideshow API] TextOverlay ${imgIdx}: fontWeight from template='${styleTemplate.fontWeight}' → final='${finalFontWeight}'`);
                        videoOverlays.push({
                            ...styleTemplate,                // ⭐ 继承对应位置的样式配置
                            id: crypto.randomUUID(),          // 唯一 ID
                            text: stripEmoji(overlayText),    // 独立文案（过滤 emoji）
                            imageIndex: imgIdx,               // 绑定到当前图片
                            positionMode: subtitle?.overlayPositionMode || 'fixed',  // ⭐ 尊重用户选择，默认固定
                            fontWeight: finalFontWeight,  // ⭐ 确保粗体不丢失
                        });
                    }
                }
            }

            // 移动游标到下一个视频的起始位置
            textCursor += groupImageCount;

            console.log(`[Slideshow API] Video ${index + 1}: ${groupImageCount} images, ${videoOverlays.length} overlay(s)`);
            videoOverlays.forEach((o, i) => console.log(`[Slideshow API]   img${o.imageIndex}: "${o.text?.substring(0, 40)}" fontWeight=${o.fontWeight} style=${o.style} animation=${o.animation}`));

            return {
                ...subtitle,
                text: captionText,
                fontFamily: subtitle?.fontFamily || 'NotoSansSC',
                voiceDuration,
                wordTimestamps: voiceoverData?.timestamps || [],
                textOverlays: videoOverlays,
            } as SubtitleConfig;
        });

        // 调试日志：输出字幕配置
        console.log('[Slideshow API] subtitleConfigs length:', subtitleConfigs.length);
        console.log('[Slideshow API] subtitleConfigs[0]:', JSON.stringify(subtitleConfigs[0], null, 2));

        const results = await generateSlideshowBatch(
            localImageGroups,
            {
                aspectRatio,
                durationPerImage,
                transition,
            },
            musicPool,
            subtitleConfigs, // 传递字幕配置数组，每个视频使用对应的配置
            imageGroups,     // ⭐ 原始 OSS URL 分组（Mac Worker 用）
            voiceovers,      // ⭐ 配音数据（Mac Worker 用，同时完成音频合成）
        );
        console.log('[Slideshow API] FFmpeg completed, results:', results.length);
        // Log each result's status
        results.forEach((r, i) => {
            console.log(`[Slideshow API] Result ${i + 1}: success=${r.success}, path=${r.videoPath}, error=${r.error}`);
        });

        // === 合并配音到视频 ===
        if (voice?.enabled && voice.voiceId) {
            console.log(`[Slideshow API] 🔊 Merging voiceovers: ${voiceovers.filter(v => v !== null).length} voiceovers for ${results.length} videos`);
            for (let i = 0; i < results.length; i++) {
                const result = results[i];

                // ⭐ Worker 结果已包含配音合成，跳过本地合并
                if (result.videoUrl) {
                    console.log(`[Slideshow API] ✅ Video ${i + 1}: Worker already merged voiceover, skipping`);
                    continue;
                }

                const voiceoverData = voiceovers[i];

                console.log(`\n🔵🔵🔵 CHECK-4: MERGE PRE-CHECK V${i + 1} 🔵🔵🔵`);
                console.log(`  video: success=${result.success}, path=${result.videoPath || 'NONE'}`);
                console.log(`  voiceover: ${voiceoverData ? `✅ ${voiceoverData.buffer.length} bytes, ${voiceoverData.duration.toFixed(2)}s` : '❌ NULL'}`);

                if (!result.success || !result.videoPath || !voiceoverData) {
                    console.log(`  ❌ SKIPPING MERGE: success=${result.success} path=${!!result.videoPath} voiceover=${!!voiceoverData}`);
                    await dbg(`⏭️ MERGE SKIP V${i + 1}: success=${result.success}, hasPath=${!!result.videoPath}, hasVoiceover=${!!voiceoverData}`);
                    continue;
                }

                try {
                    console.log(`[Slideshow API] 🔊 Merging voiceover ${i + 1}: ${voiceoverData.buffer.length} bytes, ${voiceoverData.duration.toFixed(2)}s`);
                    const mergedPath = await mergeVoiceover(result.videoPath, voiceoverData.buffer, voiceoverData.duration);
                    results[i].videoPath = mergedPath;
                    console.log(`\n🟣🟣🟣 CHECK-5: MERGE RESULT V${i + 1} 🟣🟣🟣`);
                    console.log(`  ✅ SUCCESS: output=${mergedPath}`);
                    console.log(`[Slideshow API] ✅ Video ${i + 1} merged: ${mergedPath}`);
                    await dbg(`✅ MERGE V${i + 1}: voiceDur=${voiceoverData.duration.toFixed(1)}s, audioBytes=${voiceoverData.buffer.length}, output=${mergedPath}`);
                } catch (mergeError: any) {
                    console.error(`[Slideshow API] ❌ Merge FAILED for video ${i + 1}:`, mergeError.message);
                    await dbg(`❌ MERGE FAIL V${i + 1}: ${mergeError.message}`);
                    // 继续使用原视频，不阻断流程
                }
            }
        } else {
            console.log('[Slideshow API] ⚠️ Voice disabled — skipping merge step');
        }

        // 上传成功的视频到 OSS
        const videos: { url: string; cost: number }[] = [];
        let successCount = 0;

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            console.log(`[Slideshow API] Processing result ${i + 1}/${results.length}: success=${result.success}`);

            // ⭐ Worker 结果：已有 videoUrl，无需本地上传
            if (result.success && result.videoUrl) {
                console.log(`[Slideshow API] Video ${i + 1}: Worker URL = ${result.videoUrl}`);
                videos.push({ url: result.videoUrl, cost: creditsPerVideo });
                successCount++;
            } else if (result.success && result.videoPath) {
                try {
                    console.log(`[Slideshow API] Uploading video ${i + 1} to OSS...`);
                    const ossKey = `videos/slideshow/${user.id}/${crypto.randomUUID()}.mp4`;
                    const videoBuffer = await fs.readFile(result.videoPath);
                    console.log(`[Slideshow API] Video ${i + 1} size: ${videoBuffer.length} bytes`);
                    const videoUrl = await uploadBuffer(videoBuffer, ossKey, 'video/mp4');
                    console.log(`[Slideshow API] Video ${i + 1} uploaded: ${videoUrl}`);
                    videos.push({ url: videoUrl, cost: creditsPerVideo });
                    successCount++;
                    // 删除本地临时文件
                    await fs.unlink(result.videoPath).catch(() => { });
                } catch (uploadError: any) {
                    console.error(`[Slideshow API] Upload error for video ${i + 1}:`, uploadError.message);
                }
            } else {
                console.log(`[Slideshow API] Skipping result ${i + 1}: not successful or no video path`);
            }
        }
        console.log(`[Slideshow API] Upload complete. Success: ${successCount}/${results.length}`);

        // 扣除积分
        const actualCredits = successCount * creditsPerVideo;
        if (actualCredits > 0) {
            await supabase
                .from('profiles')
                .update({ credits: profile.credits - actualCredits } as never)
                .eq('id', user.id);
        }

        return NextResponse.json({
            success: true,
            videos,
            totalVideos: successCount,
            totalCredits: actualCredits,
        });

    } catch (error: any) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n========== [${elapsed}s] ❌ SLIDESHOW ERROR ==========`);
        console.log('Error message:', error.message);
        console.log('Error stack:', error.stack);
        return NextResponse.json({ error: error.message || '生成失败' }, { status: 500 });
    }
}

/**
 * 下载文件到本地临时目录 (使用项目目录避免中文路径问题)
 */
async function downloadFiles(urls: string[], type: 'images' | 'music'): Promise<string[]> {
    // 使用项目目录下的 .temp 文件夹，避免 Windows 用户目录含中文导致的问题
    const tempDir = path.join(process.cwd(), '.temp', 'slideshow', type, crypto.randomUUID());
    await fs.mkdir(tempDir, { recursive: true });

    const localPaths: string[] = [];

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const ext = type === 'images' ? '.jpg' : '.mp3';
        const localPath = path.join(tempDir, `${i.toString().padStart(4, '0')}${ext}`);

        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`Failed to download: ${url}`);
                continue;
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            await fs.writeFile(localPath, buffer);
            localPaths.push(localPath);
        } catch (error) {
            console.error(`Download error: ${url}`, error);
        }
    }

    return localPaths;
}

/**
 * 获取媒体文件时长（秒）
 */
function getMediaDuration(filePath: string): number {
    try {
        const output = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
            { encoding: 'utf-8', timeout: 10000 }
        );
        const duration = parseFloat(output.trim());
        return isNaN(duration) ? 0 : duration;
    } catch {
        console.warn('[Slideshow API] ffprobe failed, using fallback duration');
        return 0;
    }
}

/**
 * 将配音合成到视频中（混合 BGM 和配音）
 * @param videoPath 原视频路径（可能已含BGM）
 * @param audioBuffer 配音音频 Buffer
 * @param voiceDuration 配音时长（秒）
 * @returns 合成后的视频路径
 */
async function mergeVoiceover(videoPath: string, audioBuffer: Buffer, voiceDuration: number): Promise<string> {
    const tempDir = path.dirname(videoPath);
    const voiceoverPath = path.join(tempDir, `voiceover_${Date.now()}.mp3`);
    const outputPath = path.join(tempDir, `final_${Date.now()}.mp4`);

    // 保存配音文件
    await fs.writeFile(voiceoverPath, audioBuffer);

    // 获取视频时长
    const videoDuration = getMediaDuration(videoPath);
    // 🔧 如果配音稍长于视频，延长输出而非截断（保护内容完整性）
    // 配音 + 1.5s 延迟/缓冲，最多延长 20%
    const voiceEndTime = voiceDuration + 1.5;  // 配音结束时间（含延迟）
    const outputDuration = voiceEndTime > videoDuration
        ? Math.min(voiceEndTime, videoDuration * 1.2)
        : videoDuration;
    console.log(`[Audio Mix] Video: ${videoDuration.toFixed(1)}s, Voice: ${voiceDuration.toFixed(1)}s, Output: ${outputDuration.toFixed(1)}s ${voiceEndTime > videoDuration ? '(EXTENDED for full voiceover)' : '(exact)'}`);

    return new Promise((resolve) => {
        // 🔊 音频混合参数
        const VOICE_DELAY_MS = 1000;      // 配音延迟 1 秒
        const VOICE_DELAY_S = VOICE_DELAY_MS / 1000;
        const VOICE_FADE_IN = 0.5;        // 配音渐入 0.5 秒
        const VOICE_FADE_OUT = 0.3;       // 配音渐出 0.3 秒
        const BGM_VOLUME = 0.2;           // BGM 音量 20%（配音为主）
        const BGM_FADE_IN = 1.5;          // BGM 渐入 1.5 秒
        const BGM_FADE_OUT = 2.0;         // BGM 渐出 2 秒

        // === BGM 滤镜链 ===
        let bgmFilter = `[0:a]volume=${BGM_VOLUME}`;
        // BGM 渐入（始终添加）
        bgmFilter += `,afade=t=in:st=0:d=${BGM_FADE_IN}`;
        // BGM 渐出（仅在视频足够长时添加，避免与渐入重叠）
        if (outputDuration > BGM_FADE_IN + BGM_FADE_OUT + 1) {
            const bgmFadeOutStart = Math.max(0, outputDuration - BGM_FADE_OUT);
            bgmFilter += `,afade=t=out:st=${bgmFadeOutStart.toFixed(2)}:d=${BGM_FADE_OUT}`;
        }
        bgmFilter += ',apad[bgm]';  // pad BGM 到输出时长

        // === 配音滤镜链 ===
        let voiceFilter = `[1:a]adelay=${VOICE_DELAY_MS}|${VOICE_DELAY_MS}`;
        // 配音渐入
        voiceFilter += `,afade=t=in:st=${VOICE_DELAY_S}:d=${VOICE_FADE_IN}`;
        // 配音渐出（仅在配音足够长时添加）
        if (voiceDuration > VOICE_FADE_IN + VOICE_FADE_OUT) {
            const voiceFadeOutStart = VOICE_DELAY_S + voiceDuration - VOICE_FADE_OUT;
            voiceFilter += `,afade=t=out:st=${voiceFadeOutStart.toFixed(2)}:d=${VOICE_FADE_OUT}`;
        }
        // 🔧 atrim 基于 outputDuration（允许配音超出视频时自动延长）
        voiceFilter += `,volume=1.0,atrim=0:${outputDuration.toFixed(2)},asetpts=PTS-STARTPTS,apad[voice]`;

        // amix: duration=first — 以 BGM（= 视频时长 + apad）为基准
        const filterComplex = `${bgmFilter};${voiceFilter};[bgm][voice]amix=inputs=2:duration=first:dropout_transition=3[aout]`;

        console.log(`[Audio Mix] Filter: ${filterComplex}`);
        console.log(`[Audio Mix] Output duration: ${outputDuration.toFixed(2)}s (video=${videoDuration.toFixed(1)}s, voice=${voiceDuration.toFixed(1)}s)`);

        const ffmpegArgs = [
            '-y',
            '-i', videoPath,          // 输入 0: 原视频 (含 BGM)
            '-i', voiceoverPath,      // 输入 1: 配音
            '-filter_complex', filterComplex,
            '-map', '0:v:0',          // 使用原视频流
            '-map', '[aout]',         // 使用混合后的音频
            '-c:v', 'copy',           // 视频直接复制
            '-c:a', 'aac',
            '-b:a', '192k',
            '-t', outputDuration.toFixed(2),  // 🔧 基于 outputDuration（允许配音延长）
            outputPath,
        ];

        const proc = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        proc.on('close', async (code) => {
            // 清理临时配音文件
            await fs.unlink(voiceoverPath).catch(() => { });

            if (code === 0) {
                // 成功：删除原视频，返回合成后的视频路径
                await fs.unlink(videoPath).catch(() => { });
                console.log('[Slideshow API] Audio mixed successfully (voiceover + BGM)');
                resolve(outputPath);
            } else {
                // 混合失败，尝试仅添加配音（原视频可能没有音轨）
                console.warn('[Slideshow API] Audio mix failed, trying voiceover only...');

                // 回退：仅添加配音
                await fs.writeFile(voiceoverPath, audioBuffer);
                const fallbackArgs = [
                    '-y',
                    '-i', videoPath,
                    '-i', voiceoverPath,
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-map', '0:v:0',
                    '-map', '1:a:0',
                    '-t', outputDuration.toFixed(2),  // 同样允许延长
                    outputPath,
                ];

                const fallbackProc = spawn('ffmpeg', fallbackArgs, {
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                fallbackProc.on('close', async (fallbackCode) => {
                    await fs.unlink(voiceoverPath).catch(() => { });

                    if (fallbackCode === 0) {
                        await fs.unlink(videoPath).catch(() => { });
                        resolve(outputPath);
                    } else {
                        resolve(videoPath);
                    }
                });

                fallbackProc.on('error', () => resolve(videoPath));
            }
        });

        proc.on('error', (err) => {
            console.error('[Slideshow API] FFmpeg spawn error:', err.message);
            fs.unlink(voiceoverPath).catch(() => { });
            resolve(videoPath);
        });
    });
}

