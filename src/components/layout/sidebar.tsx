"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  Users,
  UserCheck,
  Wand2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Film,
  Lock,
  Zap,
  Factory,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  comingSoon?: boolean;
  comingSoonMessage?: string;
}

const navItems: NavItem[] = [
  // 1. 运营驾驶舱 (原概览)
  {
    title: "运营驾驶舱",
    href: "/dashboard",
    icon: LayoutDashboard,
    description: "数据概览与运营分析",
  },
  // 2. 模特资源库 (原模特市场)
  {
    title: "模特资源库",
    href: "/models",
    icon: Users,
    description: "浏览全部 AI 模特",
  },
  // 3. 专属模特仓 (原我的签约模特)
  {
    title: "专属模特仓",
    href: "/team",
    icon: UserCheck,
    description: "已签约的专属模特",
  },
  // 4. 单条即时工位 (原快速生成单个视频)
  {
    title: "单条即时工位",
    href: "/quick-gen",
    icon: Zap,
    description: "快速生成单条视频",
  },
  // 5. 批量生产线 (原批量生产工坊)
  {
    title: "批量生产线",
    href: "/pro-studio",
    icon: Factory,
    description: "批量生产视频与图片",
  },
  // 6. 多镜合成间 → 爆款复刻 (预留)
  {
    title: "爆款复刻",
    href: "/clip-editor",
    icon: Film,
    description: "多镜合成间",
    comingSoon: true,
    comingSoonMessage: "即将推出：一键复刻爆款视频风格，快速生成同款内容",
  },
  // 7. 任务日志 (原选品中心)
  {
    title: "任务日志",
    href: "/assets",
    icon: Package,
    description: "查看生成历史与下载",
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { toast } = useToast();

  // 处理即将推出项点击
  const handleComingSoonClick = (item: NavItem) => {
    toast({
      title: "🚀 即将推出",
      description: item.comingSoonMessage || "此功能正在开发中",
    });
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "relative flex h-screen flex-col sidebar-gradient border-r border-border/50 transition-all duration-300 ease-in-out",
          collapsed ? "w-20" : "w-[280px]"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-border/50 px-4">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-tiktok-cyan to-tiktok-pink">
            <Sparkles className="h-5 w-5 text-primary-foreground dark:text-black" />
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-tiktok-cyan to-tiktok-pink opacity-50 blur-lg" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight">
                <span className="text-tiktok-cyan">TikTok</span>{" "}
                <span className="text-tiktok-pink">AI</span>{" "}
                <span className="text-foreground">MCN</span>
              </span>
              <span className="text-xs text-muted-foreground">
                智能创作平台
              </span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            const Icon = item.icon;
            const isComingSoon = item.comingSoon;

            // Coming Soon 项 - 不可点击，显示灰色
            if (isComingSoon) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleComingSoonClick(item)}
                      className={cn(
                        "group relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-200",
                        "text-muted-foreground/50 hover:text-muted-foreground cursor-not-allowed opacity-60"
                      )}
                    >
                      <div
                        className={cn(
                          "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                          "bg-white/5"
                        )}
                      >
                        <Icon className="h-5 w-5" />
                        {/* Coming Soon 锁定图标 */}
                        <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/50">
                          <Lock className="h-2.5 w-2.5 text-amber-500" />
                        </div>
                      </div>
                      
                      {!collapsed && (
                        <div className="flex flex-1 flex-col">
                          <div className="flex items-center gap-2">
                            <span>{item.title}</span>
                            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400 tracking-wider">
                              即将推出
                            </span>
                          </div>
                          {item.description && (
                            <span className="text-xs text-muted-foreground/50">
                              {item.description}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[250px]">
                    <p className="font-medium">🚀 即将推出</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {item.comingSoonMessage}
                    </p>
                  </TooltipContent>
                </Tooltip>
              );
            }

            // 正常导航项
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-gradient-to-r from-tiktok-cyan/10 to-tiktok-pink/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {/* Active indicator */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-tiktok-cyan to-tiktok-pink" />
                )}
                
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                    isActive
                      ? "bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20 text-tiktok-cyan"
                      : "bg-muted group-hover:bg-accent"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                
                {!collapsed && (
                  <div className="flex flex-col">
                    <span>{item.title}</span>
                    {item.description && (
                      <span className="text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </div>
                )}

                {/* Hover glow effect */}
                {isActive && (
                  <div className="absolute inset-0 -z-10 rounded-xl bg-gradient-to-r from-tiktok-cyan/5 to-tiktok-pink/5 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
                )}
              </Link>
            );
          })}
        </nav>

      {/* Footer */}
      <div className="border-t border-border/50 p-3 space-y-3">
        {/* Pro Plan Badge */}
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl bg-gradient-to-r from-tiktok-cyan/5 to-tiktok-pink/5 p-3",
            collapsed && "justify-center"
          )}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-tiktok-cyan to-tiktok-pink">
            <span className="text-sm font-bold text-primary-foreground">AI</span>
          </div>
          {!collapsed && (
            <div className="flex-1">
              <p className="text-sm font-medium">专业版</p>
              <p className="text-xs text-muted-foreground">无限创作额度</p>
            </div>
          )}
        </div>
      </div>

        {/* Collapse button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 z-10 h-6 w-6 rounded-full border border-border bg-card shadow-md hover:bg-accent"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </Button>
      </aside>
    </TooltipProvider>
  );
}



