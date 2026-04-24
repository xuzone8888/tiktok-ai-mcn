// Upload TikTok verification file to OSS for tokfactory-videos.oss-accelerate.aliyuncs.com
const fs = require('fs');
const OSS = require('ali-oss');

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

async function upload() {
    const fileName = 'tiktokmwjjHlC9iF5ndjGlaoclZVoquOhhxLih.txt';
    const fileContent = 'tiktok-developers-site-verification=mwjjHlC9iF5ndjGlaoclZVoquOhhxLih';

    try {
        console.log('Uploading:', fileName);
        const result = await client.put(fileName, Buffer.from(fileContent, 'utf-8'), {
            headers: { 'Content-Type': 'text/plain' }
        });
        console.log('✅ Upload successful!');
        console.log('URL:', 'https://tokfactory-videos.oss-accelerate.aliyuncs.com/' + fileName);
    } catch (error) {
        console.error('❌ Failed:', error.message);
    }
}

upload();
