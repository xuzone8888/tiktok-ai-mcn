/**
 * Admin API - 系统设置
 * 
 * GET /api/admin/settings - 获取系统设置 (Admin 完整 / 用户部分)
 * POST /api/admin/settings - 更新系统设置 (仅 Admin)
 */

import { NextRequest, NextResponse } from "next/server";

// ============================================================================
// 类型定义
// ============================================================================

export interface PaymentInfo {
  bank_name: string;
  bank_account: string;
  bank_holder: string;
  usdt_address: string;
  usdt_network: string; // TRC20, ERC20, etc.
  alipay_account: string;
  wechat_account: string;
  notes: string;
}

export interface AnnouncementConfig {
  enabled: boolean;
  content: string;
  type: "info" | "warning" | "error" | "success";
  link_url?: string;
  link_text?: string;
  dismissible: boolean;
}

export interface PricingConfig {
  video_10s_credits: number;
  video_15s_credits: number;
  video_25s_credits: number;
  nano_banana_fast_credits: number;
  nano_banana_pro_credits: number;
}

export interface SystemSettings {
  payment_info: PaymentInfo;
  announcement: AnnouncementConfig;
  pricing: PricingConfig;
  maintenance_mode: boolean;
  updated_at: string;
  updated_by: string;
}

// ============================================================================
// Mock 数据存储
// ============================================================================

const mockSystemSettings: SystemSettings = {
  payment_info: {
    bank_name: "招商银行",
    bank_account: "6225 8888 8888 8888",
    bank_holder: "深圳创梦科技有限公司",
    usdt_address: "TRC20: TXyz...abc123",
    usdt_network: "TRC20",
    alipay_account: "pay@mcn.ai",
    wechat_account: "mcn_official",
    notes: "请在转账备注中填写您的注册邮箱，以便我们快速处理充值请求。",
  },
  announcement: {
    enabled: true,
    content: "🎉 新用户注册即送 100 积分！Sora 2 视频生成功能已上线，快来体验！",
    type: "info",
    link_url: "/quick-gen",
    link_text: "立即体验",
    dismissible: true,
  },
  pricing: {
    video_10s_credits: 20,
    video_15s_credits: 350,
    video_25s_credits: 350,
    nano_banana_fast_credits: 10,
    nano_banana_pro_credits: 28,
  },
  maintenance_mode: false,
  updated_at: new Date().toISOString(),
  updated_by: "admin@mcn.ai",
};

// Mock 审计日志
const mockAuditLogs: Array<{
  id: string;
  admin_id: string;
  admin_email: string;
  action_type: string;
  details: Record<string, unknown>;
  created_at: string;
}> = [];

const MOCK_ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const MOCK_ADMIN_EMAIL = "admin@mcn.ai";

// ============================================================================
// GET - 获取系统设置
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") || "public";

    // 公开数据 (用户可访问)
    if (scope === "public") {
      return NextResponse.json({
        success: true,
        data: {
          payment_info: mockSystemSettings.payment_info,
          announcement: mockSystemSettings.announcement,
          pricing: mockSystemSettings.pricing,
          maintenance_mode: mockSystemSettings.maintenance_mode,
        },
      });
    }

    // 完整数据 (仅 Admin)
    // TODO: 生产环境需验证 Admin 身份
    return NextResponse.json({
      success: true,
      data: mockSystemSettings,
    });
  } catch (error) {
    console.error("[Admin API] Get settings error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - 更新系统设置
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // TODO: 生产环境需验证 Admin 身份
    const adminId = MOCK_ADMIN_ID;
    const adminEmail = MOCK_ADMIN_EMAIL;

    const body = await request.json();
    const { section, data } = body;

    if (!section || !data) {
      return NextResponse.json(
        { success: false, error: "Missing section or data" },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString();
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // 根据 section 更新对应配置
    switch (section) {
      case "payment_info": {
        const oldData = { ...mockSystemSettings.payment_info };
        mockSystemSettings.payment_info = {
          ...mockSystemSettings.payment_info,
          ...data,
        };
        mockSystemSettings.updated_at = timestamp;
        mockSystemSettings.updated_by = adminEmail;

        // 记录审计日志
        mockAuditLogs.push({
          id: logId,
          admin_id: adminId,
          admin_email: adminEmail,
          action_type: "update_payment_info",
          details: {
            before: oldData,
            after: mockSystemSettings.payment_info,
          },
          created_at: timestamp,
        });
        break;
      }

      case "announcement": {
        const oldData = { ...mockSystemSettings.announcement };
        mockSystemSettings.announcement = {
          ...mockSystemSettings.announcement,
          ...data,
        };
        mockSystemSettings.updated_at = timestamp;
        mockSystemSettings.updated_by = adminEmail;

        // 记录审计日志
        mockAuditLogs.push({
          id: logId,
          admin_id: adminId,
          admin_email: adminEmail,
          action_type: "update_announcement",
          details: {
            before: oldData,
            after: mockSystemSettings.announcement,
          },
          created_at: timestamp,
        });
        break;
      }

      case "pricing": {
        const oldData = { ...mockSystemSettings.pricing };
        mockSystemSettings.pricing = {
          ...mockSystemSettings.pricing,
          ...data,
        };
        mockSystemSettings.updated_at = timestamp;
        mockSystemSettings.updated_by = adminEmail;

        mockAuditLogs.push({
          id: logId,
          admin_id: adminId,
          admin_email: adminEmail,
          action_type: "update_pricing",
          details: {
            before: oldData,
            after: mockSystemSettings.pricing,
          },
          created_at: timestamp,
        });
        break;
      }

      case "maintenance": {
        const oldMode = mockSystemSettings.maintenance_mode;
        mockSystemSettings.maintenance_mode = data.enabled ?? false;
        mockSystemSettings.updated_at = timestamp;
        mockSystemSettings.updated_by = adminEmail;

        mockAuditLogs.push({
          id: logId,
          admin_id: adminId,
          admin_email: adminEmail,
          action_type: "toggle_maintenance",
          details: {
            before: { maintenance_mode: oldMode },
            after: { maintenance_mode: mockSystemSettings.maintenance_mode },
          },
          created_at: timestamp,
        });
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: "Invalid section" },
          { status: 400 }
        );
    }

    console.log(`[Admin API] Settings updated: ${section} by ${adminEmail}`);

    return NextResponse.json({
      success: true,
      data: {
        section,
        updated_at: timestamp,
        log_id: logId,
      },
    });
  } catch (error) {
    console.error("[Admin API] Update settings error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update settings" },
      { status: 500 }
    );
  }
}

