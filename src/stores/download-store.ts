/**
 * 下载管理 Store — 全局下载状态管理
 * 
 * 功能:
 * - 统一的下载入口（所有页面共用）
 * - 并发控制（最多 3 个同时下载）
 * - 每个任务独立的 AbortController
 * - 速度计算和进度追踪
 * - 导出 TXT 下载地址列表
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  smartDownload,
  triggerBrowserDownload,
  ensureFileExtension,
  type SmartDownloadOptions,
} from "@/lib/download-manager";

// ============ 类型定义 ============

export type DownloadTaskStatus = "queued" | "downloading" | "completed" | "failed" | "cancelled";

export interface DownloadTaskItem {
  id: string;
  url: string;
  filename: string;
  type: "image" | "video" | "other";
  status: DownloadTaskStatus;
  progress: number;        // 0-100
  loaded: number;          // 已下载字节
  total: number;           // 总字节
  speed: number;           // 字节/秒
  error?: string;
  startTime: number;
  // AbortController 不存在 store state 中（不可序列化），存在外部 Map 里
}

interface DownloadStoreState {
  tasks: DownloadTaskItem[];
  isExpanded: boolean;
  maxConcurrent: number;

  // 操作
  download: (url: string, filename: string, type?: "image" | "video" | "other") => void;
  batchDownload: (items: { url: string; filename: string; type?: "image" | "video" | "other" }[]) => void;
  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
  clearCompleted: () => void;
  toggleExpand: () => void;
  setExpanded: (expanded: boolean) => void;
  exportTxt: () => void;
}

// ============ 外部状态（非序列化） ============

// AbortController 不能放进 Zustand state（不可序列化），用外部 Map 管理
const abortControllers = new Map<string, AbortController>();
// 上次进度快照（用于计算速度）
const lastProgressSnap = new Map<string, { loaded: number; time: number }>();

// ============ 内部辅助 ============

let idCounter = 0;
function generateId(): string {
  return `dl_${Date.now()}_${++idCounter}`;
}

/**
 * 从文件名推断文件类型
 */
function inferType(filename: string): "image" | "video" | "other" {
  const ext = filename.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  if (!ext) return "other";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "avi"].includes(ext)) return "video";
  return "other";
}

/**
 * 格式化文件大小
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * 格式化速度
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * 格式化 ETA
 */
export function formatETA(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return "";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m${secs}s`;
}

// ============ Store ============

export const useDownloadStore = create<DownloadStoreState>()(
  devtools(
    immer((set, get) => {

      // 尝试启动队列中的下一个任务
      function tryStartNext() {
        const state = get();
        const activeCount = state.tasks.filter(t => t.status === "downloading").length;
        const queued = state.tasks.find(t => t.status === "queued");

        if (activeCount < state.maxConcurrent && queued) {
          executeTask(queued.id);
        }
      }

      // 自动折叠计时器
      let autoCollapseTimer: ReturnType<typeof setTimeout> | null = null;
      function checkAutoCollapse() {
        const state = get();
        const hasActive = state.tasks.some(t => t.status === "downloading" || t.status === "queued");
        if (!hasActive && state.tasks.length > 0) {
          // 全部完成，5 秒后自动折叠
          if (autoCollapseTimer) clearTimeout(autoCollapseTimer);
          autoCollapseTimer = setTimeout(() => {
            set(draft => { draft.isExpanded = false; });
          }, 5000);
        }
      }

      // 执行单个下载任务
      async function executeTask(taskId: string) {
        const task = get().tasks.find(t => t.id === taskId);
        if (!task) return;

        // 创建 AbortController
        const controller = new AbortController();
        abortControllers.set(taskId, controller);
        lastProgressSnap.set(taskId, { loaded: 0, time: Date.now() });

        // 更新状态为 downloading
        set(draft => {
          const t = draft.tasks.find(t => t.id === taskId);
          if (t) {
            t.status = "downloading";
            t.progress = 0;
            t.loaded = 0;
            t.total = 0;
            t.speed = 0;
            t.error = undefined;
            t.startTime = Date.now();
          }
        });

        try {
          const options: SmartDownloadOptions = {
            signal: controller.signal,
            returnBlob: true,
            onProgress: (loaded: number, total: number) => {
              // 计算速度
              const snap = lastProgressSnap.get(taskId);
              const now = Date.now();
              let speed = 0;

              if (snap && now - snap.time > 200) { // 每 200ms 更新一次速度
                const bytesDiff = loaded - snap.loaded;
                const timeDiff = (now - snap.time) / 1000;
                speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
                lastProgressSnap.set(taskId, { loaded, time: now });
              }

              const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;

              set(draft => {
                const t = draft.tasks.find(t => t.id === taskId);
                if (t) {
                  t.loaded = loaded;
                  t.total = total;
                  t.progress = progress;
                  if (speed > 0) t.speed = speed;
                }
              });
            },
          };

          const result = await smartDownload(task.url, task.filename, options);

          if (result.success && result.blob) {
            // 修正文件扩展名
            const correctedFilename = ensureFileExtension(task.filename, task.url);
            triggerBrowserDownload(result.blob, correctedFilename);

            set(draft => {
              const t = draft.tasks.find(t => t.id === taskId);
              if (t) {
                t.status = "completed";
                t.progress = 100;
                t.filename = correctedFilename;
              }
            });
          } else {
            // 检查是否是用户取消
            if (controller.signal.aborted) {
              set(draft => {
                const t = draft.tasks.find(t => t.id === taskId);
                if (t) t.status = "cancelled";
              });
            } else {
              set(draft => {
                const t = draft.tasks.find(t => t.id === taskId);
                if (t) {
                  t.status = "failed";
                  t.error = "下载失败，已重试 3 次";
                }
              });
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            set(draft => {
              const t = draft.tasks.find(t => t.id === taskId);
              if (t) {
                t.status = "failed";
                t.error = error instanceof Error ? error.message : "下载失败";
              }
            });
          }
        } finally {
          abortControllers.delete(taskId);
          lastProgressSnap.delete(taskId);

          // 启动下一个排队任务
          tryStartNext();
          // 检查是否需要自动折叠
          checkAutoCollapse();
        }
      }

      return {
        tasks: [],
        isExpanded: false,
        maxConcurrent: 3,

        download: (url, filename, type) => {
          const taskType = type || inferType(filename);
          const task: DownloadTaskItem = {
            id: generateId(),
            url,
            filename,
            type: taskType,
            status: "queued",
            progress: 0,
            loaded: 0,
            total: 0,
            speed: 0,
            startTime: Date.now(),
          };

          set(draft => {
            draft.tasks.push(task);
          });

          // 清除自动折叠计时器
          if (autoCollapseTimer) {
            clearTimeout(autoCollapseTimer);
            autoCollapseTimer = null;
          }

          // 尝试立即执行
          const state = get();
          const activeCount = state.tasks.filter(t => t.status === "downloading").length;
          if (activeCount < state.maxConcurrent) {
            executeTask(task.id);
          }
        },

        batchDownload: (items) => {
          for (const item of items) {
            get().download(item.url, item.filename, item.type);
          }
        },

        cancelTask: (id) => {
          const controller = abortControllers.get(id);
          if (controller) {
            controller.abort();
          }
          set(draft => {
            const task = draft.tasks.find(t => t.id === id);
            if (task && (task.status === "downloading" || task.status === "queued")) {
              task.status = "cancelled";
            }
          });
          abortControllers.delete(id);
          lastProgressSnap.delete(id);

          // 启动下一个排队任务
          tryStartNext();
        },

        retryTask: (id) => {
          const task = get().tasks.find(t => t.id === id);
          if (task && (task.status === "failed" || task.status === "cancelled")) {
            set(draft => {
              const t = draft.tasks.find(t => t.id === id);
              if (t) {
                t.status = "queued";
                t.progress = 0;
                t.loaded = 0;
                t.total = 0;
                t.speed = 0;
                t.error = undefined;
              }
            });

            // 尝试立即执行
            const state = get();
            const activeCount = state.tasks.filter(t => t.status === "downloading").length;
            if (activeCount < state.maxConcurrent) {
              executeTask(id);
            }
          }
        },

        clearCompleted: () => {
          set(draft => {
            draft.tasks = draft.tasks.filter(
              t => t.status === "queued" || t.status === "downloading"
            );
          });
        },

        toggleExpand: () => {
          set(draft => { draft.isExpanded = !draft.isExpanded; });
        },

        setExpanded: (expanded) => {
          set(draft => { draft.isExpanded = expanded; });
        },

        exportTxt: () => {
          const { tasks } = get();
          if (tasks.length === 0) return;

          const lines = tasks.map(t => t.url);
          const content = lines.join("\n");
          const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);

          const link = document.createElement("a");
          link.href = url;
          link.download = `download_urls_${new Date().toISOString().slice(0, 16).replace(":", "-")}.txt`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
      };
    }),
    { name: "download-store" }
  )
);
