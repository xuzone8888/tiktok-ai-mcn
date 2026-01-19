// 测试 sora2 15秒 Key
const API_KEY = 'sk-uLcJdMGYTbm2XNDG4t6ANtjYGvQrocOyJagcdlFqCWkHnlOZ';

async function test() {
    console.log('测试 Key:', API_KEY.substring(0, 12) + '...');
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
