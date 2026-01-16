"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Users,
    Plus,
    RefreshCw,
    Trash2,
    ExternalLink,
    CheckCircle,
    AlertTriangle,
    Loader2,
    UserPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
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

interface TikTokAccount {
    id: string;
    open_id: string;
    display_name: string | null;
    avatar_url: string | null;
    follower_count: number;
    following_count: number;
    likes_count: number;
    video_count: number;
    account_type: string;
    status: string;
    token_expires_at: string;
    scopes: string[];
    created_at: string;
    updated_at: string;
}

export default function TikTokAccountsPage() {
    const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    const { toast } = useToast();

    // Get URL params for success/error messages
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const success = params.get("success");
        const error = params.get("error");
        const name = params.get("name");

        if (success && name) {
            toast({
                title: "账号绑定成功",
                description: `已成功绑定 TikTok 账号: ${name}`,
            });
            // Clean up URL
            window.history.replaceState({}, "", "/publish/accounts");
        }

        if (error) {
            toast({
                variant: "destructive",
                title: "绑定失败",
                description: decodeURIComponent(error),
            });
            window.history.replaceState({}, "", "/publish/accounts");
        }
    }, [toast]);

    // Fetch accounts
    const fetchAccounts = useCallback(async () => {
        try {
            const response = await fetch("/api/publish/accounts");
            if (!response.ok) {
                throw new Error("Failed to fetch accounts");
            }
            const data = await response.json();
            setAccounts(data.accounts || []);
        } catch (error) {
            console.error("Error fetching accounts:", error);
            toast({
                variant: "destructive",
                title: "加载失败",
                description: "无法加载 TikTok 账号列表",
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

    // Connect new TikTok account
    const handleConnect = async () => {
        setConnecting(true);
        try {
            const response = await fetch("/api/tiktok/auth/url", {
                method: "POST",
            });

            if (!response.ok) {
                throw new Error("Failed to generate auth URL");
            }

            const data = await response.json();

            // Redirect to TikTok authorization
            window.location.href = data.authUrl;
        } catch (error) {
            console.error("Error connecting:", error);
            toast({
                variant: "destructive",
                title: "连接失败",
                description: "无法生成授权链接，请稍后重试",
            });
            setConnecting(false);
        }
    };

    // Refresh account token
    const handleRefresh = async (accountId: string) => {
        setRefreshingId(accountId);
        try {
            const response = await fetch(`/api/publish/accounts/${accountId}/refresh`, {
                method: "POST",
            });

            if (!response.ok) {
                throw new Error("Failed to refresh token");
            }

            toast({
                title: "刷新成功",
                description: "账号授权已更新",
            });

            fetchAccounts();
        } catch (error) {
            console.error("Error refreshing:", error);
            toast({
                variant: "destructive",
                title: "刷新失败",
                description: "无法刷新授权，请重新绑定账号",
            });
        } finally {
            setRefreshingId(null);
        }
    };

    // Disconnect account
    const handleDisconnect = async (accountId: string) => {
        try {
            const response = await fetch(`/api/publish/accounts/${accountId}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                throw new Error("Failed to disconnect");
            }

            toast({
                title: "解绑成功",
                description: "TikTok 账号已解绑",
            });

            setAccounts(accounts.filter(a => a.id !== accountId));
        } catch (error) {
            console.error("Error disconnecting:", error);
            toast({
                variant: "destructive",
                title: "解绑失败",
                description: "无法解绑账号，请稍后重试",
            });
        }
    };

    const formatNumber = (num: number) => {
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + "万";
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + "K";
        }
        return num.toString();
    };

    const isTokenExpiringSoon = (expiresAt: string) => {
        const expiry = new Date(expiresAt);
        const now = new Date();
        const daysUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return daysUntilExpiry < 7;
    };

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Users className="h-6 w-6 text-pink-500" />
                        TikTok 账号管理
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        绑定和管理您的 TikTok 账号，用于发布视频内容
                    </p>
                </div>
                <Button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="bg-gradient-to-r from-cyan-500 to-pink-500 hover:opacity-90"
                >
                    {connecting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                        <Plus className="h-4 w-4 mr-2" />
                    )}
                    绑定 TikTok 账号
                </Button>
            </div>

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Empty State */}
            {!loading && accounts.length === 0 && (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-r from-cyan-500/20 to-pink-500/20 flex items-center justify-center mb-4">
                            <UserPlus className="h-8 w-8 text-pink-500" />
                        </div>
                        <h3 className="text-xl font-semibold mb-2">还没有绑定 TikTok 账号</h3>
                        <p className="text-muted-foreground text-center max-w-md mb-6">
                            绑定您的 TikTok 账号后，可以直接从平台发布 AI 生成的视频内容
                        </p>
                        <Button
                            onClick={handleConnect}
                            disabled={connecting}
                            size="lg"
                            className="bg-gradient-to-r from-cyan-500 to-pink-500 hover:opacity-90"
                        >
                            {connecting ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Plus className="h-4 w-4 mr-2" />
                            )}
                            立即绑定 TikTok 账号
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Account Cards */}
            <div className="grid gap-4">
                {accounts.map((account) => (
                    <Card key={account.id} className="overflow-hidden">
                        <CardHeader className="pb-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-4">
                                    {/* Avatar */}
                                    <div className="relative">
                                        {account.avatar_url ? (
                                            <img
                                                src={account.avatar_url}
                                                alt={account.display_name || "TikTok"}
                                                className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-md"
                                            />
                                        ) : (
                                            <div className="w-16 h-16 rounded-full bg-gradient-to-r from-cyan-500 to-pink-500 flex items-center justify-center text-white text-xl font-bold">
                                                {(account.display_name || "T").charAt(0).toUpperCase()}
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
                                            @{account.display_name || account.open_id.substring(0, 8)}
                                            <Badge variant={account.status === "active" ? "default" : "destructive"}>
                                                {account.status === "active" ? "已授权" : "需重新授权"}
                                            </Badge>
                                        </CardTitle>
                                        <CardDescription className="flex items-center gap-4 mt-1">
                                            <span>粉丝: {formatNumber(account.follower_count)}</span>
                                            <span>视频: {formatNumber(account.video_count)}</span>
                                            <span>获赞: {formatNumber(account.likes_count)}</span>
                                        </CardDescription>
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
                                                <AlertDialogTitle>确认解绑账号？</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    解绑后，将无法向该账号发布视频。已创建的发布任务不会受到影响，但待发布的任务将失败。
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
                                <div className="flex items-center gap-1">
                                    <span>类型:</span>
                                    <Badge variant="outline">
                                        {account.account_type === "normal" ? "普通账号" :
                                            account.account_type === "shop_creator" ? "达人账号" : "商家账号"}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span>授权到期:</span>
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
                                <div className="flex items-center gap-1">
                                    <span>绑定时间:</span>
                                    <span>
                                        {formatDistanceToNow(new Date(account.created_at), {
                                            addSuffix: true,
                                            locale: zhCN
                                        })}
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
                            <p className="font-medium text-foreground">关于 TikTok 授权</p>
                            <p className="text-muted-foreground mt-1">
                                TikTok 授权有效期通常为 90 天。建议定期刷新授权以确保发布功能正常工作。
                                如果授权过期，需要重新绑定账号。
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
