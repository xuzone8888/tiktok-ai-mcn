/**
 * TTS 并发性能测试脚本
 * 测试豆包 (中文) 和 ElevenLabs (英文) 在不同并发数下的表现
 *
 * 用法: node scripts/test-tts-concurrency.js
 * 需要在 ECS 上运行（需要 .env.local 里的 API 密钥）
 */

const fs = require('fs');
const path = require('path');

// 从 .env.local 读取环境变量
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && !key.startsWith('#')) {
            process.env[key.trim()] = valueParts.join('=').trim();
        }
    });
}

// ===== 豆包 TTS =====
async function doubaoTTS(voiceId, text) {
    const appId = process.env.DOUBAO_TTS_APP_ID;
    const accessKey = process.env.DOUBAO_TTS_ACCESS_KEY;
    if (!appId || !accessKey) throw new Error('DOUBAO_TTS_APP_ID / DOUBAO_TTS_ACCESS_KEY not set');

    const start = Date.now();
    const resp = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-App-Id': appId,
            'X-Api-Access-Key': accessKey,
            'X-Api-Resource-Id': 'seed-tts-2.0',
        },
        body: JSON.stringify({
            user: { uid: 'toryx-bench' },
            req_params: {
                text,
                speaker: voiceId,
                audio_params: { format: 'mp3', sample_rate: 24000 },
            },
        }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const body = await resp.text();
    const elapsed = Date.now() - start;

    // 解析音频大小
    let audioSize = 0;
    body.split('\n').filter(l => l.trim()).forEach(line => {
        try {
            const chunk = JSON.parse(line);
            if (chunk.data) audioSize += Buffer.from(chunk.data, 'base64').length;
        } catch {}
    });
    return { elapsed, audioSize };
}

// ===== ElevenLabs TTS =====
async function elevenLabsTTS(voiceId, text) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

    const start = Date.now();
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text,
            model_id: 'eleven_flash_v2_5',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const elapsed = Date.now() - start;
    const audioSize = data.audio_base64 ? Buffer.from(data.audio_base64, 'base64').length : 0;
    return { elapsed, audioSize };
}

// ===== 并发测试 =====
async function benchConcurrency(name, fn, concurrencyLevels) {
    console.log(`\n${'━'.repeat(50)}`);
    console.log(`🎤 ${name} — 并发性能测试`);
    console.log(`${'━'.repeat(50)}`);

    for (const concurrency of concurrencyLevels) {
        const tasks = Array(concurrency).fill(null);
        const start = Date.now();
        let successes = 0;
        let failures = 0;
        const results = [];

        try {
            const promises = tasks.map(async (_, i) => {
                try {
                    const result = await fn(i);
                    successes++;
                    return result;
                } catch (err) {
                    failures++;
                    return { elapsed: Date.now() - start, error: err.message.substring(0, 80) };
                }
            });
            const all = await Promise.all(promises);
            results.push(...all);
        } catch (err) {
            console.log(`  ❌ 全部失败: ${err.message}`);
            continue;
        }

        const totalTime = Date.now() - start;
        const avgTime = results.filter(r => !r.error).reduce((s, r) => s + r.elapsed, 0) / successes || 0;
        const throughput = (successes / (totalTime / 1000)).toFixed(1);

        console.log(`  并发 ${String(concurrency).padStart(2)}: ` +
            `✅${successes} ❌${failures} | ` +
            `总 ${(totalTime / 1000).toFixed(1)}s | ` +
            `平均 ${(avgTime / 1000).toFixed(2)}s/个 | ` +
            `吞吐 ${throughput} 个/秒` +
            (failures > 0 ? ` | ⚠️ ${results.filter(r => r.error).map(r => r.error).join('; ')}` : '')
        );

        // 间隔 2 秒，避免上一轮影响下一轮
        await new Promise(r => setTimeout(r, 2000));
    }
}

// ===== 主函数 =====
async function main() {
    console.log('🔬 TTS 并发性能基准测试');
    console.log(`时间: ${new Date().toISOString()}`);

    const zhTexts = [
        '在这个充满机遇的时代，每一步都值得被认真对待',
        '生活就像一杯咖啡，苦涩中带着甘甜',
        '阳光透过窗帘洒在书桌上，温暖了整个午后',
        '每一次尝试都是通向成功的阶梯',
        '用心感受生活中的每一个美好瞬间',
        '人生的旅途中，最美的风景在路上',
        '坚持不懈的努力终将换来丰硕的成果',
        '梦想不会辜负每一个为之奋斗的人',
    ];

    const enTexts = [
        'Every great journey begins with a single step forward',
        'Life is a beautiful adventure waiting to unfold',
        'The sunshine breaks through the clouds after the storm',
        'Success comes to those who dare to dream big',
        'Embrace every moment with an open heart and mind',
        'The beauty of life is in its unpredictable moments',
        'Hard work and dedication lead to extraordinary results',
        'Every challenge is an opportunity in disguise',
    ];

    const CONCURRENCY_LEVELS = [1, 2, 3, 5, 8];

    // 豆包中文测试
    const zhVoiceId = 'zh_female_wanwanxiaohe_moon_bigtts';
    await benchConcurrency('豆包 TTS (中文)', (i) => {
        return doubaoTTS(zhVoiceId, zhTexts[i % zhTexts.length]);
    }, CONCURRENCY_LEVELS);

    console.log('\n⏳ 等待 5 秒后测试 ElevenLabs...\n');
    await new Promise(r => setTimeout(r, 5000));

    // ElevenLabs 英文测试
    const enVoiceId = 'EXAVITQu4vr4xnSDxMaL'; // Sarah
    await benchConcurrency('ElevenLabs TTS (英文)', (i) => {
        return elevenLabsTTS(enVoiceId, enTexts[i % enTexts.length]);
    }, CONCURRENCY_LEVELS);

    console.log(`\n${'━'.repeat(50)}`);
    console.log('✅ 测试完成');
}

main().catch(console.error);
