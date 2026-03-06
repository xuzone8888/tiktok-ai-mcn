/**
 * 豆包 TTS 2.0 API 封装
 * 用于中文视频配音
 * 接口与 elevenlabs-api.ts 对齐，返回 { audio, timestamps, duration }
 */

import type { WordTimestamp } from './elevenlabs-api';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 环境变量
const DOUBAO_APP_ID = process.env.DOUBAO_TTS_APP_ID;
const DOUBAO_ACCESS_KEY = process.env.DOUBAO_TTS_ACCESS_KEY;
const DOUBAO_API_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

/**
 * 根据 voiceId 前缀动态选择 Resource ID
 * - ICL_ 开头的音色（声音复刻）需要 seed-icl-1.0
 * - zh_ 开头的标准音色使用 seed-tts-2.0
 */
function getResourceId(voiceId: string): string {
    if (voiceId.startsWith('ICL_')) {
        return 'seed-icl-1.0';
    }
    return 'seed-tts-2.0';
}

interface DoubaoTTSResult {
    audio: Buffer;
    timestamps: WordTimestamp[];
    duration: number;
}

/**
 * 用 FFprobe 精确测量 MP3 音频时长
 * 回退到 buffer 估算（8KB/s，豆包 MP3 约 64kbps）
 */
function getAudioDuration(audioBuffer: Buffer): number {
    const tmpPath = path.join(os.tmpdir(), `doubao_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
    try {
        fs.writeFileSync(tmpPath, audioBuffer);
        const output = execSync(
            `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${tmpPath}"`,
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        const duration = parseFloat(output);
        if (!isNaN(duration) && duration > 0) {
            return duration;
        }
    } catch (e: any) {
        console.warn('[Doubao TTS] FFprobe failed, using buffer estimate:', e.message);
    } finally {
        try { fs.unlinkSync(tmpPath); } catch { }
    }
    // 回退：豆包 MP3 约 64kbps = 8KB/s
    return audioBuffer.length / 8000;
}

/**
 * 豆包 TTS 合成（带时间戳接口，兼容 ElevenLabs 返回结构）
 * 注意：豆包 V3 不返回词级时间戳，timestamps 为空数组
 * Python 脚本会回退到分句逻辑处理
 */
export async function doubaoTextToSpeechWithTimestamps(
    voiceId: string,
    text: string,
): Promise<DoubaoTTSResult> {
    if (!DOUBAO_APP_ID || !DOUBAO_ACCESS_KEY) {
        throw new Error('Doubao TTS not configured. Set DOUBAO_TTS_APP_ID and DOUBAO_TTS_ACCESS_KEY in environment.');
    }

    if (!text.trim()) {
        throw new Error('Text content is required for TTS');
    }

    const resourceId = getResourceId(voiceId);
    console.log(`[Doubao TTS] Generating: voice=${voiceId}, resource=${resourceId}, text="${text.substring(0, 50)}..."`);

    try {
        const response = await fetch(DOUBAO_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-App-Id': DOUBAO_APP_ID,
                'X-Api-Access-Key': DOUBAO_ACCESS_KEY,
                'X-Api-Resource-Id': resourceId,
            },
            body: JSON.stringify({
                user: { uid: 'toryx-tts-user' },
                req_params: {
                    text: text,
                    speaker: voiceId,
                    audio_params: {
                        format: 'mp3',
                        sample_rate: 24000,
                    },
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Doubao TTS] HTTP Error:', response.status, errorText);
            throw new Error(`Doubao TTS error: ${response.status} - ${errorText}`);
        }

        // 响应是 Chunked JSON，每行一个 JSON 对象
        const responseText = await response.text();
        const audioChunks: Buffer[] = [];

        // 按行解析 JSON chunks
        const lines = responseText.split('\n').filter(line => line.trim());
        for (const line of lines) {
            try {
                const chunk = JSON.parse(line);
                // 豆包 V3 成功码: 0 或 20000000 ("OK")
                const isSuccess = chunk.code === 0 || chunk.code === 20000000;
                if (!isSuccess) {
                    console.error('[Doubao TTS] Chunk error:', chunk);
                    throw new Error(`Doubao TTS chunk error: code=${chunk.code}, msg=${chunk.message}`);
                }
                if (chunk.data) {
                    audioChunks.push(Buffer.from(chunk.data, 'base64'));
                }
            } catch (parseError: any) {
                // 某些行可能不是有效 JSON（如空行），跳过
                if (parseError.message?.includes('Doubao TTS chunk error')) {
                    throw parseError;
                }
                // 静默跳过无法解析的行
            }
        }

        if (audioChunks.length === 0) {
            throw new Error('Doubao TTS returned no audio data');
        }

        // 拼接所有音频块
        const audioBuffer = Buffer.concat(audioChunks);

        // 用 FFprobe 精确测量时长
        const duration = getAudioDuration(audioBuffer);

        console.log(`[Doubao TTS] Success: ${audioBuffer.length} bytes, ${duration.toFixed(2)}s (FFprobe)`);

        return {
            audio: audioBuffer,
            timestamps: [], // 豆包不提供词级时间戳，Python 脚本会回退到分句逻辑
            duration,
        };
    } catch (error: any) {
        console.error('[Doubao TTS Error]:', error.message || error);
        throw error;
    }
}

