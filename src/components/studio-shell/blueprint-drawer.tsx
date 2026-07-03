"use client";

/**
 * 蓝图编辑器抽屉 - 右栏 420px(S2.2 首版)
 *
 * 范围(BLUEPRINT §三裁决):卖点勾选 + 台词行内编辑;槽位拖拽/时长调整后置。
 * hook 选择暂缺生成源(hooks 列恒空),留 S3 拆解腿补;按渲染腿出精简视图。
 *
 * 语义:编辑只影响「再出一批」——已提交批次持有 renderRequest 快照不回读蓝图。
 * 幻灯片腿口播由服务端按 标题+勾选卖点 diverse 生成;台词行用于 AI 生成腿逐镜。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Minus, Plus, RotateCcw, Save, Sparkles, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import type { StudioBatch } from "@/stores/studio-store";
import type { ProductCard } from "@/lib/studio/product-vision";
import type { AiGenJobSpec, AiGenSceneSpec, AssemblyJobSpec } from "@/lib/studio/job-spec";
import { getVideoBatchTotalPrice } from "@/types/video-batch";
import {
  assemblyCreditsPerVideo,
  slideshowCreditsPerVideo,
  useStudioSubmit,
} from "./use-studio-submit";

interface BlueprintScene {
  idx: number;
  line: string;
  visual: string;
  slot: { kind: string; asset_ref: string };
  duration_ms: number;
  beat: "hook" | "point" | "demo" | "cta";
}

interface DeconstructReportData {
  summary?: string;
  transcript_full?: string;
  hook?: { type?: string; text?: string; rationale?: string };
  cta?: { text?: string; approx_start_s?: number } | null;
  why_viral?: string[];
  video_type?: string;
  suggested_duration?: number;
}

interface BlueprintData {
  id: string;
  source_type: string;
  source_ref: { url?: string; asset_urls?: string[]; title?: string } | null;
  product: ProductCard | null;
  scenes: BlueprintScene[];
  /** 门B 溯源(S3.3 报告视图数据源) */
  origin?: {
    viral_ref?: string;
    why_viral?: string;
    license?: string;
    report?: DeconstructReportData;
  } | null;
  status: string;
}

const BEAT_LABELS: Record<BlueprintScene["beat"], string> = {
  hook: "钩子",
  point: "卖点",
  demo: "演示",
  cta: "转化",
};

const BEAT_COLORS: Record<BlueprintScene["beat"], string> = {
  hook: "border-amber-400/40 bg-amber-500/15 text-amber-300",
  point: "border-sky-400/40 bg-sky-500/15 text-sky-300",
  demo: "border-violet-400/40 bg-violet-500/15 text-violet-300",
  cta: "border-emerald-400/40 bg-emerald-500/15 text-emerald-300",
};

/** 节奏条填充色(结构报告) */
const BEAT_BAR_COLORS: Record<BlueprintScene["beat"], string> = {
  hook: "bg-amber-400/70",
  point: "bg-sky-400/70",
  demo: "bg-violet-400/70",
  cta: "bg-emerald-400/70",
};

interface BlueprintDrawerProps {
  batch: StudioBatch;
  onClose: () => void;
}

export function BlueprintDrawer({ batch, onClose }: BlueprintDrawerProps) {
  const { toast } = useToast();
  const { rerunBlueprint } = useStudioSubmit();
  const blueprintId = batch.blueprintId!;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [card, setCard] = useState<ProductCard | null>(null);
  const [scenes, setScenes] = useState<BlueprintScene[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rerunCount, setRerunCount] = useState(3);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 重跑估价镜像 omnibox estimateCredits(权威扣退在服务端):
  // ai_gen=逐镜计价×镜数×条数;assembly=1分/镜×镜数×条数;slideshow=图数分级×条数
  const estimatedCredits = useMemo(() => {
    const baseSpec = batch.spec as unknown as { kind?: string };
    if (baseSpec?.kind === "assembly") {
      const asmSpec = batch.spec as unknown as AssemblyJobSpec;
      const sceneCount = scenes.length || asmSpec.scenes?.length || 1;
      return assemblyCreditsPerVideo(sceneCount) * rerunCount;
    }
    if (baseSpec?.kind === "ai_gen") {
      const aiSpec = batch.spec as unknown as AiGenJobSpec;
      const sceneCount = scenes.length || aiSpec.scenes?.length || 1;
      return (
        getVideoBatchTotalPrice(
          aiSpec.modelType,
          aiSpec.durationSeconds,
          aiSpec.quality ?? "standard"
        ) *
        sceneCount *
        rerunCount
      );
    }
    const imageCount = card?.images.length || scenes.length || 2;
    return slideshowCreditsPerVideo(imageCount) * rerunCount;
  }, [batch.spec, scenes, card, rerunCount]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/studio/blueprints/${blueprintId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          const data = result.data as BlueprintData;
          setBlueprint(data);
          setCard(data.product);
          setScenes(Array.isArray(data.scenes) ? data.scenes : []);
          setDirty(false);
        } else {
          setLoadError(result.error || "蓝图读取失败");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("蓝图读取失败,请重试");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blueprintId, reloadNonce]);

  const togglePoint = (id: string) => {
    setCard((c) =>
      c
        ? {
            ...c,
            selling_points: c.selling_points.map((p) =>
              p.id === id ? { ...p, selected: !p.selected } : p
            ),
          }
        : c
    );
    setDirty(true);
  };

  const editPointText = (id: string, text: string) => {
    setCard((c) =>
      c
        ? {
            ...c,
            selling_points: c.selling_points.map((p) => (p.id === id ? { ...p, text } : p)),
          }
        : c
    );
    setDirty(true);
  };

  const editTitle = (title: string) => {
    setCard((c) => (c ? { ...c, title } : c));
    setDirty(true);
  };

  const editSceneLine = (idx: number, line: string) => {
    setScenes((prev) => prev.map((s) => (s.idx === idx ? { ...s, line } : s)));
    setDirty(true);
  };

  // 门B 拆解蓝图(source_type='reference_video'):product=null,渲染结构报告视图
  const isDeconstruct = blueprint?.source_type === "reference_video";
  const report = blueprint?.origin?.report;

  const save = useCallback(async (): Promise<boolean> => {
    // 拆解蓝图无商品卡,只保存分镜台词
    if (isDeconstruct) {
      setSaving(true);
      try {
        const res = await fetch(`/api/studio/blueprints/${blueprintId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenes }),
        });
        const result = await res.json();
        if (!result.success) {
          toast({ title: "保存失败", description: result.error, variant: "destructive" });
          return false;
        }
        setDirty(false);
        return true;
      } catch {
        toast({ title: "保存失败,请重试", variant: "destructive" });
        return false;
      } finally {
        setSaving(false);
      }
    }
    if (!card) return false;
    if (!card.title.trim()) {
      toast({ title: "标题不能为空", variant: "destructive" });
      return false;
    }
    if (!card.selling_points.some((p) => p.selected && p.text.trim())) {
      toast({ title: "至少勾选一个非空卖点", variant: "destructive" });
      return false;
    }
    setSaving(true);
    try {
      const cleanCard: ProductCard = {
        ...card,
        title: card.title.trim(),
        selling_points: card.selling_points.filter((p) => p.text.trim()),
      };
      const res = await fetch(`/api/studio/blueprints/${blueprintId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: cleanCard, scenes }),
      });
      const result = await res.json();
      if (!result.success) {
        toast({ title: "保存失败", description: result.error, variant: "destructive" });
        return false;
      }
      setCard(cleanCard);
      setDirty(false);
      return true;
    } catch {
      toast({ title: "保存失败,请重试", variant: "destructive" });
      return false;
    } finally {
      setSaving(false);
    }
  }, [isDeconstruct, card, scenes, blueprintId, toast]);

  // 与 omnibox 同阈值:大批量/高积分强制二次确认(红队裁决,重跑路径不豁免);
  // 拆解蓝图出片一律确认(structure_only:须先把台词换成自己的商品/内容)
  const requestRerun = () => {
    if (isDeconstruct || rerunCount > 10 || estimatedCredits > 1000) {
      setConfirmOpen(true);
      return;
    }
    void handleRerun();
  };

  const handleRerun = async () => {
    // 拆解蓝图无商品卡:合成最小卡(rerun ai_gen 链只消费 title)
    const effectiveCard: ProductCard | null = isDeconstruct
      ? ({
          title:
            blueprint?.source_ref?.title || report?.summary?.slice(0, 60) || "爆款结构复刻",
          price: "",
          category: "",
          images: [],
          selling_points: [],
          audience: [],
        } as unknown as ProductCard)
      : card;
    if (!effectiveCard) return;
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }
    // AI 生成腿重跑取编辑后的分镜(台词改动经重编译生效);幻灯片腿忽略该参数
    const editedScenes: AiGenSceneSpec[] = scenes.map((s) => ({
      idx: s.idx,
      line: s.line,
      visual: s.visual,
      beat: s.beat === "demo" ? "demo" : s.beat,
      imageUrl: s.slot?.asset_ref?.startsWith("http") ? s.slot.asset_ref : undefined,
    }));
    const result = rerunBlueprint(batch, effectiveCard, blueprintId, rerunCount, editedScenes);
    if (result.ok) {
      toast({ title: `已按蓝图排队 ${rerunCount} 条成片` });
      onClose();
    } else {
      toast({ title: "出片失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-white/10 bg-zinc-950/80 backdrop-blur-xl">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <FileText className={"h-4 w-4 " + (isDeconstruct ? "text-rose-400" : "text-amber-400")} />
          {isDeconstruct ? "结构报告" : "蓝图编辑"}
          {isDeconstruct && (
            <span className="rounded border border-rose-400/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-normal text-rose-300">
              仅复用结构
            </span>
          )}
          {blueprint?.source_type === "product_link" && blueprint.source_ref?.url && (
            <a
              href={blueprint.source_ref.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-[140px] truncate text-[11px] font-normal text-zinc-500 underline-offset-2 hover:underline"
              title={blueprint.source_ref.url}
            >
              {(() => {
                try {
                  return new URL(blueprint.source_ref.url).hostname;
                } catch {
                  return "来源链接";
                }
              })()}
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 主体 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            读取蓝图…
          </div>
        ) : loadError || (!card && !isDeconstruct) ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 px-6 text-center text-xs text-red-400">
            {loadError ?? "蓝图数据不完整"}
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        ) : (
          <div className="space-y-5 p-4">
            {/* 门B 结构报告(hook 卡 / 为什么火 / 节奏条 / CTA / 转录) */}
            {isDeconstruct && (
              <>
                {report?.summary && (
                  <p className="text-xs leading-relaxed text-zinc-400">{report.summary}</p>
                )}
                {report?.hook?.text && (
                  <div className="rounded-lg border border-rose-400/25 bg-rose-500/10 p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded border border-rose-400/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300">
                        HOOK·{report.hook.type || "悬念"}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-200">{report.hook.text}</p>
                    {report.hook.rationale && (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                        为什么留得住人:{report.hook.rationale}
                      </p>
                    )}
                  </div>
                )}
                {Array.isArray(report?.why_viral) && report.why_viral.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium text-zinc-500">这条为什么火</p>
                    <ul className="space-y-1">
                      {report.why_viral.map((w, i) => (
                        <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-zinc-300">
                          <span className="shrink-0 text-rose-400">·</span>
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {scenes.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium text-zinc-500">节奏</p>
                    <div className="flex h-3 w-full overflow-hidden rounded-full border border-white/10">
                      {scenes.map((s) => (
                        <div
                          key={s.idx}
                          title={`#${s.idx + 1} ${BEAT_LABELS[s.beat]} ${(s.duration_ms / 1000).toFixed(1)}s`}
                          style={{
                            flexGrow: Math.max(s.duration_ms, 500),
                            flexBasis: 0,
                          }}
                          className={"border-r border-black/40 last:border-r-0 " + BEAT_BAR_COLORS[s.beat]}
                        />
                      ))}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {scenes.map((s) => (
                        <span key={s.idx} className="text-[10px] text-zinc-600">
                          #{s.idx + 1} {BEAT_LABELS[s.beat]} {(s.duration_ms / 1000).toFixed(1)}s
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {report?.cta?.text && (
                  <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2">
                    <span className="mr-2 rounded border border-emerald-400/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      CTA
                      {typeof report.cta.approx_start_s === "number"
                        ? ` @${report.cta.approx_start_s.toFixed(1)}s`
                        : ""}
                    </span>
                    <span className="text-xs text-zinc-200">{report.cta.text}</span>
                  </div>
                )}
                {report?.transcript_full && (
                  <details className="group">
                    <summary className="cursor-pointer text-[11px] font-medium text-zinc-500 hover:text-zinc-300">
                      完整转录
                    </summary>
                    <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-white/5 bg-black/20 p-2.5 text-[11px] leading-relaxed text-zinc-400">
                      {report.transcript_full}
                    </p>
                  </details>
                )}
              </>
            )}

            {/* 标题(商品腿) */}
            {!isDeconstruct && card && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-zinc-500">商品标题(钩子)</p>
                <input
                  value={card.title}
                  onChange={(e) => editTitle(e.target.value)}
                  maxLength={200}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400/50 focus:outline-none"
                />
              </div>
            )}

            {/* 卖点勾选 + 行内编辑(商品腿) */}
            {!isDeconstruct && card && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-zinc-500">
                  卖点(勾选进入成片文案,可改写
                  {(() => {
                    const kind = (batch.spec as { kind?: string })?.kind;
                    return kind === "ai_gen" || kind === "assembly"
                      ? ";逐镜腿口播以下方分镜台词为准"
                      : "";
                  })()}
                  )
                </p>
                <div className="space-y-1.5">
                  {card.selling_points.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={p.selected}
                        onChange={() => togglePoint(p.id)}
                        className="shrink-0 accent-amber-400"
                      />
                      <input
                        value={p.text}
                        onChange={(e) => editPointText(p.id, e.target.value)}
                        maxLength={100}
                        className={
                          "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs transition-colors focus:border-white/15 focus:bg-black/30 focus:outline-none " +
                          (p.selected ? "text-zinc-200" : "text-zinc-600 line-through")
                        }
                      />
                    </div>
                  ))}
                </div>
                {card.audience.length > 0 && (
                  <p className="mt-2 text-[11px] text-zinc-600">
                    目标人群:{card.audience.join("、")}
                  </p>
                )}
              </div>
            )}

            {/* 分镜台词 */}
            {scenes.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-zinc-500">
                  {isDeconstruct
                    ? "逐镜台词(原片结构;出片前请改写为你自己的商品/内容——原台词不应进入生成物)"
                    : "分镜台词(行内编辑;幻灯片口播由 AI 按卖点生成,AI 生成/拼装口播腿逐镜以此为口播本体)"}
                </p>
                <div className="space-y-2">
                  {scenes.map((scene) => (
                    <div
                      key={scene.idx}
                      className="flex gap-2 rounded-lg border border-white/5 bg-black/20 p-2"
                    >
                      {scene.visual.startsWith("http") && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={scene.visual}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-md border border-white/10 object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className={
                              "rounded border px-1.5 py-0.5 text-[10px] " + BEAT_COLORS[scene.beat]
                            }
                          >
                            {BEAT_LABELS[scene.beat]}
                          </span>
                          <span className="text-[10px] tabular-nums text-zinc-600">
                            #{scene.idx + 1} · {(scene.duration_ms / 1000).toFixed(1)}s
                          </span>
                        </div>
                        <textarea
                          value={scene.line}
                          onChange={(e) => editSceneLine(scene.idx, e.target.value)}
                          maxLength={500}
                          rows={scene.line.length > 40 ? 2 : 1}
                          placeholder={
                            scene.beat === "cta"
                              ? "行动号召台词(留空:幻灯片由 AI 补,拼装腿补默认 CTA,AI 生成腿该镜无口播)"
                              : "这一镜说什么…"
                          }
                          className="w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-700 transition-colors focus:border-white/15 focus:bg-black/30 focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 动作区 */}
      {!loading && !loadError && (card || isDeconstruct) && (
        <div className="space-y-2 border-t border-white/5 p-4">
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || saving}
            className="w-full gap-1.5"
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {dirty ? "保存蓝图" : "已保存"}
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-1 py-0.5">
              <button
                type="button"
                onClick={() => setRerunCount((c) => Math.max(1, c - 1))}
                className="rounded p-1 text-zinc-400 hover:text-white"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="min-w-[3ch] text-center text-xs tabular-nums text-zinc-200">
                ×{rerunCount}
              </span>
              <button
                type="button"
                onClick={() => setRerunCount((c) => Math.min(100, c + 1))}
                className="rounded p-1 text-zinc-400 hover:text-white"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <Button
              variant="mermaid"
              size="sm"
              disabled={saving}
              className="flex-1 gap-1.5"
              onClick={requestRerun}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isDeconstruct
                ? `用此结构出 ${rerunCount} 条`
                : dirty
                  ? `保存并出 ${rerunCount} 条`
                  : `再出 ${rerunCount} 条`}
            </Button>
          </div>
          <p className="flex items-center gap-1 text-[11px] tabular-nums text-zinc-500">
            <Zap className="h-3 w-3" />
            预估 ≈ {estimatedCredits} 积分(按任务在服务端逐条扣除,失败自动退款)
          </p>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            编辑只影响新批次;已提交批次按其提交时快照渲染。
          </p>
        </div>
      )}

      {/* 大批量/高积分二次确认(与 omnibox 同阈值) */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isDeconstruct ? "确认用此结构出片" : "确认按蓝图批量出片"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isDeconstruct && (
                <span className="mb-2 block text-rose-400">
                  本蓝图仅授权复用结构与创意:请确认逐镜台词已替换为你自己的商品/内容,
                  原片画面与声音不会以任何形式进入成片(AI 生成腿按台词与画面指令全新生成)。
                </span>
              )}
              将按当前蓝图提交 {rerunCount} 条成片任务,预估消耗{" "}
              <span className="font-semibold text-amber-500 tabular-nums">
                {estimatedCredits}
              </span>{" "}
              积分。积分按任务在服务端逐条扣除,失败自动退款。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void handleRerun();
              }}
            >
              确认提交
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
