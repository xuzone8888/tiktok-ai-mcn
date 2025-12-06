"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  UserCircle,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Shield,
  Zap,
  Wand2,
} from "lucide-react";

const adminNavItems = [
  {
    title: "控制面板",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    title: "用户管理",
    href: "/admin/users",
    icon: Users,
  },
  {
    title: "AI 模特",
    href: "/admin/models",
    icon: UserCircle,
  },
  {
    title: "提示词配置",
    href: "/admin/prompts",
    icon: Wand2,
  },
  {
    title: "操作日志",
    href: "/admin/audit-logs",
    icon: FileText,
  },
  {
    title: "系统设置",
    href: "/admin/settings",
    icon: Settings,
  },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Admin Sidebar */}
      <aside
        className={cn(
          "sticky top-0 h-screen border-r border-border/50 bg-black/40 backdrop-blur-xl transition-all duration-300 flex flex-col",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border/50">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-lg">Admin</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="h-8 w-8"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {adminNavItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== "/admin" && pathname.startsWith(item.href));
            
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start gap-3 h-11",
                    collapsed && "justify-center px-0",
                    isActive
                      ? "bg-red-500/20 text-red-400 border border-red-500/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  <item.icon className={cn("h-5 w-5", isActive && "text-red-400")} />
                  {!collapsed && <span>{item.title}</span>}
                </Button>
              </Link>
            );
          })}
        </nav>

        {/* 返回前端 */}
        <div className="p-3 border-t border-border/50">
          <Link href="/dashboard">
            <Button
              variant="outline"
              className={cn(
                "w-full gap-2 border-white/10 hover:bg-white/5",
                collapsed && "px-0"
              )}
            >
              <Zap className="h-4 w-4 text-tiktok-cyan" />
              {!collapsed && <span>返回前端</span>}
            </Button>
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* 顶部栏 */}
        <header className="h-16 border-b border-border/50 bg-black/20 backdrop-blur-sm flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">管理后台</span>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">
              {adminNavItems.find((item) => 
                pathname === item.href || 
                (item.href !== "/admin" && pathname.startsWith(item.href))
              )?.title || "控制面板"}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {/* 返回前端按钮 */}
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-tiktok-cyan/30 text-tiktok-cyan hover:bg-tiktok-cyan/10 hover:border-tiktok-cyan/50"
              >
                <Zap className="h-4 w-4" />
                返回前端
              </Button>
            </Link>
            {/* 管理员标识 */}
            <div className="px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-1.5">
              <Shield className="h-3 w-3" />
              超级管理员
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}

