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
  Coins,
  RefreshCw,
  Play,
  Star,
  Zap,
  ChevronRight,
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
    return { color: "bg-red-500", text: "已过期", badge: "destructive" as const };
  }
  if (daysRemaining <= 3) {
    return { color: "bg-red-500", text: "紧急", badge: "destructive" as const };
  }
  if (daysRemaining <= 7) {
    return { color: "bg-amber-500", text: "即将过期", badge: "warning" as const };
  }
  return { color: "bg-emerald-500", text: "有效", badge: "success" as const };
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
        className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold hover:opacity-90"
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
        "group relative overflow-hidden rounded-2xl border bg-card/50 backdrop-blur-sm transition-all duration-300",
        isExpiring 
          ? "border-red-500/50 shadow-lg shadow-red-500/10" 
          : "border-border/50 hover:border-tiktok-cyan/50 hover:shadow-xl hover:shadow-tiktok-cyan/5",
        "hover:-translate-y-1"
      )}
    >
      {/* Image Section */}
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-tiktok-cyan/5 to-tiktok-pink/5">
        {model.avatar_url ? (
          <img
            src={model.avatar_url}
            alt={model.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Sparkles className="h-16 w-16 text-muted-foreground/20" />
          </div>
        )}

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Status Badge - Top Left */}
        <div className="absolute top-3 left-3 flex flex-col gap-2">
          <Badge 
            variant={status.badge}
            className={cn(
              "font-semibold shadow-lg",
              status.badge === "success" && "bg-emerald-500/90 text-white border-0",
              status.badge === "warning" && "bg-amber-500/90 text-black border-0",
              status.badge === "destructive" && "bg-red-500/90 text-white border-0 animate-pulse"
            )}
          >
            {isExpiring && <AlertTriangle className="h-3 w-3 mr-1" />}
            {status.text}
          </Badge>
          
          {model.is_trending && (
            <Badge className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold border-0">
              <TrendingUp className="h-3 w-3 mr-1" />
              热门
            </Badge>
          )}
        </div>

        {/* Expiry Timer - Top Right */}
        <div className="absolute top-3 right-3">
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold",
            isExpiring 
              ? "bg-red-500/90 text-white" 
              : isWarning 
                ? "bg-amber-500/90 text-black" 
                : "bg-black/60 backdrop-blur-sm text-white"
          )}>
            <Clock className="h-3 w-3" />
            {formatCountdown(model.days_remaining)}
          </div>
        </div>

        {/* Bottom Content */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="text-xl font-bold text-white tracking-tight">{model.name}</h3>
          <p className="text-sm text-white/70 font-medium">{model.category}</p>
          
          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {model.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs rounded-full bg-white/15 text-white/90 backdrop-blur-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Info Section */}
      <div className="p-4 space-y-4">
        {/* Stats Row */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Star className="h-4 w-4 text-yellow-500" />
              <span className="font-semibold text-foreground">{model.rating.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Video className="h-4 w-4" />
              <span>{model.total_generations.toLocaleString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
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
            className="flex-1 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-bold hover:opacity-90 hover:scale-[1.02] transition-all shadow-lg shadow-tiktok-cyan/20"
          >
            <Zap className="mr-2 h-4 w-4" />
            去创作
          </Button>
          <Button 
            variant="outline"
            onClick={() => onRenew(model)}
            className={cn(
              "border-border/50 hover:border-tiktok-cyan/50",
              isExpiring && "border-red-500/50 text-red-400 hover:bg-red-500/10"
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
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="gradient-tiktok-text">专属模特仓</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            管理您已签约的 AI 模特
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            onClick={handleRefresh}
            disabled={loading}
            className="border-border/50 hover:border-tiktok-cyan/50"
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            刷新
          </Button>
          <Button 
            onClick={() => router.push("/models")}
            className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold hover:opacity-90"
          >
            <Plus className="mr-2 h-4 w-4" />
            聘用更多
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/50 bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tiktok-cyan/10 text-tiktok-cyan">
              <UserCheck className="h-7 w-7" />
            </div>
            <div>
              <p className="text-3xl font-bold">{totalModels}</p>
              <p className="text-sm text-muted-foreground">签约模特</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl",
              expiringModels > 0 ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
            )}>
              <AlertTriangle className="h-7 w-7" />
            </div>
            <div>
              <p className="text-3xl font-bold">{expiringModels}</p>
              <p className="text-sm text-muted-foreground">即将到期</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tiktok-pink/10 text-tiktok-pink">
              <Video className="h-7 w-7" />
            </div>
            <div>
              <p className="text-3xl font-bold">{totalGenerations.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">总生成次数</p>
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

      {/* Contract Timeline */}
      {models.length > 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="h-5 w-5 text-tiktok-pink" />
              合约时间线
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {models.slice(0, 5).map((model) => {
                const status = getStatusConfig(model.days_remaining);
                
                return (
                  <div 
                    key={model.id}
                    className="flex items-center gap-4 p-3 rounded-xl bg-white/5 border border-border/30"
                  >
                    {/* Status Indicator */}
                    <div className={cn("w-1 h-12 rounded-full", status.color)} />
                    
                    {/* Avatar */}
                    <div className="h-10 w-10 rounded-lg overflow-hidden bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20 flex-shrink-0">
                      {model.avatar_url ? (
                        <img
                          src={model.avatar_url}
                          alt={model.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <Sparkles className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{model.name}</p>
                      <p className="text-xs text-muted-foreground">
                        到期: {new Date(model.contract_end_date).toLocaleDateString("zh-CN", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                    
                    {/* Countdown */}
                    <Badge 
                      variant={status.badge}
                      className={cn(
                        "font-semibold",
                        status.badge === "success" && "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
                        status.badge === "warning" && "bg-amber-500/20 text-amber-400 border-amber-500/30",
                        status.badge === "destructive" && "bg-red-500/20 text-red-400 border-red-500/30"
                      )}
                    >
                      {formatCountdown(model.days_remaining)}
                    </Badge>
                    
                    {/* Quick Action */}
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => handleUseInStudio(model.id)}
                      className="hover:bg-tiktok-cyan/10 hover:text-tiktok-cyan"
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
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
              className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold"
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
