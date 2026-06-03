/**
 * 视频 API 线路连通性测试
 */
const https = require('https');

const SORA2_KEY = process.env.SORA2_API_KEY || process.env.VIDEO_PLATFORM_API_KEY || '';
const WUYIN_KEY = process.env.WUYIN_API_KEY || '';

async function testAPI(name, fn) {
    console.log(`\n[${name}] Testing...`);
    try {
        const result = await fn();
        console.log(`[${name}] ✅ OK:`, result);
    } catch (e) {
        console.log(`[${name}] ❌ FAILED:`, e.message);
    }
}

// Line1 (scd666) - 默认线路
async function testLine1() {
    if (!SORA2_KEY) throw new Error('Missing SORA2_API_KEY or VIDEO_PLATFORM_API_KEY');
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ prompt: 'A cute cat walking in garden', model: 'sora2-portrait' });
        const req = https.request({
            hostname: 'api.scd666.com',
            path: '/v1/videos',
            method: 'POST',
            family: 4,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + SORA2_KEY,
            },
            timeout: 30000
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (j.id) resolve('Task ID: ' + j.id);
                    else resolve('Code: ' + res.statusCode + ', Response: ' + data.substring(0, 150));
                } catch {
                    resolve('Code: ' + res.statusCode + ', Raw: ' + data.substring(0, 100));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(body);
        req.end();
    });
}

// Line2 (wuyin) - 备用线路
async function testLine2() {
    if (!WUYIN_KEY) throw new Error('Missing WUYIN_API_KEY');
    return new Promise((resolve, reject) => {
        const url = new URL('https://api.wuyinkeji.com/api/sora2-new/submit');
        url.searchParams.set('key', WUYIN_KEY);
        url.searchParams.set('prompt', 'A cute cat walking');
        url.searchParams.set('duration', '10');
        url.searchParams.set('aspectRatio', '9:16');

        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            family: 4,
            timeout: 30000
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (j.data?.id) resolve('Task ID: ' + j.data.id);
                    else resolve('Code: ' + j.code + ', Msg: ' + (j.msg || data.substring(0, 100)));
                } catch {
                    resolve('Code: ' + res.statusCode + ', Raw: ' + data.substring(0, 100));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}

(async () => {
    console.log('=== Video API Line Connectivity Test ===');
    console.log('Testing at:', new Date().toISOString());

    await testAPI('Line1 (scd666 - Default, Sora2 10s/15s)', testLine1);
    await testAPI('Line2 (wuyin - Backup, Sora2-new 10s/15s)', testLine2);

    console.log('\n=== Test Complete ===');
})();
