/**
 * 测试 ElevenLabs TTS + AI 配音集成到视频
 * 运行: npx ts-node --esm scripts/test-elevenlabs-tts.ts
 * 或: node -r dotenv/config -e "require('ts-node').register(); require('./scripts/test-elevenlabs-tts.ts')"
 */

import * as fs from 'fs';
import * as path from 'path';
import { textToSpeech, PRESET_VOICES } from '../src/lib/elevenlabs-api';
import { spawn } from 'child_process';

const OUTPUT_DIR = path.join(__dirname, '..', '.temp', 'tts-test');

async function testTTS() {
    console.log('=== ElevenLabs TTS 测试 ===\n');

    // 确保输出目录存在
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // 测试文本
    const testText = '这是一段测试配音。欢迎使用 ToryX AI 视频生成平台，让创作变得更简单！';

    // 使用第一个预设音色
    const voice = PRESET_VOICES[0];
    console.log(`使用音色: ${voice.name} (${voice.style})`);
    console.log(`测试文本: ${testText}\n`);

    try {
        console.log('正在调用 ElevenLabs API...');
        const startTime = Date.now();

        const audioBuffer = await textToSpeech(voice.id, testText, {
            stability: 0.5,
            similarity_boost: 0.75,
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ TTS 成功! 耗时: ${duration}s, 音频大小: ${audioBuffer.length} 字节`);

        // 保存音频文件
        const audioPath = path.join(OUTPUT_DIR, 'test_voiceover.mp3');
        fs.writeFileSync(audioPath, audioBuffer);
        console.log(`   保存至: ${audioPath}`);

        // 尝试合成到视频
        await testMergeAudioToVideo(audioPath);

    } catch (error: any) {
        console.error('❌ TTS 失败:', error.message);
        if (error.message.includes('API key')) {
            console.log('\n请确保 .env.local 中配置了有效的 ELEVENLABS_API_KEY');
        }
    }
}

async function testMergeAudioToVideo(audioPath: string) {
    console.log('\n=== 测试音频合成到视频 ===\n');

    const testImages = [
        path.join(__dirname, '..', 'public', 'images', 'toryx_logo_dark.png'),
        path.join(__dirname, '..', 'public', 'images', 'toryx_logo_final.png'),
    ];

    // 首先生成一个基础视频
    const baseVideoPath = path.join(OUTPUT_DIR, 'base_video.mp4');
    const finalVideoPath = path.join(OUTPUT_DIR, 'video_with_voiceover.mp4');

    console.log('1. 生成基础视频...');

    const pythonScript = path.join(__dirname, 'ffmpeg-slideshow.py');
    const args = [
        '--images', JSON.stringify(testImages),
        '--output', baseVideoPath,
        '--aspect', '9:16',
        '--duration', '3',
        '--transition', 'fade',
    ];

    await runPython(pythonScript, args);

    if (!fs.existsSync(baseVideoPath)) {
        console.error('❌ 基础视频生成失败');
        return;
    }
    console.log(`   ✅ 基础视频: ${baseVideoPath}`);

    // 使用 FFmpeg 合成音频
    console.log('\n2. 合成配音到视频...');

    const ffmpegArgs = [
        '-y',
        '-i', baseVideoPath,
        '-i', audioPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        // 配音作为主音轨，可以和 BGM 混合
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        finalVideoPath,
    ];

    await runCommand('ffmpeg', ffmpegArgs);

    if (fs.existsSync(finalVideoPath)) {
        const stats = fs.statSync(finalVideoPath);
        console.log(`   ✅ 最终视频: ${finalVideoPath}`);
        console.log(`   大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    } else {
        console.error('❌ 音频合成失败');
    }
}

function runPython(script: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        const proc = spawn(pythonCmd, [script, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Python exited with code ${code}: ${stderr}`));
            }
        });
    });
}

function runCommand(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 500)}`));
            }
        });
    });
}

// 加载环境变量并运行
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
testTTS().catch(console.error);
