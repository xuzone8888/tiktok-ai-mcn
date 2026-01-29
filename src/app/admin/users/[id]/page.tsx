"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    ArrowLeft,
    User,
    Mail,
    Calendar,
    Zap,
    Video,
    Image as ImageIcon,
    Share2,
    CreditCard,
    Users,
    Shield,
    Loader2,
    CheckCircle,
    XCircle,
    Clock,
    ExternalLink,
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    FileText,
} from "lucide-react";
import { getRoleDisplayName, type UserRole } from "@/lib/admin";

// ============================================================================
// 类型定义
// ============================================================================

interface UserDetail {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    role: UserRole;
    credits: number;
    status: string;
    created_at: string;
}

interface UserStats {
    generations: {
        total: number;
        video: number;
        image: number;
        completed: number;
        failed: number;
    };
    tiktokAccounts: number;
    publishTasks: number;
    credits: {
        totalSpent: number;
        totalEarned: number;
        transactionCount: number;
    };
    contracts: number;
}

interface Generation {
    id: string;
    type: string;
    source: string;
    prompt: string;
    model: string;
    status: string;
    result_url: string;
    source_image_url: string;
    credit_cost: number;
    created_at: string;
    completed_at: string;
}

interface TiktokAccount {
    id: string;
    display_name: string;
    avatar_url: string;
    follower_count: number;
    following_count: number;
    likes_count: number;
    video_count: number;
    status: string;
    tokenExpired: boolean;
    created_at: string;
}

interface PublishTask {
    id: string;
    task_name: string;
    status: string;
    total_items: number;
    success_count: number;
    failed_count: number;
    created_at: string;
    items: Array<{
        id: string;
        title: string;
        status: string;
        error_message: string;
        published_at: string;
    }>;
}

interface CreditTransaction {
    id: string;
    type: string;
    amount: number;
    balance_after: number;
    description: string;
    created_at: string;
}

// ============================================================================
// Tabs
// ============================================================================

type TabKey = "overview" | "generations" | "tiktok" | "publish" | "credits";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "overview", label: "概览", icon: User },
    { key: "generations", label: "生成任务", icon: Video },
    { key: "tiktok", label: "TikTok账号", icon: Share2 },
    { key: "publish", label: "发布任务", icon: FileText },
    { key: "credits", label: "积分流水", icon: CreditCard },
];

// ============================================================================
// User Detail Page
// ============================================================================

export default function AdminUserDetailPage() {
    const params = useParams();
    const router = useRouter();
    const userId = params.id as string;

    const [activeTab, setActiveTab] = useState<TabKey>("overview");
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState<UserDetail | null>(null);
    const [stats, setStats] = useState<UserStats | null>(null);

    // Tab-specific data
    const [generations, setGenerations] = useState<Generation[]>([]);
    const [generationsLoading, setGenerationsLoading] = useState(false);
    const [tiktokAccounts, setTiktokAccounts] = useState<TiktokAccount[]>([]);
    const [tiktokLoading, setTiktokLoading] = useState(false);
    const [publishTasks, setPublishTasks] = useState<PublishTask[]>([]);
    const [publishLoading, setPublishLoading] = useState(false);
    const [creditTx, setCreditTx] = useState<CreditTransaction[]>([]);
    const [creditsLoading, setCreditsLoading] = useState(false);

    // Fetch user data
    const fetchUserData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/admin/users/${userId}`);
            if (!res.ok) throw new Error("Failed to fetch user");
            const data = await res.json();
            setUser(data.user);
            setStats(data.stats);
        } catch (error) {
            console.error("Failed to fetch user:", error);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    // Fetch generations
    const fetchGenerations = useCallback(async () => {
        try {
            setGenerationsLoading(true);
            const res = await fetch(`/api/admin/users/${userId}/generations?limit=50`);
            if (!res.ok) throw new Error("Failed to fetch generations");
            const data = await res.json();
            setGenerations(data.generations);
        } catch (error) {
            console.error("Failed to fetch generations:", error);
        } finally {
            setGenerationsLoading(false);
        }
    }, [userId]);

    // Fetch TikTok accounts
    const fetchTiktokAccounts = useCallback(async () => {
        try {
            setTiktokLoading(true);
            const res = await fetch(`/api/admin/users/${userId}/tiktok-accounts`);
            if (!res.ok) throw new Error("Failed to fetch TikTok accounts");
            const data = await res.json();
            setTiktokAccounts(data.accounts);
        } catch (error) {
            console.error("Failed to fetch TikTok accounts:", error);
        } finally {
            setTiktokLoading(false);
        }
    }, [userId]);

    // Fetch publish tasks
    const fetchPublishTasks = useCallback(async () => {
        try {
            setPublishLoading(true);
            const res = await fetch(`/api/admin/users/${userId}/publish-tasks?limit=50`);
            if (!res.ok) throw new Error("Failed to fetch publish tasks");
            const data = await res.json();
            setPublishTasks(data.tasks);
        } catch (error) {
            console.error("Failed to fetch publish tasks:", error);
        } finally {
            setPublishLoading(false);
        }
    }, [userId]);

    // Fetch credit transactions
    const fetchCredits = useCallback(async () => {
        try {
            setCreditsLoading(true);
            const res = await fetch(`/api/admin/users/${userId}/credits?limit=100`);
            if (!res.ok) throw new Error("Failed to fetch credits");
            const data = await res.json();
            setCreditTx(data.transactions);
        } catch (error) {
            console.error("Failed to fetch credits:", error);
        } finally {
            setCreditsLoading(false);
        }
    }, [userId]);

    // Initial load
    useEffect(() => {
        fetchUserData();
    }, [fetchUserData]);

    // Load tab data on tab change
    useEffect(() => {
        if (activeTab === "generations" && generations.length === 0) {
            fetchGenerations();
        } else if (activeTab === "tiktok" && tiktokAccounts.length === 0) {
            fetchTiktokAccounts();
        } else if (activeTab === "publish" && publishTasks.length === 0) {
            fetchPublishTasks();
        } else if (activeTab === "credits" && creditTx.length === 0) {
            fetchCredits();
        }
    }, [activeTab, generations.length, tiktokAccounts.length, publishTasks.length, creditTx.length, fetchGenerations, fetchTiktokAccounts, fetchPublishTasks, fetchCredits]);

    // Helpers
    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const formatNumber = (num: number) => {
        return num.toLocaleString("zh-CN");
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case "completed":
            case "published":
            case "active":
                return <CheckCircle className="h-4 w-4 text-green-400" />;
            case "failed":
            case "expired":
            case "revoked":
                return <XCircle className="h-4 w-4 text-red-400" />;
            case "pending":
            case "processing":
            case "uploading":
                return <Clock className="h-4 w-4 text-amber-400" />;
            default:
                return <Clock className="h-4 w-4 text-white/40" />;
        }
    };

    if (loading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-red-400" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                <AlertTriangle className="h-12 w-12 text-amber-400" />
                <p className="text-white/50">用户不存在</p>
                <Button onClick={() => router.back()} variant="outline">
                    返回
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Back Button & Title */}
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => router.back()}
                    className="h-10 w-10 rounded-xl border border-white/10 hover:bg-white/5"
                >
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold text-white">用户详情</h1>
                    <p className="text-sm text-white/50">查看用户活动和数据</p>
                </div>
            </div>

            {/* User Profile Card */}
            <div className="rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                    {/* Avatar */}
                    <div className={cn(
                        "relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl",
                        user.role === "super_admin" || user.role === "admin"
                            ? "ring-2 ring-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                            : "ring-1 ring-white/20"
                    )}>
                        {user.avatar_url ? (
                            <img src={user.avatar_url} alt={user.name || ""} className="h-full w-full object-cover" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-red-500 to-orange-500">
                                <User className="h-8 w-8 text-white" />
                            </div>
                        )}
                        {(user.role === "super_admin" || user.role === "admin") && (
                            <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-black bg-red-500">
                                <Shield className="h-3 w-3 text-white" />
                            </div>
                        )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-bold text-white">{user.name || "未命名"}</h2>
                            <span className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-bold",
                                user.role === "super_admin"
                                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                    : user.role === "admin"
                                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                        : "bg-white/10 text-white/60 border border-white/10"
                            )}>
                                {getRoleDisplayName(user.role)}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-white/50">
                            <Mail className="h-4 w-4" />
                            <span>{user.email}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-white/50">
                            <Calendar className="h-4 w-4" />
                            <span>注册于 {formatDate(user.created_at)}</span>
                        </div>
                    </div>

                    {/* Credits */}
                    <div className="shrink-0 rounded-2xl border border-white/10 bg-black/40 p-4 text-center">
                        <div className="text-xs font-medium uppercase tracking-wider text-white/40">当前积分</div>
                        <div className="mt-1 flex items-center justify-center gap-2">
                            <Zap className="h-5 w-5 fill-[#CCFF00]/20 text-[#CCFF00]" />
                            <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] to-[#00F2EA]">
                                {formatNumber(user.credits)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            {stats && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <StatCard
                        icon={Video}
                        label="生成任务"
                        value={stats.generations.total}
                        subValue={`${stats.generations.video} 视频 / ${stats.generations.image} 图片`}
                        color="cyan"
                    />
                    <StatCard
                        icon={Share2}
                        label="TikTok账号"
                        value={stats.tiktokAccounts}
                        subValue="已绑定"
                        color="pink"
                    />
                    <StatCard
                        icon={FileText}
                        label="发布任务"
                        value={stats.publishTasks}
                        subValue="任务总数"
                        color="amber"
                    />
                    <StatCard
                        icon={CreditCard}
                        label="积分消耗"
                        value={stats.credits.totalSpent}
                        subValue={`${stats.credits.transactionCount} 笔交易`}
                        color="red"
                    />
                    <StatCard
                        icon={Users}
                        label="模特合约"
                        value={stats.contracts}
                        subValue="签约总数"
                        color="purple"
                    />
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 border-b border-white/10 pb-2">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                            activeTab === tab.key
                                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                : "text-white/50 hover:text-white hover:bg-white/5"
                        )}
                    >
                        <tab.icon className="h-4 w-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="min-h-[400px]">
                {activeTab === "overview" && <OverviewTab user={user} stats={stats} />}
                {activeTab === "generations" && <GenerationsTab generations={generations} loading={generationsLoading} formatDate={formatDate} getStatusIcon={getStatusIcon} />}
                {activeTab === "tiktok" && <TiktokTab accounts={tiktokAccounts} loading={tiktokLoading} formatDate={formatDate} formatNumber={formatNumber} />}
                {activeTab === "publish" && <PublishTab tasks={publishTasks} loading={publishLoading} formatDate={formatDate} getStatusIcon={getStatusIcon} />}
                {activeTab === "credits" && <CreditsTab transactions={creditTx} loading={creditsLoading} formatDate={formatDate} formatNumber={formatNumber} />}
            </div>
        </div>
    );
}

// ============================================================================
// Sub Components
// ============================================================================

function StatCard({
    icon: Icon,
    label,
    value,
    subValue,
    color,
}: {
    icon: React.ElementType;
    label: string;
    value: number;
    subValue: string;
    color: "cyan" | "pink" | "amber" | "red" | "purple";
}) {
    const colorClasses = {
        cyan: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30 text-cyan-400",
        pink: "from-pink-500/20 to-pink-500/5 border-pink-500/30 text-pink-400",
        amber: "from-amber-500/20 to-amber-500/5 border-amber-500/30 text-amber-400",
        red: "from-red-500/20 to-red-500/5 border-red-500/30 text-red-400",
        purple: "from-purple-500/20 to-purple-500/5 border-purple-500/30 text-purple-400",
    };

    return (
        <div className={cn(
            "rounded-xl border bg-gradient-to-br p-4",
            colorClasses[color]
        )}>
            <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4" />
                <span className="text-xs font-medium text-white/60">{label}</span>
            </div>
            <div className="text-2xl font-bold text-white">{value.toLocaleString()}</div>
            <div className="text-xs text-white/40 mt-1">{subValue}</div>
        </div>
    );
}

function OverviewTab({ user, stats }: { user: UserDetail; stats: UserStats | null }) {
    return (
        <div className="rounded-xl border border-white/10 bg-black/20 p-6">
            <h3 className="text-lg font-bold text-white mb-4">用户概览</h3>
            <p className="text-white/50">
                该用户自注册以来共生成了 {stats?.generations.total || 0} 个任务，
                绑定了 {stats?.tiktokAccounts || 0} 个 TikTok 账号，
                创建了 {stats?.publishTasks || 0} 个发布任务。
                累计消耗积分 {stats?.credits.totalSpent.toLocaleString() || 0}。
            </p>
        </div>
    );
}

function GenerationsTab({
    generations,
    loading,
    formatDate,
    getStatusIcon,
}: {
    generations: Generation[];
    loading: boolean;
    formatDate: (d: string) => string;
    getStatusIcon: (s: string) => React.ReactNode;
}) {
    if (loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-red-400" />
            </div>
        );
    }

    if (generations.length === 0) {
        return (
            <div className="flex h-40 flex-col items-center justify-center text-white/40">
                <Video className="h-8 w-8 mb-2" />
                <p>暂无生成任务</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {generations.map((gen) => (
                <div key={gen.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-start gap-4">
                        {/* Thumbnail */}
                        <div className="h-16 w-16 shrink-0 rounded-lg bg-white/5 overflow-hidden">
                            {gen.result_url ? (
                                <img src={gen.result_url} alt="" className="h-full w-full object-cover" />
                            ) : gen.source_image_url ? (
                                <img src={gen.source_image_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                    {gen.type === "video" ? <Video className="h-6 w-6 text-white/20" /> : <ImageIcon className="h-6 w-6 text-white/20" />}
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                {getStatusIcon(gen.status)}
                                <span className={cn(
                                    "text-xs font-medium px-2 py-0.5 rounded",
                                    gen.type === "video" ? "bg-cyan-500/20 text-cyan-400" : "bg-pink-500/20 text-pink-400"
                                )}>
                                    {gen.type === "video" ? "视频" : "图片"}
                                </span>
                                <span className="text-xs text-white/40">{gen.source}</span>
                            </div>
                            <p className="text-sm text-white/80 line-clamp-2">{gen.prompt || "无提示词"}</p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-white/40">
                                <span>模型: {gen.model || "未知"}</span>
                                <span>消耗: {gen.credit_cost} 积分</span>
                                <span>{formatDate(gen.created_at)}</span>
                            </div>
                        </div>

                        {/* Result Link */}
                        {gen.result_url && (
                            <a
                                href={gen.result_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-cyan-400 hover:text-cyan-300"
                            >
                                <ExternalLink className="h-4 w-4" />
                            </a>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function TiktokTab({
    accounts,
    loading,
    formatDate,
    formatNumber,
}: {
    accounts: TiktokAccount[];
    loading: boolean;
    formatDate: (d: string) => string;
    formatNumber: (n: number) => string;
}) {
    if (loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-red-400" />
            </div>
        );
    }

    if (accounts.length === 0) {
        return (
            <div className="flex h-40 flex-col items-center justify-center text-white/40">
                <Share2 className="h-8 w-8 mb-2" />
                <p>暂无绑定的 TikTok 账号</p>
            </div>
        );
    }

    return (
        <div className="grid gap-4 sm:grid-cols-2">
            {accounts.map((account) => (
                <div key={account.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-12 w-12 rounded-full overflow-hidden bg-white/5">
                            {account.avatar_url ? (
                                <img src={account.avatar_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                    <User className="h-5 w-5 text-white/20" />
                                </div>
                            )}
                        </div>
                        <div>
                            <div className="font-bold text-white">{account.display_name || "未知账号"}</div>
                            <div className="flex items-center gap-2 text-xs">
                                {account.tokenExpired ? (
                                    <span className="text-red-400 flex items-center gap-1">
                                        <XCircle className="h-3 w-3" /> Token 已过期
                                    </span>
                                ) : (
                                    <span className="text-green-400 flex items-center gap-1">
                                        <CheckCircle className="h-3 w-3" /> 正常
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                        <div>
                            <div className="text-sm font-bold text-white">{formatNumber(account.follower_count)}</div>
                            <div className="text-xs text-white/40">粉丝</div>
                        </div>
                        <div>
                            <div className="text-sm font-bold text-white">{formatNumber(account.following_count)}</div>
                            <div className="text-xs text-white/40">关注</div>
                        </div>
                        <div>
                            <div className="text-sm font-bold text-white">{formatNumber(account.likes_count)}</div>
                            <div className="text-xs text-white/40">点赞</div>
                        </div>
                        <div>
                            <div className="text-sm font-bold text-white">{formatNumber(account.video_count)}</div>
                            <div className="text-xs text-white/40">视频</div>
                        </div>
                    </div>
                    <div className="mt-3 text-xs text-white/40">绑定于 {formatDate(account.created_at)}</div>
                </div>
            ))}
        </div>
    );
}

function PublishTab({
    tasks,
    loading,
    formatDate,
    getStatusIcon,
}: {
    tasks: PublishTask[];
    loading: boolean;
    formatDate: (d: string) => string;
    getStatusIcon: (s: string) => React.ReactNode;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);

    if (loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-red-400" />
            </div>
        );
    }

    if (tasks.length === 0) {
        return (
            <div className="flex h-40 flex-col items-center justify-center text-white/40">
                <FileText className="h-8 w-8 mb-2" />
                <p>暂无发布任务</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {tasks.map((task) => (
                <div key={task.id} className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                    <button
                        onClick={() => setExpanded(expanded === task.id ? null : task.id)}
                        className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            {getStatusIcon(task.status)}
                            <div className="text-left">
                                <div className="font-medium text-white">{task.task_name || "未命名任务"}</div>
                                <div className="text-xs text-white/40">{formatDate(task.created_at)}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="text-right text-sm">
                                <span className="text-green-400">{task.success_count}</span>
                                <span className="text-white/30"> / </span>
                                <span className="text-red-400">{task.failed_count}</span>
                                <span className="text-white/30"> / </span>
                                <span className="text-white/60">{task.total_items}</span>
                            </div>
                            {expanded === task.id ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
                        </div>
                    </button>
                    {expanded === task.id && task.items.length > 0 && (
                        <div className="border-t border-white/10 p-4 space-y-2">
                            {task.items.map((item) => (
                                <div key={item.id} className="flex items-center gap-3 text-sm">
                                    {getStatusIcon(item.status)}
                                    <span className="flex-1 text-white/60 truncate">{item.title}</span>
                                    {item.error_message && (
                                        <span className="text-xs text-red-400 truncate max-w-[200px]">{item.error_message}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

function CreditsTab({
    transactions,
    loading,
    formatDate,
    formatNumber,
}: {
    transactions: CreditTransaction[];
    loading: boolean;
    formatDate: (d: string) => string;
    formatNumber: (n: number) => string;
}) {
    if (loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-red-400" />
            </div>
        );
    }

    if (transactions.length === 0) {
        return (
            <div className="flex h-40 flex-col items-center justify-center text-white/40">
                <CreditCard className="h-8 w-8 mb-2" />
                <p>暂无积分交易记录</p>
            </div>
        );
    }

    const getTypeLabel = (type: string) => {
        switch (type) {
            case "purchase": return { label: "充值", color: "text-green-400 bg-green-500/20" };
            case "consume": return { label: "消费", color: "text-red-400 bg-red-500/20" };
            case "refund": return { label: "退款", color: "text-amber-400 bg-amber-500/20" };
            case "bonus": return { label: "赠送", color: "text-cyan-400 bg-cyan-500/20" };
            default: return { label: type, color: "text-white/40 bg-white/10" };
        }
    };

    return (
        <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-white/5">
                    <tr className="text-left text-white/40">
                        <th className="px-4 py-3 font-medium">时间</th>
                        <th className="px-4 py-3 font-medium">类型</th>
                        <th className="px-4 py-3 font-medium">描述</th>
                        <th className="px-4 py-3 font-medium text-right">变动</th>
                        <th className="px-4 py-3 font-medium text-right">余额</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {transactions.map((tx) => {
                        const typeInfo = getTypeLabel(tx.type);
                        return (
                            <tr key={tx.id} className="hover:bg-white/5">
                                <td className="px-4 py-3 text-white/60">{formatDate(tx.created_at)}</td>
                                <td className="px-4 py-3">
                                    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", typeInfo.color)}>
                                        {typeInfo.label}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-white/60 truncate max-w-[200px]">{tx.description || "-"}</td>
                                <td className={cn("px-4 py-3 text-right font-medium", tx.amount > 0 ? "text-green-400" : "text-red-400")}>
                                    {tx.amount > 0 ? "+" : ""}{formatNumber(tx.amount)}
                                </td>
                                <td className="px-4 py-3 text-right text-white/60">{formatNumber(tx.balance_after)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
