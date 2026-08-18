/**
 * 灰置控件的「如何解锁」指引(CHECKLIST #186)。
 *
 * 解决的问题:今天面板把「不能生成」只表达成一个灰掉的按钮。缺前置条件时(最典型的是
 * 选了图生视频却没连图),用户要等到**点了生成**才在 toast 里看到
 * 「图生视频需要先把至少一个有内容的图片节点连接到当前视频节点」——错误发现得太晚,
 * 而且那句话只说了缺什么,没说怎么补。
 *
 * 本模块把「为什么灰」与「怎么解锁」抽成纯函数,理由有三:
 *  ① 可离线单测,不用起浏览器就能穷举状态组合;
 *  ② 指引文案与灰置判定同源,不会出现「按钮灰了但指引说一切正常」;
 *  ③ 新增灰置原因时这里会漏出来(返回 null 即「说不出原因」,verifier 盯着)。
 *
 * 纪律:`steps` 描述的必须是**用户在当前界面上真找得到的东西**。写「点某某按钮」之前
 * 先确认那个按钮存在 —— 指错路比不指路更伤。
 */

export type GenerationLockKind =
  | "read_only"
  | "feature_disabled"
  | "submitting"
  | "running"
  | "uncertain"
  | "reconciling"
  | "missing_upstream_image"
  | "too_many_references"
  | "syncing";

export interface GenerationLockHint {
  kind: GenerationLockKind;
  /** 一句话说清「为什么现在不能生成」。 */
  reason: string;
  /** 解锁步骤;空数组=只能等,没有用户可做的动作。 */
  steps: string[];
}

export interface GenerationLockInput {
  readOnly: boolean;
  /** 画布生成功能总闸(灰度/权限)。 */
  enabled: boolean;
  submitting: boolean;
  /** pending / processing。 */
  active: boolean;
  /** 上游 unknown,等人工核对。 */
  uncertain: boolean;
  /** 本地存在未解析的幂等 actionId,正在核对。 */
  reconciling: boolean;
  syncState: "idle" | "loading" | "ready" | "error";
  /** 节点类型;图片节点没有「必须有上游图」这条前置。 */
  kind: "image" | "video";
  /** 视频节点当前选的模式。 */
  videoMode?: "prompt_to_video" | "image_to_video";
  /** 连进本节点的、有内容的图片节点数。 */
  incomingImageCount: number;
  /**
   * 本节点能接的参考图上限:图片恒 1;视频 image_to_video = 模型 maxImages;文生视频 = 0。
   * 缺省 undefined = 调用方还没接这条,跳过超限判定(不要瞎猜成 0,那会误灰整个面板)。
   */
  referenceLimit?: number;
}

/**
 * 判定当前为什么不能生成。返回 null = 没有已知阻断(控件应当可用)。
 *
 * 顺序即优先级:先讲不可协商的(只读/未开放),再讲「正在忙」,最后才讲用户能自己补的前置。
 * 这样用户永远先看到最硬的那条,不会被「去连张图」误导成「连了就能点」。
 */
export function resolveGenerationLockHint(
  input: GenerationLockInput
): GenerationLockHint | null {
  if (input.readOnly) {
    return {
      kind: "read_only",
      reason: "当前标签页是只读态,不能发起生成。",
      steps: [
        "同一画布只允许一个标签页写入;关掉另一个正在编辑本画布的标签页",
        "或等约 30 秒,本标签页会自动接管写入权",
      ],
    };
  }
  if (!input.enabled) {
    return {
      kind: "feature_disabled",
      reason: "本账号暂未开放画布生成功能。",
      steps: [],
    };
  }
  if (input.submitting) {
    return {
      kind: "submitting",
      reason: "本次提交正在发往服务端,防重复扣费已锁住按钮。",
      steps: [],
    };
  }
  if (input.active) {
    return {
      kind: "running",
      reason: "本节点已有任务在跑,完成或明确失败后才能再发起。",
      steps: ["等任务跑完", "或用「刷新状态」立即向服务端重新核对一次进度"],
    };
  }
  if (input.uncertain) {
    return {
      kind: "uncertain",
      reason: "上游是否接单暂不确定,为防重复扣费已停止重提。",
      steps: [
        "用「核对并恢复」按钮走一次幂等核对",
        "仍不确定的,请带上面板里的任务号联系管理员做人工裁决",
      ],
    };
  }
  if (input.reconciling) {
    return {
      kind: "reconciling",
      reason: "上一次提交的结果还在本地核对中,先确认它有没有真的扣费。",
      steps: ["点「核对并恢复」完成这一次核对"],
    };
  }
  if (input.syncState === "loading" || input.syncState === "idle") {
    return {
      kind: "syncing",
      reason: "正在同步本画布的任务状态,同步完才知道能不能发起。",
      steps: [],
    };
  }
  if (
    input.kind === "video" &&
    input.videoMode === "image_to_video" &&
    input.incomingImageCount === 0
  ) {
    return {
      kind: "missing_upstream_image",
      reason: "图生视频要拿一张图当画面起点,而当前没有图片连进这个节点。",
      steps: [
        "新建一个图片节点(双击画布空白处,或按 Tab),生成一张图后把它连到本节点",
        "或用底部工具栏的「历史记录」从既往产物里挑一张,建成节点后连过来",
        "只想凭文字出片的话,把上面的「模式」改成文生视频",
      ],
    };
  }
  if (
    typeof input.referenceLimit === "number" &&
    input.incomingImageCount > input.referenceLimit
  ) {
    // 排在 missing_upstream_image 之后:两者互斥(一个嫌少一个嫌多),顺序只影响可读性。
    // 但它必须排在所有「正在忙」之后 —— 用户先该知道最硬的那条。
    return {
      kind: "too_many_references",
      reason:
        input.referenceLimit === 0
          ? "文生视频不使用图片输入,而当前有图片连进这个节点。"
          : `本节点最多用 ${input.referenceLimit} 张参考图,现在连进来 ${input.incomingImageCount} 张。`,
      steps:
        input.referenceLimit === 0
          ? [
              "把上面的「模式」改成图生视频,这些图就会被当作画面起点",
              "或断开图片连线,只凭文字出片",
            ]
          : [
              "断开多余的图片输入连线(点中连线按 Delete)",
              ...(input.kind === "video"
                ? ["或换一个支持更多参考图的视频模型"]
                : []),
            ],
    };
  }
  return null;
}
