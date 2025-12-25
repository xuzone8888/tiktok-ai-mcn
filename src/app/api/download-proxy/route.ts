import { NextRequest, NextResponse } from "next/server";

/**
 * 视频下载代理 API
 * 
 * 解决前端直接 fetch 第三方视频URL时的CORS问题
 * 通过服务器代理下载，提供更稳定的下载体验
 */

export const runtime = "nodejs";
export const maxDuration = 60; // 最大执行时间60秒

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get("url");
  const filename = searchParams.get("filename") || "video.mp4";

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
    console.log("[Download Proxy] Fetching:", videoUrl.substring(0, 100) + "...");
    
    // 设置超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000); // 55秒超时

    const response = await fetch(videoUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity", // 不压缩，直接传输
      },
    });

    clearTimeout(timeoutId);

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

    console.log("[Download Proxy] Success:", {
      contentType,
      contentLength,
      filename,
    });

    // 获取视频数据
    const videoData = await response.arrayBuffer();

    // 返回视频流，设置正确的下载头
    return new NextResponse(videoData, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": videoData.byteLength.toString(),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Cache-Control": "no-cache",
        // 允许前端访问
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[Download Proxy] Timeout:", videoUrl.substring(0, 100));
      return NextResponse.json(
        { error: "下载超时，请稍后重试或使用直接下载" },
        { status: 504 }
      );
    }

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

