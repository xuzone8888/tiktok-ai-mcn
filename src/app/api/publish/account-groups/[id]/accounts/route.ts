import { NextRequest, NextResponse } from "next/server";

import { findActiveMultiTaskGroupTask } from "@/lib/publish/multi-task-group-lock";
import {
  MAX_ACCOUNTS_PER_GROUP,
  isUuid,
  mapAccountGroupError,
  sanitizeUuidList,
} from "@/lib/tiktok/account-groups";
import {
  addDemoAccountsToGroup,
  getDemoGroupAccountsResponse,
  isTikTokGroupsDemoMode,
} from "@/lib/tiktok/demo-account-groups";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";

type SupabaseServerClient = Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

interface TikTokAccountRow {
  id: string;
  open_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  follower_count: number;
  following_count: number;
  likes_count: number;
  video_count: number;
  account_type: string;
  status: string;
  token_expires_at: string | null;
  scopes: Json;
  created_at: string;
  updated_at: string;
  group_id: string | null;
}

function toSafeAccount(account: TikTokAccountRow, groupName?: string | null) {
  return {
    id: account.id,
    open_id: account.open_id,
    username: account.username,
    display_name: account.display_name,
    avatar_url: account.avatar_url,
    follower_count: account.follower_count,
    following_count: account.following_count,
    likes_count: account.likes_count,
    video_count: account.video_count,
    account_type: account.account_type,
    status: account.status,
    token_expires_at: account.token_expires_at,
    scopes: Array.isArray(account.scopes) ? account.scopes : [],
    created_at: account.created_at,
    updated_at: account.updated_at,
    group_id: account.group_id,
    group_name: groupName || null,
  };
}

function parsePaging(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") || "";
  const parsedLimit = Number(searchParams.get("limit") || "50");
  const parsedOffset = Number(searchParams.get("offset") || "0");

  return {
    query,
    limit: Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50,
    offset: Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0,
  };
}

async function createSupabaseClient() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

async function validateAuthorizedUngroupedAccounts(
  supabase: SupabaseServerClient,
  userId: string,
  accountIds: string[]
) {
  const { count, error } = await supabase
    .from("tiktok_accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("account_type", "normal")
    .eq("status", "active")
    .is("group_id", null)
    .gt("token_expires_at", new Date().toISOString())
    .in("id", accountIds);

  if (error) {
    console.error("Error validating TikTok group add candidates:", error);
    return NextResponse.json({ error: "Failed to validate TikTok accounts" }, { status: 500 });
  }

  if (count !== accountIds.length) {
    return NextResponse.json({ error: "只能加入已授权且未过期的 TikTok 内容账号" }, { status: 409 });
  }

  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "分组不存在或已被删除" }, { status: 404 });
    }

    const paging = parsePaging(request);

    if (isTikTokGroupsDemoMode()) {
      try {
        return NextResponse.json(getDemoGroupAccountsResponse(id, paging));
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

    const { data: group, error: groupError } = await supabase
      .from("tiktok_account_groups")
      .select("id, user_id, name, color, sort_order, created_at, updated_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (groupError) {
      console.error("Error fetching TikTok account group:", groupError);
      return NextResponse.json({ error: "Failed to fetch account group" }, { status: 500 });
    }

    if (!group) {
      return NextResponse.json({ error: "分组不存在或已被删除" }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const [{ data: groupAccounts, error: groupAccountsError }, { data: availableAccounts, error: availableError }] =
      await Promise.all([
        supabase
          .from("tiktok_accounts")
          .select(
            "id, open_id, username, display_name, avatar_url, follower_count, following_count, likes_count, video_count, account_type, status, token_expires_at, scopes, created_at, updated_at, group_id"
          )
          .eq("user_id", user.id)
          .eq("account_type", "normal")
          .eq("group_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("tiktok_accounts")
          .select(
            "id, open_id, username, display_name, avatar_url, follower_count, following_count, likes_count, video_count, account_type, status, token_expires_at, scopes, created_at, updated_at, group_id"
          )
          .eq("user_id", user.id)
          .eq("account_type", "normal")
          .is("group_id", null)
          .eq("status", "active")
          .gt("token_expires_at", nowIso)
          .order("created_at", { ascending: false }),
      ]);

    if (groupAccountsError || availableError) {
      console.error("Error fetching TikTok group accounts:", groupAccountsError || availableError);
      return NextResponse.json({ error: "Failed to fetch group accounts" }, { status: 500 });
    }

    const normalizedQuery = paging.query.trim().toLowerCase();
    const matchingAvailableAccounts = ((availableAccounts || []) as TikTokAccountRow[]).filter((account) => {
      if (!normalizedQuery) {
        return true;
      }

      return [account.username, account.display_name, account.open_id]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery));
    });

    return NextResponse.json({
      group,
      accounts: ((groupAccounts || []) as TikTokAccountRow[]).map((account) => toSafeAccount(account, group.name)),
      available_accounts: matchingAvailableAccounts
        .slice(paging.offset, paging.offset + paging.limit)
        .map((account) => toSafeAccount(account)),
      available_total: matchingAvailableAccounts.length,
      limit: paging.limit,
      offset: paging.offset,
      max_accounts: MAX_ACCOUNTS_PER_GROUP,
    });
  } catch (error) {
    console.error("Error in get group accounts API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
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
      const accountIds = sanitizeUuidList(body.accountIds);

      if (accountIds.length < 1) {
        return NextResponse.json({ error: "请至少选择 1 个账号" }, { status: 400 });
      }

      if (accountIds.length > MAX_ACCOUNTS_PER_GROUP) {
        return NextResponse.json(
          { error: `每个分组最多 ${MAX_ACCOUNTS_PER_GROUP} 个账号` },
          { status: 400 }
        );
      }

      try {
        const addedCount = addDemoAccountsToGroup(id, accountIds);
        return NextResponse.json({ success: true, added_count: addedCount });
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
    const accountIds = sanitizeUuidList(body.accountIds);

    if (accountIds.length < 1) {
      return NextResponse.json({ error: "请至少选择 1 个账号" }, { status: 400 });
    }

    if (accountIds.length > MAX_ACCOUNTS_PER_GROUP) {
      return NextResponse.json(
        { error: `每个分组最多 ${MAX_ACCOUNTS_PER_GROUP} 个账号` },
        { status: 400 }
      );
    }

    const activeTask = await findActiveMultiTaskGroupTask(supabase, user.id, id);
    if (activeTask) {
      return NextResponse.json(
        { error: "该账号组已有未完成任务，请等待完成后再调整账号。" },
        { status: 409 }
      );
    }

    const validationResponse = await validateAuthorizedUngroupedAccounts(supabase, user.id, accountIds);

    if (validationResponse) {
      return validationResponse;
    }

    const { data, error } = await supabase.rpc("add_tiktok_accounts_to_group", {
      p_group_id: id,
      p_account_ids: accountIds,
    });

    if (error) {
      const mapped = mapAccountGroupError(error);
      console.error("Error adding accounts to TikTok account group:", error);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json({ success: true, added_count: data || 0 });
  } catch (error) {
    console.error("Error in add accounts to group API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
