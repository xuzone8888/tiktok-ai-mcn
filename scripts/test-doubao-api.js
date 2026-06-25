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

const DOUBAO_API_KEY = env.DOUBAO_API_KEY || env.ARK_API_KEY;
const DOUBAO_API_ENDPOINT = env.DOUBAO_API_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DOUBAO_ENDPOINT_ID = env.DOUBAO_ENDPOINT_ID || env.ARK_DOUBAO_ENDPOINT_ID;

function safeEndpointHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "invalid";
  }
}

console.log("=== 豆包 API 配置检查 ===");
console.log("API Key configured:", Boolean(DOUBAO_API_KEY));
console.log("API Key length:", DOUBAO_API_KEY ? DOUBAO_API_KEY.length : 0);
console.log("API Endpoint host:", safeEndpointHost(DOUBAO_API_ENDPOINT));
console.log("Endpoint ID configured:", Boolean(DOUBAO_ENDPOINT_ID));
console.log("Endpoint ID length:", DOUBAO_ENDPOINT_ID ? DOUBAO_ENDPOINT_ID.length : 0);
console.log("");

if (!DOUBAO_API_KEY || !DOUBAO_ENDPOINT_ID) {
  console.error("配置不完整，请检查 .env.local 文件中的 DOUBAO_* 或 ARK_* 配置");
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

    console.log("HTTP Status:", response.status);
    const responseText = await response.text();

    if (response.ok) {
      const data = JSON.parse(responseText);
      const content = data.choices?.[0]?.message?.content || "";
      console.log("\nAPI 连接成功");
      console.log("Has choices:", Array.isArray(data.choices) && data.choices.length > 0);
      console.log("Reply length:", content.length);
    } else {
      console.log("\nAPI 请求失败");
      try {
        const errorData = JSON.parse(responseText);
        const message = errorData.error?.message || errorData.message || responseText;
        console.log("错误信息:", String(message).slice(0, 240));
      } catch {
        console.log("原始响应:", responseText.slice(0, 240));
      }
    }
  } catch (error) {
    console.error("网络错误:", error.message);
  }
}

testAPI();

