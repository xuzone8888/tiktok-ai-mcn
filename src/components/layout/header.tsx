"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Search, Settings, User, Shield, LogOut, UserCircle, Zap, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type UserRole, isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";

// ============================================================================
// 类型定义
// ============================================================================

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  credits: number;
}

// ============================================================================
// Header Component
// ============================================================================

export function Header() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  // 获取用户信息的函数
  const fetchUser = async () => {
    try {
      const supabase = createClient();
      
      // 获取当前登录用户
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (!authUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      // 从 profiles 表获取用户详情
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, avatar_url, role, credits")
        .eq("id", authUser.id)
        .single();

      const profileData = profile as { name?: string; avatar_url?: string; role?: string; credits?: number } | null;

      setUser({
        id: authUser.id,
        email: authUser.email || "",
        name: profileData?.name || authUser.email?.split("@")[0] || "User",
        avatar_url: profileData?.avatar_url || null,
        role: (profileData?.role as UserRole) || "user",
        credits: profileData?.credits ?? 0,
      });
    } catch (error) {
      console.error("[Header] Failed to fetch user:", error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  // 获取当前用户 - 从 Supabase Auth 和 profiles 表
  useEffect(() => {
    fetchUser();

    // 监听登录状态变化
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_OUT") {
          setUser(null);
        } else if (event === "SIGNED_IN" && session?.user) {
          fetchUser();
        }
      }
    );

    // 监听积分更新事件 (从 Quick Generator 等页面触发)
    const handleCreditsUpdate = () => {
      console.log("[Header] Credits update event received, refreshing...");
      fetchUser();
    };
    window.addEventListener("credits-updated", handleCreditsUpdate);

    // 定时刷新积分（每30秒）
    const intervalId = setInterval(() => {
      fetchUser();
    }, 30000);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("credits-updated", handleCreditsUpdate);
      clearInterval(intervalId);
    };
  }, []);

  // 登出处理 - 调用真实的 Supabase signOut
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      setUser(null);
      router.push("/auth/login");
      router.refresh();
    } catch (error) {
      console.error("[Header] Logout error:", error);
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border/50 bg-background/80 px-6 backdrop-blur-xl">
      {/* Search */}
      <div className="relative max-w-md flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="搜索模特、素材、项目..."
          className="h-10 w-full bg-muted/50 pl-10 pr-4 border-border/50 focus:border-tiktok-cyan/50 focus:ring-tiktok-cyan/20"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Credits Display */}
        {user && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30">
            <Zap className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-400">
              {user.credits.toLocaleString()}
            </span>
          </div>
        )}

        {/* 未登录时显示登录按钮 */}
        {!loading && !user && (
          <Button
            asChild
            variant="outline"
            className="border-tiktok-cyan/50 text-tiktok-cyan hover:bg-tiktok-cyan/10"
          >
            <Link href="/auth/login">登录</Link>
          </Button>
        )}

        {/* Theme Toggle */}
        <ThemeToggle />

        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 rounded-xl hover:bg-muted/50"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
        </Button>
        
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-xl hover:bg-muted/50"
        >
          <Settings className="h-5 w-5 text-muted-foreground" />
        </Button>

        {user && (
          <>
            <div className="ml-2 h-8 w-px bg-border/50" />

            {/* User Dropdown Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex items-center gap-3 rounded-xl px-3 hover:bg-muted/50"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-tiktok-cyan to-tiktok-pink">
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt={user.name}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <User className="h-4 w-4 text-primary-foreground" />
                    )}
                  </div>
                  <div className="flex flex-col items-start">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{user.name}</span>
                      {/* Admin Badge */}
                      {isAdmin(user.role) && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                          {user.role === "super_admin" ? "SA" : "A"}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                className="w-56 bg-popover/95 border-border/50 backdrop-blur-xl"
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                    <p className="text-xs text-amber-400">
                      <Zap className="h-3 w-3 inline mr-1" />
                      {user.credits.toLocaleString()} 积分
                    </p>
                  </div>
                </DropdownMenuLabel>

                <DropdownMenuSeparator className="bg-border/50" />

                {/* Profile */}
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="cursor-pointer">
                    <UserCircle className="h-4 w-4 mr-2" />
                    个人中心
                  </Link>
                </DropdownMenuItem>

                {/* Settings */}
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <Settings className="h-4 w-4 mr-2" />
                    设置
                  </Link>
                </DropdownMenuItem>

                {/* ============================================ */}
                {/* Admin Portal - 仅对 Admin 用户显示 */}
                {/* ============================================ */}
                {isAdmin(user.role) && (
                  <>
                    <DropdownMenuSeparator className="bg-border/50" />
                    <DropdownMenuItem asChild>
                      <Link
                        href="/admin"
                        className={cn(
                          "cursor-pointer",
                          "text-red-400 focus:text-red-400 focus:bg-red-500/10"
                        )}
                      >
                        <Shield className="h-4 w-4 mr-2" />
                        <span className="font-medium">管理后台</span>
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/30">
                          {user.role === "super_admin" ? "超管" : "管理"}
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator className="bg-border/50" />

                {/* Log Out */}
                <DropdownMenuItem
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="cursor-pointer text-muted-foreground focus:text-red-400"
                >
                  {loggingOut ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4 mr-2" />
                  )}
                  {loggingOut ? "登出中..." : "退出登录"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  );
}
