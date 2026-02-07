/**
 * ElevenLabs TTS API 封装
 * 用于生成视频配音
 */

// API 密钥从环境变量获取
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

export interface Voice {
    voice_id: string;
    name: string;
    preview_url?: string;
    labels?: Record<string, string>;
}

export interface VoiceSettings {
    stability: number;        // 0-1, 稳定性
    similarity_boost: number; // 0-1, 相似度
    style?: number;           // 0-1, 风格强度 (可选)
    use_speaker_boost?: boolean;
}

interface ElevenLabsError extends Error {
    code?: string;
    status?: number;
}

/**
 * 获取可用音色列表
 */
export async function getVoices(): Promise<Voice[]> {
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY in environment.');
    }

    try {
        const response = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
            method: 'GET',
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
            },
        });

        if (!response.ok) {
            const error = new Error(`ElevenLabs API error: ${response.status}`) as ElevenLabsError;
            error.status = response.status;
            throw error;
        }

        const data = await response.json();
        return data.voices || [];
    } catch (error) {
        console.error('[ElevenLabs getVoices Error]:', error);
        throw error;
    }
}

/**
 * 生成单条配音
 * @param voiceId 音色 ID
 * @param text 文本内容
 * @param settings 音色设置
 * @returns 音频 Buffer (mpeg 格式)
 */
export async function textToSpeech(
    voiceId: string,
    text: string,
    settings: VoiceSettings = { stability: 0.5, similarity_boost: 0.75 }
): Promise<Buffer> {
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY in environment.');
    }

    if (!text.trim()) {
        throw new Error('Text content is required for TTS');
    }

    try {
        const response = await fetch(
            `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mpeg',
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: {
                        stability: settings.stability,
                        similarity_boost: settings.similarity_boost,
                        style: settings.style,
                        use_speaker_boost: settings.use_speaker_boost,
                    },
                }),
            }
        );

        if (!response.ok) {
            const error = new Error(`ElevenLabs TTS error: ${response.status}`) as ElevenLabsError;
            error.status = response.status;
            throw error;
        }

        // 返回音频流 (mpeg)
        const audioBuffer = await response.arrayBuffer();
        return Buffer.from(audioBuffer);
    } catch (error) {
        console.error('[ElevenLabs TTS Error]:', error);
        throw error;
    }
}

/**
 * 词级时间戳数据
 */
export interface WordTimestamp {
    word: string;
    start: number;  // 开始时间（秒）
    end: number;    // 结束时间（秒）
}

/**
 * 带时间戳的 TTS 结果
 */
export interface TTSWithTimestampsResult {
    audio: Buffer;           // 音频数据
    timestamps: WordTimestamp[];  // 词级时间戳
    duration: number;        // 总时长（秒）
}

/**
 * 生成带词级时间戳的配音
 * 使用 ElevenLabs 的 /with-timestamps 端点
 * @param voiceId 音色 ID
 * @param text 文本内容
 * @param settings 音色设置
 * @returns 音频 Buffer 和词级时间戳
 */
export async function textToSpeechWithTimestamps(
    voiceId: string,
    text: string,
    settings: VoiceSettings = { stability: 0.5, similarity_boost: 0.75 }
): Promise<TTSWithTimestampsResult> {
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY in environment.');
    }

    if (!text.trim()) {
        throw new Error('Text content is required for TTS');
    }

    try {
        const response = await fetch(
            `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}/with-timestamps`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: {
                        stability: settings.stability,
                        similarity_boost: settings.similarity_boost,
                        style: settings.style,
                        use_speaker_boost: settings.use_speaker_boost,
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[ElevenLabs TTS with Timestamps Error]:', errorText);
            const error = new Error(`ElevenLabs TTS error: ${response.status}`) as ElevenLabsError;
            error.status = response.status;
            throw error;
        }

        // 返回 JSON 格式，包含 audio_base64 和 alignment
        const data = await response.json();

        // 解码 base64 音频
        const audioBuffer = Buffer.from(data.audio_base64, 'base64');

        // 解析时间戳
        // ElevenLabs 返回 alignment 对象，包含 characters 和 character_start_times_seconds, character_end_times_seconds
        // 或者 normalized_alignment 包含 chars, charStartTimesMs, charDurationsMs
        const timestamps: WordTimestamp[] = [];

        if (data.alignment) {
            const { characters, character_start_times_seconds, character_end_times_seconds } = data.alignment;

            // 将字符级时间戳转换为词级时间戳
            if (characters && character_start_times_seconds && character_end_times_seconds) {
                let currentWord = '';
                let wordStart = 0;
                let wordEnd = 0;

                for (let i = 0; i < characters.length; i++) {
                    const char = characters[i];
                    const startTime = character_start_times_seconds[i];
                    const endTime = character_end_times_seconds[i];

                    if (char === ' ' || char === '\n') {
                        // 空格/换行表示词结束
                        if (currentWord.trim()) {
                            timestamps.push({
                                word: currentWord.trim(),
                                start: wordStart,
                                end: wordEnd,
                            });
                        }
                        currentWord = '';
                        wordStart = endTime;
                    } else {
                        if (currentWord === '') {
                            wordStart = startTime;
                        }
                        currentWord += char;
                        wordEnd = endTime;
                    }
                }

                // 添加最后一个词
                if (currentWord.trim()) {
                    timestamps.push({
                        word: currentWord.trim(),
                        start: wordStart,
                        end: wordEnd,
                    });
                }
            }
        }

        // 计算总时长
        const duration = timestamps.length > 0
            ? timestamps[timestamps.length - 1].end
            : 0;

        console.log(`[ElevenLabs] TTS with timestamps: ${timestamps.length} words, ${duration.toFixed(2)}s`);

        return {
            audio: audioBuffer,
            timestamps,
            duration,
        };
    } catch (error: any) {
        console.error('[ElevenLabs TTS with Timestamps Error]:', error.message || error);
        console.log('[ElevenLabs] Falling back to regular TTS without timestamps...');

        // 回退到普通 TTS
        try {
            const fallbackAudio = await textToSpeech(voiceId, text, settings);
            // 估算时长 (MP3 约 128kbps = 16KB/s)
            const estimatedDuration = fallbackAudio.length / 16000;

            console.log(`[ElevenLabs] Fallback TTS: ${fallbackAudio.length} bytes, ~${estimatedDuration.toFixed(1)}s (no timestamps)`);

            return {
                audio: fallbackAudio,
                timestamps: [], // 没有时间戳，让 Python 脚本使用分句逻辑
                duration: estimatedDuration,
            };
        } catch (fallbackError) {
            console.error('[ElevenLabs Fallback TTS Error]:', fallbackError);
            throw fallbackError;
        }
    }
}

/**
 * 批量生成配音（每条视频独立调用，防止重复）
 * @param voiceId 音色 ID
 * @param captions 文案列表
 * @param settings 音色设置
 * @param delayMs 请求间隔（避免速率限制）
 * @returns 音频 Buffer 数组
 */
export async function generateVoiceovers(
    voiceId: string,
    captions: string[],
    settings: VoiceSettings = { stability: 0.5, similarity_boost: 0.75 },
    delayMs: number = 500
): Promise<Buffer[]> {
    const audioFiles: Buffer[] = [];

    for (let i = 0; i < captions.length; i++) {
        const caption = captions[i];

        if (!caption.trim()) {
            // 跳过空文案，生成空 Buffer 占位
            audioFiles.push(Buffer.alloc(0));
            continue;
        }

        const audio = await textToSpeech(voiceId, caption, settings);
        audioFiles.push(audio);

        // 间隔避免速率限制（最后一条不需要等待）
        if (i < captions.length - 1 && delayMs > 0) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }

    return audioFiles;
}

/**
 * 预设推荐音色
 * 这些是 ElevenLabs 提供的标准音色，可直接使用
 */
export const PRESET_VOICES: { id: string; name: string; gender: 'male' | 'female'; style: string }[] = [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', style: '甜美清晰' },
    { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male', style: '磁性温暖' },
    { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', style: '优雅成熟' },
    { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', gender: 'male', style: '沉稳专业' },
    { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', style: '活力阳光' },
];
