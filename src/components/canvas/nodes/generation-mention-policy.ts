/**
 * @引用素材的**候选与按键策略**(CHECKLIST #182)· 纯函数,零 import
 *
 * ## @ 引用到底是什么
 *
 * 画布上「引用」的唯一真实表达是 **edge**。服务端从不读客户端传来的
 * `referenceNodeIds`,而是**纯从 `doc.edges` 重算**上游,再强制 `referenceNodeIds`
 * 与 `inputs` 里的图片项逐位全等。所以:
 *
 * - **@ 的第一动作恒为「建一条边」**;
 * - 「只在提示词里写『图1』而不建边」= **什么引用都没建** —— 用户付全价拿回一张没垫图的图,
 *   静默、且要花钱才发现。插字只是给人看的第二步,绝不是引用机制本身。
 *
 * ## 为什么候选要在**选取之前**就判定可选性
 *
 * `canAddCanvasEdge` 只禁自环 / 悬空端 / 重复边 —— **不校验节点类型、不管张数**。
 * 而超限与类型不符的报错都在 `buildGenerationIntent` 里抛,那已经是
 * **#185 确认花费弹窗之后**的事:用户先确认了要花钱,才被告知不能生成。
 * 这正是 #186 立项要消灭的「点了才知道不行」。
 * 所以过滤责任全部落在本模块,且必须与提交路径的判据逐字同源。
 *
 * ## 判据同源清单(改这里之前先核对提交路径)
 *
 * - 只接受 `text` / `product` / `image` 三类上游(其余提交时硬抛);
 * - 图片节点必须有 `media.ossKey`(空图片节点提交时单独报错,也不占「图N」编号);
 * - 图片生成最多 1 张参考图;视频按模型 `maxImages`;
 * - 文生视频**不使用**图片输入(连了会硬抛)。
 */

/** 候选节点的最小形状(只取判定要用的字段)。 */
export interface MentionCandidateNode {
  id: string;
  type?: string;
  data?: {
    title?: string | null;
    media?: { ossKey?: string | null } | null;
  } | null;
}

export interface MentionCandidate {
  nodeId: string;
  /** 原始节点类型,供 UI 选图标。 */
  type: string;
  /** 展示名;没有标题就退回类型名,绝不展示空白条目。 */
  title: string;
  /** 是否已经连进本节点。 */
  connected: boolean;
  disabled: boolean;
  /** 灰置原因;`disabled` 为 false 时是 null。**必须能直接说给用户听。** */
  reason: string | null;
}

export interface MentionCandidateInput {
  nodes: readonly MentionCandidateNode[];
  /** 已连进本节点的上游 id(按连线序,来自 orderGenerationInputNodes)。 */
  connectedNodeIds: readonly string[];
  targetNodeId: string;
  targetKind: "image" | "video";
  /** 视频节点当前模式;图片节点传 undefined。 */
  videoMode?: "prompt_to_video" | "image_to_video";
  /** 本节点还能接几张参考图:图片恒 1;视频 image_to_video = 模型 maxImages;文生视频 = 0。 */
  referenceLimit: number;
  /** 当前已连进来的**有内容的**图片数。 */
  incomingImageCount: number;
}

const TYPE_LABEL: Record<string, string> = {
  text: "文本",
  product: "商品",
  image: "图片",
  video: "视频",
};

function displayTitle(node: MentionCandidateNode): string {
  const raw = typeof node.data?.title === "string" ? node.data.title.trim() : "";
  if (raw) return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
  return `未命名${TYPE_LABEL[node.type ?? ""] ?? "节点"}节点`;
}

/**
 * 算出 @ 选择器该列哪些候选、哪些灰掉、灰掉的理由是什么。
 *
 * 返回顺序 = 传入的 `nodes` 顺序,**但这个顺序只用于展示**;
 * 「图N」的编号一律由 `previewImageReferencesAfterConnect` 现算,不看这里。
 */
export function resolveMentionCandidates(
  input: MentionCandidateInput
): MentionCandidate[] {
  const connected = new Set(input.connectedNodeIds);
  const imageFull = input.incomingImageCount >= input.referenceLimit;
  const promptOnlyVideo =
    input.targetKind === "video" && input.videoMode === "prompt_to_video";

  const candidates: MentionCandidate[] = [];
  for (const node of input.nodes) {
    if (node.id === input.targetNodeId) continue;
    const type = node.type ?? "";
    // 只列提交路径真正接受的三类;video/script/compose 等一律不出现在候选里 ——
    // 列出来再灰掉不如不列,后者会让用户以为「以后能连」。
    if (type !== "text" && type !== "product" && type !== "image") continue;

    const isConnected = connected.has(node.id);
    let disabled = false;
    let reason: string | null = null;

    if (isConnected) {
      disabled = true;
      reason = "已经连进这个节点了";
      // ⚠️ **已知缺口(批 5 记账,非阻断)**:商品节点带主图后同样占一张参考图额度
      // (判据见 `src/lib/canvas/generation-image-input.ts`),但这里**没有**对它做
      // 超限/模式判定 —— 用户 @ 一个带图商品节点进已满的目标,会在**提交时**被硬闸拦下
      // (客户端 pre-submit throw,零扣费、文案明确),而不是在候选里就灰掉。
      // 不在此处修的原因:本模块被 `verify-canvas-generation-frontend.mjs` 用
      // 「#182 mention policy stays import-free」硬断言守着零 import,
      // 引入共用判据会破掉那条刻意设立的离线穷举前提。
      // 正解是把「是否占图额度」由调用方(已持有共用判据)算好、经入参传进来,
      // 属独立小改,不混进批 5。
    } else if (type === "image") {
      const ossKey = node.data?.media?.ossKey;
      if (typeof ossKey !== "string" || ossKey.length === 0) {
        disabled = true;
        reason = "这个图片节点还没有内容";
      } else if (promptOnlyVideo) {
        disabled = true;
        reason = "文生视频不使用图片输入；把模式改成图生视频后才能引用图片";
      } else if (imageFull) {
        disabled = true;
        reason =
          input.referenceLimit === 1
            ? "本节点最多用 1 张参考图；先断开现有的那条图片连线"
            : `本节点最多用 ${input.referenceLimit} 张参考图，已经连满了`;
      }
    }

    candidates.push({
      nodeId: node.id,
      type,
      title: displayTitle(node),
      connected: isConnected,
      disabled,
      reason,
    });
  }
  return candidates;
}

/**
 * 提及弹层开着时,一次按键该做什么。
 *
 * **返回值集合里没有任何等于「提交」的值** —— 这是有意的,也被 verifier 断言着:
 * 弹层开着时按 Enter 是「选中候选」,绝不能变成一次付费提交。
 *
 * `composing` 为真时恒 `passthrough`:中文输入法组字期的按键属于输入法,
 * 抢过来会让用户选词被吞(这是本仓既有纪律,Ctrl+Enter 那条也同样处理)。
 */
export type MentionKeyAction = "insert" | "navigate" | "close" | "passthrough";

export function decideMentionKey(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  composing: boolean;
  popupOpen: boolean;
}): MentionKeyAction {
  if (input.composing) return "passthrough";
  if (!input.popupOpen) return "passthrough";
  if (input.ctrlKey || input.metaKey) return "passthrough";
  if (input.key === "Escape") return "close";
  if (input.key === "ArrowDown" || input.key === "ArrowUp") return "navigate";
  if (input.key === "Enter" || input.key === "Tab") return "insert";
  return "passthrough";
}

/**
 * 判断一次按键是不是「唤起提及」。
 *
 * 半角 `@` 与全角 `＠` 都认:中文输入法下按 Shift+2 上屏的往往是全角。
 * 组字期一律不认 —— 与 Ctrl+Enter 同一条纪律。
 */
export function isMentionTriggerKey(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  composing: boolean;
}): boolean {
  if (input.composing) return false;
  if (input.ctrlKey || input.metaKey) return false;
  return input.key === "@" || input.key === "＠";
}

/**
 * 把选中的指代写进提示词,并**吃掉唤起用的那个 `@`**。
 *
 * 这一步不是可有可无的收尾:提示词是 `node.data.title` 本身,
 * 会**逐字送到厂商**,中间没有任何编译或清洗环节。
 * 若只插入「图2」而把触发用的 `@` 留在原地,用户就会为一条含孤立 `@` 的提示词付全价。
 *
 * `triggerIndex` 是那个 `@` 在**当前文本**里的下标;传 -1 表示不是由 @ 唤起的
 * (例如点引用区的「+」),此时纯插入、不删任何字符。
 */
export function applyMentionInsert(input: {
  text: string;
  caret: number;
  triggerIndex: number;
  label: string;
}): { text: string; caret: number } {
  const { text, label } = input;
  const caret = Math.max(0, Math.min(input.caret, text.length));
  const start =
    input.triggerIndex >= 0 && input.triggerIndex < caret
      ? input.triggerIndex
      : caret;
  const before = text.slice(0, start);
  const after = text.slice(caret);
  // 与前文之间补一个空格,免得粘成「主体图1」这种读不出来的串。
  const needsSpace = before.length > 0 && !/\s$/.test(before);
  const inserted = `${needsSpace ? " " : ""}${label}`;
  return {
    text: `${before}${inserted}${after}`,
    caret: before.length + inserted.length,
  };
}
