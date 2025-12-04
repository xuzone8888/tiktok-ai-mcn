"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Users, 
  UserCircle, 
  Zap, 
  TrendingUp, 
  Video, 
  Image as ImageIcon,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

interface AdminStats {
  users: {
    total: number;
    active: number;
    newThisMonth: number;
    newLastMonth: number;
  };
  models: {
    total: number;
    active: number;
    featured: number;
  };
  credits: {
    totalIssued: number;
    usedThisMonth: number;
    usedLastMonth: number;
    usedToday: number;
  };
  generations: {
    totalVideos: number;
    totalImages: number;
    videosToday: number;
    imagestoday: number;
    videosThisMonth: number;
    imagesThisMonth: number;
    successRate: number;
  };
  recentActivity: {
    action: string;
    user: string;
    detail: string;
    time: string;
  }[];
  topModels: {
    name: string;
    contracts: number;
    credits: number;
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
    return { value: `+${change.toFixed(0)}%`, trend: "up" };
  } else if (change < 0) {
    return { value: `${change.toFixed(0)}%`, trend: "down" };
  }
  return { value: "0%", trend: "neutral" };
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/stats");
      const result = await response.json();
      if (result.success) {
        setStats(result.data);
      }
    } catch (error) {
      console.error("[Admin Dashboard] Error:", error);
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
        <Loader2 className="h-8 w-8 animate-spin text-tiktok-cyan" />
      </div>
    );
  }

  const userChange = calculateChange(stats?.users.newThisMonth || 0, stats?.users.newLastMonth || 0);
  const creditsChange = calculateChange(stats?.credits.usedThisMonth || 0, stats?.credits.usedLastMonth || 0);

  const statCards = [
    {
      title: "总用户数",
      value: formatNumber(stats?.users.total || 0),
      change: userChange.value,
      trend: userChange.trend,
      subtext: `本月新增 ${stats?.users.newThisMonth || 0}`,
      icon: Users,
      color: "from-blue-500 to-cyan-500",
    },
    {
      title: "AI 模特",
      value: stats?.models.total?.toString() || "0",
      change: `${stats?.models.active || 0} 个可用`,
      trend: "neutral" as const,
      subtext: `${stats?.models.featured || 0} 个精选`,
      icon: UserCircle,
      color: "from-purple-500 to-pink-500",
    },
    {
      title: "今日积分消耗",
      value: formatNumber(stats?.credits.usedToday || 0),
      change: creditsChange.value,
      trend: creditsChange.trend,
      subtext: `本月 ${formatNumber(stats?.credits.usedThisMonth || 0)}`,
      icon: Zap,
      color: "from-amber-500 to-orange-500",
    },
    {
      title: "今日生成",
      value: ((stats?.generations.videosToday || 0) + (stats?.generations.imagestoday || 0)).toString(),
      change: `成功率 ${stats?.generations.successRate || 0}%`,
      trend: (stats?.generations.successRate || 0) >= 80 ? "up" : "down" as "up" | "down",
      subtext: `视频 ${stats?.generations.videosToday || 0} / 图片 ${stats?.generations.imagestoday || 0}`,
      icon: TrendingUp,
      color: "from-green-500 to-emerald-500",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">管理控制面板</h1>
          <p className="text-muted-foreground">MCN 平台运营概览 - 实时数据</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStats} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          刷新数据
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const TrendIcon = stat.trend === "up" ? ArrowUpRight : stat.trend === "down" ? ArrowDownRight : null;
          
          return (
            <Card key={stat.title} className="border-border/50 bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.title}</p>
                    <p className="text-3xl font-bold mt-1">{stat.value}</p>
                    <div className="flex items-center gap-1 mt-1">
                      {TrendIcon && (
                        <TrendIcon className={`h-3 w-3 ${
                          stat.trend === "up" ? "text-emerald-400" : "text-red-400"
                        }`} />
                      )}
                      <p className={`text-sm ${
                        stat.trend === "up" ? "text-emerald-400" : 
                        stat.trend === "down" ? "text-red-400" : 
                        "text-muted-foreground"
                      }`}>
                        {stat.change}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{stat.subtext}</p>
                  </div>
                  <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                    <stat.icon className="h-6 w-6 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 生成统计详情 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Video className="h-5 w-5 text-tiktok-pink" />
              视频生成统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-tiktok-cyan">
                  {stats?.generations.totalVideos || 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">总生成数</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-amber-400">
                  {stats?.generations.videosToday || 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">今日</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-emerald-400">
                  {stats?.generations.videosThisMonth || 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">本月</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-tiktok-cyan" />
              图片生成统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-tiktok-pink">
                  {stats?.generations.totalImages || 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">总生成数</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-amber-400">
                  {stats?.generations.imagestoday || 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">今日</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-white/5">
                <div className="text-2xl font-bold text-emerald-400">
                  {stats?.generations.imagesThisMonth || 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">本月</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg">最近活动</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats?.recentActivity && stats.recentActivity.length > 0 ? (
                stats.recentActivity.map((activity, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        activity.detail === "成功" ? "bg-emerald-500/20" :
                        activity.detail === "失败" ? "bg-red-500/20" :
                        "bg-amber-500/20"
                      }`}>
                        {activity.detail === "成功" ? (
                          <CheckCircle className="h-4 w-4 text-emerald-400" />
                        ) : activity.detail === "失败" ? (
                          <XCircle className="h-4 w-4 text-red-400" />
                        ) : (
                          <Clock className="h-4 w-4 text-amber-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{activity.action}</p>
                        <p className="text-xs text-muted-foreground">{activity.user}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm ${
                        activity.detail === "成功" ? "text-emerald-400" :
                        activity.detail === "失败" ? "text-red-400" :
                        "text-amber-400"
                      }`}>
                        {activity.detail}
                      </p>
                      <p className="text-xs text-muted-foreground">{activity.time}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>暂无活动记录</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg">热门模特排行</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats?.topModels && stats.topModels.length > 0 ? (
                stats.topModels.map((model, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-tiktok-cyan to-tiktok-pink flex items-center justify-center text-black font-bold">
                        {i + 1}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{model.name}</p>
                        <p className="text-xs text-muted-foreground">{model.contracts} 次签约</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-amber-400">
                        {formatNumber(model.credits)} 积分
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <UserCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>暂无签约模特</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
