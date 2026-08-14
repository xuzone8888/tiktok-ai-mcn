"use client";

import { useEffect, useState } from "react";

import type { GenerationImageReference } from "../generation-input-order";
import { peekMediaUrl, resolveMediaUrl } from "../media-url-cache";

/**
 * 生成器引用区(CHECKLIST #44「连线后上游产物自动进下游生成器引用区(缩略图带序号)」,
 * 承载 #72 图片 chip:+参考 / #94 视频 chip:+参考 的「已引用」这一面)。
 *
 * 在此之前,面板对上游参考图的全部表达只有模式选项后面那个计数 ——「图生视频 (2)」。
 * 用户看不出是哪两张、也看不出谁是第 1 张,而提示词里写「与图1保持一致」恰恰依赖这个序号。
 *
 * 三条纪律:
 *  - **序号由 `orderGenerationInputNodes` 决定,与提交路径同源**,不在这里另算(否则 UI 说的
 *    「图1」和请求里的第 1 张会对不上,而那要花钱才发现);
 *  - object key → URL 走 `media-url-cache` 换**瞬态**签名 URL,**绝不写回节点/持久层**(ADR5);
 *  - 解析失败只降级成占位块,不整块消失 —— 引用关系存在与否比缩略图能不能显示更重要。
 */
export function GenerationReferenceStrip({
  references,
  onAddReference = null,
  addDisabledReason = null,
}: {
  references: readonly GenerationImageReference[];
  /**
   * 「+参考」入口(CHECKLIST #182 / #72 / #94)。给了它,0 张时这一行**仍然渲染**。
   *
   * 这是有意的:0 张时整块隐身正是「用户不知道连张图进来就是图生图」的成因,
   * 而那个发现性缺口在 #92 的裁决理由里被点名过。加与看放在同一处,
   * 「图N」的编号也就天然共用同一个真相源,不会各算各的。
   */
  onAddReference?: (() => void) | null;
  /** 非 null = 「+」灰置并说明原因(事前告知,不要等点了生成才报错)。 */
  addDisabledReason?: string | null;
}) {
  if (references.length === 0 && !onAddReference) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground">
        引用区 · {references.length} 张参考图
        {references.length > 0 ? (
          <span className="ml-1 opacity-70">
            （提示词里可用「{references[0].label}」指代第一张）
          </span>
        ) : (
          <span className="ml-1 opacity-70">
            （连一个图片节点进来即为图生图；也可按「+」或在提示词里输入 @ 选）
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {references.map((reference) => (
          <ReferenceThumb key={reference.nodeId} reference={reference} />
        ))}
        {onAddReference && (
          <button
            type="button"
            className="nodrag nopan flex h-11 w-11 shrink-0 items-center justify-center rounded border border-dashed border-border text-base leading-none text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="添加参考素材"
            title={addDisabledReason ?? "引用画布上的素材，或从历史记录里选一张"}
            disabled={Boolean(addDisabledReason)}
            onClick={onAddReference}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

function ReferenceThumb({
  reference,
}: {
  reference: GenerationImageReference;
}) {
  const [url, setUrl] = useState<string | null>(() =>
    peekMediaUrl(reference.ossKey)
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cached = peekMediaUrl(reference.ossKey);
    if (cached) {
      setUrl(cached);
      setFailed(false);
      return;
    }
    // key 变化/卸载时 abort 本缩略图的等待;共享请求本身由缓存层管,不受影响。
    const controller = new AbortController();
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    resolveMediaUrl(reference.ossKey, { signal: controller.signal })
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reference.ossKey]);

  return (
    <div
      className="relative h-11 w-11 overflow-hidden rounded border border-border bg-muted"
      title={`${reference.label}（连线顺序第 ${reference.index} 张）`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- 签名 URL 是瞬态的，不能进 next/image 的优化缓存
        <img
          src={url}
          alt={`${reference.label} 参考图缩略图`}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
          {failed ? "加载失败" : "…"}
        </span>
      )}
      {/* 序号常显:缩略图本身长得像,不标号就分不出谁是「图1」。 */}
      <span className="absolute bottom-0 left-0 bg-background/85 px-1 text-[9px] leading-tight text-foreground">
        {reference.label}
      </span>
    </div>
  );
}
