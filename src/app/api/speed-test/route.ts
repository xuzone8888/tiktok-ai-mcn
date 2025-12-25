import { NextRequest, NextResponse } from "next/server";

/**
 * 线路测速 API
 * 
 * 提供多条下载线路的测速功能
 * 通过下载测试文件来检测各线路的实际下载速度
 */

export const runtime = "nodejs";
export const maxDuration = 60;

// 定义下载线路配置
export interface DownloadRoute {
  id: string;
  name: string;
  description: string;
  testUrl: string;      // 测试文件URL
  testSize: number;     // 测试文件大小（字节）
  proxyEndpoint?: string; // 代理端点（可选）
  priority: number;     // 优先级（数字越小越高）
}

// 配置的下载线路
const DOWNLOAD_ROUTES: DownloadRoute[] = [
  {
    id: "default",
    name: "默认线路",
    description: "API默认CDN节点",
    testUrl: "https://api.scd666.com/test/1mb.bin", // 需要确认实际可用的测试文件
    testSize: 1024 * 1024, // 1MB
    priority: 1,
  },
  {
    id: "telecom",
    name: "电信线路",
    description: "中国电信优化节点",
    testUrl: "https://api.scd666.com/test/1mb.bin",
    testSize: 1024 * 1024,
    priority: 2,
  },
  {
    id: "unicom",
    name: "联通线路",
    description: "中国联通优化节点",
    testUrl: "https://api.scd666.com/test/1mb.bin",
    testSize: 1024 * 1024,
    priority: 3,
  },
  {
    id: "mobile",
    name: "移动线路",
    description: "中国移动优化节点",
    testUrl: "https://api.scd666.com/test/1mb.bin",
    testSize: 1024 * 1024,
    priority: 4,
  },
  {
    id: "backup",
    name: "备用线路",
    description: "海外备用节点",
    testUrl: "https://api.scd666.com/test/1mb.bin",
    testSize: 1024 * 1024,
    priority: 5,
  },
];

// 获取可用线路列表
export async function GET() {
  return NextResponse.json({
    routes: DOWNLOAD_ROUTES.map(route => ({
      id: route.id,
      name: route.name,
      description: route.description,
      testSize: route.testSize,
      priority: route.priority,
    })),
  });
}

// 执行单条线路测速
export async function POST(request: NextRequest) {
  try {
    const { routeId, testUrl } = await request.json();
    
    if (!routeId) {
      return NextResponse.json(
        { error: "缺少线路ID参数" },
        { status: 400 }
      );
    }

    // 查找线路配置
    const route = DOWNLOAD_ROUTES.find(r => r.id === routeId);
    if (!route) {
      return NextResponse.json(
        { error: "无效的线路ID" },
        { status: 400 }
      );
    }

    // 使用提供的测试URL或默认URL
    const urlToTest = testUrl || route.testUrl;
    
    console.log(`[Speed Test] Testing route: ${route.name}, URL: ${urlToTest}`);

    // 执行测速
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch(urlToTest, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "*/*",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return NextResponse.json({
          routeId,
          status: "failed",
          error: `HTTP ${response.status}`,
          speed: 0,
          latency: Date.now() - startTime,
        });
      }

      // 读取数据计算速度
      const data = await response.arrayBuffer();
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000; // 秒
      const size = data.byteLength;
      const speedMBps = size / duration / (1024 * 1024); // MB/s

      console.log(`[Speed Test] Route ${route.name}: ${speedMBps.toFixed(2)} MB/s, ${duration.toFixed(2)}s`);

      return NextResponse.json({
        routeId,
        status: "success",
        speed: Math.round(speedMBps * 100) / 100, // 保留2位小数
        latency: Math.round(endTime - startTime),
        size,
        duration: Math.round(duration * 100) / 100,
      });

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return NextResponse.json({
          routeId,
          status: "timeout",
          error: "测速超时",
          speed: 0,
          latency: 30000,
        });
      }

      return NextResponse.json({
        routeId,
        status: "failed",
        error: fetchError instanceof Error ? fetchError.message : "测速失败",
        speed: 0,
        latency: Date.now() - startTime,
      });
    }

  } catch (error) {
    console.error("[Speed Test] Error:", error);
    return NextResponse.json(
      { error: "测速服务异常" },
      { status: 500 }
    );
  }
}

