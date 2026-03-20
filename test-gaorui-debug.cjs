require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const https = require('https');

const API_KEY = process.env.VEO3_GAORUI_API_KEY;

const requestBody = JSON.stringify({
  model: "gemini-2.5-flash-image",
  messages: [{ role: "user", content: [{ type: "text", text: "A cute cat" }] }],
  stream: true,
});

const req = https.request({
  hostname: "gaorui.cc",
  port: 443,
  path: "/v1/chat/completions",
  method: "POST",
  family: 4,
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + API_KEY,
    "Accept": "text/event-stream",
    "Content-Length": String(Buffer.byteLength(requestBody)),
  },
  timeout: 60000,
}, (res) => {
  let data = "";
  res.on("data", (chunk) => { data += chunk; });
  res.on("end", () => {
    console.log("Status:", res.statusCode, "DataLen:", data.length);
    
    // Parse SSE exactly like extractImageFromSSE does
    const lines = data.split("\n");
    let fullContent = "";
    
    for (const line of lines) {
      if (line.startsWith("data: ") && !line.includes("[DONE]")) {
        try {
          const jsonStr = line.substring(6).trim();
          if (!jsonStr) continue;
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
          if (delta) fullContent += delta;
          const msg = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
          if (msg && typeof msg === "string") fullContent += msg;
        } catch (e) {}
      }
    }
    
    console.log("\nfullContent length:", fullContent.length);
    console.log("fullContent first 500:", fullContent.substring(0, 500));
    console.log("fullContent last 200:", fullContent.substring(Math.max(0, fullContent.length - 200)));
    
    // Test indexOf checks
    const dataImageIdx = fullContent.indexOf("data:image/");
    console.log("\nindexOf data:image/:", dataImageIdx);
    
    const httpIdx = fullContent.indexOf("http");
    console.log("indexOf http:", httpIdx);
    
    // If no data:image/ found, check what the content looks like
    if (dataImageIdx === -1 && fullContent.length > 0) {
      console.log("\nNo data:image/ found! Checking content structure...");
      console.log("Starts with:", JSON.stringify(fullContent.substring(0, 50)));
      
      // Check for other image formats
      console.log("Has iVBOR:", fullContent.indexOf("iVBOR") !== -1);
      console.log("Has /9j/:", fullContent.indexOf("/9j/") !== -1);
      console.log("Has base64:", fullContent.indexOf("base64") !== -1);
      console.log("Has image:", fullContent.indexOf("image") !== -1);
    }
    
    if (dataImageIdx !== -1) {
      const afterDataImage = fullContent.substring(dataImageIdx);
      const base64Start = afterDataImage.indexOf(";base64,");
      console.log("base64 marker at:", base64Start);
      if (base64Start !== -1) {
        const dataStart = base64Start + 8;
        console.log("base64 data starts with:", afterDataImage.substring(dataStart, dataStart + 50));
      }
    }
  });
});

req.on("error", (e) => console.error("Error:", e.message));
req.on("timeout", () => { req.destroy(); console.error("Timeout!"); });
req.write(requestBody);
req.end();
