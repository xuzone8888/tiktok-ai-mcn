/**
 * Admin 功能模块
 * 
 * 提供 Admin 相关的类型定义、辅助函数和 API 调用
 */

// ============================================================================
// 类型定义
// ============================================================================

export type UserRole = "user" | "admin" | "super_admin";
export type UserStatus = "active" | "suspended" | "banned";
export type AuditActionType =
  | "create_user"
  | "update_user"
  | "ban_user"
  | "unban_user"
  | "suspend_user"
  | "delete_user"
  | "change_role"
  | "recharge_credits"
  | "deduct_credits"
  | "refund_credits"
  | "create_model"
  | "update_model"
  | "delete_model"
  | "update_trigger_word"
  | "cancel_contract"
  | "extend_contract"
  | "system_config"
  | "other";

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  credits: number;
  created_at: string;
  banned_at?: string | null;
  banned_reason?: string | null;
}

export interface AuditLog {
  id: string;
  admin_id: string;
  admin_email: string | null;
  target_user_id: string | null;
  target_model_id: string | null;
  target_type: string | null;
  action_type: AuditActionType;
  action_description: string | null;
  details: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    amount?: number;
    reason?: string;
    [key: string]: unknown;
  };
  ip_address: string | null;
  created_at: string;
}

export interface RechargeCreditsParams {
  targetUserId: string;
  amount: number;
  reason?: string;
}

export interface BanUserParams {
  targetUserId: string;
  reason: string;
}

// ============================================================================
// 权限检查函数
// ============================================================================

/**
 * 检查用户是否是 Admin
 */
export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

/**
 * 检查用户是否是 Super Admin
 */
export function isSuperAdmin(role: UserRole | null | undefined): boolean {
  return role === "super_admin";
}

/**
 * 检查用户是否可以执行特定操作
 */
export function canPerformAction(
  userRole: UserRole,
  action: AuditActionType
): boolean {
  // Super Admin 可以执行所有操作
  if (userRole === "super_admin") return true;

  // Admin 可以执行的操作
  const adminAllowedActions: AuditActionType[] = [
    "recharge_credits",
    "deduct_credits",
    "refund_credits",
    "ban_user",
    "unban_user",
    "suspend_user",
    "create_model",
    "update_model",
    "update_trigger_word",
    "cancel_contract",
    "extend_contract",
  ];

  if (userRole === "admin") {
    return adminAllowedActions.includes(action);
  }

  // 普通用户不能执行任何 Admin 操作
  return false;
}

/**
 * 获取角色显示名称
 */
export function getRoleDisplayName(role: UserRole): string {
  switch (role) {
    case "super_admin":
      return "超级管理员";
    case "admin":
      return "管理员";
    case "user":
    default:
      return "普通用户";
  }
}

/**
 * 获取状态显示信息
 */
export function getStatusDisplay(status: UserStatus): {
  label: string;
  color: string;
} {
  switch (status) {
    case "active":
      return { label: "正常", color: "green" };
    case "suspended":
      return { label: "暂停", color: "yellow" };
    case "banned":
      return { label: "封禁", color: "red" };
    default:
      return { label: "未知", color: "gray" };
  }
}

/**
 * 获取操作类型显示名称
 */
export function getActionTypeDisplayName(action: AuditActionType): string {
  const displayNames: Record<AuditActionType, string> = {
    create_user: "创建用户",
    update_user: "更新用户",
    ban_user: "封禁用户",
    unban_user: "解封用户",
    suspend_user: "暂停用户",
    delete_user: "删除用户",
    change_role: "修改角色",
    recharge_credits: "充值积分",
    deduct_credits: "扣除积分",
    refund_credits: "退还积分",
    create_model: "创建模特",
    update_model: "更新模特",
    delete_model: "删除模特",
    update_trigger_word: "更新唤醒词",
    cancel_contract: "取消合约",
    extend_contract: "延长合约",
    system_config: "系统配置",
    other: "其他操作",
  };

  return displayNames[action] || action;
}

// ============================================================================
// Mock Admin 数据 (开发环境)
// ============================================================================

// Mock Admin 用户 ID (开发时使用)
export const MOCK_ADMIN_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@mcn.ai",
  name: "Admin",
  role: "super_admin" as UserRole,
  status: "active" as UserStatus,
  credits: 999999,
};

/**
 * 检查是否是 Mock Admin (开发环境)
 */
export function isMockAdmin(userId: string): boolean {
  return userId === MOCK_ADMIN_USER.id;
}

// ============================================================================
// API 辅助函数
// ============================================================================

/**
 * 格式化审计日志详情
 */
export function formatAuditDetails(log: AuditLog): string {
  const { action_type, details } = log;

  switch (action_type) {
    case "recharge_credits":
      return `充值 ${details.amount || 0} 积分。原因: ${details.reason || "无"}`;

    case "deduct_credits":
      return `扣除 ${Math.abs(details.amount || 0)} 积分。原因: ${details.reason || "无"}`;

    case "ban_user":
      return `封禁原因: ${details.reason || "无"}`;

    case "unban_user":
      return `解封原因: ${details.reason || "无"}`;

    case "update_model":
      return `更新模特信息`;

    case "update_trigger_word":
      return `更新唤醒词 (详情已隐藏)`;

    default:
      return log.action_description || JSON.stringify(details);
  }
}

/**
 * 生成审计日志的安全详情 (隐藏敏感信息)
 */
export function sanitizeAuditDetails(details: AuditLog["details"]): AuditLog["details"] {
  const sanitized = { ...details };

  // 隐藏唤醒词
  if (sanitized.before && "trigger_word" in sanitized.before) {
    sanitized.before = { ...sanitized.before, trigger_word: "[HIDDEN]" };
  }
  if (sanitized.after && "trigger_word" in sanitized.after) {
    sanitized.after = { ...sanitized.after, trigger_word: "[HIDDEN]" };
  }

  return sanitized;
}

