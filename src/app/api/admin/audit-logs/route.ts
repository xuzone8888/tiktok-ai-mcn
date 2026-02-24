/**
 * Admin API - 审计日志
 * 
 * GET /api/admin/audit-logs - 获取审计日志列表
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

// ============================================================================
// 类型定义
// ============================================================================

interface AuditLog {
  id: string;
  admin_id: string;
  admin_email: string;
  target_user_id?: string | null;
  target_model_id?: string | null;
  target_type?: string;
  action_type: string;
  action_description?: string;
  details: Record<string, unknown>;
  ip_address?: string | null;
  created_at: string;
}

// ============================================================================
// Mock 审计日志数据
// ============================================================================

const mockAuditLogs: AuditLog[] = [
  {
    id: "log-001",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_user_id: "00000000-0000-0000-0000-000000000002",
    target_type: "user",
    action_type: "recharge_credits",
    action_description: "Admin recharged 500 credits to creator@mcn.ai",
    details: {
      before: { credits: 4500 },
      after: { credits: 5000 },
      amount: 500,
      reason: "线下转账充值",
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 minutes ago
  },
  {
    id: "log-002",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_model_id: "model-001",
    target_type: "model",
    action_type: "update_trigger_word",
    action_description: "Admin updated trigger word for Luna AI",
    details: {
      model_name: "Luna AI",
      changed: true,
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 minutes ago
  },
  {
    id: "log-003",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_user_id: "00000000-0000-0000-0000-000000000005",
    target_type: "user",
    action_type: "ban_user",
    action_description: "Admin banned user banned@example.com",
    details: {
      target_email: "banned@example.com",
      reason: "违规操作",
      banned_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour ago
  },
  {
    id: "log-004",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_type: "system",
    action_type: "update_announcement",
    action_description: "Admin updated system announcement",
    details: {
      before: { enabled: false },
      after: { enabled: true, content: "🎉 新用户注册即送 100 积分！" },
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
  },
  {
    id: "log-005",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_model_id: "model-002",
    target_type: "model",
    action_type: "create_model",
    action_description: "Admin created new model Alex Fit",
    details: {
      model_name: "Alex Fit",
      category: "Fitness",
      has_trigger_word: true,
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), // 3 hours ago
  },
  {
    id: "log-006",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_user_id: "00000000-0000-0000-0000-000000000003",
    target_type: "user",
    action_type: "deduct_credits",
    action_description: "Admin deducted 100 credits from user1@example.com",
    details: {
      before: { credits: 1300 },
      after: { credits: 1200 },
      amount: -100,
      reason: "系统测试扣除",
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), // 5 hours ago
  },
  {
    id: "log-007",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_type: "system",
    action_type: "update_pricing",
    action_description: "Admin updated pricing configuration",
    details: {
      before: { video_10s_credits: 30 },
      after: { video_10s_credits: 20 },
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
  },
  {
    id: "log-008",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_user_id: "00000000-0000-0000-0000-000000000004",
    target_type: "user",
    action_type: "unban_user",
    action_description: "Admin unbanned user user2@example.com",
    details: {
      target_email: "user2@example.com",
      reason: "误封解除",
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
  },
  {
    id: "log-009",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_type: "system",
    action_type: "update_payment_info",
    action_description: "Admin updated payment information",
    details: {
      updated_fields: ["bank_account", "usdt_address"],
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), // 3 days ago
  },
  {
    id: "log-010",
    admin_id: "00000000-0000-0000-0000-000000000001",
    admin_email: "admin@mcn.ai",
    target_model_id: "model-003",
    target_type: "model",
    action_type: "update_model",
    action_description: "Admin updated model Mia Rose",
    details: {
      model_name: "Mia Rose",
      updated_fields: ["price_monthly", "is_featured"],
    },
    ip_address: "192.168.1.1",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString(), // 4 days ago
  },
];

// ============================================================================
// GET - 获取审计日志
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // 鉴权：验证管理员身份
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const actionType = searchParams.get("action_type");
    const search = searchParams.get("search");

    let filteredLogs = [...mockAuditLogs];

    // 按操作类型筛选
    if (actionType && actionType !== "all") {
      filteredLogs = filteredLogs.filter((log) => log.action_type === actionType);
    }

    // 按搜索词筛选 (搜索 admin_email)
    if (search) {
      const searchLower = search.toLowerCase();
      filteredLogs = filteredLogs.filter(
        (log) =>
          log.admin_email.toLowerCase().includes(searchLower) ||
          log.action_description?.toLowerCase().includes(searchLower)
      );
    }

    // 按时间排序 (最新的在前)
    filteredLogs.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // 分页
    const total = filteredLogs.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const paginatedLogs = filteredLogs.slice(startIndex, startIndex + limit);

    return NextResponse.json({
      success: true,
      data: {
        logs: paginatedLogs,
        total,
        page,
        limit,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    console.error("[Admin API] Get audit logs error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get audit logs" },
      { status: 500 }
    );
  }
}
