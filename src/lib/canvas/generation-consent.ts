import type { CanvasConfirmationTrigger } from "./generation-pricing";

/**
 * 付费提交的「出处闸」(2026-08-09 R2-Q4 审计后新增)。
 *
 * ## 为什么在 #185 的金额阈值之外还要一道闸
 *
 * #185 的双阈值回答的是「**这笔钱大不大**」。而 2026-08-09 的全量审计查出的误扣费,
 * 无一例外回答的是另一个问题:「**这一下到底是不是用户要花的**」——
 *   - 提示词框里手滑一次 Ctrl+Enter(改造前一定弹窗,改造后余额充足时直接扣);
 *   - 断网提交失败后,intent 留在画布文档里,下次打开画布**零点击**被自动重提并首次扣费,
 *     而失败时的 toast 刚承诺过「不会新建任务或重复扣费」;
 *   - 中文输入法组字期间的 Enter。
 *
 * 两个问题正交,所以用两条独立的轴:金额轴原样留给 `resolveCanvasConfirmationTrigger`,
 * 本模块只判出处。**本模块永远不会削弱 #185**——见下面的判定顺序。
 *
 * 抽成纯函数而非写在组件里,是照本仓既有惯例(`generation-lock-hints.ts` /
 * `canvas-responsive.ts` 都是「判定本体是纯函数(可离线穷举),组件只喂参数」)。
 */

/** 这一次提交是从哪来的。 */
export type CanvasGenerateSource =
  /** 用户用鼠标点了「开始生成」——最强的意图证据。 */
  | "button"
  /** Ctrl+Enter 发送(CHECKLIST #188)——弱证据:文本框里极易误触。 */
  | "shortcut"
  /** 自动恢复,且服务端**确有**同 actionId 的行:纯幂等重放,不产生新扣费。 */
  | "recovery_bound"
  /** 自动恢复,但服务端**查无此行**:这一提交会 INSERT + 首次扣费,不是重放。 */
  | "recovery_unbound";

export type CanvasConsentReason =
  | CanvasConfirmationTrigger
  | "keyboard_shortcut"
  | "unbound_recovery";

export type CanvasConsentGate =
  | { decision: "allow" }
  | { decision: "confirm"; reason: CanvasConsentReason };

/**
 * 判定这一次提交要不要先向用户确认。
 *
 * **判定顺序是刻意的,改动前先读这段:**
 *  1. `recovery_bound` 最先放行 —— 服务端已有该行,重放不产生扣费,拦它只会让用户困在一个
 *     既提交不了、又删不掉(删除被 unresolved 拦)的节点上。
 *  2. `recovery_unbound` 直接拦 —— 它会真的 INSERT 并扣费,而用户此刻甚至不在场。
 *  3. **`thresholdTrigger` 必须在 `cost <= 0` 之前判。** `resolveCanvasConfirmationTrigger`
 *     在余额读不出时会先返回 `indeterminate` 再看 cost,即它可能在 `cost === 0` 时仍要求确认;
 *     若这里先用 `cost <= 0` 放行,就会把 #185 的兜底臂吃掉。**这一步保证本模块永不削弱 #185。**
 *  4. 免费动作放行 —— 没有资金变动,拦了只是噪音。
 *  5. `shortcut` 拦 —— 唯一为「出处弱」而加的拦截。
 *  6. `button` + 金额未越阈 → 放行,**这正是 #185 裁决要的效果:熟练用户一次点击直发。**
 */
export function resolveCanvasGenerateConsent(input: {
  source: CanvasGenerateSource;
  cost: number;
  /** #185 服务端判定的原样透传;本函数只读不改。 */
  thresholdTrigger: CanvasConfirmationTrigger | null;
}): CanvasConsentGate {
  const { source, cost, thresholdTrigger } = input;
  if (source === "recovery_bound") return { decision: "allow" };
  if (source === "recovery_unbound") {
    return { decision: "confirm", reason: "unbound_recovery" };
  }
  if (thresholdTrigger) return { decision: "confirm", reason: thresholdTrigger };
  if (!Number.isFinite(cost) || cost <= 0) return { decision: "allow" };
  if (source === "shortcut") {
    return { decision: "confirm", reason: "keyboard_shortcut" };
  }
  return { decision: "allow" };
}
