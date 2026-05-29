"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Check,
  CheckCircle,
  ChevronDown,
  Filter,
  Globe,
  Layers3,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Smartphone,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { GROUP_NAME_MAX_LENGTH, MAX_ACCOUNTS_PER_GROUP } from "@/lib/tiktok/account-groups";
import { cn } from "@/lib/utils";

interface TikTokAccount {
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
}

interface AccountGroup {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  accounts_count: number;
  active_count: number;
  attention_count: number;
  max_accounts: number;
  accounts: TikTokAccount[];
}

type SortOption = "followers_desc" | "followers_asc" | "auth_time_desc" | "auth_time_asc";
type FilterOption = "all" | "active" | "expiring" | "expired" | "grouped" | "ungrouped";
type ViewMode = "accounts" | "groups";
type AccountStatusFilter = "all" | "active" | "expiring";
type AccountSelectSortOption = "followers_desc" | "followers_asc" | "auth_time_desc" | "auth_time_asc";
type QrBindingStatus = "idle" | "loading" | "ready" | "scanned" | "completed" | "expired" | "error";

interface QrBindingState {
  state: string;
  qrImageDataUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
  status: QrBindingStatus;
  message?: string;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "followers_desc", label: "粉丝最多" },
  { value: "followers_asc", label: "粉丝最少" },
  { value: "auth_time_desc", label: "最近绑定" },
  { value: "auth_time_asc", label: "最早绑定" },
];

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: "all", label: "全部账号" },
  { value: "active", label: "已授权" },
  { value: "expiring", label: "即将过期" },
  { value: "expired", label: "已过期" },
  { value: "grouped", label: "已分组" },
  { value: "ungrouped", label: "未分组" },
];

const ACCOUNT_STATUS_FILTERS: { value: AccountStatusFilter; label: string }[] = [
  { value: "all", label: "全部可加入" },
  { value: "active", label: "已授权" },
  { value: "expiring", label: "即将过期" },
];

const ACCOUNT_SELECT_SORT_OPTIONS: { value: AccountSelectSortOption; label: string }[] = [
  { value: "followers_desc", label: "粉丝最多" },
  { value: "followers_asc", label: "粉丝最少" },
  { value: "auth_time_desc", label: "最近绑定" },
  { value: "auth_time_asc", label: "最早绑定" },
];

const AVAILABLE_ACCOUNT_VISIBLE_LIMIT = 100;
const IS_LOCAL_PREVIEW_MODE =
  process.env.NEXT_PUBLIC_TIKTOK_GROUPS_DEMO === "true" ||
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function formatNumber(num: number) {
  if (num >= 10000) {
    return `${(num / 10000).toFixed(1)}万`;
  }

  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }

  return num.toString();
}

function getAccountName(account: TikTokAccount) {
  if (account.username) {
    return `@${account.username}`;
  }

  return account.display_name || `TikTok ${account.open_id.slice(0, 6)}`;
}

function getInitial(account: TikTokAccount) {
  return (account.username || account.display_name || "T").charAt(0).toUpperCase();
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt).getTime() <= Date.now();
}

function isTokenExpiringSoon(expiresAt: string | null) {
  if (!expiresAt || isExpired(expiresAt)) {
    return false;
  }

  const daysUntilExpiry = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry < 30;
}

function isAccountAuthorized(account: TikTokAccount) {
  return account.status === "active" && !isExpired(account.token_expires_at);
}

function isAccountExpiringSoon(account: TikTokAccount) {
  return isAccountAuthorized(account) && isTokenExpiringSoon(account.token_expires_at);
}

function isAccountStableAuthorized(account: TikTokAccount) {
  return isAccountAuthorized(account) && !isAccountExpiringSoon(account);
}

function requiresReauthorization(account: TikTokAccount) {
  return !isAccountAuthorized(account);
}

function canJoinGroup(account: TikTokAccount) {
  return account.account_type === "normal" && !account.group_id && isAccountAuthorized(account);
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  return typeof data?.error === "string" ? data.error : fallback;
}

async function readBindingApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  const message = typeof data?.error === "string" ? data.error : fallback;
  const retryAfterSeconds = Number(data?.retry_after_seconds || response.headers.get("Retry-After") || 0);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    if (/等待|后再试/.test(message)) {
      return message;
    }

    return `${message} 建议 ${retryAfterSeconds < 90 ? `${retryAfterSeconds} 秒` : `约 ${Math.ceil(retryAfterSeconds / 60)} 分钟`}后再试。`;
  }

  return message;
}

function getQrBindingTitle(status: QrBindingStatus) {
  switch (status) {
    case "scanned":
      return "等待手机确认";
    case "expired":
      return "二维码已过期";
    case "error":
      return "二维码不可用";
    default:
      return "TikTok 扫码授权";
  }
}

function matchesStatusFilter(account: TikTokAccount, filter: AccountStatusFilter) {
  switch (filter) {
    case "active":
      return isAccountStableAuthorized(account);
    case "expiring":
      return isAccountExpiringSoon(account);
    default:
      return true;
  }
}

function filterSelectableAccounts(
  accounts: TikTokAccount[],
  search: string,
  statusFilter: AccountStatusFilter,
  sortBy: AccountSelectSortOption
) {
  const query = search.trim().toLowerCase();

  return accounts
    .filter(isAccountAuthorized)
    .filter((account) => matchesStatusFilter(account, statusFilter))
    .filter((account) => {
      if (!query) {
        return true;
      }

      return [account.username, account.display_name, account.open_id]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "followers_asc":
          return a.follower_count - b.follower_count;
        case "auth_time_desc":
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "auth_time_asc":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "followers_desc":
        default:
          return b.follower_count - a.follower_count;
      }
    });
}

function AccountAvatar({ account, size = "md" }: { account: TikTokAccount; size?: "sm" | "md" | "lg" }) {
  const avatarSizeClasses = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-12 w-12",
  };
  const sizeClass = avatarSizeClasses[size];
  const textClass = size === "sm" ? "text-xs" : "text-sm";

  return (
    <div className={cn("relative shrink-0 rounded-full bg-gradient-to-br from-[#CCFF00] via-[#00F2EA] to-[#EC4899] p-[1.5px]", sizeClass)}>
      {account.avatar_url ? (
        <img
          src={account.avatar_url}
          alt={getAccountName(account)}
          className="h-full w-full rounded-full border border-neutral-950 object-cover"
        />
      ) : (
        <div className={cn("flex h-full w-full items-center justify-center rounded-full border border-neutral-950 bg-neutral-900 font-bold text-white", textClass)}>
          {getInitial(account)}
        </div>
      )}
      {isAccountAuthorized(account) && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-neutral-950 bg-emerald-500">
          <Check className="h-2.5 w-2.5 text-white" />
        </span>
      )}
    </div>
  );
}

function StatusBadge({ account }: { account: TikTokAccount }) {
  if (requiresReauthorization(account)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300">
        <AlertTriangle className="h-3 w-3" />
        已过期
      </span>
    );
  }

  if (isAccountExpiringSoon(account)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
        <AlertTriangle className="h-3 w-3" />
        即将过期
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
      <CheckCircle className="h-3 w-3" />
      已授权
    </span>
  );
}

function AccountSelectCard({
  account,
  selected = false,
  disabled = false,
  busy = false,
  removeDisabled = false,
  onToggle,
  onDisabledClick,
  onRemove,
}: {
  account: TikTokAccount;
  selected?: boolean;
  disabled?: boolean;
  busy?: boolean;
  removeDisabled?: boolean;
  onToggle?: (accountId: string, checked: boolean) => void;
  onDisabledClick?: () => void;
  onRemove?: (accountId: string) => void;
}) {
  const interactive = Boolean(onToggle);
  const shellClassName = cn(
    "relative h-[146px] overflow-hidden rounded-lg p-[1px] text-left transition-all duration-300",
    selected
      ? "bg-gradient-to-br from-[#CCFF00]/80 via-[#00F2EA]/85 to-[#EC4899]/75 shadow-[0_0_18px_rgba(0,242,234,0.16)]"
      : "bg-white/[0.08] hover:bg-[#00F2EA]/25",
    disabled && "cursor-not-allowed opacity-45 hover:bg-white/[0.08]"
  );

  const content = (
    <>
      <div className="flex h-full flex-col rounded-[7px] border border-white/[0.04] bg-neutral-950/[0.92] p-3">
        <div className="flex items-start justify-between gap-2">
          <AccountAvatar account={account} size="lg" />
          <StatusBadge account={account} />
        </div>
        <div className="mt-3 min-w-0">
          <div className="truncate text-sm font-bold text-white/90">{getAccountName(account)}</div>
          <div className="mt-1 truncate text-xs text-white/38">
            {formatNumber(account.follower_count)}粉 · {formatNumber(account.video_count)}视频
          </div>
        </div>
      </div>

      {selected && (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#00F2EA] text-black shadow-[0_0_12px_rgba(0,242,234,0.35)]">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}

      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(account.id);
          }}
          disabled={busy}
          aria-disabled={removeDisabled}
          title={removeDisabled ? "分组至少保留 1 个账号" : "移出分组"}
          className={cn(
            "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] bg-black/45 text-white/55 backdrop-blur transition-all hover:border-red-500/30 hover:bg-red-500/15 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-45",
            removeDisabled && "cursor-not-allowed opacity-40 hover:border-white/[0.08] hover:bg-black/45 hover:text-white/55"
          )}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </button>
      )}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={shellClassName}
        aria-pressed={selected}
        aria-disabled={disabled}
        onClick={() => {
          if (disabled) {
            onDisabledClick?.();
            return;
          }

          onToggle?.(account.id, !selected);
        }}
      >
        {content}
      </button>
    );
  }

  return <div className={shellClassName}>{content}</div>;
}

function GroupAvatarMatrix({ accounts }: { accounts: TikTokAccount[] }) {
  const visibleAccounts = accounts.slice(0, MAX_ACCOUNTS_PER_GROUP);

  if (visibleAccounts.length === 0) {
    return (
      <div className="mt-5 flex min-h-[64px] items-center justify-center rounded-lg border border-dashed border-white/[0.06] bg-black/10 text-xs text-white/25">
        暂无账号
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-lg border border-white/[0.06] bg-black/15 p-3">
      <div className="grid grid-cols-5 justify-items-center gap-2.5 sm:gap-3">
        {visibleAccounts.map((account) => (
          <div
            key={account.id}
            title={getAccountName(account)}
            className="h-10 w-10 overflow-hidden rounded-full bg-gradient-to-br from-[#CCFF00] via-[#00F2EA] to-[#EC4899] p-[1px] sm:h-11 sm:w-11"
          >
            {account.avatar_url ? (
              <img
                src={account.avatar_url}
                alt={getAccountName(account)}
                className="h-full w-full rounded-full border border-neutral-950 object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-full border border-neutral-950 bg-neutral-900 text-sm font-bold text-white">
                {getInitial(account)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountSelectGrid({
  accounts,
  selectedIds,
  disabledIds = [],
  emptyText = "暂无可选账号",
  onToggle,
  onDisabledClick,
}: {
  accounts: TikTokAccount[];
  selectedIds: string[];
  disabledIds?: string[];
  emptyText?: string;
  onToggle: (accountId: string, checked: boolean) => void;
  onDisabledClick?: () => void;
}) {
  const disabledSet = useMemo(() => new Set(disabledIds), [disabledIds]);

  if (accounts.length === 0) {
    return (
      <div className="flex min-h-[184px] items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.025] text-sm text-white/35">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {accounts.map((account) => (
        <AccountSelectCard
          key={account.id}
          account={account}
          selected={selectedIds.includes(account.id)}
          disabled={disabledSet.has(account.id)}
          onToggle={onToggle}
          onDisabledClick={onDisabledClick}
        />
      ))}
    </div>
  );
}

function AccountSelectionToolbar({
  searchValue,
  statusFilter,
  sortBy,
  searchPlaceholder,
  onSearchChange,
  onStatusFilterChange,
  onSortChange,
}: {
  searchValue: string;
  statusFilter: AccountStatusFilter;
  sortBy: AccountSelectSortOption;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: AccountStatusFilter) => void;
  onSortChange: (value: AccountSelectSortOption) => void;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <div className="relative w-full md:max-w-[320px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 rounded-lg border-white/[0.08] bg-white/[0.04] pl-9 text-sm text-white placeholder:text-white/30 focus-visible:ring-[#00F2EA]/30"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] font-medium text-white/65 transition-all hover:border-white/[0.15] hover:bg-white/[0.08] hover:text-white/85">
            {ACCOUNT_STATUS_FILTERS.find((option) => option.value === statusFilter)?.label}
            <ChevronDown className="h-3 w-3 text-white/30" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-white/[0.08] bg-neutral-950/95 text-white">
          {ACCOUNT_STATUS_FILTERS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onStatusFilterChange(option.value)}
              className={cn("cursor-pointer gap-2", statusFilter === option.value && "bg-white/[0.08]")}
            >
              <Check className={cn("h-3.5 w-3.5", statusFilter === option.value ? "opacity-100" : "opacity-0")} />
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] font-medium text-white/65 transition-all hover:border-white/[0.15] hover:bg-white/[0.08] hover:text-white/85">
            <ArrowUpDown className="h-3.5 w-3.5 text-white/35" />
            {ACCOUNT_SELECT_SORT_OPTIONS.find((option) => option.value === sortBy)?.label}
            <ChevronDown className="h-3 w-3 text-white/30" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-white/[0.08] bg-neutral-950/95 text-white">
          {ACCOUNT_SELECT_SORT_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onSortChange(option.value)}
              className={cn("cursor-pointer gap-2", sortBy === option.value && "bg-white/[0.08]")}
            >
              <Check className={cn("h-3.5 w-3.5", sortBy === option.value ? "opacity-100" : "opacity-0")} />
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SelectedAccountChips({
  label,
  accounts,
  emptyText,
  onRemove,
}: {
  label: string;
  accounts: TikTokAccount[];
  emptyText: string;
  onRemove: (accountId: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 text-xs font-medium text-white/45">{label}</div>
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        {accounts.length === 0 ? (
          <span className="text-xs text-white/28">{emptyText}</span>
        ) : (
          accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => onRemove(account.id)}
              className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.045] px-2.5 py-1 text-xs font-medium text-white/70 transition-all hover:border-[#00F2EA]/25 hover:bg-[#00F2EA]/10 hover:text-[#7ffbf7]"
              title="移除"
            >
              <span className="truncate">{getAccountName(account)}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function ExpiringAccountNotice({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>已选账号中有 {count} 个即将过期，建议提前刷新授权，避免后续批量发布失败。</span>
    </div>
  );
}

export default function TikTokAccountsPage() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [qrBinding, setQrBinding] = useState<QrBindingState | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("followers_desc");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("accounts");
  const [accountSearch, setAccountSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [showBindingModal, setShowBindingModal] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupAccountIds, setNewGroupAccountIds] = useState<string[]>([]);
  const [newGroupAccountSearch, setNewGroupAccountSearch] = useState("");
  const [newGroupStatusFilter, setNewGroupStatusFilter] = useState<AccountStatusFilter>("all");
  const [newGroupSortBy, setNewGroupSortBy] = useState<AccountSelectSortOption>("followers_desc");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftGroupName, setDraftGroupName] = useState("");
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [savingGroupName, setSavingGroupName] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [selectedAddAccountIds, setSelectedAddAccountIds] = useState<string[]>([]);
  const [availableAccountSearch, setAvailableAccountSearch] = useState("");
  const [availableStatusFilter, setAvailableStatusFilter] = useState<AccountStatusFilter>("all");
  const [availableSortBy, setAvailableSortBy] = useState<AccountSelectSortOption>("followers_desc");
  const [addingAccounts, setAddingAccounts] = useState(false);
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(null);
  const groupNameInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const fetchAccounts = useCallback(async () => {
    const response = await fetch("/api/publish/accounts", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(await readApiError(response, "无法加载 TikTok 账号列表"));
    }

    const data = await response.json();
    setAccounts(data.accounts || []);
  }, []);

  const fetchGroups = useCallback(async () => {
    const response = await fetch("/api/publish/account-groups", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(await readApiError(response, "无法加载 TikTok 账号分组"));
    }

    const data = await response.json();
    setGroups(data.groups || []);
  }, []);

  const refreshData = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      try {
        await Promise.all([fetchAccounts(), fetchGroups()]);
      } catch (error) {
        console.error("Error loading TikTok accounts:", error);
        if (!silent) {
          toast({
            variant: "destructive",
            title: "加载失败",
            description: error instanceof Error ? error.message : "无法加载 TikTok 账号数据",
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchAccounts, fetchGroups, toast]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    const name = params.get("name");
    const demo = params.get("demo");

    if (demo) {
      toast({
        title: "本地预览模式",
        description: "当前已内置测试账号，真实 TikTok OAuth 绑定需在测试或生产环境验证。",
      });
      window.history.replaceState({}, "", "/publish/accounts");
    }

    if (success && name) {
      toast({
        title: "账号绑定成功",
        description: `已成功绑定 TikTok 账号: ${name}`,
      });
      window.history.replaceState({}, "", "/publish/accounts");
    }

    if (error) {
      toast({
        variant: "destructive",
        title: "绑定失败",
        description: decodeURIComponent(error),
      });
      window.history.replaceState({}, "", "/publish/accounts");
    }
  }, [toast]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!qrBinding || (qrBinding.status !== "ready" && qrBinding.status !== "scanned")) {
      return;
    }

    if (new Date(qrBinding.expiresAt).getTime() < Date.now()) {
      setQrBinding((current) => current ? {
        ...current,
        status: "expired",
        message: "二维码已过期，请重新生成。",
      } : current);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/tiktok/auth/qr/status?state=${encodeURIComponent(qrBinding.state)}`, {
          cache: "no-store",
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "二维码状态检查失败");
        }

        if (cancelled) return;

        if (data.status === "completed" || data.success) {
          setQrBinding((current) => current ? {
            ...current,
            status: "completed",
            message: "绑定成功，正在刷新账号列表。",
          } : current);
          toast({
            title: "账号绑定成功",
            description: data.name ? `已成功绑定 TikTok 账号: ${data.name}` : "TikTok 账号已绑定",
          });
          setShowBindingModal(false);
          setQrBinding(null);
          await refreshData({ silent: true });
          return;
        }

        if (data.status === "scanned") {
          setQrBinding((current) => current && current.status !== "scanned" ? {
            ...current,
            status: "scanned",
            message: "已扫码，请在 TikTok APP 中确认授权。",
          } : current);
          return;
        }

        if (data.status === "expired") {
          setQrBinding((current) => current && current.status !== "expired" ? {
            ...current,
            status: "expired",
            message: "二维码已过期，请重新生成。",
          } : current);
          return;
        }

        if (data.status === "failed" || data.error) {
          setQrBinding((current) => current ? {
            ...current,
            status: "error",
            message: data.error || "二维码授权失败，请重试。",
          } : current);
        }
      } catch (error) {
        if (cancelled) return;
        setQrBinding((current) => current ? {
          ...current,
          status: "error",
          message: error instanceof Error ? error.message : "二维码状态检查失败",
        } : current);
      }
    };

    const timer = window.setInterval(poll, qrBinding.pollIntervalMs || 3000);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [qrBinding, refreshData, toast]);

  const ungroupedAccounts = useMemo(
    () => accounts.filter(canJoinGroup),
    [accounts]
  );

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  useEffect(() => {
    if (!selectedGroup) {
      return;
    }

    setDraftGroupName(selectedGroup.name);
    setEditingGroupName(false);
    setSelectedAddAccountIds([]);
    setAvailableAccountSearch("");
    setAvailableStatusFilter("all");
    setAvailableSortBy("followers_desc");
  }, [selectedGroup]);

  useEffect(() => {
    if (!editingGroupName) {
      return;
    }

    groupNameInputRef.current?.focus();
    groupNameInputRef.current?.select();
  }, [editingGroupName]);

  const overview = useMemo(() => {
    const expired = accounts.filter(requiresReauthorization).length;
    const expiring = accounts.filter(isAccountExpiringSoon).length;
    const active = accounts.filter(isAccountStableAuthorized).length;
    const grouped = accounts.filter((account) => account.group_id).length;

    return {
      total: accounts.length,
      active,
      expiring,
      expired,
      grouped,
      ungrouped: accounts.length - grouped,
      groups: groups.length,
    };
  }, [accounts, groups.length]);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();

    return accounts
      .filter((account) => {
        if (!query) {
          return true;
        }

        return [
          account.username,
          account.display_name,
          account.open_id,
          account.group_name,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));
      })
      .filter((account) => {
        switch (filterBy) {
          case "active":
            return isAccountStableAuthorized(account);
          case "expiring":
            return isAccountExpiringSoon(account);
          case "expired":
            return requiresReauthorization(account);
          case "grouped":
            return Boolean(account.group_id);
          case "ungrouped":
            return !account.group_id;
          default:
            return true;
        }
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "followers_desc":
            return b.follower_count - a.follower_count;
          case "followers_asc":
            return a.follower_count - b.follower_count;
          case "auth_time_desc":
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          case "auth_time_asc":
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          default:
            return 0;
        }
      });
  }, [accountSearch, accounts, filterBy, sortBy]);

  const filteredGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();

    if (!query) {
      return groups;
    }

    return groups.filter((group) => group.name.toLowerCase().includes(query));
  }, [groupSearch, groups]);

  const newGroupCandidateAccounts = useMemo(() => {
    return filterSelectableAccounts(
      ungroupedAccounts,
      newGroupAccountSearch,
      newGroupStatusFilter,
      newGroupSortBy
    );
  }, [newGroupAccountSearch, newGroupSortBy, newGroupStatusFilter, ungroupedAccounts]);

  const visibleNewGroupAccounts = useMemo(
    () => newGroupCandidateAccounts.slice(0, AVAILABLE_ACCOUNT_VISIBLE_LIMIT),
    [newGroupCandidateAccounts]
  );

  const availableAddAccountCandidates = useMemo(() => {
    return filterSelectableAccounts(
      ungroupedAccounts,
      availableAccountSearch,
      availableStatusFilter,
      availableSortBy
    );
  }, [availableAccountSearch, availableSortBy, availableStatusFilter, ungroupedAccounts]);

  const visibleAvailableAddAccounts = useMemo(
    () => availableAddAccountCandidates.slice(0, AVAILABLE_ACCOUNT_VISIBLE_LIMIT),
    [availableAddAccountCandidates]
  );

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

  const selectedNewGroupAccounts = useMemo(
    () =>
      newGroupAccountIds
        .map((accountId) => accountById.get(accountId))
        .filter((account): account is TikTokAccount => Boolean(account)),
    [accountById, newGroupAccountIds]
  );

  const selectedAddAccounts = useMemo(
    () =>
      selectedAddAccountIds
        .map((accountId) => accountById.get(accountId))
        .filter((account): account is TikTokAccount => Boolean(account)),
    [accountById, selectedAddAccountIds]
  );
  const selectedNewGroupExpiringCount = selectedNewGroupAccounts.filter(isAccountExpiringSoon).length;
  const selectedAddExpiringCount = selectedAddAccounts.filter(isAccountExpiringSoon).length;
  const selectedGroupExpiringCount = selectedGroup
    ? selectedGroup.accounts.filter(isAccountExpiringSoon).length
    : 0;
  const bindingActionLocked = connecting || qrBinding?.status === "loading" || qrBinding?.status === "ready" || qrBinding?.status === "scanned";

  const handleWebConnect = async () => {
    if (IS_LOCAL_PREVIEW_MODE) {
      setShowBindingModal(false);
      toast({
        title: "本地预览模式",
        description: "当前已内置测试账号，真实 TikTok OAuth 绑定需在测试或生产环境验证。",
      });
      return;
    }

    setConnecting(true);

    try {
      const response = await fetch("/api/tiktok/auth/url", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readBindingApiError(response, "无法生成授权链接"));
      }

      const data = await response.json();

      if (data.demo) {
        setShowBindingModal(false);
        toast({
          title: "本地预览模式",
          description: data.message || "当前已内置测试账号，真实 TikTok OAuth 绑定需在测试或生产环境验证。",
        });
        setConnecting(false);
        return;
      }

      if (!data.authUrl) {
        setShowBindingModal(false);
        toast({
          title: "本地预览模式",
          description: data.message || "当前无法生成真实 TikTok OAuth 链接，请使用测试账号查看页面流程。",
        });
        setConnecting(false);
        return;
      }

      window.location.href = data.authUrl;
    } catch (error) {
      console.error("Error connecting:", error);
      toast({
        variant: "destructive",
        title: "连接失败",
        description: error instanceof Error ? error.message : "无法生成授权链接，请稍后重试",
      });
      setConnecting(false);
    }
  };

  const handleQrConnect = async () => {
    if (IS_LOCAL_PREVIEW_MODE) {
      setShowBindingModal(false);
      toast({
        title: "本地预览模式",
        description: "当前已内置测试账号，真实 TikTok 二维码授权需在测试或生产环境验证。",
      });
      return;
    }

    setConnecting(true);
    setQrBinding({
      state: "",
      qrImageDataUrl: "",
      expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      pollIntervalMs: 3000,
      status: "loading",
      message: "正在生成二维码...",
    });

    try {
      const response = await fetch("/api/tiktok/auth/qr/start", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readBindingApiError(response, "无法生成二维码"));
      }

      const data = await response.json();
      if (data.demo) {
        setShowBindingModal(false);
        setQrBinding(null);
        toast({
          title: "本地预览模式",
          description: data.message || "当前已内置测试账号，真实 TikTok 二维码授权需在测试或生产环境验证。",
        });
        return;
      }

      if (!data.state || !data.qrImageDataUrl) {
        throw new Error("二维码生成失败，请稍后重试");
      }

      setQrBinding({
        state: data.state,
        qrImageDataUrl: data.qrImageDataUrl,
        expiresAt: data.expiresAt,
        pollIntervalMs: Number(data.pollIntervalMs || 3000),
        status: "ready",
        message: "请使用 TikTok APP 扫描二维码并确认授权。",
      });
    } catch (error) {
      console.error("Error starting QR binding:", error);
      setQrBinding((current) => current ? {
        ...current,
        status: "error",
        message: error instanceof Error ? error.message : "无法生成二维码，请稍后重试",
      } : {
        state: "",
        qrImageDataUrl: "",
        expiresAt: new Date().toISOString(),
        pollIntervalMs: 3000,
        status: "error",
        message: error instanceof Error ? error.message : "无法生成二维码，请稍后重试",
      });
      toast({
        variant: "destructive",
        title: "二维码生成失败",
        description: error instanceof Error ? error.message : "无法生成二维码，请稍后重试",
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleRefresh = async (accountId: string) => {
    setRefreshingId(accountId);

    try {
      const response = await fetch(`/api/publish/accounts/${accountId}/refresh`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "无法刷新授权"));
      }

      toast({
        title: "刷新成功",
        description: "账号授权已更新",
      });

      await refreshData({ silent: true });
    } catch (error) {
      console.error("Error refreshing account:", error);
      toast({
        variant: "destructive",
        title: "刷新失败",
        description: error instanceof Error ? error.message : "无法刷新授权，请重新绑定账号",
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    try {
      const response = await fetch(`/api/publish/accounts/${accountId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "无法解绑账号"));
      }

      toast({
        title: "解绑成功",
        description: "TikTok 账号已解绑",
      });

      await refreshData({ silent: true });
    } catch (error) {
      console.error("Error disconnecting:", error);
      toast({
        variant: "destructive",
        title: "解绑失败",
        description: error instanceof Error ? error.message : "无法解绑账号，请稍后重试",
      });
    }
  };

  const openGroupManagement = () => {
    if (accounts.length === 0) {
      toast({
        title: "请先绑定 TikTok 账号",
        description: "绑定账号后再创建分组。",
      });
      return;
    }

    setViewMode("groups");

    if (groups.length === 0) {
      void refreshData({ silent: true });
    }
  };

  const toggleNewGroupAccount = (accountId: string, checked: boolean) => {
    setNewGroupAccountIds((current) => {
      if (!checked) {
        return current.filter((id) => id !== accountId);
      }

      if (current.includes(accountId)) {
        return current;
      }

      const account = accountById.get(accountId);

      if (!account || !isAccountAuthorized(account)) {
        toast({
          variant: "destructive",
          title: "不可加入分组",
          description: "只能加入已授权且未过期的 TikTok 内容账号。",
        });
        return current;
      }

      if (current.length >= MAX_ACCOUNTS_PER_GROUP) {
        toast({
          variant: "destructive",
          title: "已达到上限",
          description: `每个分组最多 ${MAX_ACCOUNTS_PER_GROUP} 个账号`,
        });
        return current;
      }

      return [...current, accountId];
    });
  };

  const createGroup = async () => {
    const name = newGroupName.trim();

    if (!name) {
      toast({
        variant: "destructive",
        title: "请输入分组名称",
      });
      return;
    }

    if (newGroupAccountIds.length === 0) {
      toast({
        variant: "destructive",
        title: "请选择账号",
        description: "分组至少需要 1 个账号。",
      });
      return;
    }

    if (selectedNewGroupAccounts.some((account) => !isAccountAuthorized(account))) {
      toast({
        variant: "destructive",
        title: "存在不可加入账号",
        description: "只能加入已授权且未过期的 TikTok 内容账号。",
      });
      setNewGroupAccountIds(selectedNewGroupAccounts.filter(isAccountAuthorized).map((account) => account.id));
      return;
    }

    setCreatingGroup(true);

    try {
      const response = await fetch("/api/publish/account-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          accountIds: newGroupAccountIds,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "创建分组失败"));
      }

      let createDescription = `${name} 已加入 ${newGroupAccountIds.length} 个账号`;

      if (selectedNewGroupExpiringCount > 0) {
        createDescription = `${createDescription}，其中 ${selectedNewGroupExpiringCount} 个即将过期，建议提前刷新授权。`;
      }

      toast({
        title: "分组已创建",
        description: createDescription,
      });

      setShowCreateGroup(false);
      setNewGroupName("");
      setNewGroupAccountIds([]);
      setNewGroupAccountSearch("");
      setNewGroupStatusFilter("all");
      setNewGroupSortBy("followers_desc");
      setViewMode("groups");
      await refreshData({ silent: true });
    } catch (error) {
      console.error("Error creating group:", error);
      toast({
        variant: "destructive",
        title: "创建失败",
        description: error instanceof Error ? error.message : "创建分组失败，请稍后重试",
      });
    } finally {
      setCreatingGroup(false);
    }
  };

  const openGroupEditor = (group: AccountGroup) => {
    setSelectedGroupId(group.id);
    setEditingGroupName(false);
    setEditorOpen(true);
  };

  const saveGroupChanges = async () => {
    if (!selectedGroup) {
      return;
    }

    const name = draftGroupName.trim();

    if (!name) {
      toast({
        variant: "destructive",
        title: "请输入分组名称",
      });
      return;
    }

    const shouldRename = name !== selectedGroup.name;
    const shouldAddAccounts = selectedAddAccountIds.length > 0;

    if (!shouldRename && !shouldAddAccounts) {
      return;
    }

    if (shouldAddAccounts && selectedAddAccounts.some((account) => !isAccountAuthorized(account))) {
      toast({
        variant: "destructive",
        title: "存在不可加入账号",
        description: "只能加入已授权且未过期的 TikTok 内容账号。",
      });
      setSelectedAddAccountIds(selectedAddAccounts.filter(isAccountAuthorized).map((account) => account.id));
      return;
    }

    setSavingGroupName(shouldRename);
    setAddingAccounts(shouldAddAccounts);

    let savingAction = "保存分组";

    try {
      if (shouldRename) {
        savingAction = "更新分组名称";
        const response = await fetch(`/api/publish/account-groups/${selectedGroup.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "更新分组名称失败"));
        }
      }

      if (shouldAddAccounts) {
        savingAction = "加入账号";
        const response = await fetch(`/api/publish/account-groups/${selectedGroup.id}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds: selectedAddAccountIds }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "加入账号失败"));
        }
      }

      let successTitle = "账号已加入分组";

      if (shouldRename && shouldAddAccounts) {
        successTitle = "分组已保存";
      } else if (shouldRename) {
        successTitle = "分组名称已更新";
      }

      let successDescription: string | undefined;

      if (shouldAddAccounts) {
        successDescription = `已加入 ${selectedAddAccountIds.length} 个账号`;

        if (selectedAddExpiringCount > 0) {
          successDescription = `${successDescription}，其中 ${selectedAddExpiringCount} 个即将过期，建议提前刷新授权。`;
        }
      }

      toast({
        title: successTitle,
        description: successDescription,
      });

      setEditorOpen(false);
      setSelectedGroupId(null);
      setEditingGroupName(false);
      setSelectedAddAccountIds([]);
      setAvailableAccountSearch("");
      setAvailableStatusFilter("all");
      setAvailableSortBy("followers_desc");
      await refreshData({ silent: true });
    } catch (error) {
      console.error("Error saving group changes:", error);
      toast({
        variant: "destructive",
        title: `${savingAction}失败`,
        description: error instanceof Error ? error.message : "保存分组失败",
      });
    } finally {
      setSavingGroupName(false);
      setAddingAccounts(false);
    }
  };

  const deleteGroup = async () => {
    if (!selectedGroup) {
      return;
    }

    setDeletingGroup(true);

    try {
      const response = await fetch(`/api/publish/account-groups/${selectedGroup.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "删除分组失败"));
      }

      toast({
        title: "分组已删除",
        description: "组内账号已回到未分组。",
      });

      setEditorOpen(false);
      setSelectedGroupId(null);
      await refreshData({ silent: true });
      if (groups.length <= 1) {
        setViewMode("accounts");
      }
    } catch (error) {
      console.error("Error deleting group:", error);
      toast({
        variant: "destructive",
        title: "删除失败",
        description: error instanceof Error ? error.message : "删除分组失败",
      });
    } finally {
      setDeletingGroup(false);
    }
  };

  const toggleAddAccount = (accountId: string, checked: boolean) => {
    if (!selectedGroup) {
      return;
    }

    const remainingSlots = MAX_ACCOUNTS_PER_GROUP - selectedGroup.accounts_count;

    setSelectedAddAccountIds((current) => {
      if (!checked) {
        return current.filter((id) => id !== accountId);
      }

      if (current.includes(accountId)) {
        return current;
      }

      const account = accountById.get(accountId);

      if (!account || !isAccountAuthorized(account)) {
        toast({
          variant: "destructive",
          title: "不可加入分组",
          description: "只能加入已授权且未过期的 TikTok 内容账号。",
        });
        return current;
      }

      if (current.length >= remainingSlots) {
        toast({
          variant: "destructive",
          title: "分组已接近上限",
          description: `还可以加入 ${remainingSlots} 个账号`,
        });
        return current;
      }

      return [...current, accountId];
    });
  };

  const removeAccountFromGroup = async (accountId: string) => {
    if (!selectedGroup) {
      return;
    }

    if (selectedGroup.accounts_count <= 1) {
      toast({
        variant: "destructive",
        title: "分组至少保留 1 个账号",
        description: "如不再使用这个分组，可以删除整个分组。",
      });
      return;
    }

    setRemovingAccountId(accountId);

    try {
      const response = await fetch(`/api/publish/account-groups/${selectedGroup.id}/accounts/${accountId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "移出账号失败"));
      }

      toast({
        title: "账号已移出",
        description: "该账号已回到未分组。",
      });

      await refreshData({ silent: true });
    } catch (error) {
      console.error("Error removing account from group:", error);
      toast({
        variant: "destructive",
        title: "移出失败",
        description: error instanceof Error ? error.message : "移出账号失败",
      });
    } finally {
      setRemovingAccountId(null);
    }
  };

  const selectedGroupSlots = selectedGroup
    ? Math.max(MAX_ACCOUNTS_PER_GROUP - selectedGroup.accounts_count, 0)
    : 0;
  const createDisabled =
    creatingGroup || !newGroupName.trim() || newGroupAccountIds.length === 0;
  const newGroupSelectionFull = newGroupAccountIds.length >= MAX_ACCOUNTS_PER_GROUP;
  const newGroupDisabledIds = newGroupSelectionFull
    ? visibleNewGroupAccounts
        .filter((account) => !newGroupAccountIds.includes(account.id))
        .map((account) => account.id)
    : [];
  const availableSelectionFull = selectedGroup
    ? selectedGroup.accounts_count + selectedAddAccountIds.length >= MAX_ACCOUNTS_PER_GROUP
    : false;
  const availableAddDisabledIds =
    selectedGroupSlots === 0 || availableSelectionFull
      ? visibleAvailableAddAccounts
          .filter((account) => !selectedAddAccountIds.includes(account.id))
          .map((account) => account.id)
      : [];
  const groupNameChanged = Boolean(selectedGroup && draftGroupName.trim() !== selectedGroup.name);
  const editorSaveDisabled =
    !selectedGroup ||
    savingGroupName ||
    addingAccounts ||
    !draftGroupName.trim() ||
    (!groupNameChanged && selectedAddAccountIds.length === 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-1.5 rounded-full bg-gradient-to-b from-[#CCFF00] via-[#00F2EA] to-[#EC4899]" />
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-white">TikTok 账号绑定</h1>
            <p className="mt-0.5 text-sm text-white/50">绑定和管理您的 TikTok 账号，用于发布视频内容</p>
          </div>
        </div>

        <button
          onClick={() => setShowBindingModal(true)}
          disabled={connecting}
          className="group relative flex items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] px-5 py-2.5 text-sm font-bold text-black transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(0,242,234,0.5)] disabled:opacity-50"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent" />
          <div className="pointer-events-none absolute left-0 right-0 top-[10%] h-[35%] rounded-lg bg-gradient-to-b from-white/30 to-transparent" />
          {connecting ? (
            <Loader2 className="relative z-10 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="relative z-10 h-4 w-4" />
          )}
          <span className="relative z-10">绑定 TikTok 账号</span>
        </button>
      </div>

      {!loading && accounts.length > 0 && (
        <div className="flex flex-col gap-3 border-y border-white/[0.06] py-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white/80">账号库 {overview.total}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white/70">
                  概览
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 border-white/[0.08] bg-neutral-950/95 p-3 text-white shadow-2xl backdrop-blur-xl">
                <DropdownMenuLabel className="px-0 pb-2 text-xs text-white/45">账号概览</DropdownMenuLabel>
                <div className="space-y-2 text-sm">
                  {[
                    ["全部账号", overview.total],
                    ["已授权", overview.active],
                    ["即将过期", overview.expiring],
                    ["已过期", overview.expired],
                    ["已分组", overview.grouped],
                    ["未分组", overview.ungrouped],
                    ["分组数量", overview.groups],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-white/45">{label}</span>
                      <span className="font-semibold text-white/85">{value}</span>
                    </div>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
            {viewMode === "accounts" && (
              <div className="relative w-full sm:w-[260px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                <Input
                  value={accountSearch}
                  onChange={(event) => setAccountSearch(event.target.value)}
                  placeholder="搜索账号"
                  className="h-9 rounded-lg border-white/[0.08] bg-white/[0.04] pl-9 text-sm text-white placeholder:text-white/30 focus-visible:ring-[#00F2EA]/30"
                />
              </div>
            )}

            {viewMode === "accounts" && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] font-medium text-white/65 transition-all hover:border-white/[0.15] hover:bg-white/[0.08] hover:text-white/85">
                      <Filter className="h-3.5 w-3.5 text-white/35" />
                      {FILTER_OPTIONS.find((option) => option.value === filterBy)?.label}
                      <ChevronDown className="h-3 w-3 text-white/30" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border-white/[0.08] bg-neutral-950/95 text-white">
                    {FILTER_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => setFilterBy(option.value)}
                        className={cn("cursor-pointer", filterBy === option.value && "bg-white/[0.08]")}
                      >
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] font-medium text-white/65 transition-all hover:border-white/[0.15] hover:bg-white/[0.08] hover:text-white/85">
                      <ArrowUpDown className="h-3.5 w-3.5 text-white/35" />
                      {SORT_OPTIONS.find((option) => option.value === sortBy)?.label}
                      <ChevronDown className="h-3 w-3 text-white/30" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border-white/[0.08] bg-neutral-950/95 text-white">
                    {SORT_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => setSortBy(option.value)}
                        className={cn("cursor-pointer", sortBy === option.value && "bg-white/[0.08]")}
                      >
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {viewMode === "accounts" && (
              <Button
                type="button"
                variant="mermaid-ghost"
                size="sm"
                onClick={openGroupManagement}
                className="h-9"
              >
                <>
                  <Layers3 className="h-4 w-4" />
                  分组管理
                </>
              </Button>
            )}

            {viewMode === "groups" && (
              <>
                <Button
                  type="button"
                  variant="mermaid-ghost"
                  size="sm"
                  onClick={() => setViewMode("accounts")}
                  className="h-9 justify-center"
                >
                  <ArrowLeft className="h-4 w-4" />
                  账号视图
                </Button>

                <div className="relative w-full sm:w-[280px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                  <Input
                    value={groupSearch}
                    onChange={(event) => setGroupSearch(event.target.value)}
                    placeholder="搜索分组"
                    className="h-9 rounded-lg border-white/[0.08] bg-white/[0.04] pl-9 text-sm text-white placeholder:text-white/30 focus-visible:ring-[#00F2EA]/30"
                  />
                </div>

                <Button
                  type="button"
                  variant="mermaid-ghost"
                  size="sm"
                  onClick={() => setShowCreateGroup(true)}
                  className="h-9"
                >
                  <Plus className="h-4 w-4" />
                  创建分组
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-white/35" />
        </div>
      )}

      {!loading && accounts.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-[#CCFF00]/20 via-[#00F2EA]/20 to-[#EC4899]/20">
              <UserPlus className="h-10 w-10 text-[#EC4899]" />
            </div>
            <h3 className="mb-2 text-xl font-bold text-white">还没有绑定 TikTok 账号</h3>
            <p className="max-w-md text-center text-sm text-white/50">绑定您的 TikTok 账号后，可以直接从平台发布 AI 生成的视频内容</p>
          </div>
        </div>
      )}

      {!loading && accounts.length > 0 && viewMode === "accounts" && (
        <div className="space-y-4">
          {filteredAccounts.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.025] text-sm text-white/35">
              没有匹配的账号
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredAccounts.map((account) => (
                <div
                  key={account.id}
                  className="group relative flex h-[168px] flex-col overflow-hidden rounded-lg border border-white/[0.075] bg-white/[0.035] p-5 transition-all duration-300 hover:border-[#00F2EA]/25 hover:bg-white/[0.055]"
                  style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 34px rgba(0,0,0,0.16)" }}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#00F2EA]/35 to-transparent opacity-70" />
                  <div className="absolute right-3 top-3 flex items-center gap-1 opacity-35 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => handleRefresh(account.id)}
                      disabled={refreshingId === account.id}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.06] bg-black/20 text-white/45 transition-all hover:border-[#00F2EA]/25 hover:bg-[#00F2EA]/10 hover:text-[#00F2EA] disabled:opacity-40"
                      title="刷新授权"
                    >
                      {refreshingId === account.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.06] bg-black/20 text-white/40 transition-all hover:border-red-500/25 hover:bg-red-500/10 hover:text-red-300"
                          title="解绑"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认解绑账号？</AlertDialogTitle>
                          <AlertDialogDescription>
                            解绑后，将无法向该账号发布视频。若该账号是所在分组的最后一个账号，空分组会自动移除。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDisconnect(account.id)}
                            className="bg-destructive hover:bg-destructive/90"
                          >
                            确认解绑
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  <div className="flex min-w-0 items-start gap-3 pr-16">
                    <AccountAvatar account={account} size="lg" />
                    <div className="min-w-0 pt-0.5">
                      <div className="truncate text-base font-bold text-white">{getAccountName(account)}</div>
                      <div className="mt-2">
                        <StatusBadge account={account} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto flex items-end justify-between gap-3">
                    <div className="flex items-center gap-6">
                      <div>
                        <div className="text-[11px] text-white/30">粉丝</div>
                        <div className="mt-0.5 text-base font-bold text-[#7ffbf7]">{formatNumber(account.follower_count)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-white/30">视频</div>
                        <div className="mt-0.5 text-base font-bold text-white/75">{formatNumber(account.video_count)}</div>
                      </div>
                    </div>

                    {account.group_name ? (
                      <span className="inline-flex max-w-[46%] items-center gap-1 rounded-md border border-[#00F2EA]/18 bg-[#00F2EA]/8 px-2 py-1 text-[11px] font-medium text-[#7ffbf7]">
                        <Layers3 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{account.group_name}</span>
                      </span>
                    ) : (
                      <span className="h-6" aria-hidden="true" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && accounts.length > 0 && viewMode === "groups" && (
        <div className="space-y-4">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredGroups.map((group) => {
              const expiringCount = group.accounts.filter(isAccountExpiringSoon).length;
              const reauthorizationCount = group.accounts.filter(requiresReauthorization).length;
              const stableAuthorizedCount = Math.max(
                group.accounts_count - expiringCount - reauthorizationCount,
                0
              );

              return (
                <button
                  key={group.id}
                  onClick={() => openGroupEditor(group)}
                  className="group relative flex min-h-[286px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] p-5 text-left transition-all duration-300 hover:border-[#00F2EA]/25 hover:bg-white/[0.055]"
                  style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 34px rgba(0,0,0,0.18)" }}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#CCFF00]/0 via-[#00F2EA]/35 to-[#EC4899]/0" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-white">{group.name}</div>
                      <div className="mt-1 text-xs text-white/38">{group.accounts_count}/{MAX_ACCOUNTS_PER_GROUP} 个账号</div>
                    </div>
                    <span className={cn(
                      "rounded-full px-2 py-1 text-xs font-semibold",
                      group.accounts_count >= MAX_ACCOUNTS_PER_GROUP
                        ? "bg-amber-500/10 text-amber-300"
                        : "bg-emerald-500/10 text-emerald-300"
                    )}>
                      {group.accounts_count >= MAX_ACCOUNTS_PER_GROUP ? "已满" : "可加入"}
                    </span>
                  </div>

                  <GroupAvatarMatrix accounts={group.accounts} />

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-5 text-xs">
                    <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300">
                      已授权 {stableAuthorizedCount}
                    </span>
                    {expiringCount > 0 && (
                      <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-300">
                        即将过期 {expiringCount}
                      </span>
                    )}
                    {reauthorizationCount > 0 && (
                      <span className="rounded-md bg-red-500/10 px-2 py-1 text-red-300">
                        已过期 {reauthorizationCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {filteredGroups.length === 0 && groupSearch.trim() && (
            <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.025] text-sm text-white/35">
              没有匹配的分组
            </div>
          )}
          {filteredGroups.length === 0 && !groupSearch.trim() && (
            <div className="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.025] text-sm text-white/35">
              <span>还没有创建分组</span>
              <Button type="button" variant="mermaid-ghost" size="sm" className="mt-3" onClick={() => setShowCreateGroup(true)}>
                <Plus className="h-4 w-4" />
                创建分组
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={showCreateGroup}
        onOpenChange={(open) => {
          setShowCreateGroup(open);
          if (!open) {
            setNewGroupName("");
            setNewGroupAccountIds([]);
            setNewGroupAccountSearch("");
            setNewGroupStatusFilter("all");
            setNewGroupSortBy("followers_desc");
          }
        }}
      >
        <DialogContent className="!flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden border-white/[0.08] bg-neutral-950/95 p-0 text-white shadow-[0_32px_64px_rgba(0,0,0,0.8)] backdrop-blur-2xl sm:h-[90vh] sm:max-h-[90vh] sm:w-[calc(100vw-2rem)] sm:rounded-lg lg:w-[1040px] [&>button]:right-4 [&>button]:top-4 [&>button]:text-white/45 [&>button:hover]:text-white">
          <DialogHeader className="shrink-0 border-b border-white/[0.06] px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 pr-10 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <DialogTitle className="text-xl font-bold leading-7 text-white">创建分组</DialogTitle>
                <DialogDescription className="sr-only">
                  创建 TikTok 账号分组，选择未分组账号。
                </DialogDescription>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <div className="relative w-full sm:w-[320px]">
                  <Input
                    value={newGroupName}
                    maxLength={GROUP_NAME_MAX_LENGTH}
                    onChange={(event) => setNewGroupName(event.target.value)}
                    placeholder="输入分组名"
                    className="h-9 rounded-lg border-white/[0.09] bg-white/[0.04] pr-14 text-sm font-semibold text-white placeholder:text-white/30 focus-visible:ring-[#00F2EA]/30"
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-white/28">
                    {newGroupName.trim().length}/{GROUP_NAME_MAX_LENGTH}
                  </span>
                </div>
                <span className="w-fit rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white/65">
                  {newGroupAccountIds.length}/{MAX_ACCOUNTS_PER_GROUP}
                </span>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
            <div className="space-y-4">
              <AccountSelectionToolbar
                searchValue={newGroupAccountSearch}
                statusFilter={newGroupStatusFilter}
                sortBy={newGroupSortBy}
                searchPlaceholder="搜索可加入账号"
                onSearchChange={setNewGroupAccountSearch}
                onStatusFilterChange={setNewGroupStatusFilter}
                onSortChange={setNewGroupSortBy}
              />
              <AccountSelectGrid
                accounts={visibleNewGroupAccounts}
                selectedIds={newGroupAccountIds}
                disabledIds={newGroupDisabledIds}
                emptyText="暂无已授权且未过期的未分组账号"
                onToggle={toggleNewGroupAccount}
                onDisabledClick={() =>
                  toast({
                    title: "已达到上限",
                    description: `每个分组最多 ${MAX_ACCOUNTS_PER_GROUP} 个账号`,
                  })
                }
              />
              {newGroupCandidateAccounts.length > AVAILABLE_ACCOUNT_VISIBLE_LIMIT && (
                <p className="text-xs text-white/35">
                  已显示前 {AVAILABLE_ACCOUNT_VISIBLE_LIMIT} 个账号，可通过搜索快速定位更多账号。
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="!flex !flex-col gap-4 border-t border-white/[0.06] px-5 py-4 sm:!flex-row sm:!items-end sm:!justify-between sm:!space-x-0 sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-xs text-white/35">
                每组最多 {MAX_ACCOUNTS_PER_GROUP} 个账号，只添加未分组账号。
              </p>
              <ExpiringAccountNotice count={selectedNewGroupExpiringCount} />
              <SelectedAccountChips
                label="已选账号"
                accounts={selectedNewGroupAccounts}
                emptyText="还没有选择账号"
                onRemove={(accountId) => toggleNewGroupAccount(accountId, false)}
              />
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button
                type="button"
                variant="mermaid-ghost"
                onClick={() => setShowCreateGroup(false)}
                disabled={creatingGroup}
              >
                取消
              </Button>
              <Button type="button" variant="mermaid" onClick={createGroup} disabled={createDisabled}>
                {creatingGroup && <Loader2 className="h-4 w-4 animate-spin" />}
                创建分组
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setSelectedGroupId(null);
            setEditingGroupName(false);
            setSelectedAddAccountIds([]);
            setAvailableAccountSearch("");
            setAvailableStatusFilter("all");
            setAvailableSortBy("followers_desc");
          }
        }}
      >
        <DialogContent className="!flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden border-white/[0.08] bg-neutral-950/95 p-0 text-white shadow-[0_32px_64px_rgba(0,0,0,0.8)] backdrop-blur-2xl sm:h-[84vh] sm:max-h-[84vh] sm:w-[calc(100vw-2rem)] sm:rounded-lg lg:w-[1120px] [&>button]:right-4 [&>button]:top-4 [&>button]:text-white/45 [&>button:hover]:text-white">
          {selectedGroup && (
            <>
              <DialogHeader className="shrink-0 border-b border-white/[0.06] px-5 py-4 sm:px-6">
                <DialogTitle className="sr-only">编辑账号分组</DialogTitle>
                <DialogDescription className="sr-only">
                  编辑分组名称，查看组内账号并添加未分组账号。
                </DialogDescription>
                <div className="flex flex-col gap-3 pr-10 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    {editingGroupName ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          ref={groupNameInputRef}
                          aria-label="分组名称"
                          value={draftGroupName}
                          maxLength={GROUP_NAME_MAX_LENGTH}
                          onChange={(event) => setDraftGroupName(event.target.value)}
                          onBlur={() => {
                            if (draftGroupName.trim() === selectedGroup.name) {
                              setEditingGroupName(false);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setDraftGroupName(selectedGroup.name);
                              setEditingGroupName(false);
                              return;
                            }

                            if (event.key === "Enter") {
                              event.preventDefault();

                              if (draftGroupName.trim() === selectedGroup.name && selectedAddAccountIds.length === 0) {
                                setEditingGroupName(false);
                                return;
                              }

                              saveGroupChanges();
                            }
                          }}
                          className="h-10 w-full max-w-[420px] rounded-lg border-[#00F2EA]/20 bg-white/[0.05] text-base font-bold text-white shadow-[0_0_18px_rgba(0,242,234,0.08)] placeholder:text-white/30 focus-visible:ring-[#00F2EA]/30"
                        />
                        <span className="shrink-0 text-xs text-white/32">
                          {draftGroupName.trim().length}/{GROUP_NAME_MAX_LENGTH}
                        </span>
                      </div>
                    ) : (
                      <div className="group inline-flex max-w-full items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-white/[0.035]">
                        <button
                          type="button"
                          onDoubleClick={() => setEditingGroupName(true)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              setEditingGroupName(true);
                            }
                          }}
                          title="双击修改分组名称"
                          className="min-w-0 text-left"
                        >
                        <span className="truncate text-2xl font-bold leading-8 tracking-normal text-white">
                          {draftGroupName.trim() || selectedGroup.name}
                        </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingGroupName(true)}
                          title="修改分组名称"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/30 opacity-0 transition-all hover:bg-white/[0.06] hover:text-[#00F2EA] group-hover:opacity-100"
                        >
                          <PencilLine className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    <div className="mt-1 text-xs text-white/35">
                      {selectedGroup.accounts_count + selectedAddAccountIds.length}/{MAX_ACCOUNTS_PER_GROUP} 个账号
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.035] text-red-300/45 transition-all hover:border-red-500/25 hover:bg-red-500/10 hover:text-red-300"
                          title="删除分组"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认删除这个分组？</AlertDialogTitle>
                          <AlertDialogDescription>
                            删除分组不会解绑账号，组内账号会回到未分组。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={deleteGroup}
                            disabled={deletingGroup}
                            className="bg-destructive hover:bg-destructive/90"
                          >
                            {deletingGroup && <Loader2 className="h-4 w-4 animate-spin" />}
                            删除分组
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

              </DialogHeader>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 sm:px-6">
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white/75">组内账号</h3>
                    <span className="text-xs text-white/35">{selectedGroup.accounts_count}/{MAX_ACCOUNTS_PER_GROUP}</span>
                  </div>
                  {selectedGroupExpiringCount > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        该组已有 {selectedGroupExpiringCount} 个账号即将过期，建议提前刷新授权，避免后续批量发布失败。
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {selectedGroup.accounts.map((account) => (
                      <AccountSelectCard
                        key={account.id}
                        account={account}
                        onRemove={removeAccountFromGroup}
                        removeDisabled={selectedGroup.accounts_count <= 1}
                        busy={removingAccountId === account.id}
                      />
                    ))}
                  </div>
                </section>

                <div className="h-px bg-white/[0.06]" />

                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white/75">添加未分组账号</h3>
                    <span className="text-xs text-white/35">剩余 {selectedGroupSlots}</span>
                  </div>

                  <AccountSelectionToolbar
                    searchValue={availableAccountSearch}
                    statusFilter={availableStatusFilter}
                    sortBy={availableSortBy}
                    searchPlaceholder="搜索可加入账号"
                    onSearchChange={setAvailableAccountSearch}
                    onStatusFilterChange={setAvailableStatusFilter}
                    onSortChange={setAvailableSortBy}
                  />

                  <AccountSelectGrid
                    accounts={visibleAvailableAddAccounts}
                    selectedIds={selectedAddAccountIds}
                    onToggle={toggleAddAccount}
                    disabledIds={availableAddDisabledIds}
                    emptyText="暂无已授权且未过期的未分组账号"
                    onDisabledClick={() =>
                      toast({
                        title: "已达到上限",
                        description: `每个分组最多 ${MAX_ACCOUNTS_PER_GROUP} 个账号`,
                      })
                    }
                  />
                  {availableAddAccountCandidates.length > AVAILABLE_ACCOUNT_VISIBLE_LIMIT && (
                    <p className="text-xs text-white/35">
                      已显示前 {AVAILABLE_ACCOUNT_VISIBLE_LIMIT} 个账号，可通过搜索快速定位更多账号。
                    </p>
                  )}
                </section>
              </div>

              <DialogFooter className="!flex !flex-col gap-3 border-t border-white/[0.06] px-5 py-3 sm:!flex-row sm:!items-end sm:!justify-between sm:!space-x-0 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-xs text-white/35">
                    每组最多 {MAX_ACCOUNTS_PER_GROUP} 个账号，只添加未分组账号。
                  </p>
                  <ExpiringAccountNotice count={selectedAddExpiringCount} />
                  <SelectedAccountChips
                    label="待加入"
                    accounts={selectedAddAccounts}
                    emptyText="还没有选择待加入账号"
                    onRemove={(accountId) => toggleAddAccount(accountId, false)}
                  />
                </div>
                <Button type="button" variant="mermaid" onClick={saveGroupChanges} disabled={editorSaveDisabled}>
                  {(savingGroupName || addingAccounts) && <Loader2 className="h-4 w-4 animate-spin" />}
                  保存/加入
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={showBindingModal}
        onOpenChange={(open) => {
          setShowBindingModal(open);
          if (!open) {
            setQrBinding(null);
          }
        }}
      >
        <DialogContent className="overflow-hidden border-white/[0.08] bg-neutral-950/95 p-0 shadow-[0_32px_64px_rgba(0,0,0,0.8)] backdrop-blur-2xl sm:max-w-[460px]">
          <div className="px-6 pb-4 pt-6">
            <DialogTitle className="flex items-center gap-3 text-[22px] font-bold tracking-tight text-white">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-[#CCFF00]/20 via-[#00F2EA]/15 to-[#EC4899]/20" style={{ boxShadow: "0 0 20px rgba(0,242,234,0.15), inset 0 1px 1px rgba(255,255,255,0.1)" }}>
                <UserPlus className="h-[18px] w-[18px] text-[#00F2EA]" />
              </div>
              选择绑定方式
            </DialogTitle>
            <DialogDescription className="mt-1.5 pl-12 text-[13px] text-white/40">选择一种方式来绑定您的 TikTok 账号</DialogDescription>
          </div>

          <div className="space-y-3 px-5 pb-5">
            {qrBinding && (
              <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 text-center">
                {qrBinding.qrImageDataUrl && (
                  <div className="mx-auto mb-3 flex h-[212px] w-[212px] items-center justify-center rounded-lg bg-white p-2">
                    <img src={qrBinding.qrImageDataUrl} alt="TikTok QR authorization code" className="h-full w-full" />
                  </div>
                )}
                {!qrBinding.qrImageDataUrl && qrBinding.status === "loading" && (
                  <div className="mx-auto mb-3 flex h-[212px] w-[212px] items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                    <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
                  </div>
                )}
                {!qrBinding.qrImageDataUrl && qrBinding.status !== "loading" && (
                  <div className="mx-auto mb-3 flex h-[212px] w-[212px] items-center justify-center rounded-lg border border-amber-300/20 bg-amber-300/[0.04]">
                    <AlertTriangle className="h-7 w-7 text-amber-300" />
                  </div>
                )}
                <div className="text-sm font-semibold text-white">
                  {getQrBindingTitle(qrBinding.status)}
                </div>
                <p className={cn(
                  "mt-1 text-xs leading-relaxed",
                  qrBinding.status === "error" || qrBinding.status === "expired" ? "text-amber-300" : "text-white/45"
                )}>
                  {qrBinding.message || "请使用 TikTok APP 扫描二维码。"}
                </p>
                {(qrBinding.status === "expired" || qrBinding.status === "error") && (
                  <Button type="button" variant="ghost" className="mt-3 h-8 text-xs text-cyan-200 hover:bg-cyan-400/10 hover:text-cyan-100" onClick={handleQrConnect} disabled={connecting}>
                    {connecting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    重新生成
                  </Button>
                )}
              </div>
            )}

            <button
              onClick={handleQrConnect}
              disabled={bindingActionLocked}
              className="group relative flex w-full items-start gap-4 overflow-hidden rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/[0.06] via-transparent to-pink-500/[0.04] p-4 text-left transition-all duration-300 hover:border-cyan-400/40 hover:from-cyan-500/[0.12] hover:to-pink-500/[0.08]"
              style={{ boxShadow: "0 0 1px rgba(0,242,234,0.3), inset 0 1px 0 rgba(255,255,255,0.04)" }}
            >
              <div className="absolute right-3 top-3">
                <span className="inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-cyan-500/90 to-pink-500/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm" style={{ boxShadow: "0 0 12px rgba(0,242,234,0.3)" }}>
                  <Sparkles className="h-3 w-3" />
                  推荐
                </span>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/15 via-cyan-500/10 to-transparent transition-transform duration-300 group-hover:scale-105" style={{ boxShadow: "0 0 16px rgba(0,242,234,0.12), inset 0 1px 1px rgba(255,255,255,0.08)" }}>
                <Smartphone className="h-5 w-5 text-cyan-400 transition-all duration-300 group-hover:drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h4 className="mb-1 text-[15px] font-semibold tracking-tight text-white">扫码绑定</h4>
                <p className="mb-2.5 text-[12px] leading-relaxed text-white/40">使用 TikTok APP 扫描二维码完成授权，更安全便捷</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/50">
                    <CheckCircle className="h-3 w-3 text-emerald-400/70" />
                    无需输入密码
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/50">
                    <CheckCircle className="h-3 w-3 text-emerald-400/70" />
                    手机确认更安全
                  </span>
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setShowBindingModal(false);
                handleWebConnect();
              }}
              disabled={bindingActionLocked}
              className="group relative flex w-full items-start gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.05]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent transition-transform duration-300 group-hover:scale-105">
                <Globe className="h-5 w-5 text-white/40 transition-colors duration-300 group-hover:text-white/60" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h4 className="mb-1 text-[15px] font-semibold tracking-tight text-white/80 transition-colors group-hover:text-white">网页登录绑定</h4>
                <p className="mb-2.5 text-[12px] leading-relaxed text-white/35">跳转到 TikTok 网站使用账号密码登录授权</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex rounded-md border border-white/[0.05] bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/40">
                    适合已登录网页版用户
                  </span>
                </div>
              </div>
            </button>
          </div>

          <div className="px-6 pb-5 pt-1">
            <p className="text-center text-[11px] leading-relaxed text-white/25">绑定成功后，授权有效期约为 1 年，可随时刷新或解绑</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
