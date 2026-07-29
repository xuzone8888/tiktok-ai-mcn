import type { SupabaseClient } from "@supabase/supabase-js";

import { CanvasRoot } from "@/components/canvas/canvas-root";
import { CanvasRouteError } from "@/components/canvas/canvas-route-error";
import { parseCanvasIdParam } from "@/lib/canvas/canvas-route-params";
import { canAccessSuperCanvas } from "@/lib/canvas/feature-access";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (
    !user ||
    !canAccessSuperCanvas({
      id: user.id,
      email: user.email,
    })
  ) {
    return (
      <main className="flex h-full w-full items-center justify-center bg-background p-6">
        <section className="max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">超级画布正在灰度开放</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            当前账号尚未进入开放范围。完成稳定性验收后会逐步开放，无需重复申请。
          </p>
          <a
            href="/studio"
            className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            返回工作台
          </a>
        </section>
      </main>
    );
  }

  let currentTitle: string | null = null;
  if (parsed.id) {
    const db = supabase as unknown as SupabaseClient;
    const { data } = await db
      .from("canvases")
      .select("title")
      .eq("id", parsed.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    const title = (data as { title?: unknown } | null)?.title;
    currentTitle =
      typeof title === "string" && title.trim() ? title.trim() : null;
  }

  return <CanvasRoot canvasId={parsed.id} currentTitle={currentTitle} />;
}
