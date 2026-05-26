import { NextRequest, NextResponse } from "next/server";

import { findActiveMultiTaskGroupTask } from "@/lib/publish/multi-task-group-lock";
import { isUuid, mapAccountGroupError } from "@/lib/tiktok/account-groups";
import {
  isTikTokGroupsDemoMode,
  removeDemoAccountFromGroup,
} from "@/lib/tiktok/demo-account-groups";

export const dynamic = "force-dynamic";

async function createSupabaseClient() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const { id, accountId } = await params;

    if (!isUuid(id) || !isUuid(accountId)) {
      return NextResponse.json({ error: "账号或分组不存在" }, { status: 404 });
    }

    if (isTikTokGroupsDemoMode()) {
      try {
        const removedCount = removeDemoAccountFromGroup(id, accountId);
        return NextResponse.json({ success: true, removed_count: removedCount });
      } catch (error) {
        const mapped = mapAccountGroupError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
      }
    }

    const supabase = await createSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const activeTask = await findActiveMultiTaskGroupTask(supabase, user.id, id);
    if (activeTask) {
      return NextResponse.json(
        { error: "该账号组已有未完成任务，请等待完成后再调整账号。" },
        { status: 409 }
      );
    }

    const { data, error } = await supabase.rpc("remove_tiktok_account_from_group", {
      p_group_id: id,
      p_account_id: accountId,
    });

    if (error) {
      const mapped = mapAccountGroupError(error);
      console.error("Error removing account from TikTok account group:", error);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json({ success: true, removed_count: data || 0 });
  } catch (error) {
    console.error("Error in remove account from group API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
