import { NextRequest, NextResponse } from "next/server";

import { isUuid, mapAccountGroupError, validateGroupName } from "@/lib/tiktok/account-groups";
import {
  deleteDemoAccountGroup,
  isTikTokGroupsDemoMode,
  renameDemoAccountGroup,
} from "@/lib/tiktok/demo-account-groups";

export const dynamic = "force-dynamic";

async function createSupabaseClient() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "分组不存在或已被删除" }, { status: 404 });
    }

    if (isTikTokGroupsDemoMode()) {
      const body = await request.json().catch(() => ({}));
      const nameResult = validateGroupName(body.name);

      if (!nameResult.ok) {
        return NextResponse.json({ error: nameResult.error }, { status: 400 });
      }

      try {
        const group = renameDemoAccountGroup(id, nameResult.name);
        return NextResponse.json({ group });
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

    const body = await request.json().catch(() => ({}));
    const nameResult = validateGroupName(body.name);

    if (!nameResult.ok) {
      return NextResponse.json({ error: nameResult.error }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("rename_tiktok_account_group", {
      p_group_id: id,
      p_name: nameResult.name,
    });

    if (error) {
      const mapped = mapAccountGroupError(error);
      console.error("Error renaming TikTok account group:", error);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json({ group: data });
  } catch (error) {
    console.error("Error in rename account group API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "分组不存在或已被删除" }, { status: 404 });
    }

    if (isTikTokGroupsDemoMode()) {
      try {
        const releasedCount = deleteDemoAccountGroup(id);
        return NextResponse.json({ success: true, released_count: releasedCount });
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

    const { data, error } = await supabase.rpc("delete_tiktok_account_group", {
      p_group_id: id,
    });

    if (error) {
      const mapped = mapAccountGroupError(error);
      console.error("Error deleting TikTok account group:", error);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json({ success: true, released_count: data || 0 });
  } catch (error) {
    console.error("Error in delete account group API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
