/**
 * 超级画布 · 「哪些上游节点算参考图输入」的**唯一判据**
 *
 * ## 为什么必须只有一处
 *
 * 参考图判据同时被四个地方消费,而它们必须给出**逐字一致**的结果:
 *
 * 1. 提交路径(`canvas-generation-context.tsx` 的 `imageInputNodes`)—— 决定请求里送哪几张;
 * 2. 服务端权威重算(`generation-service.ts` 的 `imageNodes`)—— 与客户端快照逐字比对,
 *    不等就抛 `CANVAS_INPUTS_CHANGED`(409);
 * 3. 引用区编号(`generation-input-order.ts` 的 `collectImageReferences`)—— 决定「图N」指谁;
 * 4. 「输入已更新」角标(#43 的 `recomputeGenerationInputs`)—— 与持久化快照比对。
 *
 * 任何一处与其它三处漂移,后果都是**要花钱才发现**的那一类:
 * 客户端多算一张 → 线上提交全部 409;客户端少算一张 → 用户照着错编号写提示词、
 * 按全价扣分、拿回不对的图;角标那处漂移 → 角标永久常亮或永远不亮。
 * 所以这里不导出「类型列表」让各处自己 filter,只导出**判据函数本身**。
 *
 * ## 语义(2026-08-10 用户裁决)
 *
 * 参考图输入 = `type` 为 `image` 或 `product`,**且** `data.media.ossKey` 非空。
 *
 * 商品节点纳入是用户裁决的结果:电商轨的语义是「商品节点起 → 逐镜图」,
 * 用户挂了商品图却发现厂商没收到会当 bug 报。
 * 这半条能力在 CHECKLIST 里原属 **#169「商品双身份规则」(P2)**,
 * 经用户裁决把「商品主图作参考图输入」这一半提前到 P1 批 5;
 * #169 剩下的「自动建道具类资产 / @商品即引用」仍留 P2。
 *
 * ⚠️ **只认主图 `data.media.ossKey`,不认 `params.product.extraImageKeys`。**
 * 主图走完了归属校验与服务端就绪闸(`canvas_upload_reservations` 的 ready 行);
 * 第 2..9 张只落在 `params` 里、**没过就绪闸**,把它们送进一次要扣费的生成请求
 * 会变成「扣了费才由厂商侧报对象不存在」。这条收窄是刻意的,别顺手放宽。
 *
 * ⚠️ **不要拿它去判「空图片节点」。** 空图片节点在提交时要单独报错
 * (`相连图片节点尚无可用内容`),而**没有图的商品节点是完全合法的**
 * (它照样贡献商品简报文本)。那处判据必须保持只看 `type === "image"`。
 */

/** 判据的最小结构;各调用方的节点类型(CanvasNode / RF 节点 / 松散 payload)都能喂进来。 */
export interface CanvasImageInputCandidate {
  type?: string | null;
  data?: {
    media?: { ossKey?: string | null } | null;
  } | null;
}

/**
 * 该上游节点是否算一张参考图输入。
 *
 * 判据见本文件抬头 —— **新增消费点一律调本函数,不要就地 filter。**
 */
export function isCanvasImageInputNode(node: CanvasImageInputCandidate): boolean {
  if (node.type !== "image" && node.type !== "product") return false;
  const ossKey = node.data?.media?.ossKey;
  return typeof ossKey === "string" && ossKey.length > 0;
}
