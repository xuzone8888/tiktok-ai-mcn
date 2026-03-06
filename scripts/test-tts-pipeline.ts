/**
 * 调查脚本：模拟后端完整流程，追踪文本→TTS→音频的全链路
 * 运行: npx tsx scripts/test-tts-pipeline.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DOUBAO_APP_ID = process.env.DOUBAO_TTS_APP_ID;
const DOUBAO_ACCESS_KEY = process.env.DOUBAO_TTS_ACCESS_KEY;

async function generateCaption(): Promise<string[]> {
    console.log('\n=== Step 1: DeepSeek 生成中文文案 (模拟后端) ===');

    const keywords = '美女和狗狗在森林长凳上玩耍';
    const videoDuration = 13; // 13秒视频
    const wordsPerSecond = 4; // 中文 4字/秒
    const recommendedLength = Math.round(videoDuration * wordsPerSecond); // 52字

    console.log(`  关键词: ${keywords}`);
    console.log(`  视频时长: ${videoDuration}s`);
    console.log(`  推荐文案长度: ${recommendedLength}字`);

    const prompt = `You are a social media content writer. Generate 3 different video captions in Chinese.
Topic/keywords: ${keywords}
Each caption MUST be ${recommendedLength} Chinese characters (about ${videoDuration} seconds of speech at normal speed).
Requirements:
- Write in Chinese
- Each caption should be exactly around ${recommendedLength} characters
- No emoji, no hashtags
- Conversational, natural tone
Return ONLY a JSON array of 3 strings. Example: ["caption1", "caption2", "caption3"]`;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            temperature: 0.8,
        }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 提取 JSON
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
        console.log('  ❌ 无法解析 DeepSeek 响应:', content);
        return [];
    }

    const captions: string[] = JSON.parse(jsonMatch[0]);
    captions.forEach((c, i) => {
        console.log(`  📝 文案 #${i + 1} (${c.length}字): "${c}"`);
    });

    return captions;
}

async function testDoubaoTTS(text: string, voiceId: string, index: number): Promise<void> {
    console.log(`\n=== Step 2.${index}: 豆包 TTS 合成 ===`);
    console.log(`  📝 输入文本 (${text.length}字): "${text}"`);
    console.log(`  🗣️ 音色: ${voiceId}`);

    const response = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-App-Id': DOUBAO_APP_ID!,
            'X-Api-Access-Key': DOUBAO_ACCESS_KEY!,
            'X-Api-Resource-Id': 'seed-tts-2.0',
        },
        body: JSON.stringify({
            user: { uid: 'test-user' },
            req_params: {
                text: text,
                speaker: voiceId,
                audio_params: { format: 'mp3', sample_rate: 24000 },
            },
        }),
    });

    console.log(`  📡 HTTP: ${response.status}`);

    const responseText = await response.text();
    const lines = responseText.split('\n').filter(l => l.trim());
    console.log(`  📦 Chunks: ${lines.length}`);

    const audioChunks: Buffer[] = [];
    for (const line of lines) {
        try {
            const chunk = JSON.parse(line);
            const isSuccess = chunk.code === 0 || chunk.code === 20000000;
            if (!isSuccess) {
                console.log(`  ❌ Chunk error: code=${chunk.code}, msg=${chunk.message}`);
                return;
            }
            if (chunk.data) {
                audioChunks.push(Buffer.from(chunk.data, 'base64'));
            }
        } catch { }
    }

    if (audioChunks.length === 0) {
        console.log('  ❌ 无音频数据');
        return;
    }

    const audioBuffer = Buffer.concat(audioChunks);
    const estimatedDuration = audioBuffer.length / 16000; // 当前估算方式

    // 保存 MP3 并用 FFprobe 精确测量
    const tmpPath = path.join(__dirname, `test_tts_${index}.mp3`);
    fs.writeFileSync(tmpPath, audioBuffer);

    let realDuration = 0;
    try {
        const ffprobeOutput = execSync(
            `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${tmpPath}"`,
            { encoding: 'utf-8' }
        ).trim();
        realDuration = parseFloat(ffprobeOutput);
    } catch (e: any) {
        console.log('  ⚠️ FFprobe 不可用，用估算值');
        realDuration = estimatedDuration;
    }

    console.log(`  📊 音频大小: ${audioBuffer.length} bytes`);
    console.log(`  ⏱️ 估算时长 (buffer/16000): ${estimatedDuration.toFixed(2)}s`);
    console.log(`  ⏱️ FFprobe 真实时长: ${realDuration.toFixed(2)}s`);
    console.log(`  📏 差异: ${Math.abs(realDuration - estimatedDuration).toFixed(2)}s`);

    // 计算实际语速
    const charsPerSecond = text.length / realDuration;
    console.log(`  🗣️ 实际语速: ${charsPerSecond.toFixed(1)}字/秒 (DeepSeek 预设: 4字/秒)`);

    // 清理
    fs.unlinkSync(tmpPath);
}

async function main() {
    console.log('========================================');
    console.log('🔍 TTS 全链路调查');
    console.log('========================================');

    // Step 1: 生成文案
    const captions = await generateCaption();
    if (captions.length === 0) return;

    // Step 2: 用第一条文案测试 TTS
    const testVoice = 'zh_female_vv_uranus_bigtts'; // Vivi
    await testDoubaoTTS(captions[0], testVoice, 1);

    // Step 3: 也测一条短文本对比
    const shortText = '大家好，今天给大家分享一个视频。';
    await testDoubaoTTS(shortText, testVoice, 2);

    console.log('\n========================================');
    console.log('🏁 调查完成');
    console.log('========================================');
}

main().catch(console.error);
