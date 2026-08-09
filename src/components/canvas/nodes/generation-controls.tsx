"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Crop,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { resolveGenerationLockHint } from "./generation-lock-hints";
import {
  resolveCanvasGenerateConsent,
  type CanvasConsentReason,
  type CanvasGenerateSource,
} from "@/lib/canvas/generation-consent";
import { GenerationCropDialog } from "./generation-crop-dialog";
import { GenerationReferenceStrip } from "./generation-reference-strip";
import { uploadCanvasFile } from "../canvas-upload";
import { CANVAS_UPLOAD_MAX_IMAGE_BYTES } from "@/lib/canvas/upload-contract";
import {
  collectImageReferences,
  orderGenerationInputNodes,
} from "../generation-input-order";
import {
  planCapsuleCollapse,
  resolveGenerationPanelDock,
} from "../canvas-responsive";
import { useViewportSize } from "../use-viewport-size";

/**
 * 图片画幅选项(CHECKLIST #78)。
 *
 * **枚举本身不在这里定义**——取值唯一真相源是 `CANVAS_IMAGE_ASPECT_RATIOS`
 * (`src/lib/canvas/generation-intent.ts`),intent schema / 估价 schema / 客户端草稿类型
 * 与本数组四处同源。本文件只负责给每个取值配中文标签与**展示顺序**
 * (竖屏优先,与画布主要用于短视频素材的实际用法一致)。
 *
 * 2026-08-09 之前面板 6 项、两处 schema 各 11 项,靠这个数组单点防住
 * 「选了上游够不着的档位 → 静默回落 auto → 按全价扣费」;现已按 P1-Q2a 收窄到同一集合,
 * 下面那行 `satisfies` 是机器守卫:标签表漏配任一取值都会在 tsc 阶段红,drift 不会再静默发生。
 */
const IMAGE_ASPECT_LABELS = {
  "9:16": "竖屏 9:16",
  "16:9": "横屏 16:9",
  "1:1": "方图 1:1",
  "4:3": "横图 4:3",
  "3:4": "竖图 3:4",
  auto: "自动",
} satisfies Record<CanvasImageDraftConfig["aspectRatio"], string>;

const IMAGE_ASPECTS: Array<{
  value: CanvasImageDraftConfig["aspectRatio"];
  label: string;
}> = (
  ["9:16", "16:9", "1:1", "4:3", "3:4", "auto"] satisfies Array<
    CanvasImageDraftConfig["aspectRatio"]
  >
).map((value) => ({ value, label: IMAGE_ASPECT_LABELS[value] }));

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

/** 「推为参考」新建节点的横向偏移;够远不压住源节点,又还在同屏视野内。 */
const PUSH_AS_REFERENCE_OFFSET_X = 360;

/**
 * 裁剪结果节点的纵向偏移(CHECKLIST #82)。
 * 与「推为参考」共用横向偏移,但**再往下错开一格** —— 否则同一张图先推参考、再裁剪,
 * 两个新节点会精确重叠,用户只看得见后建的那个。
 */
const CROP_RESULT_OFFSET_Y = 220;

/**
 * 提交不可逆的事前告知。与 `GENERATION_CANCEL_UNSUPPORTED_REASON`(事后想删时才出现)成对:
 * 那一条是「你现在删不掉」,这一条是「你按下去之前就该知道删不掉」。
 * 七个模型 `supportsCancel` 全为 false,所以它当前总是适用;将来有可撤单模型时按调用点的
 * `generationCancelUnsupportedReason(...)` 判空自动退场。
 */
const GENERATION_IRREVERSIBLE_NOTICE =
  "任务一经提交即由服务端对账车道接管，无法中途取消，只有明确失败才会自动退款。";

/**
 * 入库(CHECKLIST #64)。**按 generationId 匹配,不按 taskId** ——
 * 画布直连图片走同步完成路径,`bindProviderTask` 不会被调用,`task_id` 恒为 null,
 * 按 taskId 匹配一行都命中不到(详见 /api/studio/library 的头注释)。
 *
 * 复用 Studio 既有端点而非另起画布专用路由(铁律1 零 fork):属主校验 / completed 闸 /
 * published 守卫那四道闸只该有一份,复制一份迟早漂移。
 */
async function archiveToLibrary(generationId: string): Promise<void> {
  const response = await fetch("/api/studio/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationIds: [generationId],
      libraryStatus: "ready",
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    data?: { updated?: number };
  } | null;
  if (!response.ok || body?.success !== true) {
    throw new Error(body?.error || "入库失败");
  }
  // updated=0 表示一行都没命中(未完成 / 非本人 / 已是 published),不能当成功报。
  if (!body.data?.updated) {
    throw new Error("没有可入库的产物：任务未完成或已发布");
  }
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
    discardUnresolved,
    refresh,
    estimate,
  } = useCanvasGeneration();
  const [estimateValue, setEstimateValue] =
    useState<CanvasGenerationEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimateEpoch, setEstimateEpoch] = useState(0);
  /**
   * 确认弹窗的**定格快照**(2026-08-09 审计发现)。此前是一个布尔 `confirmOpen` + 直接读活的
   * `estimateValue`:弹窗开着时一次后台同步失败就会把 estimateValue 置 null,正在征求资金
   * 同意的弹窗当场变成「预计 0 积分，当前余额 0」。金额必须在打开那一刻定住。
   */
  const [confirmSnapshot, setConfirmSnapshot] = useState<{
    reason: CanvasConsentReason;
    cost: number | null;
    balance: number | null;
  } | null>(null);
  /** 手动刷新在途(CHECKLIST #51③);只驱动按钮的禁用与转圈,不参与任何闸门。 */
  const [manualRefreshing, setManualRefreshing] = useState(false);
  /** 「如何解锁」指引是否展开(CHECKLIST #186)。 */
  const [lockHintOpen, setLockHintOpen] = useState(false);
  /** 产物全屏预览(CHECKLIST #84)。 */
  const [previewOpen, setPreviewOpen] = useState(false);
  /** 入库在途 / 已入库(CHECKLIST #64);权威在 generations.library_status,这里只做乐观标记。 */
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  /** 裁剪弹层与其上传在途(CHECKLIST #82)。裁剪本身零扣费,这里只防重复落节点。 */
  const [cropOpen, setCropOpen] = useState(false);
  const [cropUploading, setCropUploading] = useState(false);
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

  /**
   * 上游输入。**必须与提交路径同序** —— 两边共用 `orderGenerationInputNodes`。
   * 此前这里是 `nodes.filter(idSet.has)`(节点数组序),而提交走的是连线序;只用来算数量时
   * 看不出差别,但引用区一按序号渲染,「图N」就会指错请求里的第 N 张参考图。
   */
  const incoming = useMemo(
    () => orderGenerationInputNodes(nodes, edges, nodeId),
    [edges, nodeId, nodes]
  );
  const imageReferences = useMemo(
    () => collectImageReferences(incoming),
    [incoming]
  );
  /** 本节点位置,供「推为参考」把新节点摆在右侧(CHECKLIST #64)。取不到就交给 store 默认。 */
  const selfPosition = nodes.find((node) => node.id === nodeId)?.position ?? null;
  const incomingImageCount = imageReferences.length;
  const config =
    kind === "image"
      ? getCanvasImageDraftConfig(data)
      : getCanvasVideoDraftConfig(data);
  const configKey = JSON.stringify(config);

  /**
   * 灰置原因与解锁步骤(CHECKLIST #186)。判定本体是 `generation-lock-hints.ts` 的纯函数
   * (可离线穷举状态组合),这里只喂参数。
   *
   * 注意「图生视频缺上游图」这一条:此前它只在**提交后**由 buildIntent 抛错才被用户看到,
   * 等于让人先点了才知道不行。现在同一个条件在事前就讲清楚,并给出三条可自助的出路。
   */
  const lockHint = resolveGenerationLockHint({
    readOnly,
    enabled,
    submitting,
    active,
    uncertain,
    reconciling: unresolvedActionId !== null,
    syncState,
    kind,
    videoMode:
      kind === "video"
        ? (config as CanvasVideoDraftConfig).mode
        : undefined,
    incomingImageCount,
  });

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

  /**
   * 停靠位里区分本面板属于哪个节点(CHECKLIST #189 的多选补丁)。
   * 优先用用户自己写的提示词摘录——那是他最认得出的东西;为空时退回节点 id 后缀。
   */
  const dockedNodeLabel = (() => {
    const title = typeof data.title === "string" ? data.title.trim() : "";
    if (title) {
      return title.length > 14 ? `${title.slice(0, 14)}…` : title;
    }
    return `未命名 ${nodeId.slice(-4)}`;
  })();

  /** 这次未解决的 intent 服务端是否确有其行。绑定=幂等重放不扣费;未绑定=提交会首次扣费。 */
  const unresolvedIsBound =
    unresolvedActionId !== null && generation?.actionId === unresolvedActionId;

  /**
   * 唯一的付费提交入口(2026-08-09 R2-Q4 审计后改造)。
   *
   * `source` 不是装饰:金额闸(#185 双阈值)回答「这笔钱大不大」,出处闸回答「这一下是不是
   * 用户真要花的」。两条正交,判定本体在 `generation-consent.ts`(纯函数,可离线穷举),
   * 这里只负责喂参数与执行。**新增任何能触发付费的入口,都必须经过这个函数并显式传 source。**
   */
  const onGenerate = (source: CanvasGenerateSource) => {
    if (syncState === "error") {
      void refresh();
      return;
    }
    // 未解决的 intent 走恢复语义:已绑定=幂等重放(放行),未绑定=会真的 INSERT 扣费(必须问)。
    if (unresolvedActionId) {
      const gate = resolveCanvasGenerateConsent({
        source: unresolvedIsBound ? "recovery_bound" : "recovery_unbound",
        cost: estimateValue?.cost ?? 0,
        thresholdTrigger: null,
      });
      if (gate.decision === "confirm") {
        setConfirmSnapshot({
          reason: gate.reason,
          cost: estimateValue?.cost ?? null,
          balance: estimateValue?.balance ?? null,
        });
        return;
      }
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
    const gate = resolveCanvasGenerateConsent({
      source,
      cost: estimateValue.cost,
      thresholdTrigger: estimateValue.confirmationReason,
    });
    if (gate.decision === "confirm") {
      // 打开瞬间把金额定格:弹窗开着时后台同步一失败,活对象会退化成「预计 0 积分,余额 0」,
      // 而这偏偏是最需要金额准确的那一次。
      setConfirmSnapshot({
        reason: gate.reason,
        cost: estimateValue.cost,
        balance: estimateValue.balance,
      });
      return;
    }
    void submitNode(nodeId);
  };
  /**
   * 拦截式确认文案。弹窗必须讲清**这一次**为什么弹——否则用户看到「有时弹有时不弹」
   * 会以为是 bug。原因来自确认快照(定格值),不读活对象。
   */
  const confirmCopy = ((): { title: string; lead: string } => {
    switch (confirmSnapshot?.reason ?? null) {
      case "keyboard_shortcut":
        return {
          title: "用快捷键发送，确认花费？",
          lead: "Ctrl+Enter 在输入框里很容易误触，所以这一次多问一句。",
        };
      case "unbound_recovery":
        return {
          title: "这次提交此前没有到达服务端，重新提交？",
          lead: "上次提交没能确认送达，服务端查不到这笔任务——现在提交会是一次全新的扣费，不是恢复。",
        };
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
      /* 停靠位是所有选中节点共用的一个容器:多选两个媒体节点时会并排出现两个面板。
         没有节点标识的话它们外观完全一致(标题相同、空提示词时连内容都一样),
         点错一个就是在错误的节点上花钱。故给出 data-node-id 锚点 + 标题里的节点标识。 */
      data-node-id={nodeId}
      role={docked ? "region" : undefined}
      aria-label={
        docked
          ? `${kind === "image" ? "图片" : "视频"}节点生成参数 · ${dockedNodeLabel}`
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
          {kind === "image" ? "图片" : "视频"}节点 ·{" "}
          <span className="text-foreground">{dockedNodeLabel}</span> ·
          生成参数（窗口较窄，面板已停靠底部）
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
          // 报价未就绪拦截、金额阈值三道闸一并复用,不另开提交路径;`shortcut` 这个 source
          // 会再多要一次确认(见 generation-consent.ts:输入框里 Ctrl+Enter 极易误触)。
          if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
          // 输入法组字期间的 Enter 是「上屏候选词」,不是「发送」。必须在 preventDefault
          // 之前早退,否则中文用户选词会被吞掉,甚至直接触发一次付费提交。
          // keyCode 229 是 Safari/旧版在 compositionend 之后仍会报的兼容分支
          // (与 use-canvas-command-shortcuts.ts / omnibox.tsx 同一处置)。
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.stopPropagation();
          if (actionDisabled) return;
          useCanvasStore.getState().commitTextEdit();
          onGenerate("shortcut");
        }}
      />

      {/* 引用区(CHECKLIST #44 / #72 / #94)。紧贴提示词下方,因为提示词里写「与图1保持一致」
          时需要照着这里的序号写 —— 两者离得越近越不容易写错。 */}
      <GenerationReferenceStrip references={imageReferences} />

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

      {/* 未解决的提交。**必须分绑定/未绑定两说** —— 旧文案对两种情形一律讲
          「不会创建新的计费任务」,而未绑定时那是假的:服务端根本没有这一行,再提交就是
          一次全新的 INSERT + 扣费。假承诺比不承诺更伤。 */}
      {unresolvedActionId && (
        <div
          className="space-y-1.5 rounded border border-orange-500/30 bg-orange-500/10 p-2 text-[10px] leading-relaxed text-orange-700 dark:text-orange-300"
          role="status"
        >
          {unresolvedIsBound ? (
            <p>
              本次提交的响应尚未确认，但服务端已收到任务{" "}
              {unresolvedActionId.slice(0, 8)}。系统会复用它核对与恢复，
              <strong>不会创建新的计费任务</strong>。
            </p>
          ) : (
            <>
              <p>
                上次提交没能确认送达，<strong>服务端目前查不到这笔任务</strong>
                （本地记录 {unresolvedActionId.slice(0, 8)}）。
                此时再提交会是一次<strong>全新的扣费</strong>，不是恢复。
              </p>
              <button
                type="button"
                className="nodrag nopan underline underline-offset-2 hover:no-underline"
                title="只清掉本地这条待恢复记录。服务端本来就没有这一行，所以没有可退的款，也没有要取消的任务。"
                onClick={() => discardUnresolved(nodeId)}
              >
                放弃这次提交
              </button>
            </>
          )}
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
          /* 「提交后不可取消、不退款」此前只出现在弹窗里;#185 之后弹窗大多数时候不弹,
             这句唯一的事前风险告知就没了落脚点。挂 title 而非常显条(用户裁决:恒显不需要),
             并按 generationCancelUnsupportedReason 是否非空来挂 —— 将来若有可撤单的模型,
             这句话会自动退场,不会变成谎话。 */
          title={
            generationCancelUnsupportedReason(kind, data)
              ? GENERATION_IRREVERSIBLE_NOTICE
              : undefined
          }
          onClick={() => onGenerate("button")}
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

      {/* 灰置控件的「如何解锁」指引(CHECKLIST #186)。
          刻意做成**点击展开**而非常显:常显会把面板挤满,而缺前置条件本身是少数情形。
          但入口必须常在 —— 用户盯着一个灰按钮时,得有个地方可点。 */}
      {lockHint && (
        <div className="text-[10px] leading-relaxed">
          <button
            type="button"
            className="nodrag nopan inline-flex items-center gap-0.5 text-muted-foreground underline underline-offset-2 hover:text-foreground"
            aria-expanded={lockHintOpen}
            onClick={() => setLockHintOpen((value) => !value)}
          >
            <AlertCircle className="h-2.5 w-2.5" />
            {lockHintOpen ? "收起说明" : "为什么现在不能生成？"}
          </button>
          {lockHintOpen && (
            <div className="mt-1 rounded border border-border bg-muted/40 p-1.5">
              <p className="text-muted-foreground">{lockHint.reason}</p>
              {lockHint.steps.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-3.5 text-muted-foreground">
                  {lockHint.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground opacity-80">
                  这一条没有可自助解除的操作，稍等即可。
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
          {/* 全屏预览(CHECKLIST #84)。节点上的产物缩略图受节点尺寸与 zoom 限制,
              细节根本看不清 —— 而「这张图到底行不行」是决定要不要重生成(再花一次钱)的
              唯一依据。用签名 URL 直接放大展示,不下载、不落盘。 */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 flex-1 gap-1 px-2 text-[11px]"
            onClick={() => setPreviewOpen(true)}
          >
            <Maximize2 className="h-3 w-3" />
            全屏
          </Button>
          {/* 裁剪(CHECKLIST #82)。刻意挂在这条**现成的产物动作行**上,而不是新建一条
              React Flow `NodeToolbar`:
              ①裁剪就是一个产物动作,与下载/全屏同类,没有理由另起一层承载面;
              ②这条行所在的面板在 1352×642 已溢出停靠位 66px(见 P0 看板已知摩擦),
                新增一整行会把溢出再推大约 34px,而挂进本行是**零高度增量**
                (视频侧本来就是 3 个按钮,图片侧此前只有 2 个)。
              只读态不给:裁剪的结果要落成新节点,那是写操作。 */}
          {kind === "image" && !readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 flex-1 gap-1 px-2 text-[11px]"
              title="在浏览器里裁掉多余的边，结果作为新的图片节点放到画布上。不消耗积分"
              onClick={() => setCropOpen(true)}
            >
              <Crop className="h-3 w-3" />
              裁剪
            </Button>
          )}
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

      {/* 入库 / 推为参考(CHECKLIST #64「产物动作:下载/入库/推为参考」的后两项)。
          只读态不给:两者都会产生副作用(一个写库、一个改文档)。 */}
      {generation?.status === "completed" && !readOnly && (
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 flex-1 gap-1 px-2 text-[11px]"
            disabled={archiving || archived}
            title="把本次产物标记进内容库，之后可在内容库里找到它"
            onClick={() => {
              setArchiving(true);
              void archiveToLibrary(generation.generationId)
                .then(() => {
                  setArchived(true);
                  toast({ title: "已入库", description: "可在内容库中找到本次产物" });
                })
                .catch((error: unknown) => {
                  toast({
                    title: "入库失败",
                    description:
                      error instanceof Error ? error.message : "请稍后重试",
                    variant: "destructive",
                  });
                })
                .finally(() => setArchiving(false));
            }}
          >
            {archiving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            {archived ? "已入库" : "入库"}
          </Button>
          {kind === "image" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 flex-1 gap-1 px-2 text-[11px]"
              title="以本图为参考新建一个视频节点，并自动连好线"
              onClick={() => {
                const created = useCanvasStore.getState().addNodeAndEdge({
                  node: {
                    type: "video",
                    position: selfPosition
                      ? {
                          x: selfPosition.x + PUSH_AS_REFERENCE_OFFSET_X,
                          y: selfPosition.y,
                        }
                      : undefined,
                    data: { title: "以图生视频" },
                  },
                  fromNodeId: nodeId,
                  fromHandleId: null,
                  fromHandleType: "source",
                });
                if (!created) {
                  toast({
                    title: "无法新建节点",
                    description: "画布当前不可写入，或已达节点上限",
                    variant: "destructive",
                  });
                  return;
                }
                toast({
                  title: "已推为参考",
                  description: "已新建视频节点并连好线，本图即它的图1",
                });
              }}
            >
              <Sparkles className="h-3 w-3" />
              推为参考
            </Button>
          )}
        </div>
      )}

      {generation?.status === "completed" && (
        <p className="text-[9px] leading-relaxed text-muted-foreground">
          AI 生成内容 · 对外发布时请遵循平台的 AIGC 标注规则。
        </p>
      )}

      {/* 全屏预览弹层(CHECKLIST #84)。
          - 只吃 `mediaUrl`(渲染层解析出的**瞬态**签名 URL),不碰 object key、不写回节点;
          - 视频给原生 controls,图片不给交互 —— 预览就是预览,裁剪/编辑不在 P1 范围;
          - 关掉即卸载 <video>,不占用「同屏活跃视频 ≤6」的配额(那是节点上的策略)。 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[min(92vw,72rem)] p-3">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {kind === "image" ? "图片" : "视频"}产物预览
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              任务号 {generation?.generationId.slice(0, 8) ?? "—"} · AI 生成内容，
              对外发布时请遵循平台的 AIGC 标注规则。
            </DialogDescription>
          </DialogHeader>
          {previewOpen && mediaUrl ? (
            kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- 签名 URL 是瞬态的，不能进 next/image 的优化缓存
              <img
                src={mediaUrl}
                alt="生成产物全屏预览"
                className="max-h-[72vh] w-full object-contain"
              />
            ) : (
              <video
                src={mediaUrl}
                controls
                playsInline
                className="max-h-[72vh] w-full object-contain"
              />
            )
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 裁剪弹层(CHECKLIST #82)。
          - 只吃瞬态签名 URL,与全屏预览同一个来源;
          - 裁剪结果**走画布已有的上传链路**(`uploadCanvasFile` → `/api/canvas/uploads/*`),
            与拖文件进画布是同一条路,因此配额、体积上限、object key 归属校验全部自动生效;
          - 落成**独立的新节点、不连线**:画布里 A→B 的边语义是「A 是 B 的生成参考图」,
            而裁剪产物并不是由原图“生成”的,连上去会让用户一按生成就把原图当参考送进去。 */}
      <GenerationCropDialog
        open={cropOpen}
        onOpenChange={(open) => {
          if (cropUploading) return;
          setCropOpen(open);
        }}
        mediaUrl={mediaUrl}
        busy={cropUploading}
        onConfirm={(blob) => {
          if (blob.size > CANVAS_UPLOAD_MAX_IMAGE_BYTES) {
            toast({
              title: "裁剪结果过大",
              description: `单张图片上限 ${Math.round(
                CANVAS_UPLOAD_MAX_IMAGE_BYTES / (1024 * 1024)
              )}MB，请选小一点的区域`,
              variant: "destructive",
            });
            return;
          }
          const file = new File(
            [blob],
            `crop-${(generation?.generationId ?? nodeId).slice(0, 8)}-${Date.now()}.jpg`,
            { type: "image/jpeg" }
          );
          setCropUploading(true);
          void uploadCanvasFile(file)
            .then(({ ossKey }) => {
              const created = useCanvasStore.getState().addNode({
                type: "image",
                position: selfPosition
                  ? {
                      x: selfPosition.x + PUSH_AS_REFERENCE_OFFSET_X,
                      y: selfPosition.y + CROP_RESULT_OFFSET_Y,
                    }
                  : undefined,
                data: { title: "裁剪结果", media: { ossKey } },
              });
              if (!created) {
                // 图已经在 OSS 上了,不能假装没事发生 —— 明说文件在、节点没建成。
                toast({
                  title: "已裁剪，但新建节点失败",
                  description: "画布当前不可写入，或已达节点上限",
                  variant: "destructive",
                });
                return;
              }
              setCropOpen(false);
              toast({
                title: "已裁剪",
                description: "裁剪结果已作为新的图片节点放到画布上",
              });
            })
            .catch((error: unknown) => {
              toast({
                title: "裁剪结果上传失败",
                description:
                  error instanceof Error ? error.message : "请稍后重试",
                variant: "destructive",
              });
            })
            .finally(() => setCropUploading(false));
        }}
      />

      <AlertDialog
        open={confirmSnapshot !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmSnapshot(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCopy.lead}本次预计消耗 {confirmSnapshot?.cost ?? 0} 积分，当前余额{" "}
              {confirmSnapshot?.balance ?? 0}。{GENERATION_IRREVERSIBLE_NOTICE}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>返回调整</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // 报价在弹窗开着期间变了(改参数/换模型/余额变动)→ 不能拿旧数字当同意凭据。
                // 关掉并要求重新确认,而不是按用户没看过的价扣费。
                const snapshot = confirmSnapshot;
                setConfirmSnapshot(null);
                if (
                  snapshot &&
                  snapshot.cost !== null &&
                  estimateValue &&
                  estimateValue.cost !== snapshot.cost
                ) {
                  toast({
                    title: "报价已变化",
                    description: `本次预估已从 ${snapshot.cost} 变为 ${estimateValue.cost} 积分，请重新确认。`,
                    variant: "destructive",
                  });
                  return;
                }
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
