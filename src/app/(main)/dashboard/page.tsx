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
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="gradient-tiktok-text">工厂中控台</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            欢迎回来！这是您的个人数据概览
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStats} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          刷新数据
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          const TrendIcon = stat.trend === "up" ? ArrowUpRight : stat.trend === "down" ? ArrowDownRight : null;
          
          return (
            <Card 
              key={stat.title}
              className="group relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:border-tiktok-cyan/30 hover:shadow-lg hover:shadow-tiktok-cyan/5"
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-${stat.color}-500/10`}>
                  <Icon className={`h-4 w-4 text-${stat.color}-400`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="mt-1 flex items-center text-xs">
                  {TrendIcon && (
                    <TrendIcon 
                      className={`mr-1 h-3 w-3 ${
                        stat.trend === "up" ? "text-emerald-500" : "text-red-500"
                      }`} 
                    />
                  )}
                  <span className={
                    stat.trend === "up" ? "text-emerald-500" : 
                    stat.trend === "down" ? "text-red-500" : 
                    "text-muted-foreground"
                  }>
                    {stat.change}
                  </span>
                </div>
              </CardContent>
              <div className="absolute inset-0 -z-10 bg-gradient-to-br from-tiktok-cyan/5 to-tiktok-pink/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            </Card>
          );
        })}
      </div>

      {/* 详细统计 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 视频统计 */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5 text-tiktok-pink" />
              视频生成统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-tiktok-cyan">{stats?.videos.total || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">总生成数</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-emerald-400">{stats?.videos.completed || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">成功</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-red-400">{stats?.videos.failed || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">失败</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border/50">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">本月生成</span>
                <span className="font-medium">{stats?.videos.thisMonth || 0} 条</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-muted-foreground">上月生成</span>
                <span className="font-medium">{stats?.videos.lastMonth || 0} 条</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 图片统计 */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-tiktok-cyan" />
              图片生成统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-tiktok-pink">{stats?.images.total || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">总生成数</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-emerald-400">{stats?.images.completed || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">成功</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-red-400">{stats?.images.failed || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">失败</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border/50">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">本月生成</span>
                <span className="font-medium">{stats?.images.thisMonth || 0} 张</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-muted-foreground">上月生成</span>
                <span className="font-medium">{stats?.images.lastMonth || 0} 张</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity & Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-tiktok-cyan" />
              最近活动
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats?.recentActivity && stats.recentActivity.length > 0 ? (
              stats.recentActivity.map((activity, index) => (
                <div 
                  key={index}
                  className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-white/5"
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    activity.type === "video" 
                      ? "bg-tiktok-pink/20 text-tiktok-pink" 
                      : "bg-tiktok-cyan/20 text-tiktok-cyan"
                  }`}>
                    {activity.type === "video" ? <Video className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{activity.title}</p>
                    <p className="text-xs text-muted-foreground">{activity.model}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {activity.status === "completed" && (
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    )}
                    {activity.status === "failed" && (
                      <XCircle className="h-4 w-4 text-red-400" />
                    )}
                    {(activity.status === "processing" || activity.status === "pending") && (
                      <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatDate(activity.createdAt)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Play className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>暂无活动记录</p>
                <p className="text-xs mt-1">开始生成视频或图片后将在这里显示</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-tiktok-pink" />
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
                  className="w-full group flex items-center gap-4 rounded-xl border border-border/50 p-4 text-left transition-all duration-200 hover:border-tiktok-cyan/30 hover:bg-white/5"
                >
                  <div 
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      action.color === "cyan" 
                        ? "bg-tiktok-cyan/10 text-tiktok-cyan" 
                        : "bg-tiktok-pink/10 text-tiktok-pink"
                    }`}
                  >
                    <ArrowUpRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                  <div>
                    <p className="font-medium">{action.title}</p>
                    <p className="text-sm text-muted-foreground">{action.desc}</p>
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
