"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings, User, Shield, LogOut, UserCircle, Zap, Loader2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/5 bg-[#050505]/80 px-6 backdrop-blur-xl transition-all duration-300">
      {/* Search removed - no actual functionality */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Credits Display */}
        {user && (
          <div className="relative group px-4 py-2 rounded-full bg-black/40 border border-white/10 overflow-hidden flex items-center gap-2 transition-all duration-300 hover:border-mermaid-cyan/50 hover:shadow-[0_0_15px_rgba(0,242,234,0.2)]">
            <div className="absolute inset-0 bg-gradient-to-r from-mermaid-cyan/10 to-mermaid-pink/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <Zap className="h-4 w-4 text-[#CCFF00] fill-[#CCFF00]/20" />
            <span className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] to-[#00F2EA]">
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

        {user && (
          <>
            <div className="ml-2 h-8 w-px bg-border/50" />

            {/* User Dropdown Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "relative h-10 w-10 rounded-full p-0 overflow-hidden transition-all duration-300",
                    isAdmin(user.role)
                      ? "ring-2 ring-[#CCFF00]/50 shadow-[0_0_12px_rgba(204,255,0,0.3)] hover:ring-[#CCFF00]/70 hover:shadow-[0_0_18px_rgba(204,255,0,0.4)]"
                      : "ring-1 ring-white/10 hover:ring-white/30"
                  )}
                >
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-mermaid-cyan to-mermaid-pink">
                      <User className="h-5 w-5 text-white" />
                    </div>
                  )}
                  {/* Admin indicator dot */}
                  {isAdmin(user.role) && (
                    <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#CCFF00] border-2 border-[#0B0C10] shadow-[0_0_6px_rgba(204,255,0,0.6)]" />
                  )}
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
