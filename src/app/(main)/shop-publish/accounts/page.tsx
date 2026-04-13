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
import { zhCN, enUS } from "date-fns/locale";
import { useLang } from "@/contexts/LangContext";
import SHOP_TEXT, { localizeError, getAccountRemovedDesc, getRemoveDialogDesc, getInfoCardDesc, type Lang } from "@/components/shop-publish/shop-publish.i18n";
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

function getSortOptions(lang: Lang): { value: SortOption; label: string }[] {
    const T = SHOP_TEXT.accounts
    return [
        { value: 'auth_time_desc', label: T.sortNewest[lang] },
        { value: 'auth_time_asc', label: T.sortOldest[lang] },
        { value: 'name_asc', label: T.sortName[lang] },
    ]
}

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
    const { lang } = useLang();
    const T = SHOP_TEXT.accounts;
    const SORT_OPTIONS = getSortOptions(lang);
    const dateLocale = lang === 'zh' ? zhCN : enUS;

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
                title: T.connected[lang],
                description: `${T.connectedDesc[lang]}: ${name}`,
            });
            window.history.replaceState({}, "", "/shop-publish/accounts");
        }

        if (error) {
            toast({
                variant: "destructive",
                title: T.connectFailed[lang],
                description: localizeError(decodeURIComponent(error), lang),
            });
            window.history.replaceState({}, "", "/shop-publish/accounts");
        }
    }, [toast, lang]);

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
                title: T.loadFailed[lang],
                description: T.loadFailedDesc[lang],
            });
        } finally {
            setLoading(false);
        }
    }, [toast, lang]);

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
                title: T.connectFailed[lang],
                description: T.connectFailedDesc[lang],
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
                if (response.status === 410) {
                    toast({
                        variant: "destructive",
                        title: T.authExpired[lang],
                        description: T.authExpiredDesc[lang],
                    });
                    fetchAccounts();
                    return;
                }
                throw new Error(data.error || "Refresh failed");
            }

            toast({
                title: T.refreshOk[lang],
                description: T.refreshOkDesc[lang],
            });
            fetchAccounts();
        } catch (error) {
            console.error("Error refreshing Shop token:", error);
            toast({
                variant: "destructive",
                title: T.refreshFailed[lang],
                description: error instanceof Error ? localizeError(error.message, lang) : T.refreshFailedDesc[lang],
            });
        } finally {
            setRefreshingId(null);
        }
    };

    // Remove account from Star Gaze
    const handleRemoveAccount = async (accountId: string) => {
        try {
            const response = await fetch(`/api/shop-publish/accounts/${accountId}`, {
                method: "DELETE",
            });

            if (!response.ok) throw new Error("Failed to remove account");

            toast({
                title: T.removed[lang],
                description: getAccountRemovedDesc(lang),
            });
            setAccounts(accounts.filter(a => a.id !== accountId));
        } catch (error) {
            console.error("Error removing Shop account:", error);
            toast({
                variant: "destructive",
                title: T.removeFailed[lang],
                description: T.removeFailedDesc[lang],
            });
        }
    };

    // Copy username to clipboard
    const copyUsername = (username: string) => {
        navigator.clipboard.writeText(username);
        toast({
            title: T.copied[lang],
            description: T.copiedDesc[lang],
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
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-1.5 h-14 rounded-full bg-gradient-to-b from-[#CCFF00] via-[#00F2EA] to-[#EC4899]" />
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                            <Store className="h-6 w-6" />
                            {T.title[lang]}
                        </h1>
                        <p className="text-white/50 text-sm mt-0.5">
                            {T.subtitle[lang]}
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
                    <span className="relative z-10">{T.connectBtn[lang]}</span>
                </button>
            </div>

            {/* Sort Controls */}
            {!loading && accounts.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-muted-foreground">
                        {lang === 'en' ? `${accounts.length} ${T.accountsSummary[lang]}` : `${T.accountsSummary[lang].replace('个', accounts.length + ' 个')}`}
                    </span>
                    <div className="flex-1" />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                                <ArrowUpDown className="h-4 w-4" />
                                {T.sortLabel[lang]} {SORT_OPTIONS.find(o => o.value === sortBy)?.label}
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

            {/* Empty State */}
            {!loading && accounts.length === 0 && (
                <div className="bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm">
                    <div className="flex flex-col items-center justify-center py-16">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#CCFF00]/20 via-[#00F2EA]/20 to-[#EC4899]/20 flex items-center justify-center mb-6 border border-white/10">
                            <Store className="h-10 w-10 text-[#00F2EA]" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">{T.noAccounts[lang]}</h3>
                        <p className="text-white/50 text-center max-w-md text-sm">
                            {T.noAccountsDesc[lang]}
                        </p>
                        <button
                            onClick={handleConnect}
                            disabled={connecting}
                            className="mt-6 group relative flex items-center gap-2 px-5 py-2.5 rounded-lg overflow-hidden bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black font-bold text-sm transition-all duration-500 hover:scale-[1.02] disabled:opacity-50"
                        >
                            <div className="absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent pointer-events-none" />
                            <Plus className="h-4 w-4 relative z-10" />
                            <span className="relative z-10">{T.connectBtn[lang]}</span>
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
                                                {T.creator[lang]}
                                            </Badge>
                                            <Badge variant={account.status === "active" ? "default" : "destructive"}>
                                                {account.status === "active" ? T.authorized[lang] : T.reauthRequired[lang]}
                                            </Badge>
                                        </CardTitle>
                                        <CardDescription className="flex items-center gap-4 mt-1">
                                            <span>{T.followers[lang]}: {account.follower_count}</span>
                                            <span>{T.videos[lang]}: {account.video_count}</span>
                                        </CardDescription>
                                        {account.username && (
                                            <div className="flex items-center gap-1.5 mt-2">
                                                <span className="text-xs text-muted-foreground">{T.usernameLabel[lang]}</span>
                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-cyan-500">
                                                    @{account.username}
                                                </code>
                                                <button
                                                    onClick={() => copyUsername(account.username!)}
                                                    className="p-1 hover:bg-muted rounded transition-colors"
                                                    title={T.copyUsername[lang]}
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
                                        <span className="ml-2 hidden sm:inline">{T.refreshBtn[lang]}</span>
                                    </Button>

                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                                                <Trash2 className="h-4 w-4" />
                                                <span className="ml-2 hidden sm:inline">{T.removeBtn[lang]}</span>
                                            </Button>
                                        </AlertDialogTrigger>
                                    <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>{T.removeDialogTitle[lang]}</AlertDialogTitle>
                                                <AlertDialogDescription className="space-y-2">
                                                    {(() => { const desc = getRemoveDialogDesc(lang); return (<><p>{desc.main}</p><p className="text-xs text-muted-foreground">{desc.note}</p></>); })()}
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>{T.removeDialogCancel[lang]}</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => handleRemoveAccount(account.id)}
                                                    className="bg-destructive hover:bg-destructive/90"
                                                >
                                                    {T.removeDialogConfirm[lang]}
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
                                    <span>{T.accessToken[lang]}:</span>
                                    {isTokenExpiringSoon(account.token_expires_at) ? (
                                        <Badge variant="destructive" className="flex items-center gap-1">
                                            <AlertTriangle className="h-3 w-3" />
                                            {formatDistanceToNow(new Date(account.token_expires_at), {
                                                addSuffix: true,
                                                locale: dateLocale,
                                            })}
                                        </Badge>
                                    ) : (
                                        <span>
                                            {formatDistanceToNow(new Date(account.token_expires_at), {
                                                addSuffix: true,
                                                locale: dateLocale,
                                            })}
                                        </span>
                                    )}
                                </div>

                                {/* Refresh Token Expiry — Shop-specific */}
                                {account.refresh_token_expires_at && (
                                    <div className="flex items-center gap-1">
                                        <span>{T.refreshToken[lang]}:</span>
                                        {isRefreshTokenExpired(account.refresh_token_expires_at) ? (
                                            <Badge variant="destructive" className="flex items-center gap-1">
                                                <ShieldAlert className="h-3 w-3" />
                                                {T.expiredReauth[lang]}
                                            </Badge>
                                        ) : (
                                            <span>
                                            {formatDistanceToNow(new Date(account.refresh_token_expires_at), {
                                                    addSuffix: true,
                                                    locale: dateLocale,
                                                })}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Binding time */}
                                <div className="flex items-center gap-1">
                                    <span>{T.connectedAt[lang]}</span>
                                    <span>
                                        {format(new Date(account.created_at), 'yyyy-MM-dd HH:mm')}
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
                            <p className="font-medium text-foreground">{T.infoCardTitle[lang]}</p>
                            <p className="text-muted-foreground mt-1">
                                {getInfoCardDesc(lang)}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
