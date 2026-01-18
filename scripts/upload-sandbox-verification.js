// Upload TikTok Sandbox verification file to OSS
const OSS = require('ali-oss');

async function uploadSandboxVerification() {
    const client = new OSS({
        region: 'oss-cn-beijing',
        accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID,
        accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET,
        bucket: 'tokfactory-videos',
    });

    // Sandbox verification filename (no .txt extension!)
    const filename = 'tiktokLAlFTpcGfwxj4JRMfAPEfaGYQdECtVud';
    const content = 'tiktokLAlFTpcGfwxj4JRMfAPEfaGYQdECtVud';

    try {
        const result = await client.put(filename, Buffer.from(content), {
            headers: {
                'Content-Type': 'text/plain',
            }
        });
        console.log('Upload successful!');
        console.log('OSS URL:', result.url);
        console.log('CDN URL:', `https://media.tokfactoryai.com/${filename}`);
    } catch (error) {
        console.error('Upload failed:', error);
    }
}

uploadSandboxVerification();
