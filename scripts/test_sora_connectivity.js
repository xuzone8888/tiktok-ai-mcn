const https = require('https');
const fs = require('fs');
const path = require('path');

// 1. Read configuration from .env.local
console.log('Reading token from .env.local...');
const envPath = path.resolve(__dirname, '../.env.local');
let apiKey = '';
let apiEndpoint = 'api.scd666.com'; // default from suchuang-api.ts

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

if (!apiKey) {
    console.error('SORA2_API_KEY not found in .env.local');
    process.exit(1);
}

console.log(`Using credentials:`);
console.log(`- Endpoint: ${apiEndpoint}`);
console.log(`- Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);

// 2. Prepare Request
// Using a valid model name from suchuang-api.ts mappings
const requestBody = JSON.stringify({
    model: 'sora2-portrait-15s',
    prompt: 'test connection heartbeat', // Very simple prompt
    width: 1080,
    height: 1920
});

const options = {
    hostname: apiEndpoint,
    port: 443,
    path: '/v1/videos',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody),
    },
    timeout: 10000 // 10s timeout
};

console.log('\nThinking... (Sending request)');

// 3. Make Request
const req = https.request(options, (res) => {
    console.log(`\nResponse Status: ${res.statusCode} ${res.statusMessage}`);

    let data = '';
    res.on('data', (chunk) => { data += chunk; });

    res.on('end', () => {
        console.log('Response Body:', data);

        // Quick Analysis
        if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('\n✅ Connection Successful! Task created.');
        } else if (res.statusCode === 402 || data.includes('balance') || data.includes('credit')) {
            console.log('\n⚠️ Connection Successful, but Payment/Balance issue detected (Expected if balance is negative).');
        } else if (res.statusCode === 401) {
            console.log('\n❌ Authentication Failed. Check API Key.');
        } else {
            console.log('\n❌ Request Failed.');
        }
    });
});

req.on('error', (e) => {
    console.error(`\n❌ Network Error: ${e.message}`);
    // Specific checks for common issues
    if (e.message.includes('ETIMEDOUT')) {
        console.log('  Hint: Firewall or connection speed issue.');
    } else if (e.message.includes('EAI_AGAIN')) {
        console.log('  Hint: DNS resolution failed.');
    }
});

req.write(requestBody);
req.end();
