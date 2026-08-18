import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Studio 入库动作(S1;2026-08-09 起画布 CHECKLIST #64 复用同一端点)
 *
 * 把成片/成图标记进内容库:更新 generations.library_status。
 * 属主校验一律按 user_id,且只认 status='completed' 的行。
 *
 * ## 两种匹配键(二选一,不可混传)
 *
 * - `taskIds` —— Studio 侧原有口径,匹配 `generations.task_id`(客户端持有:
 *   视频=提交返回的上游 taskId,图片=响应 data.taskId,幻灯片=客户端任务 id)。
 * - `generationIds` —— **画布侧必须用这个**。原因:画布直连图片走的是同步完成路径,
 *   `bindProviderTask` 只在 `status==="processing" && platformTaskId` 时才调
 *   (generation-service.ts),所以**同步完成的画布图片 `task_id` 恒为 null**,
 *   按 task_id 根本匹配不到 —— 而图片正是画布最常见的产物。
 *
 * 这是**参数扩展而非新链路**(铁律1 零 fork):同一路由、同一属主校验、同一 completed 闸、
 * 同一 published 守卫,只是多一个匹配键。新增画布专用端点会把这四道闸复制一份,
 * 两份迟早漂移。
 */

const VALID_LIBRARY_STATUS = new Set(["draft", "ready", "published"]);
/** 单次批量上限,两种匹配键共用。 */
const MAX_MATCH_IDS = 200;

interface LibraryRequestBody {
  taskIds?: unknown;
  generationIds?: unknown;
  libraryStatus?: unknown;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, MAX_MATCH_IDS);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
    }

    const body = (await request.json()) as LibraryRequestBody;
    const taskIds = normalizeIds(body.taskIds);
    const generationIds = normalizeIds(body.generationIds);
    const libraryStatus =
      typeof body.libraryStatus === "string" && VALID_LIBRARY_STATUS.has(body.libraryStatus)
        ? body.libraryStatus
        : null;

    if (!libraryStatus) {
      return NextResponse.json(
        { success: false, error: "参数错误:需要合法 libraryStatus" },
        { status: 400 }
      );
    }
    if (taskIds.length === 0 && generationIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "参数错误:需要 taskIds 或 generationIds" },
        { status: 400 }
      );
    }
    // 两种匹配键混传会让「更新了几行」无从解释(同一行可能被两个键各命中一次),
    // 也掩盖调用方自己没想清楚用哪个口径。直接拒。
    if (taskIds.length > 0 && generationIds.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "参数错误:taskIds 与 generationIds 只能二选一",
        },
        { status: 400 }
      );
    }

    const adminSupabase = createAdminClient();
    const baseUpdate = () => {
      const update = adminSupabase
        .from("generations")
        .update({ library_status: libraryStatus } as never);
      const matched =
        generationIds.length > 0
          ? update.in("id", generationIds)
          : update.in("task_id", taskIds);
      return (
        matched
          .eq("user_id", user.id)
          // 只有已完成的产出才可入库(挡掉对进行中/失败行的直接 API 调用)
          .eq("status", "completed")
      );
    };

    let rows: Array<{ id: string | null; task_id: string | null }> = [];
    if (libraryStatus === "published") {
      const { data, error } = await baseUpdate().select("id, task_id");
      if (error) {
        console.error("[Studio Library] update failed:", error);
        return NextResponse.json({ success: false, error: "入库失败,请重试" }, { status: 500 });
      }
      rows = data ?? [];
    } else {
      // 发布态守卫(S4 对抗审查实锤):published 是直发成功后的权威终态,
      // 常规「入库」动作不得把它降回 draft/ready。
      // 拆两次互斥更新而非 .or():①SQL 三值逻辑下裸 .neq 会把 NULL 行
      // (从未标记过的)也滤掉;②本项目 PostgREST 对百分号编码的 or=
      // 参数解析报 42703(supabase-js 恒编码,实测复现)
      const [nullRes, neqRes] = await Promise.all([
        baseUpdate().is("library_status", null).select("id, task_id"),
        baseUpdate().neq("library_status", "published").select("id, task_id"),
      ]);
      if (nullRes.error || neqRes.error) {
        console.error(
          "[Studio Library] update failed:",
          nullRes.error ?? neqRes.error
        );
        return NextResponse.json({ success: false, error: "入库失败,请重试" }, { status: 500 });
      }
      rows = [...(nullRes.data ?? []), ...(neqRes.data ?? [])];
    }

    const updatedTaskIds = rows
      .map((row) => row.task_id)
      .filter((id): id is string => typeof id === "string");
    const updatedGenerationIds = rows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string");
    return NextResponse.json({
      success: true,
      data: {
        // `updated` 必须数**行**,不能数 task_id:画布同步完成的图片 task_id 恒为 null,
        // 按 taskIds.length 计会在实际成功时回 0,调用方据此报「入库失败」。
        updated: updatedGenerationIds.length,
        taskIds: updatedTaskIds,
        generationIds: updatedGenerationIds,
      },
    });
  } catch (error) {
    console.error("[Studio Library] error:", error);
    return NextResponse.json({ success: false, error: "入库失败" }, { status: 500 });
  }
}
