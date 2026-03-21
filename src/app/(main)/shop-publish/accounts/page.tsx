"use client";

// TikTok Shop Account Management Page
// Pattern: based on existing src/app/(main)/publish/accounts/page.tsx
// Key differences:
//   - API endpoints: /api/shop-publish/accounts, /api/tiktok-shop/auth/authorize
//   - No QR code binding (Shop OAuth is web redirect only)
//   - Shows refresh_token_expires_at status
//   - Redirect path: /shop-publish/accounts

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Store,
    Plus,
    RefreshCw,
    Trash2,
    ExternalLink,
    CheckCircle,
    AlertTriangle,
    Loader2,
    ArrowUpDown,
    ChevronDown,
    Copy,
    ShieldAlert,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ============================================================
// Types
// ============================================================

interface ShopAccount {
    id: string;
    open_id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    follower_count: number;
    following_count: number;
    likes_count: number;
    video_count: number;
    account_type: string;
    status: string;
    token_expires_at: string;
    refresh_token_expires_at: string | null;
    scopes: string[];
    created_at: string;
    updated_at: string;
}

type SortOption = 'auth_time_desc' | 'auth_time_asc' | 'name_asc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: 'auth_time_desc', label: '授权时间 (近→远)' },
    { value: 'auth_time_asc', label: '授权时间 (远→近)' },
    { value: 'name_asc', label: '名称 (A-Z)' },
];

// ============================================================
// Page Component
// ============================================================

export default function ShopAccountsPage() {
    const [accounts, setAccounts] = useState<ShopAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<SortOption>('auth_time_desc');
    const { toast } = useToast();

    // ============================================================
    // URL param toast (success/error from OAuth callback redirect)
    // ============================================================

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const success = params.get("success");
        const error = params.get("error");
        const name = params.get("name");

        if (success && name) {
            toast({
                title: "Shop 账号绑定成功",
                description: `已成功绑定 TikTok Shop 账号: ${name}`,
            });
            window.history.replaceState({}, "", "/shop-publish/accounts");
        }

        if (error) {
            toast({
                variant: "destructive",
                title: "绑定失败",
                description: decodeURIComponent(error),
            });
            window.history.replaceState({}, "", "/shop-publish/accounts");
        }
    }, [toast]);

    // ============================================================
    // Data Fetching
    // ============================================================

    const fetchAccounts = useCallback(async () => {
        try {
            const response = await fetch("/api/shop-publish/accounts");
            if (!response.ok) throw new Error("Failed to fetch accounts");
            const data = await response.json();
            setAccounts(data.accounts || []);
        } catch (error) {
            console.error("Error fetching Shop accounts:", error);
            toast({
                variant: "destructive",
                title: "加载失败",
                description: "无法加载 TikTok Shop 账号列表",
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

    // Sorted accounts
    const sortedAccounts = useMemo(() => {
        return [...accounts].sort((a, b) => {
            switch (sortBy) {
                case 'auth_time_desc':
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                case 'auth_time_asc':
                    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                case 'name_asc':
                    return (a.display_name || '').localeCompare(b.display_name || '');
                default:
                    return 0;
            }
        });
    }, [accounts, sortBy]);

    // ============================================================
    // Actions
    // ============================================================

    // Connect new Shop account (web redirect — no QR code option)
    const handleConnect = async () => {
        setConnecting(true);
        try {
            const response = await fetch("/api/tiktok-shop/auth/authorize", {
                method: "POST",
            });

            if (!response.ok) throw new Error("Failed to generate Shop auth URL");

            const data = await response.json();
            window.location.href = data.authUrl;
        } catch (error) {
            console.error("Error connecting Shop:", error);
            toast({
                variant: "destructive",
                title: "连接失败",
                description: "无法生成 Shop 授权链接，请稍后重试",
            });
            setConnecting(false);
        }
    };

    // Refresh token
    const handleRefresh = async (accountId: string) => {
        setRefreshingId(accountId);
        try {
            const response = await fetch(`/api/shop-publish/accounts/${accountId}/refresh`, {
                method: "POST",
            });

            if (!response.ok) {
                const data = await response.json();
                // ⚠️ 410 Gone = refresh token expired
                if (response.status === 410) {
                    toast({
                        variant: "destructive",
                        title: "授权已过期",
                        description: data.error || "Refresh Token 已过期，请重新绑定账号",
                    });
                    fetchAccounts(); // Refresh to show updated status
                    return;
                }
                throw new Error(data.error || "刷新失败");
            }

            toast({
                title: "刷新成功",
                description: "Shop 账号授权已更新",
            });
            fetchAccounts();
        } catch (error) {
            console.error("Error refreshing Shop token:", error);
            toast({
                variant: "destructive",
                title: "刷新失败",
                description: error instanceof Error ? error.message : "无法刷新授权，请重新绑定账号",
            });
        } finally {
            setRefreshingId(null);
        }
    };

    // Disconnect account
    const handleDisconnect = async (accountId: string) => {
        try {
            const response = await fetch(`/api/shop-publish/accounts/${accountId}`, {
                method: "DELETE",
            });

            if (!response.ok) throw new Error("Failed to disconnect");

            toast({
                title: "解绑成功",
                description: "TikTok Shop 账号已解绑",
            });
            setAccounts(accounts.filter(a => a.id !== accountId));
        } catch (error) {
            console.error("Error disconnecting Shop:", error);
            toast({
                variant: "destructive",
                title: "解绑失败",
                description: "无法解绑账号，请稍后重试",
            });
        }
    };

    // Copy open_id
    const copyOpenId = (openId: string) => {
        navigator.clipboard.writeText(openId);
        toast({
            title: "已复制",
            description: "唯一标识符已复制到剪贴板",
        });
    };

    // ============================================================
    // Helpers
    // ============================================================

    const isTokenExpiringSoon = (expiresAt: string) => {
        const expiry = new Date(expiresAt);
        const now = new Date();
        const daysUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return daysUntilExpiry < 3; // Shop tokens expire in ~7 days, warn at 3
    };

    const isRefreshTokenExpired = (refreshExpiresAt: string | null) => {
        if (!refreshExpiresAt) return false;
        return new Date(refreshExpiresAt) <= new Date();
    };

    // ============================================================
    // Render
    // ============================================================

    return (
        <div className="space-y-6">
            {/* Page Header — JCUI 2.0 Titanium Bar */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-1.5 h-14 rounded-full bg-gradient-to-b from-[#CCFF00] via-[#00F2EA] to-[#EC4899]" />
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                            <Store className="h-6 w-6" />
                            TikTok Shop 账号绑定
                        </h1>
                        <p className="text-white/50 text-sm mt-0.5">
                            绑定和管理您的 TikTok Shop 达人账号，用于发布橱窗视频
                        </p>
                    </div>
                </div>
                <button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="group relative flex items-center gap-2 px-5 py-2.5 rounded-lg overflow-hidden bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black font-bold text-sm transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(0,242,234,0.5)] disabled:opacity-50"
                >
                    <div className="absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent pointer-events-none" />
                    <div className="absolute top-[10%] left-0 right-0 h-[35%] bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-lg" />
                    {connecting ? (
                        <Loader2 className="h-4 w-4 animate-spin relative z-10" />
                    ) : (
                        <Plus className="h-4 w-4 relative z-10" />
                    )}
                    <span className="relative z-10">绑定 Shop 账号</span>
                </button>
            </div>

            {/* Sort Controls */}
            {!loading && accounts.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-muted-foreground">
                        已绑定 {accounts.length} 个 Shop 账号
                    </span>
                    <div className="flex-1" />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                                <ArrowUpDown className="h-4 w-4" />
                                排序: {SORT_OPTIONS.find(o => o.value === sortBy)?.label}
                                <ChevronDown className="h-3 w-3" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {SORT_OPTIONS.map(option => (
                                <DropdownMenuItem
                                    key={option.value}
                                    onClick={() => setSortBy(option.value)}
                                    className={sortBy === option.value ? 'bg-accent' : ''}
                                >
                                    {option.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Empty State — JCUI 2.0 Glass Panel */}
            {!loading && accounts.length === 0 && (
                <div className="bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm">
                    <div className="flex flex-col items-center justify-center py-16">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#CCFF00]/20 via-[#00F2EA]/20 to-[#EC4899]/20 flex items-center justify-center mb-6 border border-white/10">
                            <Store className="h-10 w-10 text-[#00F2EA]" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">还没有绑定 Shop 账号</h3>
                        <p className="text-white/50 text-center max-w-md text-sm">
                            绑定您的 TikTok Shop 达人账号后，可以直接从平台发布带商品链接的橱窗视频
                        </p>
                        <button
                            onClick={handleConnect}
                            disabled={connecting}
                            className="mt-6 group relative flex items-center gap-2 px-5 py-2.5 rounded-lg overflow-hidden bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black font-bold text-sm transition-all duration-500 hover:scale-[1.02] disabled:opacity-50"
                        >
                            <div className="absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent pointer-events-none" />
                            <Plus className="h-4 w-4 relative z-10" />
                            <span className="relative z-10">绑定 Shop 账号</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Account Cards */}
            <div className="grid gap-4">
                {sortedAccounts.map((account) => (
                    <Card key={account.id} className="overflow-hidden">
                        <CardHeader className="pb-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-4">
                                    {/* Avatar */}
                                    <div className="relative">
                                        {account.avatar_url ? (
                                            <img
                                                src={account.avatar_url}
                                                alt={account.display_name || "Shop"}
                                                className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-md"
                                            />
                                        ) : (
                                            <div className="w-16 h-16 rounded-full bg-gradient-to-r from-[#00F2EA] to-[#EC4899] flex items-center justify-center text-white text-xl font-bold">
                                                {(account.display_name || "S").charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        {account.status === "active" && (
                                            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
                                                <CheckCircle className="h-3 w-3 text-white" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Account Info */}
                                    <div>
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            {account.display_name || account.open_id.substring(0, 8)}
                                            <Badge variant="outline" className="text-xs">
                                                <Store className="h-3 w-3 mr-1" />
                                                达人账号
                                            </Badge>
                                            <Badge variant={account.status === "active" ? "default" : "destructive"}>
                                                {account.status === "active" ? "已授权" : "需重新授权"}
                                            </Badge>
                                        </CardTitle>
                                        <CardDescription className="flex items-center gap-4 mt-1">
                                            <span>粉丝: {account.follower_count}</span>
                                            <span>视频: {account.video_count}</span>
                                        </CardDescription>
                                        {account.username && (
                                            <div className="flex items-center gap-1.5 mt-2">
                                                <span className="text-xs text-muted-foreground">用户名:</span>
                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-cyan-500">
                                                    @{account.username}
                                                </code>
                                                <button
                                                    onClick={() => copyOpenId(account.username!)}
                                                    className="p-1 hover:bg-muted rounded transition-colors"
                                                    title="复制用户名"
                                                >
                                                    <Copy className="h-3 w-3 text-muted-foreground" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRefresh(account.id)}
                                        disabled={refreshingId === account.id}
                                    >
                                        {refreshingId === account.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <RefreshCw className="h-4 w-4" />
                                        )}
                                        <span className="ml-2 hidden sm:inline">刷新授权</span>
                                    </Button>

                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                                                <Trash2 className="h-4 w-4" />
                                                <span className="ml-2 hidden sm:inline">解绑</span>
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>确认解绑 Shop 账号？</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    解绑后，将无法向该账号发布橱窗视频。已创建的发布任务不会受到影响，但待发布的任务将失败。
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>取消</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => handleDisconnect(account.id)}
                                                    className="bg-destructive hover:bg-destructive/90"
                                                >
                                                    确认解绑
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </div>
                        </CardHeader>

                        <CardContent className="pt-0">
                            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                                {/* Access Token Expiry */}
                                <div className="flex items-center gap-1">
                                    <span>Access Token:</span>
                                    {isTokenExpiringSoon(account.token_expires_at) ? (
                                        <Badge variant="destructive" className="flex items-center gap-1">
                                            <AlertTriangle className="h-3 w-3" />
                                            {formatDistanceToNow(new Date(account.token_expires_at), {
                                                addSuffix: true,
                                                locale: zhCN
                                            })}
                                        </Badge>
                                    ) : (
                                        <span>
                                            {formatDistanceToNow(new Date(account.token_expires_at), {
                                                addSuffix: true,
                                                locale: zhCN
                                            })}
                                        </span>
                                    )}
                                </div>

                                {/* Refresh Token Expiry — Shop-specific */}
                                {account.refresh_token_expires_at && (
                                    <div className="flex items-center gap-1">
                                        <span>Refresh Token:</span>
                                        {isRefreshTokenExpired(account.refresh_token_expires_at) ? (
                                            <Badge variant="destructive" className="flex items-center gap-1">
                                                <ShieldAlert className="h-3 w-3" />
                                                已过期 — 需重新授权
                                            </Badge>
                                        ) : (
                                            <span>
                                                {formatDistanceToNow(new Date(account.refresh_token_expires_at), {
                                                    addSuffix: true,
                                                    locale: zhCN
                                                })}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Binding time */}
                                <div className="flex items-center gap-1">
                                    <span>绑定时间:</span>
                                    <span>
                                        {format(new Date(account.created_at), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Info Card */}
            {accounts.length > 0 && (
                <Card className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border-cyan-500/20">
                    <CardContent className="flex items-start gap-3 py-4">
                        <ExternalLink className="h-5 w-5 text-cyan-500 mt-0.5 shrink-0" />
                        <div className="text-sm">
                            <p className="font-medium text-foreground">关于 TikTok Shop 授权</p>
                            <p className="text-muted-foreground mt-1">
                                Shop Access Token 有效期约 7 天，可通过"刷新授权"按钮续期。
                                Refresh Token 的有效期由您在 TikTok Shop 中设置的授权时长决定。
                                当 Refresh Token 过期后，需要重新绑定账号。
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
