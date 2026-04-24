#!/usr/bin/env node
// 重新查询一个已完成的 VEO 任务，获取新鲜 URL，测试完整转存流程
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const https = require('https');
const OSS = require('ali-oss');

const VEO_KEY = process.env.VEO3_GAORUI_API_KEY;
const CUSTOM_DOMAIN = process.env.ALIYUN_OSS_CUSTOM_DOMAIN || 'media.toryxai.com';
const TASK_ID = process.argv[2] || 'task_OWcRWulgSqWphGuQ6lGRkCIy8mGthLei';

function httpsReq(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { family: 4, timeout: 30000, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
      res.on('error', reject);
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log('=== Fresh URL E2E Test ===');
  console.log('Task:', TASK_ID);
  console.log('API Key:', VEO_KEY ? VEO_KEY.substring(0,10) + '...' : 'NOT SET');

  // 1. 查询 gaorui API
  console.log('\n1. Querying gaorui API...');
  const qRes = await httpsReq('https://gaorui.cc/v1/videos/' + TASK_ID, { Authorization: 'Bearer ' + VEO_KEY });
  const data = JSON.parse(qRes.body.toString());
  console.log('   Status:', data.status);
  
  const videoUrl = data.video_url || data.result_url;
  if (!videoUrl) { console.log('   No video URL'); return; }
  
  console.log('   URL:', videoUrl.substring(0, 100) + '...');
  
  // Check expiry
  try {
    const u = new URL(videoUrl);
    const exp = u.searchParams.get('Expires');
    if (exp) {
      const mins = ((exp * 1000 - Date.now()) / 60000).toFixed(1);
      console.log('   Expires in:', mins, 'minutes');
    }
  } catch(e) {}

  // 2. 下载
  console.log('\n2. Downloading video...');
  const start = Date.now();
  let dlRes;
  try {
    dlRes = await httpsReq(videoUrl);
  } catch(e) {
    console.log('   ❌ Download failed:', e.message);
    return;
  }
  
  if (dlRes.status !== 200) {
    console.log('   ❌ HTTP', dlRes.status);
    return;
  }
  console.log('   ✅ Downloaded:', dlRes.body.length, 'bytes in', (Date.now()-start)+'ms');

  // 3. 上传 OSS
  console.log('\n3. Uploading to OSS...');
  const oss = new OSS({
    region: process.env.ALIYUN_OSS_REGION,
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    bucket: process.env.ALIYUN_OSS_BUCKET,
    endpoint: process.env.ALIYUN_OSS_ENDPOINT,
    secure: true,
  });
  
  const ossPath = 'veo-videos/test/' + Date.now() + '-e2e.mp4';
  const uStart = Date.now();
  await oss.put(ossPath, dlRes.body, { headers: { 'Content-Type': 'video/mp4' } });
  const ossUrl = 'https://' + CUSTOM_DOMAIN + '/' + ossPath;
  console.log('   ✅ Uploaded in', (Date.now()-uStart)+'ms');
  console.log('   OSS URL:', ossUrl);

  // 4. 验证 OSS
  console.log('\n4. Verifying OSS URL...');
  const vRes = await httpsReq(ossUrl);
  console.log('   Status:', vRes.status, '| Type:', vRes.headers['content-type'], '| Size:', vRes.headers['content-length']);

  // 清理
  await oss.delete(ossPath);
  console.log('   Cleaned up.');

  if (vRes.status === 200) {
    console.log('\n🎉 E2E PASSED! CDN→Download→OSS→Verify ✅');
  } else {
    console.log('\n❌ OSS verify failed');
  }
}

main().catch(e => console.error('Fatal:', e.message));
