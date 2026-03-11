import { NextRequest, NextResponse } from "next/server";
import https from "node:https";
import http from "node:http";

/**
 * 视频/图片下载代理 API
 * 
 * 支持两种模式：
 * 1. 普通下载：流式转发整个文件
 * 2. 分片下载：支持 Range 请求，用于多线程下载
 * 
 * 注意：使用 Node.js https 模块 + family:4 强制 IPv4 连接
 * 阿里云 ECS 服务器 IPv6 不通，Cloudflare CDN 域名有 IPv6 地址
 * 使用 fetch() 会导致 ETIMEDOUT
 */

export const runtime = "nodejs";
export const maxDuration = 120;

// 允许的域名白名单
const allowedDomains = [
  "scd666.com",
  "api.scd666.com",
  "cdn.scd666.com",
  "supabase.co",
  "openpt.wuyinkeji.com",
  "wuyinkeji.com",
  // ToryX 图片/视频 CDN
  "toryxai.com",
  "media.toryxai.com",
  // Gemini Image API CDN
  "xas231.online",
  "flow.xas231.online",
  // ss3.life CDN (10-15秒视频)
  "ss3.life",
  "videos-jp.ss3.life",
  "videos-us.ss3.life",
  "videos-sg.ss3.life",
  // ss2.life CDN (25秒 Pro 视频)
  "ss2.life",
  "videos-us3.ss2.life",
  "videos-jp.ss2.life",
  "videos-us.ss2.life",
  "videos-sg.ss2.life",
  // 望景API (备用线路)
  "60.205.120.27",
];

function isAllowedDomain(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return allowedDomains.some(
      (domain) => urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

/** 获取望景API的auth header（服务端注入，不暴露给前端） */
function getAuthHeaders(videoUrl: string): Record<string, string> {
  try {
    const urlObj = new URL(videoUrl);
    // 望景API 的 /content 端点需要 Bearer token
    if (urlObj.hostname === "60.205.120.27" && urlObj.pathname.includes('/v1/videos/')) {
      const key = process.env.WANGJING_API_KEY;
      if (key) {
        return { 'Authorization': `Bearer ${key}` };
      }
    }
  } catch { /* ignore */ }
  return {};
}

/**
 * 使用 Node.js https/http 模块请求 URL（强制 IPv4）
 * 替代 fetch()，避免 IPv6 连接超时
 */
function fetchWithIPv4(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    timeout?: number;
  } = {}
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const mod = isHttps ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      family: 4, // 强制 IPv4
      timeout: options.timeout || 60000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        ...options.headers,
      },
    };

    const req = mod.request(reqOptions, (res) => {
      // Handle redirects
      if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        fetchWithIPv4(res.headers.location, options).then(resolve).catch(reject);
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const respHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (val) respHeaders[key] = Array.isArray(val) ? val[0] : val;
        }
        resolve({
          statusCode: res.statusCode || 0,
          headers: respHeaders,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get("url");
  const filename = searchParams.get("filename") || "video.mp4";
  const mode = searchParams.get("mode") || "stream"; // stream | chunk | info

  if (!videoUrl) {
    return NextResponse.json({ error: "缺少视频URL参数" }, { status: 400 });
  }

  if (!isAllowedDomain(videoUrl)) {
    return NextResponse.json({ error: "不支持的下载源" }, { status: 403 });
  }

  try {
    const authHeaders = getAuthHeaders(videoUrl);

    // 模式1: 获取文件信息（用于多线程下载前获取文件大小）
    if (mode === "info") {
      const result = await fetchWithIPv4(videoUrl, {
        method: "HEAD",
        headers: authHeaders,
      });

      return NextResponse.json({
        size: result.headers["content-length"] ? parseInt(result.headers["content-length"]) : 0,
        supportsRange: result.headers["accept-ranges"] === "bytes",
        contentType: result.headers["content-type"] || "video/mp4",
      });
    }

    // 模式2: 分片下载（支持 Range 请求）
    if (mode === "chunk") {
      const start = searchParams.get("start");
      const end = searchParams.get("end");

      if (!start || !end) {
        return NextResponse.json({ error: "缺少 start/end 参数" }, { status: 400 });
      }

      const result = await fetchWithIPv4(videoUrl, {
        headers: {
          "Range": `bytes=${start}-${end}`,
          ...authHeaders,
        },
      });

      if (result.statusCode !== 200 && result.statusCode !== 206) {
        return NextResponse.json({ error: `分片请求失败: ${result.statusCode}` }, { status: 502 });
      }

      return new NextResponse(result.body, {
        status: 206,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": result.body.length.toString(),
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 模式3: 普通流式下载（默认）
    console.log(`[Download Proxy] Streaming: ${filename}`);

    const result = await fetchWithIPv4(videoUrl, {
      headers: authHeaders,
      timeout: 120000, // 2分钟超时
    });

    if (result.statusCode !== 200) {
      return NextResponse.json({ error: `源服务器错误: ${result.statusCode}` }, { status: 502 });
    }

    const contentType = result.headers["content-type"] || "application/octet-stream";

    return new NextResponse(result.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": result.body.length.toString(),
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("[Download Proxy] Error:", error);
    return NextResponse.json({ error: "下载失败，请稍后重试" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
    },
  });
}
