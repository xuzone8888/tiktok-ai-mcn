const OSS = require('ali-oss');
require('dotenv').config({ path: '.env.local' });

const client = new OSS({
    region: process.env.ALIYUN_OSS_REGION,
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    bucket: process.env.ALIYUN_OSS_BUCKET,
});

async function uploadVerificationFile() {
    // File name WITHOUT .txt extension - TikTok requires this exact format
    const fileName = 'tiktokq7WzML4gl2azSthzUyz18XZM56Kgj87m';
    const fileContent = 'tiktok-developers-site-verification=q7WzML4gl2azSthzUyz18XZM56Kgj87m';

    try {
        console.log('Uploading verification file WITHOUT .txt extension...');

        // Upload file directly to root with Content-Type as text/plain
        const result = await client.put(fileName, Buffer.from(fileContent), {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8'
            }
        });

        console.log('✅ Upload successful!');
        console.log('File URL:', result.url);
        console.log('Expected URL (no extension): https://media.tokfactoryai.com/tiktokq7WzML4gl2azSthzUyz18XZM56Kgj87m');
        console.log('\nVerify by visiting:');
        console.log('https://media.tokfactoryai.com/tiktokq7WzML4gl2azSthzUyz18XZM56Kgj87m');
    } catch (error) {
        console.error('❌ Upload failed:', error);
    }
}

uploadVerificationFile();
