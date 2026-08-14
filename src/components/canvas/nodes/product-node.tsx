"use client";

/**
 * 超级画布 · 商品节点(CHECKLIST #67「商品节点轻量版(上传图+文本→卖点卡)」· 方案 A)
 *
 * 电商带货轨的起点节点。链路 = 节点内上传商品图 → 显式点「解析卖点」调
 * `POST /api/studio/analyze-product` → 卖点卡落 `params.product` → 用户勾选后
 * 手动「插入到简报」写进 `data.title`。
 *
 * ## 五条踩过的坑,改这个文件前必读
 *
 * 1. **卖点卡不能原样写进文档。** `normalizeCard` 会留下**值为 undefined 的 own 键**
 *    (`price`/`category`,以及卖点项的 `evidence`),而画布持久化层的
 *    `isPersistableJsonValue` 对这种键一律判否 → `cloneCanvasEntity` 返回 null →
 *    `updateNodeData` **静默返回 false**:卡片写不进去、不抛异常、不提示,
 *    而丢掉的是一次几十秒的厂商调用结果。所以必须先过 `JSON.parse(JSON.stringify(...))`。
 *    见 `toCanvasProductCard`。
 *    ⚠️ 这条**不只针对卖点卡**:任何写进 data 的对象都不许带值为 undefined 的 own 键。
 *    2026-08-14 「移除商品图」全线不可用,就是 `handleRemoveImage` 作废指纹时写了
 *    `undefined` 而不是删键。要**移除**一个可选键(比如清空 `media`),唯一正确的办法是
 *    store `updateNodeData` 的 `options.unset` 删键通道 —— 浅展开永远删不掉键。
 *
 * 2. **`card.images` 是 http URL,绝不能落盘。** 铁律「画布文档只存 OSS object key」在这条路上
 *    原本没有机器守卫(`unsafeStringReason` 只拦 dataURL 与带签名参数的 URL,而
 *    `resolveMediaUrl` 产出的是**无 query 的公有 URL**,会被放行)。
 *    所以 `CanvasProductCardSchema` 结构上就没有 `images` 字段,这里也必须显式丢掉它。
 *
 * 3. **写 `params` 必须 spread 旧值。** `updateNodeData` 是 `{...node.data, ...patch}` 浅合并,
 *    直接传 `{ params: { product } }` 会**整块抹掉 `params.generation`** ——
 *    那是生成意图,也就是计费与对账的落点。且同样静默。
 *
 * 4. **只读/未 hydrate 时写入静默失败。** `canMutateCurrentDocument` 三条任一不满足就返回 false,
 *    不抛不提示。所以写按钮一律显式 `disabled={readOnly || busy}`,并且**检查返回值**再 toast。
 *
 * 5. **解析必须显式点击触发,不能用 effect。** 该路由对用户零扣费,但**对我方有厂商成本**
 *    (豆包视觉 + qwen 兜底),且它自身零频控、零幂等、超时不 abort 上游。
 *    防重两层:`analyzedImageKeys`(持久,管跨刷新/切画布/组件重挂)+ `busy`(管同一挂载周期连点)。
 *    ⚠️ 商品节点**没有** selected/zoom 条件卸载(ReactFlow 也没开 onlyRenderVisibleElements),
 *    所以组件级 ref 在本会话内是可靠的;丢失只发生在切画布/刷新/删节点。
 *    指纹闸只挡**不带 force** 的调用。「重新解析」按钮带 `force: true`(2026-08-09 用户裁决:
 *    批准同一组图可以再花一次厂商调用);此前它不带 force,被指纹闸硬 return,按钮点了没反应。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, type NodeProps } from "@xyflow/react";
import {
  ImagePlus,
  Loader2,
  Package,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";

import { toast } from "@/hooks/use-toast";
import type { CanvasReactFlowNode } from "@/lib/canvas/rf-adapter";
import type {
  CanvasNodeDataUnsettableKey,
  CanvasNodeParams,
  CanvasProductCard,
  CanvasProductState,
} from "@/lib/canvas/schema";
import { CANVAS_UPLOAD_MIME_BY_EXTENSION } from "@/lib/canvas/upload-contract";
import type { ProductCard } from "@/lib/studio/product-vision";
import { useCanvasReadOnly, useCanvasStore } from "@/stores/canvas-store";

import { LOW_ZOOM_MEDIA_THRESHOLD } from "../canvas-responsive";
import {
  CANVAS_UPLOAD_MAX_CONCURRENCY,
  CanvasUploadError,
  prepareCanvasUploads,
  uploadPreparedCanvasFile,
} from "../canvas-upload";
import { resolveMediaUrl } from "../media-url-cache";
import { NODE_TYPE_ITEMS } from "../node-type-meta";
import { NodeShell } from "./node-shell";

/** 与 `/api/studio/analyze-product` 的 `slice(0, 9)` 对齐(2026-08-10 用户裁决:做满 9 张)。 */
const MAX_PRODUCT_IMAGES = 9;

/** 「插入到简报」写进 data.title 的块首标记。再次插入时**替换**上一块,而不是追加第二份。 */
const BRIEF_BLOCK_MARKER = "【商品卖点】";

/** data.title 的 schema 上限(CanvasNodeDataSchema.title 是 max(2000))。 */
const BRIEF_MAX_CHARS = 2000;

/** 浏览器 accept 白名单从服务端契约派生,避免两边漂移。 */
const PRODUCT_IMAGE_ACCEPT = Array.from(
  new Set(
    Object.values(CANVAS_UPLOAD_MIME_BY_EXTENSION)
      .flat()
      .filter((mime) => mime.startsWith("image/"))
  )
).join(",");

const EMPTY_PRODUCT: CanvasProductState = { extraImageKeys: [] };

/**
 * 图 key 集合的**顺序无关**指纹,用于「这组图解析过了没有」的判定。
 * 分隔符取 `|` —— OSS object key 只允许 `folder/userId/name` 三段的受限字符集
 * (见 `src/lib/canvas/media-ownership.ts`),不会含它,所以不同集合不会撞同一指纹。
 */
function imageKeyFingerprint(keys: readonly string[]): string {
  return [...keys].sort().join("|");
}

/**
 * `ProductCard`(上游形状)→ `CanvasProductCard`(画布持久化形状)。
 *
 * 三件事一个都不能少,顺序也不能换:
 * ① 丢掉 `images`(它装 http URL,持久化形状里没这个字段);
 * ② JSON 归一,清掉值为 undefined 的 own 键(否则整次写入被静默丢弃,见文件抬头坑 1);
 * ③ 卖点 id 去重 —— `normalizeCard` 混用模型给的 id 与 `sp-{i}` 且**不去重**,
 *    重复 id 会让「按 id toggle」勾一条翻两条。
 */
function toCanvasProductCard(raw: ProductCard): CanvasProductCard {
  const { images: _urlsNeverPersisted, ...rest } = raw;
  const clean = JSON.parse(JSON.stringify(rest)) as Omit<ProductCard, "images">;
  const seen = new Set<string>();
  const selling_points = (clean.selling_points ?? []).map((point, index) => {
    const base =
      typeof point.id === "string" && point.id.trim()
        ? point.id.trim().slice(0, 64)
        : `sp-${index}`;
    let id = base;
    let suffix = 0;
    while (seen.has(id)) {
      suffix += 1;
      id = `${base}-${suffix}`.slice(0, 64);
    }
    seen.add(id);
    return { ...point, id };
  });
  return { ...clean, audience: clean.audience ?? [], selling_points };
}

/** 勾选中的卖点渲染成要写进简报的那段文本。 */
function renderBriefBlock(card: CanvasProductCard): string {
  const picked = card.selling_points.filter((point) => point.selected);
  const lines = [`${BRIEF_BLOCK_MARKER}${card.title}`];
  for (const point of picked) lines.push(`· ${point.text}`);
  if (card.audience.length > 0) lines.push(`目标人群:${card.audience.join("、")}`);
  return lines.join("\n");
}

/**
 * 把卖点块合进现有简报:已存在同标记的块就**整块替换**,否则追加到末尾。
 * 追加式会让用户改一次勾选就多出一份近似文本,而这段是**逐字送厂商并计费**的。
 */
function mergeBriefBlock(current: string, block: string): string {
  const start = current.indexOf(BRIEF_BLOCK_MARKER);
  let next: string;
  if (start === -1) {
    next = current.trim() ? `${current.trimEnd()}\n\n${block}` : block;
  } else {
    // 块的边界 = 下一个空行(用户在块后自己写的内容不受影响)。
    const rest = current.slice(start);
    const blank = rest.indexOf("\n\n");
    const tail = blank === -1 ? "" : rest.slice(blank);
    next = `${current.slice(0, start)}${block}${tail}`;
  }
  return next.slice(0, BRIEF_MAX_CHARS);
}

/** 有界并发跑上传(沿用画布契约里的 CANVAS_UPLOAD_MAX_CONCURRENCY)。 */
async function runWithConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

function metaForProduct() {
  return NODE_TYPE_ITEMS.find((item) => item.type === "product") ?? NODE_TYPE_ITEMS[0];
}

export const ProductNode = memo(function ProductNode({
  id,
  data,
  selected,
}: NodeProps<CanvasReactFlowNode>) {
  const { label, Icon } = metaForProduct();
  const readOnly = useCanvasReadOnly();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const commitTextEdit = useCanvasStore((state) => state.commitTextEdit);
  /** 与图片/视频节点同一档降级取向(阈值 0.4):低 zoom 只留简报,不渲染缩略图与控件。 */
  const lowZoom = useStore((state) => state.transform[2] < LOW_ZOOM_MEDIA_THRESHOLD);

  const [busy, setBusy] = useState<null | "upload" | "analyze">(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const brief = typeof data?.title === "string" ? data.title : "";
  const product = (data?.params?.product as CanvasProductState | undefined) ?? EMPTY_PRODUCT;
  const mainKey = data?.media?.ossKey ?? null;
  /** 主图恒为 data.media.ossKey(它过了归属+服务端就绪闸);其余在 params。 */
  const imageKeys = useMemo(
    () => (mainKey ? [mainKey, ...product.extraImageKeys] : [...product.extraImageKeys]),
    [mainKey, product.extraImageKeys]
  );
  const card = product.card ?? null;
  const analyzedFingerprint = useMemo(
    () => imageKeyFingerprint(product.analyzedImageKeys ?? []),
    [product.analyzedImageKeys]
  );
  const currentFingerprint = useMemo(() => imageKeyFingerprint(imageKeys), [imageKeys]);
  const alreadyAnalyzed = Boolean(card) && currentFingerprint === analyzedFingerprint;

  /**
   * 唯一的文档写入出口。**必须 spread 旧 params**(否则抹掉 params.generation),
   * 并且**检查返回值** —— 只读/未 hydrate 下它是静默 false。
   *
   * ⚠️ 传 `media: undefined` 表示「清空主图」,走 store 的 `unset` 删键通道而**不是**把
   * `media` 写成 undefined —— 后者会留下值为 undefined 的 own 键,被持久化层判否,整次写入
   * 静默失败(同文件头坑 1;2026-08-14「移除最后一张图」踩的就是这条)。
   */
  const writeNode = useCallback(
    (patch: { media?: { ossKey: string } | undefined; product?: CanvasProductState; title?: string }, failLabel: string): boolean => {
      const state = useCanvasStore.getState();
      const node = state.nodes.find((item) => item.id === id);
      const oldParams: CanvasNodeParams = node?.data.params ?? {};
      const nextData: Record<string, unknown> = {};
      const unset: CanvasNodeDataUnsettableKey[] = [];
      if (patch.title !== undefined) nextData.title = patch.title;
      if ("media" in patch) {
        if (patch.media) nextData.media = patch.media;
        else unset.push("media");
      }
      if (patch.product) nextData.params = { ...oldParams, product: patch.product };
      const ok = updateNodeData(id, nextData, unset.length > 0 ? { unset } : undefined);
      if (!ok) {
        // 三条失败路径的文案必须分开。原先一律说「只读或写者锁不在本标签页」,而真正在发生的是
        // 第三条(补丁没过校验):它把人往锁上引,2026-08-14 就是这样查了半天写者锁。
        const description = state.readOnly
          ? "画布是只读态(别人正在编辑,或你没有写权限),这次改动没有保存。"
          : !state.hydrated || state.sessionCanvasId !== state.hydratedCanvasId
            ? "画布还没就绪,或写者锁不在本标签页,这次改动没有保存。"
            : "这次改动没通过画布校验,内容已按原样保留。这是程序缺陷,请把刚才的操作步骤反馈给我们。";
        toast({ title: failLabel, description, variant: "destructive" });
        return false;
      }
      commitTextEdit();
      return true;
    },
    [commitTextEdit, id, updateNodeData]
  );

  const handlePickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const remaining = MAX_PRODUCT_IMAGES - imageKeys.length;
      if (remaining <= 0) {
        toast({
          title: "商品图已满",
          description: `最多 ${MAX_PRODUCT_IMAGES} 张,先移除一张再加。`,
          variant: "destructive",
        });
        return;
      }
      const chosen = Array.from(files).slice(0, remaining);
      if (chosen.length < files.length) {
        toast({
          title: `只取了前 ${chosen.length} 张`,
          description: `本节点还能放 ${remaining} 张(上限 ${MAX_PRODUCT_IMAGES})。`,
        });
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setBusy("upload");
      try {
        const prepared = await prepareCanvasUploads(chosen, controller.signal);
        const uploaded = await runWithConcurrency(
          prepared.map(
            (item) => () => uploadPreparedCanvasFile(item, { signal: controller.signal })
          ),
          CANVAS_UPLOAD_MAX_CONCURRENCY
        );
        const keys = uploaded
          .filter((result) => result.kind === "image")
          .map((result) => result.ossKey);
        if (keys.length === 0) throw new CanvasUploadError("INVALID_RESPONSE", "没有可用的商品图");

        const nextMain = mainKey ?? keys[0];
        const nextExtra = [
          ...product.extraImageKeys,
          ...(mainKey ? keys : keys.slice(1)),
        ].slice(0, MAX_PRODUCT_IMAGES - 1);
        writeNode(
          {
            media: { ossKey: nextMain },
            product: { ...product, extraImageKeys: nextExtra },
          },
          "商品图已上传,但没能存进画布"
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast({
          title: "上传失败",
          description:
            error instanceof CanvasUploadError
              ? error.message
              : error instanceof Error
                ? error.message
                : "未知错误",
          variant: "destructive",
        });
      } finally {
        abortRef.current = null;
        setBusy(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [imageKeys.length, mainKey, product, writeNode]
  );

  const handleRemoveImage = useCallback(
    (key: string) => {
      const nextKeys = imageKeys.filter((item) => item !== key);
      const nextMain = nextKeys[0];
      // 图变了就作废防重指纹,否则换了图还以为「解析过了」。
      // 🔴 必须**把这个键摘掉**,不能把它写成 undefined(文件头坑 1):zod 会原样保留
      // 这个 own 键,`isPersistableJsonValue` 随即判否,`updateNodeData` 静默返回 false ——
      // 2026-08-14 「移除商品图」在任何画布上都用不了,根因就是这一行。
      const { analyzedImageKeys: _fingerprintDropped, ...productWithoutFingerprint } = product;
      writeNode(
        {
          media: nextMain ? { ossKey: nextMain } : undefined,
          product: { ...productWithoutFingerprint, extraImageKeys: nextKeys.slice(1) },
        },
        "移除商品图失败"
      );
    },
    [imageKeys, product, writeNode]
  );

  /**
   * `force` = 用户点了「重新解析」,明确要对同一组图再跑一次(2026-08-09 用户裁决:批准可以再花一次)。
   * 不传 force 时指纹闸仍然生效 —— 它挡的是刷新/重挂后的无意重跑,那才是白花厂商调用的地方。
   */
  const handleAnalyze = useCallback(async (options?: { force?: boolean }) => {
    if (busy) return;
    if (imageKeys.length === 0) {
      toast({ title: "先上传商品图", description: "卖点卡是从商品图看出来的。" });
      return;
    }
    if (alreadyAnalyzed && !options?.force) {
      // 不要在这里指路去点「重新解析」—— 那个按钮就是本分支的调用方,会绕成死循环
      // (2026-08-14 缺陷甲)。它现在带 force 进来,压根走不到这儿。
      toast({
        title: "这组图已经解析过了",
        description: "下面的卡片就是上次的结果。换图或加图后会自动重新解析。",
      });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("analyze");
    try {
      // key → 公有 URL **只存在于这次请求体里**,绝不进 node data(铁律 3)。
      const imageUrls = await Promise.all(
        imageKeys.map((key) => resolveMediaUrl(key, { signal: controller.signal }))
      );
      const response = await fetch("/api/studio/analyze-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrls }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; data?: { card?: ProductCard } }
        | null;
      if (!response.ok || !payload?.success || !payload.data?.card) {
        throw new Error(payload?.error ?? `商品图分析失败(HTTP ${response.status})`);
      }
      const nextCard = toCanvasProductCard(payload.data.card);
      const ok = writeNode(
        {
          product: {
            ...product,
            card: nextCard,
            // 成功才写指纹 —— 失败也写会把这组图永久钉死在「已解析」。
            analyzedImageKeys: [...imageKeys].sort(),
          },
        },
        "解析完成,但卡片没能存进画布"
      );
      if (ok) {
        toast({
          title: "卖点卡已生成",
          description: `${nextCard.selling_points.length} 条卖点。勾选后点「插入到简报」才会进提示词。`,
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast({
        title: "解析失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }, [alreadyAnalyzed, busy, imageKeys, product, writeNode]);

  const handleToggleSellingPoint = useCallback(
    (pointId: string) => {
      if (!card) return;
      const nextCard: CanvasProductCard = {
        ...card,
        selling_points: card.selling_points.map((point) =>
          point.id === pointId ? { ...point, selected: !point.selected } : point
        ),
      };
      writeNode({ product: { ...product, card: nextCard } }, "勾选未能保存");
    },
    [card, product, writeNode]
  );

  const handleInsertToBrief = useCallback(() => {
    if (!card) return;
    if (!card.selling_points.some((point) => point.selected)) {
      toast({ title: "先勾选至少一条卖点", variant: "destructive" });
      return;
    }
    const next = mergeBriefBlock(brief, renderBriefBlock(card));
    if (next === brief) {
      toast({ title: "简报里已经是这段了" });
      return;
    }
    if (writeNode({ title: next }, "插入简报失败")) {
      toast({
        title: "已插入商品简报",
        description: "这段会逐字作为提示词送给厂商,可以直接在上面改。",
      });
    }
  }, [brief, card, writeNode]);

  const controlsDisabled = readOnly || busy !== null;

  return (
    <NodeShell
      nodeId={id}
      label={label}
      Icon={Icon}
      selected={selected}
      wide={Boolean(selected && !lowZoom)}
    >
      <textarea
        className="nodrag nopan block w-full resize-none rounded border border-border bg-background/60 px-2 py-1 text-xs leading-relaxed text-foreground outline-none focus:border-ring"
        rows={4}
        maxLength={BRIEF_MAX_CHARS}
        value={brief}
        placeholder="填写商品名称、卖点、材质、受众与使用场景…"
        readOnly={readOnly}
        aria-label="商品简报"
        onChange={(event) => updateNodeData(id, { title: event.target.value })}
        onBlur={() => commitTextEdit()}
      />

      {/* 低 zoom 整体降级:不渲染缩略图与任何可点控件,只留简报与一行状态。
          与图片/视频节点同一取向 —— 低 zoom 的目的是不解码媒体、也不给出误触面。 */}
      {lowZoom ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          {imageKeys.length > 0 ? `${imageKeys.length} 张商品图` : "暂无商品图"}
          {card ? " · 卖点卡已生成" : ""}
        </p>
      ) : (
        <>
          {imageKeys.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {imageKeys.map((key, index) => (
                <ProductThumb
                  key={key}
                  ossKey={key}
                  isMain={index === 0}
                  disabled={controlsDisabled}
                  onRemove={() => handleRemoveImage(key)}
                />
              ))}
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={PRODUCT_IMAGE_ACCEPT}
              multiple
              className="hidden"
              aria-label="上传商品图"
              onChange={(event) => void handlePickFiles(event.target.files)}
            />
            <button
              type="button"
              className="nodrag nopan inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              disabled={controlsDisabled || imageKeys.length >= MAX_PRODUCT_IMAGES}
              title={
                imageKeys.length >= MAX_PRODUCT_IMAGES
                  ? `最多 ${MAX_PRODUCT_IMAGES} 张`
                  : "上传商品图"
              }
              onClick={() => fileInputRef.current?.click()}
            >
              {busy === "upload" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ImagePlus className="h-3 w-3" />
              )}
              上传图 {imageKeys.length}/{MAX_PRODUCT_IMAGES}
            </button>
            <button
              type="button"
              className="nodrag nopan inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              disabled={controlsDisabled || imageKeys.length === 0}
              title={
                imageKeys.length === 0
                  ? "先上传商品图"
                  : alreadyAnalyzed
                    ? "这组图已解析过,点这里强制重跑(会再花一次厂商调用)"
                    : "调用视觉模型,从商品图提炼卖点卡"
              }
              onClick={() => void handleAnalyze({ force: alreadyAnalyzed })}
            >
              {busy === "analyze" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : alreadyAnalyzed ? (
                <RefreshCw className="h-3 w-3" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {busy === "analyze" ? "解析中…" : alreadyAnalyzed ? "重新解析" : "解析卖点"}
            </button>
          </div>

          {card && (
            <div className="mt-1.5 rounded border border-amber-500/25 bg-amber-500/5 p-1.5">
              <div className="flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                <Package className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={card.title}>
                  {card.title}
                </span>
                <span className="shrink-0 opacity-70">
                  {card.selling_points.filter((point) => point.selected).length}/
                  {card.selling_points.length}
                </span>
              </div>
              <div className="mt-1 space-y-0.5">
                {card.selling_points.map((point) => (
                  <label
                    key={point.id}
                    className="nodrag nopan flex cursor-pointer items-start gap-1 text-[10px] leading-snug text-foreground"
                  >
                    <input
                      type="checkbox"
                      className="mt-[2px] h-2.5 w-2.5 shrink-0 accent-amber-500 disabled:opacity-40"
                      checked={point.selected}
                      disabled={controlsDisabled}
                      onChange={() => handleToggleSellingPoint(point.id)}
                    />
                    <span className="min-w-0 flex-1">
                      {point.text}
                      {point.evidence && (
                        <span className="ml-1 text-muted-foreground">({point.evidence})</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              {card.audience.length > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  目标人群:{card.audience.join("、")}
                </p>
              )}
              <button
                type="button"
                className="nodrag nopan mt-1 w-full rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-700 transition-colors hover:bg-amber-500/10 disabled:pointer-events-none disabled:opacity-40 dark:text-amber-300"
                disabled={controlsDisabled}
                onClick={handleInsertToBrief}
              >
                插入到简报
              </button>
            </div>
          )}

          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            简报文本会作为提示词进入下游生成。
            {mainKey
              ? "主图(第 1 张)会作为下游的参考图;其余图只用于生成卖点卡。"
              : "商品图用于生成卖点卡;上传后主图还会作为下游的参考图。"}
          </p>
        </>
      )}
    </NodeShell>
  );
});

/** 单张商品图缩略图。只在 `!lowZoom` 分支里渲染(**与 selected 无关**),所以不必自带降级。 */
const ProductThumb = memo(function ProductThumb({
  ossKey,
  isMain,
  disabled,
  onRemove,
}: {
  ossKey: string;
  isMain: boolean;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // 挂载即解析一次;卸载 abort。URL 只进组件 state,不进 node data。
  // ⚠️ 必须是 useEffect 不是 useMemo —— useMemo 在渲染期跑、返回值不会被当 cleanup 调用,
  // abort 会形同虚设,而且 setState 会在渲染中触发。
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    resolveMediaUrl(ossKey, { signal: controller.signal })
      .then((next) => {
        if (alive) setUrl(next);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [ossKey]);

  return (
    <span
      className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded border border-border bg-muted"
      title={isMain ? "主图(会作为下游参考图)" : "仅用于卖点分析"}
    >
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <Package className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      {isMain && (
        <span className="absolute left-0 top-0 bg-amber-500/90 px-0.5 text-[8px] leading-tight text-white">
          主
        </span>
      )}
      <button
        type="button"
        className="nodrag nopan absolute bottom-0 right-0 bg-background/80 p-0.5 text-muted-foreground transition-colors hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
        aria-label="移除这张商品图"
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </span>
  );
});
