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
  Lock,
  Zap,
  Link2,
  Images,
  Camera,
  Send,
  Clapperboard,
  CreditCard,
  LayoutTemplate,
  ShoppingBag,
  Youtube,
  Share2,
  Instagram,
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
import { useLang } from "@/contexts/LangContext";
import { isImageFactoryUiEnabled } from "@/lib/feature-flags";

const CURRENT_YEAR = new Date().getFullYear();

// ============================================================================
// Types
// ============================================================================

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  comingSoon?: boolean;
  comingSoonMessage?: string;
  beta?: boolean;
}

interface NavGroup {
  header: string | null;
  items: NavItem[];
}

// ============================================================================
// Nav Data — bilingual via getNavGroups(lang)
// ============================================================================

function getNavGroups(lang: string): NavGroup[] {
  const t = lang === "en";
  return [
    // --- Top Level ---
    {
      header: null,
      items: [
        {
          title: "Studio",
          href: "/studio",
          icon: Sparkles,
          description: t ? "Unified creation workspace" : "统一创作工作台",
          beta: true,
        },
        {
          title: t ? "Dashboard" : "数据总览",
          href: "/dashboard",
          icon: LayoutDashboard,
          description: t ? "Overview" : "运营数据概览",
        },
      ],
    },
    // --- AI Characters ---
    {
      header: t ? "AI Characters" : "AI 角色中心",
      items: [
        {
          title: t ? "Create Character" : "创建角色",
          href: "/character/create",
          icon: Sparkles,
          description: t ? "Create your AI character" : "创建专属 AI 角色",
        },
        {
          title: t ? "Character Market" : "角色市场",
          href: "/models",
          icon: Users,
          description: t ? "Browse all AI characters" : "浏览全部 AI 角色",
        },
      ],
    },
    // --- Creative Studio ---
    {
      header: t ? "Creative Studio" : "创作灵感",
      items: [
        {
          title: t ? "Templates" : "模板中心",
          href: "/templates",
          icon: LayoutTemplate,
          description: t ? "Discover templates" : "发现灵感模板",
        },
      ],
    },
    // --- Image Creation ---
    {
      header: t ? "Image Creation" : "图片制作",
      items: [
        {
          title: t ? "Single Image" : "单图生成",
          href: "/quick-gen",
          icon: Zap,
          description: t ? "Single image generation" : "AI 单图生成",
        },
        {
          title: t ? "Batch Images" : "多图生成",
          href: "/pro-studio/image-batch",
          icon: Images,
          description: t ? "Generate multiple images" : "多张图片同时生成",
        },
        ...(isImageFactoryUiEnabled()
          ? [{
            title: t ? "Product Photo" : "商图精修",
            href: "/image-factory",
            icon: Camera,
            description: t ? "E-commerce photo retouching" : "电商商品图精修",
          }]
          : []),
      ],
    },
    // --- Video Creation ---
    {
      header: t ? "Video Creation" : "视频制作",
      items: [
        {
          title: t ? "Batch Videos" : "素材生成视频",
          href: "/pro-studio/video-batch",
          icon: Clapperboard,
          description: t ? "Generate multiple videos" : "多个视频同时生成",
        },
        {
          title: t ? "Link to Video" : "链接生成视频",
          href: "/link-video",
          icon: Link2,
          description: t ? "Generate video from URL" : "通过链接一键生成视频",
        },
        {
          title: t ? "Image to Video" : "图片生成视频",
          href: "/pro-studio/image-slideshow",
          icon: Images,
          description: t ? "Convert images to video" : "图片合成视频",
        },
      ],
    },
    // --- Social Publishing ---
    {
      header: t ? "Social Publishing" : "社媒内容发布",
      items: [
        {
          title: t ? "TikTok Accounts" : "TikTok 账号绑定",
          href: "/publish/accounts",
          icon: Users,
          description: t ? "Connect TikTok accounts" : "绑定 TikTok 发布账号",
          beta: true,
        },
        {
          title: t ? "TikTok Publish" : "TikTok 视频发布",
          href: "/publish",
          icon: Send,
          description: t ? "Publish to TikTok" : "发布视频到 TikTok",
          beta: true,
        },
        {
          title: t ? "YouTube Accounts" : "YouTube 账号绑定",
          href: "/youtube-publish/accounts",
          icon: Youtube,
          description: t ? "Connect YouTube channels" : "绑定 YouTube 发布频道",
          beta: true,
        },
        {
          title: t ? "YouTube Publish" : "YouTube 视频发布",
          href: "/youtube-publish",
          icon: Youtube,
          description: t ? "Publish to YouTube" : "发布视频到 YouTube",
          beta: true,
        },
        {
          title: t ? "Facebook Accounts" : "Facebook 账号绑定",
          href: "/facebook-publish/accounts",
          icon: Share2,
          description: t ? "Connect Facebook Pages" : "绑定 Facebook Page",
          beta: true,
        },
        {
          title: t ? "Facebook Publish" : "Facebook 视频发布",
          href: "/facebook-publish",
          icon: Share2,
          description: t ? "Publish to Facebook" : "发布视频到 Facebook",
          beta: true,
        },
        {
          title: t ? "Instagram Accounts" : "Instagram 账号绑定",
          href: "/instagram-publish/accounts",
          icon: Instagram,
          description: t ? "Connect Instagram accounts" : "绑定 Instagram 账号",
          beta: true,
        },
        {
          title: t ? "Instagram Publish" : "Instagram 视频发布",
          href: "/instagram-publish",
          icon: Instagram,
          description: t ? "Publish to Instagram" : "发布视频到 Instagram",
          beta: true,
        },
      ],
    },
    // --- Shop Publishing ---
    {
      header: t ? "Shop Publishing" : "电商内容发布",
      items: [
        {
          title: t ? "Shop Accounts" : "TikTok Shop 账号绑定",
          href: "/shop-publish/accounts",
          icon: UserCheck,
          description: t ? "Connect TikTok Shop" : "绑定 TikTok Shop 账号",
          beta: true,
        },
        {
          title: t ? "Shop Publish" : "TikTok Shop 带货发布",
          href: "/shop-publish",
          icon: ShoppingBag,
          description: t ? "Publish to TikTok Shop" : "发布带货视频到 TikTok Shop",
          beta: true,
        },
      ],
    },
    // --- Archive ---
    {
      header: t ? "Archive" : "生产归档",
      items: [
        {
          title: t ? "Generated Assets" : "生成记录",
          href: "/assets",
          icon: Package,
          description: t ? "View generation history" : "查看历史生成内容",
        },
      ],
    },
    // --- Account ---
    {
      header: t ? "Account" : "账户",
      items: [
        {
          title: t ? "Recharge" : "充值中心",
          href: "/recharge",
          icon: CreditCard,
          description: t ? "Buy credits" : "积分充值购买",
        },
      ],
    },
  ];
}

// ============================================================================
// Sidebar Component
// ============================================================================

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { toast } = useToast();
  const { lang } = useLang();

  const navGroups = getNavGroups(lang);

  // Handle coming-soon item click
  const handleComingSoonClick = (item: NavItem) => {
    toast({
      title: lang === "en" ? "🚀 Coming Soon" : "🚀 即将推出",
      description: item.comingSoonMessage || (lang === "en" ? "This feature is under development" : "此功能正在开发中"),
    });
  };

  // Render single nav item
  const renderNavItem = (item: NavItem, isActive: boolean) => {
    const Icon = item.icon;
    const isComingSoon = item.comingSoon;

    // Coming Soon items — not clickable, soft display
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
                {/* Coming Soon lock icon */}
                <div className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/40">
                  <Lock className="h-2 w-2 text-amber-400/80" />
                </div>
              </div>

              {!collapsed && (
                <div className="flex flex-1 flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm opacity-40">{item.title}</span>
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400/70">
                      {lang === "en" ? "Coming Soon" : "即将推出"}
                    </span>
                  </div>
                </div>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[250px]">
            <p className="font-medium">{lang === "en" ? "🚀 Coming Soon" : "🚀 即将推出"}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {item.comingSoonMessage}
            </p>
          </TooltipContent>
        </Tooltip>
      );
    }

    // Normal nav item — magnetic hover effect
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "nav-interactive group relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium",
          "transition-all duration-300 ease-out",
          isActive
            ? "bg-gradient-to-r from-mermaid-lime/10 to-mermaid-cyan/10 text-white"
            : "text-white/60 hover:bg-white/[0.05] hover:text-white hover:translate-x-1"
        )}
      >
        {/* Active indicator - right neon bar */}
        {isActive && (
          <div className="absolute right-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-l-full bg-mermaid-cyan shadow-[0_0_10px_#00F2EA]" />
        )}

        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-300",
            isActive
              ? "bg-mermaid-cyan/20 text-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.2)]"
              : "bg-white/[0.04] group-hover:bg-white/[0.1] text-white/70"
          )}
        >
          <Icon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
        </div>

        {!collapsed && (
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "text-sm transition-all duration-300 group-hover:translate-x-0.5",
              isActive && "font-bold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-white to-white/90"
            )}>
              {item.title}
            </span>
            {item.beta && (
              <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-400/70 shrink-0">
                BETA
              </span>
            )}
          </div>
        )}

        {/* Hover glow effect */}
        {isActive && (
          <div className="absolute inset-0 -z-10 rounded-xl bg-mermaid-cyan/5 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
        )}
      </Link>
    );
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "relative flex h-screen flex-col bg-[#0B0C10] border-r border-white/5 transition-all duration-300 ease-in-out",
          collapsed ? "w-20" : "w-[260px]"
        )}
      >
        {/* Brand Header - Star Gaze */}
        <div className={cn(
          "flex items-center border-b border-white/5 bg-[#0B0C10] transition-all duration-300 relative overflow-hidden group/header",
          collapsed ? "justify-center h-16 w-full" : "h-20 px-5"
        )}>
          {/* Ambient Glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2/3 h-1 bg-gradient-to-r from-transparent via-[#00f2ea]/20 to-transparent blur-sm group-hover/header:via-[#00f2ea]/40 transition-all duration-500" />

          <Link href="/" className="group/logo relative flex shrink-0 items-center gap-3.5 transition-all duration-300 hover:scale-[1.03] active:scale-95">
            {/* Original Image Logo with Fringe Trimming */}
            <div className={cn(
              "relative flex shrink-0 items-center justify-center rounded-[12px] overflow-hidden shadow-[0_0_15px_rgba(34,211,238,0.3)] ring-1 ring-white/10 transition-all group-hover/logo:shadow-[0_0_25px_rgba(34,211,238,0.4)]",
              collapsed ? "h-10 w-10" : "h-11 w-11"
            )}>
              <img src="/images/toryx_logo_icon_new.png" alt="Star Gaze Logo" className="h-full w-full object-cover scale-[1.05]" />
            </div>
            
            {/* Split Fat-Thin Typography */}
            {!collapsed && (
              <div className="flex flex-col justify-center translate-y-[1px]">
                <div className="flex items-center tracking-tight leading-none">
                  <span className="text-[20px] font-extrabold text-white">Star</span>
                  <span className="text-[20px] font-light text-white/70 ml-[3px]">Gaze</span>
                </div>
              </div>
            )}
          </Link>
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
                  const isActive = pathname === item.href;
                  return renderNavItem(item, isActive);
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className={cn(
          "mt-auto border-t border-border/50 p-4",
          collapsed && "px-2"
        )}>
          {!collapsed ? (
            <div className="flex items-center justify-between text-[10px] text-white/30">
              <span>© {CURRENT_YEAR} Star Gaze · Wuhan Guanxing Cultural Media Co., Ltd.</span>
              <span>v1.0</span>
            </div>
          ) : (
            <div className="text-center text-[10px] text-white/20">
              v1.0
            </div>
          )}
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
