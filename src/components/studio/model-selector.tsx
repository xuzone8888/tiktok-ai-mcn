"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIModel, Contract } from "@/types/model";

interface ContractWithModel extends Contract {
  ai_models: AIModel | null;
}

interface ModelSelectorProps {
  selectedModel: ContractWithModel | null;
  onSelect: (contract: ContractWithModel) => void;
  onGoToMarket: () => void;
}

function getDaysRemaining(endDate: string): number {
  const end = new Date(endDate);
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function ModelSelector({ selectedModel, onSelect, onGoToMarket }: ModelSelectorProps) {
  const [contracts, setContracts] = useState<ContractWithModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/contracts?status=active&include_model=true");
      if (response.ok) {
        const data = await response.json();
        setContracts(data);
      }
    } catch (error) {
      console.error("Failed to fetch contracts:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-tiktok-cyan" />
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20 mb-4">
          <Users className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">暂无签约模特</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          您需要先签约一位 AI 模特才能开始创作内容
        </p>
        <Button
          onClick={onGoToMarket}
          className="mt-4 bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          前往模特市场
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-4">
        选择一位已签约的 AI 模特来创作内容
      </p>
      
      <div className="grid gap-3 sm:grid-cols-2">
        {contracts.map((contract) => {
          const model = contract.ai_models;
          if (!model) return null;

          const isSelected = selectedModel?.id === contract.id;
          const daysRemaining = getDaysRemaining(contract.end_date);
          const isExpiring = daysRemaining <= 3;

          return (
            <button
              key={contract.id}
              onClick={() => onSelect(contract)}
              className={cn(
                "relative flex items-center gap-4 p-4 rounded-xl border text-left transition-all duration-200",
                isSelected
                  ? "border-tiktok-cyan bg-tiktok-cyan/10 ring-2 ring-tiktok-cyan/30"
                  : "border-border/50 hover:border-tiktok-cyan/30 hover:bg-white/5"
              )}
            >
              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute top-2 right-2">
                  <CheckCircle2 className="h-5 w-5 text-tiktok-cyan" />
                </div>
              )}

              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="h-14 w-14 rounded-xl overflow-hidden bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20">
                  {model.avatar_url ? (
                    <img
                      src={model.avatar_url}
                      alt={model.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <Sparkles className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </div>
                {/* Status dot */}
                <div className={cn(
                  "absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-card",
                  isExpiring ? "bg-red-500" : "bg-emerald-500"
                )} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold truncate">{model.name}</h4>
                <p className="text-xs text-muted-foreground">{model.category}</p>
                <div className="flex items-center gap-1 mt-1 text-xs">
                  {isExpiring ? (
                    <span className="flex items-center gap-1 text-red-500">
                      <AlertTriangle className="h-3 w-3" />
                      {daysRemaining}天后过期
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      剩余 {daysRemaining} 天
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}



