"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  UserCheck,
  Plus,
  TrendingUp,
  Video,
  Calendar,
  Sparkles,
  Clock,
  AlertTriangle,
  Loader2,
  Users,
  RefreshCw,
  Play,
  Star,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

// 从 API 获取签约模特
interface HiredModel {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  demo_video_url: string | null;
  tags: string[];
  category: string;
  gender: "male" | "female" | "neutral" | null;
  base_price: number;
  price_monthly: number;
  rating: number;
  is_featured: boolean;
  is_trending: boolean;
  total_rentals: number;
  total_generations: number;
  created_at: string;
  contract_id: string;
  contract_end_date: string;
  days_remaining: number;
  contract_status: string;
}
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// Helper Functions
// ============================================================================

function formatCountdown(daysRemaining: number): string {
  if (daysRemaining <= 0) return "已过期";
  if (daysRemaining === 1) return "剩余 1 天";
  if (daysRemaining < 7) return `剩余 ${daysRemaining} 天`;
  if (daysRemaining < 30) return `剩余 ${Math.floor(daysRemaining / 7)} 周`;
  return `剩余 ${Math.floor(daysRemaining / 30)} 月`;
}

function getStatusConfig(daysRemaining: number) {
  if (daysRemaining <= 0) {
    return { color: "bg-neon-red", text: "已过期", badge: "neon-error" as const };
  }
  if (daysRemaining <= 3) {
    return { color: "bg-neon-red", text: "紧急", badge: "neon-error" as const };
  }
  if (daysRemaining <= 7) {
    return { color: "bg-neon-warning", text: "即将过期", badge: "neon-warning" as const };
  }
  return { color: "bg-neon-green", text: "有效", badge: "neon-success" as const };
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-gradient-to-r from-tiktok-cyan/20 to-tiktok-pink/20 blur-3xl" />
        <Users className="relative h-24 w-24 text-muted-foreground/30" />
      </div>
      <h3 className="text-xl font-semibold mb-2">暂无签约模特</h3>
      <p className="text-muted-foreground max-w-sm mb-6">
        前往模特资源库聘用您的第一位 AI 模特，开始创作精彩内容。
      </p>
      <Button
        onClick={() => router.push("/models")}
        variant="white-glow"
      >
        <Sparkles className="mr-2 h-4 w-4" />
        浏览模特
      </Button>
    </div>
  );
}

// ============================================================================
// Team Member Card
// ============================================================================

interface TeamMemberCardProps {
  model: HiredModel;
  onUseInStudio: (modelId: string) => void;
  onRenew: (model: HiredModel) => void;
}

function TeamMemberCard({ model, onUseInStudio, onRenew }: TeamMemberCardProps) {
  const status = getStatusConfig(model.days_remaining);
  const isExpiring = model.days_remaining <= 3;
  const isWarning = model.days_remaining <= 7 && model.days_remaining > 3;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border transition-all duration-300",
        "bg-[#0B0C10]/60 backdrop-blur-md", // Base: Glass
        "border-white/10 hover:border-mermaid-cyan/30", // Glass Border
        "hover:shadow-2xl hover:shadow-mermaid-cyan/10 hover:-translate-y-1", // Hover Lift & Glow
        isExpiring && "border-neon-warning/30 shadow-[0_0_15px_rgba(245,158,11,0.1)]" // Expiring Glow
      )}
    >
      {/* 顶部图片遮罩 - 增强玻璃质感 */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-transparent to-transparent opacity-90 z-10 pointer-events-none" />
      {/* Image Section */}
      <div className="relative aspect-[4/3] overflow-hidden bg-white/5">
        {model.avatar_url ? (
          <img
            src={model.avatar_url}
            alt={model.name}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Sparkles className="h-16 w-16 text-white/10" />
          </div>
        )}

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-transparent to-transparent" />

        {/* Status Badge - Top Left */}
        <div className="absolute top-3 left-3 flex flex-col gap-2 z-20">
          <Badge
            variant="outline"
            className={cn(
              "font-medium backdrop-blur-md border",
              status.badge === "neon-success" && "bg-neon-green/10 text-neon-green border-neon-green/20 shadow-[0_0_8px_rgba(57,255,20,0.2)]",
              status.badge === "neon-warning" && "bg-neon-warning/10 text-neon-warning border-neon-warning/20 shadow-[0_0_8px_rgba(255,215,0,0.2)]",
              status.badge === "neon-error" && "bg-neon-red/10 text-neon-red border-neon-red/20 animate-pulse"
            )}
          >
            {isExpiring && <AlertTriangle className="h-3 w-3 mr-1" />}
            {status.text}
          </Badge>

          {model.is_trending && (
            <Badge className="bg-mermaid-cyan/20 text-mermaid-cyan border-mermaid-cyan/20 backdrop-blur-md">
              <TrendingUp className="h-3 w-3 mr-1" />
              热门
            </Badge>
          )}
        </div>

        {/* Expiry Timer - Top Right */}
        <div className="absolute top-3 right-3 z-20">
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-colors",
            isExpiring
              ? "bg-neon-red text-white shadow-lg shadow-neon-red/30"
              : isWarning
                ? "bg-neon-warning text-black shadow-lg shadow-neon-warning/30"
                : "bg-black/60 backdrop-blur-sm text-white border border-white/10"
          )}>
            <Clock className="h-3 w-3" />
            {formatCountdown(model.days_remaining)}
          </div>
        </div>

        {/* Bottom Content with Seam Seal Fix - Gradient Overlay */}
        <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
          <div className="p-4 pt-12 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/90 to-transparent">
            <h3 className="text-xl font-bold text-white tracking-tight group-hover:text-mermaid-cyan transition-colors duration-300 relative z-30 pointer-events-auto">{model.name}</h3>
            <p className="text-sm text-white/70 font-medium relative z-30 pointer-events-auto">{model.category}</p>

            {/* Tags */}
            <div className="flex flex-wrap gap-1.5 mt-2 relative z-30 pointer-events-auto">
              {model.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs rounded-full bg-white/10 text-white/90 backdrop-blur-sm border border-white/5"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Info Section - Seam Seal Fix: Negative margin + Z-index to cover gap */}
      <div className="relative z-20 p-4 space-y-4 -mt-1.5 bg-gradient-to-b from-[#0B0C10] to-transparent">
        {/* Stats Row */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-white/60">
              <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
              <span className="font-semibold text-white">{model.rating.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-white/60">
              <Video className="h-4 w-4" />
              <span>{model.total_generations.toLocaleString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-white/60">
            <Calendar className="h-4 w-4" />
            <span className="text-xs">
              {new Date(model.contract_end_date).toLocaleDateString("zh-CN", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={() => onUseInStudio(model.id)}
            className="flex-1 relative overflow-hidden group/btn bg-white/5 border border-white/10 hover:border-mermaid-cyan/50 text-white font-bold transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,242,234,0.2)]"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-mermaid-cyan/10 to-mermaid-pink/10 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-300" />
            <span className="relative z-10 flex items-center justify-center gap-2 group-hover/btn:scale-105 transition-transform">
              <Zap className="h-4 w-4 text-mermaid-cyan group-hover/btn:fill-mermaid-cyan" />
              去创作
            </span>
          </Button>
          <Button
            variant="outline"
            onClick={() => onRenew(model)}
            className={cn(
              "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white hover:border-white/30 backdrop-blur-sm transition-all",
              isExpiring && "border-neon-warning/30 text-neon-warning hover:bg-neon-warning/10"
            )}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

// 续约周期选项
const RENTAL_PERIODS = [
  { value: "daily", label: "1 天", multiplier: 1 },
  { value: "weekly", label: "1 周", multiplier: 7 },
  { value: "monthly", label: "1 个月", multiplier: 30 },
  { value: "yearly", label: "1 年", multiplier: 365 },
];

export default function TeamPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [models, setModels] = useState<HiredModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<HiredModel | null>(null);
  const [renewPeriod, setRenewPeriod] = useState("monthly");
  const [isRenewing, setIsRenewing] = useState(false);
  // Fetch hired models - 使用 /api/contracts API
  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/contracts?status=active");
      const result = await response.json();

      if (result.success && result.data) {
        // 将合约数据转换为 HiredModel 格式
        const hiredModels: HiredModel[] = result.data
          .filter((contract: any) => contract.ai_models)
          .map((contract: any) => {
            const model = contract.ai_models;
            const endDate = new Date(contract.end_date);
            const now = new Date();
            const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

            // 处理 style_tags
            let tags: string[] = [];
            if (model.style_tags) {
              if (typeof model.style_tags === "string") {
                try { tags = JSON.parse(model.style_tags); } catch { tags = [model.style_tags]; }
              } else if (Array.isArray(model.style_tags)) {
                tags = model.style_tags;
              }
            }

            return {
              id: model.id,
              name: model.name,
              description: model.description || null,
              avatar_url: model.avatar_url || null,
              demo_video_url: null,
              tags,
              category: model.category || "general",
              gender: model.gender || null,
              base_price: 0,
              price_monthly: 0,
              rating: 0,
              is_featured: false,
              is_trending: false,
              total_rentals: 0,
              total_generations: 0,
              created_at: model.created_at || contract.created_at,
              contract_id: contract.id,
              contract_end_date: contract.end_date,
              days_remaining: daysRemaining,
              contract_status: contract.status,
            };
          });

        // Sort by days remaining (expiring first)
        const sorted = hiredModels.sort((a, b) => a.days_remaining - b.days_remaining);
        setModels(sorted);
        console.log(`[Team Page] Loaded ${sorted.length} hired models`);
      } else {
        console.error("[Team Page] Failed to fetch:", result.error);
        toast({
          variant: "destructive",
          title: "加载失败",
          description: result.error || "无法获取您的签约模特",
        });
        setModels([]);
      }
    } catch (error) {
      console.error("[Team Page] Error:", error);
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Initial load
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Handle "Use in Studio"
  const handleUseInStudio = (modelId: string) => {
    router.push(`/quick-gen?modelId=${modelId}`);
  };

  // Handle refresh
  const handleRefresh = () => {
    fetchModels();
  };

  // Handle renew dialog open
  const handleOpenRenewDialog = (model: HiredModel) => {
    setSelectedModel(model);
    setRenewPeriod("monthly");
    setRenewDialogOpen(true);
  };

  // Handle renew
  const handleRenew = async () => {
    if (!selectedModel) return;

    setIsRenewing(true);
    try {
      const response = await fetch("/api/contracts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: selectedModel.contract_id,
          rental_period: renewPeriod,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "✅ 续约成功",
          description: `${selectedModel.name} 已续约，新到期日：${new Date(result.new_end_date).toLocaleDateString("zh-CN")}`,
        });
        setRenewDialogOpen(false);
        fetchModels(); // 刷新列表

        // 触发积分刷新
        window.dispatchEvent(new CustomEvent("credits-updated"));
      } else {
        toast({
          variant: "destructive",
          title: "续约失败",
          description: result.error || "请稍后重试",
        });
      }
    } catch (error) {
      console.error("[Team Page] Renew error:", error);
      toast({
        variant: "destructive",
        title: "续约失败",
        description: "网络错误，请稍后重试",
      });
    } finally {
      setIsRenewing(false);
    }
  };

  // Stats
  const totalModels = models.length;
  const expiringModels = models.filter(m => m.days_remaining <= 3).length;
  const totalGenerations = models.reduce((sum, m) => sum + m.total_generations, 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
            <span className="text-white drop-shadow-lg">专属模特仓</span>
          </h1>
          <p className="mt-2 text-white/60">
            管理您已签约的 AI 模特
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={handleRefresh}
            disabled={loading}
            className="rounded-full border border-white/10 hover:border-white/30 text-white/70 hover:text-white hover:bg-white/5 transition-all duration-300 hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]"
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            刷新
          </Button>
          <Button
            onClick={() => router.push("/models")}
            className="relative rounded-full font-bold text-black transition-all duration-500 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.5)] border border-white/20 overflow-hidden group shadow-[0_0_20px_rgba(0,242,234,0.2)]"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
            <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-300" />
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Plus className="mr-2 h-4 w-4" />
              聘用更多
            </span>
          </Button>
        </div>
      </div>

      {/* Stats Cards - Titanium Glass */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card variant="glass" className="group hover:border-mermaid-cyan/30 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 shadow-inner group-hover:bg-mermaid-cyan/10 group-hover:text-mermaid-cyan transition-colors">
              <UserCheck className="h-7 w-7 text-white/70 group-hover:text-mermaid-cyan transition-colors" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white tracking-tight group-hover:text-mermaid-cyan transition-colors">{totalModels}</p>
              <p className="text-sm text-white/60">签约模特</p>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" className="group hover:border-neon-warning/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(245,158,11,0.2)]">
          <CardContent className="flex items-center gap-4 p-5">
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl border shadow-inner transition-all duration-300",
              expiringModels > 0
                ? "bg-neon-warning/10 border-neon-warning/20 text-neon-warning group-hover:bg-neon-warning/20 group-hover:border-neon-warning/50 group-hover:shadow-[0_0_15px_rgba(245,158,11,0.4)] group-hover:scale-105"
                : "bg-white/5 border-white/10 text-white/70 group-hover:bg-neon-warning/10 group-hover:text-neon-warning group-hover:border-neon-warning/30"
            )}>
              <AlertTriangle className={cn("h-7 w-7 drop-shadow transition-transform duration-300", expiringModels > 0 && "group-hover:animate-pulse")} />
            </div>
            <div>
              <p className="text-3xl font-bold text-white tracking-tight group-hover:text-neon-warning transition-colors duration-300">{expiringModels}</p>
              <p className="text-sm text-white/60 group-hover:text-white/80 transition-colors">即将到期</p>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" className="group hover:border-mermaid-pink/30 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 shadow-inner group-hover:bg-mermaid-pink/10 group-hover:text-mermaid-pink transition-colors">
              <Video className="h-7 w-7 text-white/70 group-hover:text-mermaid-pink transition-colors" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white tracking-tight group-hover:text-mermaid-pink transition-colors">{totalGenerations.toLocaleString()}</p>
              <p className="text-sm text-white/60">总生成次数</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Warning Banner */}
      {expiringModels > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertTriangle className="h-5 w-5 text-red-500 animate-pulse" />
          <p className="text-sm">
            <span className="font-semibold text-red-400">{expiringModels} 个合约</span>
            <span className="text-muted-foreground"> 将在 3 天内到期，建议尽快续约以避免中断。</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto border-red-500/50 text-red-400 hover:bg-red-500/10"
          >
            全部续约
          </Button>
        </div>
      )}

      {/* Team Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-border/50 bg-card/50 overflow-hidden animate-pulse"
            >
              <div className="aspect-[4/3] bg-gradient-to-br from-muted/50 to-muted/30" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-muted/50 rounded w-3/4" />
                <div className="h-10 bg-muted/50 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : models.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {models.map((model) => (
            <TeamMemberCard
              key={model.id}
              model={model}
              onUseInStudio={handleUseInStudio}
              onRenew={handleOpenRenewDialog}
            />
          ))}
        </div>
      )}

      {/* Contract Timeline - JCUI 2.0 Aurora Style */}
      {models.length > 0 && (
        <div className="relative group rounded-3xl p-[1px] bg-gradient-to-br from-mermaid-cyan/20 via-mermaid-pink/20 to-mermaid-lime/20 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-mermaid-cyan/10 via-mermaid-pink/10 to-mermaid-lime/10 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <Card className="relative bg-[#0B0C10]/90 backdrop-blur-xl border-0 rounded-[23px] overflow-hidden">
            <CardHeader className="border-b border-white/5 pb-4">
              <CardTitle className="flex items-center gap-3 text-lg">
                <div className="p-2 rounded-lg bg-gradient-to-br from-mermaid-pink/20 to-purple-500/20 text-mermaid-pink">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <span className="block text-white font-bold">合约时间线</span>
                  <span className="text-xs font-normal text-white/40">Contract Timeline</span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-3">
                {models.slice(0, 5).map((model) => {
                  const status = getStatusConfig(model.days_remaining);

                  return (
                    <div
                      key={model.id}
                      className="group/item relative flex items-center gap-4 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-mermaid-cyan/30 hover:bg-white/10 transition-all duration-300 overflow-hidden"
                    >
                      {/* Hover Gradient Background */}
                      <div className="absolute inset-0 bg-gradient-to-r from-mermaid-cyan/10 to-transparent opacity-0 group-hover/item:opacity-100 transition-opacity duration-300 pointer-events-none" />

                      {/* Status Indicator Pill */}
                      <div className={cn("w-1.5 h-10 rounded-full shadow-[0_0_10px_currentColor]", status.color.replace("bg-", "text-"), status.color)} />

                      {/* Avatar */}
                      <div className="h-10 w-10 rounded-lg overflow-hidden ring-1 ring-white/10 shadow-lg relative z-10">
                        {model.avatar_url ? (
                          <img
                            src={model.avatar_url}
                            alt={model.name}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover/item:scale-110"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center bg-white/5">
                            <Sparkles className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 relative z-10">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-white truncate group-hover/item:text-mermaid-cyan transition-colors">{model.name}</p>
                          {model.is_trending && <TrendingUp className="h-3 w-3 text-mermaid-cyan" />}
                        </div>
                        <p className="text-xs text-white/50 flex items-center gap-1.5 mt-0.5">
                          <span>到期: {new Date(model.contract_end_date).toLocaleDateString("zh-CN")}</span>
                        </p>
                      </div>

                      {/* Countdown Badge */}
                      <Badge
                        variant="outline"
                        className={cn(
                          "relative z-10 border-0 font-bold backdrop-blur-md",
                          status.badge === "neon-success" && "bg-neon-green/10 text-neon-green shadow-[0_0_10px_rgba(57,255,20,0.1)]",
                          status.badge === "neon-warning" && "bg-neon-warning/10 text-neon-warning shadow-[0_0_10px_rgba(255,215,0,0.1)]",
                          status.badge === "neon-error" && "bg-neon-red/10 text-neon-red shadow-[0_0_10px_rgba(255,0,0,0.2)]"
                        )}
                      >
                        {formatCountdown(model.days_remaining)}
                      </Badge>

                      {/* Quick Action */}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleUseInStudio(model.id)}
                        className="relative z-10 h-8 w-8 rounded-full border border-white/10 text-white/50 hover:text-white hover:bg-white/10 hover:border-white/30 transition-all"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Renew Dialog */}
      <Dialog open={renewDialogOpen} onOpenChange={setRenewDialogOpen}>
        <DialogContent className="bg-background border-border/50 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-tiktok-cyan" />
              续约模特
            </DialogTitle>
            <DialogDescription>
              为 {selectedModel?.name} 续约合约
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Model Info */}
            {selectedModel && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <div className="h-12 w-12 rounded-lg overflow-hidden bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20">
                  {selectedModel.avatar_url ? (
                    <img
                      src={selectedModel.avatar_url}
                      alt={selectedModel.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <Sparkles className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="font-medium">{selectedModel.name}</p>
                  <p className="text-sm text-muted-foreground">
                    当前到期: {new Date(selectedModel.contract_end_date).toLocaleDateString("zh-CN")}
                  </p>
                </div>
              </div>
            )}

            {/* Period Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">续约周期</label>
              <Select value={renewPeriod} onValueChange={setRenewPeriod}>
                <SelectTrigger className="bg-background border-border/50">
                  <SelectValue placeholder="选择续约周期" />
                </SelectTrigger>
                <SelectContent className="bg-background border-border/50">
                  {RENTAL_PERIODS.map((period) => (
                    <SelectItem key={period.value} value={period.value}>
                      {period.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Price Info */}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">续约费用</span>
                <span className="font-bold text-amber-400">
                  {selectedModel?.price_monthly || 150} 积分
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenewDialogOpen(false)}
              disabled={isRenewing}
              className="border-border/50"
            >
              取消
            </Button>
            <Button
              onClick={handleRenew}
              disabled={isRenewing}
              variant="white-glow"
            >
              {isRenewing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  确认续约
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
