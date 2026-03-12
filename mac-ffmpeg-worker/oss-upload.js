/**
 * OSS 上传模块 — 将渲染完的视频上传到阿里云 OSS
 * 
 * 环境变量与 ECS 端 src/lib/oss.ts 完全一致。
 */

const OSS = require('ali-oss');

const ossConfig = {
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
    endpoint: process.env.ALIYUN_OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com',
    secure: true,
    timeout: 300000,
};

let _ossClient = null;
function getOSSClient() {
    if (!_ossClient) _ossClient = new OSS(ossConfig);
    return _ossClient;
}

const CUSTOM_DOMAIN = process.env.ALIYUN_OSS_CUSTOM_DOMAIN || 'media.toryxai.com';

/**
 * 上传 Buffer 到 OSS，返回公开 HTTPS URL
 */
async function uploadToOSS(buffer, objectPath, contentType) {
    if (!ossConfig.accessKeyId || !ossConfig.accessKeySecret) {
        throw new Error('OSS credentials not configured — check .env');
    }

    const client = getOSSClient();
    const result = await client.put(objectPath, Buffer.from(buffer), {
        headers: {
            'Content-Type': contentType,
            'Content-Disposition': 'inline',
            'Cache-Control': 'max-age=31536000',
        },
    });

    if (!result.name) {
        throw new Error('OSS upload failed');
    }

    return `https://${CUSTOM_DOMAIN}/${objectPath}`;
}

module.exports = { uploadToOSS };
