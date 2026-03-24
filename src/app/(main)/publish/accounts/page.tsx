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
                            <div key={account.id} className="relative rounded-2xl bg-white/[0.03] border border-white/[0.08] overflow-hidden transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.04]" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.2)' }}>
                                {/* Top accent line */}
                                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

                                <div className="p-5">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-4">
                                            {/* Avatar with gradient ring */}
                                            <div className="relative">
                                                <div className="w-14 h-14 rounded-full p-[2px] bg-gradient-to-br from-[#CCFF00] via-[#00F2EA] to-[#EC4899]">
                                                    {account.avatar_url ? (
                                                        <img
                                                            src={account.avatar_url}
                                                            alt={account.display_name || "TikTok"}
                                                            className="w-full h-full rounded-full object-cover border-2 border-neutral-950"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full rounded-full bg-neutral-900 border-2 border-neutral-950 flex items-center justify-center text-white text-lg font-bold">
                                                            {(account.display_name || "T").charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                </div>
                                                {account.status === "active" && (
                                                    <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-emerald-500 rounded-full border-[2.5px] border-neutral-950 flex items-center justify-center" style={{ boxShadow: '0 0 8px rgba(52,211,153,0.5)' }}>
                                                        <CheckCircle className="h-2.5 w-2.5 text-white" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Account Info */}
                                            <div>
                                                <div className="flex items-center gap-2.5">
                                                    <h3 className="text-[17px] font-bold text-white tracking-tight">
                                                        @{account.display_name || account.open_id.substring(0, 8)}
                                                    </h3>
                                                    {account.status === "active" ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                                                            <CheckCircle className="w-3 h-3" /> 已授权
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
                                                            <AlertTriangle className="w-3 h-3" /> 需重新授权
                                                        </span>
                                                    )}
                                                </div>
                                                {/* Stats row */}
                                                <div className="flex items-center gap-3 mt-1.5">
                                                    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-cyan-400">
                                                        <Users className="w-3.5 h-3.5 text-cyan-500/60" />
                                                        {formatNumber(account.follower_count)} <span className="font-normal text-white/30">粉丝</span>
                                                    </span>
                                                    <span className="text-white/10">·</span>
                                                    <span className="text-[13px] text-white/40">
                                                        视频 <span className="text-white/60 font-medium">{formatNumber(account.video_count)}</span>
                                                    </span>
                                                    <span className="text-white/10">·</span>
                                                    <span className="text-[13px] text-white/40">
                                                        获赞 <span className="text-white/60 font-medium">{formatNumber(account.likes_count)}</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleRefresh(account.id)}
                                                disabled={refreshingId === account.id}
                                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium bg-white/[0.04] border border-white/[0.08] text-white/70 hover:bg-white/[0.08] hover:text-white hover:border-white/[0.15] transition-all duration-200 disabled:opacity-40"
                                            >
                                                {refreshingId === account.id ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                )}
                                                <span className="hidden sm:inline">刷新授权</span>
                                            </button>

                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <button className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium bg-white/[0.04] border border-white/[0.08] text-red-400/70 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all duration-200">
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                        <span className="hidden sm:inline">解绑</span>
                                                    </button>
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

                                    {/* Bottom meta row */}
                                    <div className="flex flex-wrap items-center gap-3 mt-4 pt-3.5 border-t border-white/[0.05]">
                                        <span className="inline-flex items-center gap-1.5 text-[12px] text-white/35 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                                            类型
                                            <span className="text-white/55 font-medium">{ACCOUNT_TYPE_LABELS[account.account_type] || account.account_type}</span>
                                        </span>
                                        <span className={`inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-lg border ${isTokenExpiringSoon(account.token_expires_at) ? 'text-red-400/80 bg-red-500/[0.06] border-red-500/15' : 'text-emerald-400/70 bg-emerald-500/[0.04] border-emerald-500/10'}`}>
                                            {isTokenExpiringSoon(account.token_expires_at) ? (
                                                <>
                                                    <AlertTriangle className="h-3 w-3" />
                                                    {formatDistanceToNow(new Date(account.token_expires_at), { addSuffix: false, locale: zhCN })}内到期
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle className="h-3 w-3" />
                                                    约{formatDistanceToNow(new Date(account.token_expires_at), { addSuffix: false, locale: zhCN })}后到期
                                                </>
                                            )}
                                        </span>
                                        <span className="inline-flex items-center gap-1.5 text-[12px] text-white/35 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                                            绑定时间
                                            <span className="text-white/50">{format(new Date(account.created_at), 'yyyy-MM-dd HH:mm', { locale: zhCN })}</span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {/* Info Banner */}
            {accounts.length > 0 && (
                <div className="flex items-start gap-3 px-5 py-4 rounded-xl bg-gradient-to-r from-cyan-500/[0.04] via-transparent to-pink-500/[0.04] border border-white/[0.06]">
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/15 flex items-center justify-center shrink-0 mt-0.5">
                        <ExternalLink className="h-4 w-4 text-cyan-400/70" />
                    </div>
                    <div>
                        <p className="text-[13px] font-semibold text-white/70">关于 TikTok 授权</p>
                        <p className="text-[12px] text-white/35 mt-0.5 leading-relaxed">
                            TikTok 授权有效期为 90 天。建议定期点击「刷新授权」以延长有效期。如果授权过期超过 90 天，需要重新绑定账号。
                        </p>
                    </div>
                </div>
            )}
            {/* Binding Method Selection Modal */}
            <Dialog open={showBindingModal} onOpenChange={setShowBindingModal}>
                <DialogContent className="sm:max-w-[460px] p-0 overflow-hidden bg-neutral-950/95 backdrop-blur-2xl border border-white/[0.08] shadow-[0_32px_64px_rgba(0,0,0,0.8)]">
                    {/* Header */}
                    <div className="px-6 pt-6 pb-4">
                        <DialogTitle className="flex items-center gap-3 text-[22px] font-bold tracking-tight text-white">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#CCFF00]/20 via-[#00F2EA]/15 to-[#EC4899]/20 border border-white/10 flex items-center justify-center" style={{ boxShadow: '0 0 20px rgba(0,242,234,0.15), inset 0 1px 1px rgba(255,255,255,0.1)' }}>
                                <UserPlus className="h-[18px] w-[18px] text-[#00F2EA]" />
                            </div>
                            选择绑定方式
                        </DialogTitle>
                        <DialogDescription className="text-[13px] text-white/40 mt-1.5 pl-12">
                            选择一种方式来绑定您的 TikTok 账号
                        </DialogDescription>
                    </div>

                    <div className="px-5 pb-5 space-y-3">
                        {/* QR Code Scan - Recommended */}
                        <button
                            onClick={() => {
                                setShowBindingModal(false);
                                handleConnect();
                            }}
                            disabled={connecting}
                            className="group relative w-full flex items-start gap-4 p-4 rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/[0.06] via-transparent to-pink-500/[0.04] hover:from-cyan-500/[0.12] hover:to-pink-500/[0.08] hover:border-cyan-400/40 transition-all duration-300 text-left overflow-hidden"
                            style={{ boxShadow: '0 0 1px rgba(0,242,234,0.3), inset 0 1px 0 rgba(255,255,255,0.04)' }}
                        >
                            {/* Recommended Badge */}
                            <div className="absolute top-3 right-3">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-gradient-to-r from-cyan-500/90 to-pink-500/90 text-white shadow-sm" style={{ boxShadow: '0 0 12px rgba(0,242,234,0.3)' }}>
                                    <Sparkles className="h-3 w-3" />
                                    推荐
                                </span>
                            </div>
                            {/* Icon */}
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-400/15 via-cyan-500/10 to-transparent border border-cyan-400/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-300" style={{ boxShadow: '0 0 16px rgba(0,242,234,0.12), inset 0 1px 1px rgba(255,255,255,0.08)' }}>
                                <Smartphone className="h-5 w-5 text-cyan-400 group-hover:drop-shadow-[0_0_6px_rgba(34,211,238,0.5)] transition-all duration-300" />
                            </div>
                            {/* Content */}
                            <div className="flex-1 min-w-0 pt-0.5">
                                <h4 className="text-[15px] font-semibold text-white mb-1 tracking-tight">扫码绑定</h4>
                                <p className="text-[12px] text-white/40 mb-2.5 leading-relaxed">
                                    使用 TikTok APP 扫描二维码完成授权，更安全便捷
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    <span className="inline-flex items-center gap-1 text-[11px] text-white/50 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
                                        <CheckCircle className="w-3 h-3 text-emerald-400/70" /> 无需输入密码
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-[11px] text-white/50 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
                                        <CheckCircle className="w-3 h-3 text-emerald-400/70" /> 手机确认更安全
                                    </span>
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
                            className="group relative w-full flex items-start gap-4 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-300 text-left"
                        >
                            {/* Icon */}
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-300">
                                <Globe className="h-5 w-5 text-white/40 group-hover:text-white/60 transition-colors duration-300" />
                            </div>
                            {/* Content */}
                            <div className="flex-1 min-w-0 pt-0.5">
                                <h4 className="text-[15px] font-semibold text-white/80 mb-1 tracking-tight group-hover:text-white transition-colors">网页登录绑定</h4>
                                <p className="text-[12px] text-white/35 mb-2.5 leading-relaxed">
                                    跳转到 TikTok 网站使用账号密码登录授权
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    <span className="inline-flex items-center text-[11px] text-white/40 px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05]">
                                        适合已登录网页版用户
                                    </span>
                                </div>
                            </div>
                        </button>
                    </div>

                    {/* Footer */}
                    <div className="px-6 pb-5 pt-1">
                        <p className="text-[11px] text-white/25 text-center leading-relaxed">
                            绑定成功后，授权有效期为 90 天，可随时刷新或解绑
                        </p>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

