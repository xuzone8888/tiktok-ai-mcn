/**
 * Configure CORS for OSS bucket
 * Run: node scripts/configure-oss-cors.js
 */

require('dotenv').config({ path: '.env.local' });
const OSS = require('ali-oss');

const client = new OSS({
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    bucket: process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
});

async function configureCORS() {
    try {
        // Get current CORS configuration
        console.log('Current CORS configuration:');
        try {
            const result = await client.getBucketCORS();
            console.log(JSON.stringify(result.rules, null, 2));
        } catch (e) {
            console.log('No existing CORS rules or error:', e.message);
        }

        // Set new CORS rules
        const rules = [
            {
                allowedOrigin: ['https://toryxai.com', 'https://www.toryxai.com'],
                allowedMethod: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
                allowedHeader: ['*'],
                exposeHeader: ['ETag', 'x-oss-request-id', 'Content-Length'],
                maxAgeSeconds: '3600',
            },
            // Localhost for development
            {
                allowedOrigin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
                allowedMethod: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
                allowedHeader: ['*'],
                exposeHeader: ['ETag', 'x-oss-request-id', 'Content-Length'],
                maxAgeSeconds: '3600',
            },
        ];

        console.log('\nSetting new CORS rules...');
        await client.putBucketCORS(process.env.ALIYUN_OSS_BUCKET, rules);
        console.log('✅ CORS configured successfully!');

        // Verify
        console.log('\nNew CORS configuration:');
        const verifyResult = await client.getBucketCORS();
        console.log(JSON.stringify(verifyResult.rules, null, 2));

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

configureCORS();
