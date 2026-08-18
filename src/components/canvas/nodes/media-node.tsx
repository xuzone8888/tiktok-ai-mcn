"use client";

/**
 * 超级画布 · 图片/视频生成节点 + 媒体降级
 *
 * 媒体降级铁律(CHECKLIST #45):
 *   ① 节点默认只展示 **poster 缩略图**(图片=自身;视频=posterKey,无则占位不解码);
 *   ② **只有选中的视频**才挂真实 `<video>`(且需从配额管理拿到活跃槽);
 *   ③ **同屏活跃 `<video>` ≤6**(videoSlotManager 稳定排队/回收,防解码器耗尽);
 *   ④ **低 zoom**(< LOW_ZOOM_MEDIA_THRESHOLD)整体降级为**语义色块**,不解码任何图/视频。
 *
 * URL 解析铁律(CHECKLIST #28 渲染半):节点只持久化 OSS object key;此处经 media-url-cache 换**瞬态**
 * URL 渲染,**绝不写回节点 data**(本文件无 updateNodeData 调用)。快速切换选择/卸载经 AbortController
 * 取消本节点的解析等待(不牵连共享请求),失败可重试(forgetMediaUrl 清负缓存后重取)。
 */
import { memo, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ImageIcon, Loader2, Play, RotateCw, Video } from "lucide-react";
import { useStore, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";
import type { CanvasReactFlowNode } from "@/lib/canvas/rf-adapter";
import { isOssObjectKey, type CanvasMedia } from "@/lib/canvas/schema";

import { videoSlotManager } from "../active-video-registry";
import { LOW_ZOOM_MEDIA_THRESHOLD } from "../canvas-responsive";
import {
  forgetMediaUrl,
  peekMediaUrl,
  resolveMediaUrl,
} from "../media-url-cache";
import { useCanvasGeneration } from "../canvas-generation-context";
import {
  GENERATION_DETACH_EXPLAINER,
  GenerationControls,
  generationCancelUnsupportedReason,
  generationDeleteDisposition,
} from "./generation-controls";
import { NodeShell, type NodeDeleteDetach } from "./node-shell";

type MediaKind = "image" | "video";

/**
 * 把删除处置分类摊成 NodeShell 的两个互斥入参(CHECKLIST #251):
 * `blocked` → 禁用删除按钮(状态未定,节点是恢复入口);
 * `detach`  → 按钮可点,弹窗走「取消并退款(明示不可用)/仅移除/返回」三选一。
 */
function mediaDeleteProps(
  kind: MediaKind,
  data: NodeProps<CanvasReactFlowNode>["data"],
  generation: Parameters<typeof generationDeleteDisposition>[0],
  options: NonNullable<Parameters<typeof generationDeleteDisposition>[1]>
): {
  deleteDisabledReason: string | null;
  deleteDetach: NodeDeleteDetach | null;
} {
  const disposition = generationDeleteDisposition(generation, options);
  if (disposition?.kind === "detach") {
    return {
      deleteDisabledReason: null,
      deleteDetach: {
        reason: disposition.reason,
        explainer: GENERATION_DETACH_EXPLAINER,
        cancelUnsupportedReason: generationCancelUnsupportedReason(kind, data),
      },
    };
  }
  return {
    deleteDisabledReason: disposition?.reason ?? null,
    deleteDetach: null,
  };
}

interface MediaUrlState {
  status: "idle" | "pending" | "resolved" | "error";
  url?: string;
  error?: string;
}

/** 解析 object key → 瞬态 URL 的订阅 hook;key 变化/卸载 abort 本节点等待(不牵连共享请求)。 */
function useResolvedMediaUrl(key: string | null, epoch = 0): MediaUrlState {
  const [state, setState] = useState<MediaUrlState>(() => {
    if (!key) return { status: "idle" };
    const cached = peekMediaUrl(key);
    return cached ? { status: "resolved", url: cached } : { status: "pending" };
  });

  useEffect(() => {
    if (!key) {
      setState({ status: "idle" });
      return;
    }
    const cached = peekMediaUrl(key);
    if (cached) {
      setState({ status: "resolved", url: cached });
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setState({ status: "pending" });
    resolveMediaUrl(key, { signal: controller.signal }).then(
      (url) => {
        if (alive) setState({ status: "resolved", url });
      },
      (error: unknown) => {
        // abort 不是失败:静默(本节点已不再关心)。
        if (!alive || (error as { name?: string })?.name === "AbortError") return;
        setState({
          status: "error",
          error: error instanceof Error ? error.message : "解析失败",
        });
      }
    );
    return () => {
      alive = false;
      controller.abort();
    };
  }, [key, epoch]);

  return state;
}

/** 申请/持有活跃视频槽:want=true 且拿到槽才返回 true;卸载/退选释放并让队首递补。 */
function useActiveVideoSlot(id: string, want: boolean): boolean {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    if (!want) {
      videoSlotManager.release(id);
      setGranted(false);
      return;
    }
    const sync = () => setGranted(videoSlotManager.has(id));
    videoSlotManager.request(id);
    sync();
    const unsubscribe = videoSlotManager.subscribe(sync);
    return () => {
      unsubscribe();
      videoSlotManager.release(id); // 卸载/退选:释放槽(卸载 `<video>` 即释放解码器),队首递补
    };
  }, [id, want]);

  return granted;
}

/** 低 zoom 降级色块:语义色(图片/视频各一色)+ 类型图标,不解码任何媒体。 */
function MediaColorBlock({ kind, label }: { kind: MediaKind; label: string }) {
  const Icon = kind === "image" ? ImageIcon : Video;
  return (
    <div
      className={cn(
        "flex h-[104px] w-full items-center justify-center rounded",
        kind === "image"
          ? "bg-sky-500/15 text-sky-600 dark:text-sky-300"
          : "bg-violet-500/15 text-violet-600 dark:text-violet-300"
      )}
      aria-label={`${label}(低缩放降级)`}
      data-media-state="color-block"
    >
      <Icon className="h-6 w-6 opacity-70" />
    </div>
  );
}

/**
 * 「输入已更新」角标文案(CHECKLIST #43)。
 *
 * 判定本身在 provider 里整画布算一次(纯派生、不落盘),这里只把布尔翻成文案。
 * 走 context 而非 canvas-store 是硬要求:`scripts/verify-canvas-s6.mjs` 有两条负向断言
 * 盯着本文件 —— 不得 import canvas-store,也不得调那个写回节点 data 的 store 方法
 * (ADR5:媒体节点只读不写)。
 *
 * ⚠️ 那两条断言是**对整份源码做正则**、不剥注释的,所以连注释里都不能出现
 * 「那个方法名紧跟左括号」的字样 —— 本注释因此绕开写法,不是文字游戏:
 * 2026-08-09 本批就因为在这段注释里照写了方法名而让 s6 报红一次。
 */
const INPUTS_DIRTY_TITLE =
  "输入已更新：上游内容在这次产物之后变过了，重新生成即可同步";
function INPUTS_DIRTY_BADGE(dirty: boolean): { title: string } | null {
  return dirty ? { title: INPUTS_DIRTY_TITLE } : null;
}

/** 无媒体的空态占位(虚线框 + 中性文案)。 */
function MediaEmpty({ kind, label }: { kind: MediaKind; label: string }) {
  const Icon = kind === "image" ? ImageIcon : Video;
  return (
    <div
      className="flex h-[104px] w-full flex-col items-center justify-center gap-1 rounded border border-dashed border-border/70 text-muted-foreground"
      data-media-state="empty"
    >
      <Icon className="h-5 w-5 opacity-60" />
      <span className="text-[11px]">{kind === "image" ? "暂无图片" : "暂无视频"}</span>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** 解析中骨架。 */
function MediaLoading() {
  return (
    <div
      className="flex h-[104px] w-full items-center justify-center rounded bg-muted/60"
      data-media-state="loading"
    >
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

/** 解析失败:图标 + 重试(重试清负缓存后重取)。 */
function MediaError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex h-[104px] w-full flex-col items-center justify-center gap-1.5 rounded bg-destructive/10 text-destructive"
      data-media-state="error"
    >
      <AlertTriangle className="h-5 w-5" />
      <button
        type="button"
        className="nodrag nopan inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-destructive/15"
        onClick={onRetry}
      >
        <RotateCw className="h-3 w-3" />
        重试
      </button>
    </div>
  );
}

function basename(objectKey: string): string {
  const slash = objectKey.lastIndexOf("/");
  return slash >= 0 ? objectKey.slice(slash + 1) : objectKey;
}

/** 图片节点:低 zoom 色块;否则解析 poster(=posterKey ?? ossKey)渲染缩略图。永不挂 `<video>`。 */
function ImageNodeImpl({ id, data, selected }: NodeProps<CanvasReactFlowNode>) {
  const media = data?.media as CanvasMedia | undefined;
  const ossKey = media?.ossKey;
  const posterKey = media?.posterKey ?? ossKey;
  const lowZoom = useStore((state) => state.transform[2] < LOW_ZOOM_MEDIA_THRESHOLD);
  const [epoch, setEpoch] = useState(0);
  const resolveKey = !lowZoom && isOssObjectKey(posterKey) ? (posterKey as string) : null;
  const poster = useResolvedMediaUrl(resolveKey, epoch);
  const {
    canvasId,
    generationByNodeId,
    inputsDirtyNodeIds,
    syncState,
    unresolvedActionByNodeId,
  } = useCanvasGeneration();
  const generation = generationByNodeId.get(id);
  const { deleteDisabledReason, deleteDetach } = mediaDeleteProps(
    "image",
    data,
    generation,
    {
      syncState: canvasId === null ? undefined : syncState,
      unresolvedActionId: unresolvedActionByNodeId.get(id),
    }
  );

  let body: ReactNode;
  if (!isOssObjectKey(ossKey)) {
    body = <MediaEmpty kind="image" label="图片节点" />;
  } else if (lowZoom) {
    body = <MediaColorBlock kind="image" label="图片节点" />;
  } else if (poster.status === "resolved" && poster.url) {
    body = (
      <img
        src={poster.url}
        alt={`图片 · ${basename(ossKey as string)}`}
        className="h-[104px] w-full rounded object-cover"
        decoding="async"
        loading="lazy"
        draggable={false}
        data-media-state="poster"
      />
    );
  } else if (poster.status === "error") {
    body = (
      <MediaError
        onRetry={() => {
          if (resolveKey) forgetMediaUrl(resolveKey);
          setEpoch((value) => value + 1);
        }}
      />
    );
  } else {
    body = <MediaLoading />;
  }

  return (
    <NodeShell
      nodeId={id}
      label="图片"
      Icon={ImageIcon}
      selected={selected}
      wide={Boolean(selected && !lowZoom)}
      deleteDisabledReason={deleteDisabledReason}
      deleteDetach={deleteDetach}
      inputsDirty={INPUTS_DIRTY_BADGE(inputsDirtyNodeIds.has(id))}
    >
      {body}
      {selected && !lowZoom && (
        <GenerationControls
          nodeId={id}
          kind="image"
          data={data}
          mediaUrl={poster.status === "resolved" ? poster.url : null}
        />
      )}
    </NodeShell>
  );
}

/**
 * 视频节点:低 zoom 色块;未选中 → poster 缩略图(无 posterKey 则占位 + 播放提示,不挂 `<video>`);
 * 选中且非低 zoom 且拿到活跃槽 → 挂真实 `<video>`。同屏活跃 `<video>` ≤6 由配额管理保证。
 */
function VideoNodeImpl({ id, data, selected }: NodeProps<CanvasReactFlowNode>) {
  const media = data?.media as CanvasMedia | undefined;
  const ossKey = media?.ossKey;
  const posterKey = media?.posterKey;
  const lowZoom = useStore((state) => state.transform[2] < LOW_ZOOM_MEDIA_THRESHOLD);
  const [epoch, setEpoch] = useState(0);

  const hasVideo = isOssObjectKey(ossKey);
  // 意图挂 `<video>`:选中 + 非低 zoom + 有合法视频;实际是否挂由配额管理(≤6)决定。
  const wantActive = hasVideo && !!selected && !lowZoom;
  const activeSlot = useActiveVideoSlot(id, wantActive);
  const active = wantActive && activeSlot;

  const posterResolveKey = !lowZoom && isOssObjectKey(posterKey) ? (posterKey as string) : null;
  const poster = useResolvedMediaUrl(posterResolveKey, epoch);
  const videoResolveKey = active ? (ossKey as string) : null;
  const video = useResolvedMediaUrl(videoResolveKey, epoch);
  const {
    canvasId,
    generationByNodeId,
    inputsDirtyNodeIds,
    syncState,
    unresolvedActionByNodeId,
  } = useCanvasGeneration();
  const generation = generationByNodeId.get(id);
  const { deleteDisabledReason, deleteDetach } = mediaDeleteProps(
    "video",
    data,
    generation,
    {
      syncState: canvasId === null ? undefined : syncState,
      unresolvedActionId: unresolvedActionByNodeId.get(id),
    }
  );

  let body: ReactNode;
  if (!hasVideo) {
    body = <MediaEmpty kind="video" label="视频节点" />;
  } else if (lowZoom) {
    body = <MediaColorBlock kind="video" label="视频节点" />;
  } else if (active) {
    if (video.status === "error") {
      body = (
        <MediaError
          onRetry={() => {
            if (videoResolveKey) forgetMediaUrl(videoResolveKey);
            setEpoch((value) => value + 1);
          }}
        />
      );
    } else if (video.status === "resolved" && video.url) {
      body = (
        <video
          src={video.url}
          poster={poster.status === "resolved" ? poster.url : undefined}
          className="h-[104px] w-full rounded bg-black object-contain"
          controls
          muted
          playsInline
          preload="metadata"
          data-media-state="video"
        />
      );
    } else {
      body = <MediaLoading />;
    }
  } else {
    // 未选中(或未拿到槽):poster 缩略图 + 播放提示;无 poster 则占位。
    const overlay = (
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Play className="h-6 w-6 text-white/90 drop-shadow" />
      </span>
    );
    if (poster.status === "resolved" && poster.url) {
      body = (
        <div className="relative" data-media-state="poster">
          <img
            src={poster.url}
            alt={`视频 · ${basename(ossKey as string)}`}
            className="h-[104px] w-full rounded object-cover"
            decoding="async"
            loading="lazy"
            draggable={false}
          />
          {overlay}
        </div>
      );
    } else if (poster.status === "pending") {
      body = <MediaLoading />;
    } else {
      // 无 posterKey 或 poster 失败:中性占位(不试图把视频当图解码),提示选中播放。
      body = (
        <div
          className="relative flex h-[104px] w-full flex-col items-center justify-center gap-1 rounded bg-muted/60 text-muted-foreground"
          data-media-state="poster-fallback"
        >
          <Video className="h-5 w-5 opacity-70" />
          <span className="text-[11px]">{selected ? "加载中…" : "选中以播放"}</span>
        </div>
      );
    }
  }

  return (
    <NodeShell
      nodeId={id}
      label="视频"
      Icon={Video}
      selected={selected}
      wide={Boolean(selected && !lowZoom)}
      deleteDisabledReason={deleteDisabledReason}
      deleteDetach={deleteDetach}
      inputsDirty={INPUTS_DIRTY_BADGE(inputsDirtyNodeIds.has(id))}
    >
      {body}
      {selected && !lowZoom && (
        <GenerationControls
          nodeId={id}
          kind="video"
          data={data}
          mediaUrl={video.status === "resolved" ? video.url : null}
        />
      )}
    </NodeShell>
  );
}

export const ImageNode = memo(ImageNodeImpl);
ImageNode.displayName = "imageNode";
export const VideoNode = memo(VideoNodeImpl);
VideoNode.displayName = "videoNode";
