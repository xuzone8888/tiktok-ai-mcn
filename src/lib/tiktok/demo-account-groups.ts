import { MAX_ACCOUNTS_PER_GROUP } from "@/lib/tiktok/account-groups";

type DemoAccount = {
  id: string;
  open_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  follower_count: number;
  following_count: number;
  likes_count: number;
  video_count: number;
  account_type: string;
  status: string;
  token_expires_at: string | null;
  scopes: string[];
  created_at: string;
  updated_at: string;
  group_id: string | null;
  group_name: string | null;
};

type DemoGroup = {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type DemoStore = {
  accounts: DemoAccount[];
  groups: DemoGroup[];
  nextGroupNumber: number;
};

const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_STARTED_AT = "2026-05-16T00:00:00.000Z";
const ATTENTION_DAYS = 30;

const globalForDemo = globalThis as typeof globalThis & {
  __tiktokAccountGroupsDemoStore?: DemoStore;
};

function demoUuid(prefix: string, index: number) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function tokenDate(index: number) {
  let days = 320 - index;

  if (index % 13 === 0) {
    days = -2;
  } else if (index % 7 === 0) {
    days = 8;
  }

  return new Date(Date.UTC(2026, 4, 16 + days)).toISOString();
}

function buildAccount(index: number, groupId: string | null): DemoAccount {
  const expiresAt = tokenDate(index);
  const expired = new Date(expiresAt).getTime() <= Date.now();
  const username = `matrix_${String(index).padStart(2, "0")}`;

  return {
    id: demoUuid("20000000", index),
    open_id: `demo-open-${String(index).padStart(3, "0")}`,
    username,
    display_name: `矩阵账号 ${String(index).padStart(2, "0")}`,
    avatar_url: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(username)}`,
    follower_count: 300 + index * 137,
    following_count: 40 + index,
    likes_count: 1200 + index * 421,
    video_count: 4 + (index % 19),
    account_type: "normal",
    status: expired ? "expired" : "active",
    token_expires_at: expiresAt,
    scopes: ["user.info.basic", "video.publish"],
    created_at: DEMO_STARTED_AT,
    updated_at: DEMO_STARTED_AT,
    group_id: groupId,
    group_name: null,
  };
}

function createInitialStore(): DemoStore {
  const groups: DemoGroup[] = [
    {
      id: demoUuid("10000000", 1),
      user_id: DEMO_USER_ID,
      name: "A组 北美素材",
      color: null,
      sort_order: 0,
      created_at: DEMO_STARTED_AT,
      updated_at: DEMO_STARTED_AT,
    },
    {
      id: demoUuid("10000000", 2),
      user_id: DEMO_USER_ID,
      name: "B组 电商短剧",
      color: null,
      sort_order: 1,
      created_at: DEMO_STARTED_AT,
      updated_at: DEMO_STARTED_AT,
    },
    {
      id: demoUuid("10000000", 3),
      user_id: DEMO_USER_ID,
      name: "C组 测试发布",
      color: null,
      sort_order: 2,
      created_at: DEMO_STARTED_AT,
      updated_at: DEMO_STARTED_AT,
    },
  ];

  const accounts = Array.from({ length: 60 }, (_, itemIndex) => {
    const index = itemIndex + 1;
    let groupId: string | null = null;

    if (index <= 5) {
      groupId = groups[0].id;
    } else if (index <= 10) {
      groupId = groups[1].id;
    } else if (index <= 15) {
      groupId = groups[2].id;
    }

    return buildAccount(index, groupId);
  });

  return {
    accounts,
    groups,
    nextGroupNumber: 4,
  };
}

function getStore() {
  if (!globalForDemo.__tiktokAccountGroupsDemoStore) {
    globalForDemo.__tiktokAccountGroupsDemoStore = createInitialStore();
  }

  return globalForDemo.__tiktokAccountGroupsDemoStore;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function groupNameById(groups: DemoGroup[]) {
  return new Map(groups.map((group) => [group.id, group.name]));
}

function hydrateAccounts(accounts: DemoAccount[], groups: DemoGroup[]) {
  const names = groupNameById(groups);
  return accounts.map((account) => ({
    ...account,
    group_name: account.group_id ? names.get(account.group_id) || null : null,
  }));
}

function isExpiringSoon(expiresAt: string | null) {
  if (!expiresAt) {
    return true;
  }

  const daysUntilExpiry = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry < ATTENTION_DAYS;
}

function isAuthorizedForGrouping(account: DemoAccount) {
  return (
    account.status === "active" &&
    Boolean(account.token_expires_at) &&
    new Date(account.token_expires_at!).getTime() > Date.now()
  );
}

function hydrateGroups(store: DemoStore) {
  const accounts = hydrateAccounts(store.accounts, store.groups);

  return store.groups.map((group) => {
    const groupAccounts = accounts.filter((account) => account.group_id === group.id);
    const attentionCount = groupAccounts.filter(
      (account) => account.status !== "active" || isExpiringSoon(account.token_expires_at)
    ).length;

    return {
      ...group,
      accounts_count: groupAccounts.length,
      active_count: groupAccounts.length - attentionCount,
      attention_count: attentionCount,
      max_accounts: MAX_ACCOUNTS_PER_GROUP,
      accounts: groupAccounts,
    };
  });
}

function findGroup(store: DemoStore, groupId: string) {
  return store.groups.find((group) => group.id === groupId);
}

function normalizeName(name: unknown) {
  return typeof name === "string" ? name.trim() : "";
}

function assertGroupNameAvailable(store: DemoStore, name: string, excludeGroupId?: string) {
  const duplicate = store.groups.some(
    (group) => group.id !== excludeGroupId && group.name.trim().toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    throw new Error("idx_tiktok_account_groups_user_name_lower");
  }
}

function dedupeAccountIds(accountIds: string[]) {
  return Array.from(new Set(accountIds));
}

export function isTikTokGroupsDemoMode() {
  return (
    process.env.NEXT_PUBLIC_TIKTOK_GROUPS_DEMO === "true" ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getDemoAccountsResponse() {
  const store = getStore();
  return { accounts: clone(hydrateAccounts(store.accounts, store.groups)) };
}

export function getDemoGroupsResponse() {
  const store = getStore();
  return { groups: clone(hydrateGroups(store)) };
}

export function getDemoGroupAccountsResponse(
  groupId: string,
  { query = "", limit = 50, offset = 0 }: { query?: string; limit?: number; offset?: number } = {}
) {
  const store = getStore();
  const group = findGroup(store, groupId);

  if (!group) {
    throw new Error("GROUP_NOT_FOUND");
  }

  const accounts = hydrateAccounts(store.accounts, store.groups);
  const groupAccounts = accounts.filter((account) => account.group_id === groupId);
  const normalizedQuery = query.trim().toLowerCase();
  const availableAccounts = accounts.filter((account) => {
    if (account.group_id || account.account_type !== "normal" || !isAuthorizedForGrouping(account)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [account.username, account.display_name, account.open_id]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedQuery));
  });
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safeOffset = Math.max(offset, 0);

  return {
    group: clone(group),
    accounts: clone(groupAccounts),
    available_accounts: clone(availableAccounts.slice(safeOffset, safeOffset + safeLimit)),
    available_total: availableAccounts.length,
    limit: safeLimit,
    offset: safeOffset,
    max_accounts: MAX_ACCOUNTS_PER_GROUP,
  };
}

export function createDemoAccountGroup(nameValue: unknown, accountIdsValue: unknown) {
  const store = getStore();
  const name = normalizeName(nameValue);
  const accountIds = Array.isArray(accountIdsValue) ? dedupeAccountIds(accountIdsValue) : [];

  if (!name) {
    throw new Error("INVALID_GROUP_NAME");
  }

  if (name.length > 20) {
    throw new Error("GROUP_NAME_TOO_LONG");
  }

  if (accountIds.length < 1) {
    throw new Error("ACCOUNT_IDS_REQUIRED");
  }

  if (accountIds.length > MAX_ACCOUNTS_PER_GROUP) {
    throw new Error("TOO_MANY_ACCOUNTS");
  }

  assertGroupNameAvailable(store, name);

  const availableAccounts = store.accounts.filter(
    (account) =>
      accountIds.includes(account.id) && account.account_type === "normal" && account.group_id === null
  );

  if (availableAccounts.length !== accountIds.length) {
    throw new Error("ACCOUNT_NOT_AVAILABLE");
  }

  if (availableAccounts.some((account) => !isAuthorizedForGrouping(account))) {
    throw new Error("ACCOUNT_NOT_AUTHORIZED");
  }

  const group: DemoGroup = {
    id: demoUuid("10000000", store.nextGroupNumber++),
    user_id: DEMO_USER_ID,
    name,
    color: null,
    sort_order: store.groups.length,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  store.groups.push(group);
  availableAccounts.forEach((account) => {
    account.group_id = group.id;
    account.updated_at = group.updated_at;
  });

  return clone(group);
}

export function renameDemoAccountGroup(groupId: string, nameValue: unknown) {
  const store = getStore();
  const group = findGroup(store, groupId);
  const name = normalizeName(nameValue);

  if (!group) {
    throw new Error("GROUP_NOT_FOUND");
  }

  if (!name) {
    throw new Error("INVALID_GROUP_NAME");
  }

  if (name.length > 20) {
    throw new Error("GROUP_NAME_TOO_LONG");
  }

  assertGroupNameAvailable(store, name, group.id);
  group.name = name;
  group.updated_at = new Date().toISOString();

  return clone(group);
}

export function deleteDemoAccountGroup(groupId: string) {
  const store = getStore();
  const group = findGroup(store, groupId);

  if (!group) {
    throw new Error("GROUP_NOT_FOUND");
  }

  let releasedCount = 0;
  store.accounts.forEach((account) => {
    if (account.group_id === groupId) {
      account.group_id = null;
      account.updated_at = new Date().toISOString();
      releasedCount += 1;
    }
  });
  store.groups = store.groups.filter((item) => item.id !== groupId);

  return releasedCount;
}

export function refreshDemoAccount(accountId: string) {
  const store = getStore();
  const account = store.accounts.find((item) => item.id === accountId && item.account_type === "normal");

  if (!account) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }

  const expiresAt = new Date(Date.now() + 330 * 24 * 60 * 60 * 1000).toISOString();
  account.status = "active";
  account.token_expires_at = expiresAt;
  account.follower_count += 3;
  account.likes_count += 12;
  account.updated_at = new Date().toISOString();

  return {
    success: true,
    expiresAt,
  };
}

export function deleteDemoAccount(accountId: string) {
  const store = getStore();
  const account = store.accounts.find((item) => item.id === accountId && item.account_type === "normal");

  if (!account) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }

  const groupId = account.group_id;
  store.accounts = store.accounts.filter((item) => item.id !== accountId);

  if (groupId && !store.accounts.some((item) => item.group_id === groupId)) {
    store.groups = store.groups.filter((group) => group.id !== groupId);
  }

  return { success: true };
}

export function addDemoAccountsToGroup(groupId: string, accountIdsValue: unknown) {
  const store = getStore();
  const group = findGroup(store, groupId);
  const accountIds = Array.isArray(accountIdsValue) ? dedupeAccountIds(accountIdsValue) : [];

  if (!group) {
    throw new Error("GROUP_NOT_FOUND");
  }

  if (accountIds.length < 1) {
    throw new Error("ACCOUNT_IDS_REQUIRED");
  }

  const currentCount = store.accounts.filter((account) => account.group_id === groupId).length;

  if (currentCount + accountIds.length > MAX_ACCOUNTS_PER_GROUP) {
    throw new Error("GROUP_FULL");
  }

  const availableAccounts = store.accounts.filter(
    (account) =>
      accountIds.includes(account.id) && account.account_type === "normal" && account.group_id === null
  );

  if (availableAccounts.length !== accountIds.length) {
    throw new Error("ACCOUNT_NOT_AVAILABLE");
  }

  if (availableAccounts.some((account) => !isAuthorizedForGrouping(account))) {
    throw new Error("ACCOUNT_NOT_AUTHORIZED");
  }

  const updatedAt = new Date().toISOString();
  availableAccounts.forEach((account) => {
    account.group_id = groupId;
    account.updated_at = updatedAt;
  });
  group.updated_at = updatedAt;

  return availableAccounts.length;
}

export function removeDemoAccountFromGroup(groupId: string, accountId: string) {
  const store = getStore();
  const group = findGroup(store, groupId);

  if (!group) {
    throw new Error("GROUP_NOT_FOUND");
  }

  const currentCount = store.accounts.filter((account) => account.group_id === groupId).length;

  if (currentCount <= 1) {
    throw new Error("LAST_ACCOUNT_IN_GROUP");
  }

  const account = store.accounts.find(
    (item) => item.id === accountId && item.group_id === groupId && item.account_type === "normal"
  );

  if (!account) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }

  account.group_id = null;
  account.updated_at = new Date().toISOString();
  group.updated_at = account.updated_at;

  return 1;
}
