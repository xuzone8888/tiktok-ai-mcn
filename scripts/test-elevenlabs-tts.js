/**
 * 测试 ElevenLabs TTS + AI 配音集成到视频
 * 运行: node scripts/test-elevenlabs-tts.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const OUTPUT_DIR = path.join(__dirname, '..', '.temp', 'tts-test');
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

// 预设音色
const PRESET_VOICES = [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', style: '甜美清晰' },
    { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', style: '磁性温暖' },
];

async function textToSpeech(voiceId, text) {
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
                    stability: 0.5,
                    similarity_boost: 0.75,
                },
            }),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ElevenLabs TTS error: ${response.status} - ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return Buffer.from(audioBuffer);
}

async function testTTS() {
    console.log('=== ElevenLabs TTS 测试 ===\n');

    if (!ELEVENLABS_API_KEY) {
        console.error('❌ 未配置 ELEVENLABS_API_KEY');
        return;
    }
    console.log(`API Key: ${ELEVENLABS_API_KEY.slice(0, 10)}...`);

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

        const audioBuffer = await textToSpeech(voice.id, testText);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ TTS 成功! 耗时: ${duration}s, 音频大小: ${audioBuffer.length} 字节`);

        // 保存音频文件
        const audioPath = path.join(OUTPUT_DIR, 'test_voiceover.mp3');
        fs.writeFileSync(audioPath, audioBuffer);
        console.log(`   保存至: ${audioPath}`);

        // 尝试合成到视频
        await testMergeAudioToVideo(audioPath);

    } catch (error) {
        console.error('❌ TTS 失败:', error.message);
    }
}

async function testMergeAudioToVideo(audioPath) {
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

    try {
        await runPython(pythonScript, args);
    } catch (err) {
        console.error('   ❌ 基础视频生成失败:', err.message);
        return;
    }

    if (!fs.existsSync(baseVideoPath)) {
        console.error('❌ 基础视频文件不存在');
        return;
    }
    const baseStats = fs.statSync(baseVideoPath);
    console.log(`   ✅ 基础视频: ${baseVideoPath} (${(baseStats.size / 1024).toFixed(1)} KB)`);

    // 使用 FFmpeg 合成音频
    console.log('\n2. 合成配音到视频...');

    const ffmpegArgs = [
        '-y',
        '-i', baseVideoPath,
        '-i', audioPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        finalVideoPath,
    ];

    try {
        await runCommand('ffmpeg', ffmpegArgs);
    } catch (err) {
        console.error('   ❌ 音频合成失败:', err.message);
        return;
    }

    if (fs.existsSync(finalVideoPath)) {
        const stats = fs.statSync(finalVideoPath);
        console.log(`   ✅ 最终视频: ${finalVideoPath}`);
        console.log(`      大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log('\n🎉 AI 配音集成测试成功！');
    } else {
        console.error('❌ 最终视频文件不存在');
    }
}

function runPython(script, args) {
    return new Promise((resolve, reject) => {
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        const proc = spawn(pythonCmd, [script, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`Python exited with code ${code}: ${stderr.slice(0, 300)}`));
            }
        });
    });
}

function runCommand(cmd, args) {
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
                reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 300)}`));
            }
        });
    });
}

testTTS().catch(console.error);
