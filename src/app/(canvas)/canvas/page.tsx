import { CanvasRoot } from "@/components/canvas/canvas-root";
import { CanvasRouteError } from "@/components/canvas/canvas-route-error";
import { parseCanvasIdParam } from "@/lib/canvas/canvas-route-params";

/**
 * /canvas 路由入口(P0 · S1 / D-runtime)。
 *
 * 薄 server 入口:严格解析 `?id=`(纯函数 parseCanvasIdParam),据结果分派——
 *   - 缺省(裸 /canvas)→ 可编辑的本地空画布,首次落节点前不建任何行;
 *   - 单个合法 UUID → 持久化会话(客户端协调器 GET 装载 + 单写者门禁);
 *   - 非法 / 多个 id → fail-closed 面板,**绝不**退化成可编辑本地画布(否则「打不开」被静默成「新建」)。
 * 鉴权由中间件负责(硬鉴权),不在页面内重复;所有交互在客户端 <CanvasRoot>。
 */
export default async function CanvasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = parseCanvasIdParam(params.id);

  if (parsed.kind === "invalid") {
    return <CanvasRouteError reason={parsed.reason} />;
  }

  return <CanvasRoot canvasId={parsed.id} />;
}
