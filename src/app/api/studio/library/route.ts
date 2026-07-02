import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Studio 入库动作(S1)
 *
 * 把成片/成图标记进内容库:更新 generations.library_status。
 * 匹配键 = generations.task_id(客户端持有:视频=提交返回的上游 taskId,
 * 图片=响应 data.taskId,幻灯片=客户端任务 id);属主校验按 user_id。
 */

const VALID_LIBRARY_STATUS = new Set(["draft", "ready", "published"]);

interface LibraryRequestBody {
  taskIds?: unknown;
  libraryStatus?: unknown;
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
    const taskIds = Array.isArray(body.taskIds)
      ? body.taskIds
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .map((id) => id.trim())
          .slice(0, 200)
      : [];
    const libraryStatus =
      typeof body.libraryStatus === "string" && VALID_LIBRARY_STATUS.has(body.libraryStatus)
        ? body.libraryStatus
        : null;

    if (taskIds.length === 0 || !libraryStatus) {
      return NextResponse.json(
        { success: false, error: "参数错误:需要 taskIds 与合法 libraryStatus" },
        { status: 400 }
      );
    }

    const adminSupabase = createAdminClient();
    const { data, error } = await adminSupabase
      .from("generations")
      .update({ library_status: libraryStatus } as never)
      .in("task_id", taskIds)
      .eq("user_id", user.id)
      // 只有已完成的产出才可入库(挡掉对进行中/失败行的直接 API 调用)
      .eq("status", "completed")
      .select("id, task_id");

    if (error) {
      console.error("[Studio Library] update failed:", error);
      return NextResponse.json({ success: false, error: "入库失败,请重试" }, { status: 500 });
    }

    const updatedTaskIds = (data ?? [])
      .map((row: { task_id: string | null }) => row.task_id)
      .filter((id): id is string => typeof id === "string");
    return NextResponse.json({
      success: true,
      data: { updated: updatedTaskIds.length, taskIds: updatedTaskIds },
    });
  } catch (error) {
    console.error("[Studio Library] error:", error);
    return NextResponse.json({ success: false, error: "入库失败" }, { status: 500 });
  }
}
