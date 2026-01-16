"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  Users,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Film,
  Lock,
  Zap,
  Link2,
  ImageIcon,
  Images,
  Camera,
  Send,
  Clapperboard,
  Copy,
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

// ============================================================================
// 类型定义
// ============================================================================

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  comingSoon?: boolean;
  comingSoonMessage?: string;
}

interface NavGroup {
  header: string | null; // null = 无标题的顶级项
  items: NavItem[];
}

// ============================================================================
// 导航配置 - 平铺分组结构 (一键直达)
// ============================================================================

const navGroups: NavGroup[] = [
  // --- 顶级 (无标题) ---
  {
    header: null,
    items: [
      {
        title: "数据驾驶舱",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "运营数据概览",
      },
    ],
  },
  // --- 模特仓库 ---
  {
    header: "模特仓库",
    items: [
      {
        title: "模特资源库",
        href: "/models",
        icon: Users,
        description: "浏览全部 AI 模特",
      },
      {
        title: "专属模特仓",
        href: "/team",
        icon: UserCheck,
        description: "已签约的专属模特",
      },
    ],
  },
  // --- 图片工坊 ---
  {
    header: "图片工坊",
    items: [
      {
        title: "极速造片机",
        href: "/quick-gen",
        icon: Zap,
        description: "AI 快速生成图片",
      },
      {
        title: "批量制图线",
        href: "/pro-studio/image-batch",
        icon: Images,
        description: "批量图片生产",
      },
      {
        title: "商图精修台",
        href: "/image-factory",
        icon: Camera,
        description: "电商图片精修",
      },
    ],
  },
  // --- 视频产线 ---
  {
    header: "视频产线",
    items: [
      {
        title: "批量流水线",
        href: "/pro-studio/video-batch",
        icon: Clapperboard,
        description: "批量视频生产",
      },
      {
        title: "链接转化机",
        href: "/link-video",
        icon: Link2,
        description: "链接一键成片",
      },
      {
        title: "爆款克隆机",
        href: "/clip-editor",
        icon: Copy,
        description: "爆款分镜还原",
        comingSoon: true,
        comingSoonMessage: "即将推出：一键复刻爆款视频风格，快速生成同款内容",
      },
    ],
  },
  // --- 矩阵发货 ---
  {
    header: "矩阵发货",
    items: [
      {
        title: "智能分发站",
        href: "/publish",
        icon: Send,
        description: "多平台视频分发",
        comingSoon: true,
        comingSoonMessage: "即将推出：视频矩阵账号绑定与一键分发",
      },
    ],
  },
  // --- 生产归档 ---
  {
    header: "生产归档",
    items: [
      {
        title: "成品交付单",
        href: "/assets",
        icon: Package,
        description: "查看历史作品",
      },
    ],
  },
];

// ============================================================================
// Sidebar 组件
// ============================================================================

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

  // 渲染单个导航项
  const renderNavItem = (item: NavItem, isActive: boolean) => {
    const Icon = item.icon;
    const isComingSoon = item.comingSoon;

    // Coming Soon 项 - 不可点击，柔和显示，徽章小巧
    if (isComingSoon) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>
            <button
              onClick={() => handleComingSoonClick(item)}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium",
                "text-white/25 hover:text-white/35 cursor-not-allowed transition-colors duration-200"
              )}
            >
              <div
                className={cn(
                  "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  "bg-white/[0.03] opacity-40"
                )}
              >
                <Icon className="h-4 w-4" />
                {/* Coming Soon 锁定图标 */}
                <div className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/40">
                  <Lock className="h-2 w-2 text-amber-400/80" />
                </div>
              </div>
              
              {!collapsed && (
                <div className="flex flex-1 flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm opacity-40">{item.title}</span>
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400/70">
                      即将推出
                    </span>
                  </div>
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

    // 正常导航项 - 磁性悬停效果
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "nav-interactive group relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium",
          "transition-all duration-150 ease-out",
          isActive
            ? "bg-gradient-to-r from-tiktok-cyan/15 to-tiktok-pink/10 text-white"
            : "text-white/60 hover:bg-white/[0.08] hover:text-white hover:translate-x-0.5"
        )}
      >
        {/* Active indicator - 左侧强调条 */}
        {isActive && (
          <div className="absolute left-0 top-1/2 h-9 w-[3px] -translate-y-1/2 rounded-r-full bg-tiktok-cyan shadow-[0_0_8px_rgba(0,242,234,0.5)]" />
        )}
        
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-150",
            isActive
              ? "bg-gradient-to-br from-tiktok-cyan/25 to-tiktok-pink/15 text-tiktok-cyan"
              : "bg-white/[0.04] group-hover:bg-white/[0.12]"
          )}
        >
          <Icon className="h-4 w-4 transition-transform duration-150 group-hover:scale-105" />
        </div>
        
        {!collapsed && (
          <span className={cn(
            "text-sm transition-all duration-150 group-hover:translate-x-0.5",
            isActive && "font-medium"
          )}>
            {item.title}
          </span>
        )}

        {/* Hover glow effect */}
        {isActive && (
          <div className="absolute inset-0 -z-10 rounded-xl bg-gradient-to-r from-tiktok-cyan/5 to-tiktok-pink/5 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
        )}
      </Link>
    );
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "relative flex h-screen flex-col sidebar-gradient border-r border-border/50 transition-all duration-300 ease-in-out",
          collapsed ? "w-20" : "w-[260px]"
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
                <span className="text-tiktok-cyan">Tok</span>{" "}
                <span className="text-tiktok-pink">Factory</span>
              </span>
              <span className="text-xs text-muted-foreground">
                AI 内容智造工厂
              </span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3">
          {navGroups.map((group, groupIndex) => (
            <div key={groupIndex} className={cn(groupIndex > 0 && "mt-6")}>
              {/* Group Header with Divider */}
              {group.header && !collapsed && (
                <div className={cn(
                  "px-3 pt-6 pb-2",
                  groupIndex > 0 && "border-t border-white/10"
                )}>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#B0B0B0]">
                    {group.header}
                  </span>
                </div>
              )}
              {/* Collapsed: show divider instead of header */}
              {group.header && collapsed && groupIndex > 0 && (
                <div className="my-3 mx-3 border-t border-white/10" />
              )}
              {/* Group Items */}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                  return renderNavItem(item, isActive);
                })}
              </div>
            </div>
          ))}
        </nav>

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
