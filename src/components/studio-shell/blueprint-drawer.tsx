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

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Minus, Plus, RotateCcw, Save, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { StudioBatch } from "@/stores/studio-store";
import type { ProductCard } from "@/lib/studio/product-vision";
import type { AiGenSceneSpec } from "@/lib/studio/job-spec";
import { useStudioSubmit } from "./use-studio-submit";

interface BlueprintScene {
  idx: number;
  line: string;
  visual: string;
  slot: { kind: string; asset_ref: string };
  duration_ms: number;
  beat: "hook" | "point" | "demo" | "cta";
}

interface BlueprintData {
  id: string;
  source_type: string;
  source_ref: { url?: string; asset_urls?: string[] } | null;
  product: ProductCard | null;
  scenes: BlueprintScene[];
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

  const save = useCallback(async (): Promise<boolean> => {
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
  }, [card, scenes, blueprintId, toast]);

  const handleRerun = async () => {
    if (!card) return;
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
    const result = rerunBlueprint(batch, card, blueprintId, rerunCount, editedScenes);
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
          <FileText className="h-4 w-4 text-amber-400" />
          蓝图编辑
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
        ) : loadError || !card ? (
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
            {/* 标题 */}
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-zinc-500">商品标题(钩子)</p>
              <input
                value={card.title}
                onChange={(e) => editTitle(e.target.value)}
                maxLength={200}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400/50 focus:outline-none"
              />
            </div>

            {/* 卖点勾选 + 行内编辑 */}
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-zinc-500">
                卖点(勾选进入成片文案,可改写)
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

            {/* 分镜台词 */}
            {scenes.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-zinc-500">
                  分镜台词(行内编辑;幻灯片口播由 AI 按卖点生成,台词用于 AI 生成腿逐镜)
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
                            scene.beat === "cta" ? "留空由文案生成器补 CTA…" : "这一镜说什么…"
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
      {!loading && !loadError && card && (
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
              onClick={() => void handleRerun()}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {dirty ? `保存并出 ${rerunCount} 条` : `再出 ${rerunCount} 条`}
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            编辑只影响新批次;已提交批次按其提交时快照渲染。
          </p>
        </div>
      )}
    </aside>
  );
}
