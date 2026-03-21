"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
    ArrowUpDown,
    Hash,
    Copy,
    ChevronDown,
    Smartphone,
    Globe,
    Sparkles,
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface TikTokAccount {
    id: string;
    open_id: string;
    username: string | null;  // Actual TikTok @handle
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

type SortOption = 'followers_desc' | 'followers_asc' | 'auth_time_desc' | 'auth_time_asc' | 'name_asc';
type GroupOption = 'none' | 'type';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: 'followers_desc', label: '粉丝数 (高→低)' },
    { value: 'followers_asc', label: '粉丝数 (低→高)' },
    { value: 'auth_time_desc', label: '授权时间 (近→远)' },
    { value: 'auth_time_asc', label: '授权时间 (远→近)' },
    { value: 'name_asc', label: '名称 (A-Z)' },
];

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
    normal: '普通账号',
    shop_creator: '达人账号',
    shop_merchant: '商家账号',
};

export default function TikTokAccountsPage() {
    const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<SortOption>('followers_desc');
    const [groupBy, setGroupBy] = useState<GroupOption>('none');
    const [showBindingModal, setShowBindingModal] = useState(false);
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

    // Sorted and grouped accounts
    const sortedAccounts = useMemo(() => {
        const sorted = [...accounts].sort((a, b) => {
            switch (sortBy) {
                case 'followers_desc':
                    return b.follower_count - a.follower_count;
                case 'followers_asc':
                    return a.follower_count - b.follower_count;
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
        return sorted;
    }, [accounts, sortBy]);

    const groupedAccounts = useMemo(() => {
        if (groupBy === 'none') {
            return [{ group: null, accounts: sortedAccounts }];
        }

        const groups: Record<string, TikTokAccount[]> = {};
        sortedAccounts.forEach(account => {
            const key = account.account_type || 'unknown';
            if (!groups[key]) groups[key] = [];
            groups[key].push(account);
        });

        return Object.entries(groups).map(([group, accounts]) => ({
            group: ACCOUNT_TYPE_LABELS[group] || group,
            accounts
        }));
    }, [sortedAccounts, groupBy]);

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

    // Copy open_id to clipboard
    const copyOpenId = (openId: string) => {
        navigator.clipboard.writeText(openId);
        toast({
            title: "已复制",
            description: "唯一标识符已复制到剪贴板",
        });
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
            {/* Page Header - JCUI 2.0 Titanium Bar */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {/* Vertical Gradient Bar */}
                    <div className="w-1.5 h-14 rounded-full bg-gradient-to-b from-[#CCFF00] via-[#00F2EA] to-[#EC4899]" />
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                            TikTok 账号绑定
                        </h1>
                        <p className="text-white/50 text-sm mt-0.5">
                            绑定和管理您的 TikTok 账号，用于发布视频内容
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => setShowBindingModal(true)}
                    disabled={connecting}
                    className="group relative flex items-center gap-2 px-5 py-2.5 rounded-lg overflow-hidden bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black font-bold text-sm transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(0,242,234,0.5)] disabled:opacity-50"
                >
                    {/* Glass shine */}
                    <div className="absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent pointer-events-none" />
                    <div className="absolute top-[10%] left-0 right-0 h-[35%] bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-lg" />
                    {connecting ? (
                        <Loader2 className="h-4 w-4 animate-spin relative z-10" />
                    ) : (
                        <Plus className="h-4 w-4 relative z-10" />
                    )}
                    <span className="relative z-10">绑定 TikTok 账号</span>
                </button>
            </div>

            {/* Sort and Group Controls */}
            {!loading && accounts.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-muted-foreground">已绑定 {accounts.length} 个账号</span>
                    <div className="flex-1" />

                    {/* Sort Dropdown */}
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

                    {/* Group Toggle */}
                    <Button
                        variant={groupBy === 'type' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setGroupBy(groupBy === 'none' ? 'type' : 'none')}
                        className="gap-2"
                    >
                        <Hash className="h-4 w-4" />
                        按类型分组
                    </Button>
                </div>
            )}

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Empty State - JCUI 2.0 Glass Panel */}
            {!loading && accounts.length === 0 && (
                <div className="bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm">
                    <div className="flex flex-col items-center justify-center py-16">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#CCFF00]/20 via-[#00F2EA]/20 to-[#EC4899]/20 flex items-center justify-center mb-6 border border-white/10">
                            <UserPlus className="h-10 w-10 text-[#EC4899]" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">还没有绑定 TikTok 账号</h3>
                        <p className="text-white/50 text-center max-w-md text-sm">
                            绑定您的 TikTok 账号后，可以直接从平台发布 AI 生成的视频内容
                        </p>
                    </div>
                </div>
            )}

            {/* Account Cards - Grouped */}
            {groupedAccounts.map(({ group, accounts: groupAccounts }, groupIndex) => (
                <div key={group || 'all'} className="space-y-4">
                    {group && (
                        <div className="flex items-center gap-2 pt-4">
                            <Badge variant="outline" className="text-sm font-medium">
                                {group}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                                ({groupAccounts.length} 个账号)
                            </span>
                        </div>
                    )}

                    <div className="grid gap-4">
                        {groupAccounts.map((account) => (
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
                                                    <span className="font-semibold text-cyan-500">{formatNumber(account.follower_count)} 粉丝</span>
                                                    <span>视频: {formatNumber(account.video_count)}</span>
                                                    <span>获赞: {formatNumber(account.likes_count)}</span>
                                                </CardDescription>
                                                {/* TikTok Username / Handle - only show if we have a real username */}
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
                                                {ACCOUNT_TYPE_LABELS[account.account_type] || account.account_type}
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
                                                {format(new Date(account.created_at), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                                            </span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            ))}

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
            {/* Binding Method Selection Modal */}
            <Dialog open={showBindingModal} onOpenChange={setShowBindingModal}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <UserPlus className="h-5 w-5 text-pink-500" />
                            选择绑定方式
                        </DialogTitle>
                        <DialogDescription>
                            选择一种方式来绑定您的 TikTok 账号
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        {/* QR Code Scan - Recommended */}
                        <button
                            onClick={() => {
                                setShowBindingModal(false);
                                handleConnect();
                            }}
                            disabled={connecting}
                            className="flex items-start gap-4 p-4 rounded-xl border-2 border-cyan-500/50 bg-gradient-to-r from-cyan-500/10 to-pink-500/10 hover:from-cyan-500/20 hover:to-pink-500/20 transition-all text-left relative overflow-hidden group"
                        >
                            <div className="absolute top-2 right-2">
                                <Badge className="bg-gradient-to-r from-cyan-500 to-pink-500 text-white text-xs">
                                    <Sparkles className="h-3 w-3 mr-1" />
                                    推荐
                                </Badge>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0">
                                <Smartphone className="h-6 w-6 text-cyan-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-lg mb-1">📱 扫码绑定</h4>
                                <p className="text-sm text-muted-foreground mb-2">
                                    使用 TikTok APP 扫描二维码完成授权，更安全便捷
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <Badge variant="outline" className="text-xs">
                                        ✓ 无需输入密码
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                        ✓ 手机确认更安全
                                    </Badge>
                                </div>
                            </div>
                        </button>

                        {/* Web Login */}
                        <button
                            onClick={() => {
                                setShowBindingModal(false);
                                handleConnect();
                            }}
                            disabled={connecting}
                            className="flex items-start gap-4 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-left group"
                        >
                            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                                <Globe className="h-6 w-6 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-lg mb-1">🌐 网页登录绑定</h4>
                                <p className="text-sm text-muted-foreground mb-2">
                                    跳转到 TikTok 网站使用账号密码登录授权
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <Badge variant="outline" className="text-xs">
                                        适合已登录网页版用户
                                    </Badge>
                                </div>
                            </div>
                        </button>
                    </div>

                    <div className="text-xs text-muted-foreground text-center">
                        <p>绑定成功后，授权有效期为 90 天，可随时刷新或解绑</p>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

