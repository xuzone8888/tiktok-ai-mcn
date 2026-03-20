"use client";

/**
 * 统一角色选择组件
 *
 * 展示用户的自建角色 + 签约角色，支持搜索/筛选
 * variant: dialog（弹窗选择）| inline（内嵌面板）| cards（卡片网格）
 */

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Search,
  Sparkles,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isCharacterReady, type CharacterInput } from "@/lib/character-adapter";

// ============================================================================
// Types
// ============================================================================

export interface CharacterOption {
  id: string;
  name: string;
  avatar_url: string | null;
  description?: string | null;
  category: string;
  tags: string[];
  source: "official" | "user_created";
  reference_sheet_url?: string | null;
  reference_status?: string;
  trigger_word?: string | null;
  is_hired?: boolean;
  days_remaining?: number;
  contract_status?: string;
}

interface CharacterPickerProps {
  /** "dialog" | "inline" | "cards" | "compact" */
  variant?: "dialog" | "inline" | "cards" | "compact";
  /** 数据源过滤: hired=签约模特(Sora用), user_created=自建角色(Veo3用), all=全部 */
  dataSource?: "all" | "hired" | "user_created";
  /** 当前选中的角色 ID */
  selectedId?: string | null;
  /** 选中角色回调 */
  onSelect: (character: CharacterOption | null) => void;
  /** dialog 模式: 是否打开 */
  open?: boolean;
  /** dialog 模式: 关闭回调 */
  onOpenChange?: (open: boolean) => void;
  /** 外部传入的角色列表（避免重复请求） */
  characters?: CharacterOption[];
  /** 是否显示清除选择按钮 */
  allowClear?: boolean;
  /** 标题 */
  title?: string;
  /** 占位提示文字 */
  placeholder?: string;
  /** 最大高度 */
  maxHeight?: string;
}

// ============================================================================
// Character Card (内部组件)
// ============================================================================

const CharacterCard = memo(function CharacterCard({
  character,
  isSelected,
  onSelect,
}: {
  character: CharacterOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const charInput: CharacterInput = {
    id: character.id,
    name: character.name,
    description: character.description,
    trigger_word: character.trigger_word,
    reference_sheet_url: character.reference_sheet_url,
    reference_status: character.reference_status,
    source: character.source,
  };
  const ready = isCharacterReady(charInput);

  const statusIcon = (() => {
    switch (character.reference_status) {
      case "completed": return <CheckCircle2 className="h-3 w-3 text-green-400" />;
      case "pending": return <Clock className="h-3 w-3 text-amber-400 animate-pulse" />;
      case "failed": return <AlertCircle className="h-3 w-3 text-red-400" />;
      default: return null;
    }
  })();

  return (
    <button
      onClick={onSelect}
      disabled={!ready}
      className={cn(
        "relative flex items-center gap-3 p-3 rounded-xl border transition-all text-left w-full",
        isSelected
          ? "border-mermaid-cyan/50 bg-mermaid-cyan/10 shadow-[0_0_15px_rgba(0,242,234,0.15)]"
          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8",
        !ready && "opacity-40 cursor-not-allowed"
      )}
    >
      {/* Avatar */}
      <div className="h-10 w-10 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
        {character.avatar_url ? (
          <img src={character.avatar_url} alt={character.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-white/30" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-white truncate">{character.name}</span>
          {statusIcon}
          {character.source === "user_created" && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-500/20 text-blue-300 border-0">
              自建
            </Badge>
          )}
        </div>
        <p className="text-xs text-white/50 truncate mt-0.5">
          {character.category}
          {character.days_remaining != null && character.source !== "user_created" && (
            <span className="ml-1.5 text-white/30">· 剩余{character.days_remaining}天</span>
          )}
        </p>
      </div>

      {/* Selected indicator */}
      {isSelected && (
        <CheckCircle2 className="h-5 w-5 text-mermaid-cyan flex-shrink-0" />
      )}
    </button>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export function CharacterPicker({
  variant = "inline",
  dataSource = "all",
  selectedId,
  onSelect,
  open,
  onOpenChange,
  characters: externalCharacters,
  allowClear = true,
  title = "选择角色",
  placeholder = "搜索角色名称...",
  maxHeight = "360px",
}: CharacterPickerProps) {
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [compactOpen, setCompactOpen] = useState(false); // compact variant 内部管理

  // Fetch characters if not provided externally
  const fetchCharacters = useCallback(async () => {
    if (externalCharacters) {
      setCharacters(externalCharacters);
      return;
    }

    setLoading(true);
    try {
      // 获取签约模特（dataSource !== "user_created" 时才请求）
      let opts: CharacterOption[] = [];
      if (dataSource !== "user_created") {
        const response = await fetch("/api/contracts?status=active");
        const result = await response.json();

        if (result.success && result.data) {
          opts = result.data.map((contract: any) => {
            const model = contract.ai_models;
            if (!model) return null;
            const endDate = new Date(contract.end_date);
            const now = new Date();
            const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

            return {
              id: model.id,
              name: model.name,
              avatar_url: model.avatar_url,
              description: model.description,
              category: model.category || "general",
              tags: Array.isArray(model.style_tags) ? model.style_tags : [],
              source: model.source || "official",
              reference_sheet_url: model.reference_sheet_url,
              reference_status: model.reference_status || "none",
              trigger_word: model.trigger_word,
              is_hired: true,
              days_remaining: daysRemaining,
              contract_status: contract.status,
            } as CharacterOption;
          }).filter(Boolean);
        }
      }

      // 获取自建角色（dataSource !== "hired" 时才请求）
      let ownChars: CharacterOption[] = [];
      if (dataSource !== "hired") {
        const userDataStr = localStorage.getItem("user-data");
        let userId = "";
        if (userDataStr) {
          try { const u = JSON.parse(userDataStr); userId = u?.id || u?.user?.id || ""; } catch { /* */ }
        }
        if (userId) {
          const charRes = await fetch("/api/characters?userId=" + userId);
          const charResult = await charRes.json();
          if (charResult.success && charResult.data) {
            ownChars = charResult.data.map((ch: any) => ({
              id: ch.id,
              name: ch.name,
              avatar_url: ch.avatar_url,
              description: ch.description,
              category: ch.character_type || "general",
              tags: Array.isArray(ch.style_tags) ? ch.style_tags : [],
              source: "user_created" as const,
              reference_sheet_url: ch.reference_sheet_url,
              reference_status: ch.reference_status || "none",
              trigger_word: null,
              is_hired: false,
              contract_status: "permanent",
            }));
          }
        }
      }

      // 根据 dataSource 组合最终列表
      let finalList: CharacterOption[];
      if (dataSource === "hired") {
        finalList = opts;
      } else if (dataSource === "user_created") {
        finalList = ownChars;
      } else {
        // 全部：自建在前
        finalList = [...ownChars, ...opts];
      }

      setCharacters(finalList);
    } catch (error) {
      console.error("[CharacterPicker] Fetch error:", error);
    } finally {
      setLoading(false);
    }
  }, [externalCharacters, dataSource]);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  // Update when external characters change
  useEffect(() => {
    if (externalCharacters) {
      setCharacters(externalCharacters);
    }
  }, [externalCharacters]);

  // Filter
  const filteredCharacters = useMemo(() => {
    if (!searchQuery.trim()) return characters;
    const q = searchQuery.toLowerCase();
    return characters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [characters, searchQuery]);

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === selectedId) || null,
    [characters, selectedId]
  );

  // --- List content ---
  const listContent = (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 h-9"
        />
      </div>

      {/* Clear selection */}
      {allowClear && selectedId && (
        <button
          onClick={() => onSelect(null)}
          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          <X className="h-3 w-3" />
          清除选择
        </button>
      )}

      {/* List */}
      <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight }}>
        {loading ? (
          <div className="py-8 text-center text-white/40 text-sm">加载中...</div>
        ) : filteredCharacters.length === 0 ? (
          <div className="py-8 text-center text-white/40 text-sm">
            {searchQuery ? "无匹配角色" : "暂无可用角色"}
          </div>
        ) : (
          filteredCharacters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              isSelected={selectedId === character.id}
              onSelect={() => {
                onSelect(character);
                if (variant === "dialog" && onOpenChange) {
                  onOpenChange(false);
                }
              }}
            />
          ))
        )}
      </div>
    </div>
  );

  // --- Compact variant --- (按钮组 + 精简小弹窗)
  if (variant === "compact") {
    const readyCharacters = characters.filter((c) => {
      const charInput: CharacterInput = {
        id: c.id, name: c.name, description: c.description,
        trigger_word: c.trigger_word, reference_sheet_url: c.reference_sheet_url,
        reference_status: c.reference_status, source: c.source,
      };
      return isCharacterReady(charInput);
    });

    return (
      <>
        {/* 触发按钮 */}
        {selectedCharacter ? (
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-mermaid-pink/10 border border-mermaid-pink/20">
            <button
              onClick={() => setCompactOpen(true)}
              className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
            >
              <div className="h-8 w-8 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
                {selectedCharacter.avatar_url ? (
                  <img src={selectedCharacter.avatar_url} alt={selectedCharacter.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <Sparkles className="h-3.5 w-3.5 text-white/30" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-white truncate">{selectedCharacter.name}</p>
                <p className="text-[10px] text-mermaid-pink">已选择</p>
              </div>
            </button>
            <button
              onClick={() => onSelect(null)}
              className="h-6 w-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors flex-shrink-0"
            >
              <X className="h-3 w-3 text-white/60" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCompactOpen(true)}
            className="w-full flex items-center gap-2 p-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/20 transition-all text-left"
          >
            <Users className="h-4 w-4 text-mermaid-pink flex-shrink-0" />
            <span className="text-xs text-white/60">选择角色</span>
            <span className="text-[10px] text-white/30 ml-auto">{readyCharacters.length} 可用</span>
          </button>
        )}

        {/* 精简小弹窗 */}
        <Dialog open={compactOpen} onOpenChange={setCompactOpen}>
          <DialogContent className="bg-[#0B0C10]/98 backdrop-blur-2xl border border-white/10 max-w-sm p-0 rounded-2xl overflow-hidden">
            <DialogHeader className="px-4 pt-4 pb-2">
              <DialogTitle className="text-sm font-medium flex items-center gap-2 text-white">
                <Users className="h-4 w-4 text-mermaid-cyan" />
                选择角色
              </DialogTitle>
              <DialogDescription className="text-xs text-white/40">
                点击选择一个角色用于生成
              </DialogDescription>
            </DialogHeader>
            <div className="px-4 pb-4 max-h-[50vh] overflow-y-auto">
              {loading ? (
                <div className="py-8 text-center text-white/40 text-sm">加载中...</div>
              ) : readyCharacters.length === 0 ? (
                <div className="py-8 text-center text-white/40 text-sm">暂无可用角色</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {readyCharacters.map((character) => (
                    <button
                      key={character.id}
                      onClick={() => {
                        onSelect(character);
                        setCompactOpen(false);
                      }}
                      className={cn(
                        "flex items-center gap-2 p-2.5 rounded-xl border transition-all text-left",
                        selectedId === character.id
                          ? "border-mermaid-cyan/50 bg-mermaid-cyan/10"
                          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8"
                      )}
                    >
                      <div className="h-8 w-8 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
                        {character.avatar_url ? (
                          <img src={character.avatar_url} alt={character.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <Sparkles className="h-3 w-3 text-white/30" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-white truncate">{character.name}</p>
                        <p className="text-[10px] text-white/40 truncate">{character.category}</p>
                      </div>
                      {selectedId === character.id && (
                        <CheckCircle2 className="h-4 w-4 text-mermaid-cyan flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // --- Dialog variant ---
  if (variant === "dialog") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-background border-border/50 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-mermaid-cyan" />
              {title}
            </DialogTitle>
            <DialogDescription>
              选择一个角色用于创作，自建角色和签约角色均可使用
            </DialogDescription>
          </DialogHeader>
          {listContent}
        </DialogContent>
      </Dialog>
    );
  }

  // --- Inline / Cards variant ---
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-white/70 flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" />
        {title}
      </h4>
      {listContent}
    </div>
  );
}
