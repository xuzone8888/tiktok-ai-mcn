import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkPublishStatus,
  getCreatorInfo,
  initPhotoPublishFromUrl,
  PRIVACY_LEVEL_DISPLAY,
} from "@/lib/tiktok/content-posting";
import { getValidTikTokAccessToken } from "@/lib/tiktok/token-manager";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 图文帖 TikTok 直发(S4.2,BLUEPRINT §六)
 *
 * POST { taskId: 'pp-*', accountId, privacyLevel, disableComment?, autoAddMusic? }
 *   → content/init(media_type=PHOTO, PULL_FROM_URL)→ { publishId }
 * GET ?taskId=&accountId=&publishId=
 *   → status/fetch 轮询;PUBLISH_COMPLETE 时落 library_status='published'
 *     + spec.publish 溯源(账号/publish_id/post_id/时间)
 *
 * 复用视频直发全套基建:tiktok_accounts token 刷新、creator_info 校验、
 * PULL_FROM_URL 域名(生产视频直发同域已在用)。失败原样透传 TikTok 文案
 * (url_ownership_unverified 等),UI 侧提供「导出图包」降级。
 */

const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;
type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];

interface PhotoPostRow {
  id: string;
  task_id: string;
  prompt: string | null;
  spec: {
    images?: unknown;
    caption?: unknown;
    title?: unknown;
    cover_index?: unknown;
    publish?: Record<string, unknown>;
  } | null;
}

async function loadOwnPhotoPost(
  admin: SupabaseClient,
  userId: string,
  taskId: string
): Promise<PhotoPostRow | null> {
  // 确定性选行(对抗审查实锤):历史重复行下 limit(1) 无排序键会让 POST 与
  // GET 选到不同行,processing/published 溯源写散——恒取最早插入的那行
  const { data } = await admin
    .from("generations")
    .select("id, task_id, prompt, spec")
    .eq("user_id", userId)
    .eq("source", "photo_post")
    .eq("task_id", taskId)
    .eq("status", "completed")
    .order("created_at", { ascending: true })
    .limit(1);
  const row = (data as unknown as PhotoPostRow[] | null)?.[0];
  return row ?? null;
}

// 发布频控(进程内滑动窗口):直发打 TikTok 开放 API(共享 app 配额),
// 免积分动作也须节流
const PUBLISH_RATE_PER_MIN = 6;
const publishRateMap = new Map<string, number[]>();
function checkPublishRate(userId: string): string | null {
  const now = Date.now();
  const stamps = (publishRateMap.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (stamps.length >= PUBLISH_RATE_PER_MIN) return "发布过于频繁,请稍候再试";
  stamps.push(now);
  publishRateMap.set(userId, stamps);
  if (publishRateMap.size > 5000) {
    for (const [k, v] of publishRateMap) {
      if (v.every((t) => now - t > 60_000)) publishRateMap.delete(k);
    }
  }
  return null;
}

interface TikTokAccountRow {
  id: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string | null;
  status: string | null;
}

async function loadOwnAccount(
  admin: SupabaseClient,
  userId: string,
  accountId: string
): Promise<TikTokAccountRow | null> {
  const { data } = await admin
    .from("tiktok_accounts")
    .select("id, display_name, access_token, refresh_token, access_token_expires_at, status")
    .eq("user_id", userId)
    .eq("id", accountId)
    .limit(1);
  const row = (data as unknown as TikTokAccountRow[] | null)?.[0];
  return row ?? null;
}

/** spec JSONB 读改写(单行低并发;失败不阻断发布主流程) */
async function mergePublishIntoSpec(
  admin: SupabaseClient,
  rowId: string,
  row: PhotoPostRow,
  publish: Record<string, unknown>,
  markPublished: boolean
): Promise<void> {
  try {
    const nextSpec = { ...(row.spec ?? {}), publish };
    const patch: Record<string, unknown> = { spec: nextSpec };
    if (markPublished) patch.library_status = "published";
    const { error } = await admin
      .from("generations")
      .update(patch as never)
      .eq("id", rowId);
    if (error) {
      // spec 列漂移时降级只写 library_status(发布状态客户端已知,溯源尽力而为)
      if (markPublished) {
        await admin
          .from("generations")
          .update({ library_status: "published" } as never)
          .eq("id", rowId);
      }
    }
  } catch (error) {
    console.warn("[PhotoPost Publish] spec merge failed:", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const body = await request.json();
    const taskId: string = typeof body?.taskId === "string" ? body.taskId : "";
    const accountId: string = typeof body?.accountId === "string" ? body.accountId : "";
    const privacyLevel = PRIVACY_LEVELS.includes(body?.privacyLevel)
      ? (body.privacyLevel as PrivacyLevel)
      : null;
    if (!/^pp-[\w-]{1,60}$/.test(taskId) || !/^[0-9a-f-]{36}$/i.test(accountId)) {
      return NextResponse.json({ success: false, error: "参数非法" }, { status: 400 });
    }
    if (!privacyLevel) {
      return NextResponse.json({ success: false, error: "请选择可见范围" }, { status: 400 });
    }
    const rateError = checkPublishRate(user.id);
    if (rateError) {
      return NextResponse.json({ success: false, error: rateError }, { status: 429 });
    }

    const admin = createAdminClient();
    const row = await loadOwnPhotoPost(admin as unknown as SupabaseClient, user.id, taskId);
    if (!row) {
      return NextResponse.json({ success: false, error: "图文帖不存在或未完成" }, { status: 404 });
    }
    const images = Array.isArray(row.spec?.images)
      ? (row.spec!.images as unknown[]).filter((u): u is string => typeof u === "string")
      : [];
    if (images.length === 0) {
      return NextResponse.json(
        { success: false, error: "该记录缺少图序快照(早期降级行),请重新生成后再发布" },
        { status: 400 }
      );
    }
    const caption =
      typeof row.spec?.caption === "string" && row.spec.caption
        ? (row.spec.caption as string)
        : (row.prompt ?? "");
    const title = typeof row.spec?.title === "string" ? (row.spec.title as string) : "";
    const coverIndex =
      typeof row.spec?.cover_index === "number" ? (row.spec.cover_index as number) : 0;

    const account = await loadOwnAccount(admin as unknown as SupabaseClient, user.id, accountId);
    if (!account) {
      return NextResponse.json({ success: false, error: "TikTok 账号不存在" }, { status: 404 });
    }
    if (account.status && account.status !== "active") {
      return NextResponse.json(
        { success: false, error: "该 TikTok 账号授权已失效,请到发布中心重新授权" },
        { status: 400 }
      );
    }

    let accessToken: string;
    try {
      accessToken = await getValidTikTokAccessToken(
        admin as unknown as SupabaseClient<Database>,
        account
      );
    } catch (error) {
      console.error("[PhotoPost Publish] token refresh failed:", error);
      return NextResponse.json(
        { success: false, error: "TikTok 授权刷新失败,请到发布中心重新授权该账号" },
        { status: 400 }
      );
    }

    // creator_info 前置校验(TikTok 集成规范):可见范围必须在账号可选项内;
    // 账号关评时强制关闭评论
    let disableComment = body?.disableComment === true;
    try {
      const creator = await getCreatorInfo(accessToken);
      if (
        Array.isArray(creator.privacy_level_options) &&
        creator.privacy_level_options.length > 0 &&
        !creator.privacy_level_options.includes(privacyLevel)
      ) {
        const allowed = creator.privacy_level_options
          .map((p) => PRIVACY_LEVEL_DISPLAY[p] ?? p)
          .join("/");
        return NextResponse.json(
          { success: false, error: `该账号不支持所选可见范围,可选:${allowed}` },
          { status: 400 }
        );
      }
      if (creator.comment_disabled) disableComment = true;
    } catch (error) {
      // creator_info 拿不到不拦发布(init 会做最终校验),记录即可
      console.warn("[PhotoPost Publish] creator_info failed:", error);
    }

    const publishId = await initPhotoPublishFromUrl(
      accessToken,
      { imageUrls: images.slice(0, 10), coverIndex },
      {
        title: title || caption.split("\n")[0]?.slice(0, 90),
        description: caption,
        privacyLevel,
        disableComment,
        autoAddMusic: body?.autoAddMusic !== false,
      }
    );

    await mergePublishIntoSpec(
      admin as unknown as SupabaseClient,
      row.id,
      row,
      {
        channel: "tiktok",
        account_id: accountId,
        account_name: account.display_name,
        publish_id: publishId,
        status: "processing",
        started_at: new Date().toISOString(),
      },
      false
    );

    return NextResponse.json({ success: true, data: { publishId } });
  } catch (error) {
    console.error("[PhotoPost Publish] error:", error);
    const message =
      error instanceof Error && error.message.startsWith("TikTok")
        ? error.message
        : "发布请求失败,请重试或使用「导出图包」手动发布";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId") ?? "";
    const accountId = searchParams.get("accountId") ?? "";
    const publishId = searchParams.get("publishId") ?? "";
    if (
      !/^pp-[\w-]{1,60}$/.test(taskId) ||
      !/^[0-9a-f-]{36}$/i.test(accountId) ||
      !publishId ||
      publishId.length > 128
    ) {
      return NextResponse.json({ success: false, error: "参数非法" }, { status: 400 });
    }

    const admin = createAdminClient();
    const account = await loadOwnAccount(admin as unknown as SupabaseClient, user.id, accountId);
    if (!account) {
      return NextResponse.json({ success: false, error: "TikTok 账号不存在" }, { status: 404 });
    }
    const accessToken = await getValidTikTokAccessToken(
      admin as unknown as SupabaseClient<Database>,
      account
    );
    const result = await checkPublishStatus(accessToken, publishId);

    if (result.status === "PUBLISH_COMPLETE" || result.status === "SEND_TO_USER_INBOX") {
      const row = await loadOwnPhotoPost(admin as unknown as SupabaseClient, user.id, taskId);
      if (row) {
        await mergePublishIntoSpec(
          admin as unknown as SupabaseClient,
          row.id,
          row,
          {
            channel: "tiktok",
            account_id: accountId,
            account_name: account.display_name,
            publish_id: publishId,
            status: result.status === "PUBLISH_COMPLETE" ? "complete" : "inbox",
            ...(result.postId ? { post_id: result.postId } : {}),
            completed_at: new Date().toISOString(),
          },
          true
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        status: result.status,
        failReason: result.failReason,
        postId: result.postId,
      },
    });
  } catch (error) {
    console.error("[PhotoPost Publish] status error:", error);
    return NextResponse.json(
      { success: false, error: "发布状态查询失败,请稍后重试" },
      { status: 500 }
    );
  }
}
