"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  History,
  Search,
  Grid3X3,
  List,
  Image as ImageIcon,
  Video,
  MoreVertical,
  Download,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Play,
  ExternalLink,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TaskLogItem {
  id: string;
  type: "video" | "image";
  source: "quick_gen" | "batch_video" | "batch_image";
  status: "completed" | "failed" | "processing" | "pending";
  resultUrl: string | null;
  thumbnailUrl: string | null;
  prompt: string | null;
  model: string;
  credits: number;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
}

interface TaskStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  processingTasks: number;
  totalVideos: number;
  totalImages: number;
  totalCreditsUsed: number;
}

const typeFilters = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "image", label: "图片" },
];

const statusFilters = [
  { value: "all", label: "全部状态" },
  { value: "completed", label: "已完成" },
  { value: "processing", label: "处理中" },
  { value: "failed", label: "失败" },
];

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getExpiryStatus(expiresAt: string): { text: string; isExpiringSoon: boolean; isExpired: boolean } {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diff = expiry.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (diff <= 0) {
    return { text: "已过期", isExpiringSoon: false, isExpired: true };
  }
  if (days <= 1) {
    return { text: "即将过期", isExpiringSoon: true, isExpired: false };
  }
  if (days <= 3) {
    return { text: `${days}天后过期`, isExpiringSoon: true, isExpired: false };
  }
  return { text: `${days}天后过期`, isExpiringSoon: false, isExpired: false };
}

function getSourceLabel(source: string): string {
  switch (source) {
    case "quick_gen":
      return "快速生成";
    case "batch_video":
      return "批量视频";
    case "batch_image":
      return "批量图片";
    case "link_video":
      return "链接秒变";
    default:
      return "未知来源";
  }
}

export default function TaskLogPage() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [tasks, setTasks] = useState<TaskLogItem[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewTask, setPreviewTask] = useState<TaskLogItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedType !== "all") params.set("type", selectedType);
      if (selectedStatus !== "all") params.set("status", selectedStatus);

      const response = await fetch(`/api/user/tasks?${params.toString()}`);
      const result = await response.json();

      if (result.success) {
        setTasks(result.data.tasks);
        setStats(result.data.stats);
      }
    } catch (error) {
      console.error("[TaskLog] Error:", error);
    } finally {
      setLoading(false);
    }
  };

  // 刷新处理中的任务状态
  const refreshProcessingTasks = async () => {
    try {
      setRefreshing(true);
      const response = await fetch("/api/user/tasks/refresh", { method: "POST" });
      const result = await response.json();

      if (result.success) {
        console.log("[TaskLog] Refresh result:", result.data);
        // 重新获取任务列表
        await fetchTasks();
      }
    } catch (error) {
      console.error("[TaskLog] Refresh error:", error);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [selectedType, selectedStatus]);

  // 页面加载时自动刷新处理中的任务
  useEffect(() => {
    if (stats && stats.processingTasks > 0) {
      refreshProcessingTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredTasks = tasks.filter((task) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      task.prompt?.toLowerCase().includes(query) ||
      task.model.toLowerCase().includes(query)
    );
  });

  const handleDownload = async (task: TaskLogItem) => {
    if (!task.resultUrl) return;

    try {
      const response = await fetch(task.resultUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${task.type}-${task.id}.${task.type === "video" ? "mp4" : "png"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("[Download] Error:", error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-400" />;
      case "processing":
      case "pending":
        return <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed":
        return "已完成";
      case "failed":
        return "失败";
      case "processing":
        return "处理中";
      case "pending":
        return "等待中";
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-lg">
            成品交付单
          </h1>
          <p className="mt-2 text-white/60">
            查看和下载您生成的视频与图片内容
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-sm text-amber-400">内容保留7天</span>
          </div>
          {stats && stats.processingTasks > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={refreshProcessingTasks}
              disabled={refreshing}
              className="gap-2 text-tiktok-cyan border-tiktok-cyan/30 hover:bg-tiktok-cyan/10"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              刷新状态 ({stats.processingTasks})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={fetchTasks} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>
      </div>

      {/* Stats Cards - Titanium Glass */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card variant="glass" className="group hover:border-mermaid-cyan/30 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 border border-white/10 shadow-inner group-hover:bg-mermaid-cyan/10 group-hover:text-mermaid-cyan transition-colors">
              <History className="h-6 w-6 text-white/70 group-hover:text-mermaid-cyan transition-colors" />
            </div>
            <div>
              <p className="text-sm text-white/40">总任务数</p>
              <p className="text-2xl font-bold text-white tracking-tight group-hover:text-mermaid-cyan transition-colors">{stats?.totalTasks || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card variant="glass" className="group hover:border-mermaid-pink/30 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 border border-white/10 shadow-inner group-hover:bg-mermaid-pink/10 group-hover:text-mermaid-pink transition-colors">
              <Video className="h-6 w-6 text-white/70 group-hover:text-mermaid-pink transition-colors" />
            </div>
            <div>
              <p className="text-sm text-white/40">视频</p>
              <p className="text-2xl font-bold text-white tracking-tight group-hover:text-mermaid-pink transition-colors">{stats?.totalVideos || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card variant="glass" className="group hover:border-mermaid-cyan/30 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 border border-white/10 shadow-inner group-hover:bg-mermaid-cyan/10 group-hover:text-mermaid-cyan transition-colors">
              <ImageIcon className="h-6 w-6 text-white/70 group-hover:text-mermaid-cyan transition-colors" />
            </div>
            <div>
              <p className="text-sm text-white/40">图片</p>
              <p className="text-2xl font-bold text-white tracking-tight group-hover:text-mermaid-cyan transition-colors">{stats?.totalImages || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card variant="glass" className="group hover:border-neon-green/30 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neon-green/10 border border-neon-green/20 shadow-[0_0_8px_rgba(57,255,20,0.1)]">
              <CheckCircle className="h-6 w-6 text-neon-green drop-shadow" />
            </div>
            <div>
              <p className="text-sm text-white/40">成功率</p>
              <p className="text-2xl font-bold text-neon-green tracking-tight">
                {stats && stats.totalTasks > 0
                  ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
                  : 0}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search - Titanium Glass */}
      <Card variant="glass" className="bg-[#0B0C10]/60 backdrop-blur-md">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md group">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30 group-focus-within:text-mermaid-cyan transition-colors" />
              <Input
                placeholder="搜索提示词或模型..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white/5 border-white/10 focus-visible:ring-1 focus-visible:ring-mermaid-cyan/50 focus-visible:border-mermaid-cyan/50 transition-all placeholder:text-white/20 text-white rounded-xl"
              />
            </div>

            {/* Type Filter */}
            <div className="flex flex-wrap gap-2">
              {typeFilters.map((filter) => (
                <Button
                  key={filter.value}
                  variant={selectedType === filter.value ? "mermaid" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedType(filter.value)}
                  className={selectedType === filter.value
                    ? ""
                    : "bg-white/5 text-white/60 border-white/5 hover:bg-white/10 hover:text-white transition-all"
                  }
                >
                  {filter.label}
                </Button>
              ))}
            </div>

            {/* Status Filter */}
            <div className="flex flex-wrap gap-2">
              {statusFilters.map((filter) => (
                <Button
                  key={filter.value}
                  variant={selectedStatus === filter.value ? "mermaid" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedStatus(filter.value)}
                  className={selectedStatus === filter.value
                    ? ""
                    : "bg-white/5 text-white/60 border-white/5 hover:bg-white/10 hover:text-white transition-all"
                  }
                >
                  {filter.label}
                </Button>
              ))}
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2 border border-white/10 rounded-lg p-1 bg-white/5">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className={viewMode === "grid" ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className={viewMode === "list" ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-tiktok-cyan" />
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredTasks.length === 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <History className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">暂无任务记录</h3>
            <p className="text-muted-foreground text-center max-w-md">
              开始使用快速生成或批量生产功能后，您的生成记录将显示在这里
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tasks Grid/List */}
      {!loading && filteredTasks.length > 0 && (
        viewMode === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredTasks.map((task) => {
              const expiry = getExpiryStatus(task.expiresAt);

              return (
                <Card
                  key={task.id}
                  variant="glass"
                  className={`group overflow-hidden bg-[#0B0C10]/60 hover:shadow-lg hover:shadow-mermaid-cyan/10 transition-all duration-500 ${expiry.isExpired ? "opacity-50" : ""
                    }`}
                >
                  <div className="relative aspect-video bg-gradient-to-br from-white/5 to-white/10">
                    {task.resultUrl && task.status === "completed" ? (
                      task.type === "video" ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <video
                            src={task.resultUrl}
                            className="w-full h-full object-cover"
                            muted
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Play className="h-12 w-12 text-white drop-shadow-lg" />
                          </div>
                        </div>
                      ) : (
                        <img
                          src={task.resultUrl}
                          alt={task.prompt || "生成图片"}
                          className="w-full h-full object-cover hover:scale-105 transition-transform duration-700"
                        />
                      )
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white/5 border border-white/10 shadow-inner">
                          {task.type === "video" ? (
                            <Video className="h-8 w-8 text-white/30" />
                          ) : (
                            <ImageIcon className="h-8 w-8 text-white/30" />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Status Badge */}
                    <div className="absolute top-2 left-2">
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs backdrop-blur-md ${task.status === "completed" ? "bg-neon-green/20 text-neon-green" :
                        task.status === "failed" ? "bg-neon-red/20 text-neon-red" :
                          "bg-neon-warning/20 text-neon-warning"
                        }`}>
                        {getStatusIcon(task.status)}
                        {getStatusLabel(task.status)}
                      </div>
                    </div>

                    {/* Expiry Badge */}
                    {expiry.isExpiringSoon && !expiry.isExpired && (
                      <div className="absolute top-2 right-2">
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-neon-warning/20 text-neon-warning backdrop-blur-md">
                          <AlertTriangle className="h-3 w-3" />
                          {expiry.text}
                        </div>
                      </div>
                    )}

                    {/* Hover Actions */}
                    {task.status === "completed" && task.resultUrl && !expiry.isExpired && (
                      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="mermaid-ghost"
                          className="h-9 w-9 rounded-full"
                          onClick={() => setPreviewTask(task)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="mermaid-ghost"
                          className="h-9 w-9 rounded-full"
                          onClick={() => handleDownload(task)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  <CardContent className="p-3 border-t border-white/5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <p className="font-medium text-sm text-white/90 group-hover:text-mermaid-cyan transition-colors line-clamp-2 leading-tight">
                          {task.prompt || "未命名任务"}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-xs text-white/40 whitespace-nowrap">
                            {getSourceLabel(task.source)}
                          </span>
                          <span className="text-xs text-white/40">·</span>
                          <span className="text-xs text-white/40 whitespace-nowrap">
                            {task.credits} 积分
                          </span>
                        </div>
                        <p className="text-xs text-white/30 mt-1">
                          {formatDate(task.createdAt)}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-white/40 hover:text-white">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-[#16181D] border-white/10 text-white">
                          {task.status === "completed" && task.resultUrl && !expiry.isExpired && (
                            <>
                              <DropdownMenuItem onClick={() => setPreviewTask(task)} className="focus:bg-white/10 focus:text-mermaid-cyan">
                                <Eye className="h-4 w-4 mr-2" />
                                预览
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDownload(task)} className="focus:bg-white/10 focus:text-mermaid-cyan">
                                <Download className="h-4 w-4 mr-2" />
                                下载
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => window.open(task.resultUrl!, "_blank")} className="focus:bg-white/10 focus:text-mermaid-cyan">
                                <ExternalLink className="h-4 w-4 mr-2" />
                                新窗口打开
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card variant="glass" className="bg-[#0B0C10]/60 backdrop-blur-sm">
            <CardContent className="p-0">
              <div className="divide-y divide-white/5">
                {filteredTasks.map((task) => {
                  const expiry = getExpiryStatus(task.expiresAt);

                  return (
                    <div
                      key={task.id}
                      className={`flex items-center gap-4 p-4 hover:bg-white/5 transition-all duration-300 group ${expiry.isExpired ? "opacity-50" : ""
                        }`}
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/5 border border-white/10 group-hover:border-mermaid-cyan/30 group-hover:bg-mermaid-cyan/5 transition-colors">
                        {task.type === "video" ? (
                          <Video className="h-5 w-5 text-white/70 group-hover:text-mermaid-cyan" />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-white/70 group-hover:text-mermaid-cyan" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-white/90 group-hover:text-mermaid-cyan transition-colors">
                          {task.prompt?.substring(0, 50) || "未命名任务"}
                        </p>
                        <p className="text-sm text-white/40">
                          {getSourceLabel(task.source)} · {task.model}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(task.status)}
                        <span className="text-sm text-white/70">{getStatusLabel(task.status)}</span>
                      </div>
                      <div className="text-sm text-white/40 hidden md:block">
                        {task.credits} 积分
                      </div>
                      <div className="text-sm text-white/40 hidden lg:block">
                        {formatDate(task.createdAt)}
                      </div>
                      {expiry.isExpiringSoon && !expiry.isExpired && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-neon-warning/20 text-neon-warning">
                          <AlertTriangle className="h-3 w-3" />
                          {expiry.text}
                        </div>
                      )}
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {task.status === "completed" && task.resultUrl && !expiry.isExpired && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:bg-white/10 hover:text-mermaid-cyan"
                              onClick={() => setPreviewTask(task)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:bg-white/10 hover:text-mermaid-cyan"
                              onClick={() => handleDownload(task)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )
      )}

      {/* Preview Dialog - 优化尺寸，避免被遮挡 */}
      <Dialog open={!!previewTask} onOpenChange={() => setPreviewTask(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto bg-background border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewTask?.type === "video" ? (
                <Video className="h-5 w-5 text-tiktok-pink" />
              ) : (
                <ImageIcon className="h-5 w-5 text-tiktok-cyan" />
              )}
              {previewTask?.type === "video" ? "视频预览" : "图片预览"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {previewTask?.type === "video" && previewTask.resultUrl ? (
              <video
                src={previewTask.resultUrl}
                controls
                autoPlay
                className="w-full max-h-[50vh] rounded-lg object-contain bg-black"
              />
            ) : previewTask?.resultUrl ? (
              <img
                src={previewTask.resultUrl}
                alt={previewTask.prompt || "预览图片"}
                className="w-full max-h-[50vh] rounded-lg object-contain"
              />
            ) : null}

            <div className="space-y-1.5 text-sm p-3 rounded-lg bg-muted/30">
              <div className="flex justify-between">
                <span className="text-muted-foreground">提示词</span>
                <span className="max-w-[200px] truncate text-right">{previewTask?.prompt || "无"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">来源</span>
                <span>{getSourceLabel(previewTask?.source || "")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">模型</span>
                <span>{previewTask?.model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">积分</span>
                <span>{previewTask?.credits}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">时间</span>
                <span>{previewTask?.createdAt && formatDate(previewTask.createdAt)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setPreviewTask(null)}>
                关闭
              </Button>
              {previewTask?.resultUrl && (
                <Button
                  size="sm"
                  variant="white-glow"
                  className="gap-2"
                  onClick={() => handleDownload(previewTask)}
                >
                  <Download className="h-4 w-4" />
                  下载
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
