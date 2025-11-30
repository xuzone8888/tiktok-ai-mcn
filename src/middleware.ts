/**
 * TikTok AI MCN - 中间件 (简化版)
 * 
 * 功能：
 * 1. Admin 路由保护 - 开发环境默认放行，生产环境需验证
 * 2. 静态资源放行
 * 
 * 注意：当前为开发环境，使用 Mock 数据
 * 生产环境需要安装 @supabase/auth-helpers-nextjs 并启用完整认证
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ============================================================================
// 开发环境配置
// ============================================================================

// Mock 当前用户角色 (开发环境)
// 生产环境应从 Supabase Auth 获取
const MOCK_USER_ROLE = "super_admin"; // 可改为 "user" 测试权限拦截

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  // ============================================
  // 1. 静态资源和 API 路由，直接放行
  // ============================================
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return res;
  }

  // ============================================
  // 2. Admin 路由保护 (开发环境简化版)
  // ============================================
  if (pathname.startsWith("/admin")) {
    // 开发环境：使用 Mock 角色检查
    const isAdmin = MOCK_USER_ROLE === "admin" || MOCK_USER_ROLE === "super_admin";

    if (!isAdmin) {
      console.log(`[Middleware] Access denied to /admin (mock role: ${MOCK_USER_ROLE})`);
      // 非 Admin 用户，重定向到 404
      return NextResponse.rewrite(new URL("/not-found", req.url));
    }

    // Admin 用户，允许访问
    console.log(`[Middleware] Admin access granted: ${pathname}`);
  }

  // ============================================
  // 3. 在响应头中添加用户角色 (供前端调试)
  // ============================================
  res.headers.set("X-User-Role", MOCK_USER_ROLE);

  return res;
}

// 配置中间件匹配的路由
export const config = {
  matcher: [
    /*
     * 匹配所有路径，除了：
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico (favicon)
     * - public 文件夹中的静态资源
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

