"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useDownloadStore } from "@/stores/download-store";
import JSZip from "jszip";
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
  CheckSquare,
  Square,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Play,
  ExternalLink,
  FileDown,
  ChevronDown,
  FolderOpen,
  Calendar,
  X,
  Package,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";

interface TaskLogItem {
  id: string;
  type: "video" | "image";
  source: "quick_gen" | "batch_video" | "batch_video_prompt" | "batch_video_veo3" | "batch_video_prompt_veo3" | "batch_image" | "link_video" | "ecom_factory";
  status: "completed" | "failed" | "processing" | "pending";
  resultUrl: string | null;
  thumbnailUrl: string | null;
  prompt: string | null;
  model: string;
  credits: number;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
  groupName?: string;
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

function getTypeFilters(lang: string) {
  const t = lang === "en";
  return [
    { value: "all",   label: t ? "All"   : "全部" },
    { value: "video", label: t ? "Video" : "视频" },
    { value: "image", label: t ? "Image" : "图片" },
  ];
}

function getStatusFilters(lang: string) {
  const t = lang === "en";
  return [
    { value: "all",        label: t ? "All Status"   : "全部状态" },
    { value: "completed",  label: t ? "Completed"    : "已完成" },
    { value: "processing", label: t ? "Processing"   : "处理中" },
    { value: "failed",     label: t ? "Failed"       : "失败" },
  ];
}

function getSourceFilters(lang: string) {
  const t = lang === "en";
  return [
    { value: "all",          label: t ? "All Sources"   : "全部来源" },
    { value: "quick_gen",    label: t ? "Single Image"  : "单图生成" },
    { value: "batch_video",  label: t ? "Batch Video"   : "批量视频" },
    { value: "batch_image",  label: t ? "Batch Image"   : "批量图片" },
    { value: "link_video",   label: t ? "Link to Video" : "链接秒变" },
    { value: "ecom_factory", label: t ? "Ecom Factory"  : "电商工厂" },
  ];
}

function getDateFilters(lang: string) {
  const t = lang === "en";
  return [
    { value: "all",    label: t ? "All Time"    : "全部时间" },
    { value: "today",  label: t ? "Today"       : "今天" },
    { value: "3days",  label: t ? "Last 3 days" : "最近3天" },
    { value: "7days",  label: t ? "Last 7 days" : "最近7天" },
    { value: "custom", label: t ? "Custom"      : "自定义" },
  ];
}

function getSourceColor(source: string): string {
  switch (source) {
    case "quick_gen":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "batch_video":
    case "batch_video_prompt":
      return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    case "batch_video_veo3":
    case "batch_video_prompt_veo3":
      return "bg-pink-500/20 text-pink-400 border-pink-500/30";
    case "batch_image":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "link_video":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "ecom_factory":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default:
      return "bg-white/10 text-white/60 border-white/20";
  }
}

function formatDate(dateString: string, lang: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(lang === "en" ? "en-US" : "zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getExpiryStatus(expiresAt: string, lang: string): { text: string; isExpiringSoon: boolean; isExpired: boolean } {
  const t = lang === "en";
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diff = expiry.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (diff <= 0) {
    return { text: t ? "Expired" : "已过期", isExpiringSoon: false, isExpired: true };
  }
  if (days <= 1) {
    return { text: t ? "Expiring soon" : "即将过期", isExpiringSoon: true, isExpired: false };
  }
  if (days <= 3) {
    return { text: t ? `Expires in ${days}d` : `${days}天后过期`, isExpiringSoon: true, isExpired: false };
  }
  return { text: t ? `Expires in ${days}d` : `${days}天后过期`, isExpiringSoon: false, isExpired: false };
}

function getSourceLabel(source: string, lang: string): string {
  const t = lang === "en";
  switch (source) {
    case "quick_gen":              return t ? "Single Image"   : "单图生成";
    case "batch_video":            return t ? "Batch Video"    : "批量视频";
    case "batch_video_prompt":     return t ? "Sora T2V"       : "Sora文生视频";
    case "batch_video_veo3":       return t ? "VEO3 Video"     : "VEO3视频";
    case "batch_video_prompt_veo3":return t ? "VEO3 T2V"       : "VEO3文生";
    case "batch_image":            return t ? "Batch Image"    : "批量图片";
    case "link_video":             return t ? "Link to Video"  : "链接秒变";
    case "ecom_factory":           return t ? "Ecom Factory"   : "电商工厂";
    default:                       return t ? "Unknown"        : "未知来源";
  }
}

export default function TaskLogPage() {
  const { toast } = useToast();
  const { lang } = useLang();
  const t = lang === "en";
  const typeFilters = getTypeFilters(lang);
  const statusFilters = getStatusFilters(lang);
  const sourceFilters = getSourceFilters(lang);
  const dateFilters = getDateFilters(lang);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedSource, setSelectedSource] = useState("all");
  const [selectedDate, setSelectedDate] = useState("all");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskLogItem[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewTask, setPreviewTask] = useState<TaskLogItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  // 批量选择模式
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // ZIP 后台下载进度
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number } | null>(null);
  const zipAbortRef = useRef(false);
  const fetchTasksRef = useRef<(appendMode?: boolean) => Promise<void>>(null!);

  const fetchTasks = async (appendMode = false) => {
    try {
      if (appendMode) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setCursor(null);
      }

      const params = new URLSearchParams();
      if (selectedType !== "all") params.set("type", selectedType);
      if (selectedStatus !== "all") params.set("status", selectedStatus);
      if (selectedSource !== "all") params.set("source", selectedSource);
      if (selectedDate !== "all") params.set("dateRange", selectedDate);
      if (selectedDate === "custom") {
        if (customDateFrom) params.set("dateFrom", customDateFrom);
        if (customDateTo) params.set("dateTo", customDateTo);
      }
      if (selectedGroup !== "all") params.set("groupName", selectedGroup);
      // cursor 游标分页：加载更多时传上一页最后一条的 createdAt
      if (appendMode && cursor) {
        params.set("cursor", cursor);
      }
      params.set("limit", "200");

      const response = await fetch(`/api/user/tasks?${params.toString()}`);
      const result = await response.json();

      if (result.success) {
        if (appendMode) {
          setTasks(prev => [...prev, ...result.data.tasks]);
        } else {
          setTasks(result.data.tasks);
        }
        // 使用 API 返回的完整分组列表（不受分页限制）
        if (result.data.availableGroups) {
          setAvailableGroups(result.data.availableGroups);
        }
        setStats(result.data.stats);
        // 使用 API 返回的 nextCursor 和 hasMore
        setCursor(result.data.pagination.nextCursor || null);
        setHasMore(result.data.pagination.hasMore ?? false);
      }
    } catch (error) {
      console.error("[TaskLog] Error:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // 始终保持 ref 指向最新的 fetchTasks（解决 useCallback 闭包陈旧问题）
  fetchTasksRef.current = fetchTasks;

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      fetchTasks(true);
    }
  };

  // 刷新处理中的任务状态（手动触发）
  const refreshProcessingTasks = useCallback(async () => {
    try {
      setRefreshing(true);
      const response = await fetch("/api/user/tasks/refresh", { method: "POST" });
      const result = await response.json();

      if (result.success) {
        console.log("[TaskLog] Refresh result:", result.data);
        if (result.data.completed > 0 || result.data.failed > 0) {
          toast({
            title: t ? "Status Updated" : "任务状态已更新",
            description: t
              ? `${result.data.completed} done, ${result.data.failed} failed`
              : `${result.data.completed} 个完成，${result.data.failed} 个失败`,
          });
          // 通过 ref 调用最新的 fetchTasks（包含当前筛选值），重新加载列表
          fetchTasksRef.current();
        } else {
          toast({
            title: t ? "No changes" : "暂无变化",
            description: t
              ? `${result.data.total || 0} task(s) still processing`
              : `${result.data.total || 0} 个任务仍在处理中`,
          });
        }
      }
    } catch (error) {
      console.error("[TaskLog] Refresh error:", error);
      toast({
        title: t ? "Refresh Failed" : "刷新失败",
        description: t ? "Please retry" : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTasks();
  }, [selectedType, selectedStatus, selectedSource, selectedDate, selectedGroup, customDateFrom, customDateTo]);

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
    const { download } = useDownloadStore.getState();
    const type = task.type === "video" ? "video" : "image";
    const ext = task.type === "video" ? "mp4" : "png";
    const filename = `${task.type}-${task.id.slice(-6)}.${ext}`;
    download(task.resultUrl, filename, type);
  };

  // ============================================================================
  // 批量选择相关函数
  // ============================================================================

  const isSelectable = (task: TaskLogItem) => {
    const expiry = getExpiryStatus(task.expiresAt, lang);
    return task.status === "completed" && !!task.resultUrl && !expiry.isExpired;
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllCompleted = () => {
    const selectableIds = filteredTasks.filter(isSelectable).map(t => t.id);
    setSelectedIds(new Set(selectableIds));
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const getSelectedTasks = () => {
    return filteredTasks.filter(t => selectedIds.has(t.id) && isSelectable(t));
  };

  const handleBatchExportTxt = () => {
    const selected = getSelectedTasks();
    if (selected.length === 0) {
      toast({ title: t ? "No items selected" : "没有选中的任务", variant: "destructive" });
      return;
    }
    // 按分组归类
    const grouped = new Map<string, string[]>();
    for (const task of selected) {
      if (!task.resultUrl) continue;
      const group = task.groupName && task.groupName !== "默认"
        ? task.groupName
        : (task.source === "ecom_factory"
          ? (t ? "Ecom Factory" : "电商工厂")
          : (t ? "Ungrouped" : "未分组"));
      if (!grouped.has(group)) grouped.set(group, []);
      // 将相对代理路径补全为完整 URL（让迅雷等第三方工具可用）
      let exportUrl = task.resultUrl;
      if (exportUrl.startsWith('/api/')) {
        exportUrl = `${window.location.origin}${exportUrl}`;
      }
      grouped.get(group)!.push(exportUrl);
    }
    // 生成带分组标题的 TXT
    const lines: string[] = [];
    Array.from(grouped.entries()).forEach(([group, urls]) => {
      lines.push(`# === ${group} (${urls.length}${t ? " files" : "个"}) ===`);
      lines.push(...urls);
      lines.push(""); // 空行分隔
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch_download_urls_${new Date().toISOString().slice(0, 16).replace(':', '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: t ? "✅ Exported" : "✅ 导出成功",
      description: t
        ? `Exported ${selected.length} URLs (${grouped.size} groups). Use IDM/Thunder to batch download.`
        : `已导出 ${selected.length} 个地址（${grouped.size}个分组），请用 IDM/迅雷 批量下载`,
    });
  };

  const handleBatchZipDownload = async () => {
    const selected = getSelectedTasks();
    if (selected.length === 0) {
      toast({ title: t ? "No items selected" : "没有选中的任务", variant: "destructive" });
      return;
    }

    // 退出选择模式，让用户继续操作
    exitSelectionMode();
    zipAbortRef.current = false;

    setZipProgress({ current: 0, total: selected.length });
    toast({
      title: t ? "📦 Packing..." : "📦 开始打包下载",
      description: t
        ? `Downloading ${selected.length} files in background`
        : `正在下载 ${selected.length} 个文件，可继续其他操作`,
    });

    try {
      const zip = new JSZip();
      let completed = 0;
      // 文件名计数器，防止同一文件夹内重名
      const nameCounter = new Map<string, number>();

      for (const task of selected) {
        if (zipAbortRef.current) break;
        if (!task.resultUrl) continue;

        try {
          // 按分组建子文件夹
          const group = task.groupName && task.groupName !== "默认" ? task.groupName : (task.source === "ecom_factory" ? "电商工厂" : "未分组");
          const ext = task.type === "video" ? "mp4" : "png";
          const baseName = `${task.type}-${task.id.slice(-6)}`;
          // 防重：如果同名则追加序号
          const key = `${group}/${baseName}.${ext}`;
          const count = nameCounter.get(key) || 0;
          nameCounter.set(key, count + 1);
          const filename = count === 0 ? `${baseName}.${ext}` : `${baseName}_${count}.${ext}`;

          const proxyUrl = `/api/download-proxy?url=${encodeURIComponent(task.resultUrl)}&filename=${encodeURIComponent(filename)}`;
          const response = await fetch(proxyUrl);
          if (response.ok) {
            const blob = await response.blob();
            zip.folder(group)!.file(filename, blob);
          }
        } catch (err) {
          console.error(`[BatchZip] Failed to download ${task.id}:`, err);
        }
        completed++;
        setZipProgress({ current: completed, total: selected.length });
      }

      if (zipAbortRef.current) {
        setZipProgress(null);
        toast({ title: t ? "❌ Cancelled" : "已取消打包", variant: "destructive" });
        return;
      }

      // 生成并下载 ZIP
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `toryx_batch_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: t ? "✅ Pack Done" : "✅ 打包完成",
        description: t ? `Downloaded ${completed} files` : `已下载 ${completed} 个文件`,
      });
    } catch (error) {
      console.error("[BatchZip] Error:", error);
      toast({ title: t ? "Pack Failed" : "打包失败", description: t ? "Please retry" : "请稍后重试", variant: "destructive" });
    } finally {
      setZipProgress(null);
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
      case "completed":  return t ? "Done"       : "已完成";
      case "failed":     return t ? "Failed"     : "失败";
      case "processing": return t ? "Processing" : "处理中";
      case "pending":    return t ? "Pending"    : "等待中";
      default:           return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-lg">
              {t ? "Generated Assets" : "生成记录"}
            </h1>
            <p className="mt-2 text-white/60">
              {t ? "View and download your generated videos and images" : "查看和下载您生成的视频与图片内容"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 self-start mt-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs text-amber-400">{t ? "Content kept 7 days" : "内容保留7天"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stats && stats.processingTasks > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={refreshProcessingTasks}
              disabled={refreshing}
              className="gap-2 text-tiktok-cyan border-tiktok-cyan/30 hover:bg-tiktok-cyan/10"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {t ? `Refresh (${stats.processingTasks})` : `刷新状态 (${stats.processingTasks})`}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fetchTasks()}
            className="h-9 w-9 text-white/50 hover:text-white hover:bg-white/10"
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {!selectionMode ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectionMode(true)}
              className="gap-2 bg-gradient-to-r from-mermaid-cyan/10 to-mermaid-pink/10 border-mermaid-cyan/30 text-mermaid-cyan hover:from-mermaid-cyan/20 hover:to-mermaid-pink/20 hover:border-mermaid-cyan/50 transition-all"
            >
              <CheckSquare className="h-4 w-4" />
              {t ? "Select" : "批量选择"}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={exitSelectionMode}
              className="gap-2 text-white/60 border-white/20 hover:text-white hover:bg-white/10"
            >
              <X className="h-4 w-4" />
              {t ? "Done" : "退出选择"}
            </Button>
          )}
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
              <p className="text-sm text-white/40">{t ? "Total" : "总任务数"}</p>
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
              <p className="text-sm text-white/40">{t ? "Videos" : "视频"}</p>
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
              <p className="text-sm text-white/40">{t ? "Images" : "图片"}</p>
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
              <p className="text-sm text-white/40">{t ? "Success Rate" : "成功率"}</p>
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
        <CardContent className="p-4 space-y-4">
          {/* Row 1: Search + Type + Status */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md group">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30 group-focus-within:text-mermaid-cyan transition-colors" />
              <Input
                placeholder={t ? "Search prompt or model..." : "搜索提示词或模型..."}
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
          </div>

          {/* Row 2: Source + Date + View Toggle */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-t border-white/5 pt-4">
            {/* Source Filter */}
            <div className="flex flex-wrap gap-2">
              <span className="text-white/40 text-sm flex items-center mr-2">{t ? "Source:" : "来源:"}</span>
              {sourceFilters.map((filter) => (
                <Button
                  key={filter.value}
                  variant={selectedSource === filter.value ? "mermaid" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedSource(filter.value)}
                  className={selectedSource === filter.value
                    ? ""
                    : "bg-white/5 text-white/60 border-white/5 hover:bg-white/10 hover:text-white transition-all"
                  }
                >
                  {filter.label}
                </Button>
              ))}
            </div>

            {/* Date Filter */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-white/40 text-sm flex items-center mr-2">{t ? "Time:" : "时间:"}</span>
              {dateFilters.map((filter) => (
                <Button
                  key={filter.value}
                  variant={selectedDate === filter.value ? "mermaid" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setSelectedDate(filter.value);
                    // 切换到非自定义时清空自定义日期
                    if (filter.value !== "custom") {
                      setCustomDateFrom("");
                      setCustomDateTo("");
                    }
                  }}
                  className={selectedDate === filter.value
                    ? ""
                    : "bg-white/5 text-white/60 border-white/5 hover:bg-white/10 hover:text-white transition-all"
                  }
                >
                  {filter.value === "custom" && <Calendar className="h-3 w-3 mr-1" />}
                  {filter.label}
                </Button>
              ))}
              {/* 自定义日期选择器 */}
              {selectedDate === "custom" && (
                <div className="flex items-center gap-2 ml-2">
                  <input
                    type="datetime-local"
                    value={customDateFrom}
                    onChange={(e) => setCustomDateFrom(e.target.value)}
                    className="px-2 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-mermaid-cyan/50 focus:outline-none focus:ring-1 focus:ring-mermaid-cyan/30 transition-all [color-scheme:dark]"
                    placeholder="开始时间"
                  />
                  <span className="text-white/30 text-xs">至</span>
                  <input
                    type="datetime-local"
                    value={customDateTo}
                    onChange={(e) => setCustomDateTo(e.target.value)}
                    className="px-2 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white focus:border-mermaid-cyan/50 focus:outline-none focus:ring-1 focus:ring-mermaid-cyan/30 transition-all [color-scheme:dark]"
                    placeholder="结束时间"
                  />
                </div>
              )}
            </div>

            {/* Group Filter Dropdown - 始终显示 */}
            <div className="flex items-center gap-2">
              <span className="text-white/40 text-sm flex items-center">
                <FolderOpen className="h-4 w-4 mr-1" />
                {t ? "Group:" : "分组:"}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={selectedGroup !== "all" ? "mermaid" : "ghost"}
                    size="sm"
                    className={`gap-2 ${selectedGroup !== "all"
                      ? ""
                      : "bg-white/5 text-white/60 border-white/5 hover:bg-white/10 hover:text-white"
                      }`}
                  >
                    {selectedGroup === "all" ? (t ? "All Groups" : "全部分组") : selectedGroup}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-[#16181D] border-white/10 text-white max-h-60 overflow-auto">
                  <DropdownMenuItem
                    onClick={() => setSelectedGroup("all")}
                    className={`focus:bg-white/10 cursor-pointer ${selectedGroup === "all" ? "text-mermaid-cyan" : ""}`}
                  >
                    {t ? "All Groups" : "全部分组"}
                  </DropdownMenuItem>
                  {availableGroups.length > 0 ? (
                    <>
                      <DropdownMenuSeparator className="bg-white/10" />
                      {availableGroups.map((group) => (
                        <DropdownMenuItem
                          key={group}
                          onClick={() => setSelectedGroup(group)}
                          className={`focus:bg-white/10 cursor-pointer ${selectedGroup === group ? "text-mermaid-cyan" : ""}`}
                        >
                          <FolderOpen className="h-4 w-4 mr-2 text-muted-foreground" />
                          {group}
                        </DropdownMenuItem>
                      ))}
                    </>
                  ) : (
                    <DropdownMenuItem disabled className="text-white/30 text-sm">
                      {t ? "No custom groups" : "暂无自定义分组"}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
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
            <h3 className="text-lg font-medium mb-2">{t ? "No records yet" : "暂无任务记录"}</h3>
            <p className="text-muted-foreground text-center max-w-md">
              {t ? "Your generated content will appear here after using Single Image or Batch Production." : "开始使用单图生成或批量生产功能后，您的生成记录将显示在这里"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tasks Grid/List */}
      {!loading && filteredTasks.length > 0 && (
        viewMode === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredTasks.map((task) => {
                  const expiry = getExpiryStatus(task.expiresAt, lang);

              return (
                <Card
                  key={task.id}
                  variant="glass"
                  className={`group overflow-hidden bg-[#0B0C10]/60 hover:shadow-lg hover:shadow-mermaid-cyan/10 transition-all duration-500 ${expiry.isExpired ? "opacity-50" : ""} ${selectionMode && selectedIds.has(task.id) ? "ring-2 ring-mermaid-cyan/60 border-mermaid-cyan/40" : ""}`}
                  onClick={selectionMode && isSelectable(task) ? () => toggleSelection(task.id) : undefined}
                  style={selectionMode ? { cursor: isSelectable(task) ? "pointer" : "not-allowed" } : undefined}
                >
                  <div className="relative aspect-video bg-gradient-to-br from-white/5 to-white/10">
                    {/* Selection Checkbox */}
                    {selectionMode && (
                      <div className="absolute top-2 left-2 z-20">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition-all ${!isSelectable(task) ? "border-white/10 bg-white/5 cursor-not-allowed" :
                          selectedIds.has(task.id) ? "border-mermaid-cyan bg-mermaid-cyan text-black" :
                            "border-white/30 bg-black/50 hover:border-mermaid-cyan/60"
                          }`}>
                          {selectedIds.has(task.id) && <CheckCircle className="h-4 w-4" />}
                        </div>
                      </div>
                    )}
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
                          alt={task.prompt || (t ? "Generated Image" : "生成图片")}
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

                    {/* Status Badge - shift right when in selection mode */}
                    <div className={`absolute top-2 ${selectionMode ? "left-10" : "left-2"} transition-all`}>
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
                          {task.prompt || (t ? "Unnamed task" : "未命名任务")}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {/* Colored Source Badge */}
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${getSourceColor(task.source)}`}>
                            {getSourceLabel(task.source, lang)}
                          </span>
                          {/* Task ID */}
                          <span className="text-xs text-white/50 font-mono">
                            #{task.id.slice(-4).toUpperCase()}
                          </span>
                          <span className="text-xs text-white/40">·</span>
                          <span className="text-xs text-white/40 whitespace-nowrap">
                            {task.credits} {t ? "credits" : "积分"}
                          </span>
                        </div>
                        <p className="text-xs text-white/30 mt-1">
                          {new Date(task.createdAt).toLocaleString(lang === "en" ? "en-US" : "zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {/* 始终可见的下载按钮 */}
                        {task.status === "completed" && task.resultUrl && !expiry.isExpired && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-mermaid-cyan/70 hover:text-mermaid-cyan hover:bg-mermaid-cyan/10"
                            onClick={() => handleDownload(task)}
                            disabled={downloading === task.id}
                          >
                            {downloading === task.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-[#16181D] border-white/10 text-white">
                            {task.status === "completed" && task.resultUrl && !expiry.isExpired && (
                              <>
                                <DropdownMenuItem onClick={() => setPreviewTask(task)} className="focus:bg-white/10 focus:text-mermaid-cyan">
                                  <Eye className="h-4 w-4 mr-2" />
                                  {t ? "Preview" : "预览"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDownload(task)} className="focus:bg-white/10 focus:text-mermaid-cyan">
                                  <Download className="h-4 w-4 mr-2" />
                                  {t ? "Download" : "下载"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => window.open(task.resultUrl!, "_blank")} className="focus:bg-white/10 focus:text-mermaid-cyan">
                                  <ExternalLink className="h-4 w-4 mr-2" />
                                  {t ? "Open in new tab" : "新窗口打开"}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
                      const expiry = getExpiryStatus(task.expiresAt, lang);

                  return (
                    <div
                      key={task.id}
                      className={`flex items-center gap-4 p-4 hover:bg-white/5 transition-all duration-300 group ${expiry.isExpired ? "opacity-50" : ""} ${selectionMode && selectedIds.has(task.id) ? "bg-mermaid-cyan/5 border-l-2 border-l-mermaid-cyan" : ""}`}
                      onClick={selectionMode && isSelectable(task) ? () => toggleSelection(task.id) : undefined}
                      style={selectionMode ? { cursor: isSelectable(task) ? "pointer" : "not-allowed" } : undefined}
                    >
                      {/* List Checkbox */}
                      {selectionMode && (
                        <div className={`flex h-5 w-5 items-center justify-center rounded border-2 shrink-0 transition-all ${!isSelectable(task) ? "border-white/10 bg-white/5" :
                          selectedIds.has(task.id) ? "border-mermaid-cyan bg-mermaid-cyan text-black" :
                            "border-white/30 bg-black/30 hover:border-mermaid-cyan/60"
                          }`}>
                          {selectedIds.has(task.id) && <CheckCircle className="h-3 w-3" />}
                        </div>
                      )}
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/5 border border-white/10 group-hover:border-mermaid-cyan/30 group-hover:bg-mermaid-cyan/5 transition-colors">
                        {task.type === "video" ? (
                          <Video className="h-5 w-5 text-white/70 group-hover:text-mermaid-cyan" />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-white/70 group-hover:text-mermaid-cyan" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate text-white/90 group-hover:text-mermaid-cyan transition-colors">
                            {task.prompt?.substring(0, 50) || (t ? "Unnamed task" : "未命名任务")}
                          </p>
                          <span className="text-xs text-white/50 font-mono shrink-0">
                            #{task.id.slice(-4).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${getSourceColor(task.source)}`}>
                            {getSourceLabel(task.source, lang)}
                          </span>
                          <span className="text-xs text-white/40">·</span>
                          <span className="text-sm text-white/40">{task.model}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(task.status)}
                        <span className="text-sm text-white/70">{getStatusLabel(task.status)}</span>
                      </div>
                      <div className="text-sm text-white/40 hidden md:block">
                        {task.credits} {t ? "credits" : "积分"}
                      </div>
                      <div className="text-sm text-white/40 hidden lg:block">
                        {new Date(task.createdAt).toLocaleString(lang === "en" ? "en-US" : "zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {expiry.isExpiringSoon && !expiry.isExpired && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-neon-warning/20 text-neon-warning">
                          <AlertTriangle className="h-3 w-3" />
                          {expiry.text}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        {task.status === "completed" && task.resultUrl && !expiry.isExpired && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-white/50 hover:bg-white/10 hover:text-mermaid-cyan"
                              onClick={() => setPreviewTask(task)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-mermaid-cyan/70 hover:bg-mermaid-cyan/10 hover:text-mermaid-cyan"
                              onClick={() => handleDownload(task)}
                              disabled={downloading === task.id}
                            >
                              {downloading === task.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
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

      {/* Load More Button */}
      {!loading && filteredTasks.length > 0 && hasMore && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={loadingMore}
            className="gap-2 border-white/10 hover:border-mermaid-cyan/30 hover:bg-mermaid-cyan/5"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t ? "Loading..." : "加载中..."}
              </>
            ) : (
              <>
                {t ? "Load more" : "加载更多"}
              </>
            )}
          </Button>
        </div>
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
              {previewTask?.type === "video" ? (t ? "Video Preview" : "视频预览") : (t ? "Image Preview" : "图片预览")}
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
                alt={previewTask.prompt || (t ? "Preview" : "预览图片")}
                className="w-full max-h-[50vh] rounded-lg object-contain"
              />
            ) : null}

            <div className="space-y-1.5 text-sm p-3 rounded-lg bg-muted/30">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t ? "Prompt" : "提示词"}</span>
                <span className="max-w-[200px] truncate text-right">{previewTask?.prompt || (t ? "None" : "无")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t ? "Source" : "来源"}</span>
                <span>{getSourceLabel(previewTask?.source || "", lang)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t ? "Model" : "模型"}</span>
                <span>{previewTask?.model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t ? "Credits" : "积分"}</span>
                <span>{previewTask?.credits}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t ? "Time" : "时间"}</span>
                <span>{previewTask?.createdAt && formatDate(previewTask.createdAt, lang)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setPreviewTask(null)}>
                {t ? "Close" : "关闭"}
              </Button>
              {previewTask?.resultUrl && (
                <Button
                  size="sm"
                  variant="white-glow"
                  className="gap-2"
                  onClick={() => handleDownload(previewTask)}
                >
                  <Download className="h-4 w-4" />
                  {t ? "Download" : "下载"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* 批量选择浮动操作栏 */}
      {/* ============================================================ */}
      {selectionMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-[#16181D]/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50">
            {/* 已选数量 */}
            <div className="flex items-center gap-2 pr-3 border-r border-white/10">
              <CheckSquare className="h-4 w-4 text-mermaid-cyan" />
              <span className="text-sm font-medium text-white">
                {t ? "Selected" : "已选"} <span className="text-mermaid-cyan font-bold">{selectedIds.size}</span> {t ? "items" : "个"}
              </span>
            </div>

            {/* 全选本页成功 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAllCompleted}
              className="text-white/60 hover:text-white hover:bg-white/10 text-sm"
            >
              <Square className="h-3.5 w-3.5 mr-1.5" />
              {t ? "Select completed" : "全选成功"}
            </Button>

            {/* 导出TXT (推荐) */}
            <Button
              size="sm"
              onClick={handleBatchExportTxt}
              disabled={selectedIds.size === 0}
              className="gap-2 bg-gradient-to-r from-mermaid-cyan to-blue-500 text-black font-medium hover:from-mermaid-cyan/90 hover:to-blue-500/90 disabled:opacity-40"
            >
              <FileDown className="h-4 w-4" />
              {t ? "Export TXT" : "导出txt"}
              <span className="text-[10px] opacity-70">{t ? "Recommended" : "推荐"}</span>
            </Button>

            {/* 打包ZIP */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchZipDownload}
              disabled={selectedIds.size === 0 || !!zipProgress}
              className="gap-2 text-white/70 border-white/20 hover:text-white hover:bg-white/10 disabled:opacity-40"
            >
              <Package className="h-4 w-4" />
              {t ? "Pack ZIP" : "打包ZIP"}
            </Button>

            {/* 取消 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={exitSelectionMode}
              className="text-white/40 hover:text-white hover:bg-white/10 ml-1"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* ZIP 后台下载进度浮窗 */}
      {/* ============================================================ */}
      {zipProgress && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 duration-300">
          <div className="flex flex-col gap-2 p-4 rounded-xl bg-[#16181D]/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50 min-w-[240px]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-mermaid-cyan animate-pulse" />
                <span className="text-sm font-medium text-white">{t ? "Packing..." : "正在打包下载..."}</span>
              </div>
              <button
                onClick={() => { zipAbortRef.current = true; }}
                className="text-white/30 hover:text-white/60 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* 进度条 */}
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-mermaid-cyan to-mermaid-pink transition-all duration-300"
                style={{ width: `${Math.round((zipProgress.current / zipProgress.total) * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-white/40">
              <span>{zipProgress.current}/{zipProgress.total} {t ? "files" : "文件"}</span>
              <span>{t ? "Will auto-download when done" : "完成后将自动下载"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
