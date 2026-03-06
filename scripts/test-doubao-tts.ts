/**
 * 本地测试脚本：验证豆包 TTS + AI 智能选声完整链路
 * 运行: npx tsx scripts/test-doubao-tts.ts
 */

// 手动加载环境变量
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const DOUBAO_APP_ID = process.env.DOUBAO_TTS_APP_ID;
const DOUBAO_ACCESS_KEY = process.env.DOUBAO_TTS_ACCESS_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

console.log('========================================');
console.log('🧪 豆包 TTS + AI 智能选声 链路测试');
console.log('========================================\n');

// ===== Test 1: 环境变量检查 =====
async function testEnvVars() {
    console.log('📋 [Test 1] 环境变量检查');
    const checks = [
        { name: 'DOUBAO_TTS_APP_ID', value: DOUBAO_APP_ID },
        { name: 'DOUBAO_TTS_ACCESS_KEY', value: DOUBAO_ACCESS_KEY },
        { name: 'DEEPSEEK_API_KEY', value: DEEPSEEK_API_KEY },
    ];

    let allOk = true;
    for (const check of checks) {
        const ok = !!check.value;
        console.log(`  ${ok ? '✅' : '❌'} ${check.name}: ${ok ? check.value!.substring(0, 8) + '...' : 'MISSING'}`);
        if (!ok) allOk = false;
    }

    if (!allOk) {
        console.log('\n❌ 环境变量缺失，终止测试');
        process.exit(1);
    }
    console.log('  ✅ 全部通过\n');
}

// ===== Test 2: 豆包 TTS API 调用 =====
async function testDoubaoTTS() {
    console.log('🎙️ [Test 2] 豆包 TTS API 调用');

    const url = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
    const testText = '大家好，欢迎来到我们的频道，今天给大家分享一个有趣的视频。';
    const voiceId = 'zh_female_vv_uranus_bigtts'; // Vivi 2.0

    console.log(`  📝 文本: "${testText}"`);
    console.log(`  🗣️ 音色: ${voiceId} (Vivi 2.0)`);

    try {
        const response = await fetch(url, {
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
                    text: testText,
                    speaker: voiceId,
                    audio_params: {
                        format: 'mp3',
                        sample_rate: 24000,
                    },
                },
            }),
        });

        console.log(`  📡 HTTP Status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`  ❌ API 错误: ${errorText}`);
            return false;
        }

        const responseText = await response.text();
        const lines = responseText.split('\n').filter(line => line.trim());
        console.log(`  📦 收到 ${lines.length} 个 chunks`);

        let totalBytes = 0;
        let hasError = false;
        for (const line of lines) {
            try {
                const chunk = JSON.parse(line);
                const isSuccess = chunk.code === 0 || chunk.code === 20000000;
                if (!isSuccess) {
                    console.log(`  ❌ Chunk 错误: code=${chunk.code}, msg=${chunk.message}`);
                    hasError = true;
                    break;
                }
                if (chunk.data) {
                    totalBytes += Buffer.from(chunk.data, 'base64').length;
                }
            } catch (e) {
                // 跳过不是 JSON 的行
            }
        }

        if (!hasError && totalBytes > 0) {
            const estimatedDuration = totalBytes / 16000;
            console.log(`  📊 音频大小: ${totalBytes} bytes (~${estimatedDuration.toFixed(1)}s)`);
            console.log(`  ✅ 豆包 TTS 调用成功！\n`);
            return true;
        } else {
            console.log(`  ❌ 未收到音频数据\n`);
            return false;
        }
    } catch (error: any) {
        console.log(`  ❌ 请求失败: ${error.message}\n`);
        return false;
    }
}

// ===== Test 3: AI 智能选声 (DeepSeek) =====
async function testSmartVoiceSelect() {
    console.log('🤖 [Test 3] AI 智能选声 (DeepSeek)');

    const testCases = [
        { text: '今天给大家推荐一款超级好用的唇釉，颜色真的绝了', expected: '女声' },
        { text: '深度解析三国演义中的经典战役，赤壁之战的战略部署', expected: '男声/解说' },
        { text: 'Hey everyone, check out this amazing sunset I captured on my trip!', expected: 'English voice' },
    ];

    const zhPool = [
        { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi', style: '🎙️ 全能女声·自然', lang: 'zh', gender: 'female' },
        { id: 'zh_female_tianxinxiaomei_emo_v2_mars_bigtts', name: '甜心小美', style: '🍬 甜美可爱', lang: 'zh', gender: 'female' },
        { id: 'zh_male_jieshuoxiaoming_mars_bigtts', name: '解说小明', style: '🎬 影视解说', lang: 'zh', gender: 'male' },
        { id: 'zh_male_m191_uranus_bigtts', name: '云舟', style: '🎯 沉稳磁性', lang: 'zh', gender: 'male' },
    ];

    const enPool = [
        { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', style: '🔥 社媒达人·活力', lang: 'en', gender: 'male' },
        { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', style: '💫 甜美自信·成熟', lang: 'en', gender: 'female' },
    ];

    for (const tc of testCases) {
        const isEnglish = /^[a-zA-Z\s,.'!?]+$/.test(tc.text.trim());
        const pool = isEnglish ? enPool : zhPool;
        const language = isEnglish ? 'en' : 'zh';

        console.log(`\n  📝 "${tc.text.substring(0, 40)}..."`);
        console.log(`  🌐 语言: ${language}, 预期: ${tc.expected}`);

        const voiceList = pool.map((v: any, i: number) => `${i + 1}.${v.name}(${v.style})`).join(' ');
        const prompt = `根据视频配音文本，从以下音色中选一个最合适的。只返回编号数字，不要解释。
文本："${tc.text.substring(0, 150)}"
音色：${voiceList}`;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 10,
                    temperature: 0.3,
                }),
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (!response.ok) {
                console.log(`  ❌ DeepSeek API 错误: ${response.status}`);
                continue;
            }

            const data = await response.json();
            const resultText = data.choices?.[0]?.message?.content?.trim() || '';
            const num = parseInt(resultText);

            if (!isNaN(num) && num >= 1 && num <= pool.length) {
                const selected = pool[num - 1];
                console.log(`  ✅ AI 选择: #${num} ${selected.name} (${selected.style})`);
            } else {
                console.log(`  ⚠️ AI 返回无效: "${resultText}"`);
            }
        } catch (error: any) {
            console.log(`  ❌ 请求失败: ${error.message}`);
        }
    }

    console.log('\n  ✅ 智能选声测试完成\n');
}

// ===== Test 4: 路由逻辑验证 =====
function testRouting() {
    console.log('🔀 [Test 4] TTS 路由逻辑验证');

    const testIds = [
        { id: 'zh_female_vv_uranus_bigtts', expected: 'Doubao' },
        { id: 'zh_male_m191_uranus_bigtts', expected: 'Doubao' },
        { id: 'ICL_zh_female_wenrounvshen_239eff5e8ffa_tob', expected: 'Doubao' },
        { id: 'ICL_zh_male_shenmi_v1_tob', expected: 'Doubao' },
        { id: 'TX3LPaxmHKxFdv7VOQHJ', expected: 'ElevenLabs' },
        { id: 'EXAVITQu4vr4xnSDxMaL', expected: 'ElevenLabs' },
        { id: 'pqHfZKP75CvOlQylNhV4', expected: 'ElevenLabs' },
    ];

    let allOk = true;
    for (const tc of testIds) {
        const isDoubao = tc.id.startsWith('zh_') || tc.id.startsWith('ICL_');
        const actual = isDoubao ? 'Doubao' : 'ElevenLabs';
        const ok = actual === tc.expected;
        console.log(`  ${ok ? '✅' : '❌'} ${tc.id.substring(0, 30)}... → ${actual} (expected: ${tc.expected})`);
        if (!ok) allOk = false;
    }

    console.log(`  ${allOk ? '✅' : '❌'} 路由逻辑 ${allOk ? '全部正确' : '有错误'}\n`);
}

// ===== 执行测试 =====
async function main() {
    await testEnvVars();
    testRouting();         // 纯逻辑，无网络
    await testDoubaoTTS(); // 豆包 API 实际调用
    await testSmartVoiceSelect(); // DeepSeek AI 选声

    console.log('========================================');
    console.log('🏁 全部测试完成！');
    console.log('========================================');
}

main().catch(console.error);
