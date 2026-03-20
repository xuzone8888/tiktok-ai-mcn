"use client";

/**
 * 下载管理器悬浮组件
 * 
 * 固定在页面右下角，显示下载任务进度
 * - 折叠态：圆形按钮 + 环形进度 + 任务数
 * - 展开态：任务列表 + 进度条 + 速度 + 操作按钮
 * - 无任务时完全隐藏
 */

import { useEffect, useState } from "react";
import {
  useDownloadStore,
  formatSpeed,
  formatETA,
  formatBytes,
  type DownloadTaskItem,
} from "@/stores/download-store";
import {
  Download,
  ChevronDown,
  X,
  RefreshCw,
  Image as ImageIcon,
  Video,
  FileText,
  File,
  Check,
  AlertCircle,
  Trash2,
} from "lucide-react";

// ============ 子组件 ============

/** 环形进度条 SVG */
function CircularProgress({ progress, size = 48, strokeWidth = 3 }: {
  progress: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={strokeWidth}
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="url(#progressGradient)"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-300"
      />
      <defs>
        <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00F2EA" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** 单个任务项 */
function TaskItem({ task }: { task: DownloadTaskItem }) {
  const cancelTask = useDownloadStore(s => s.cancelTask);
  const retryTask = useDownloadStore(s => s.retryTask);

  const TypeIcon = task.type === "image" ? ImageIcon : task.type === "video" ? Video : File;

  // 状态信息
  let statusText = "";
  let statusColor = "text-white/50";

  switch (task.status) {
    case "queued":
      statusText = "排队中...";
      statusColor = "text-white/40";
      break;
    case "downloading": {
      const parts: string[] = [];
      if (task.total > 0) parts.push(`${task.progress}%`);
      else if (task.loaded > 0) parts.push(formatBytes(task.loaded));
      if (task.speed > 0) parts.push(formatSpeed(task.speed));
      if (task.total > 0 && task.speed > 0) {
        const remaining = (task.total - task.loaded) / task.speed;
        const eta = formatETA(remaining);
        if (eta) parts.push(`剩余 ${eta}`);
      }
      statusText = parts.join(" · ") || "下载中...";
      statusColor = "text-cyan-400";
      break;
    }
    case "completed":
      statusText = "✓ 完成";
      statusColor = "text-emerald-400";
      break;
    case "failed":
      statusText = task.error || "下载失败";
      statusColor = "text-red-400";
      break;
    case "cancelled":
      statusText = "已取消";
      statusColor = "text-white/30";
      break;
  }

  // 截断文件名
  const displayName = task.filename.length > 24
    ? task.filename.slice(0, 21) + "..."
    : task.filename;

  return (
    <div className="px-4 py-3 hover:bg-white/5 transition-colors">
      <div className="flex items-center gap-3">
        {/* 类型图标 */}
        <TypeIcon className={`w-4 h-4 flex-shrink-0 ${
          task.status === "completed" ? "text-emerald-400" :
          task.status === "failed" ? "text-red-400" :
          "text-white/50"
        }`} />

        {/* 文件名和状态 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/80 truncate" title={task.filename}>
            {displayName}
          </p>
          <p className={`text-xs mt-0.5 ${statusColor}`}>
            {statusText}
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex-shrink-0">
          {(task.status === "downloading" || task.status === "queued") && (
            <button
              onClick={(e) => { e.stopPropagation(); cancelTask(task.id); }}
              className="p-1 rounded-full hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
              title="取消下载"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {(task.status === "failed" || task.status === "cancelled") && (
            <button
              onClick={(e) => { e.stopPropagation(); retryTask(task.id); }}
              className="p-1 rounded-full hover:bg-white/10 text-white/40 hover:text-cyan-400 transition-colors"
              title="重试"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {task.status === "completed" && (
            <Check className="w-4 h-4 text-emerald-400" />
          )}
        </div>
      </div>

      {/* 进度条 */}
      {(task.status === "downloading" || task.status === "queued") && (
        <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${task.progress}%`,
              background: "linear-gradient(90deg, #00F2EA, #EC4899)",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ============ 主组件 ============

export function DownloadWidget() {
  const tasks = useDownloadStore(s => s.tasks);
  const isExpanded = useDownloadStore(s => s.isExpanded);
  const toggleExpand = useDownloadStore(s => s.toggleExpand);
  const clearCompleted = useDownloadStore(s => s.clearCompleted);
  const exportTxt = useDownloadStore(s => s.exportTxt);

  const [isVisible, setIsVisible] = useState(false);

  // 有任务时显示，无任务时隐藏
  useEffect(() => {
    if (tasks.length > 0) {
      setIsVisible(true);
    } else {
      // 延迟隐藏（等待动画）
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [tasks.length]);

  // 无任务时不渲染
  if (!isVisible && tasks.length === 0) return null;

  // 统计
  const activeTasks = tasks.filter(t => t.status === "downloading" || t.status === "queued");
  const completedTasks = tasks.filter(t => t.status === "completed");
  const failedTasks = tasks.filter(t => t.status === "failed");
  const totalProgress = tasks.length > 0
    ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length)
    : 0;

  // ========== 折叠态 ==========
  if (!isExpanded) {
    return (
      <button
        onClick={toggleExpand}
        className={`
          fixed bottom-6 right-6 z-50
          w-14 h-14 rounded-full
          bg-[#0B0C10]/90 backdrop-blur-xl
          border border-white/10
          shadow-2xl shadow-black/50
          flex items-center justify-center
          hover:border-white/20 hover:scale-105
          transition-all duration-300
          ${tasks.length > 0 ? "animate-in slide-in-from-bottom-2" : "animate-out slide-out-to-bottom-2"}
        `}
        title="下载管理"
      >
        {/* 环形进度 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <CircularProgress progress={totalProgress} size={56} strokeWidth={2.5} />
        </div>

        {/* 下载图标 */}
        <Download className="w-5 h-5 text-white/70" />

        {/* 任务数角标 */}
        {activeTasks.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-pink-500 text-white text-xs font-bold flex items-center justify-center">
            {activeTasks.length}
          </span>
        )}

        {/* 全部完成指示 */}
        {activeTasks.length === 0 && completedTasks.length > 0 && failedTasks.length === 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center">
            <Check className="w-3 h-3" />
          </span>
        )}

        {/* 有失败指示 */}
        {failedTasks.length > 0 && activeTasks.length === 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center">
            <AlertCircle className="w-3 h-3" />
          </span>
        )}
      </button>
    );
  }

  // ========== 展开态 ==========
  return (
    <div
      className={`
        fixed bottom-6 right-6 z-50
        w-[340px] max-h-[460px]
        bg-[#0B0C10]/95 backdrop-blur-2xl
        border border-white/10
        rounded-2xl
        shadow-2xl shadow-black/60
        flex flex-col
        animate-in slide-in-from-bottom-2 duration-300
      `}
    >
      {/* 标题栏 — 整个可点击折叠 */}
      <div
        onClick={toggleExpand}
        className="flex items-center justify-between px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-white/90">下载管理</span>
          <span className="text-xs text-white/40">
            {activeTasks.length > 0
              ? `${activeTasks.length} 进行中`
              : `${tasks.length} 个任务`
            }
          </span>
        </div>
        <ChevronDown className="w-4 h-4 text-white/40" />
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-white/5">
        {tasks.length === 0 ? (
          <div className="py-8 text-center text-white/30 text-sm">
            暂无下载任务
          </div>
        ) : (
          tasks.map(task => (
            <TaskItem key={task.id} task={task} />
          ))
        )}
      </div>

      {/* 底部操作栏 */}
      {tasks.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/5">
          <button
            onClick={exportTxt}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                       border border-white/10 text-xs text-white/60
                       hover:bg-white/5 hover:text-white/90 hover:border-white/20
                       transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            导出地址 (TXT)
          </button>
          <button
            onClick={clearCompleted}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                       text-xs text-white/40
                       hover:bg-white/5 hover:text-white/70
                       transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            清除已完成
          </button>
        </div>
      )}
    </div>
  );
}
