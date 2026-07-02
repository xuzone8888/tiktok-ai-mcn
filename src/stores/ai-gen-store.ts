/**
 * AI Gen Store - Studio AI 生成腿任务状态(S2.3)
 *
 * 一个 job = 蓝图的 N 个 scene 子任务 → 全部完成后 stitch 成一条成片。
 * scene 内嵌数组而非独立 VideoBatchTask:video-batch store 的状态白名单与
 * 复水重置逻辑不认识 scene/stitch 语义,内嵌改动面最小(S2 侦查结论)。
 *
 * 恢复锚点:scene.upstreamTaskId 拿到即持久化——刷新后 BTM 执行器对带锚点的
 * scene 只续轮询不重提交(防双扣费,同 S1.1 视频执行器的 soraTaskId 模式)。
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type {
  VideoAspectRatio,
  VideoDuration,
  VideoModelType,
  VideoQuality,
} from "@/types/video-batch";

// ============================================================================
// 类型
// ============================================================================

export type AiGenSceneStatus = "pending" | "generating" | "completed" | "failed";

export interface AiGenSceneTask {
  idx: number;
  /** 逐镜编译好的英文提示词(ai-gen-prompts,提交前已定) */
  prompt: string;
  /** 该镜素材图(image_to_video 输入;无图走 prompt_to_video) */
  imageUrl?: string;
  /** 提交体 clientTaskId = `${jobId}-s${idx}` */
  clientTaskId: string;
  /** 上游任务号(恢复锚点:非空表示已提交已扣费,只续轮询) */
  upstreamTaskId: string | null;
  /** 该镜成片(OSS 永久址,models/status 完成时转存) */
  videoUrl: string | null;
  status: AiGenSceneStatus;
  errorMessage?: string | null;
}

export type AiGenTaskStatus = "pending" | "generating" | "stitching" | "completed" | "failed";

export interface AiGenTask {
  id: string; // ag-*
  groupName: string;
  batchId?: string;
  blueprintId?: string;
  /** 商品标题(卡片回显 + stitch 落库 prompt) */
  title: string;
  modelType: VideoModelType;
  aspectRatio: VideoAspectRatio;
  durationSeconds: VideoDuration;
  quality: VideoQuality;
  scenes: AiGenSceneTask[];
  /** 拼接成片(最终交付物;generations.task_id = job id) */
  stitchedUrl: string | null;
  status: AiGenTaskStatus;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// State + Actions
// ============================================================================

export interface AiGenState {
  tasks: AiGenTask[];
}

export interface AiGenActions {
  addTasks: (tasks: AiGenTask[]) => void;
  updateTask: (
    id: string,
    patch: Partial<
      Pick<AiGenTask, "status" | "progress" | "errorMessage" | "stitchedUrl">
    >
  ) => void;
  updateScene: (
    taskId: string,
    sceneIdx: number,
    patch: Partial<
      Pick<AiGenSceneTask, "status" | "upstreamTaskId" | "videoUrl" | "errorMessage">
    >
  ) => void;
  /** 失败重试:只复位失败的 scene(成功镜保留成片与扣费,不重生成) */
  retryTask: (id: string) => void;
  removeTask: (id: string) => void;
}

const initialState: AiGenState = {
  tasks: [],
};

/** 任务保留上限(批次卡通过 jobRefs 引用,裁掉的显示「记录已清理」) */
const MAX_TASKS = 200;

// ============================================================================
// Store
// ============================================================================

export const useAiGenStore = create<AiGenState & AiGenActions>()(
  persist(
    devtools(
      immer((set) => ({
        ...initialState,

        addTasks: (newTasks) => {
          set((state) => {
            state.tasks.push(...newTasks);
            if (state.tasks.length > MAX_TASKS) {
              // 只裁终态旧任务:裁掉执行中/排队中的 job 会让已扣费的镜变孤儿
              // (执行器的任务消失守卫是兜底,这里从源头不裁非终态;
              // 非终态任务挤爆上限时宁可暂时超额)
              let excess = state.tasks.length - MAX_TASKS;
              const keep: AiGenTask[] = [];
              for (const t of state.tasks) {
                if (excess > 0 && (t.status === "completed" || t.status === "failed")) {
                  excess--;
                  continue;
                }
                keep.push(t);
              }
              state.tasks = keep;
            }
          });
        },

        updateTask: (id, patch) => {
          set((state) => {
            const task = state.tasks.find((t) => t.id === id);
            if (!task) return;
            // 终态不可降级:completed/failed 之后到达的异状态更新一律忽略
            // (S0.6 守卫同款;stitch 响应与轮询迟到写入防互踩)
            if (
              (task.status === "completed" || task.status === "failed") &&
              patch.status &&
              patch.status !== task.status
            ) {
              return;
            }
            Object.assign(task, patch);
            task.updatedAt = new Date().toISOString();
          });
        },

        updateScene: (taskId, sceneIdx, patch) => {
          set((state) => {
            const task = state.tasks.find((t) => t.id === taskId);
            const scene = task?.scenes.find((s) => s.idx === sceneIdx);
            if (!task || !scene) return;
            if (
              (scene.status === "completed" || scene.status === "failed") &&
              patch.status &&
              patch.status !== scene.status
            ) {
              return;
            }
            Object.assign(scene, patch);
            task.updatedAt = new Date().toISOString();
          });
        },

        retryTask: (id) => {
          set((state) => {
            const task = state.tasks.find((t) => t.id === id);
            if (!task || task.status !== "failed") return;
            task.scenes.forEach((scene) => {
              if (scene.status === "failed") {
                scene.status = "pending";
                // 锚点保留:超时失败的镜重试时只续轮询(上游可能已成,重提交
                // 会双扣费);上游明确失败(已退款)的镜其锚点已被执行器清空,
                // 此处自然走重提交。
                scene.errorMessage = null;
              }
            });
            task.status = "pending";
            task.errorMessage = null;
            task.progress = 0;
            task.updatedAt = new Date().toISOString();
          });
        },

        removeTask: (id) => {
          set((state) => {
            state.tasks = state.tasks.filter((t) => t.id !== id);
          });
        },
      })),
      { name: "AiGenStore" }
    ),
    {
      name: "ai-gen-tasks-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tasks: state.tasks }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 刷新打断的在途 job 归一化回 pending:执行器按恢复锚点续跑
        // (带 upstreamTaskId 的 scene 只续轮询;stitching 会因 scenes 全 completed
        // 直接进 stitch,stitch 路由按 task_id 幂等)。
        const interrupted = (state.tasks ?? []).some(
          (t) => t.status === "generating" || t.status === "stitching"
        );
        if (interrupted) {
          // 同步 storage 的水合在 create() 内同步执行,此时 useAiGenStore 常量
          // 仍处于 TDZ——必须延迟到模块求值完成后再 setState(S1.2 既有教训)
          setTimeout(() => {
            useAiGenStore.setState({
              tasks: useAiGenStore.getState().tasks.map((t) =>
                t.status === "generating" || t.status === "stitching"
                  ? {
                      ...t,
                      status: "pending" as const,
                      scenes: t.scenes.map((s) =>
                        s.status === "generating" ? { ...s, status: "pending" as const } : s
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : t
              ),
            });
          }, 0);
        }
      },
    }
  )
);

export const useAiGenTasks = () => useAiGenStore((s) => s.tasks);
