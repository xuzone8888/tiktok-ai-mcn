"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
  Search,
  Loader2,
  FileText,
  User,
  UserCircle,
  Zap,
  Ban,
  UserCheck,
  RefreshCw,
  Shield,
  Settings,
  Clock,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

const ACTION_TYPES = [
  { value: "all", label: "All Actions" },
  { value: "recharge_credits", label: "Recharge Credits" },
  { value: "deduct_credits", label: "Deduct Credits" },
  { value: "ban_user", label: "Ban User" },
  { value: "unban_user", label: "Unban User" },
  { value: "create_model", label: "Create Model" },
  { value: "update_model", label: "Update Model" },
  { value: "delete_model", label: "Delete Model" },
  { value: "update_trigger_word", label: "Update Trigger Word" },
  { value: "update_payment_info", label: "Update Payment Info" },
  { value: "update_announcement", label: "Update Announcement" },
  { value: "update_pricing", label: "Update Pricing" },
  { value: "toggle_maintenance", label: "Toggle Maintenance" },
];

// ============================================================================
// Helper Functions
// ============================================================================

function getActionIcon(actionType: string) {
  switch (actionType) {
    case "recharge_credits":
      return <Zap className="h-4 w-4 text-green-400" />;
    case "deduct_credits":
      return <Zap className="h-4 w-4 text-red-400" />;
    case "ban_user":
      return <Ban className="h-4 w-4 text-red-400" />;
    case "unban_user":
      return <UserCheck className="h-4 w-4 text-green-400" />;
    case "create_model":
    case "update_model":
    case "delete_model":
    case "update_trigger_word":
      return <UserCircle className="h-4 w-4 text-purple-400" />;
    case "update_payment_info":
    case "update_announcement":
    case "update_pricing":
    case "toggle_maintenance":
      return <Settings className="h-4 w-4 text-amber-400" />;
    default:
      return <FileText className="h-4 w-4 text-muted-foreground" />;
  }
}

function getActionLabel(actionType: string): string {
  const action = ACTION_TYPES.find((a) => a.value === actionType);
  return action?.label || actionType;
}

function getActionColor(actionType: string): string {
  if (actionType.includes("recharge") || actionType.includes("unban") || actionType.includes("create")) {
    return "text-green-400 bg-green-500/10 border-green-500/30";
  }
  if (actionType.includes("deduct") || actionType.includes("ban") || actionType.includes("delete")) {
    return "text-red-400 bg-red-500/10 border-red-500/30";
  }
  if (actionType.includes("update") || actionType.includes("toggle")) {
    return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  }
  return "text-muted-foreground bg-white/5 border-white/10";
}

function formatDetails(details: Record<string, unknown>): string {
  if (details.amount !== undefined) {
    const amount = details.amount as number;
    return `${amount > 0 ? "+" : ""}${amount} Credits - ${details.reason || "N/A"}`;
  }
  if (details.model_name) {
    return `Model: ${details.model_name}`;
  }
  if (details.target_email) {
    return `User: ${details.target_email}`;
  }
  if (details.reason) {
    return `Reason: ${details.reason}`;
  }
  return JSON.stringify(details).slice(0, 50) + "...";
}

// ============================================================================
// Admin Audit Logs Page
// ============================================================================

export default function AdminAuditLogsPage() {
  const { toast } = useToast();

  // 状态
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAction, setFilterAction] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // ================================================================
  // 数据获取
  // ================================================================

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "20");
      if (filterAction !== "all") params.set("action_type", filterAction);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        setLogs(data.data.logs || []);
        setTotalPages(data.data.total_pages || 1);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
      toast({
        variant: "destructive",
        title: "获取审计日志失败",
      });
    } finally {
      setLoading(false);
    }
  }, [page, filterAction, searchQuery, toast]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 格式化时间
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ================================================================
  // 渲染
  // ================================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Logs</h1>
          <p className="text-muted-foreground">
            查看所有管理员操作记录，确保系统安全可追溯
          </p>
        </div>
        <Button
          variant="outline"
          onClick={fetchLogs}
          disabled={loading}
          className="border-white/20"
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <FileText className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{logs.length}</p>
              <p className="text-xs text-muted-foreground">Total Logs</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-green-500/20 flex items-center justify-center">
              <Zap className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {logs.filter((l) => l.action_type.includes("credit")).length}
              </p>
              <p className="text-xs text-muted-foreground">Credit Ops</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <UserCircle className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {logs.filter((l) => l.action_type.includes("model")).length}
              </p>
              <p className="text-xs text-muted-foreground">Model Ops</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <Ban className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {logs.filter((l) => l.action_type.includes("ban")).length}
              </p>
              <p className="text-xs text-muted-foreground">Ban Ops</p>
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
                  placeholder="Search by admin email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-black/30 border-white/10"
                />
              </div>
            </div>
            <Select value={filterAction} onValueChange={setFilterAction}>
              <SelectTrigger className="w-[200px] bg-black/30 border-white/10">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Action Type" />
              </SelectTrigger>
              <SelectContent className="bg-black/95 border-white/10">
                {ACTION_TYPES.map((action) => (
                  <SelectItem key={action.value} value={action.value}>
                    {action.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <FileText className="h-12 w-12 mb-4 opacity-50" />
              <p>No audit logs found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-[180px]">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      Time
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Shield className="h-3.5 w-3.5" />
                      Admin
                    </div>
                  </TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow
                    key={log.id}
                    className="border-border/50 hover:bg-white/5"
                  >
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatTime(log.created_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-red-500/20 flex items-center justify-center">
                          <User className="h-4 w-4 text-red-400" />
                        </div>
                        <span className="text-sm">{log.admin_email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
                          getActionColor(log.action_type)
                        )}
                      >
                        {getActionIcon(log.action_type)}
                        {getActionLabel(log.action_type)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {log.action_description || formatDetails(log.details)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="h-8 w-8 border-white/20"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="h-8 w-8 border-white/20"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

