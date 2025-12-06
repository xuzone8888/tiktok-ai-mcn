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
} from "lucide-react";
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
    setFeatureRestrictions(user.feature_restrictions || {
      video_generation: true,
      image_generation: true,
      model_hiring: true,
      batch_processing: true,
    });
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">用户管理</h1>
        <p className="text-muted-foreground">
          管理用户账号、积分余额和账号状态
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <User className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{users.length}</p>
              <p className="text-xs text-muted-foreground">总用户数</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-green-500/20 flex items-center justify-center">
              <UserCheck className="h-6 w-6 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {users.filter((u) => u.status === "active").length}
              </p>
              <p className="text-xs text-muted-foreground">活跃用户</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-red-500/20 flex items-center justify-center">
              <UserX className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {users.filter((u) => u.status === "banned").length}
              </p>
              <p className="text-xs text-muted-foreground">封禁用户</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Zap className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {formatCredits(users.reduce((sum, u) => sum + u.credits, 0))}
              </p>
              <p className="text-xs text-muted-foreground">总积分</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[250px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索邮箱或用户名..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-background border-border"
                />
              </div>
            </div>
            <Select value={filterRole} onValueChange={setFilterRole}>
              <SelectTrigger className="w-[130px] bg-background border-border">
                <SelectValue placeholder="角色" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="all">全部角色</SelectItem>
                <SelectItem value="user">普通用户</SelectItem>
                <SelectItem value="admin">管理员</SelectItem>
                <SelectItem value="super_admin">超级管理员</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[130px] bg-background border-border">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">正常</SelectItem>
                <SelectItem value="suspended">暂停</SelectItem>
                <SelectItem value="banned">封禁</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <User className="h-12 w-12 mb-4 opacity-50" />
              <p>未找到用户</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-[300px]">用户</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Zap className="h-3.5 w-3.5 text-amber-400" />
                      积分
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      注册时间
                    </div>
                  </TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-[100px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => {
                  const statusDisplay = getStatusDisplay(user.status);
                  return (
                    <TableRow
                      key={user.id}
                      className="border-border/50 hover:bg-white/5"
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-muted overflow-hidden flex-shrink-0">
                            {user.avatar_url ? (
                              <img
                                src={user.avatar_url}
                                alt={user.name || ""}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-tiktok-cyan to-tiktok-pink">
                                <span className="text-black font-bold text-sm">
                                  {(user.name || user.email)[0].toUpperCase()}
                                </span>
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-medium">
                              {user.name || "未命名用户"}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {user.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "px-2 py-1 rounded-full text-xs font-medium",
                            user.role === "super_admin"
                              ? "bg-red-500/20 text-red-400 border border-red-500/30"
                              : user.role === "admin"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-white/10 text-muted-foreground"
                          )}
                        >
                          {getRoleDisplayName(user.role)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-bold text-amber-400 text-lg">
                          {user.credits.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-muted-foreground text-sm">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDate(user.created_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 w-fit",
                            statusDisplay.color === "green"
                              ? "bg-green-500/20 text-green-400"
                              : statusDisplay.color === "yellow"
                              ? "bg-yellow-500/20 text-yellow-400"
                              : "bg-red-500/20 text-red-400"
                          )}
                        >
                          {user.status === "active" && (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          {user.status === "banned" && (
                            <Ban className="h-3 w-3" />
                          )}
                          {user.status === "suspended" && (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {statusDisplay.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="bg-popover border-border"
                          >
                            <DropdownMenuItem
                              onClick={() => handleOpenCreditsDialog(user)}
                            >
                              <CreditCard className="h-4 w-4 mr-2" />
                              积分管理
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleOpenRestrictionsDialog(user)}
                              disabled={user.role !== "user"}
                            >
                              <Shield className="h-4 w-4 mr-2" />
                              功能限制
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-white/10" />
                            {user.status === "banned" ? (
                              <DropdownMenuItem
                                onClick={() => handleUnbanUser(user)}
                                className="text-green-400 focus:text-green-400"
                              >
                                <UserCheck className="h-4 w-4 mr-2" />
                                解除封禁
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => handleOpenBanDialog(user)}
                                className="text-red-400 focus:text-red-400"
                                disabled={user.role !== "user"}
                              >
                                <Ban className="h-4 w-4 mr-2" />
                                封禁用户
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator className="bg-white/10" />
                            <DropdownMenuItem
                              onClick={() => handleOpenDeleteDialog(user)}
                              className="text-red-500 focus:text-red-500"
                              disabled={user.role !== "user"}
                            >
                              <UserX className="h-4 w-4 mr-2" />
                              删除用户
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Credits Management Dialog */}
      <Dialog open={showCreditsDialog} onOpenChange={setShowCreditsDialog}>
        <DialogContent className="max-w-md bg-background border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-400" />
              积分管理
            </DialogTitle>
            <DialogDescription>
              为用户 <span className="text-white font-medium">{selectedUser?.email}</span> 管理积分
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Current Balance */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <p className="text-xs text-amber-400 mb-1">当前余额</p>
              <p className="text-3xl font-bold text-amber-400">
                {selectedUser?.credits.toLocaleString()} <span className="text-lg">积分</span>
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
                className="bg-background border-border text-lg font-bold"
              />
              {creditAction === "deduct" && selectedUser && (
                <p className="text-xs text-muted-foreground mt-1">
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
                className="bg-background border-border resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                此备注将记录到审计日志中，请详细说明操作原因
              </p>
            </div>

            {/* Preview */}
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground mb-1">操作预览</p>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">操作后余额:</span>
                <span className={cn(
                  "text-xl font-bold",
                  creditAction === "deduct" ? "text-red-400" : creditAction === "system_grant" ? "text-tiktok-cyan" : "text-green-400"
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

