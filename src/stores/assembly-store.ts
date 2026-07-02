/**
 * Assembly Store - Studio 拼装口播腿任务状态(S3.1)
 *
 * 一个 job = 蓝图的 N 个 scene 子任务(每镜 素材图+台词 TTS+字幕 → 单镜段)
 * → 全部完成后 stitch 成一条成片。结构镜像 ai-gen store(S2.3),差异:
 * scene 渲染是同步长请求(无上游任务号轮询),幂等靠服务端内容寻址 OSS 对象
 * (同参重放直接命中缓存零扣费),故 scene 无恢复锚点字段——复水后 pending
 * 重放是安全的。
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// ============================================================================
// 类型
// ============================================================================

export type AssemblySceneStatus = "pending" | "generating" | "completed" | "failed";

export interface AssemblySceneTask {
  idx: number;
  /** 台词(TTS 口播文本;适配器已保证非空) */
  line: string;
  /** 该镜素材图(自有 OSS URL) */
  imageUrl: string;
  /** 服务端流水锚 = `${jobId}-s${idx}`(credit_transactions.task_id) */
  clientTaskId: string;
  /** 该镜成片(OSS 永久址,scene 渲染端点返回) */
  videoUrl: string | null;
  status: AssemblySceneStatus;
  errorMessage?: string | null;
}

export type AssemblyTaskStatus =
  | "pending"
  | "generating"
  | "stitching"
  | "completed"
  | "failed";

export interface AssemblyTask {
  id: string; // asm-*
  groupName: string;
  batchId?: string;
  blueprintId?: string;
  /** 商品标题(卡片回显 + stitch 落库 prompt) */
  title: string;
  aspectRatio: "9:16" | "16:9";
  /** 每镜基准秒数(TTS 超长时服务端自动延长) */
  durationPerImage: number;
  kenburns: boolean;
  /** 全片统一音色(适配器选定即持久化,刷新恢复声线一致) */
  voiceId: string;
  scenes: AssemblySceneTask[];
  /** 拼接成片(最终交付物;generations.task_id = job id) */
  stitchedUrl: string | null;
  status: AssemblyTaskStatus;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// State + Actions
// ============================================================================

export interface AssemblyState {
  tasks: AssemblyTask[];
}

export interface AssemblyActions {
  addTasks: (tasks: AssemblyTask[]) => void;
  updateTask: (
    id: string,
    patch: Partial<
      Pick<AssemblyTask, "status" | "progress" | "errorMessage" | "stitchedUrl">
    >
  ) => void;
  updateScene: (
    taskId: string,
    sceneIdx: number,
    patch: Partial<Pick<AssemblySceneTask, "status" | "videoUrl" | "errorMessage">>
  ) => void;
  /** 失败重试:只复位失败的 scene(成功镜保留成片与扣费,不重渲染) */
  retryTask: (id: string) => void;
  removeTask: (id: string) => void;
}

const initialState: AssemblyState = {
  tasks: [],
};

/** 任务保留上限(批次卡通过 jobRefs 引用,裁掉的显示「记录已清理」) */
const MAX_TASKS = 200;

// ============================================================================
// Store
// ============================================================================

export const useAssemblyStore = create<AssemblyState & AssemblyActions>()(
  persist(
    devtools(
      immer((set) => ({
        ...initialState,

        addTasks: (newTasks) => {
          set((state) => {
            state.tasks.push(...newTasks);
            if (state.tasks.length > MAX_TASKS) {
              // 只裁终态旧任务(同 ai-gen store):裁掉执行中的 job 会让
              // 已扣费的镜变孤儿,非终态挤爆上限时宁可暂时超额
              let excess = state.tasks.length - MAX_TASKS;
              const keep: AssemblyTask[] = [];
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
            // 终态不可降级(S0.6 守卫同款)
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
                // 重放安全:服务端按内容寻址幂等,实际已渲染的镜命中缓存零扣费
                scene.status = "pending";
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
      { name: "AssemblyStore" }
    ),
    {
      name: "assembly-tasks-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tasks: state.tasks }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 刷新打断的在途 job 归一化回 pending:scene 渲染服务端幂等,重放
        // 命中缓存零扣费;stitching 会因 scenes 全 completed 直接重进 stitch
        // (stitch 路由按 task_id 幂等)。
        const interrupted = (state.tasks ?? []).some(
          (t) => t.status === "generating" || t.status === "stitching"
        );
        if (interrupted) {
          // 同步 storage 的水合在 create() 内同步执行,此时 useAssemblyStore
          // 常量仍处于 TDZ——必须延迟到模块求值完成后再 setState(S1.2 教训)
          setTimeout(() => {
            useAssemblyStore.setState({
              tasks: useAssemblyStore.getState().tasks.map((t) =>
                t.status === "generating" || t.status === "stitching"
                  ? {
                      ...t,
                      status: "pending" as const,
                      scenes: t.scenes.map((s) =>
                        s.status === "generating"
                          ? { ...s, status: "pending" as const }
                          : s
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

export const useAssemblyTasks = () => useAssemblyStore((s) => s.tasks);
