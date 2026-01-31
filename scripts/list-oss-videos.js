// List videos on OSS for testing
const OSS = require('ali-oss');
const fs = require('fs');

// Load env
const envContent = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) {
        env[key.trim()] = val.join('=').trim().replace(/^["']|["']$/g, '');
    }
});

const client = new OSS({
    region: env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
    accessKeyId: env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    bucket: env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
});

async function listVideos() {
    const result = await client.list({ prefix: '', 'max-keys': 50 });
    const videos = result.objects?.filter(obj =>
        obj.name.endsWith('.mp4') || obj.name.endsWith('.webm') || obj.name.endsWith('.mov')
    ) || [];

    console.log('\n=== Available test videos on OSS ===');
    if (videos.length === 0) {
        console.log('No videos found on OSS');
    } else {
        videos.slice(0, 10).forEach(v => {
            const sizeMB = (v.size / 1024 / 1024).toFixed(2);
            console.log(`- ${v.name} (${sizeMB}MB)`);
            console.log(`  URL: https://media.toryxai.com/${v.name}`);
        });
    }
}

listVideos().catch(err => console.error('Error:', err.message));
