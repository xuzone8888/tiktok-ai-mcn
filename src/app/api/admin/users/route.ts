/**
 * Admin API - 用户管理
 * 
 * GET /api/admin/users - 获取用户列表
 * POST /api/admin/users - 用户操作 (充值/扣除/封禁/解封)
 * 
 * 关键特性：
 * - 积分操作使用事务确保原子性
 * - 所有操作写入审计日志
 */

import { NextResponse } from "next/server";
import { isAdmin, type AdminUser, type UserRole, type UserStatus } from "@/lib/admin";

// ============================================================================
// Mock 数据存储 (开发环境)
// ============================================================================

interface MockUser extends AdminUser {
  avatar_url?: string | null;
}

const mockUsers: Map<string, MockUser> = new Map([
  [
    "00000000-0000-0000-0000-000000000001",
    {
      id: "00000000-0000-0000-0000-000000000001",
      email: "admin@mcn.ai",
      name: "Admin",
      avatar_url: null,
      role: "super_admin",
      status: "active",
      credits: 999999,
      created_at: "2024-01-01T00:00:00Z",
    },
  ],
  [
    "00000000-0000-0000-0000-000000000002",
    {
      id: "00000000-0000-0000-0000-000000000002",
      email: "creator@mcn.ai",
      name: "创作者",
      avatar_url: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop",
      role: "user",
      status: "active",
      credits: 5000,
      created_at: "2024-01-15T00:00:00Z",
    },
  ],
  [
    "00000000-0000-0000-0000-000000000003",
    {
      id: "00000000-0000-0000-0000-000000000003",
      email: "user1@example.com",
      name: "用户A",
      avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
      role: "user",
      status: "active",
      credits: 1200,
      created_at: "2024-02-01T00:00:00Z",
    },
  ],
  [
    "00000000-0000-0000-0000-000000000004",
    {
      id: "00000000-0000-0000-0000-000000000004",
      email: "user2@example.com",
      name: "用户B",
      avatar_url: null,
      role: "user",
      status: "suspended",
      credits: 300,
      created_at: "2024-02-15T00:00:00Z",
    },
  ],
  [
    "00000000-0000-0000-0000-000000000005",
    {
      id: "00000000-0000-0000-0000-000000000005",
      email: "banned@example.com",
      name: "被封禁用户",
      avatar_url: null,
      role: "user",
      status: "banned",
      credits: 0,
      created_at: "2024-03-01T00:00:00Z",
      banned_at: "2024-03-10T00:00:00Z",
      banned_reason: "违规操作",
    },
  ],
  [
    "00000000-0000-0000-0000-000000000006",
    {
      id: "00000000-0000-0000-0000-000000000006",
      email: "vip@example.com",
      name: "VIP用户",
      avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop",
      role: "user",
      status: "active",
      credits: 25000,
      created_at: "2024-01-20T00:00:00Z",
    },
  ],
  [
    "00000000-0000-0000-0000-000000000007",
    {
      id: "00000000-0000-0000-0000-000000000007",
      email: "newuser@example.com",
      name: "新用户",
      avatar_url: null,
      role: "user",
      status: "active",
      credits: 100,
      created_at: "2024-03-15T00:00:00Z",
    },
  ],
]);

// Mock 审计日志存储
interface AuditLogEntry {
  id: string;
  admin_id: string;
  admin_email: string;
  target_user_id: string;
  target_type: string;
  action_type: string;
  action_description: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

const mockAuditLogs: AuditLogEntry[] = [];

// Mock 当前管理员 (开发环境默认)
const MOCK_ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const MOCK_ADMIN_EMAIL = "admin@mcn.ai";

// ============================================================================
// GET - 获取用户列表
// ============================================================================

export async function GET(request: Request) {
  try {
    // TODO: 生产环境需要验证 Admin 身份
    // const session = await getServerSession();
    // if (!session || !isAdmin(session.user.role)) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as UserStatus | null;
    const role = searchParams.get("role") as UserRole | null;
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    // 过滤用户
    let users = Array.from(mockUsers.values());

    if (status) {
      users = users.filter((u) => u.status === status);
    }

    if (role) {
      users = users.filter((u) => u.role === role);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      users = users.filter(
        (u) =>
          u.email.toLowerCase().includes(searchLower) ||
          u.name?.toLowerCase().includes(searchLower)
      );
    }

    // 分页
    const total = users.length;
    const start = (page - 1) * limit;
    const paginatedUsers = users.slice(start, start + limit);

    return NextResponse.json({
      success: true,
      data: {
        users: paginatedUsers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
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
// 
// 【关键】使用事务确保原子性：
// - 积分操作：同时更新 credits 和写入 audit_logs
// - 只有两个操作都成功，整体才算成功
// ============================================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, targetUserId, amount, reason } = body;

    // TODO: 生产环境需要验证 Admin 身份
    const adminId = MOCK_ADMIN_ID;
    const adminEmail = MOCK_ADMIN_EMAIL;

    const targetUser = mockUsers.get(targetUserId);
    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    let result: Record<string, unknown> = {};

    switch (action) {
      // ============================================
      // 充值积分 (Recharge)
      // ============================================
      case "recharge": {
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { success: false, error: "Invalid amount: must be positive" },
            { status: 400 }
          );
        }

        if (!reason || !reason.trim()) {
          return NextResponse.json(
            { success: false, error: "Reason is required" },
            { status: 400 }
          );
        }

        // ========== 开始事务 ==========
        const oldCredits = targetUser.credits;
        const newCredits = oldCredits + amount;
        const logId = `log-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const timestamp = new Date().toISOString();

        try {
          // 动作 A: 更新积分余额
          targetUser.credits = newCredits;
          mockUsers.set(targetUserId, targetUser);

          // 动作 B: 写入审计日志
          const auditLog: AuditLogEntry = {
            id: logId,
            admin_id: adminId,
            admin_email: adminEmail,
            target_user_id: targetUserId,
            target_type: "user",
            action_type: "recharge_credits",
            action_description: `Admin recharged ${amount} credits to ${targetUser.email}`,
            details: {
              before: { credits: oldCredits },
              after: { credits: newCredits },
              amount: amount,
              reason: reason.trim(),
              operation: "recharge",
            },
            ip_address: null, // 生产环境应从请求中获取
            created_at: timestamp,
          };
          mockAuditLogs.push(auditLog);

          // 事务成功
          console.log(`[Admin API] Credits recharged: ${targetUser.email} +${amount} (${reason})`);

        } catch (txError) {
          // 事务失败：回滚积分更新
          targetUser.credits = oldCredits;
          mockUsers.set(targetUserId, targetUser);
          throw txError;
        }
        // ========== 事务结束 ==========

        result = {
          action: "recharge",
          old_credits: oldCredits,
          new_credits: newCredits,
          amount: amount,
          reason: reason.trim(),
          log_id: logId,
          timestamp,
        };
        break;
      }

      // ============================================
      // 扣除积分 (Deduct)
      // ============================================
      case "deduct": {
        const deductAmount = Math.abs(amount || 0);
        
        if (deductAmount <= 0) {
          return NextResponse.json(
            { success: false, error: "Invalid amount: must be positive" },
            { status: 400 }
          );
        }

        if (!reason || !reason.trim()) {
          return NextResponse.json(
            { success: false, error: "Reason is required" },
            { status: 400 }
          );
        }

        if (deductAmount > targetUser.credits) {
          return NextResponse.json(
            { success: false, error: "Insufficient credits" },
            { status: 400 }
          );
        }

        // ========== 开始事务 ==========
        const oldCredits = targetUser.credits;
        const newCredits = oldCredits - deductAmount;
        const logId = `log-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const timestamp = new Date().toISOString();

        try {
          // 动作 A: 更新积分余额
          targetUser.credits = newCredits;
          mockUsers.set(targetUserId, targetUser);

          // 动作 B: 写入审计日志
          const auditLog: AuditLogEntry = {
            id: logId,
            admin_id: adminId,
            admin_email: adminEmail,
            target_user_id: targetUserId,
            target_type: "user",
            action_type: "deduct_credits",
            action_description: `Admin deducted ${deductAmount} credits from ${targetUser.email}`,
            details: {
              before: { credits: oldCredits },
              after: { credits: newCredits },
              amount: -deductAmount,
              reason: reason.trim(),
              operation: "deduct",
            },
            ip_address: null,
            created_at: timestamp,
          };
          mockAuditLogs.push(auditLog);

          console.log(`[Admin API] Credits deducted: ${targetUser.email} -${deductAmount} (${reason})`);

        } catch (txError) {
          // 事务失败：回滚
          targetUser.credits = oldCredits;
          mockUsers.set(targetUserId, targetUser);
          throw txError;
        }
        // ========== 事务结束 ==========

        result = {
          action: "deduct",
          old_credits: oldCredits,
          new_credits: newCredits,
          amount: -deductAmount,
          reason: reason.trim(),
          log_id: logId,
          timestamp,
        };
        break;
      }

      // ============================================
      // 封禁用户 (Ban)
      // ============================================
      case "ban": {
        if (!reason || !reason.trim()) {
          return NextResponse.json(
            { success: false, error: "Reason is required for ban" },
            { status: 400 }
          );
        }

        // 检查是否尝试封禁 Admin
        if (isAdmin(targetUser.role)) {
          return NextResponse.json(
            { success: false, error: "Cannot ban admin users" },
            { status: 403 }
          );
        }

        // ========== 开始事务 ==========
        const logId = `log-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const timestamp = new Date().toISOString();
        const previousStatus = targetUser.status;

        try {
          // 动作 A: 更新用户状态
          targetUser.status = "banned";
          targetUser.banned_at = timestamp;
          targetUser.banned_reason = reason.trim();
          mockUsers.set(targetUserId, targetUser);

          // 动作 B: 写入审计日志
          const auditLog: AuditLogEntry = {
            id: logId,
            admin_id: adminId,
            admin_email: adminEmail,
            target_user_id: targetUserId,
            target_type: "user",
            action_type: "ban_user",
            action_description: `Admin banned user ${targetUser.email}`,
            details: {
              target_email: targetUser.email,
              previous_status: previousStatus,
              reason: reason.trim(),
              banned_at: timestamp,
            },
            ip_address: null,
            created_at: timestamp,
          };
          mockAuditLogs.push(auditLog);

          console.log(`[Admin API] User banned: ${targetUser.email} (${reason})`);

        } catch (txError) {
          // 事务失败：回滚
          targetUser.status = previousStatus as UserStatus;
          targetUser.banned_at = null;
          targetUser.banned_reason = null;
          mockUsers.set(targetUserId, targetUser);
          throw txError;
        }
        // ========== 事务结束 ==========

        result = {
          action: "ban",
          status: "banned",
          reason: reason.trim(),
          log_id: logId,
          timestamp,
        };
        break;
      }

      // ============================================
      // 解封用户 (Unban)
      // ============================================
      case "unban": {
        // ========== 开始事务 ==========
        const logId = `log-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const timestamp = new Date().toISOString();
        const previousStatus = targetUser.status;
        const previousBannedAt = targetUser.banned_at;
        const previousBannedReason = targetUser.banned_reason;

        try {
          // 动作 A: 更新用户状态
          targetUser.status = "active";
          targetUser.banned_at = null;
          targetUser.banned_reason = null;
          mockUsers.set(targetUserId, targetUser);

          // 动作 B: 写入审计日志
          const auditLog: AuditLogEntry = {
            id: logId,
            admin_id: adminId,
            admin_email: adminEmail,
            target_user_id: targetUserId,
            target_type: "user",
            action_type: "unban_user",
            action_description: `Admin unbanned user ${targetUser.email}`,
            details: {
              target_email: targetUser.email,
              previous_status: previousStatus,
              previous_ban_reason: previousBannedReason,
              reason: reason?.trim() || "Admin unbanned",
            },
            ip_address: null,
            created_at: timestamp,
          };
          mockAuditLogs.push(auditLog);

          console.log(`[Admin API] User unbanned: ${targetUser.email}`);

        } catch (txError) {
          // 事务失败：回滚
          targetUser.status = previousStatus as UserStatus;
          targetUser.banned_at = previousBannedAt;
          targetUser.banned_reason = previousBannedReason;
          mockUsers.set(targetUserId, targetUser);
          throw txError;
        }
        // ========== 事务结束 ==========

        result = {
          action: "unban",
          status: "active",
          log_id: logId,
          timestamp,
        };
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: "Invalid action" },
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
      { success: false, error: "Transaction failed. Please try again." },
      { status: 500 }
    );
  }
}

// ============================================================================
// 导出审计日志 (供 audit-logs API 使用)
// ============================================================================

export function getAuditLogs() {
  return mockAuditLogs;
}

