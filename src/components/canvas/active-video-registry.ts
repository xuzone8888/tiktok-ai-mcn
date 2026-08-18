/**
 * 超级画布 · 同屏活跃视频配额管理(P0 · S6,#45 媒体降级)
 *
 * 媒体降级铁律:节点默认 poster 缩略图,**只有选中的视频才挂真实 `<video>`**;为防止 200 节点画布
 * 同时多选/滚动误挂大量 `<video>` 耗尽浏览器视频解码器,同屏活跃 `<video>` 硬上限 6。超限时稳定排队:
 * 先到先得(FIFO)——先申请的前 6 个保持挂载,其余进等待队列;某活跃者卸载/退选释放槽,队首递补。
 * 稳定=重复申请已持槽者不改顺序、不抖动。
 *
 * 纯逻辑、无 React —— 可离线单测(createVideoSlotManager)。React 侧 useActiveVideoSlot 消费单例。
 */

/** 同屏活跃 `<video>` 硬上限(CHECKLIST #45)。 */
export const MAX_ACTIVE_VIDEOS = 6;

export interface VideoSlotManager {
  /** 申请槽;返回调用后该 id 是否持槽(未持则进队列)。幂等:已持者原样保持顺序。 */
  request: (id: string) => boolean;
  /** 释放槽(卸载/退选);若释放的是活跃槽且有等待者,队首递补。 */
  release: (id: string) => void;
  /** 该 id 当前是否持有活跃槽。 */
  has: (id: string) => boolean;
  /** 当前活跃槽数(≤ 上限)。 */
  activeCount: () => number;
  /** 当前活跃 id 快照(申请顺序)。 */
  activeIds: () => string[];
  /** 当前等待 id 快照(申请顺序)。 */
  queuedIds: () => string[];
  /** 订阅变更(活跃/队列有增删时触发),返回退订函数。 */
  subscribe: (listener: () => void) => () => void;
}

export function createVideoSlotManager(limit: number = MAX_ACTIVE_VIDEOS): VideoSlotManager {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : MAX_ACTIVE_VIDEOS;
  let active: string[] = [];
  let queue: string[] = [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const request = (id: string): boolean => {
    if (typeof id !== "string" || id === "") return false;
    if (active.includes(id)) return true; // 已持槽:稳定,不改顺序
    if (queue.includes(id)) return false; // 已在队列:等待
    if (active.length < cap) {
      active = [...active, id];
      notify();
      return true;
    }
    queue = [...queue, id];
    notify();
    return false;
  };

  const release = (id: string): void => {
    const wasActive = active.includes(id);
    const wasQueued = queue.includes(id);
    if (!wasActive && !wasQueued) return;
    active = active.filter((candidate) => candidate !== id);
    queue = queue.filter((candidate) => candidate !== id);
    // 释放活跃槽腾出空位 → 队首递补(稳定 FIFO 回收)。
    if (wasActive && queue.length > 0 && active.length < cap) {
      const [head, ...rest] = queue;
      active = [...active, head];
      queue = rest;
    }
    notify();
  };

  return {
    request,
    release,
    has: (id) => active.includes(id),
    activeCount: () => active.length,
    activeIds: () => [...active],
    queuedIds: () => [...queue],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 全画布共享的活跃视频配额单例(useActiveVideoSlot 消费)。 */
export const videoSlotManager: VideoSlotManager = createVideoSlotManager();
