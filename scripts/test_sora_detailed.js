/**
 * Detailed diagnostic script for Sora2 API
 * Captures and logs the exact raw response to understand the format error
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

console.log('=== Sora2 API Detailed Diagnostic ===\n');

// 1. Read configuration
const envPath = path.resolve(__dirname, '../.env.local');
let apiKey = '';
let apiEndpoint = 'api.scd666.com';

try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const keyMatch = envContent.match(/SORA2_API_KEY=(.+)/);
    if (keyMatch) apiKey = keyMatch[1].trim();

    const endpointMatch = envContent.match(/SORA2_API_ENDPOINT=(.+)/);
    if (endpointMatch) {
        const url = new URL(endpointMatch[1].trim());
        apiEndpoint = url.hostname;
    }
} catch (e) {
    console.error('Error reading .env.local:', e.message);
    process.exit(1);
}

console.log('Configuration:');
console.log(`  Endpoint: ${apiEndpoint}`);
console.log(`  API Key: ${apiKey.substring(0, 10)}...${apiKey.slice(-4)}\n`);

// 2. Test a minimal request matching what suchuang-api.ts sends
const testModels = [
    'sora2-portrait-15s',  // Standard model
];

async function testModel(model) {
    console.log(`\n--- Testing model: ${model} ---`);

    const requestBody = JSON.stringify({
        prompt: 'A simple test video of colorful particles',
        model: model,
    });

    return new Promise((resolve) => {
        const options = {
            hostname: apiEndpoint,
            port: 443,
            path: '/v1/videos',
            method: 'POST',
            family: 4, // Force IPv4 like in suchuang-api.ts
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody),
            },
            timeout: 30000,
        };

        console.log('Request:');
        console.log(`  URL: https://${options.hostname}${options.path}`);
        console.log(`  Method: ${options.method}`);
        console.log(`  Body: ${requestBody}\n`);

        const req = https.request(options, (res) => {
            console.log('Response Headers:');
            console.log(`  Status: ${res.statusCode} ${res.statusMessage}`);
            console.log(`  Content-Type: ${res.headers['content-type']}`);

            let data = '';
            res.on('data', (chunk) => { data += chunk; });

            res.on('end', () => {
                console.log('\nRaw Response Body:');
                console.log('---');
                console.log(data);
                console.log('---');

                // Try to parse as JSON
                try {
                    const json = JSON.parse(data);
                    console.log('\n✅ Valid JSON response:');
                    console.log(JSON.stringify(json, null, 2));

                    if (json.id) {
                        console.log('\n✅ SUCCESS: Task ID received:', json.id);
                    } else if (json.error) {
                        console.log('\n⚠️ API Error:', json.error);
                    }
                } catch (e) {
                    console.log('\n❌ NOT valid JSON');
                    console.log('Parse error:', e.message);

                    // Check for common error patterns
                    if (data.includes('<!DOCTYPE') || data.includes('<html')) {
                        console.log('  Type: HTML error page');
                    } else if (data.includes('error code:')) {
                        console.log('  Type: Gateway error text');
                    } else if (data.includes('timeout')) {
                        console.log('  Type: Timeout error');
                    } else {
                        console.log('  Type: Unknown format');
                    }
                }

                resolve();
            });
        });

        req.on('error', (e) => {
            console.error('\n❌ Request Error:', e.message);
            resolve();
        });

        req.on('timeout', () => {
            console.error('\n❌ Request Timeout');
            req.destroy();
            resolve();
        });

        req.write(requestBody);
        req.end();
    });
}

// Run tests
(async () => {
    for (const model of testModels) {
        await testModel(model);
    }
    console.log('\n=== Diagnostic Complete ===');
})();
