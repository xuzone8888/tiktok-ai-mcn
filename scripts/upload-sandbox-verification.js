// Upload TikTok Sandbox verification file to OSS
const OSS = require('ali-oss');
const fs = require('fs');

// Manual .env.local loader for environments where dotenv is unavailable
function loadEnv() {
    try {
        const envContent = fs.readFileSync('.env.local', 'utf-8');
        const env = {};
        envContent.split('\n').forEach(line => {
            const [key, ...val] = line.split('=');
            if (key && val.length) {
                env[key.trim()] = val.join('=').trim().replace(/^["']|["']$/g, '');
            }
        });
        return env;
    } catch (error) {
        console.error('Could not load .env.local:', error.message);
        return {};
    }
}

async function uploadSandboxVerification() {
    const env = loadEnv();

    const client = new OSS({
        region: env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
        accessKeyId: env.ALIYUN_OSS_ACCESS_KEY_ID || process.env.ALIYUN_OSS_ACCESS_KEY_ID,
        accessKeySecret: env.ALIYUN_OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_OSS_ACCESS_KEY_SECRET,
        bucket: env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
    });

    // Sandbox verification file for media.toryxai.com
    // Updated based on TikTok Developer Portal screenshot 2026-01-31
    const filename = 'tiktokeVCW1PSe1T8I46bTyv2krTl4dguAC1tT.txt';
    // Content includes the verification prefix as shown in TikTok portal
    const content = 'tiktok-developers-site-verification=eVCW1PSe1T8I46bTyv2krTl4dguAC1tT';

    console.log('Uploading TikTok Sandbox verification file...');
    console.log('Filename:', filename);
    console.log('Content:', content);

    try {
        const result = await client.put(filename, Buffer.from(content), {
            headers: {
                'Content-Type': 'text/plain',
            }
        });
        console.log('\n✅ Upload successful!');
        console.log('OSS URL:', result.url);
        console.log('CDN URL:', `https://media.toryxai.com/${filename}`);
        console.log('\nNext step: Click "Verify" button in TikTok Developer Portal');
    } catch (error) {
        console.error('\n❌ Upload failed:', error.message);
    }
}

uploadSandboxVerification();
