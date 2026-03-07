"use client";

/**
 * 充值中心页面
 * 
 * 展示积分包选项，选择支付方式，发起支付
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  CreditCard,
  Sparkles,
  ShieldCheck,
  Clock,
  Star,
  ChevronRight,
  Loader2,
  History,
} from "lucide-react";
import { PaymentModal } from "@/components/payment/PaymentModal";
import type { PayChannel, CreditPack } from "@/lib/payment/types";
import { DEFAULT_CREDIT_PACKS } from "@/lib/payment/types";

// 支付渠道选项
const PAY_CHANNELS: { id: PayChannel; name: string; icon: string; color: string }[] = [
  { id: "wechat_native", name: "微信支付", icon: "💚", color: "#07C160" },
  { id: "alipay_qr",     name: "支付宝",   icon: "💙", color: "#1677FF" },
];

export default function PricingPage() {
  const router = useRouter();
  const [selectedPack, setSelectedPack] = useState<CreditPack | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<PayChannel>("wechat_native");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 支付弹窗状态
  const [paymentModal, setPaymentModal] = useState<{
    isOpen: boolean;
    orderNo: string;
    payUrl: string;
    amountDisplay: string;
    payChannel: PayChannel;
  }>({
    isOpen: false,
    orderNo: "",
    payUrl: "",
    amountDisplay: "",
    payChannel: "wechat_native",
  });

  // 发起支付
  const handlePurchase = useCallback(async () => {
    if (!selectedPack) {
      setError("请先选择积分包");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack_id: selectedPack.id,
          pay_channel: selectedChannel,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || "创建订单失败");
        return;
      }

      // 打开支付弹窗
      setPaymentModal({
        isOpen: true,
        orderNo: data.order_no,
        payUrl: data.pay_url,
        amountDisplay: data.amount_display,
        payChannel: selectedChannel,
      });
    } catch (err) {
      setError("网络错误，请重试");
    } finally {
      setIsLoading(false);
    }
  }, [selectedPack, selectedChannel]);

  // 支付成功
  const handlePaymentSuccess = useCallback(() => {
    setPaymentModal((prev) => ({ ...prev, isOpen: false }));
    // 刷新页面以更新积分余额
    router.refresh();
  }, [router]);

  return (
    <div className="min-h-screen p-6 md:p-8">
      {/* 页面标题 */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <CreditCard className="h-7 w-7 text-mermaid-cyan" />
              充值中心
            </h1>
            <p className="text-white/40 mt-1">选择积分包，快速充值</p>
          </div>
          <button
            onClick={() => router.push("/recharge/orders")}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/70 text-sm transition-all"
          >
            <History className="h-4 w-4" />
            订单记录
          </button>
        </div>
      </div>

      {/* 积分包选择 */}
      <div className="mb-8">
        <h2 className="text-sm font-medium text-white/50 uppercase tracking-wider mb-4">
          选择积分包
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {DEFAULT_CREDIT_PACKS.map((pack) => {
            const isSelected = selectedPack?.id === pack.id;
            return (
              <button
                key={pack.id}
                onClick={() => setSelectedPack(pack)}
                className={`
                  relative group rounded-2xl border p-6 text-left transition-all duration-300
                  ${isSelected
                    ? "border-mermaid-cyan/50 bg-mermaid-cyan/5 shadow-[0_0_30px_rgba(0,242,234,0.1)]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                  }
                  ${pack.highlight ? "ring-1 ring-mermaid-cyan/20" : ""}
                `}
              >
                {/* 角标 */}
                {pack.badge && (
                  <div className={`
                    absolute -top-2 right-4 px-3 py-0.5 rounded-full text-xs font-bold
                    ${pack.highlight
                      ? "bg-gradient-to-r from-mermaid-cyan to-mermaid-lime text-black"
                      : "bg-white/10 text-white/60"
                    }
                  `}>
                    {pack.badge}
                  </div>
                )}

                {/* 积分数 */}
                <div className="flex items-baseline gap-1 mb-3">
                  <Sparkles className={`h-5 w-5 ${isSelected ? "text-mermaid-cyan" : "text-white/30"}`} />
                  <span className={`text-3xl font-bold ${isSelected ? "text-white" : "text-white/80"}`}>
                    {pack.credits.toLocaleString()}
                  </span>
                  <span className="text-sm text-white/30 ml-1">积分</span>
                </div>

                {/* 包名 */}
                <p className="text-sm text-white/40 mb-4">{pack.name}</p>

                {/* 价格 */}
                <div className={`text-2xl font-bold ${isSelected ? "text-mermaid-cyan" : "text-white/70"}`}>
                  {pack.price_display}
                </div>

                {/* 单价 */}
                <p className="text-xs text-white/25 mt-1">
                  ≈ ¥{(pack.price_cents / pack.credits / 100).toFixed(3)}/积分
                </p>

                {/* 选中指示 */}
                {isSelected && (
                  <div className="absolute top-4 right-4 h-5 w-5 rounded-full bg-mermaid-cyan flex items-center justify-center">
                    <Star className="h-3 w-3 text-black" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 支付方式选择 */}
      <div className="mb-8">
        <h2 className="text-sm font-medium text-white/50 uppercase tracking-wider mb-4">
          支付方式
        </h2>
        <div className="flex gap-3">
          {PAY_CHANNELS.map((channel) => {
            const isSelected = selectedChannel === channel.id;
            return (
              <button
                key={channel.id}
                onClick={() => setSelectedChannel(channel.id)}
                className={`
                  flex items-center gap-3 px-6 py-3 rounded-xl border transition-all duration-200
                  ${isSelected
                    ? "border-white/20 bg-white/[0.06]"
                    : "border-white/5 bg-white/[0.02] hover:border-white/10"
                  }
                `}
              >
                <span className="text-xl">{channel.icon}</span>
                <span className={`font-medium ${isSelected ? "text-white" : "text-white/50"}`}>
                  {channel.name}
                </span>
                {isSelected && (
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: channel.color }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* 确认按钮 */}
      <div className="flex items-center gap-4">
        <button
          onClick={handlePurchase}
          disabled={!selectedPack || isLoading}
          className={`
            flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-base transition-all duration-200
            ${selectedPack && !isLoading
              ? "bg-gradient-to-r from-mermaid-cyan to-mermaid-lime text-black hover:shadow-[0_0_25px_rgba(0,242,234,0.3)] hover:scale-[1.02]"
              : "bg-white/5 text-white/20 cursor-not-allowed"
            }
          `}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              创建订单中...
            </>
          ) : (
            <>
              <Zap className="h-5 w-5" />
              {selectedPack
                ? `立即支付 ${selectedPack.price_display}`
                : "请选择积分包"
              }
              {selectedPack && <ChevronRight className="h-4 w-4" />}
            </>
          )}
        </button>

        {selectedPack && (
          <p className="text-sm text-white/30">
            将获得 <span className="text-mermaid-cyan font-medium">{selectedPack.credits.toLocaleString()}</span> 积分
          </p>
        )}
      </div>

      {/* 安全提示 */}
      <div className="mt-12 flex items-center gap-6 text-xs text-white/20">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4" />
          <span>安全支付</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-4 w-4" />
          <span>即时到账</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4" />
          <span>充值无门槛</span>
        </div>
      </div>

      {/* 支付弹窗 */}
      <PaymentModal
        isOpen={paymentModal.isOpen}
        onClose={() => setPaymentModal((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={handlePaymentSuccess}
        orderNo={paymentModal.orderNo}
        payUrl={paymentModal.payUrl}
        amountDisplay={paymentModal.amountDisplay}
        payChannel={paymentModal.payChannel}
        expiresIn={1800}
      />
    </div>
  );
}
