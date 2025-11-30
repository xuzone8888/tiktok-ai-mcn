import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  TrendingUp, 
  Users, 
  Video, 
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Play,
  Eye,
  Heart,
  MessageCircle
} from "lucide-react";

const stats = [
  {
    title: "总收益",
    value: "¥128,459",
    change: "+12.5%",
    trend: "up",
    icon: DollarSign,
  },
  {
    title: "签约模特",
    value: "24",
    change: "+3",
    trend: "up",
    icon: Users,
  },
  {
    title: "发布视频",
    value: "1,847",
    change: "+156",
    trend: "up",
    icon: Video,
  },
  {
    title: "总播放量",
    value: "2.4M",
    change: "+18.2%",
    trend: "up",
    icon: Eye,
  },
];

const recentVideos = [
  {
    title: "夏日穿搭分享 | 清凉一夏",
    model: "Luna AI",
    views: "125.6K",
    likes: "8.2K",
    comments: "324",
    status: "published",
  },
  {
    title: "美妆教程 | 日常妆容",
    model: "Mia Digital",
    views: "98.4K",
    likes: "6.1K",
    comments: "189",
    status: "published",
  },
  {
    title: "健身打卡 Day 30",
    model: "Alex Virtual",
    views: "76.2K",
    likes: "4.8K",
    comments: "156",
    status: "processing",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="gradient-tiktok-text">Dashboard</span>
        </h1>
        <p className="mt-2 text-muted-foreground">
          欢迎回来！这是您的 MCN 数据概览
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const TrendIcon = stat.trend === "up" ? ArrowUpRight : ArrowDownRight;
          
          return (
            <Card 
              key={stat.title}
              className="group relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:border-tiktok-cyan/30 hover:shadow-lg hover:shadow-tiktok-cyan/5"
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-tiktok-cyan/10 to-tiktok-pink/10">
                  <Icon className="h-4 w-4 text-tiktok-cyan" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="mt-1 flex items-center text-xs">
                  <TrendIcon 
                    className={`mr-1 h-3 w-3 ${
                      stat.trend === "up" ? "text-emerald-500" : "text-red-500"
                    }`} 
                  />
                  <span className={stat.trend === "up" ? "text-emerald-500" : "text-red-500"}>
                    {stat.change}
                  </span>
                  <span className="ml-1 text-muted-foreground">vs 上月</span>
                </div>
              </CardContent>
              {/* Hover gradient effect */}
              <div className="absolute inset-0 -z-10 bg-gradient-to-br from-tiktok-cyan/5 to-tiktok-pink/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            </Card>
          );
        })}
      </div>

      {/* Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Videos */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-tiktok-cyan" />
              最近发布
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentVideos.map((video, index) => (
              <div 
                key={index}
                className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-white/5"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20">
                  <Video className="h-5 w-5 text-tiktok-cyan" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="font-medium leading-none">{video.title}</p>
                  <p className="text-sm text-muted-foreground">{video.model}</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {video.views}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="h-3 w-3" />
                    {video.likes}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageCircle className="h-3 w-3" />
                    {video.comments}
                  </span>
                </div>
              </div>
            ))}
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
              { title: "创建新视频", desc: "使用 AI 模特生成内容", color: "cyan" },
              { title: "浏览模特市场", desc: "发现更多 AI 数字人", color: "pink" },
              { title: "管理素材库", desc: "上传和整理您的素材", color: "cyan" },
              { title: "查看数据报告", desc: "深入分析您的表现", color: "pink" },
            ].map((action, index) => (
              <button
                key={index}
                className="group flex items-center gap-4 rounded-xl border border-border/50 p-4 text-left transition-all duration-200 hover:border-tiktok-cyan/30 hover:bg-white/5"
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
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}



