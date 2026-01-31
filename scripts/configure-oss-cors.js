/**
 * 配置阿里云OSS CORS规则
 * 允许 toryxai.com 域名的跨域请求
 */

const fs = require('fs');
const path = require('path');

// 手动加载 .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
        process.env[match[1].trim()] = match[2].trim();
    }
});

const OSS = require('ali-oss');

const client = new OSS({
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    bucket: process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
});

async function configureCORS() {
    console.log('配置OSS CORS规则...');
    console.log('Bucket:', process.env.ALIYUN_OSS_BUCKET);

    const corsRules = [
        {
            // 生产环境 - toryxai.com
            allowedOrigin: ['https://www.toryxai.com', 'https://toryxai.com'],
            allowedMethod: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            allowedHeader: ['*'],
            exposeHeader: ['ETag', 'x-oss-request-id', 'Content-Length'],
            maxAgeSeconds: 3600,
        },
        {
            // 本地开发环境
            allowedOrigin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
            allowedMethod: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            allowedHeader: ['*'],
            exposeHeader: ['ETag', 'x-oss-request-id', 'Content-Length'],
            maxAgeSeconds: 3600,
        },
        {
            // 旧域名（兼容）
            allowedOrigin: ['https://www.tokfactoryai.com', 'https://tokfactoryai.com'],
            allowedMethod: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            allowedHeader: ['*'],
            exposeHeader: ['ETag', 'x-oss-request-id', 'Content-Length'],
            maxAgeSeconds: 3600,
        }
    ];

    try {
        // 先获取当前CORS配置
        console.log('\n当前CORS配置:');
        try {
            const currentCors = await client.getBucketCORS(process.env.ALIYUN_OSS_BUCKET);
            console.log(JSON.stringify(currentCors.rules, null, 2));
        } catch (e) {
            console.log('(暂无配置或获取失败)');
        }

        // 设置新的CORS规则
        console.log('\n正在设置新的CORS规则...');
        await client.putBucketCORS(process.env.ALIYUN_OSS_BUCKET, corsRules);

        console.log('\n✅ CORS规则设置成功！');

        // 验证配置
        console.log('\n验证新配置:');
        const newCors = await client.getBucketCORS(process.env.ALIYUN_OSS_BUCKET);
        console.log(JSON.stringify(newCors.rules, null, 2));

        console.log('\n允许的来源:');
        newCors.rules.forEach((rule, i) => {
            console.log(`规则 ${i + 1}: ${rule.allowedOrigin.join(', ')}`);
        });

    } catch (error) {
        console.error('❌ 配置失败:', error.message);
        if (error.code) {
            console.error('错误代码:', error.code);
        }
        process.exit(1);
    }
}

configureCORS();
