"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Coins,
  Calendar,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIModel, RentalPeriod } from "@/types/model";
import { useLang } from "@/contexts/LangContext";

interface HireDialogProps {
  model: AIModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userCredits: number;
  userId?: string; // 用户 ID，用于 Server Action
  onHireSuccess?: (modelId: string, newBalance: number) => void;
}

const rentalOptions: { period: RentalPeriod; label: string; days: number; discount?: string }[] = [
  { period: "daily", label: "1 Day", days: 1 },
  { period: "weekly", label: "7 Days", days: 7, discount: "Save 17%" },
  { period: "monthly", label: "30 Days", days: 30, discount: "Best Value" },
  { period: "yearly", label: "365 Days", days: 365, discount: "Save 17%" },
];

export function HireDialog({
  model,
  open,
  onOpenChange,
  userCredits,
  userId,
  onHireSuccess,
}: HireDialogProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<RentalPeriod>("monthly");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<"success" | "error" | "already_hired" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [newBalance, setNewBalance] = useState<number | null>(null);
  const { lang } = useLang();
  const t = lang === "en";

  if (!model) return null;

  const isCommunityCharacter = model.source === "user_created";
  const communityPrice = model.publish_price ?? model.price_monthly;
  const priceMap: Record<RentalPeriod, number> = isCommunityCharacter ? {
    daily: communityPrice,
    weekly: communityPrice,
    monthly: communityPrice,
    yearly: communityPrice,
  } : {
    daily: model.price_daily,
    weekly: model.price_weekly,
    monthly: model.price_monthly,
    yearly: model.price_yearly,
  };

  const selectedPrice = priceMap[selectedPeriod];
  const canAfford = userCredits >= selectedPrice;
  const selectedOption = rentalOptions.find((o) => o.period === selectedPeriod)!;

  const handleHire = async () => {
    if (!canAfford || !userId) {
      if (!userId) {
        setResult("error");
        setErrorMessage(t ? "Please sign in to contract this character" : "请先登录后再进行签约");
      }
      return;
    }

    setIsProcessing(true);
    setResult(null);
    setErrorMessage("");

    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: model.id,
          rental_period: selectedPeriod,
        }),
      });
      const response = await res.json();

      if (response.success) {
        setResult("success");
        setNewBalance(response.new_balance);

        // 通知父组件
        if (onHireSuccess) {
          onHireSuccess(model.id, response.new_balance);
        }

        // 2秒后关闭
        setTimeout(() => {
          handleClose();
        }, 2000);
      } else {
        // 处理特定错误类型
        if (response.errorCode === "ALREADY_HIRED" || /已有有效合约|已在您的团队/.test(response.error || "")) {
          setResult("already_hired");
          setErrorMessage(response.error || (t ? "Character already in your team" : "该模特已在您的团队中"));
        } else if (response.errorCode === "INSUFFICIENT_BALANCE" || /积分不足|余额不足/.test(response.error || "")) {
          setResult("error");
          setErrorMessage(response.error || (t ? "Insufficient credits" : "余额不足"));
        } else {
          setResult("error");
          setErrorMessage(response.error || (t ? "Contract failed, please retry" : "签约失败，请重试"));
        }
      }
    } catch (error) {
      console.error("[HireDialog] Error:", error);
      setResult("error");
      setErrorMessage(error instanceof Error ? error.message : (t ? "Network error, please retry" : "网络错误，请重试"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (isProcessing) return;
    setResult(null);
    setErrorMessage("");
    setNewBalance(null);
    setSelectedPeriod("monthly");
    onOpenChange(false);
  };

  const handleGoToTeam = () => {
    window.location.href = "/models?tab=my";
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] bg-black/80 border-white/10 backdrop-blur-xl shadow-2xl shadow-mermaid-cyan/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Sparkles className="h-5 w-5 text-mermaid-cyan drop-shadow-[0_0_5px_rgba(0,242,234,0.5)]" />
            授权引用 {model.name}
          </DialogTitle>
          <DialogDescription>
            确认积分价格后即可在创作中引用该角色
          </DialogDescription>
        </DialogHeader>

        {/* Success State */}
        {result === "success" && (
          <div className="py-8">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 ring-4 ring-emerald-500/10">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Welcome to the Team! 🎉</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {model.name} has joined your creative team
                </p>
              </div>
              {newBalance !== null && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5">
                  <Coins className="h-4 w-4 text-tiktok-cyan" />
                  <span className="text-sm">
                    Remaining Balance: <span className="font-bold">{newBalance.toLocaleString()}</span> Credits
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Already Hired State */}
        {result === "already_hired" && (
          <div className="py-8">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20 ring-4 ring-amber-500/10">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Already in Team</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  {errorMessage}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setResult(null)}>
                  Select Another
                </Button>
                <Button
                  onClick={handleGoToTeam}
                  className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black"
                >
                  Go to My Team
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {result === "error" && (
          <div className="py-8">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20 ring-4 ring-red-500/10">
                <AlertCircle className="h-8 w-8 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Transaction Failed</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  {errorMessage}
                </p>
              </div>
              <Button variant="outline" onClick={() => setResult(null)}>
                Try Again
              </Button>
            </div>
          </div>
        )}

        {/* Form */}
        {!result && (
          <>
            {/* Model Preview */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
              <div className="h-16 w-16 rounded-xl overflow-hidden bg-gradient-to-br from-mermaid-cyan/20 to-mermaid-pink/20 flex-shrink-0">
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
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{model.name}</h3>
                <p className="text-sm text-muted-foreground">{model.category}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {model.style_tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 text-xs rounded bg-white/10 text-white/70"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Rental Period Selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Select Rental Period</label>
              <div className="grid grid-cols-2 gap-2">
                {rentalOptions.map((option) => {
                  const price = priceMap[option.period];
                  const isSelected = selectedPeriod === option.period;
                  const isAffordable = userCredits >= price;

                  return (
                    <button
                      key={option.period}
                      onClick={() => setSelectedPeriod(option.period)}
                      disabled={!isAffordable}
                      className={cn(
                        "relative p-3 rounded-xl border text-left transition-all duration-300 group overflow-hidden",
                        isSelected
                          ? "border-mermaid-cyan bg-mermaid-cyan/10 shadow-[0_0_20px_rgba(0,242,234,0.2)]"
                          : "border-white/10 hover:border-mermaid-cyan/50 hover:bg-white/5",
                        !isAffordable && "opacity-50 cursor-not-allowed grayscale"
                      )}
                    >
                      {option.discount && !isCommunityCharacter && (
                        <span className={cn(
                          "absolute -top-2 right-2 px-2 py-0.5 text-xs font-bold rounded-full shadow-lg",
                          option.period === "monthly"
                            ? "bg-gradient-to-r from-mermaid-cyan to-mermaid-pink text-black shadow-[0_0_10px_rgba(0,242,234,0.3)]"
                            : "bg-neon-green/20 text-neon-green border border-neon-green/30"
                        )}>
                          {option.discount}
                        </span>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{option.label}</span>
                        <span className={cn(
                          "text-sm font-bold",
                          isSelected ? "text-tiktok-cyan" : "text-muted-foreground"
                        )}>
                          {price.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs text-white/40 group-hover:text-white/60 transition-colors">
                        <Coins className="h-3 w-3" />
                        Credits
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="space-y-3 p-4 rounded-xl bg-black/40 border border-white/5 backdrop-blur-md">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Coins className="h-4 w-4" />
                  Your Balance
                </span>
                <span className="font-semibold">{userCredits.toLocaleString()} Credits</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Duration
                </span>
                <span className="font-semibold">{selectedOption.days} Days</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Expires On
                </span>
                <span className="font-semibold">
                  {new Date(Date.now() + selectedOption.days * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className="border-t border-border/50 pt-3 mt-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">Total</span>
                  <span className="text-xl font-bold bg-gradient-to-r from-mermaid-cyan to-mermaid-pink bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(0,242,234,0.5)]">
                    {selectedPrice.toLocaleString()} Credits
                  </span>
                </div>
                {!canAfford && (
                  <p className="text-xs text-neon-red mt-2 flex items-center gap-1 drop-shadow-[0_0_5px_rgba(239,68,68,0.5)]">
                    <AlertCircle className="h-3 w-3" />
                    Insufficient balance. Need {(selectedPrice - userCredits).toLocaleString()} more Credits
                  </p>
                )}
                {canAfford && (
                  <p className="text-xs text-neon-green mt-2 flex items-center gap-1 drop-shadow-[0_0_5px_rgba(34,197,94,0.5)]">
                    <CheckCircle2 className="h-3 w-3" />
                    Balance after: {(userCredits - selectedPrice).toLocaleString()} Credits
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        {!result && (
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isProcessing}
              className="border-white/10 hover:bg-white/10 text-white/70 hover:text-white"
            >
              Cancel
            </Button>
            <button
              onClick={handleHire}
              disabled={!canAfford || isProcessing || !userId}
              className="relative min-w-[140px] px-6 py-3 rounded-full font-bold text-black text-sm transition-all duration-500 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,242,234,0.5)] border border-white/20 overflow-hidden group/btn shadow-[0_0_20px_rgba(0,242,234,0.2)] disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent" />
              <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.4),transparent)] bg-[length:200%_100%] opacity-0 group-hover/btn:opacity-100 group-hover/btn:animate-shimmer transition-opacity duration-300" />

              {isProcessing ? (
                <div className="relative z-10 flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-black" />
                  Processing...
                </div>
              ) : (
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <Sparkles className="h-4 w-4 fill-black/20" />
                  Confirm Hire
                </span>
              )}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
