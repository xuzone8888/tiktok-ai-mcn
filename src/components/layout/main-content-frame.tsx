"use client";

import { usePathname } from "next/navigation";

/**
 * (main) 布局的内容框架:按路由决定是否豁免统一 container 与底部渐变(S0.5)。
 *
 * - 普通路由:渲染与原布局字节级相同的 container + 底部渐变,零回归。
 * - 全屏路由(FULLSCREEN_ROUTES 前缀匹配):裸渲染 children,由页面自管布局与滚动。
 *   Studio(omnibox+批次流)需要全屏画布,见 docs/STUDIO_REDESIGN_PLAN.md。
 *
 * 注意:不要修改共享 container 的类名——20+ 页面依赖它(风险清单第 3 条)。
 */
const FULLSCREEN_ROUTES = ["/studio"];

export function MainContentFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullscreen = FULLSCREEN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (fullscreen) {
    return <div className="h-full min-h-full">{children}</div>;
  }

  return (
    <>
      {/* Content container */}
      <div className="container mx-auto p-6 pb-20 min-h-full">
        {children}
      </div>

      {/* Bottom fade gradient - 底部渐变淡出 */}
      <div className="fixed bottom-0 left-[var(--sidebar-width,280px)] right-0 h-32 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none z-10" />
    </>
  );
}
