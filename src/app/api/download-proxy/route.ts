import { NextRequest, NextResponse } from "next/server";

/**
 * 视频下载代理 API
 * 
 * 解决前端直接 fetch 第三方视频URL时的CORS问题
 * 通过服务器代理下载，提供更稳定的下载体验
 * 支持多线路选择优化下载速度
 */

export const runtime = "nodejs";
export const maxDuration = 60; // 最大执行时间60秒

// 线路配置 - 不同CDN节点
const ROUTE_CONFIGS: Record<string, { description: string; priority: number }> = {
  default: { description: "默认线路", priority: 1 },
  telecom: { description: "电信优化", priority: 2 },
  unicom: { description: "联通优化", priority: 3 },
  mobile: { description: "移动优化", priority: 4 },
  backup: { description: "备用线路", priority: 5 },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get("url");
  const filename = searchParams.get("filename") || "video.mp4";
  const routeId = searchParams.get("route") || "default"; // 线路选择参数
  
  // 记录使用的线路
  const routeConfig = ROUTE_CONFIGS[routeId] || ROUTE_CONFIGS.default;
  console.log(`[Download Proxy] Using route: ${routeId} (${routeConfig.description})`);

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
    console.log("[Download Proxy] Redirecting to:", videoUrl.substring(0, 100) + "...");
    
    // 方案 1: 直接重定向 (302)
    // 这种方式最快，利用源站 CDN 的原始带宽
    // 缺点是可能无法强制重命名，但可以通过 302 解决大部分 CORS 问题
    return NextResponse.redirect(videoUrl, {
      status: 302,
    });
  } catch (error) {
    console.error("[Download Proxy] Error:", error);
    return NextResponse.json(
      { error: "下载重定向失败，请尝试直接下载" },
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

