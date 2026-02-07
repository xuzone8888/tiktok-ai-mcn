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
import { generateCaptions, CaptionStyle, CaptionMode } from '@/lib/deepseek-api';
import { textToSpeechWithTimestamps, WordTimestamp } from '@/lib/elevenlabs-api';
import type { SubtitleConfig } from '@/lib/ffmpeg-slideshow';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

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
        language?: 'en' | 'zh'; // 语言选项
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
        }>;
    } | null;
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    const log = (step: string, data?: any) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n========== [${elapsed}s] SLIDESHOW: ${step} ==========`);
        if (data) console.log(JSON.stringify(data, null, 2));
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
            // 验证所有位置图片数量相等
            const counts = positions.map(p => p.images.length);
            const firstCount = counts[0];
            if (counts.some(c => c !== firstCount)) {
                return NextResponse.json({ error: '所有位置的图片数量必须相等' }, { status: 400 });
            }
            if (firstCount === 0) {
                return NextResponse.json({ error: '位置中没有图片' }, { status: 400 });
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
            imageGroups = positionExtract(positionImages, positionImages[0].length);
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
        if (aiCaption?.enabled && aiCaption.keywords) {
            console.log('[Slideshow API] Generating AI captions...');
            try {
                // 计算平均每个视频的时长（图片数 × 每张图片时长）
                const avgImagesPerVideo = Math.ceil(localImageGroups.reduce((sum, g) => sum + g.length, 0) / localImageGroups.length);
                const estimatedVideoDuration = avgImagesPerVideo * durationPerImage;

                generatedCaptions = await generateCaptions({
                    keywords: aiCaption.keywords,
                    style: aiCaption.style as CaptionStyle || 'lively',
                    count: localImageGroups.length,
                    mode: aiCaption.mode as CaptionMode || 'diverse',
                    maxLength: 50,
                    language: aiCaption.language || 'en',
                    videoDurationSeconds: estimatedVideoDuration, // 传递视频时长用于匹配文案长度
                });
                console.log('[Slideshow API] AI captions generated:', generatedCaptions);
            } catch (captionError: any) {
                console.error('[Slideshow API] AI caption generation failed:', captionError.message);
                // 继续执行，不阻断流程
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

        if (voice?.enabled && voice.voiceId) {
            console.log('[Slideshow API] Pre-generating voiceovers to get durations...');
            for (let i = 0; i < localImageGroups.length; i++) {
                const rawVoiceText = generatedCaptions[i] || subtitle?.text || '';
                const voiceText = stripEmoji(rawVoiceText); // 过滤 emoji
                if (!voiceText) {
                    voiceovers.push(null);
                    continue;
                }

                if (voiceText !== rawVoiceText) {
                    console.log(`[Slideshow API] Stripped emojis from TTS text: "${rawVoiceText}" -> "${voiceText}"`);
                }

                try {
                    console.log(`[Slideshow API] Generating TTS with timestamps ${i + 1}/${localImageGroups.length}...`);
                    const ttsResult = await textToSpeechWithTimestamps(voice.voiceId, voiceText, {
                        stability: 0.5,
                        similarity_boost: 0.75,
                    });

                    console.log(`[Slideshow API] TTS ${i + 1} generated: ${ttsResult.audio.length} bytes, ${ttsResult.duration.toFixed(2)}s, ${ttsResult.timestamps.length} words`);

                    voiceovers.push({
                        buffer: ttsResult.audio,
                        duration: ttsResult.duration,
                        timestamps: ttsResult.timestamps,
                    });
                } catch (voiceError: any) {
                    console.error(`[Slideshow API] TTS ${i + 1} failed:`, voiceError.message);
                    voiceovers.push(null);
                }
            }
        }

        // 生成视频
        console.log('[Slideshow API] Calling FFmpeg...');
        console.log('[Slideshow API] Total image groups:', localImageGroups.length);
        console.log('[Slideshow API] Images per group:', localImageGroups.map(g => g.length));
        console.log('[Slideshow API] Subtitle config:', JSON.stringify(subtitle, null, 2));
        console.log('[Slideshow API] Voice config:', JSON.stringify(voice, null, 2));
        console.log('[Slideshow API] AI Caption config:', JSON.stringify(aiCaption, null, 2));
        console.log('[Slideshow API] Generated captions:', generatedCaptions);

        // 为每个视频组准备字幕配置（包含配音时长用于同步）
        const subtitleConfigs = localImageGroups.map((_, index) => {
            // 优先使用 AI 生成的文案，否则使用用户手动输入的字幕
            const rawCaptionText = generatedCaptions[index] || subtitle?.text || '';
            if (!rawCaptionText) return undefined;

            // 过滤 emoji 和特殊字符，防止 ASS 字幕生成失败
            const captionText = stripEmoji(rawCaptionText);

            // 获取对应的配音时长（如果有）
            const voiceoverData = voiceovers[index];
            const voiceDuration = voiceoverData?.duration || 0;

            return {
                text: captionText,
                position: subtitle?.position || 80,
                fontSize: subtitle?.fontSize || 36,
                fontColor: subtitle?.fontColor || 'white',
                fontFamily: subtitle?.fontFamily || 'Cinzel-VariableFont_wght',
                borderWidth: subtitle?.borderWidth ?? 2,
                borderColor: subtitle?.borderColor || '#000000',
                shadow: subtitle?.shadow ?? true,
                voiceDuration, // 传递配音时长用于字幕结束时间同步
                wordTimestamps: voiceoverData?.timestamps || [], // 传递词级时间戳用于精确同步
                textOverlays: subtitle?.textOverlays || [], // 图文字幕
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
            subtitleConfigs // 传递字幕配置数组，每个视频使用对应的配置
        );
        console.log('[Slideshow API] FFmpeg completed, results:', results.length);
        // Log each result's status
        results.forEach((r, i) => {
            console.log(`[Slideshow API] Result ${i + 1}: success=${r.success}, path=${r.videoPath}, error=${r.error}`);
        });

        // === 合并配音到视频 ===
        if (voice?.enabled && voice.voiceId) {
            console.log('[Slideshow API] Merging voiceovers into videos...');
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                const voiceoverData = voiceovers[i];

                if (!result.success || !result.videoPath || !voiceoverData) continue;

                try {
                    console.log(`[Slideshow API] Merging voiceover into video ${i + 1}...`);
                    const mergedPath = await mergeVoiceover(result.videoPath, voiceoverData.buffer);
                    results[i].videoPath = mergedPath;
                    console.log(`[Slideshow API] Video ${i + 1} merged: ${mergedPath}`);
                } catch (mergeError: any) {
                    console.error(`[Slideshow API] Merge error for video ${i + 1}:`, mergeError.message);
                    // 继续使用原视频，不阻断流程
                }
            }
        }

        // 上传成功的视频到 OSS
        const videos: { url: string; cost: number }[] = [];
        let successCount = 0;

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            console.log(`[Slideshow API] Processing result ${i + 1}/${results.length}: success=${result.success}`);
            if (result.success && result.videoPath) {
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
 * 将配音合成到视频中（混合 BGM 和配音）
 * @param videoPath 原视频路径（可能已含BGM）
 * @param audioBuffer 配音音频 Buffer
 * @returns 合成后的视频路径
 */
async function mergeVoiceover(videoPath: string, audioBuffer: Buffer): Promise<string> {
    const tempDir = path.dirname(videoPath);
    const voiceoverPath = path.join(tempDir, `voiceover_${Date.now()}.mp3`);
    const outputPath = path.join(tempDir, `final_${Date.now()}.mp4`);

    // 保存配音文件
    await fs.writeFile(voiceoverPath, audioBuffer);

    return new Promise((resolve) => {
        // 配音效果参数
        const VOICE_DELAY_MS = 1000;  // 1 秒延迟
        const VOICE_FADE_IN = 0.5;     // 0.5 秒渐入
        const VOICE_FADE_OUT = 0.3;    // 0.3 秒渐出

        // 使用 FFmpeg amix 滤镜混合配音和 BGM
        // 策略：
        // 1. BGM 用 apad 填充静音以匹配视频时长
        // 2. 配音添加延迟 + 渐入渐出效果
        // 3. 混合后以视频时长为准
        const ffmpegArgs = [
            '-y',
            '-i', videoPath,          // 输入 0: 原视频 (含 BGM)
            '-i', voiceoverPath,      // 输入 1: 配音
            '-filter_complex',
            // BGM: 降低音量 + 填充静音
            '[0:a]volume=0.3,apad[bgm];' +
            // 配音: 延迟1秒 + 渐入0.5秒 + 填充静音
            `[1:a]adelay=${VOICE_DELAY_MS}|${VOICE_DELAY_MS},` +
            `afade=t=in:st=${VOICE_DELAY_MS / 1000}:d=${VOICE_FADE_IN},` +
            'volume=1.0,apad[voice];' +
            // 混合
            '[bgm][voice]amix=inputs=2:duration=first:dropout_transition=3[aout]',
            '-map', '0:v:0',          // 使用原视频流
            '-map', '[aout]',         // 使用混合后的音频
            '-c:v', 'copy',           // 视频直接复制
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',              // 以视频时长为准
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
                    '-shortest',
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

