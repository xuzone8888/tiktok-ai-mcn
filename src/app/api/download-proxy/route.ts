import { NextRequest, NextResponse } from "next/server";

/**
 * 视频下载代理 API
 * 
 * 支持两种模式：
 * 1. 普通下载：流式转发整个文件
 * 2. 分片下载：支持 Range 请求，用于多线程下载
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
    // 模式1: 获取文件信息（用于多线程下载前获取文件大小）
    if (mode === "info") {
      const response = await fetch(videoUrl, { method: "HEAD" });
      const contentLength = response.headers.get("content-length");
      const acceptRanges = response.headers.get("accept-ranges");

      return NextResponse.json({
        size: contentLength ? parseInt(contentLength) : 0,
        supportsRange: acceptRanges === "bytes",
        contentType: response.headers.get("content-type") || "video/mp4",
      });
    }

    // 模式2: 分片下载（支持 Range 请求）
    if (mode === "chunk") {
      const start = searchParams.get("start");
      const end = searchParams.get("end");

      if (!start || !end) {
        return NextResponse.json({ error: "缺少 start/end 参数" }, { status: 400 });
      }

      const response = await fetch(videoUrl, {
        headers: {
          "Range": `bytes=${start}-${end}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok && response.status !== 206) {
        return NextResponse.json({ error: `分片请求失败: ${response.status}` }, { status: 502 });
      }

      // 直接返回分片数据
      return new NextResponse(response.body, {
        status: 206,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": response.headers.get("content-length") || "",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 模式3: 普通流式下载（默认）
    console.log(`[Download Proxy] Streaming: ${filename}`);

    const response = await fetch(videoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: `视频源服务器错误: ${response.status}` }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") || "video/mp4";
    const contentLength = response.headers.get("content-length");

    const headers: HeadersInit = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    };

    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    return new NextResponse(response.body, { status: 200, headers });
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
