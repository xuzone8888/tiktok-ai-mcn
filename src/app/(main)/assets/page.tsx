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
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="gradient-tiktok-text">生产轨迹簿</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
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

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-tiktok-cyan/10">
              <History className="h-6 w-6 text-tiktok-cyan" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">总任务数</p>
              <p className="text-2xl font-bold">{stats?.totalTasks || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-tiktok-pink/10">
              <Video className="h-6 w-6 text-tiktok-pink" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">视频</p>
              <p className="text-2xl font-bold">{stats?.totalVideos || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-tiktok-cyan/10">
              <ImageIcon className="h-6 w-6 text-tiktok-cyan" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">图片</p>
              <p className="text-2xl font-bold">{stats?.totalImages || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
              <CheckCircle className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">成功率</p>
              <p className="text-2xl font-bold">
                {stats && stats.totalTasks > 0 
                  ? Math.round((stats.completedTasks / stats.totalTasks) * 100) 
                  : 0}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索提示词或模型..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-background/50 border-border/50"
              />
            </div>

            {/* Type Filter */}
            <div className="flex flex-wrap gap-2">
              {typeFilters.map((filter) => (
                <Button
                  key={filter.value}
                  variant={selectedType === filter.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedType(filter.value)}
                  className={selectedType === filter.value 
                    ? "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink" 
                    : "border-border/50 hover:border-tiktok-cyan/50"
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
                  variant={selectedStatus === filter.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedStatus(filter.value)}
                  className={selectedStatus === filter.value 
                    ? "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink" 
                    : "border-border/50 hover:border-tiktok-cyan/50"
                  }
                >
                  {filter.label}
                </Button>
              ))}
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2 border border-border/50 rounded-lg p-1">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
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
                  className={`group overflow-hidden border-border/50 bg-card/50 hover:border-tiktok-cyan/30 transition-all ${
                    expiry.isExpired ? "opacity-50" : ""
                  }`}
                >
                  <div className="relative aspect-video bg-gradient-to-br from-background to-background/50">
                    {task.resultUrl && task.status === "completed" ? (
                      task.type === "video" ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <video 
                            src={task.resultUrl} 
                            className="w-full h-full object-cover"
                            muted
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <Play className="h-12 w-12 text-white" />
                          </div>
                        </div>
                      ) : (
                        <img 
                          src={task.resultUrl} 
                          alt={task.prompt || "生成图片"}
                          className="w-full h-full object-cover"
                        />
                      )
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className={`flex h-16 w-16 items-center justify-center rounded-xl ${
                          task.type === "video" ? "bg-tiktok-pink/20" : "bg-tiktok-cyan/20"
                        }`}>
                          {task.type === "video" ? (
                            <Video className="h-8 w-8 text-tiktok-pink" />
                          ) : (
                            <ImageIcon className="h-8 w-8 text-tiktok-cyan" />
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Status Badge */}
                    <div className="absolute top-2 left-2">
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                        task.status === "completed" ? "bg-emerald-500/20 text-emerald-400" :
                        task.status === "failed" ? "bg-red-500/20 text-red-400" :
                        "bg-amber-500/20 text-amber-400"
                      }`}>
                        {getStatusIcon(task.status)}
                        {getStatusLabel(task.status)}
                      </div>
                    </div>

                    {/* Expiry Badge */}
                    {expiry.isExpiringSoon && !expiry.isExpired && (
                      <div className="absolute top-2 right-2">
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-amber-500/20 text-amber-400">
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
                          variant="secondary" 
                          className="h-9 w-9"
                          onClick={() => setPreviewTask(task)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="secondary" 
                          className="h-9 w-9"
                          onClick={() => handleDownload(task)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-sm">
                          {task.prompt?.substring(0, 30) || "未命名任务"}
                          {task.prompt && task.prompt.length > 30 ? "..." : ""}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {getSourceLabel(task.source)}
                          </span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">
                            {task.credits} 积分
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDate(task.createdAt)}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-popover border-border">
                          {task.status === "completed" && task.resultUrl && !expiry.isExpired && (
                            <>
                              <DropdownMenuItem onClick={() => setPreviewTask(task)}>
                                <Eye className="h-4 w-4 mr-2" />
                                预览
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDownload(task)}>
                                <Download className="h-4 w-4 mr-2" />
                                下载
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => window.open(task.resultUrl!, "_blank")}>
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
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {filteredTasks.map((task) => {
                  const expiry = getExpiryStatus(task.expiresAt);
                  
                  return (
                    <div 
                      key={task.id} 
                      className={`flex items-center gap-4 p-4 hover:bg-white/5 transition-colors ${
                        expiry.isExpired ? "opacity-50" : ""
                      }`}
                    >
                      <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${
                        task.type === "video" ? "bg-tiktok-pink/20" : "bg-tiktok-cyan/20"
                      }`}>
                        {task.type === "video" ? (
                          <Video className="h-5 w-5 text-tiktok-pink" />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-tiktok-cyan" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {task.prompt?.substring(0, 50) || "未命名任务"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {getSourceLabel(task.source)} · {task.model}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(task.status)}
                        <span className="text-sm">{getStatusLabel(task.status)}</span>
                      </div>
                      <div className="text-sm text-muted-foreground hidden md:block">
                        {task.credits} 积分
                      </div>
                      <div className="text-sm text-muted-foreground hidden lg:block">
                        {formatDate(task.createdAt)}
                      </div>
                      {expiry.isExpiringSoon && !expiry.isExpired && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-amber-500/20 text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          {expiry.text}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        {task.status === "completed" && task.resultUrl && !expiry.isExpired && (
                          <>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8"
                              onClick={() => setPreviewTask(task)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8"
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
                  className="gap-2 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink"
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
