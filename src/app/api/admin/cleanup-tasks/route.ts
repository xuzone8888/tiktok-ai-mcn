/**
 * 清理过期任务记录 API
 * 
 * DELETE /api/admin/cleanup-tasks
 * 
 * 删除超过 7 天的任务记录
 * 仅限管理员调用或通过 cron job 触发
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function DELETE() {
  try {
    // 验证管理员权限
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    // 检查是否为管理员
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !["admin", "super_admin"].includes(profile.role)) {
      return NextResponse.json(
        { success: false, error: "权限不足" },
        { status: 403 }
      );
    }

    // 计算 7 天前的时间
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    // 使用 admin client 删除过期记录
    const adminSupabase = createAdminClient();
    
    // 先统计要删除的记录数
    const { count: deleteCount } = await adminSupabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .lt("created_at", sevenDaysAgoISO);

    // 删除过期记录
    const { error } = await adminSupabase
      .from("generations")
      .delete()
      .lt("created_at", sevenDaysAgoISO);

    if (error) {
      console.error("[Cleanup API] Error deleting old tasks:", error);
      return NextResponse.json(
        { success: false, error: "清理失败" },
        { status: 500 }
      );
    }

    console.log(`[Cleanup API] Deleted ${deleteCount || 0} expired task records`);

    return NextResponse.json({
      success: true,
      message: `已清理 ${deleteCount || 0} 条过期任务记录`,
      deletedCount: deleteCount || 0,
    });
  } catch (error) {
    console.error("[Cleanup API] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器错误" },
      { status: 500 }
    );
  }
}

// GET 方法用于查看过期记录数量（不删除）
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    // 计算 7 天前的时间
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    // 统计过期记录数
    const adminSupabase = createAdminClient();
    const { count: expiredCount } = await adminSupabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .lt("created_at", sevenDaysAgoISO);

    // 统计总记录数
    const { count: totalCount } = await adminSupabase
      .from("generations")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      success: true,
      data: {
        totalRecords: totalCount || 0,
        expiredRecords: expiredCount || 0,
        activeRecords: (totalCount || 0) - (expiredCount || 0),
        retentionDays: 7,
        cutoffDate: sevenDaysAgoISO,
      },
    });
  } catch (error) {
    console.error("[Cleanup API] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器错误" },
      { status: 500 }
    );
  }
}

