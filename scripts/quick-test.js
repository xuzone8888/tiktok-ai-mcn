// 测试 sora2 15秒 Key
const API_KEY = process.env.SORA2_API_KEY || process.env.VIDEO_PLATFORM_API_KEY || '';

async function test() {
    if (!API_KEY) {
        throw new Error('Missing SORA2_API_KEY or VIDEO_PLATFORM_API_KEY');
    }
    console.log('测试 Key: 已从环境变量读取');
    console.log('');

    const body = {
        model: 'sora-2',
        prompt: 'A sunset over ocean',
        duration: 15,
        aspect_ratio: '9:16'
    };

    console.log('Request:', JSON.stringify(body, null, 2));
    console.log('');

    const response = await fetch('https://fsai.app/v1/videos', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + API_KEY,
        },
        body: JSON.stringify(body),
    });

    console.log('Status:', response.status, response.statusText);
    const text = await response.text();
    console.log('Response:', text);

    if (response.ok) {
        console.log('\n✅ 成功!');
    } else {
        console.log('\n❌ 失败');
    }
}

test();
