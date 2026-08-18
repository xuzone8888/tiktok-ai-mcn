/**
 * Slideshow Store - 图片转视频 (成片) 状态管理
 * 
 * 管理批量图片转视频任务队列的全部状态
 * 
 * 特性：
 * - 使用 persist 中间件持久化到 localStorage
 * - 使用 immer 中间件简化不可变更新
 * - 页面刷新/切换时任务不会丢失
 * - 支持选择管理、分组、重试
 */

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// ============================================================================
// 类型定义
// ============================================================================

/** 任务状态 */
export type SlideshowTaskStatus =
    | "pending"      // 等待中
    | "uploading"    // 上传图片中
    | "generating"   // FFmpeg 合成中（含 AI 文案/配音/合成各阶段）
    | "completed"    // 已完成
    | "failed";      // 失败

/** 生成阶段（SSE 进度用） */
export type SlideshowStage =
    | "uploading"    // 上传图片到 OSS
    | "caption"      // AI 文案生成
    | "voiceover"    // AI 配音生成
    | "composing"    // FFmpeg 合成视频
    | "uploading_oss"; // 上传成品到 OSS

/** 单个任务 */
export interface SlideshowTask {
    id: string;
    /** 任务组名 - 每次「新建成片」生成一组 */
    groupName: string;
    /** 模式 */
    mode: "random" | "position";
    /** 状态 */
    status: SlideshowTaskStatus;
    /** 当前阶段 */
    stage?: SlideshowStage;
    /** 进度 0-100 */
    progress: number;
    /** 图片数量 */
    imageCount: number;
    /** 每张停留时长 */
    duration: number;
    /** 转场效果 */
    transition: string;
    /** 画面比例 */
    aspectRatio?: "9:16" | "16:9";
    /** 视频输出 URL */
    outputUrl?: string;
    /** 所有视频 URL（批量时） */
    outputUrls?: string[];
    /** 缩略图 */
    thumbnailUrl?: string;
    /** 视频数量 */
    videoCount?: number;
    /** 错误信息 */
    errorMessage?: string;
    /** 是否有配音 */
    hasVoice?: boolean;
    /** 是否有 BGM */
    hasBgm?: boolean;
    /** 是否有字幕 */
    hasSubtitle?: boolean;
    /** 原始提交参数（用于重试） */
    originalConfig?: Record<string, unknown>;
    /**
     * Studio 渲染腿(S1.2):BTM 幻灯片执行器的请求快照
     * (POST /api/video-batch/generate-slideshow 的完整 body)。
     * 旧 image-slideshow 页任务无此字段,不会被 BTM 执行器拉起。
     */
    renderRequest?: Record<string, unknown>;
    /** Studio 批次 ID */
    batchId?: string;
    /** 创建时间 */
    createdAt: string;
    /** 更新时间 */
    updatedAt: string;
}

// ============================================================================
// State + Actions 接口
// ============================================================================

export interface SlideshowState {
    /** 任务列表 */
    tasks: SlideshowTask[];
    /** 选中的任务 ID */
    selectedTaskIds: Record<string, boolean>;
    /** 当前激活的任务组名 */
    activeGroupName: string | null;
}

export interface SlideshowActions {
    // ==================== 任务管理 ====================

    /** 批量添加任务 */
    addTasks: (tasks: SlideshowTask[]) => void;

    /** 更新任务状态 */
    updateTaskStatus: (
        id: string,
        status: SlideshowTaskStatus,
        extra?: Partial<Pick<SlideshowTask,
            "stage" | "progress" | "errorMessage" |
            "outputUrl" | "outputUrls" | "videoCount" | "thumbnailUrl"
        >>
    ) => void;

    /** 批量更新同组任务状态（同一 baseTaskId 前缀） */
    updateGroupTaskStatus: (
        baseTaskId: string,
        status: SlideshowTaskStatus,
        extra?: Partial<Pick<SlideshowTask, "stage" | "progress" | "errorMessage">>
    ) => void;

    /** 完成某个视频（按 index 更新） */
    completeVideoByIndex: (
        baseTaskId: string,
        videoIndex: number,
        videoUrl: string
    ) => void;

    /** 删除任务 */
    removeTask: (id: string) => void;

    /** 批量删除任务 */
    removeTasks: (ids: string[]) => void;

    /** 清空任务（可选：仅指定组） */
    clearAllTasks: (groupName?: string) => void;

    /** 重试失败任务 */
    retryTask: (id: string) => void;

    // ==================== 选择管理 ====================

    /** 切换选中状态 */
    toggleSelection: (id: string) => void;

    /** 全选/取消全选（可选：仅指定组） */
    selectAll: (selected: boolean, groupName?: string) => void;

    /** 清空选择 */
    clearSelection: () => void;

    /** 删除选中的任务 */
    removeSelected: () => void;

    // ==================== 任务组管理 ====================

    /** 设置激活的任务组 */
    setActiveGroup: (groupName: string | null) => void;

    /** 删除整组（含所有任务） */
    removeGroup: (groupName: string) => void;

    /** 获取所有任务组信息 */
    getGroups: () => Array<{
        name: string;
        count: number;
        completed: number;
        failed: number;
        createdAt: string;
    }>;

    /** 获取当前组的任务列表 */
    getActiveGroupTasks: () => SlideshowTask[];

    /** 获取当前组的统计信息 */
    getActiveGroupStats: () => {
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    };
}

// ============================================================================
// 初始状态
// ============================================================================

const initialState: SlideshowState = {
    tasks: [],
    selectedTaskIds: {},
    activeGroupName: null,
};

// ============================================================================
// Store
// ============================================================================

export const useSlideshowStore = create<SlideshowState & SlideshowActions>()(
    persist(
        devtools(
            immer((set, get) => ({
                ...initialState,

                // ==================== 任务管理 ====================

                addTasks: (newTasks) => {
                    set((state) => {
                        state.tasks.push(...newTasks);
                    });
                },

                updateTaskStatus: (id, status, extra) => {
                    set((state) => {
                        const task = state.tasks.find((t) => t.id === id);
                        if (task) {
                            task.status = status;
                            task.updatedAt = new Date().toISOString();
                            if (extra) {
                                if (extra.stage !== undefined) task.stage = extra.stage;
                                if (extra.progress !== undefined) task.progress = extra.progress;
                                if (extra.errorMessage !== undefined) task.errorMessage = extra.errorMessage;
                                if (extra.outputUrl !== undefined) task.outputUrl = extra.outputUrl;
                                if (extra.outputUrls !== undefined) task.outputUrls = extra.outputUrls;
                                if (extra.videoCount !== undefined) task.videoCount = extra.videoCount;
                                if (extra.thumbnailUrl !== undefined) task.thumbnailUrl = extra.thumbnailUrl;
                            }
                        }
                    });
                },

                updateGroupTaskStatus: (baseTaskId, status, extra) => {
                    set((state) => {
                        state.tasks.forEach((task) => {
                            if (task.id.startsWith(baseTaskId)) {
                                task.status = status;
                                task.updatedAt = new Date().toISOString();
                                if (extra) {
                                    if (extra.stage !== undefined) task.stage = extra.stage;
                                    if (extra.progress !== undefined) task.progress = extra.progress;
                                    if (extra.errorMessage !== undefined) task.errorMessage = extra.errorMessage;
                                }
                            }
                        });
                    });
                },

                completeVideoByIndex: (baseTaskId, videoIndex, videoUrl) => {
                    set((state) => {
                        const targetId = `${baseTaskId}-video-${videoIndex + 1}`;
                        const task = state.tasks.find((t) => t.id === targetId);
                        if (task) {
                            task.status = "completed";
                            task.outputUrl = videoUrl;
                            task.outputUrls = [videoUrl];
                            task.videoCount = 1;
                            task.thumbnailUrl = videoUrl;
                            task.progress = 100;
                            task.updatedAt = new Date().toISOString();
                        }
                    });
                },

                removeTask: (id) => {
                    set((state) => {
                        state.tasks = state.tasks.filter((t) => t.id !== id);
                        delete state.selectedTaskIds[id];
                    });
                },

                removeTasks: (ids) => {
                    const idsSet = new Set(ids);
                    set((state) => {
                        state.tasks = state.tasks.filter((t) => !idsSet.has(t.id));
                        ids.forEach((id) => delete state.selectedTaskIds[id]);
                    });
                },

                clearAllTasks: (groupName) => {
                    set((state) => {
                        if (groupName) {
                            state.tasks = state.tasks.filter((t) => t.groupName !== groupName);
                            state.selectedTaskIds = {};
                            // 切到另一个组
                            if (state.activeGroupName === groupName) {
                                const remaining = Array.from(new Set(state.tasks.map((t) => t.groupName)));
                                state.activeGroupName = remaining[0] || null;
                            }
                        } else {
                            state.tasks = [];
                            state.selectedTaskIds = {};
                            state.activeGroupName = null;
                        }
                    });
                },

                retryTask: (id) => {
                    set((state) => {
                        const task = state.tasks.find((t) => t.id === id);
                        if (task && task.status === "failed") {
                            task.status = "pending";
                            task.progress = 0;
                            task.stage = undefined;
                            task.errorMessage = undefined;
                            task.updatedAt = new Date().toISOString();
                        }
                    });
                },

                // ==================== 选择管理 ====================

                toggleSelection: (id) => {
                    set((state) => {
                        if (state.selectedTaskIds[id]) {
                            delete state.selectedTaskIds[id];
                        } else {
                            state.selectedTaskIds[id] = true;
                        }
                    });
                },

                selectAll: (selected, groupName) => {
                    set((state) => {
                        if (selected) {
                            const target = groupName
                                ? state.tasks.filter((t) => t.groupName === groupName)
                                : state.tasks;
                            target.forEach((t) => {
                                state.selectedTaskIds[t.id] = true;
                            });
                        } else {
                            state.selectedTaskIds = {};
                        }
                    });
                },

                clearSelection: () => {
                    set((state) => {
                        state.selectedTaskIds = {};
                    });
                },

                removeSelected: () => {
                    const selected = Object.keys(get().selectedTaskIds);
                    get().removeTasks(selected);
                },

                // ==================== 任务组管理 ====================

                setActiveGroup: (groupName) => {
                    set((state) => {
                        state.activeGroupName = groupName;
                        state.selectedTaskIds = {};
                    });
                },

                removeGroup: (groupName) => {
                    set((state) => {
                        state.tasks = state.tasks.filter((t) => t.groupName !== groupName);
                        if (state.activeGroupName === groupName) {
                            const remaining = Array.from(new Set(state.tasks.map((t) => t.groupName)));
                            state.activeGroupName = remaining[0] || null;
                        }
                    });
                },

                getGroups: () => {
                    const { tasks } = get();
                    const groupMap = new Map<string, {
                        name: string;
                        count: number;
                        completed: number;
                        failed: number;
                        createdAt: string;
                    }>();

                    tasks.forEach((t) => {
                        const name = t.groupName || "默认";
                        if (!groupMap.has(name)) {
                            groupMap.set(name, {
                                name,
                                count: 0,
                                completed: 0,
                                failed: 0,
                                createdAt: t.createdAt,
                            });
                        }
                        const group = groupMap.get(name)!;
                        group.count++;
                        if (t.status === "completed") group.completed++;
                        if (t.status === "failed") group.failed++;
                        // 最早创建时间
                        if (t.createdAt < group.createdAt) group.createdAt = t.createdAt;
                    });

                    return Array.from(groupMap.values())
                        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // 最新在前
                },

                getActiveGroupTasks: () => {
                    const { tasks, activeGroupName } = get();
                    if (!activeGroupName) return tasks;
                    return tasks.filter((t) => t.groupName === activeGroupName);
                },

                getActiveGroupStats: () => {
                    const tasks = get().getActiveGroupTasks();
                    return {
                        total: tasks.length,
                        pending: tasks.filter((t) => t.status === "pending").length,
                        processing: tasks.filter((t) => t.status === "uploading" || t.status === "generating").length,
                        completed: tasks.filter((t) => t.status === "completed").length,
                        failed: tasks.filter((t) => t.status === "failed").length,
                    };
                },
            })),
            { name: "SlideshowStore" }
        ),
        {
            name: "slideshow-tasks-store",
            storage: createJSONStorage(() => localStorage),
            // 不持久化选择状态
            partialize: (state) => ({
                tasks: state.tasks,
                activeGroupName: state.activeGroupName,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                // Studio 任务孤儿归一化:刷新打断的在途渲染(fetch 已丢失)置 failed,
                // 走批次卡的重试入口。服务端可能已完成并扣费,成片可在生成记录查看。
                // 旧 image-slideshow 页任务(无 renderRequest)不动,保持旧页语义。
                const orphaned = (state.tasks ?? []).some(
                    (t) => t.renderRequest && (t.status === "generating" || t.status === "uploading")
                );
                if (orphaned) {
                    // 同步 storage 的水合在 create() 初始化器内同步执行,此时
                    // useSlideshowStore 常量仍处于 TDZ——必须延迟到模块求值完成后再 setState
                    setTimeout(() => {
                        useSlideshowStore.setState({
                            tasks: useSlideshowStore.getState().tasks.map((t) =>
                                t.renderRequest && (t.status === "generating" || t.status === "uploading")
                                    ? {
                                        ...t,
                                        status: "failed" as const,
                                        errorMessage: "页面刷新中断,请重试(若已扣费,成片可在生成记录查看)",
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

// ============================================================================
// 便利 Hooks（避免组件中重复 selector）
// ============================================================================

export const useSlideshowTasks = () => useSlideshowStore((s) => s.tasks);
export const useSlideshowSelectedIds = () => useSlideshowStore((s) => s.selectedTaskIds);
export const useSlideshowActiveGroup = () => useSlideshowStore((s) => s.activeGroupName);
