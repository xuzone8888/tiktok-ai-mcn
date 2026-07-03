/**
 * Photo Post Store - Studio 图文帖腿任务状态(S4.1)
 *
 * 一个任务 = 一条图文帖变体(≤10 张素材图的一个图序 + 一条 AI 文案)。
 * 与其他腿的差异:生成是一次同步 API 调用(服务端 LLM 出文案 + 落库),
 * 无上游任务号轮询,故无 BTM 执行器——提交层直接 fetch 并写回本 store。
 * 幂等:generations.task_id = 本地任务 id,重试/刷新重放命中已落库行零成本。
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// ============================================================================
// 类型
// ============================================================================

export type PhotoPostTaskStatus = "generating" | "completed" | "failed";

export interface PhotoPostTask {
  id: string; // pp-*(= generations.task_id)
  groupName: string;
  batchId?: string;
  blueprintId?: string;
  /** 商品标题(卡片回显 + 落库 spec.title) */
  title: string;
  /** 本变体图序(素材级去同质化:适配器洗牌后固定,重试不重洗) */
  imageUrls: string[];
  /** 发布文案(服务端 LLM 生成后写回) */
  caption: string | null;
  /** 矩阵 hook 文案(作为文案开头行,服务端拼接) */
  hookText?: string;
  /** 批量矩阵变体快照(S3.4 同款;落库 spec.variant。形状与 job-spec VariantInfo 一致,内联避免 store↔lib 循环引用) */
  variant?: { hook_id?: string; hook_text?: string; voice_id?: string; aspect?: string };
  status: PhotoPostTaskStatus;
  errorMessage: string | null;
  /**
   * 直发在途锚(S4.2 审查实锤):发布状态原本只活在组件轮询里,关抽屉/切任务/
   * 刷新即丢,TikTok 实际发布成功但 published 永不落本地→诱导重复发帖。
   * POST 起飞即持久化,组件重挂载时按锚恢复轮询;完成/明确失败后清空。
   */
  publish?: { accountId: string; publishId: string; startedAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// State + Actions
// ============================================================================

export interface PhotoPostState {
  tasks: PhotoPostTask[];
}

export interface PhotoPostActions {
  addTasks: (tasks: PhotoPostTask[]) => void;
  updateTask: (
    id: string,
    patch: Partial<Pick<PhotoPostTask, "status" | "caption" | "errorMessage" | "publish">>
  ) => void;
  /** 失败重试:复位回 generating(服务端按 task_id 幂等,已落库变体直接命中) */
  retryTask: (id: string) => void;
  removeTask: (id: string) => void;
}

const initialState: PhotoPostState = {
  tasks: [],
};

/** 任务保留上限(批次卡通过 jobRefs 引用,裁掉的显示「记录已清理」) */
const MAX_TASKS = 300;

// ============================================================================
// Store
// ============================================================================

export const usePhotoPostStore = create<PhotoPostState & PhotoPostActions>()(
  persist(
    devtools(
      immer((set) => ({
        ...initialState,

        addTasks: (newTasks) => {
          set((state) => {
            state.tasks.push(...newTasks);
            if (state.tasks.length > MAX_TASKS) {
              // 只裁终态旧任务(同 ai-gen/assembly store 口径)
              let excess = state.tasks.length - MAX_TASKS;
              const keep: PhotoPostTask[] = [];
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
            // 终态不可降级(S0.6 守卫同款);显式重试走 retryTask
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

        retryTask: (id) => {
          set((state) => {
            const task = state.tasks.find((t) => t.id === id);
            if (!task || task.status !== "failed") return;
            task.status = "generating";
            task.errorMessage = null;
            task.updatedAt = new Date().toISOString();
          });
        },

        removeTask: (id) => {
          set((state) => {
            state.tasks = state.tasks.filter((t) => t.id !== id);
          });
        },
      })),
      { name: "PhotoPostStore" }
    ),
    {
      name: "photo-post-tasks-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tasks: state.tasks }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 刷新打断的在途任务判失败(在途 fetch 已丢,无人写回)。重试安全:
        // 服务端已落库的变体按 task_id 幂等命中,未落库的重新生成,均零重复成本
        const interrupted = (state.tasks ?? []).some((t) => t.status === "generating");
        if (interrupted) {
          // 同步 storage 水合在 create() 内同步执行,store 常量仍处 TDZ——
          // 必须延迟到模块求值完成后再 setState(S1.2 教训)
          setTimeout(() => {
            usePhotoPostStore.setState({
              tasks: usePhotoPostStore.getState().tasks.map((t) =>
                t.status === "generating"
                  ? {
                      ...t,
                      status: "failed" as const,
                      errorMessage: "页面刷新中断,点击重试恢复(不重复生成已完成的)",
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

export const usePhotoPostTasks = () => usePhotoPostStore((s) => s.tasks);
