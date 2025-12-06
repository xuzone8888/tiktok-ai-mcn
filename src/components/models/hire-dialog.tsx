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
import { hireModel } from "@/lib/actions/contracts";
import type { AIModel, RentalPeriod } from "@/types/model";

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

  if (!model) return null;

  const priceMap: Record<RentalPeriod, number> = {
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
        setErrorMessage("请先登录后再进行签约");
      }
      return;
    }

    setIsProcessing(true);
    setResult(null);
    setErrorMessage("");

    try {
      // 调用 Server Action
      const response = await hireModel({
        modelId: model.id,
        userId: userId,
        rentalPeriod: selectedPeriod,
      });

      if (response.success && response.data) {
        setResult("success");
        setNewBalance(response.data.newBalance);
        
        // 通知父组件
        if (onHireSuccess) {
          onHireSuccess(model.id, response.data.newBalance);
        }

        // 2秒后关闭
        setTimeout(() => {
          handleClose();
        }, 2000);
      } else {
        // 处理特定错误类型
        if (response.errorCode === "ALREADY_HIRED") {
          setResult("already_hired");
          setErrorMessage(response.error || "该模特已在您的团队中");
        } else if (response.errorCode === "INSUFFICIENT_BALANCE") {
          setResult("error");
          setErrorMessage(response.error || "余额不足");
        } else {
          setResult("error");
          setErrorMessage(response.error || "签约失败，请重试");
        }
      }
    } catch (error) {
      console.error("[HireDialog] Error:", error);
      setResult("error");
      setErrorMessage(error instanceof Error ? error.message : "网络错误，请重试");
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
    window.location.href = "/team";
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] bg-card border-border/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-tiktok-cyan" />
            Hire {model.name}
          </DialogTitle>
          <DialogDescription>
            Select a rental period and confirm payment
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
            <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-white/5 to-white/[0.02] border border-border/50">
              <div className="h-16 w-16 rounded-xl overflow-hidden bg-gradient-to-br from-tiktok-cyan/20 to-tiktok-pink/20 flex-shrink-0">
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
                        "relative p-3 rounded-xl border text-left transition-all",
                        isSelected
                          ? "border-tiktok-cyan bg-tiktok-cyan/10 shadow-lg shadow-tiktok-cyan/5"
                          : "border-border/50 hover:border-border hover:bg-white/5",
                        !isAffordable && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {option.discount && (
                        <span className={cn(
                          "absolute -top-2 right-2 px-2 py-0.5 text-xs font-medium rounded-full",
                          option.period === "monthly" 
                            ? "bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black"
                            : "bg-emerald-500/20 text-emerald-400"
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
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Coins className="h-3 w-3" />
                        Credits
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="space-y-3 p-4 rounded-xl bg-gradient-to-b from-white/5 to-transparent border border-border/50">
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
                  <span className="font-medium">Total</span>
                  <span className="text-xl font-bold bg-gradient-to-r from-tiktok-cyan to-tiktok-pink bg-clip-text text-transparent">
                    {selectedPrice.toLocaleString()} Credits
                  </span>
                </div>
                {!canAfford && (
                  <p className="text-xs text-red-400 mt-2 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Insufficient balance. Need {(selectedPrice - userCredits).toLocaleString()} more Credits
                  </p>
                )}
                {canAfford && (
                  <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
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
              className="border-border/50"
            >
              Cancel
            </Button>
            <Button
              onClick={handleHire}
              disabled={!canAfford || isProcessing || !userId}
              className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink text-black font-semibold hover:opacity-90 min-w-[120px]"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Confirm Hire
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
