// Upload TikTok verification file to OSS
const fs = require('fs');
const OSS = require('ali-oss');

// Read .env.local manually
const envContent = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) {
        // Remove quotes from values
        env[key.trim()] = val.join('=').trim().replace(/^["']|["']$/g, '');
    }
});

const client = new OSS({
    region: env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
    accessKeyId: env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    bucket: env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
});

async function uploadVerificationFile() {
    // TikTok verification file for media.toryxai.com (Production)
    const fileName = 'tiktok7OVEkLfzUFeDu54fH6XsOhUPGwQF80vf.txt';
    const fileContent = 'tiktok-developers-site-verification=7OVEkLfzUFeDu54fH6XsOhUPGwQF80vf';

    try {
        console.log('Uploading verification file to OSS...');

        // Upload to root of bucket
        const result = await client.put(fileName, Buffer.from(fileContent, 'utf-8'), {
            headers: {
                'Content-Type': 'text/plain',
            }
        });

        console.log('✅ Upload successful!');
        console.log('File URL:', result.url);
        console.log('Expected URL: https://media.toryxai.com/' + fileName);

        // Test access
        console.log('\nVerify by visiting:');
        console.log('https://media.toryxai.com/' + fileName);

    } catch (error) {
        console.error('❌ Upload failed:', error.message);
    }
}

uploadVerificationFile();
