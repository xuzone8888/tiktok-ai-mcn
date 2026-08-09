"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { CanvasNodeData } from "@/lib/canvas/schema";
import {
  VIDEO_MODEL_OPTIONS,
  getVideoModelCatalogEntry,
} from "@/lib/video-models/catalog";
import type {
  VideoAspectRatio,
  VideoDurationSeconds,
  VideoGenerationMode,
  VideoModelId,
  VideoQuality,
} from "@/lib/video-models/types";
import {
  useCanvasEdges,
  useCanvasNodes,
  useCanvasReadOnly,
  useCanvasStore,
} from "@/stores/canvas-store";

import {
  ENABLED_CANVAS_VIDEO_MODELS,
  getCanvasImageDraftConfig,
  getCanvasVideoDraftConfig,
  useCanvasGeneration,
  type CanvasGenerationEstimate,
  type CanvasGenerationView,
  type CanvasImageDraftConfig,
  type CanvasVideoDraftConfig,
} from "../canvas-generation-context";
import { useCanvasDockHost } from "../canvas-dock-context";
import {
  generationParamHint,
  type GenerationParamHintKey,
} from "./generation-param-copy";
import {
  planCapsuleCollapse,
  resolveGenerationPanelDock,
} from "../canvas-responsive";
import { useViewportSize } from "../use-viewport-size";

/**
 * 图片画幅枚举(CHECKLIST #78「比例 13 种」)。
 *
 * **这 6 项是真实能力边界,不要照着 schema 往上加。** 三层枚举当前不齐:
 *   - 面板(本数组)6 项;
 *   - 客户端类型 `CanvasImageDraftConfig["aspectRatio"]` 与服务端
 *     `ImageGenerationConfigSchema.aspectRatio` 各 11 项;
 *   - **上游 `getVideoPlatformImageSize` 的 sizeMap 每档只有这 6 个 key**
 *     (src/lib/video-platform-image-api.ts:214-241)。
 *
 * 关键:该函数末行是 `sizeMap[resolution]?.[ratio] || sizeMap[resolution]?.auto || null`,
 * 多出来的 5 项(3:2/2:3/5:4/4:5/21:9)**不会报错,而是静默回落成 auto 尺寸** ——
 * 用户选了 21:9、按全价扣了分,拿回来的却是自动画幅的图。所以把面板扩到 11 项
 * 等于制造「付费得到错画幅」的静默缺陷,比少列几项更糟。
 *
 * 要真正补齐,必须先给 sizeMap 补这几档的像素尺寸并确认 gpt-image-2 接受,
 * 而那是 quick-gen / image-factory 共用的链路,不属画布单方改动(见 P0 看板 R2-Q4)。
 */
const IMAGE_ASPECTS: Array<{
  value: CanvasImageDraftConfig["aspectRatio"];
  label: string;
}> = [
  { value: "9:16", label: "竖屏 9:16" },
  { value: "16:9", label: "横屏 16:9" },
  { value: "1:1", label: "方图 1:1" },
  { value: "4:3", label: "横图 4:3" },
  { value: "3:4", label: "竖图 3:4" },
  { value: "auto", label: "自动" },
];

const ENABLED_VIDEO_MODEL_OPTIONS = VIDEO_MODEL_OPTIONS.filter((option) =>
  ENABLED_CANVAS_VIDEO_MODELS.includes(option.id)
);

const STATUS_COPY: Record<
  CanvasGenerationView["status"],
  { label: string; className: string }
> = {
  pending: {
    label: "排队中",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  processing: {
    label: "生成中",
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  completed: {
    label: "已完成",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  failed: {
    label: "失败",
    className: "bg-destructive/10 text-destructive",
  },
  unknown: {
    label: "等待核对",
    className: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  },
};

function userFacingGenerationError(code: string | null): string {
  if (!code) return "生成服务未能完成本次任务";
  const normalized = code.toLowerCase();
  if (normalized.includes("provider_rejected")) {
    return "生成服务拒绝了本次参数，请调整提示词或规格后重试";
  }
  if (
    normalized.includes("terminal_failure") ||
    normalized.includes("provider_failed")
  ) {
    return "上游生成任务失败，可调整参数后重新生成";
  }
  if (
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("transport")
  ) {
    return "上游网络异常，系统已完成核对后结束任务";
  }
  if (
    normalized.includes("object_not_found") ||
    normalized.includes("object_identity_mismatch") ||
    normalized.includes("object_proof")
  ) {
    return "生成产物校验未通过，系统未把异常文件交付给你";
  }
  if (normalized.includes("planned_output")) {
    return "生成产物存储初始化失败";
  }
  return "生成任务未完成；如需协助，请提供下方任务号";
}

function SelectField({
  label,
  hintKey,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  /** 人话文案的 key(CHECKLIST #187);文案本体在 `generation-param-copy.ts`。 */
  hintKey: GenerationParamHintKey;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  children: React.ReactNode;
}) {
  const hint = generationParamHint(hintKey);
  return (
    <label
      className="min-w-0 flex-1 text-[10px] text-muted-foreground"
      /* #187 悬停示例:挂在 label 上,标题与控件悬停都能读到。
         无障碍走 aria-description(不是 aria-label —— 那会顶掉参数名本身)。 */
      title={hint}
    >
      <span className="mb-1 block">
        {label}
        {hint ? (
          <span
            aria-hidden="true"
            className="ml-0.5 cursor-help opacity-60"
            title={hint}
          >
            ⓘ
          </span>
        ) : null}
      </span>
      <select
        className="nodrag nopan nowheel h-7 w-full rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-ring disabled:opacity-50"
        value={value}
        disabled={disabled}
        title={hint}
        aria-description={hint}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

interface ParamCapsule {
  key: string;
  node: React.ReactNode;
}

/**
 * 参数胶囊行(CHECKLIST #180 参数胶囊 / #181 ≥5 折叠「更多」)。
 *
 * 胶囊数达到阈值时按 `planCapsuleCollapse` 的计划只直接展开前 N 个,其余收进「更多」——
 * 1366×768 条款,避免参数行把节点撑出视口。折叠策略是 `canvas-responsive.ts` 的纯函数
 * (S6 已离线单测),此处只负责消费,不在组件里另立阈值。
 */
function ParamCapsules({ capsules }: { capsules: ParamCapsule[] }) {
  const [expanded, setExpanded] = useState(false);
  const plan = planCapsuleCollapse(capsules.length);
  const collapsedNow = plan.collapsed && !expanded;
  const visible = collapsedNow ? capsules.slice(0, plan.visibleCount) : capsules;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {visible.map((capsule) => (
          <div
            key={capsule.key}
            className="flex min-w-[84px] flex-1 basis-[calc(50%-0.25rem)]"
          >
            {capsule.node}
          </div>
        ))}
      </div>
      {plan.collapsed && (
        <button
          type="button"
          className="nodrag nopan text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {collapsedNow ? `更多参数（${plan.overflowCount}）` : "收起参数"}
        </button>
      )}
    </div>
  );
}

function updateParams(nodeId: string, key: string, value: unknown): void {
  const state = useCanvasStore.getState();
  const data = state.nodes.find((candidate) => candidate.id === nodeId)?.data;
  if (!data) return;
  const params =
    data.params && typeof data.params === "object" && !Array.isArray(data.params)
      ? { ...data.params }
      : {};
  params[key] = value;
  if (state.updateNodeData(nodeId, { params })) state.commitTextEdit();
}

function downloadMedia(generationId: string, filename: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(generationId)) {
    throw new Error("生成记录编号未通过安全校验");
  }

  // The owner-authenticated endpoint issues a short-lived OSS URL with an
  // attachment disposition, so large media never enters renderer/server heap.
  const anchor = document.createElement("a");
  anchor.href = `/api/canvas/generations/${generationId}/download`;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function GenerationStatus({
  generation,
}: {
  generation: CanvasGenerationView | undefined;
}) {
  if (!generation) return null;
  const copy = STATUS_COPY[generation.status];
  return (
    <div
      className="space-y-1.5 rounded border border-border/70 bg-muted/30 p-2"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${copy.className}`}
        >
          {generation.status === "pending" || generation.status === "processing" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : generation.status === "completed" ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <AlertCircle className="h-3 w-3" />
          )}
          {copy.label}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Coins className="h-3 w-3" />
          {generation.creditCost} 积分
        </span>
      </div>
      {(generation.status === "pending" || generation.status === "processing") && (
        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          aria-label={`生成进度 ${generation.progress}%`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={generation.progress}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${Math.max(4, generation.progress)}%` }}
          />
        </div>
      )}
      {generation.status === "failed" && (
        <p className="text-[10px] leading-relaxed text-destructive">
          {userFacingGenerationError(generation.errorCode)}
          {generation.refundedCredits > 0
            ? ` · 已退 ${generation.refundedCredits} 积分`
            : ""}
          <span className="block text-[9px] opacity-80">
            任务号：{generation.generationId.slice(0, 8)}
          </span>
        </p>
      )}
      {generation.status === "unknown" && (
        <p className="text-[10px] leading-relaxed text-orange-700 dark:text-orange-300">
          上游是否接单暂不确定，为防重复扣费已停止重提。任务号：
          {generation.generationId.slice(0, 8)}
        </p>
      )}
    </div>
  );
}

function ImageSettings({
  nodeId,
  data,
  disabled,
}: {
  nodeId: string;
  data: CanvasNodeData;
  disabled: boolean;
}) {
  const config = getCanvasImageDraftConfig(data);
  const patch = (next: CanvasImageDraftConfig) =>
    updateParams(nodeId, "canvasImage", next);
  return (
    <ParamCapsules
      capsules={[
        {
          key: "resolution",
          node: (
            <SelectField
              label="清晰度"
              hintKey="image.resolution"
              value={config.resolution}
              disabled={disabled}
              onChange={(resolution) =>
                patch({
                  ...config,
                  resolution:
                    resolution as CanvasImageDraftConfig["resolution"],
                })
              }
            >
              <option value="1k">1K</option>
              <option value="2k">2K</option>
              <option value="4k">4K</option>
            </SelectField>
          ),
        },
        {
          key: "aspectRatio",
          node: (
            <SelectField
              label="画幅"
              hintKey="image.aspectRatio"
              value={config.aspectRatio}
              disabled={disabled}
              onChange={(aspectRatio) =>
                patch({
                  ...config,
                  aspectRatio:
                    aspectRatio as CanvasImageDraftConfig["aspectRatio"],
                })
              }
            >
              {IMAGE_ASPECTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          ),
        },
      ]}
    />
  );
}

function compatibleVideoConfig(
  model: VideoModelId,
  previous: CanvasVideoDraftConfig
): CanvasVideoDraftConfig {
  const catalog = getVideoModelCatalogEntry(model);
  return {
    model,
    durationSeconds: catalog.supportedDurations.includes(previous.durationSeconds)
      ? previous.durationSeconds
      : catalog.supportedDurations[0],
    quality: catalog.supportedQualities.includes(previous.quality)
      ? previous.quality
      : catalog.supportedQualities[0],
    aspectRatio: catalog.supportedAspectRatios.includes(previous.aspectRatio)
      ? previous.aspectRatio
      : catalog.supportedAspectRatios[0],
    mode: catalog.supportedModes.includes(previous.mode)
      ? previous.mode
      : catalog.supportedModes[0],
  };
}

function VideoSettings({
  nodeId,
  data,
  disabled,
  incomingImageCount,
}: {
  nodeId: string;
  data: CanvasNodeData;
  disabled: boolean;
  incomingImageCount: number;
}) {
  const config = getCanvasVideoDraftConfig(data);
  const catalog = getVideoModelCatalogEntry(config.model);
  const patch = (next: CanvasVideoDraftConfig) =>
    updateParams(nodeId, "canvasVideo", next);
  return (
    <ParamCapsules
      capsules={[
        {
          key: "model",
          node: (
            <SelectField
              label="模型"
              hintKey="video.model"
              value={config.model}
              disabled={disabled}
              onChange={(model) =>
                patch(compatibleVideoConfig(model as VideoModelId, config))
              }
            >
              {ENABLED_VIDEO_MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          ),
        },
        {
          key: "mode",
          node: (
            <SelectField
              label="模式"
              hintKey="video.mode"
              value={config.mode}
              disabled={disabled}
              onChange={(mode) =>
                patch({ ...config, mode: mode as VideoGenerationMode })
              }
            >
              {catalog.supportedModes.includes("prompt_to_video") && (
                <option value="prompt_to_video">文生视频</option>
              )}
              {catalog.supportedModes.includes("image_to_video") && (
                <option value="image_to_video">
                  图生视频{incomingImageCount ? ` (${incomingImageCount})` : ""}
                </option>
              )}
            </SelectField>
          ),
        },
        {
          key: "duration",
          node: (
            <SelectField
              label="时长"
              hintKey="video.duration"
              value={String(config.durationSeconds)}
              disabled={disabled}
              onChange={(duration) =>
                patch({
                  ...config,
                  durationSeconds: Number(duration) as VideoDurationSeconds,
                })
              }
            >
              {catalog.supportedDurations.map((duration) => (
                <option key={duration} value={duration}>
                  {duration} 秒
                </option>
              ))}
            </SelectField>
          ),
        },
        {
          key: "quality",
          node: (
            <SelectField
              label="质量"
              hintKey="video.quality"
              value={config.quality}
              disabled={disabled}
              onChange={(quality) =>
                patch({ ...config, quality: quality as VideoQuality })
              }
            >
              {catalog.supportedQualities.map((quality) => (
                <option key={quality} value={quality}>
                  {quality === "hd" ? "高清" : "标准"}
                </option>
              ))}
            </SelectField>
          ),
        },
        {
          key: "aspectRatio",
          node: (
            <SelectField
              label="画幅"
              hintKey="video.aspectRatio"
              value={config.aspectRatio}
              disabled={disabled}
              onChange={(aspectRatio) =>
                patch({
                  ...config,
                  aspectRatio: aspectRatio as VideoAspectRatio,
                })
              }
            >
              {catalog.supportedAspectRatios.map((aspect) => (
                <option key={aspect} value={aspect}>
                  {aspect}
                </option>
              ))}
            </SelectField>
          ),
        },
      ]}
    />
  );
}

export interface GenerationControlsProps {
  nodeId: string;
  kind: "image" | "video";
  data: CanvasNodeData;
  mediaUrl?: string | null;
}

export function GenerationControls({
  nodeId,
  kind,
  data,
  mediaUrl,
}: GenerationControlsProps) {
  const readOnly = useCanvasReadOnly();
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const dockHost = useCanvasDockHost();
  const { width: viewportWidth, height: viewportHeight } = useViewportSize();
  const panelRef = useRef<HTMLDivElement>(null);
  // 只在 inline 形态下记录高度:dock 后面板换了容器、宽度不同,高度会变,
  // 拿 dock 态的高度回去做 dock 判定会形成 inline↔bottom 的抖动环。
  const [inlinePanelHeight, setInlinePanelHeight] = useState(0);
  const {
    enabled,
    syncState,
    syncError,
    submittingNodeIds,
    unresolvedActionByNodeId,
    generationByNodeId,
    submitNode,
    refresh,
    estimate,
  } = useCanvasGeneration();
  const [estimateValue, setEstimateValue] =
    useState<CanvasGenerationEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimateEpoch, setEstimateEpoch] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** 手动刷新在途(CHECKLIST #51③);只驱动按钮的禁用与转圈,不参与任何闸门。 */
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const generation = generationByNodeId.get(nodeId);
  const unresolvedActionId = unresolvedActionByNodeId.get(nodeId) ?? null;
  const submitting = submittingNodeIds.has(nodeId);
  const active =
    generation?.status === "pending" || generation?.status === "processing";
  const uncertain = generation?.status === "unknown";
  const settingsDisabled =
    readOnly ||
    !enabled ||
    submitting ||
    active ||
    uncertain ||
    unresolvedActionId !== null;

  const incoming = useMemo(() => {
    const ids = edges
      .filter((edge) => edge.target === nodeId)
      .map((edge) => edge.source);
    const idSet = new Set(ids);
    return nodes.filter((node) => idSet.has(node.id));
  }, [edges, nodeId, nodes]);
  const incomingImageCount = incoming.filter(
    (node) => node.type === "image" && Boolean(node.data.media?.ossKey)
  ).length;
  const config =
    kind === "image"
      ? getCanvasImageDraftConfig(data)
      : getCanvasVideoDraftConfig(data);
  const configKey = JSON.stringify(config);

  useEffect(() => {
    setEstimateValue(null);
    setEstimateError(null);
    if (!enabled || syncState !== "ready" || unresolvedActionId !== null) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      estimate(kind, config, controller.signal)
        .then((value) => {
          if (!cancelled) {
            setEstimateValue(value);
            setEstimateError(value ? null : "暂时无法预估");
          }
        })
        .catch((error: unknown) => {
          if (
            !cancelled &&
            (error as { name?: string })?.name !== "AbortError"
          ) {
            setEstimateValue(null);
            setEstimateError(
              error instanceof Error ? error.message : "积分预估失败"
            );
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
    // configKey is the stable semantic dependency; `config` is reconstructed
    // from persisted node data on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    configKey,
    enabled,
    estimate,
    estimateEpoch,
    kind,
    syncState,
    unresolvedActionId,
  ]);

  const onGenerate = () => {
    if (syncState === "error") {
      void refresh();
      return;
    }
    if (unresolvedActionId) {
      void submitNode(nodeId);
      return;
    }
    if (!estimateValue) {
      toast({
        title: "尚未取得可靠报价",
        description: "请先重新预估积分，再确认生成。",
        variant: "destructive",
      });
      return;
    }
    if (estimateValue?.needsConfirmation) {
      setConfirmOpen(true);
      return;
    }
    void submitNode(nodeId);
  };
  /**
   * 拦截式确认文案(CHECKLIST #185)。规格只在两种情形下拦截,弹窗必须讲清是哪一种——
   * 否则用户看到「有时弹有时不弹」会以为是 bug。`indeterminate` 是报价/余额读不出的
   * fail-closed 兜底,不谎称原因。
   */
  const confirmCopy = ((): { title: string; lead: string } => {
    switch (estimateValue?.confirmationReason ?? null) {
      case "low_balance":
        return {
          title: "余额可能不够，确认继续？",
          lead: "当前余额已接近本次预估，扣费可能失败。",
        };
      case "high_cost":
        return {
          title: "本次为大额消耗，确认继续？",
          lead: "本次单次消耗超过大额阈值。",
        };
      case "indeterminate":
        return {
          title: "报价未取到可靠数值，确认继续？",
          lead: "本次预估或余额读取异常，已按最保守方式拦下。",
        };
      default:
        return { title: "确认本次积分消耗", lead: "" };
    }
  })();
  const filename = `${kind === "image" ? "canvas-image" : "canvas-video"}-${
    generation?.generationId.slice(0, 8) ?? nodeId
  }.${kind === "image" ? "jpg" : "mp4"}`;
  const actionDisabled =
    readOnly ||
    !enabled ||
    submitting ||
    active ||
    uncertain ||
    syncState === "idle" ||
    syncState === "loading" ||
    (syncState === "ready" &&
      unresolvedActionId === null &&
      estimateValue === null);

  /**
   * 面板停靠决策(CHECKLIST #189)。窄屏(≤1366)、或面板高超过视口 55% → dock 底部;
   * 判定本体是 `canvas-responsive.ts` 的纯函数(S6 已离线单测),这里只负责喂参数与渲染。
   * 视口尺寸尚未测出(SSR / 首帧 width=0)时保持 inline,避免水合瞬间闪一下底栏。
   */
  const dock =
    viewportWidth > 0
      ? resolveGenerationPanelDock({
          viewportWidth,
          viewportHeight,
          panelHeight: inlinePanelHeight,
        })
      : "inline";
  const docked = dock === "bottom" && dockHost !== null;

  useEffect(() => {
    const element = panelRef.current;
    if (!element || docked) return;
    if (typeof ResizeObserver === "undefined") {
      setInlinePanelHeight(element.getBoundingClientRect().height);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (typeof height === "number" && height > 0) setInlinePanelHeight(height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [docked]);

  const panel = (
    <div
      ref={panelRef}
      data-generation-panel-dock={docked ? "bottom" : "inline"}
      role={docked ? "region" : undefined}
      aria-label={
        docked
          ? `${kind === "image" ? "图片" : "视频"}节点生成参数`
          : undefined
      }
      className={
        docked
          ? "nodrag nopan nowheel pointer-events-auto w-full max-w-[560px] space-y-2 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur"
          : "nodrag nopan nowheel mt-2 space-y-2 border-t border-border/60 pt-2"
      }
    >
      {docked && (
        <p className="text-[10px] font-medium text-muted-foreground">
          {kind === "image" ? "图片" : "视频"}节点 · 生成参数（窗口较窄，面板已停靠底部）
        </p>
      )}
      <textarea
        className="nodrag nopan nowheel block w-full resize-none rounded border border-border bg-background/70 px-2 py-1.5 text-[11px] leading-relaxed text-foreground outline-none focus:border-ring"
        rows={3}
        maxLength={2000}
        value={typeof data.title === "string" ? data.title : ""}
        placeholder={
          incoming.some((node) => node.type === "text" || node.type === "product")
            ? "可补充当前节点要求；相连文本与商品简报会自动加入"
            : "描述主体、场景、镜头、风格和限制…"
        }
        readOnly={settingsDisabled}
        aria-label={`${kind === "image" ? "图片" : "视频"}生成提示词`}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        title="Ctrl+Enter（Mac 为 ⌘+Enter）发送"
        onChange={(event) =>
          useCanvasStore
            .getState()
            .updateNodeData(nodeId, { title: event.target.value })
        }
        onBlur={() => useCanvasStore.getState().commitTextEdit()}
        onKeyDown={(event) => {
          // CHECKLIST #188 发送快捷键。走与按钮同一个 onGenerate,因此防重复提交、
          // 报价未就绪拦截、超阈值拦截式确认三道闸一并复用,不另开提交路径。
          if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          event.stopPropagation();
          if (actionDisabled) return;
          useCanvasStore.getState().commitTextEdit();
          onGenerate();
        }}
      />

      {kind === "image" ? (
        <ImageSettings
          nodeId={nodeId}
          data={data}
          disabled={settingsDisabled}
        />
      ) : (
        <VideoSettings
          nodeId={nodeId}
          data={data}
          disabled={settingsDisabled}
          incomingImageCount={incomingImageCount}
        />
      )}

      <GenerationStatus generation={generation} />

      {unresolvedActionId && (
        <div
          className="rounded border border-orange-500/30 bg-orange-500/10 p-2 text-[10px] leading-relaxed text-orange-700 dark:text-orange-300"
          role="status"
        >
          本次提交的响应尚未确认。系统将复用任务{" "}
          {unresolvedActionId.slice(0, 8)} 核对与恢复，不会创建新的计费任务。
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-[10px]">
          <span
            className={
              estimateError || syncState === "error"
                ? "text-destructive"
                : "text-muted-foreground"
            }
            title={estimateError ?? syncError ?? undefined}
          >
            {syncState === "loading"
              ? "正在同步任务状态…"
              : syncState === "error"
                ? syncError || "任务状态同步失败"
                : unresolvedActionId
                  ? "等待幂等核对"
                  : estimateValue
                    ? `预计 ${estimateValue.cost} 积分 · 余额 ${estimateValue.balance}`
                    : estimateError || "正在预估积分…"}
          </span>
          {syncState === "ready" &&
            unresolvedActionId === null &&
            estimateError && (
              <button
                type="button"
                className="ml-1 underline underline-offset-2"
                onClick={() => setEstimateEpoch((value) => value + 1)}
              >
                重新预估
              </button>
            )}
          {/* 常态手动刷新(CHECKLIST #51③)。刻意**不**只在出错时出现:自动触发(加载/轮询/回前台)
              都是隐式的,用户对着一个转圈的节点时需要一个「我现在就要重新核对」的抓手。
              只读态不给,它不该产生任何请求。 */}
          {!readOnly && enabled && (
            <button
              type="button"
              className="ml-1 inline-flex items-center gap-0.5 underline underline-offset-2 disabled:no-underline disabled:opacity-50"
              disabled={manualRefreshing || syncState === "loading"}
              title="立即向服务端重新核对本画布的任务状态(加载与回前台会自动核对，这里是手动补一次)"
              onClick={() => {
                setManualRefreshing(true);
                void refresh()
                  .catch(() => {
                    // 失败已由状态区的 syncError 呈现,这里不再叠一个 toast。
                  })
                  .finally(() => setManualRefreshing(false));
              }}
            >
              <RefreshCw
                className={`h-2.5 w-2.5 ${manualRefreshing ? "animate-spin" : ""}`}
              />
              刷新状态
            </button>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={actionDisabled}
          onClick={onGenerate}
        >
          {submitting || active ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : unresolvedActionId || generation?.status === "failed" ? (
            <RefreshCw className="h-3 w-3" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {syncState === "error"
            ? "重试同步"
            : submitting
            ? "提交中"
            : active
              ? "生成中"
              : unresolvedActionId
                ? "核对并恢复"
              : generation?.status === "failed"
                ? "重新生成"
                : generation?.status === "completed"
                  ? "生成新版本"
                  : "开始生成"}
        </Button>
      </div>

      {generation?.status === "completed" && mediaUrl && (
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 flex-1 gap-1 px-2 text-[11px]"
            onClick={() => {
              try {
                downloadMedia(generation.generationId, filename);
              } catch (error) {
                toast({
                  title: "下载失败",
                  description:
                    error instanceof Error ? error.message : "请稍后重试",
                  variant: "destructive",
                });
              }
            }}
          >
            <Download className="h-3 w-3" />
            下载
          </Button>
          {kind === "video" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 flex-1 gap-1 px-2 text-[11px]"
              onClick={() => window.open("/publish", "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-3 w-3" />
              去发布
            </Button>
          )}
        </div>
      )}

      {generation?.status === "completed" && (
        <p className="text-[9px] leading-relaxed text-muted-foreground">
          AI 生成内容 · 对外发布时请遵循平台的 AIGC 标注规则。
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCopy.lead}本次预计消耗 {estimateValue?.cost ?? 0} 积分，当前余额{" "}
              {estimateValue?.balance ?? 0}。任务提交后只有明确失败才会自动退款。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>返回调整</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void submitNode(nodeId);
              }}
            >
              确认生成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  return docked && dockHost ? createPortal(panel, dockHost) : panel;
}

/**
 * 未终态节点的删除处置文案。`generationDeleteBlockReason` 与
 * `generationDeleteDisposition` 共用同一组常量,避免两处漂移。
 */
const DELETE_REASON_SYNC_ERROR = "任务状态同步失败，为防误删潜在产物暂不可删除";
const DELETE_REASON_SYNC_PENDING = "正在同步任务状态，完成后才能删除节点";
const DELETE_REASON_UNRESOLVED = "提交结果正在幂等核对，为防丢失潜在产物暂不可删除";
const DELETE_REASON_RUNNING = "任务生成中，完成或明确失败后才能删除节点";
const DELETE_REASON_UNKNOWN = "上游状态待核对，为防丢失潜在产物暂不可删除";

/**
 * 「取消并退款」不可用的原因(CHECKLIST #251 自带逃逸口「网关不支持取消则明示」)。
 * 依据是能力矩阵:`VIDEO_MODEL_CATALOG` 七个模型当前 `supportsCancel` 全为 false,
 * 图片直连链路同样没有撤单接口。**将来某模型支持撤单时,不能只放开这行文案 ——
 * 必须先实现真正的取消动作与幂等退款,再让 `generationCancelUnsupportedReason` 返回 null。**
 */
export const GENERATION_CANCEL_UNSUPPORTED_REASON =
  "上游网关不支持撤单：任务一经提交即由服务端对账车道接管，无法中途取消，因此也不会退款。";

/** 「仅移除」的后果说明(任务继续、产物进历史)。 */
export const GENERATION_DETACH_EXPLAINER =
  "仅把节点从画布移除。任务会继续跑完，产物照常进入「历史资产」，本次积分按已提交的任务照常结算。";

/**
 * 该节点当前是否可撤单。返回 null = 可撤单(届时需另行实现取消动作)。
 * 视频取节点已选模型的 catalog 能力;图片直连链路恒不可撤单。
 */
export function generationCancelUnsupportedReason(
  kind: "image" | "video",
  data: CanvasNodeData
): string | null {
  if (kind === "video") {
    const { model } = getCanvasVideoDraftConfig(data);
    if (getVideoModelCatalogEntry(model).supportsCancel) return null;
  }
  return GENERATION_CANCEL_UNSUPPORTED_REASON;
}

/**
 * 删除未终态节点的处置分类(CHECKLIST #251「删除 running 节点三选一」)。
 *
 * - `blocked`:状态本身还不确定 —— 同步未就绪 / 本地幂等核对中 / 上游 unknown。
 *   这三种情况下节点是**恢复动作的唯一入口**(「核对并恢复」按钮,以及 unknown 行等人工裁决时
 *   的现场线索),移除它会让用户失去追回产物与积分的抓手,故连「仅移除」都不给,维持禁用。
 * - `detach`:任务确实在跑(pending/processing)。服务端对账车道从不回写 `canvases.doc`,
 *   移除节点不影响任务收敛;产物落 `generations` 后经历史资产面板(源含 generations)照常可见。
 *   故按 #251 提供「仅移除(任务继续、产物进历史)」。
 * - `null`:无在途任务,走普通删除。
 */
export type GenerationDeleteDisposition =
  | { kind: "blocked"; reason: string }
  | { kind: "detach"; reason: string };

export function generationDeleteDisposition(
  generation: CanvasGenerationView | undefined,
  options?: {
    syncState?: "idle" | "loading" | "ready" | "error";
    unresolvedActionId?: string | null;
  }
): GenerationDeleteDisposition | null {
  if (options?.syncState !== undefined && options.syncState !== "ready") {
    return {
      kind: "blocked",
      reason:
        options.syncState === "error"
          ? DELETE_REASON_SYNC_ERROR
          : DELETE_REASON_SYNC_PENDING,
    };
  }
  if (options?.unresolvedActionId) {
    return { kind: "blocked", reason: DELETE_REASON_UNRESOLVED };
  }
  if (!generation) return null;
  if (generation.status === "pending" || generation.status === "processing") {
    return { kind: "detach", reason: DELETE_REASON_RUNNING };
  }
  if (generation.status === "unknown") {
    return { kind: "blocked", reason: DELETE_REASON_UNKNOWN };
  }
  return null;
}

/**
 * 「该节点此刻完全不可动」的原因。与 `generationDeleteDisposition` 的区别:
 * 本函数把 running 也算作阻断,供**复制/撤销/重做**等没有「仅移除」语义的守卫复用
 * (那些动作会改动在途节点的身份或位置,不能在任务跑着时放行)。
 * 删除路径请改用 `generationDeleteDisposition`。
 */
export function generationDeleteBlockReason(
  generation: CanvasGenerationView | undefined,
  options?: {
    syncState?: "idle" | "loading" | "ready" | "error";
    unresolvedActionId?: string | null;
  }
): string | null {
  return generationDeleteDisposition(generation, options)?.reason ?? null;
}
