/**
 * 超级画布 · 文档体积阈值校验契约(P0 · D1)
 *
 * 这是「文档 >512KB 软告警 / >2MB 硬拒存」两道体积闸的**唯一事实源**,
 * 由服务端(D3 的 POST/PATCH 路由)与客户端(S 侧保存前预检、告警横幅)共用。
 * 纯函数、零 IO、无第三方依赖,故意用 `TextEncoder`(浏览器与 Node 均为全局)而非
 * `Buffer`,保证同一份契约在两端产出**同一个字节数**。
 *
 * P0-Q1 裁决(2026-07-12):告警必须早于硬闸。D3 在 >2MB 时拒存,
 * S7 在 >512KB 时显示建议拆分横幅,并展示 >2MB 的拒存 toast。
 *
 * ⚠ 接线状态:本文件只提供纯校验。把 `checkDocSize` 接进 POST/PATCH「拒存」响应、
 *   把 `doc_bytes` 写进 canvases 行,属 D3;S 侧消费 `overWarnLimit` 渲染横幅属 S7。
 *   字节口径统一为 JSON.stringify(doc) 的 UTF-8 字节数。
 */

/** 硬闸:doc 序列化字节 > 此值 → API 拒存。 */
export const DOC_BYTES_HARD_LIMIT = 2 * 1024 * 1024; // 2097152

/** 告警闸:doc 序列化字节 > 此值 → 建议拆画布,不拒存。 */
export const DOC_JSONB_WARN_LIMIT = 512 * 1024; // 524288

export interface DocSizeResult {
  /** doc 的规范 JSON 序列化字节数(UTF-8);无法序列化时为 Number.POSITIVE_INFINITY。 */
  bytes: number;
  /** 可安全入库(未超硬闸)。等价于 !overHardLimit。 */
  ok: boolean;
  /** 超硬闸 → 服务端应拒存(HTTP 400)。 */
  overHardLimit: boolean;
  /** 超告警闸 → 建议拆画布(UI 横幅,不拒存)。 */
  overWarnLimit: boolean;
  /** 序列化是否失败(循环引用 / 非 JSON 安全值)。失败一律按超硬闸拒存。 */
  serializable: boolean;
  hardLimit: number;
  warnLimit: number;
  /** 拒存/告警时的中文原因;可直接入 API 响应或横幅文案。ok 且不告警时为 null。 */
  message: string | null;
}

/**
 * 计算 doc 的 UTF-8 序列化字节数——服务端据此写 canvases.doc_bytes,客户端据此预检。
 * 循环引用 / BigInt 等不可 JSON 序列化的值抛错时,返回 Infinity(交由 checkDocSize 判超限拒存)。
 */
export function computeDocBytes(doc: unknown): number {
  let json: string;
  try {
    json = JSON.stringify(doc);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  // JSON.stringify(undefined) === undefined;顶层不可序列化时按无法入库处理。
  if (typeof json !== "string") return Number.POSITIVE_INFINITY;
  return new TextEncoder().encode(json).length;
}

/**
 * 体积双闸判定。D3 用法:overHardLimit → 400 拒存并回 message;正常入库时把
 * bytes 写进 canvases.doc_bytes。S 侧用法:overWarnLimit → 渲染「画布偏大建议拆分」横幅。
 */
export function checkDocSize(doc: unknown): DocSizeResult {
  const bytes = computeDocBytes(doc);
  const serializable = Number.isFinite(bytes);
  const overHardLimit = bytes > DOC_BYTES_HARD_LIMIT;
  const overWarnLimit = bytes > DOC_JSONB_WARN_LIMIT;

  let message: string | null = null;
  if (!serializable) {
    message = "画布文档无法序列化(可能含循环引用),已拒绝保存";
  } else if (overHardLimit) {
    message = `画布文档 ${formatBytes(bytes)} 超出单画布上限 ${formatBytes(
      DOC_BYTES_HARD_LIMIT
    )},请拆分为多个画布后再保存`;
  } else if (overWarnLimit) {
    message = `画布文档已达 ${formatBytes(bytes)},建议拆分为多个画布以保持流畅`;
  }

  return {
    bytes,
    ok: !overHardLimit,
    overHardLimit,
    overWarnLimit,
    serializable,
    hardLimit: DOC_BYTES_HARD_LIMIT,
    warnLimit: DOC_JSONB_WARN_LIMIT,
    message,
  };
}

/** 人类可读字节数(拒存文案用)。纯展示,不参与阈值判定。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "∞";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}
