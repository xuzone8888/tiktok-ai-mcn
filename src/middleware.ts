/**
 * TikTok AI MCN - 中间件
 * 
 * 功能：
 * 1. 登录验证 - 未登录用户重定向到登录页
 * 2. Admin 路由保护
 * 3. 静态资源放行
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// 公开路由（不需要登录）
const PUBLIC_ROUTES = [
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/callback",
];

// 需要登录的路由
const PROTECTED_ROUTES = [
  "/dashboard",
  "/assets",
  "/models",
  "/team",
  "/quick-gen",
  "/pro-studio",
  "/admin",
];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

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
  // 2. 检查是否为受保护路由
  // ============================================
  const isProtectedRoute = PROTECTED_ROUTES.some(route => 
    pathname === route || pathname.startsWith(route + "/")
  );

  // 如果不是受保护路由，直接放行
  if (!isProtectedRoute) {
    return res;
  }

  // ============================================
  // 3. 创建 Supabase 客户端并检查用户会话
  // ============================================
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return req.cookies.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            req.cookies.set({
              name,
              value,
              ...options,
            });
            res = NextResponse.next({
              request: {
                headers: req.headers,
              },
            });
            res.cookies.set({
              name,
              value,
              ...options,
            });
          },
          remove(name: string, options: CookieOptions) {
            req.cookies.set({
              name,
              value: "",
              ...options,
            });
            res = NextResponse.next({
              request: {
                headers: req.headers,
              },
            });
            res.cookies.set({
              name,
              value: "",
              ...options,
            });
          },
        },
      }
    );

    // 获取当前用户
    const { data: { user }, error } = await supabase.auth.getUser();

    // ============================================
    // 4. 未登录用户重定向到登录页
    // ============================================
    if (error || !user) {
      console.log(`[Middleware] Unauthorized access to ${pathname}, redirecting to login`);
      const loginUrl = new URL("/auth/login", req.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // ============================================
    // 5. Admin 路由保护
    // ============================================
    if (pathname.startsWith("/admin")) {
      // 从数据库获取用户角色 (使用 profiles 表)
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      const userRole = profile?.role || "user";
      const isAdmin = userRole === "admin" || userRole === "super_admin";

      if (!isAdmin) {
        console.log(`[Middleware] Access denied to /admin (role: ${userRole})`);
        return NextResponse.rewrite(new URL("/not-found", req.url));
      }
    }

    return res;
  } catch (error) {
    // Supabase 连接错误，重定向到登录页
    console.error(`[Middleware] Error checking auth:`, error);
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }
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

