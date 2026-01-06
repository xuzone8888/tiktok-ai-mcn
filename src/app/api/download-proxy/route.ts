import { NextRequest, NextResponse } from "next/server";

/**
 * 视频下载代理 API
 * 
 * 使用流式代理（Stream Pipe）模式：
 * - 服务器作为管道，直接转发源站数据流
 * - 不会把整个视频加载到内存，延迟低
 * - 能正确设置文件名和下载头
 */

export const runtime = "nodejs";
export const maxDuration = 120; // 最大执行时间120秒，适合大文件

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get("url");
  const filename = searchParams.get("filename") || "video.mp4";
  
  console.log(`[Download Proxy] Request for: ${filename}`);

  if (!videoUrl) {
    return NextResponse.json(
      { error: "缺少视频URL参数" },
      { status: 400 }
    );
  }

  // 验证URL格式
  try {
    new URL(videoUrl);
  } catch {
    return NextResponse.json(
      { error: "无效的视频URL" },
      { status: 400 }
    );
  }

  // 限制只允许下载视频相关的URL（安全检查）
  const allowedDomains = [
    "scd666.com",
    "api.scd666.com",
    "cdn.scd666.com",
    "supabase.co",
    "openpt.wuyinkeji.com",
    "wuyinkeji.com",
  ];

  const urlObj = new URL(videoUrl);
  const isAllowed = allowedDomains.some(
    (domain) => urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
  );

  if (!isAllowed) {
    console.log("[Download Proxy] Blocked domain:", urlObj.hostname);
    return NextResponse.json(
      { error: "不支持的下载源" },
      { status: 403 }
    );
  }

  try {
    console.log("[Download Proxy] Fetching stream from:", videoUrl.substring(0, 100) + "...");
    
    // 使用流式代理 - 直接转发源站的响应流
    const response = await fetch(videoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
      },
    });

    if (!response.ok) {
      console.error("[Download Proxy] Upstream error:", response.status, response.statusText);
      return NextResponse.json(
        { error: `视频源服务器错误: ${response.status}` },
        { status: 502 }
      );
    }

    // 获取内容类型和大小
    const contentType = response.headers.get("content-type") || "video/mp4";
    const contentLength = response.headers.get("content-length");

    console.log("[Download Proxy] Streaming:", {
      contentType,
      contentLength: contentLength ? `${Math.round(parseInt(contentLength) / 1024 / 1024)}MB` : "unknown",
      filename,
    });

    // 构建响应头
    const headers: HeadersInit = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 如果有内容长度，添加到头中（让浏览器显示下载进度）
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    // 直接返回源站的响应体（流式传输）
    // response.body 是一个 ReadableStream，会被直接管道传输给客户端
    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("[Download Proxy] Error:", error);
    return NextResponse.json(
      { error: "下载失败，请稍后重试" },
      { status: 500 }
    );
  }
}

// 处理 OPTIONS 预检请求
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

