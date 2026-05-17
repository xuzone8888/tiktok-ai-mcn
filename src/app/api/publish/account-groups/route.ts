import { NextResponse } from "next/server";

import {
  MAX_ACCOUNTS_PER_GROUP,
  mapAccountGroupError,
  sanitizeUuidList,
  validateGroupName,
} from "@/lib/tiktok/account-groups";
import {
  createDemoAccountGroup,
  getDemoGroupsResponse,
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

function isExpiringOrExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return true;
  }

  const daysUntilExpiry = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry < 30;
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
    console.error("Error validating TikTok account group candidates:", error);
    return NextResponse.json({ error: "Failed to validate TikTok accounts" }, { status: 500 });
  }

  if (count !== accountIds.length) {
    return NextResponse.json({ error: "只能加入已授权且未过期的 TikTok 内容账号" }, { status: 409 });
  }

  return null;
}

export async function GET() {
  try {
    if (isTikTokGroupsDemoMode()) {
      return NextResponse.json(getDemoGroupsResponse());
    }

    const supabase = await createSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [{ data: groups, error: groupsError }, { data: accounts, error: accountsError }] =
      await Promise.all([
        supabase
          .from("tiktok_account_groups")
          .select("id, user_id, name, color, sort_order, created_at, updated_at")
          .eq("user_id", user.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("tiktok_accounts")
          .select(
            "id, open_id, username, display_name, avatar_url, follower_count, following_count, likes_count, video_count, account_type, status, token_expires_at, scopes, created_at, updated_at, group_id"
          )
          .eq("user_id", user.id)
          .eq("account_type", "normal")
          .order("created_at", { ascending: false }),
      ]);

    if (groupsError) {
      console.error("Error fetching TikTok account groups:", groupsError);
      return NextResponse.json({ error: "Failed to fetch account groups" }, { status: 500 });
    }

    if (accountsError) {
      console.error("Error fetching TikTok accounts for groups:", accountsError);
      return NextResponse.json({ error: "Failed to fetch TikTok accounts" }, { status: 500 });
    }

    const groupNameById = new Map((groups || []).map((group) => [group.id, group.name]));
    const accountsByGroup = new Map<string, ReturnType<typeof toSafeAccount>[]>();

    for (const account of (accounts || []) as TikTokAccountRow[]) {
      if (!account.group_id) {
        continue;
      }

      const safeAccount = toSafeAccount(account, groupNameById.get(account.group_id));
      const groupAccounts = accountsByGroup.get(account.group_id) || [];
      groupAccounts.push(safeAccount);
      accountsByGroup.set(account.group_id, groupAccounts);
    }

    const hydratedGroups = (groups || []).map((group) => {
      const groupAccounts = accountsByGroup.get(group.id) || [];
      const attentionCount = groupAccounts.filter(
        (account) => account.status !== "active" || isExpiringOrExpired(account.token_expires_at)
      ).length;

      return {
        ...group,
        accounts_count: groupAccounts.length,
        active_count: groupAccounts.length - attentionCount,
        attention_count: attentionCount,
        max_accounts: MAX_ACCOUNTS_PER_GROUP,
        accounts: groupAccounts,
      };
    });

    return NextResponse.json({ groups: hydratedGroups });
  } catch (error) {
    console.error("Error in account groups API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (isTikTokGroupsDemoMode()) {
      const body = await request.json().catch(() => ({}));
      const nameResult = validateGroupName(body.name);

      if (!nameResult.ok) {
        return NextResponse.json({ error: nameResult.error }, { status: 400 });
      }

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
        const group = createDemoAccountGroup(nameResult.name, accountIds);
        return NextResponse.json({ group }, { status: 201 });
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

    const validationResponse = await validateAuthorizedUngroupedAccounts(supabase, user.id, accountIds);

    if (validationResponse) {
      return validationResponse;
    }

    const { data, error } = await supabase.rpc("create_tiktok_account_group", {
      p_name: nameResult.name,
      p_account_ids: accountIds,
    });

    if (error) {
      const mapped = mapAccountGroupError(error);
      console.error("Error creating TikTok account group:", error);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json({ group: data }, { status: 201 });
  } catch (error) {
    console.error("Error in create account group API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
