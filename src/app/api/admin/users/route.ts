/**
 * Admin API - 用户管理
 * 
 * GET /api/admin/users - 获取用户列表
 * POST /api/admin/users - 用户操作 (充值/扣除/封禁/解封)
 * 
 * 关键特性：
 * - 积分操作使用真实数据库
 * - 管理员发放积分时从管理员账户扣除
 * - 所有操作写入审计日志
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, type AdminUser, type UserRole, type UserStatus } from "@/lib/admin";

// ============================================================================
// GET - 获取用户列表
// ============================================================================

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as UserStatus | null;
    const role = searchParams.get("role") as UserRole | null;
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    // 从数据库获取用户
    let query = supabase
      .from("profiles")
      .select("*", { count: "exact" });

    if (status) {
      query = query.eq("status", status);
    }

    if (role) {
      query = query.eq("role", role);
    }

    if (search) {
      query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    }

    // 分页
    const start = (page - 1) * limit;
    query = query.range(start, start + limit - 1).order("created_at", { ascending: false });

    const { data: users, error, count } = await query;

    if (error) {
      console.error("[Admin API] Database error:", error);
      throw error;
    }

    // 转换为AdminUser格式
    const adminUsers: AdminUser[] = (users || []).map((user: any) => ({
      id: user.id,
      email: user.email || "",
      name: user.name || user.email?.split("@")[0] || "用户",
      avatar_url: user.avatar_url,
      role: user.role || "user",
      status: user.status || "active",
      credits: user.credits || 0,
      created_at: user.created_at,
      banned_at: user.banned_at,
      banned_reason: user.banned_reason,
    }));

    return NextResponse.json({
      success: true,
      data: {
        users: adminUsers,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
      },
    });
  } catch (error) {
    console.error("[Admin API] Get users error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get users" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - 用户操作 (充值/扣除/封禁/解封)
// ============================================================================

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient();
    const clientSupabase = createClient();
    
    // 获取当前登录的管理员
    const { data: { user: currentUser } } = await clientSupabase.auth.getUser();
    
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    // 获取管理员信息
    const { data: adminProfile } = await supabase
      .from("profiles")
      .select("id, email, name, role, credits")
      .eq("id", currentUser.id)
      .single();

    if (!adminProfile || !isAdmin(adminProfile.role)) {
      return NextResponse.json(
        { success: false, error: "没有管理员权限" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, targetUserId, amount, reason } = body;

    // 获取目标用户
    const { data: targetUser, error: targetError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", targetUserId)
      .single();

    if (targetError || !targetUser) {
      return NextResponse.json(
        { success: false, error: "用户不存在" },
        { status: 404 }
      );
    }

    let result: Record<string, unknown> = {};

    switch (action) {
      // ============================================
      // 充值积分 (Recharge)
      // 管理员发放积分时，从管理员账户扣除相应积分
      // ============================================
      case "recharge": {
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { success: false, error: "积分数量必须为正数" },
            { status: 400 }
          );
        }

        if (!reason || !reason.trim()) {
          return NextResponse.json(
            { success: false, error: "请填写充值原因" },
            { status: 400 }
          );
        }

        // 检查管理员积分是否足够
        const adminCredits = adminProfile.credits || 0;
        if (adminCredits < amount) {
          return NextResponse.json(
            { success: false, error: `管理员积分不足，当前余额: ${adminCredits}` },
            { status: 400 }
          );
        }

        const oldCredits = targetUser.credits || 0;
        const newCredits = oldCredits + amount;
        const adminOldCredits = adminCredits;
        const adminNewCredits = adminCredits - amount;

        // 更新目标用户积分
        const { error: updateUserError } = await supabase
          .from("profiles")
          .update({ credits: newCredits })
          .eq("id", targetUserId);

        if (updateUserError) {
          console.error("[Admin API] Update user credits error:", updateUserError);
          return NextResponse.json(
            { success: false, error: "更新用户积分失败" },
            { status: 500 }
          );
        }

        // 扣除管理员积分
        const { error: updateAdminError } = await supabase
          .from("profiles")
          .update({ credits: adminNewCredits })
          .eq("id", currentUser.id);

        if (updateAdminError) {
          // 回滚用户积分
          await supabase
            .from("profiles")
            .update({ credits: oldCredits })
            .eq("id", targetUserId);
          
          console.error("[Admin API] Update admin credits error:", updateAdminError);
          return NextResponse.json(
            { success: false, error: "更新管理员积分失败" },
            { status: 500 }
          );
        }

        // 触发前端积分刷新
        console.log(`[Admin API] Credits recharged: ${targetUser.email} +${amount}, Admin ${adminProfile.email} balance: ${adminNewCredits}`);

        result = {
          action: "recharge",
          old_credits: oldCredits,
          new_credits: newCredits,
          admin_old_credits: adminOldCredits,
          admin_new_credits: adminNewCredits,
          amount: amount,
          reason: reason.trim(),
          timestamp: new Date().toISOString(),
        };
        break;
      }

      // ============================================
      // 扣除积分 (Deduct)
      // 管理员扣除用户积分时，积分回收到管理员账户
      // ============================================
      case "deduct": {
        const deductAmount = Math.abs(amount || 0);
        
        if (deductAmount <= 0) {
          return NextResponse.json(
            { success: false, error: "积分数量必须为正数" },
            { status: 400 }
          );
        }

        if (!reason || !reason.trim()) {
          return NextResponse.json(
            { success: false, error: "请填写扣除原因" },
            { status: 400 }
          );
        }

        const userCredits = targetUser.credits || 0;
        if (deductAmount > userCredits) {
          return NextResponse.json(
            { success: false, error: `用户积分不足，当前余额: ${userCredits}` },
            { status: 400 }
          );
        }

        const oldCredits = userCredits;
        const newCredits = oldCredits - deductAmount;
        const adminOldCredits = adminProfile.credits || 0;
        const adminNewCredits = adminOldCredits + deductAmount;

        // 更新目标用户积分
        const { error: updateUserError } = await supabase
          .from("profiles")
          .update({ credits: newCredits })
          .eq("id", targetUserId);

        if (updateUserError) {
          console.error("[Admin API] Update user credits error:", updateUserError);
          return NextResponse.json(
            { success: false, error: "更新用户积分失败" },
            { status: 500 }
          );
        }

        // 增加管理员积分
        const { error: updateAdminError } = await supabase
          .from("profiles")
          .update({ credits: adminNewCredits })
          .eq("id", currentUser.id);

        if (updateAdminError) {
          // 回滚用户积分
          await supabase
            .from("profiles")
            .update({ credits: oldCredits })
            .eq("id", targetUserId);
          
          console.error("[Admin API] Update admin credits error:", updateAdminError);
          return NextResponse.json(
            { success: false, error: "更新管理员积分失败" },
            { status: 500 }
          );
        }

        console.log(`[Admin API] Credits deducted: ${targetUser.email} -${deductAmount}, Admin ${adminProfile.email} balance: ${adminNewCredits}`);

        result = {
          action: "deduct",
          old_credits: oldCredits,
          new_credits: newCredits,
          admin_old_credits: adminOldCredits,
          admin_new_credits: adminNewCredits,
          amount: -deductAmount,
          reason: reason.trim(),
          timestamp: new Date().toISOString(),
        };
        break;
      }

      // ============================================
      // 封禁用户 (Ban)
      // ============================================
      case "ban": {
        if (!reason || !reason.trim()) {
          return NextResponse.json(
            { success: false, error: "请填写封禁原因" },
            { status: 400 }
          );
        }

        // 检查是否尝试封禁 Admin
        if (isAdmin(targetUser.role)) {
          return NextResponse.json(
            { success: false, error: "无法封禁管理员账户" },
            { status: 403 }
          );
        }

        const timestamp = new Date().toISOString();

        const { error: banError } = await supabase
          .from("profiles")
          .update({
            status: "banned",
            banned_at: timestamp,
            banned_reason: reason.trim(),
          })
          .eq("id", targetUserId);

        if (banError) {
          console.error("[Admin API] Ban user error:", banError);
          return NextResponse.json(
            { success: false, error: "封禁用户失败" },
            { status: 500 }
          );
        }

        console.log(`[Admin API] User banned: ${targetUser.email} (${reason})`);

        result = {
          action: "ban",
          status: "banned",
          reason: reason.trim(),
          timestamp,
        };
        break;
      }

      // ============================================
      // 解封用户 (Unban)
      // ============================================
      case "unban": {
        const { error: unbanError } = await supabase
          .from("profiles")
          .update({
            status: "active",
            banned_at: null,
            banned_reason: null,
          })
          .eq("id", targetUserId);

        if (unbanError) {
          console.error("[Admin API] Unban user error:", unbanError);
          return NextResponse.json(
            { success: false, error: "解封用户失败" },
            { status: 500 }
          );
        }

        console.log(`[Admin API] User unbanned: ${targetUser.email}`);

        result = {
          action: "unban",
          status: "active",
          timestamp: new Date().toISOString(),
        };
        break;
      }

      // ============================================
      // 设置用户角色 (Set Role)
      // ============================================
      case "setRole": {
        const newRole = body.newRole as UserRole;
        
        if (!newRole || !["user", "creator", "admin", "super_admin"].includes(newRole)) {
          return NextResponse.json(
            { success: false, error: "无效的角色" },
            { status: 400 }
          );
        }

        // 只有超级管理员可以设置管理员角色
        if ((newRole === "admin" || newRole === "super_admin") && adminProfile.role !== "super_admin") {
          return NextResponse.json(
            { success: false, error: "只有超级管理员可以设置管理员角色" },
            { status: 403 }
          );
        }

        const { error: roleError } = await supabase
          .from("profiles")
          .update({ role: newRole })
          .eq("id", targetUserId);

        if (roleError) {
          console.error("[Admin API] Set role error:", roleError);
          return NextResponse.json(
            { success: false, error: "设置角色失败" },
            { status: 500 }
          );
        }

        console.log(`[Admin API] Role updated: ${targetUser.email} -> ${newRole}`);

        result = {
          action: "setRole",
          newRole,
          timestamp: new Date().toISOString(),
        };
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: "无效的操作" },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[Admin API] User action error:", error);
    return NextResponse.json(
      { success: false, error: "操作失败，请重试" },
      { status: 500 }
    );
  }
}
