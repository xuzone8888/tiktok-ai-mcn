/**
 * 用户任务日志 API
 * 
 * GET /api/user/tasks - 获取用户的生成任务记录
 * 
 * 查询参数:
 * - type: "all" | "video" | "image" - 任务类型
 * - status: "all" | "completed" | "failed" | "processing" - 任务状态
 * - source: "all" | "quick_gen" | "batch_video" | ... - 来源筛选
 * - dateRange: "all" | "today" | "3days" | "7days" | "custom" - 时间范围
 * - dateFrom / dateTo: 自定义时间范围 (ISO 或 YYYY-MM-DD)
 * - groupName: "all" | 具体分组名 - 分组筛选
 * - cursor: ISO datetime - 游标分页（上一页最后一条的 createdAt）
 * - limit: number - 每页数量（默认 200）
 * 
 * 数据来源:
 * - generations 表: 快速生成、批量生成的视频/图片
 * - ecom_image_tasks 表: 电商图片工厂任务
 * 
 * 性能优化:
 * - 统计数据通过 RPC 在数据库层聚合（无行数上限）
 * - cursor 游标分页，消除跨表分页 BUG
 * - 只查询前端需要的字段，减少传输量
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicUrl } from "@/lib/oss";

export interface TaskLogItem {
  id: string;
  type: "video" | "image";
  source: "quick_gen" | "batch_video" | "batch_image" | "link_video" | "ecom_factory" | "batch_video_prompt" | "batch_video_veo3" | "batch_video_prompt_veo3" | "canvas";
  status: "completed" | "failed" | "processing" | "pending";
  resultUrl: string | null;
  thumbnailUrl: string | null;
  prompt: string | null;
  model: string;
  credits: number;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string; // 7天后过期
  groupName?: string; // 任务分组
  // 电商图片工厂额外字段
  mode?: string;
  outputCount?: number;
}

export interface TaskStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  processingTasks: number;
  totalVideos: number;
  totalImages: number;
  totalCreditsUsed: number;
}

// generations 表只查前端需要的字段（不再 select("*")）
const GENERATIONS_FIELDS = [
  "id", "type", "source", "status",
  "result_url", "video_url", "image_url", "thumbnail_url", "output_oss_key",
  "prompt", "model", "credit_cost",
  "created_at", "completed_at", "group_name",
].join(", ");

// ecom_image_tasks 表只查前端需要的字段
const ECOM_FIELDS = [
  "id", "status", "mode", "model_type",
  "output_items", "credits_cost",
  "created_at", "updated_at",
].join(", ");

// ============================================================================
// GET - 获取用户任务日志
// ============================================================================

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    // 获取当前登录用户
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "all";
    const status = searchParams.get("status") || "all";
    const source = searchParams.get("source") || "all";
    const dateRange = searchParams.get("dateRange") || "all";
    const groupName = searchParams.get("groupName") || "all";
    const dateFrom = searchParams.get("dateFrom"); // 自定义起始日期 (ISO 或 YYYY-MM-DD)
    const dateTo = searchParams.get("dateTo");     // 自定义结束日期 (ISO 或 YYYY-MM-DD)
    const cursor = searchParams.get("cursor");     // 游标分页：上一页最后一条的 created_at
    const limit = parseInt(searchParams.get("limit") || "200");

    // 计算日期范围
    const now = new Date();
    let startDateISO: string | null = null;
    let endDateISO: string | null = null;

    switch (dateRange) {
      case "today":
        startDateISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        break;
      case "3days":
        startDateISO = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case "7days":
        startDateISO = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case "custom":
        // 自定义日期范围
        if (dateFrom) {
          startDateISO = new Date(dateFrom).toISOString();
        }
        if (dateTo) {
          const endDate = new Date(dateTo);
          // 如果传入的是纯日期（不含时间部分 T），补齐到当天 23:59:59.999
          // 如果传入的是 datetime-local 值（含 T），直接使用用户指定的时间
          if (!dateTo.includes("T")) {
            endDate.setHours(23, 59, 59, 999);
          }
          endDateISO = endDate.toISOString();
        }
        break;
      case "all":
      default:
        // 不设置日期限制，查询所有数据
        startDateISO = null;
        break;
    }

    // ========== 并行查询（提高性能）==========

    // 0. 查询所有可用分组名（优先用 RPC DISTINCT，性能更高，无行数限制）
    const groupsPromise = (async () => {
      // 尝试调用数据库函数（需要先执行 migration: 20260207_distinct_groups_rpc.sql）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rpcData, error: rpcError } = await (supabase as any)
        .rpc("get_user_group_names", { p_user_id: user.id });

      if (!rpcError && rpcData) {
        return (rpcData as { group_name: string }[]).map(r => r.group_name);
      }

      // 回退方案：若 RPC 不可用，用普通查询 + JS 去重
      console.log("[Tasks API] RPC get_user_group_names not available, using fallback");
      const { data } = await supabase
        .from("generations")
        .select("group_name")
        .eq("user_id", user.id)
        .not("group_name", "is", null)
        .range(0, 2999);
      if (!data) return [];
      const unique = new Set<string>();
      for (const row of data as { group_name: string | null }[]) {
        if (row.group_name && row.group_name !== "默认") {
          unique.add(row.group_name);
        }
      }
      return Array.from(unique).sort();
    })();

    // 1. 统计数据通过 RPC 在数据库层聚合（无行数限制，精确统计）
    const statsPromise = (async (): Promise<TaskStats> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rpcData, error: rpcError } = await (supabase as any)
          .rpc("get_user_task_stats", {
            p_user_id: user.id,
            p_start_date: startDateISO || null,
            p_end_date: endDateISO || null,
            p_type: type,
            p_source: source,
            p_status: status,
            p_group_name: groupName,
          });

        if (!rpcError && rpcData) {
          // RPC 返回 JSON 标量，Supabase JS 可能包装成数组或直接返回对象
          const raw = Array.isArray(rpcData) ? rpcData[0] : rpcData;
          // 映射 snake_case → camelCase
          return {
            totalTasks: raw.totalTasks ?? raw.total_tasks ?? 0,
            completedTasks: raw.completedTasks ?? raw.completed_tasks ?? 0,
            failedTasks: raw.failedTasks ?? raw.failed_tasks ?? 0,
            processingTasks: raw.processingTasks ?? raw.processing_tasks ?? 0,
            totalVideos: raw.totalVideos ?? raw.total_videos ?? 0,
            totalImages: raw.totalImages ?? raw.total_images ?? 0,
            totalCreditsUsed: raw.totalCreditsUsed ?? raw.total_credits_used ?? 0,
          };
        }
        throw new Error(rpcError?.message || "RPC failed");
      } catch (err) {
        // 回退方案：若 RPC 不可用，用 count 查询
        console.log("[Tasks API] RPC get_user_task_stats not available, using fallback", err);
        return fallbackStats(supabase, user.id, type, status, source, groupName, startDateISO, endDateISO);
      }
    })();

    // 2. 查询 generations 数据（cursor 分页，只取需要的字段）
    const generationsPromise = (async () => {
      // 如果只查询电商图片，跳过 generations 表
      if (type === "ecom" || source === "ecom_factory") return [];

      let query = supabase
        .from("generations")
        .select(GENERATIONS_FIELDS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      // 日期过滤
      if (startDateISO) {
        query = query.gte("created_at", startDateISO);
      }
      if (endDateISO) {
        query = query.lte("created_at", endDateISO);
      }

      // cursor 游标分页：取 created_at < cursor 的下一批数据
      if (cursor) {
        query = query.lt("created_at", cursor);
      }

      if (type === "video") query = query.eq("type", "video");
      if (type === "image") query = query.eq("type", "image");
      if (status !== "all") query = query.eq("status", status);

      // 来源筛选
      if (source !== "all") {
        query = query.eq("source", source);
      }

      // 分组筛选
      if (groupName !== "all") {
        query = query.eq("group_name", groupName);
      }

      // 每张表取 limit 条（合并后再取 top limit）
      query = query.limit(limit);
      const { data } = await query;
      return data || [];
    })();

    // 3. 查询 ecom_image_tasks 数据（cursor 分页，只取需要的字段）
    const ecomPromise = (async () => {
      // 如果只查询视频，或者筛选的来源不是电商工厂也不是全部，跳过电商图片任务
      if (type === "video") return [];
      if (source !== "all" && source !== "ecom_factory") return [];

      let query = supabase
        .from("ecom_image_tasks")
        .select(ECOM_FIELDS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      // 日期过滤
      if (startDateISO) {
        query = query.gte("created_at", startDateISO);
      }
      if (endDateISO) {
        query = query.lte("created_at", endDateISO);
      }

      // cursor 游标分页
      if (cursor) {
        query = query.lt("created_at", cursor);
      }

      // 电商任务状态映射
      if (status === "completed") {
        query = query.in("status", ["success", "partial_success"]);
      } else if (status === "failed") {
        query = query.eq("status", "failed");
      } else if (status === "processing") {
        query = query.in("status", ["created", "generating_prompts", "generating_images"]);
      }

      query = query.limit(limit);
      const { data } = await query;
      return data || [];
    })();

    const [allGroups, stats, generationsTasks, ecomTasks] = await Promise.all([
      groupsPromise, statsPromise, generationsPromise, ecomPromise,
    ]);

    console.log("[Tasks API] Query results:", {
      userId: user.id,
      generationsCount: generationsTasks.length,
      ecomTasksCount: ecomTasks.length,
      totalTasks: stats.totalTasks,
      cursor: cursor || "none",
    });

    // ========== 转换 generations 数据 ==========
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generationsLogs: TaskLogItem[] = generationsTasks.map((task: any) => {
      const createdAt = new Date(task.created_at);
      const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);

      // 望景API (备用线路) 的 /content 端点需要 Bearer Token，浏览器无法直连
      // 自动包装为代理 URL，由服务端注入鉴权
      // output_oss_key is the authoritative durable Canvas result. Legacy URL
      // columns are only a compatibility projection and may miss a transient
      // best-effort update after generation completion.
      let resultUrl =
        task.result_url ||
        task.video_url ||
        task.image_url ||
        (task.output_oss_key ? getPublicUrl(task.output_oss_key) : null);
      if (resultUrl && resultUrl.includes('60.205.120.27') && resultUrl.includes('/v1/videos/')) {
        resultUrl = `/api/download-proxy?url=${encodeURIComponent(resultUrl)}&filename=video.mp4`;
      }

      return {
        id: task.id,
        type: task.type || "video",
        source: task.source || "quick_gen",
        status: task.status || "completed",
        resultUrl,
        thumbnailUrl:
          task.thumbnail_url ||
          (task.type === "image" && task.output_oss_key
            ? getPublicUrl(task.output_oss_key)
            : null),
        prompt: task.prompt || null,
        model: task.model || "unknown",
        credits: task.credit_cost || 0,
        createdAt: task.created_at,
        completedAt: task.completed_at || null,
        expiresAt: expiresAt.toISOString(),
        groupName: task.group_name || "默认",
      };
    });

    // ========== 转换 ecom_image_tasks 数据 ==========
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ecomLogs: TaskLogItem[] = ecomTasks.map((task: any) => {
      const createdAt = new Date(task.created_at);
      const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);

      // 状态映射
      let mappedStatus: TaskLogItem["status"] = "processing";
      if (task.status === "success" || task.status === "partial_success") {
        mappedStatus = "completed";
      } else if (task.status === "failed") {
        mappedStatus = "failed";
      } else if (["created", "generating_prompts", "generating_images"].includes(task.status)) {
        mappedStatus = "processing";
      }

      // 获取第一张结果图片作为缩略图
      const outputItems = task.output_items || [];
      const firstSuccessItem = outputItems.find((item: { status: string; image_url?: string }) =>
        item.status === "success" && item.image_url
      );

      // 模式名称映射
      const modeNames: Record<string, string> = {
        ecom_five_pack: "五图套装",
        white_background: "白底图",
        scene_image: "场景图",
        try_on: "AI试穿",
        buyer_show: "买家秀",
      };

      return {
        id: task.id,
        type: "image" as const,
        source: "ecom_factory" as const,
        status: mappedStatus,
        resultUrl: firstSuccessItem?.image_url || null,
        thumbnailUrl: firstSuccessItem?.image_url || null,
        prompt: `电商图片工厂 - ${modeNames[task.mode] || task.mode}`,
        model: task.model_type || "nano-banana",
        credits: task.credits_cost || 0,
        createdAt: task.created_at,
        completedAt: task.updated_at || null,
        expiresAt: expiresAt.toISOString(),
        mode: task.mode,
        outputCount: outputItems.filter((item: { status: string }) => item.status === "success").length,
      };
    });

    // ========== 合并并排序（按创建时间倒序），取 top limit ==========
    const mergedTasks = [...generationsLogs, ...ecomLogs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    // 计算 nextCursor（下一页从这条的 createdAt 往前取）
    const nextCursor = mergedTasks.length > 0
      ? mergedTasks[mergedTasks.length - 1].createdAt
      : null;

    return NextResponse.json({
      success: true,
      data: {
        tasks: mergedTasks,
        stats,
        availableGroups: allGroups,
        pagination: {
          total: stats.totalTasks,
          limit,
          nextCursor,
          hasMore: mergedTasks.length === limit,
        },
      },
    });
  } catch (error) {
    console.error("[Tasks API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// 回退方案：当 RPC 不可用时，用多个 count 查询计算统计
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fallbackStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  type: string,
  status: string,
  source: string,
  groupName: string,
  startDateISO: string | null,
  endDateISO: string | null,
): Promise<TaskStats> {
  // 用轻量级查询获取统计字段（只选 3 个小字段，不拉全量数据）
  const buildGenQuery = () => {
    let q = supabase
      .from("generations")
      .select("status, type, credit_cost")
      .eq("user_id", userId);
    if (startDateISO) q = q.gte("created_at", startDateISO);
    if (endDateISO) q = q.lte("created_at", endDateISO);
    if (type === "video") q = q.eq("type", "video");
    if (type === "image") q = q.eq("type", "image");
    if (status !== "all") q = q.eq("status", status);
    if (source !== "all") q = q.eq("source", source);
    if (groupName !== "all") q = q.eq("group_name", groupName);
    q = q.range(0, 9999); // 提高上限
    return q;
  };

  const buildEcomQuery = () => {
    let q = supabase
      .from("ecom_image_tasks")
      .select("status, credits_cost")
      .eq("user_id", userId);
    if (startDateISO) q = q.gte("created_at", startDateISO);
    if (endDateISO) q = q.lte("created_at", endDateISO);
    if (status === "completed") q = q.in("status", ["success", "partial_success"]);
    else if (status === "failed") q = q.eq("status", "failed");
    else if (status === "processing") q = q.in("status", ["created", "generating_prompts", "generating_images"]);
    q = q.range(0, 9999);
    return q;
  };

  const skipGen = type === "ecom" || source === "ecom_factory";
  const skipEcom = type === "video" || (source !== "all" && source !== "ecom_factory");

  const [genResult, ecomResult] = await Promise.all([
    skipGen ? { data: [] } : buildGenQuery(),
    skipEcom ? { data: [] } : buildEcomQuery(),
  ]);

  const genData = genResult.data || [];
  const ecomData = ecomResult.data || [];

  let completed = 0, failed = 0, processing = 0;
  let videos = 0, images = 0, credits = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of genData as any[]) {
    if (t.status === "completed") completed++;
    else if (t.status === "failed") failed++;
    else processing++;
    if (t.type === "video") videos++;
    else images++;
    credits += t.credit_cost || 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of ecomData as any[]) {
    if (t.status === "success" || t.status === "partial_success") completed++;
    else if (t.status === "failed") failed++;
    else processing++;
    images++;
    credits += t.credits_cost || 0;
  }

  return {
    totalTasks: genData.length + ecomData.length,
    completedTasks: completed,
    failedTasks: failed,
    processingTasks: processing,
    totalVideos: videos,
    totalImages: images,
    totalCreditsUsed: credits,
  };
}
