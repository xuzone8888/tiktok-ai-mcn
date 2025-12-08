"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Settings, User, Shield, LogOut, UserCircle, Zap, ChevronDown, Loader2, Globe, Plane } from "lucide-react";
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

// 版本配置
const VERSION_CONFIG = {
  domestic: {
    name: "国内版",
    url: "https://tokfactoryai.com",
    icon: Globe,
    description: "适合国内用户，访问更稳定",
  },
  overseas: {
    name: "海外版",
    url: "https://tiktok-ai-mcn.vercel.app",
    icon: Plane,
    description: "适合海外用户，需要科学上网",
  },
};

// 检测当前版本
const getCurrentVersion = (): "domestic" | "overseas" => {
  if (typeof window === "undefined") return "domestic";
  const hostname = window.location.hostname;
  if (hostname.includes("vercel.app") || hostname.includes("localhost")) {
    return "overseas";
  }
  return "domestic";
};

export function Header() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showVersionDialog, setShowVersionDialog] = useState(false);
  const [targetVersion, setTargetVersion] = useState<"domestic" | "overseas">("overseas");
  const [currentVersion, setCurrentVersion] = useState<"domestic" | "overseas">("domestic");

  // 检测当前版本
  useEffect(() => {
    setCurrentVersion(getCurrentVersion());
  }, []);

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

        {/* Version Switch */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const target = currentVersion === "domestic" ? "overseas" : "domestic";
                  setTargetVersion(target);
                  setShowVersionDialog(true);
                }}
                className="h-9 gap-2 rounded-xl px-3 hover:bg-muted/50 border border-border/50"
              >
                {currentVersion === "domestic" ? (
                  <>
                    <Globe className="h-4 w-4 text-tiktok-cyan" />
                    <span className="text-xs font-medium hidden sm:inline">国内版</span>
                  </>
                ) : (
                  <>
                    <Plane className="h-4 w-4 text-tiktok-pink" />
                    <span className="text-xs font-medium hidden sm:inline">海外版</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>点击切换到{currentVersion === "domestic" ? "海外版" : "国内版"}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

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
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{user.name}</span>
                    {/* Admin Badge */}
                    {isAdmin(user.role) && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                        {user.role === "super_admin" ? "SA" : "A"}
                      </span>
                    )}
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

      {/* Version Switch Dialog */}
      <Dialog open={showVersionDialog} onOpenChange={setShowVersionDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {targetVersion === "overseas" ? (
                <Plane className="h-5 w-5 text-tiktok-pink" />
              ) : (
                <Globe className="h-5 w-5 text-tiktok-cyan" />
              )}
              切换到{VERSION_CONFIG[targetVersion].name}
            </DialogTitle>
            <DialogDescription className="text-left">
              {targetVersion === "overseas" ? (
                <div className="space-y-2 mt-2">
                  <p>您即将切换到<span className="font-semibold text-tiktok-pink">海外版</span>服务器。</p>
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <p className="text-amber-400 text-sm font-medium">⚠️ 网络提示</p>
                    <p className="text-amber-400/80 text-xs mt-1">
                      海外版需要科学上网才能正常访问，请确保您的网络环境已配置好。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 mt-2">
                  <p>您即将切换到<span className="font-semibold text-tiktok-cyan">国内版</span>服务器。</p>
                  <div className="p-3 rounded-lg bg-tiktok-cyan/10 border border-tiktok-cyan/30">
                    <p className="text-tiktok-cyan text-sm font-medium">✓ 国内访问</p>
                    <p className="text-tiktok-cyan/80 text-xs mt-1">
                      国内版服务器部署在阿里云，访问更快更稳定。
                    </p>
                  </div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setShowVersionDialog(false)}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                window.location.href = VERSION_CONFIG[targetVersion].url;
              }}
              className={cn(
                "font-medium",
                targetVersion === "overseas"
                  ? "bg-gradient-to-r from-tiktok-pink to-purple-500 hover:from-tiktok-pink/90 hover:to-purple-500/90"
                  : "bg-gradient-to-r from-tiktok-cyan to-blue-500 hover:from-tiktok-cyan/90 hover:to-blue-500/90"
              )}
            >
              确认切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
