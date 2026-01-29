"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  TrendingUp,
  Users,
  Video,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Play,
  Image as ImageIcon,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface UserStats {
  credits: {
    current: number;
    totalUsed: number;
    thisMonth: number;
    lastMonth: number;
  };
  models: {
    total: number;
    active: number;
    expiringSoon: number;
  };
  videos: {
    total: number;
    thisMonth: number;
    lastMonth: number;
    completed: number;
    failed: number;
  };
  images: {
    total: number;
    thisMonth: number;
    lastMonth: number;
    completed: number;
    failed: number;
  };
  recentActivity: {
    type: "video" | "image";
    title: string;
    model: string;
    status: string;
    createdAt: string;
  }[];
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toLocaleString();
}

function calculateChange(current: number, previous: number): { value: string; trend: "up" | "down" | "neutral" } {
  if (previous === 0) {
    return { value: current > 0 ? "+100%" : "0%", trend: current > 0 ? "up" : "neutral" };
  }
  const change = ((current - previous) / previous) * 100;
  if (change > 0) {
    return { value: `+${change.toFixed(1)}%`, trend: "up" };
  } else if (change < 0) {
    return { value: `${change.toFixed(1)}%`, trend: "down" };
  }
  return { value: "0%", trend: "neutral" };
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export default function DashboardPage() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/user/stats");
      const result = await response.json();

      if (result.success) {
        setStats(result.data);
      } else {
        setError(result.error || "获取数据失败");
      }
    } catch (err) {
      console.error("[Dashboard] Error:", err);
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-tiktok-cyan" />
          <p className="text-muted-foreground">加载数据中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3 text-center">
          <XCircle className="h-12 w-12 text-red-400" />
          <p className="text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={fetchStats} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            重试
          </Button>
        </div>
      </div>
    );
  }

  // 计算变化率（保留供将来使用）
  const _videosChange = calculateChange(stats?.videos.thisMonth || 0, stats?.videos.lastMonth || 0);
  const _imagesChange = calculateChange(stats?.images.thisMonth || 0, stats?.images.lastMonth || 0);
  void _videosChange; void _imagesChange; // suppress unused warnings

  const statCards = [
    {
      title: "当前积分",
      value: formatNumber(stats?.credits.current || 0),
      change: `本月消耗 ${formatNumber(stats?.credits.thisMonth || 0)}`,
      trend: "neutral" as const,
      icon: Zap,
      color: "amber",
    },
    {
      title: "签约模特",
      value: stats?.models.active?.toString() || "0",
      change: stats?.models.expiringSoon ? `${stats.models.expiringSoon} 个即将到期` : "全部正常",
      trend: stats?.models.expiringSoon ? "down" : "up" as "up" | "down",
      icon: Users,
      color: "cyan",
    },
    {
      title: "生成视频",
      value: formatNumber(stats?.videos.total || 0),
      change: `本月 ${formatNumber(stats?.videos.thisMonth || 0)} 条`,
      trend: "neutral" as const,
      icon: Video,
      color: "pink",
    },
    {
      title: "生成图片",
      value: formatNumber(stats?.images.total || 0),
      change: `本月 ${formatNumber(stats?.images.thisMonth || 0)} 张`,
      trend: "neutral" as const,
      icon: ImageIcon,
      color: "cyan",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
          <span className="text-white drop-shadow-lg">数据驾驶舱</span>
        </h1>
        <p className="mt-2 text-white/60">
          欢迎回来！这是您的运营数据概览
        </p>
      </div>
      <Button variant="mermaid-ghost" size="sm" onClick={fetchStats} className="gap-2">
        <RefreshCw className="h-4 w-4" />
        刷新数据
      </Button>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          const TrendIcon = stat.trend === "up" ? ArrowUpRight : stat.trend === "down" ? ArrowDownRight : null;

          return (
            <Card
              key={stat.title}
              variant="glass"
              className="relative overflow-hidden group hover:border-mermaid-cyan/30 transition-all duration-500"
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-white/50">
                  {stat.title}
                </CardTitle>
                <div className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-500",
                  stat.color === "cyan" && "bg-mermaid-cyan/10 text-mermaid-cyan group-hover:bg-mermaid-cyan/20",
                  stat.color === "pink" && "bg-mermaid-pink/10 text-mermaid-pink group-hover:bg-mermaid-pink/20",
                  stat.color === "amber" && "bg-amber-500/10 text-amber-500 group-hover:bg-amber-500/20"
                )}>
                  <Icon className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-mermaid-cyan transition-all duration-300">{stat.value}</div>
                <div className="mt-1 flex items-center text-xs">
                  {TrendIcon && (
                    <TrendIcon
                      className={`mr-1 h-3 w-3 ${stat.trend === "up" ? "text-neon-green" : "text-neon-red"
                        }`}
                    />
                  )}
                  <span className={
                    stat.trend === "up" ? "text-neon-green" :
                      stat.trend === "down" ? "text-neon-red" :
                        "text-white/40"
                  }>
                    {stat.change}
                  </span>
                </div>
              </CardContent>
              {/* Aurora Glow */}
              <div className={cn(
                "absolute -right-4 -top-4 h-24 w-24 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none",
                stat.color === "cyan" && "bg-mermaid-cyan/20",
                stat.color === "pink" && "bg-mermaid-pink/20",
                stat.color === "amber" && "bg-amber-500/20"
              )} />
            </Card>
          );
        })}
      </div>

      {/* 详细统计 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 视频统计 */}
        <Card variant="mermaid" className="group">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5 text-mermaid-pink" />
              视频生成统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-xl border border-transparent hover:bg-white/10 transition-all duration-300 group/item cursor-default">
                <div className="text-2xl font-bold text-white/90 group-hover/item:text-white transition-colors duration-300">{stats?.videos.total || 0}</div>
                <div className="text-xs text-white/40 mt-1">总生成数</div>
              </div>
              <div className="text-center p-4 rounded-xl border border-transparent hover:bg-white/10 transition-all duration-300 group/item cursor-default">
                <div className="text-2xl font-bold text-white/90 group-hover/item:text-neon-green group-hover/item:scale-105 transition-all duration-300">{stats?.videos.completed || 0}</div>
                <div className="text-xs text-white/40 group-hover/item:text-neon-green/70 transition-colors mt-1">成功</div>
              </div>
              <div className="text-center p-4 rounded-xl border border-transparent hover:bg-white/10 transition-all duration-300 group/item cursor-default">
                <div className="text-2xl font-bold text-white/90 group-hover/item:text-neon-red group-hover/item:scale-105 transition-all duration-300">{stats?.videos.failed || 0}</div>
                <div className="text-xs text-white/40 group-hover/item:text-neon-red/70 transition-colors mt-1">失败</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-white/5">
              <div className="flex justify-between text-sm">
                <span className="text-white/40">本月生成</span>
                <span className="font-medium text-white/80">{stats?.videos.thisMonth || 0} 条</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-white/40">上月生成</span>
                <span className="font-medium text-white/80">{stats?.videos.lastMonth || 0} 条</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 图片统计 */}
        <Card variant="mermaid" className="group">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-mermaid-cyan" />
              图片生成统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-xl border border-transparent hover:bg-white/10 transition-all duration-300 group/item cursor-default">
                <div className="text-2xl font-bold text-white/90 group-hover/item:text-white transition-colors duration-300">{stats?.images.total || 0}</div>
                <div className="text-xs text-white/40 mt-1">总生成数</div>
              </div>
              <div className="text-center p-4 rounded-xl border border-transparent hover:bg-white/10 transition-all duration-300 group/item cursor-default">
                <div className="text-2xl font-bold text-white/90 group-hover/item:text-neon-green group-hover/item:scale-105 transition-all duration-300">{stats?.images.completed || 0}</div>
                <div className="text-xs text-white/40 group-hover/item:text-neon-green/70 transition-colors mt-1">成功</div>
              </div>
              <div className="text-center p-4 rounded-xl border border-transparent hover:bg-white/10 transition-all duration-300 group/item cursor-default">
                <div className="text-2xl font-bold text-white/90 group-hover/item:text-neon-red group-hover/item:scale-105 transition-all duration-300">{stats?.images.failed || 0}</div>
                <div className="text-xs text-white/40 group-hover/item:text-neon-red/70 transition-colors mt-1">失败</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-white/5">
              <div className="flex justify-between text-sm">
                <span className="text-white/40">本月生成</span>
                <span className="font-medium text-white/80">{stats?.images.thisMonth || 0} 张</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-white/40">上月生成</span>
                <span className="font-medium text-white/80">{stats?.images.lastMonth || 0} 张</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity & Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-white/70" />
              最近活动
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats?.recentActivity && stats.recentActivity.length > 0 ? (
              stats.recentActivity.map((activity, index) => (
                <div
                  key={index}
                  className="group flex items-center gap-4 rounded-xl p-3 transition-all duration-300 border border-transparent hover:bg-white/5 hover:border-white/10 hover:translate-x-1"
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${activity.type === "video"
                    ? "bg-mermaid-pink/10 text-mermaid-pink"
                    : "bg-mermaid-cyan/10 text-mermaid-cyan"
                    }`}>
                    {activity.type === "video" ? <Video className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-white/90">{activity.title}</p>
                    <p className="text-xs text-white/40">{activity.model}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {activity.status === "completed" && (
                      <CheckCircle className="h-4 w-4 text-neon-green" />
                    )}
                    {activity.status === "failed" && (
                      <XCircle className="h-4 w-4 text-neon-red" />
                    )}
                    {(activity.status === "processing" || activity.status === "pending") && (
                      <Loader2 className="h-4 w-4 text-neon-warning animate-spin" />
                    )}
                    <span className="text-xs text-white/30">
                      {formatDate(activity.createdAt)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-white/30">
                <Play className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>暂无活动记录</p>
                <p className="text-xs mt-1">开始生成视频或图片后将在这里显示</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-white/70" />
              快速操作
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {[
              { title: "快速生成视频", desc: "即时造片台", href: "/quick-gen", color: "cyan" },
              { title: "批量生产视频", desc: "批量产线区", href: "/pro-studio/video-batch", color: "pink" },
              { title: "批量处理图片", desc: "批量产线区", href: "/pro-studio/image-batch", color: "cyan" },
              { title: "查看生产轨迹", desc: "历史生成记录", href: "/assets", color: "pink" },
            ].map((action, index) => (
              <Link key={index} href={action.href}>
                <button
                  className="w-full group flex items-center gap-4 rounded-xl border border-transparent bg-transparent p-4 text-left transition-all duration-300 hover:bg-white/5 hover:border-mermaid-cyan/30 hover:shadow-[0_0_20px_rgba(0,242,234,0.05)] hover:-translate-y-0.5"
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${action.color === "cyan"
                      ? "bg-mermaid-cyan/10 text-mermaid-cyan group-hover:bg-mermaid-cyan/20"
                      : "bg-mermaid-pink/10 text-mermaid-pink group-hover:bg-mermaid-pink/20"
                      }`}
                  >
                    <ArrowUpRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                  <div>
                    <p className="font-medium text-white group-hover:text-mermaid-cyan transition-colors">{action.title}</p>
                    <p className="text-sm text-white/40">{action.desc}</p>
                  </div>
                </button>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
