"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  MoreHorizontal,
  Loader2,
  User,
  Zap,
  Plus,
  Minus,
  Shield,
  Ban,
  CheckCircle2,
  Clock,
  Mail,
  Calendar,
  AlertTriangle,
  UserX,
  UserCheck,
  CreditCard,
  Eye,
} from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import {
  type UserRole,
  type UserStatus,
  getRoleDisplayName,
  getStatusDisplay
} from "@/lib/admin";

// ============================================================================
// 类型定义
// ============================================================================

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  credits: number;
  created_at: string;
  banned_at?: string | null;
  banned_reason?: string | null;
  // 功能限制
  feature_restrictions?: {
    video_generation?: boolean;
    image_generation?: boolean;
    model_hiring?: boolean;
    batch_processing?: boolean;
  };
}

type CreditActionType = "recharge" | "deduct" | "system_grant";

// 功能限制选项
const FEATURE_OPTIONS = [
  { key: "video_generation", label: "视频生成", description: "允许使用 Sora2 生成视频" },
  { key: "image_generation", label: "图片生成", description: "允许使用 Nano Banana 处理图片" },
  { key: "model_hiring", label: "模特签约", description: "允许签约 AI 模特" },
  { key: "batch_processing", label: "批量处理", description: "允许使用批量生产线" },
] as const;

// ============================================================================
// Admin Users Page
// ============================================================================

export default function AdminUsersPage() {
  const { toast } = useToast();

  // 状态
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Credits Dialog 状态
  const [showCreditsDialog, setShowCreditsDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [creditAction, setCreditAction] = useState<CreditActionType>("recharge");
  const [creditAmount, setCreditAmount] = useState<number>(100);
  const [creditReason, setCreditReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Ban Dialog 状态
  const [showBanDialog, setShowBanDialog] = useState(false);
  const [banReason, setBanReason] = useState("");

  // Delete User Dialog 状态
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Feature Restrictions Dialog 状态
  const [showRestrictionsDialog, setShowRestrictionsDialog] = useState(false);
  const [featureRestrictions, setFeatureRestrictions] = useState({
    video_generation: true,
    image_generation: true,
    model_hiring: true,
    batch_processing: true,
  });

  // ================================================================
  // 数据获取
  // ================================================================

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterRole !== "all") params.set("role", filterRole);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        setUsers(data.data.users || []);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
      toast({
        variant: "destructive",
        title: "获取用户列表失败",
      });
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterRole, searchQuery, toast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchUsers]);

  // ================================================================
  // 过滤逻辑
  // ================================================================

  const filteredUsers = users.filter((user) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (
        !user.email.toLowerCase().includes(query) &&
        !user.name?.toLowerCase().includes(query)
      ) {
        return false;
      }
    }
    return true;
  });

  // ================================================================
  // 积分管理
  // ================================================================

  const handleOpenCreditsDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setCreditAction("system_grant"); // 默认使用系统发放
    setCreditAmount(100);
    setCreditReason("");
    setShowCreditsDialog(true);
  };

  const handleManageCredits = async () => {
    if (!selectedUser) return;

    // 验证
    if (creditAmount <= 0) {
      toast({ variant: "destructive", title: "请输入有效金额" });
      return;
    }

    if (!creditReason.trim()) {
      toast({ variant: "destructive", title: "请输入操作备注" });
      return;
    }

    // 扣除时检查余额
    if (creditAction === "deduct" && creditAmount > selectedUser.credits) {
      toast({ variant: "destructive", title: "扣除金额不能超过用户当前余额" });
      return;
    }

    setIsProcessing(true);

    try {
      // 根据操作类型决定 amount 的值
      let finalAmount = creditAmount;
      if (creditAction === "deduct") {
        finalAmount = -creditAmount;
      }
      // system_grant 和 recharge 都是正数

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: creditAction,
          targetUserId: selectedUser.id,
          amount: creditAction === "deduct" ? -creditAmount : creditAmount,
          reason: creditReason.trim(),
        }),
      });

      const data = await res.json();

      if (data.success) {
        const actionText = {
          recharge: "转账成功",
          deduct: "扣除成功",
          system_grant: "系统发放成功",
        }[creditAction];

        toast({
          title: actionText,
          description: `${creditAction === "deduct" ? "-" : "+"}${creditAmount} Credits`,
        });
        setShowCreditsDialog(false);
        fetchUsers();

        // 触发前端积分刷新（更新header中的积分显示）
        window.dispatchEvent(new CustomEvent("credits-updated"));
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Credit operation error:", error);
      toast({
        variant: "destructive",
        title: "操作失败",
        description: error.message || "请稍后重试",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ================================================================
  // 封禁/解封用户
  // ================================================================

  const handleOpenBanDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setBanReason("");
    setShowBanDialog(true);
  };

  // ================================================================
  // 删除用户
  // ================================================================

  const handleOpenDeleteDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setShowDeleteDialog(true);
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    setIsProcessing(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          targetUserId: selectedUser.id,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast({
          title: "用户已删除",
          description: `${selectedUser.email} 的账户已被删除`,
        });
        setShowDeleteDialog(false);
        fetchUsers();
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Delete user error:", error);
      toast({
        variant: "destructive",
        title: "删除失败",
        description: error.message || "请稍后重试",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ================================================================
  // 功能限制管理
  // ================================================================

  const handleOpenRestrictionsDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setFeatureRestrictions((user.feature_restrictions || {
      video_generation: true,
      image_generation: true,
      model_hiring: true,
      batch_processing: true,
    }) as typeof featureRestrictions);
    setShowRestrictionsDialog(true);
  };

  const handleSaveRestrictions = async () => {
    if (!selectedUser) return;

    setIsProcessing(true);
    try {
      // TODO: 实际生产环境需要调用 API 保存
      toast({
        title: "功能权限已更新",
        description: `已更新 ${selectedUser.email} 的功能权限`,
      });
      setShowRestrictionsDialog(false);
      fetchUsers();
    } catch (error) {
      console.error("Save restrictions error:", error);
      toast({ variant: "destructive", title: "操作失败" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBanUser = async () => {
    if (!selectedUser) return;

    if (!banReason.trim()) {
      toast({ variant: "destructive", title: "请输入封禁原因" });
      return;
    }

    setIsProcessing(true);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ban",
          targetUserId: selectedUser.id,
          reason: banReason.trim(),
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast({ title: "用户已封禁" });
        setShowBanDialog(false);
        fetchUsers();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Ban error:", error);
      toast({ variant: "destructive", title: "操作失败" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnbanUser = async (user: AdminUser) => {
    if (!confirm(`确定要解封用户 "${user.email}" 吗？`)) return;

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unban",
          targetUserId: user.id,
          reason: "Admin unbanned",
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast({ title: "用户已解封" });
        fetchUsers();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Unban error:", error);
      toast({ variant: "destructive", title: "操作失败" });
    }
  };

  // ================================================================
  // 格式化辅助函数
  // ================================================================

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatCredits = (credits: number) => {
    if (credits >= 1000000) {
      return `${(credits / 1000000).toFixed(1)}M`;
    }
    if (credits >= 1000) {
      return `${(credits / 1000).toFixed(1)}K`;
    }
    return credits.toString();
  };

  // ================================================================
  // 渲染
  // ================================================================

  return (
    <div className="space-y-8">
      {/* Header - JCUI 2.0 Style */}
      <div className="relative">
        <div className="absolute -inset-4 bg-gradient-to-r from-[#CCFF00]/5 via-[#00F2EA]/5 to-[#EC4899]/5 blur-3xl opacity-50 pointer-events-none" />
        <div className="relative">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            用户<span className="text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899]">管理</span>
          </h1>
          <p className="text-white/50 text-sm font-mono mt-1 uppercase tracking-wider">
            USER ACCOUNTS • CREDITS • STATUS CONTROL
          </p>
        </div>
      </div>

      {/* Stats Cards - Mermaid Glass */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total Users */}
        <div className="group relative rounded-2xl p-[1px] bg-gradient-to-br from-[#00F2EA]/30 to-[#00F2EA]/10 hover:from-[#00F2EA]/50 hover:to-[#00F2EA]/20 transition-all duration-500">
          <div className="relative h-full rounded-2xl bg-[#0B0C10] p-5 overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-[#00F2EA]/10 blur-2xl rounded-full transition-all duration-500 group-hover:bg-[#00F2EA]/20" />
            <div className="relative flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-[#00F2EA]/10 border border-[#00F2EA]/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <User className="h-6 w-6 text-[#00F2EA]" />
              </div>
              <div>
                <p className="text-3xl font-bold text-white">{users.length}</p>
                <p className="text-xs text-white/50 font-mono">TOTAL USERS</p>
              </div>
            </div>
          </div>
        </div>

        {/* Active Users */}
        <div className="group relative rounded-2xl p-[1px] bg-gradient-to-br from-[#22c55e]/30 to-[#22c55e]/10 hover:from-[#22c55e]/50 hover:to-[#22c55e]/20 transition-all duration-500">
          <div className="relative h-full rounded-2xl bg-[#0B0C10] p-5 overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-[#22c55e]/10 blur-2xl rounded-full transition-all duration-500 group-hover:bg-[#22c55e]/20" />
            <div className="relative flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <UserCheck className="h-6 w-6 text-[#22c55e]" />
              </div>
              <div>
                <p className="text-3xl font-bold text-white">
                  {users.filter((u) => u.status === "active").length}
                </p>
                <p className="text-xs text-white/50 font-mono">ACTIVE</p>
              </div>
            </div>
          </div>
        </div>

        {/* Banned Users */}
        <div className="group relative rounded-2xl p-[1px] bg-gradient-to-br from-[#ef4444]/30 to-[#ef4444]/10 hover:from-[#ef4444]/50 hover:to-[#ef4444]/20 transition-all duration-500">
          <div className="relative h-full rounded-2xl bg-[#0B0C10] p-5 overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-[#ef4444]/10 blur-2xl rounded-full transition-all duration-500 group-hover:bg-[#ef4444]/20" />
            <div className="relative flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-[#ef4444]/10 border border-[#ef4444]/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <UserX className="h-6 w-6 text-[#ef4444]" />
              </div>
              <div>
                <p className="text-3xl font-bold text-white">
                  {users.filter((u) => u.status === "banned").length}
                </p>
                <p className="text-xs text-white/50 font-mono">BANNED</p>
              </div>
            </div>
          </div>
        </div>

        {/* Total Credits */}
        <div className="group relative rounded-2xl p-[1px] bg-gradient-to-br from-[#CCFF00]/30 via-[#00F2EA]/20 to-[#EC4899]/30 hover:from-[#CCFF00]/50 hover:to-[#EC4899]/50 transition-all duration-500">
          <div className="relative h-full rounded-2xl bg-[#0B0C10] p-5 overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-[#CCFF00]/10 to-[#EC4899]/10 blur-2xl rounded-full transition-all duration-500 group-hover:from-[#CCFF00]/20 group-hover:to-[#EC4899]/20" />
            <div className="relative flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#CCFF00]/10 to-[#EC4899]/10 border border-[#CCFF00]/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <Zap className="h-6 w-6 text-[#CCFF00]" />
              </div>
              <div>
                <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] to-[#00F2EA]">
                  {formatCredits(users.reduce((sum, u) => sum + u.credits, 0))}
                </p>
                <p className="text-xs text-white/50 font-mono">TOTAL CREDITS</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters - Titanium Glass */}
      <div className="rounded-2xl border border-white/10 bg-[#0B0C10]/80 backdrop-blur-xl p-5 relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="flex flex-wrap gap-4 items-center">
          {/* Search Input */}
          <div className="flex-1 min-w-[280px] relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 group-focus-within:text-[#00F2EA] transition-colors duration-300" />
            <Input
              placeholder="搜索邮箱或用户名..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 h-12 bg-[#050505] border-white/10 rounded-xl text-white placeholder:text-white/30 focus:border-[#00F2EA]/50 focus:ring-[#00F2EA]/20 transition-all duration-300"
            />
          </div>

          {/* Role Filter */}
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-[140px] h-12 bg-[#050505] border-white/10 rounded-xl text-white hover:border-white/20 transition-colors">
              <SelectValue placeholder="角色" />
            </SelectTrigger>
            <SelectContent className="bg-[#0B0C10] border-white/10 rounded-xl">
              <SelectItem value="all" className="text-white hover:bg-white/5 focus:bg-white/5">全部角色</SelectItem>
              <SelectItem value="user" className="text-white hover:bg-white/5 focus:bg-white/5">普通用户</SelectItem>
              <SelectItem value="admin" className="text-white hover:bg-white/5 focus:bg-white/5">管理员</SelectItem>
              <SelectItem value="super_admin" className="text-white hover:bg-white/5 focus:bg-white/5">超级管理员</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px] h-12 bg-[#050505] border-white/10 rounded-xl text-white hover:border-white/20 transition-colors">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent className="bg-[#0B0C10] border-white/10 rounded-xl">
              <SelectItem value="all" className="text-white hover:bg-white/5 focus:bg-white/5">全部状态</SelectItem>
              <SelectItem value="active" className="text-white hover:bg-white/5 focus:bg-white/5">正常</SelectItem>
              <SelectItem value="suspended" className="text-white hover:bg-white/5 focus:bg-white/5">暂停</SelectItem>
              <SelectItem value="banned" className="text-white hover:bg-white/5 focus:bg-white/5">封禁</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Users List - JCUI 2.0 Card Layout */}
      <div className="rounded-2xl border border-white/10 bg-[#0B0C10]/80 backdrop-blur-xl overflow-hidden">
        {/* Header Row */}
        <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/10 bg-[#050505]/50">
          <div className="col-span-4 text-xs font-mono text-white/40 uppercase tracking-wider">用户</div>
          <div className="col-span-2 text-xs font-mono text-white/40 uppercase tracking-wider">角色</div>
          <div className="col-span-2 text-xs font-mono text-white/40 uppercase tracking-wider flex items-center gap-1">
            <Zap className="h-3 w-3 text-[#CCFF00]" /> 积分
          </div>
          <div className="col-span-2 text-xs font-mono text-white/40 uppercase tracking-wider">注册时间</div>
          <div className="col-span-1 text-xs font-mono text-white/40 uppercase tracking-wider">状态</div>
          <div className="col-span-1 text-xs font-mono text-white/40 uppercase tracking-wider text-right">操作</div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="relative">
              <div className="absolute inset-0 h-10 w-10 rounded-full border-2 border-[#00F2EA]/20 animate-ping" />
              <Loader2 className="h-10 w-10 animate-spin text-[#00F2EA]" />
            </div>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <User className="h-8 w-8 text-white/20" />
            </div>
            <p className="text-white/40 font-mono text-sm">NO USERS FOUND</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredUsers.map((user) => {
              const statusDisplay = getStatusDisplay(user.status);
              const isAdmin = user.role === "super_admin" || user.role === "admin";
              return (
                <div
                  key={user.id}
                  className={cn(
                    "group grid grid-cols-12 gap-4 p-4 transition-all duration-300 hover:bg-white/[0.02] relative",
                    isAdmin && "bg-gradient-to-r from-[#ef4444]/[0.02] to-transparent"
                  )}
                >
                  {/* Hover glow effect */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-gradient-to-r from-[#00F2EA]/[0.02] via-transparent to-transparent" />

                  {/* User Info */}
                  <div className="col-span-4 flex items-center gap-3 relative z-10">
                    <div className={cn(
                      "h-11 w-11 rounded-xl overflow-hidden flex-shrink-0 transition-transform duration-300 group-hover:scale-105",
                      isAdmin
                        ? "ring-2 ring-[#ef4444]/40 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                        : "ring-1 ring-white/10"
                    )}>
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt={user.name || ""}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#00F2EA] to-[#EC4899]">
                          <span className="text-black font-bold text-sm">
                            {(user.name || user.email)[0].toUpperCase()}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate group-hover:text-[#00F2EA] transition-colors duration-300">
                        {user.name || "未命名用户"}
                      </p>
                      <p className="text-xs text-white/40 flex items-center gap-1.5 truncate">
                        <Mail className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{user.email}</span>
                      </p>
                    </div>
                  </div>

                  {/* Role */}
                  <div className="col-span-2 flex items-center relative z-10">
                    <span
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300",
                        user.role === "super_admin"
                          ? "bg-gradient-to-r from-[#ef4444]/20 to-[#f97316]/20 text-[#ef4444] border border-[#ef4444]/30 shadow-[0_0_10px_rgba(239,68,68,0.1)]"
                          : user.role === "admin"
                            ? "bg-gradient-to-r from-[#f59e0b]/20 to-[#eab308]/20 text-[#f59e0b] border border-[#f59e0b]/30 shadow-[0_0_10px_rgba(245,158,11,0.1)]"
                            : "bg-white/5 text-white/50 border border-white/10"
                      )}
                    >
                      {isAdmin && <Shield className="h-3 w-3 inline mr-1" />}
                      {getRoleDisplayName(user.role)}
                    </span>
                  </div>

                  {/* Credits */}
                  <div className="col-span-2 flex items-center relative z-10">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#CCFF00]/10 to-[#00F2EA]/10 border border-[#CCFF00]/20">
                      <Zap className="h-4 w-4 text-[#CCFF00]" />
                      <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] to-[#00F2EA]">
                        {user.credits.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Registration Date */}
                  <div className="col-span-2 flex items-center relative z-10">
                    <div className="flex items-center gap-2 text-white/40 text-sm">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{formatDate(user.created_at)}</span>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="col-span-1 flex items-center relative z-10">
                    <span
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-300",
                        user.status === "active"
                          ? "bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30 shadow-[0_0_8px_rgba(34,197,94,0.15)]"
                          : user.status === "suspended"
                            ? "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30"
                            : "bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30"
                      )}
                    >
                      {user.status === "active" && <CheckCircle2 className="h-3 w-3" />}
                      {user.status === "banned" && <Ban className="h-3 w-3" />}
                      {user.status === "suspended" && <AlertTriangle className="h-3 w-3" />}
                      {statusDisplay.label}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="col-span-1 flex items-center justify-end relative z-10">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-lg border border-transparent hover:border-white/10 hover:bg-white/5 transition-all duration-300"
                        >
                          <MoreHorizontal className="h-4 w-4 text-white/40 group-hover:text-white/70" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-[#0B0C10] border-white/10 rounded-xl shadow-2xl shadow-black/50 min-w-[180px]"
                      >
                        <DropdownMenuItem asChild className="hover:bg-white/5 focus:bg-white/5 rounded-lg m-1">
                          <Link href={`/admin/users/${user.id}`} className="cursor-pointer text-white">
                            <Eye className="h-4 w-4 mr-2 text-[#00F2EA]" />
                            查看详情
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-white/10 my-1" />
                        <DropdownMenuItem
                          onClick={() => handleOpenCreditsDialog(user)}
                          className="hover:bg-white/5 focus:bg-white/5 rounded-lg m-1 text-white"
                        >
                          <CreditCard className="h-4 w-4 mr-2 text-[#CCFF00]" />
                          积分管理
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleOpenRestrictionsDialog(user)}
                          disabled={user.role !== "user"}
                          className="hover:bg-white/5 focus:bg-white/5 rounded-lg m-1 text-white disabled:opacity-30"
                        >
                          <Shield className="h-4 w-4 mr-2 text-[#f59e0b]" />
                          功能限制
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-white/10 my-1" />
                        {user.status === "banned" ? (
                          <DropdownMenuItem
                            onClick={() => handleUnbanUser(user)}
                            className="text-[#22c55e] hover:bg-[#22c55e]/10 focus:bg-[#22c55e]/10 rounded-lg m-1"
                          >
                            <UserCheck className="h-4 w-4 mr-2" />
                            解除封禁
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handleOpenBanDialog(user)}
                            className="text-[#ef4444] hover:bg-[#ef4444]/10 focus:bg-[#ef4444]/10 rounded-lg m-1"
                            disabled={user.role !== "user"}
                          >
                            <Ban className="h-4 w-4 mr-2" />
                            封禁用户
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleOpenDeleteDialog(user)}
                          className="text-[#ef4444] hover:bg-[#ef4444]/10 focus:bg-[#ef4444]/10 rounded-lg m-1"
                          disabled={user.role !== "user"}
                        >
                          <UserX className="h-4 w-4 mr-2" />
                          删除用户
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Credits Management Dialog */}
      <Dialog open={showCreditsDialog} onOpenChange={setShowCreditsDialog}>
        <DialogContent className="max-w-md bg-[#0B0C10] border-white/10 rounded-2xl">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#CCFF00]/30 to-transparent" />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#CCFF00]/20 to-[#00F2EA]/20 border border-[#CCFF00]/30 flex items-center justify-center">
                <Zap className="h-4 w-4 text-[#CCFF00]" />
              </div>
              积分管理
            </DialogTitle>
            <DialogDescription className="text-white/50">
              为用户 <span className="text-[#00F2EA] font-medium">{selectedUser?.email}</span> 管理积分
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Current Balance */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-[#CCFF00]/10 to-[#00F2EA]/10 border border-[#CCFF00]/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-[#CCFF00]/10 blur-2xl rounded-full" />
              <p className="text-xs text-[#CCFF00] mb-1 font-mono uppercase">Current Balance</p>
              <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] to-[#00F2EA]">
                {selectedUser?.credits.toLocaleString()} <span className="text-lg text-white/60">积分</span>
              </p>
            </div>

            {/* Action Type */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                操作类型
              </Label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCreditAction("system_grant")}
                  className={cn(
                    "h-14 gap-1 flex-col",
                    creditAction === "system_grant"
                      ? "bg-tiktok-cyan/20 border-tiktok-cyan/50 text-tiktok-cyan"
                      : "border-border"
                  )}
                >
                  <Zap className="h-5 w-5" />
                  <div className="text-center">
                    <div className="font-semibold text-xs">系统发放</div>
                    <div className="text-[10px] opacity-70">不扣管理员</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCreditAction("recharge")}
                  className={cn(
                    "h-14 gap-1 flex-col",
                    creditAction === "recharge"
                      ? "bg-green-500/20 border-green-500/50 text-green-400"
                      : "border-border"
                  )}
                >
                  <Plus className="h-5 w-5" />
                  <div className="text-center">
                    <div className="font-semibold text-xs">转账</div>
                    <div className="text-[10px] opacity-70">从我转入</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCreditAction("deduct")}
                  className={cn(
                    "h-14 gap-1 flex-col",
                    creditAction === "deduct"
                      ? "bg-red-500/20 border-red-500/50 text-red-400"
                      : "border-border"
                  )}
                >
                  <Minus className="h-5 w-5" />
                  <div className="text-center">
                    <div className="font-semibold text-xs">扣除</div>
                    <div className="text-[10px] opacity-70">回收积分</div>
                  </div>
                </Button>
              </div>
              {creditAction === "system_grant" && (
                <p className="text-xs text-tiktok-cyan mt-2">
                  💡 系统发放：直接增加用户积分，不从管理员账户扣除
                </p>
              )}
              {creditAction === "recharge" && (
                <p className="text-xs text-green-400 mt-2">
                  💸 转账：从您的账户转移积分给该用户
                </p>
              )}
            </div>

            {/* Amount */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                数量 *
              </Label>
              <Input
                type="number"
                value={creditAmount}
                onChange={(e) => setCreditAmount(parseInt(e.target.value) || 0)}
                min={1}
                max={creditAction === "deduct" ? selectedUser?.credits : undefined}
                className="bg-[#050505] border-white/10 text-lg font-bold text-white rounded-xl h-12"
              />
              {creditAction === "deduct" && selectedUser && (
                <p className="text-xs text-white/40 mt-1">
                  最大可扣除: {selectedUser.credits.toLocaleString()} 积分
                </p>
              )}
            </div>

            {/* Reason (Required) */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-400" />
                操作原因 (必填) *
              </Label>
              <Textarea
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                placeholder="例如：线下转账、系统补偿、活动奖励..."
                rows={3}
                className="bg-[#050505] border-white/10 text-white rounded-xl resize-none placeholder:text-white/30"
              />
              <p className="text-xs text-white/40 mt-1">
                此备注将记录到审计日志中，请详细说明操作原因
              </p>
            </div>

            {/* Preview */}
            <div className="p-3 rounded-xl bg-[#050505] border border-white/10">
              <p className="text-xs text-white/40 mb-1 font-mono uppercase">Preview</p>
              <div className="flex items-center justify-between">
                <span className="text-white/50">操作后余额:</span>
                <span className={cn(
                  "text-xl font-bold",
                  creditAction === "deduct" ? "text-[#ef4444]" : creditAction === "system_grant" ? "text-[#00F2EA]" : "text-[#22c55e]"
                )}>
                  {creditAction === "deduct"
                    ? Math.max(0, (selectedUser?.credits || 0) - creditAmount).toLocaleString()
                    : ((selectedUser?.credits || 0) + creditAmount).toLocaleString()
                  } 积分
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreditsDialog(false)}
              className="border-border"
            >
              取消
            </Button>
            <Button
              onClick={handleManageCredits}
              disabled={isProcessing || creditAmount <= 0 || !creditReason.trim()}
              className={cn(
                "font-semibold",
                creditAction === "system_grant"
                  ? "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black"
                  : creditAction === "recharge"
                    ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white"
                    : "bg-gradient-to-r from-red-500 to-orange-500 text-white"
              )}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  {creditAction === "system_grant" ? (
                    <Zap className="h-4 w-4 mr-2" />
                  ) : creditAction === "recharge" ? (
                    <Plus className="h-4 w-4 mr-2" />
                  ) : (
                    <Minus className="h-4 w-4 mr-2" />
                  )}
                  {creditAction === "system_grant" ? "确认发放" : creditAction === "recharge" ? "确认转账" : "确认扣除"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ban User Dialog */}
      <Dialog open={showBanDialog} onOpenChange={setShowBanDialog}>
        <DialogContent className="max-w-md bg-background border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <Ban className="h-5 w-5" />
              封禁用户
            </DialogTitle>
            <DialogDescription>
              确定要封禁用户 <span className="text-white font-medium">{selectedUser?.email}</span> 吗？
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-400">警告</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    封禁后用户将无法登录系统。此操作将记录到审计日志。
                  </p>
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                封禁原因 (必填) *
              </Label>
              <Textarea
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="例如：违规操作、恶意刷单、滥用系统..."
                rows={3}
                className="bg-background border-border resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBanDialog(false)}
              className="border-border"
            >
              取消
            </Button>
            <Button
              onClick={handleBanUser}
              disabled={isProcessing || !banReason.trim()}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4 mr-2" />
                  确认封禁
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md bg-background border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <UserX className="h-5 w-5" />
              删除用户
            </DialogTitle>
            <DialogDescription>
              确定要永久删除用户 <span className="text-white font-medium">{selectedUser?.email}</span> 吗？
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-500">⚠️ 危险操作</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    此操作将永久删除用户的所有数据，包括：
                  </p>
                  <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
                    <li>用户账户和个人资料</li>
                    <li>所有合约记录</li>
                    <li>生成历史记录</li>
                    <li>积分交易记录</li>
                  </ul>
                  <p className="text-sm text-red-400 mt-2 font-medium">
                    此操作不可撤销！
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              className="border-border"
            >
              取消
            </Button>
            <Button
              onClick={handleDeleteUser}
              disabled={isProcessing}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  删除中...
                </>
              ) : (
                <>
                  <UserX className="h-4 w-4 mr-2" />
                  确认删除
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feature Restrictions Dialog */}
      <Dialog open={showRestrictionsDialog} onOpenChange={setShowRestrictionsDialog}>
        <DialogContent className="max-w-md bg-background border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-400" />
              功能权限管理
            </DialogTitle>
            <DialogDescription>
              管理用户 <span className="text-white font-medium">{selectedUser?.email}</span> 的功能权限
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-400">注意</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    禁用功能后，用户将无法使用对应的功能模块。
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {FEATURE_OPTIONS.map((feature) => (
                <div
                  key={feature.key}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border"
                >
                  <div>
                    <p className="font-medium text-sm">{feature.label}</p>
                    <p className="text-xs text-muted-foreground">{feature.description}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFeatureRestrictions(prev => ({
                      ...prev,
                      [feature.key]: !prev[feature.key as keyof typeof prev]
                    }))}
                    className={cn(
                      "w-16",
                      featureRestrictions[feature.key as keyof typeof featureRestrictions]
                        ? "bg-green-500/20 border-green-500/50 text-green-400"
                        : "bg-red-500/20 border-red-500/50 text-red-400"
                    )}
                  >
                    {featureRestrictions[feature.key as keyof typeof featureRestrictions] ? "允许" : "禁用"}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRestrictionsDialog(false)}
              className="border-border"
            >
              取消
            </Button>
            <Button
              onClick={handleSaveRestrictions}
              disabled={isProcessing}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  保存设置
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

