/**
 * 角色活化视频 API
 *
 * 复用统一视频模型 submit/status 路由，固定走 VEO 参考图生成。
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 180;
export const dynamic = "force-dynamic";

function getRouteUrl(request: Request, pathname: string): string {
  return new URL(pathname, request.url).toString();
}

function getForwardedHeaders(request: Request): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const cookie = request.headers.get("cookie");
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function getCurrentUser() {
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  return user;
}

async function assertOwnedUserCharacter(characterId: string, userId: string) {
  const supabase = createAdminClient();
  const { data: character, error } = await supabase
    .from("ai_models")
    .select("id, owner_id, source")
    .eq("id", characterId)
    .eq("source", "user_created")
    .single();

  if (error || !character || character.owner_id !== userId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "角色不存在或无权操作" },
        { status: 404 }
      ),
    };
  }

  return { ok: true as const, supabase };
}

// ============================================================================
// POST — 提交角色活化视频任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { referenceImageUrl, heroImageUrl, prompt, characterId } = body as {
      referenceImageUrl?: string;
      heroImageUrl?: string;
      prompt: string;
      characterId?: string;
    };
    const imageUrl = referenceImageUrl || heroImageUrl;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: "referenceImageUrl is required" },
        { status: 400 }
      );
    }

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { success: false, error: "prompt is required" },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    if (characterId) {
      const ownership = await assertOwnedUserCharacter(characterId, user.id);
      if (!ownership.ok) return ownership.response;
    }

    const submitRes = await fetch(getRouteUrl(request, "/api/video-batch/models/submit"), {
      method: "POST",
      headers: getForwardedHeaders(request),
      body: JSON.stringify({
        modelType: "veo",
        prompt: prompt.trim(),
        aspectRatio: "9:16",
        characterRefUrl: imageUrl,
        clientTaskId: `character-activate-${characterId || "preview"}-${Date.now()}`,
        groupName: "角色活化",
        userId: user.id,
        durationSeconds: 8,
        quality: "standard",
        mode: "image_to_video",
      }),
    });

    const submitResult = await submitRes.json();
    if (!submitResult.success || !submitResult.data?.taskId) {
      return NextResponse.json(
        {
          success: false,
          error: submitResult.error || "视频生成提交失败",
        },
        { status: submitRes.ok ? 500 : submitRes.status }
      );
    }

    return NextResponse.json({
      success: true,
      taskId: submitResult.data.taskId,
      modelType: "veo",
      creditCost: submitResult.data.creditCost,
    });
  } catch (error) {
    console.error("[Character Activate] Submit error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET — 查询活化视频任务状态（轮询）
// ============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const characterId = searchParams.get("characterId");

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    let ownedCharacter:
      | Awaited<ReturnType<typeof assertOwnedUserCharacter>>
      | null = null;
    if (characterId) {
      ownedCharacter = await assertOwnedUserCharacter(characterId, user.id);
      if (!ownedCharacter.ok) return ownedCharacter.response;
    }

    const statusUrl = new URL(getRouteUrl(request, "/api/video-batch/models/status"));
    statusUrl.searchParams.set("modelType", "veo");
    statusUrl.searchParams.set("taskId", taskId);
    statusUrl.searchParams.set("aspectRatio", "9:16");
    statusUrl.searchParams.set("durationSeconds", "8");
    statusUrl.searchParams.set("quality", "standard");

    const statusRes = await fetch(statusUrl.toString(), {
      cache: "no-store",
      headers: getForwardedHeaders(request),
    });
    const statusResult = await statusRes.json();

    if (!statusResult.success) {
      return NextResponse.json(
        { success: false, error: statusResult.error || "查询失败" },
        { status: statusRes.ok ? 500 : statusRes.status }
      );
    }

    const data = statusResult.data;
    if (data?.status === "completed" && data.videoUrl && characterId) {
      await ownedCharacter!.supabase
        .from("ai_models")
        .update({ preview_video_url: data.videoUrl })
        .eq("id", characterId)
        .eq("owner_id", user.id);
    }

    return NextResponse.json({
      success: true,
      task: data ? {
        taskId: data.taskId,
        status: data.status,
        resultUrl: data.videoUrl,
        errorMessage: data.errorMessage,
        progress: data.progress,
      } : undefined,
    });
  } catch (error) {
    console.error("[Character Activate] Query error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
