/**
 * 测试豆包 API 连接
 */

const fs = require('fs');
const path = require('path');

// 手动读取 .env.local 文件
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envLines = envContent.split('\n');

const env = {};
for (const line of envLines) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...valueParts] = trimmed.split('=');
    if (key) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  }
}

const DOUBAO_API_KEY = env.DOUBAO_API_KEY;
const DOUBAO_API_ENDPOINT = env.DOUBAO_API_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DOUBAO_ENDPOINT_ID = env.DOUBAO_ENDPOINT_ID;

console.log("=== 豆包 API 配置检查 ===");
console.log("API Key:", DOUBAO_API_KEY ? `${DOUBAO_API_KEY.substring(0, 10)}...` : "未配置");
console.log("API Endpoint:", DOUBAO_API_ENDPOINT);
console.log("Endpoint ID:", DOUBAO_ENDPOINT_ID || "未配置");
console.log("");

if (!DOUBAO_API_KEY || !DOUBAO_ENDPOINT_ID) {
  console.error("❌ 配置不完整，请检查 .env.local 文件");
  process.exit(1);
}

async function testAPI() {
  console.log("=== 测试 API 连接 ===");
  
  try {
    const response = await fetch(DOUBAO_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DOUBAO_API_KEY}`,
      },
      body: JSON.stringify({
        model: DOUBAO_ENDPOINT_ID,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say hello in one word." }
        ],
        max_tokens: 10,
      }),
    });

    const responseText = await response.text();
    console.log("HTTP Status:", response.status);
    console.log("Response:", responseText);

    if (response.ok) {
      const data = JSON.parse(responseText);
      console.log("\n✅ API 连接成功!");
      console.log("回复:", data.choices?.[0]?.message?.content);
    } else {
      console.log("\n❌ API 请求失败");
      try {
        const errorData = JSON.parse(responseText);
        console.log("错误信息:", errorData.error?.message || responseText);
      } catch {
        console.log("原始响应:", responseText);
      }
    }
  } catch (error) {
    console.error("❌ 网络错误:", error.message);
  }
}

testAPI();

