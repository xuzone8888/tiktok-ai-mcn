export const MAX_ACCOUNTS_PER_GROUP = 20;
export const GROUP_NAME_MAX_LENGTH = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeGroupName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateGroupName(value: unknown) {
  const name = normalizeGroupName(value);

  if (!name) {
    return { ok: false as const, error: "请输入分组名称" };
  }

  if (name.length > GROUP_NAME_MAX_LENGTH) {
    return { ok: false as const, error: `分组名称最多 ${GROUP_NAME_MAX_LENGTH} 个字符` };
  }

  return { ok: true as const, name };
}

export function sanitizeUuidList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && UUID_RE.test(item)))
  );
}

export function isUuid(value: string) {
  return UUID_RE.test(value);
}

export function mapAccountGroupError(error: unknown) {
  const err = error as { code?: string; message?: string; details?: string } | null;
  const rawMessage = `${err?.message || ""} ${err?.details || ""}`;

  if (err?.code === "23505" || rawMessage.includes("idx_tiktok_account_groups_user_name_lower")) {
    return { status: 409, message: "这个分组名称已经存在" };
  }

  if (rawMessage.includes("UNAUTHORIZED")) {
    return { status: 401, message: "请先登录" };
  }

  if (rawMessage.includes("INVALID_GROUP_NAME")) {
    return { status: 400, message: "请输入分组名称" };
  }

  if (rawMessage.includes("GROUP_NAME_TOO_LONG")) {
    return { status: 400, message: `分组名称最多 ${GROUP_NAME_MAX_LENGTH} 个字符` };
  }

  if (rawMessage.includes("ACCOUNT_IDS_REQUIRED")) {
    return { status: 400, message: "请至少选择 1 个账号" };
  }

  if (rawMessage.includes("TOO_MANY_ACCOUNTS") || rawMessage.includes("GROUP_FULL")) {
    return { status: 400, message: `每个分组最多 ${MAX_ACCOUNTS_PER_GROUP} 个账号` };
  }

  if (rawMessage.includes("ACCOUNT_NOT_AVAILABLE")) {
    return { status: 409, message: "只能选择当前未分组的普通 TikTok 内容账号" };
  }

  if (rawMessage.includes("ACCOUNT_NOT_AUTHORIZED")) {
    return { status: 409, message: "只能加入已授权且未过期的 TikTok 内容账号" };
  }

  if (rawMessage.includes("CROSS_GROUP_MOVE_NOT_SUPPORTED")) {
    return { status: 409, message: "第一版暂不支持跨组移动账号，请先从原分组移出" };
  }

  if (rawMessage.includes("GROUP_NOT_FOUND")) {
    return { status: 404, message: "分组不存在或已被删除" };
  }

  if (rawMessage.includes("ACCOUNT_NOT_FOUND")) {
    return { status: 404, message: "账号不存在或不在这个分组中" };
  }

  if (rawMessage.includes("LAST_ACCOUNT_IN_GROUP")) {
    return { status: 400, message: "分组至少需要保留 1 个账号；如不再使用，请删除整个分组" };
  }

  return { status: 500, message: "账号分组操作失败，请稍后重试" };
}
