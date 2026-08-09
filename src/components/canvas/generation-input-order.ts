/**
 * 生成输入的**唯一排序真相源**(CHECKLIST #44 引用区序号 / #72 / #94)。
 *
 * ## 为什么必须只有一份
 *
 * 在此之前有两份、且不一致:
 *  - 提交路径 `generationInputNodes`(canvas-generation-context.tsx)按**连线顺序**取上游,
 *    去重时保留首次出现;
 *  - 生成面板的 `incoming`(nodes/generation-controls.tsx)先收集上游 id 成 Set,再用
 *    `nodes.filter(idSet.has)` 取——那是**节点数组顺序**。
 *
 * 两者只要顺序不同,面板上标的「图1 / 图2」就可能与请求里真正的第 1、第 2 张参考图对不上。
 * 之前没暴露,是因为面板只拿它算了个**数量**(与顺序无关);一旦按序号渲染缩略图,
 * 这就变成「用户照着错编号写提示词、按全价扣了分、拿回不对的图」——静默、且要花钱才发现。
 *
 * 所以两边一律走本函数。**新增任何消费上游节点顺序的地方,也必须走这里,不要再就地 filter。**
 *
 * ## 语义
 *
 * 以**连线顺序**为准(edges 数组序),同一上游节点连多条边只算一次、按首次出现定位。
 * 连线顺序是用户自己连出来的、在文档里稳定持久,比节点数组顺序(受建节点/撤销/重排影响)
 * 更贴近用户心智里的「第一张图」。
 */

interface HasId {
  id: string;
}

interface HasEndpoints {
  source: string;
  target: string;
}

/** 按连线顺序取指向 `targetNodeId` 的上游节点;重复连线去重,保留首次出现的位置。 */
export function orderGenerationInputNodes<N extends HasId, E extends HasEndpoints>(
  nodes: readonly N[],
  edges: readonly E[],
  targetNodeId: string
): N[] {
  const byId = new Map<string, N>();
  for (const node of nodes) byId.set(node.id, node);
  const seen = new Set<string>();
  const ordered: N[] = [];
  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue;
    if (seen.has(edge.source)) continue;
    seen.add(edge.source);
    const node = byId.get(edge.source);
    if (node) ordered.push(node);
  }
  return ordered;
}

/** 引用区里的一张参考图。`label` 与提示词中的「图N」指代同一张。 */
export interface GenerationImageReference {
  nodeId: string;
  ossKey: string;
  /** 1 起的连线序。 */
  index: number;
  /** 展示与提示词共用的指代,如「图1」。 */
  label: string;
}

interface HasImagePayload extends HasId {
  type?: string;
  data?: { media?: { ossKey?: string | null } | null; title?: string | null };
}

/**
 * 从**已排好序**的上游节点里挑出可用作参考图的那些,并编号。
 *
 * 只收 `type === "image"` 且 `media.ossKey` 非空的节点 —— 与提交路径的
 * `imageInputNodes` 判据逐字一致(空图片节点在提交时会被单独报错,不该占用编号)。
 */
export function collectImageReferences(
  orderedInputs: readonly HasImagePayload[]
): GenerationImageReference[] {
  const refs: GenerationImageReference[] = [];
  for (const node of orderedInputs) {
    if (node.type !== "image") continue;
    const ossKey = node.data?.media?.ossKey;
    if (typeof ossKey !== "string" || ossKey.length === 0) continue;
    const index = refs.length + 1;
    refs.push({ nodeId: node.id, ossKey, index, label: `图${index}` });
  }
  return refs;
}
