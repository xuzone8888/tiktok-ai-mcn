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
  Trash2,
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

// 从 API 获取签约角色
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

// 自建角色
interface MyCharacter {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  reference_sheet_url: string | null;
  reference_status: string; // none | pending | completed | failed
  reference_task_id: string | null;
  preview_video_url: string | null;
  character_type: string;
  style_tags: string[];
  is_public: boolean;
  publish_price: number;
  created_at: string;
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

// 参考图状态配置
function getReferenceStatusConfig(status: string) {
  switch (status) {
    case "completed":
      return { dot: "bg-neon-green", text: "可引用", canUse: true };
    case "pending":
      return { dot: "bg-amber-400 animate-pulse", text: "生成中", canUse: false };
    case "failed":
      return { dot: "bg-neon-red", text: "不可引用", canUse: false };
    default:
      return { dot: "bg-white/30", text: "未生成", canUse: false };
  }
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
      <h3 className="text-xl font-semibold mb-2">还没有角色</h3>
      <p className="text-muted-foreground max-w-sm mb-6">
        创建您的专属 AI 角色，或前往角色市场聘用官方角色。
      </p>
      <div className="flex gap-3">
        <Button
          onClick={() => router.push("/character/create")}
          variant="white-glow"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          创建角色
        </Button>
        <Button
          onClick={() => router.push("/models")}
          variant="outline"
          className="border-white/10 text-white/70 hover:border-white/30 hover:text-white"
        >
          <Plus className="mr-2 h-4 w-4" />
          浏览广场
        </Button>
      </div>
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
// My Character Card (自建角色)
// ============================================================================

interface MyCharacterCardProps {
  character: MyCharacter;
  onUseInStudio: (characterId: string) => void;
  onRetryReference: (characterId: string) => void;
  onPublish: (character: MyCharacter) => void;
  onDelete: (characterId: string) => void;
  onPreview: (character: MyCharacter) => void;
  onActivate: (character: MyCharacter) => void;
  activatingId: string | null;
}

function MyCharacterCard({ character, onUseInStudio, onRetryReference, onPublish, onDelete, onPreview, onActivate, activatingId }: MyCharacterCardProps) {
  const refStatus = getReferenceStatusConfig(character.reference_status);
  const [isHovered, setIsHovered] = useState(false);
  const isActivating = activatingId === character.id;
  const hasVideo = !!character.preview_video_url;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border transition-all duration-300",
        "bg-[#0B0C10]/60 backdrop-blur-md",
        "border-white/10 hover:border-mermaid-pink/30",
        "hover:shadow-2xl hover:shadow-mermaid-pink/10 hover:-translate-y-1",
      )}
    >
      {/* 顶部图片遮罩 */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-transparent to-transparent opacity-90 z-10 pointer-events-none" />
      {/* Image / Video Section */}
      <div
        className="relative aspect-[9/16] overflow-hidden bg-white/5 cursor-pointer"
        onClick={() => onPreview(character)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* 悬浮播放视频 */}
        {isHovered && hasVideo ? (
          <video
            src={character.preview_video_url!}
            autoPlay
            muted
            loop
            playsInline
            className="h-full w-full object-cover transition-transform duration-700"
          />
        ) : character.avatar_url ? (
          <img
            src={character.avatar_url}
            alt={character.name}
            className="h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-110"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Sparkles className="h-16 w-16 text-white/10" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-transparent to-transparent" />

        {/* Top Left: 自建标签 + 参考图状态 */}
        <div className="absolute top-3 left-3 flex flex-col gap-2 z-20">
          <Badge
            variant="outline"
            className="bg-mermaid-pink/10 text-mermaid-pink border-mermaid-pink/20 backdrop-blur-md font-medium"
          >
            🎨 自建
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "backdrop-blur-md border font-medium flex items-center gap-1.5",
              refStatus.canUse
                ? "bg-neon-green/10 text-neon-green border-neon-green/20"
                : character.reference_status === "pending"
                  ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
                  : character.reference_status === "failed"
                    ? "bg-neon-red/10 text-neon-red border-neon-red/20"
                    : "bg-white/5 text-white/50 border-white/10"
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", refStatus.dot)} />
            {refStatus.text}
          </Badge>
        </div>

        {/* Top Right: 已发布标记 */}
        {character.is_public && (
          <div className="absolute top-3 right-3 z-20">
            <Badge className="bg-mermaid-cyan/20 text-mermaid-cyan border-mermaid-cyan/20 backdrop-blur-md">
              📢 已发布
            </Badge>
          </div>
        )}

        {/* Bottom Content */}
        <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
          <div className="p-4 pt-12 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/90 to-transparent">
            <h3 className="text-xl font-bold text-white tracking-tight group-hover:text-mermaid-pink transition-colors duration-300 relative z-30 pointer-events-auto">{character.name}</h3>
            <p className="text-sm text-white/70 font-medium relative z-30 pointer-events-auto">{character.character_type}</p>

            {character.style_tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 relative z-30 pointer-events-auto">
                {character.style_tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-white/10 text-white/90 backdrop-blur-sm border border-white/5">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右下角活化角标 */}
        {!hasVideo && !isActivating && character.reference_status === "completed" && (
          <button
            onClick={(e) => { e.stopPropagation(); onActivate(character); }}
            className="absolute bottom-14 right-3 z-30 px-3 py-1.5 rounded-full text-xs font-bold text-white flex items-center gap-1.5 transition-all duration-300 hover:scale-105 hover:shadow-lg cursor-pointer"
            style={{
              background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
              boxShadow: '0 2px 12px rgba(139, 92, 246, 0.4)',
            }}
          >
            ✨ 活化角色
          </button>
        )}
        {isActivating && (
          <div
            className="absolute bottom-14 right-3 z-30 px-3 py-1.5 rounded-full text-xs font-bold text-white/80 flex items-center gap-1.5"
            style={{
              background: 'linear-gradient(135deg, #8B5CF6AA, #EC4899AA)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1.5s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            活化中...
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="relative z-20 p-4 space-y-3 -mt-1.5 bg-gradient-to-b from-[#0B0C10] to-transparent">
        {/* 永久 + 创建时间 */}
        <div className="flex items-center justify-between text-sm">
          <Badge variant="outline" className="bg-white/5 text-white/60 border-white/10">
            ✴️ 永久
          </Badge>
          <span className="text-xs text-white/40">
            {new Date(character.created_at).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={() => onUseInStudio(character.id)}
            disabled={!refStatus.canUse && character.reference_status !== "none"}
            className={cn(
              "flex-1 relative overflow-hidden group/btn font-bold transition-all duration-300",
              refStatus.canUse
                ? "bg-white/5 border border-white/10 hover:border-mermaid-pink/50 text-white hover:shadow-[0_0_20px_rgba(236,72,153,0.2)]"
                : "bg-white/5 border border-white/5 text-white/30 cursor-not-allowed"
            )}
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Zap className="h-4 w-4" />
              去创作
            </span>
          </Button>

          {/* 重试参考图 */}
          {character.reference_status === "failed" && (
            <Button
              variant="outline"
              onClick={() => onRetryReference(character.id)}
              className="border-neon-red/30 text-neon-red hover:bg-neon-red/10 hover:border-neon-red/50"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}

          {/* 发布 / 下架 */}
          <Button
            variant="outline"
            onClick={() => onPublish(character)}
            className="border-white/10 text-white/50 hover:bg-white/10 hover:text-white hover:border-white/30"
          >
            {character.is_public ? <span className="text-xs">下架</span> : <span className="text-xs">发布</span>}
          </Button>
        </div>
      </div>

      {/* 删除 — 卡片右上角，hover 时显示 */}
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => { e.stopPropagation(); onDelete(character.id); }}
        className="absolute top-2 right-2 z-20 h-7 w-7 opacity-30 hover:opacity-100 transition-opacity duration-300 text-white/50 hover:text-red-400 hover:bg-black/50 rounded-full backdrop-blur-sm"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
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
  const [myCharacters, setMyCharacters] = useState<MyCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<HiredModel | null>(null);
  const [renewPeriod, setRenewPeriod] = useState("monthly");
  const [isRenewing, setIsRenewing] = useState(false);
  // 发布弹窗状态
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<MyCharacter | null>(null);
  const [publishPrice, setPublishPrice] = useState(100);
  const [isPublishing, setIsPublishing] = useState(false);
  const [userId, setUserId] = useState("");
  const [previewCharacter, setPreviewCharacter] = useState<MyCharacter | null>(null);
  // 删除确认弹窗状态
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // 活化角色状态
  const [activatingId, setActivatingId] = useState<string | null>(null);

  // 获取当前用户 ID（通过 session 认证）
  useEffect(() => {
    fetch("/api/user/credits")
      .then((res) => res.json())
      .then((data) => {
        if (data.userId) setUserId(data.userId);
      })
      .catch((err) => console.error("[Team] Failed to get userId:", err));
  }, []);

  // Fetch hired models - 使用 /api/contracts API
  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch("/api/contracts?status=active");
      const result = await response.json();

      if (result.success && result.data) {
        const hiredModels: HiredModel[] = result.data
          .filter((contract: any) => contract.ai_models)
          .map((contract: any) => {
            const model = contract.ai_models;
            const endDate = new Date(contract.end_date);
            const now = new Date();
            const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

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

        const sorted = hiredModels.sort((a, b) => a.days_remaining - b.days_remaining);
        setModels(sorted);
      } else {
        setModels([]);
      }
    } catch (error) {
      console.error("[Team Page] Hired models error:", error);
      setModels([]);
    }
  }, []);

  // Fetch self-created characters - 独立查询
  const fetchMyCharacters = useCallback(async () => {
    try {
      if (!userId) return;

      const response = await fetch(`/api/characters?userId=${userId}`);
      const result = await response.json();

      if (result.success && result.data) {
        // 安全解析 style_tags（可能是 text[] 或 JSON string）
        const parsed = (result.data as any[]).map((ch: any) => {
          let tags: string[] = [];
          if (ch.style_tags) {
            if (typeof ch.style_tags === "string") {
              try { tags = JSON.parse(ch.style_tags); } catch { tags = [ch.style_tags]; }
            } else if (Array.isArray(ch.style_tags)) {
              tags = ch.style_tags;
            }
          }
          return { ...ch, style_tags: tags };
        });
        setMyCharacters(parsed);
      } else {
        setMyCharacters([]);
      }
    } catch (error) {
      console.error("[Team Page] My characters error:", error);
      setMyCharacters([]);
    }
  }, [userId]);

  // Unified data load
  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchModels(), fetchMyCharacters()]);
    setLoading(false);
  }, [fetchModels, fetchMyCharacters]);

  // Initial load
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Handle "Use in Studio"
  const handleUseInStudio = (id: string) => {
    router.push(`/quick-gen?modelId=${id}`);
  };

  // Handle refresh
  const handleRefresh = () => {
    fetchAll();
  };

  // Handle retry reference image
  const handleRetryReference = async (characterId: string) => {
    try {
      const response = await fetch("/api/characters/retry-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      const result = await response.json();
      if (result.success) {
        toast({ title: "🔄 参考图正在重新生成" });
        fetchMyCharacters();
      } else {
        toast({ variant: "destructive", title: "重试失败", description: result.error });
      }
    } catch {
      toast({ variant: "destructive", title: "网络错误" });
    }
  };

  // Handle publish - 打开发布弹窗
  const handlePublish = (character: MyCharacter) => {
    if (character.is_public) {
      // 已发布 → 下架
      handleUnpublish(character.id);
    } else {
      // 未发布 → 打开设价弹窗
      setPublishTarget(character);
      setPublishPrice(character.publish_price || 100);
      setPublishDialogOpen(true);
    }
  };

  // Handle confirm publish
  const handleConfirmPublish = async () => {
    if (!publishTarget) return;
    setIsPublishing(true);
    try {

      const response = await fetch("/api/characters/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: publishTarget.id, price: publishPrice, userId }),
      });
      const result = await response.json();
      if (result.success) {
        toast({ title: "📢 发布成功", description: `${publishTarget.name} 已发布到角色市场，定价 ${publishPrice} 积分` });
        setPublishDialogOpen(false);
        fetchMyCharacters();
      } else {
        toast({ variant: "destructive", title: "发布失败", description: result.error });
      }
    } catch {
      toast({ variant: "destructive", title: "网络错误" });
    } finally {
      setIsPublishing(false);
    }
  };

  // Handle unpublish
  const handleUnpublish = async (characterId: string) => {
    if (!confirm("确定要从广场下架这个角色吗？")) return;
    try {

      const response = await fetch(`/api/characters/publish?characterId=${characterId}&userId=${userId}`, { method: "DELETE" });
      const result = await response.json();
      if (result.success) {
        toast({ title: "✅ 已从广场下架" });
        fetchMyCharacters();
      } else {
        toast({ variant: "destructive", title: "下架失败", description: result.error });
      }
    } catch {
      toast({ variant: "destructive", title: "网络错误" });
    }
  };

  // Handle delete — 打开确认弹窗
  const handleDelete = (characterId: string) => {
    setDeleteTargetId(characterId);
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    const characterId = deleteTargetId;
    setDeleteTargetId(null);
    try {
      const response = await fetch(`/api/characters?id=${characterId}&userId=${userId}`, { method: "DELETE" });
      const result = await response.json();
      if (result.success) {
        toast({ title: "✅ 角色已删除" });
        fetchMyCharacters();
      } else {
        toast({ variant: "destructive", title: "删除失败", description: result.error });
      }
    } catch {
      toast({ variant: "destructive", title: "网络错误" });
    }
  };

  // Handle activate character (生成视频)
  const handleActivate = async (character: MyCharacter) => {
    if (activatingId) {
      toast({ variant: "destructive", title: "请等待当前角色活化完成" });
      return;
    }
    if (!character.reference_sheet_url) {
      toast({ variant: "destructive", title: "该角色尚无多角度参考图，无法活化" });
      return;
    }

    setActivatingId(character.id);
    // Prompt 基于参考图 — 角色展示/打招呼，风格匹配原图
    const activatePrompt = `Reference this multi-view character sheet to accurately recreate the character's appearance, outfit, and style. Match the art style and visual tone of the original image. Animate the character in a lively, expressive showcase — natural movement, genuine charm, as if greeting someone they're happy to see. Cinematic lighting, smooth animation, 4K.`;

    try {
      const res = await fetch("/api/characters/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceImageUrl: character.reference_sheet_url,
          prompt: activatePrompt,
          userId,
          characterId: character.id,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.taskId) {
        toast({ variant: "destructive", title: "活化失败", description: data.error || "提交失败" });
        setActivatingId(null);
        return;
      }

      // 轮询视频状态
      let pollCount = 0;
      const poll = async () => {
        pollCount++;
        try {
          const r = await fetch(`/api/characters/activate?taskId=${data.taskId}&characterId=${character.id}`);
          const d = await r.json();
          if (d.success && d.task?.status === "completed" && d.task.resultUrl) {
            toast({ title: "🎬 角色活化成功！", description: `${character.name} 已生成动态视频` });
            setActivatingId(null);
            fetchMyCharacters();
            return;
          }
          if (d.task?.status === "failed" || pollCount >= 120) {
            const errMsg = d.task?.errorMessage || "视频生成失败，请重试";
            toast({ variant: "destructive", title: "活化失败", description: errMsg });
            setActivatingId(null);
            return;
          }
        } catch { /* 网络波动，继续轮询 */ }
        setTimeout(poll, 3000);
      };
      poll();
    } catch {
      toast({ variant: "destructive", title: "网络错误" });
      setActivatingId(null);
    }
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
  const totalCharacters = myCharacters.length;
  const expiringModels = models.filter(m => m.days_remaining <= 3).length;
  const totalGenerations = models.reduce((sum, m) => sum + m.total_generations, 0);
  const hasAnyContent = totalModels > 0 || totalCharacters > 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-mermaid-lime to-mermaid-cyan shadow-[0_0_10px_rgba(0,242,234,0.5)]" />
            <span className="text-white drop-shadow-lg">我的角色</span>
          </h1>
          <p className="mt-2 text-white/60">
            管理您的自建角色和签约角色
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
            onClick={() => router.push("/character/create")}
            className="relative rounded-full font-bold text-black transition-all duration-500 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.5)] border border-white/20 overflow-hidden group shadow-[0_0_20px_rgba(0,242,234,0.2)]"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
            <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] opacity-0 group-hover:opacity-100 group-hover:animate-shimmer transition-opacity duration-300" />
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Plus className="mr-2 h-4 w-4" />
              创建角色
            </span>
          </Button>
          <Button
            onClick={() => router.push("/models")}
            variant="outline"
            className="rounded-full border-white/10 text-white/70 hover:border-white/30 hover:text-white"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            浏览广场
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card variant="glass" className="group hover:border-mermaid-cyan/30 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 shadow-inner group-hover:bg-mermaid-cyan/10 group-hover:text-mermaid-cyan transition-colors">
              <UserCheck className="h-7 w-7 text-white/70 group-hover:text-mermaid-cyan transition-colors" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white tracking-tight group-hover:text-mermaid-cyan transition-colors">{totalCharacters + totalModels}</p>
              <p className="text-sm text-white/60">全部角色 (自建 {totalCharacters} / 签约 {totalModels})</p>
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
      ) : !hasAnyContent ? (
        <EmptyState />
      ) : (
        <>
          {/* 自建角色 */}
          {myCharacters.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="h-5 w-1 rounded-full bg-mermaid-pink" />
                🎨 我的角色 <span className="text-white/40 font-normal text-sm">({myCharacters.length})</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
                {myCharacters.map((char) => (
                  <MyCharacterCard
                    key={char.id}
                    character={char}
                    onUseInStudio={handleUseInStudio}
                    onRetryReference={handleRetryReference}
                    onPublish={handlePublish}
                    onDelete={handleDelete}
                    onPreview={setPreviewCharacter}
                    onActivate={handleActivate}
                    activatingId={activatingId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 签约角色 */}
          {models.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="h-5 w-1 rounded-full bg-mermaid-cyan" />
                🤝 签约角色 <span className="text-white/40 font-normal text-sm">({models.length})</span>
              </h2>
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
            </div>
          )}
        </>
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
              续约角色
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

      {/* Publish Dialog */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent className="bg-background border-border/50 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              📢 发布角色到广场
            </DialogTitle>
            <DialogDescription>
              设置 {publishTarget?.name} 的聘用价格（积分），其他用户聘用后积分将 100% 转入你的账户。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {publishTarget && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <div className="h-12 w-12 rounded-lg overflow-hidden bg-gradient-to-br from-blue-500/20 to-mermaid-pink/20">
                  {publishTarget.avatar_url ? (
                    <img src={publishTarget.avatar_url} alt={publishTarget.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <Sparkles className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="font-medium">{publishTarget.name}</p>
                  <p className="text-sm text-muted-foreground">{publishTarget.character_type}</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-white/70">聘用价格（积分）</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={99999}
                  value={publishPrice}
                  onChange={(e) => setPublishPrice(Math.max(0, parseInt(e.target.value) || 0))}
                  className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-center text-lg font-bold focus:outline-none focus:border-mermaid-cyan/50"
                />
                <span className="text-sm text-white/50">积分</span>
              </div>
              <p className="text-xs text-white/40">每次被聘用，你将获得 {publishPrice} 积分收益</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishDialogOpen(false)} className="border-white/10">
              取消
            </Button>
            <Button
              onClick={handleConfirmPublish}
              disabled={isPublishing || publishPrice < 0}
              className="bg-gradient-to-r from-mermaid-cyan to-mermaid-pink text-black font-bold"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  发布中...
                </>
              ) : (
                "确认发布"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={!!deleteTargetId} onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}>
        <DialogContent className="bg-background border-border/50 max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除这个角色吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 角色预览弹窗 */}
      {previewCharacter && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewCharacter(null)}
        >
          <div
            className="relative max-w-5xl max-h-[90vh] w-full mx-4 rounded-2xl overflow-hidden bg-[#0B0C10] border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewCharacter(null)}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/60 text-white/70 hover:text-white hover:bg-black/80 flex items-center justify-center transition-colors"
            >
              ✕
            </button>
            <div className="p-4 border-b border-white/10">
              <h3 className="text-lg font-bold text-white">{previewCharacter.name}</h3>
              <p className="text-sm text-white/50">
                {previewCharacter.character_type}
                {previewCharacter.preview_video_url ? ' · 多角度参考图 + 动态视频' : ' · 多角度参考图'}
              </p>
            </div>
            <div className="p-4" style={{ maxHeight: 'calc(90vh - 80px)', overflow: 'auto' }}>
              {previewCharacter.preview_video_url ? (
                /* 有视频：左右分栏 */
                <div className="flex gap-4 items-start">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/40 mb-2">🖼 多角度参考图</p>
                    {previewCharacter.reference_sheet_url ? (
                      <img
                        src={previewCharacter.reference_sheet_url}
                        alt={`${previewCharacter.name} 多角度参考图`}
                        className="w-full object-contain rounded-lg"
                      />
                    ) : previewCharacter.avatar_url ? (
                      <img
                        src={previewCharacter.avatar_url}
                        alt={previewCharacter.name}
                        className="w-full object-contain rounded-lg"
                      />
                    ) : (
                      <div className="text-white/30 text-center py-20">暂无参考图</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/40 mb-2">🎬 动态视频</p>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video
                      src={previewCharacter.preview_video_url}
                      controls
                      autoPlay
                      loop
                      playsInline
                      className="w-full rounded-lg"
                    />
                  </div>
                </div>
              ) : (
                /* 无视频：全屏参考图 */
                <div className="flex items-center justify-center">
                  {previewCharacter.reference_sheet_url ? (
                    <img
                      src={previewCharacter.reference_sheet_url}
                      alt={`${previewCharacter.name} 多角度参考图`}
                      className="max-w-full max-h-[75vh] object-contain rounded-lg"
                    />
                  ) : previewCharacter.avatar_url ? (
                    <img
                      src={previewCharacter.avatar_url}
                      alt={previewCharacter.name}
                      className="max-w-full max-h-[75vh] object-contain rounded-lg"
                    />
                  ) : (
                    <div className="text-white/30 text-center py-20">暂无参考图</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
