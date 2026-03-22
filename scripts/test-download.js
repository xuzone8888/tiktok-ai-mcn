// 测试 Humsr 的 reference_sheet_url 是否可以正常下载
// 模拟 gaorui-veo-api.ts 中的 downloadImage 逻辑

const https = require('https');

const HUMSR_URL = 'https://media.toryxai.com/images/character-reference/1774099334526-j8ae1bgt.jpeg';

// 模拟 downloadImage 函数（与生产代码一致）
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, { family: 4, timeout: 30000 }, (res) => {
      console.log('Response status:', res.statusCode);
      console.log('Response headers:', JSON.stringify(res.headers, null, 2));
      
      if (res.statusCode === 301 || res.statusCode === 302) {
        console.log('Redirecting to:', res.headers.location);
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      
      // 注意：原始代码没有检查 4xx/5xx
      if (res.statusCode >= 400) {
        console.log('ERROR: Got', res.statusCode, 'status - downloadImage would still read body as image!');
      }
      
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log('Downloaded size:', buffer.length, 'bytes');
        console.log('First bytes (hex):', buffer.slice(0, 16).toString('hex'));
        // JPEG 文件应该以 FFD8FF 开头
        const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8;
        const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50;
        console.log('Is JPEG:', isJPEG, '| Is PNG:', isPNG);
        resolve(buffer);
      });
      res.on('error', reject);
    }).on('error', (err) => {
      console.log('Connection error:', err.message);
      reject(err);
    });
  });
}

// 同时用 fetch 做对比测试
async function testWithFetch(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    console.log('\n--- fetch 对比测试 ---');
    console.log('fetch status:', res.status);
    console.log('content-type:', res.headers.get('content-type'));
    console.log('content-length:', res.headers.get('content-length'), 'bytes');
    const buf = Buffer.from(await res.arrayBuffer());
    console.log('actual size:', buf.length, 'bytes');
  } catch (e) {
    console.log('fetch error:', e.message);
  }
}

async function main() {
  console.log('=== 测试 Humsr reference_sheet_url 下载 ===');
  console.log('URL:', HUMSR_URL);
  console.log('');

  try {
    console.log('--- https.get 测试 (与 VEO API 代码一致) ---');
    const buffer = await downloadImage(HUMSR_URL);
    console.log('✅ downloadImage 成功, size:', buffer.length);
  } catch (e) {
    console.log('❌ downloadImage 失败:', e.message);
  }

  await testWithFetch(HUMSR_URL);
}

main();
