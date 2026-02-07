/**
 * 全功能测试: DeepSeek AI 文案 + ElevenLabs TTS + FFmpeg 视频合成
 * 运行: node scripts/test-ai-full-pipeline.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const OUTPUT_DIR = path.join(__dirname, '..', '.temp', 'ai-pipeline-test');
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1/chat/completions';

// 预设音色
const VOICE = { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', style: '甜美清晰' };

/**
 * Step 1: 调用 DeepSeek 生成 AI 文案
 */
async function generateAICaption(keywords, style = 'lively') {
    console.log('\n=== Step 1: DeepSeek AI 文案生成 ===');
    console.log(`关键词: ${keywords}`);
    console.log(`风格: ${style}`);

    const prompt = `为短视频生成 1 条吸引人的文案。
关键词：${keywords}
风格：活泼有趣，使用轻松的语气
要求：
- 控制在 50 字以内
- 适合作为视频配音朗读
返回 JSON 格式：{"caption": "文案内容"}`;

    const response = await fetch(DEEPSEEK_API_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: '你是短视频文案专家，擅长生成简短有吸引力的文案。始终返回有效的 JSON 格式。',
                },
                { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.8,
            max_tokens: 200,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    const caption = parsed.caption || parsed.captions?.[0];

    console.log(`✅ AI 文案: "${caption}"`);
    return caption;
}

/**
 * Step 2: 调用 ElevenLabs 生成配音
 */
async function generateVoiceover(text) {
    console.log('\n=== Step 2: ElevenLabs TTS 配音生成 ===');
    console.log(`音色: ${VOICE.name} (${VOICE.style})`);
    console.log(`文本: ${text}`);

    const startTime = Date.now();
    const response = await fetch(
        `${ELEVENLABS_API_BASE}/text-to-speech/${VOICE.id}`,
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
    const buffer = Buffer.from(audioBuffer);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`✅ TTS 完成! 耗时: ${duration}s, 大小: ${buffer.length} 字节`);
    return buffer;
}

/**
 * Step 3: 生成带字幕的视频
 */
async function generateVideoWithSubtitle(caption) {
    console.log('\n=== Step 3: FFmpeg 视频生成 (带字幕) ===');

    const testImages = [
        path.join(__dirname, '..', 'public', 'images', 'toryx_logo_dark.png'),
        path.join(__dirname, '..', 'public', 'images', 'toryx_logo_final.png'),
    ];

    const videoPath = path.join(OUTPUT_DIR, 'video_with_subtitle.mp4');
    const pythonScript = path.join(__dirname, 'ffmpeg-slideshow.py');

    const subtitle = {
        text: caption,
        position: 80,
        fontSize: 36,
        fontColor: 'white',
        fontFamily: 'Cinzel-VariableFont_wght',
        borderWidth: 2,
        borderColor: 'black',
        shadow: true,
    };

    const args = [
        '--images', JSON.stringify(testImages),
        '--output', videoPath,
        '--aspect', '9:16',
        '--duration', '4',
        '--transition', 'fade',
        '--subtitle', JSON.stringify(subtitle),
    ];

    await runPython(pythonScript, args);

    if (fs.existsSync(videoPath)) {
        const stats = fs.statSync(videoPath);
        console.log(`✅ 视频生成! 大小: ${(stats.size / 1024).toFixed(1)} KB`);
        return videoPath;
    } else {
        throw new Error('视频文件未创建');
    }
}

/**
 * Step 4: 将配音合成到视频
 */
async function mergeVoiceoverToVideo(videoPath, audioBuffer) {
    console.log('\n=== Step 4: FFmpeg 配音合成 ===');

    const audioPath = path.join(OUTPUT_DIR, 'voiceover.mp3');
    const finalVideoPath = path.join(OUTPUT_DIR, 'final_video_with_ai.mp4');

    // 保存音频
    fs.writeFileSync(audioPath, audioBuffer);
    console.log(`音频保存: ${audioPath}`);

    // 合成音频到视频
    const ffmpegArgs = [
        '-y',
        '-i', videoPath,
        '-i', audioPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        finalVideoPath,
    ];

    await runCommand('ffmpeg', ffmpegArgs);

    if (fs.existsSync(finalVideoPath)) {
        const stats = fs.statSync(finalVideoPath);
        console.log(`✅ 最终视频! 大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        return finalVideoPath;
    } else {
        throw new Error('最终视频文件未创建');
    }
}

/**
 * 主测试流程
 */
async function runFullPipelineTest() {
    console.log('='.repeat(60));
    console.log('   AI 全流程测试: 文案生成 → TTS → 视频合成');
    console.log('='.repeat(60));

    // 检查 API 密钥
    if (!DEEPSEEK_API_KEY) {
        console.error('❌ 未配置 DEEPSEEK_API_KEY');
        return;
    }
    if (!ELEVENLABS_API_KEY) {
        console.error('❌ 未配置 ELEVENLABS_API_KEY');
        return;
    }
    console.log('✅ API 密钥已配置');

    // 确保输出目录存在
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    try {
        // Step 1: AI 文案
        const caption = await generateAICaption('科技产品, 创新, 未来');

        // Step 2: TTS 配音
        const voiceoverBuffer = await generateVoiceover(caption);

        // Step 3: 生成带字幕的视频
        const videoPath = await generateVideoWithSubtitle(caption);

        // Step 4: 合成配音
        const finalVideoPath = await mergeVoiceoverToVideo(videoPath, voiceoverBuffer);

        console.log('\n' + '='.repeat(60));
        console.log('🎉 AI 全流程测试成功!');
        console.log('='.repeat(60));
        console.log(`\n最终视频: ${finalVideoPath}`);
        console.log('\n功能验证:');
        console.log('  ✅ DeepSeek AI 文案生成');
        console.log('  ✅ ElevenLabs TTS 配音');
        console.log('  ✅ FFmpeg 视频+字幕生成');
        console.log('  ✅ FFmpeg 配音合成');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
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
                reject(new Error(`Python exited with code ${code}: ${stderr.slice(0, 500)}`));
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

runFullPipelineTest().catch(console.error);
