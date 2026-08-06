/**
 * 超级画布 · /canvas?id= 严格解析(P0 · D-runtime)。
 *
 * 纯函数,离线可测(verify-canvas-runtime 断言)。铁律:**无效或重复 id 一律 fail-closed**,
 * 绝不退化成可编辑的本地空画布(那会把「用户想打开某画布却打不开」静默变成「新建了一个空画布」)。
 *   - 缺省(未带 id)→ 本地未持久化、可编辑;
 *   - 单个合法 UUID → 持久化会话;
 *   - 非 UUID / 空串 / 多个 id(数组)→ invalid(壳渲染 fail-closed 面板)。
 */
import { CANVAS_UUID_RE } from "./api-helpers";

export type CanvasRouteParam =
  | { kind: "local"; id: null }
  | { kind: "persisted"; id: string }
  | { kind: "invalid"; reason: string };

/** `searchParams.id` 可能是 string | string[] | undefined。严格归一,拒绝一切歧义。 */
export function parseCanvasIdParam(value: unknown): CanvasRouteParam {
  if (value === undefined || value === null) return { kind: "local", id: null };
  if (Array.isArray(value)) {
    // 多个 id(?id=a&id=b)歧义 → fail-closed,绝不猜测。
    return { kind: "invalid", reason: "URL 指定了多个画布 id,无法确定要打开哪一个" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid", reason: "画布 id 参数非法" };
  }
  const trimmed = value.trim();
  if (trimmed === "") return { kind: "invalid", reason: "画布 id 为空" };
  if (!CANVAS_UUID_RE.test(trimmed)) {
    return { kind: "invalid", reason: "画布 id 不是合法的 UUID" };
  }
  return { kind: "persisted", id: trimmed.toLowerCase() };
}
