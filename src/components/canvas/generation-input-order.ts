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

/**
 * 「输入已更新」判定(CHECKLIST #43 dirty 角标)· 纯函数
 *
 * ## 快照从哪来 —— 不新建存储
 *
 * CHECKLIST #43 备注写的做法是「节点存上游 generationId 快照,比对即知」。
 * **这个做法不必要,而且它描述的比对口径是不完备的**,两点更正:
 *
 * 1. **快照早就在文档里了**:每次提交都会把完整 intent 写进 `params.generation`
 *    (`canvas-generation-context.tsx` 提交路径),其中 `inputs[]` 就是「这次用的上游」的
 *    逐项快照(文本存 `textSha256`、图片存 `ossKey` 且自身跑过生成时另带 `generationId`)。
 *    而 `clearPersistedGenerationIntent` **只在两处**被调用 —— 提交确定性失败、
 *    以及用户点「放弃这次提交」;**成功路径不清除**。所以它在产物产生后依然留在文档里。
 *    ⇒ #43 是**纯派生**:拿它与「当前文档重算值」比一比即可,
 *    **不新增 params 键、不新增任何 `updateNodeData` 调用**。
 *    这一点很要紧:任何自动写文档都要过写者租约,会往 undo 栈里插一条用户没做过的步骤、
 *    清空重做栈、并在只读态下静默失败(角标永远不亮)。
 *
 * 2. **只比 `generationId` 会漏检**:上传的图、#82 裁剪出来的图、从素材库推过来的图,
 *    `refs.generationId` 恒为 null(只有节点自己跑过生成才会被写)。
 *    用户把上游换成另一张上传图是最常见的换图方式之一,只比 generationId 会完全看不见。
 *    ⇒ 判据必须是 **`ossKey` 与 `generationId` 一起比**。
 *
 * ## 为什么不复用提交路径的「取上游」逻辑
 *
 * 提交路径(`buildGenerationIntent`)在数量超限时是**抛错**的
 * (「图片生成最多支持 1 张参考图」等三处),而那几个判据吃的是**未截断**的数组。
 * 若为了共用而把它改成先 `slice` 再判,那几条硬闸会变成**恒不成立的死代码**,
 * 把「报错」悄悄变成「静默截断」——那是付费路径,不能动。
 * 所以本函数**只做比较,不参与取数与限张**,提交路径一行不改。
 *
 * ## 语义
 *
 * 逐位比对(顺序敏感)。顺序变化算 dirty:上游顺序决定提示词里「图1/图2」的指代,
 * 顺序一变,同一句提示词的含义就变了 —— 这与 #44 把「序号-顺序绑定」当作
 * 付费正确性问题来守是同一个理由。
 */

/** 与 intent `inputs[]` 同形的最小比较单元(只取参与判定的字段)。 */
export interface GenerationInputSnapshotLike {
  kind: string;
  nodeId: string;
  /** 文本输入的内容摘要。 */
  textSha256?: string | null;
  /** 图片输入的 OSS object key。 */
  ossKey?: string | null;
  /** 图片输入所属的生成 id;上传/裁剪/推参考得来的图没有这一项。 */
  generationId?: string | null;
}

export type GenerationInputDirtyReason =
  | "regenerated"
  | "replaced"
  | "text_changed"
  | "added"
  | "removed"
  | "reordered";

export interface GenerationInputDirtyState {
  dirty: boolean;
  /** 去重且顺序稳定,供 tooltip 用;不 dirty 时为空数组。 */
  reasons: GenerationInputDirtyReason[];
  /** 涉及的上游节点 id;current 序在前,removed 补末尾。 */
  changedNodeIds: string[];
}

const NOT_DIRTY: GenerationInputDirtyState = Object.freeze({
  dirty: false,
  reasons: Object.freeze([]) as unknown as GenerationInputDirtyReason[],
  changedNodeIds: Object.freeze([]) as unknown as string[],
});

function normalizeField(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 比「上次提交时用的上游」与「现在的上游」。
 *
 * `persisted` 为空 = 该节点没有留存的提交快照(老文档 / 从未提交 / 已放弃)
 * ⇒ **一律判 not dirty**。这一条是硬要求:生产上已有画布文档,
 * 若把「没有快照」判成 dirty,它们一上线就会每个下游节点全挂角标,功能立刻变噪音。
 */
export function compareGenerationInputSnapshots(
  persisted: readonly GenerationInputSnapshotLike[] | null | undefined,
  current: readonly GenerationInputSnapshotLike[] | null | undefined
): GenerationInputDirtyState {
  if (!persisted || !current) return NOT_DIRTY;

  const reasons: GenerationInputDirtyReason[] = [];
  const changed: string[] = [];
  const addReason = (reason: GenerationInputDirtyReason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const addNode = (nodeId: string) => {
    if (nodeId && !changed.includes(nodeId)) changed.push(nodeId);
  };

  const persistedIds = new Set(persisted.map((item) => item.nodeId));
  const currentIds = new Set(current.map((item) => item.nodeId));

  const limit = Math.max(persisted.length, current.length);
  for (let index = 0; index < limit; index += 1) {
    const before = persisted[index];
    const after = current[index];

    if (!before && after) {
      // 位置多出来的一项:它可能是新连的,也可能是别处删了导致整体前移。
      addReason(persistedIds.has(after.nodeId) ? "reordered" : "added");
      addNode(after.nodeId);
      continue;
    }
    if (before && !after) {
      addReason(currentIds.has(before.nodeId) ? "reordered" : "removed");
      addNode(before.nodeId);
      continue;
    }
    if (!before || !after) continue;

    if (before.nodeId !== after.nodeId) {
      // 同一位置换了个节点。分得清是「换人」还是「换序」:两边集合一致即为换序。
      const sameSet =
        persisted.length === current.length &&
        persisted.every((item) => currentIds.has(item.nodeId));
      addReason(sameSet ? "reordered" : "added");
      addNode(after.nodeId);
      continue;
    }

    if (before.kind !== after.kind) {
      addReason("replaced");
      addNode(after.nodeId);
      continue;
    }

    if (normalizeField(before.textSha256) !== normalizeField(after.textSha256)) {
      addReason("text_changed");
      addNode(after.nodeId);
    }

    const beforeKey = normalizeField(before.ossKey);
    const afterKey = normalizeField(after.ossKey);
    const beforeGen = normalizeField(before.generationId);
    const afterGen = normalizeField(after.generationId);
    if (beforeKey !== afterKey) {
      // 产物本身换了。上游重跑过一次生成(两边都有 generationId 且不同)叫 regenerated;
      // 换成一张上传/裁剪来的图叫 replaced —— 后者正是「只比 generationId」会漏掉的那一类。
      addReason(beforeGen && afterGen && beforeGen !== afterGen ? "regenerated" : "replaced");
      addNode(after.nodeId);
    } else if (beforeGen !== afterGen) {
      // key 没变而 generationId 变了:同一份产物被重新登记,不算内容变化。
      // 不判 dirty,否则一次无害的对账回写就会把角标点亮。
      continue;
    }
  }

  if (reasons.length === 0) return NOT_DIRTY;
  return { dirty: true, reasons, changedNodeIds: changed };
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

/**
 * 「连上这个节点之后,编号会变成什么样」(CHECKLIST #182 @引用素材)。
 *
 * **@ 选择器必须用它取编号,绝对不许自己数。** 理由是这个文件头部记的那件事:
 * 新边一律 append 到 `edges` 末尾,所以 @ 进来的图**必然拿最大的 N**;
 * 而选择器里的候选是按自己的列表顺序排的 —— 已有上游 a 时 @ 了 b,
 * 若按列表序编号就会插成「图1」,实际却是图2。
 * 那就是「用户照着错编号写提示词、按全价扣分、拿回不对的图」,**要花钱才发现**。
 *
 * 实现上刻意**复用** `orderGenerationInputNodes` + `collectImageReferences`,
 * 不复制其中任何一行 —— `图${n}` 这个串在全仓只能有一处产地。
 */
export function previewImageReferencesAfterConnect<
  N extends HasImagePayload,
  E extends HasEndpoints
>(
  nodes: readonly N[],
  edges: readonly E[],
  targetNodeId: string,
  newSourceId: string
): GenerationImageReference[] {
  const projected = [
    ...edges,
    { source: newSourceId, target: targetNodeId } as unknown as E,
  ];
  return collectImageReferences(
    orderGenerationInputNodes(nodes, projected, targetNodeId)
  );
}
