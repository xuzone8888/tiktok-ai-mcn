"use client";

/**
 * 支付弹窗组件
 * 
 * 展示二维码 + 倒计时 + 轮询支付状态
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { QRCodeDisplay } from "./QRCodeDisplay";
import { X, Loader2, CheckCircle2, XCircle, Clock, Smartphone } from "lucide-react";

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orderNo: string;
  payUrl: string;
  amountDisplay: string;
  payChannel: "wechat_native" | "alipay_qr";
  expiresIn: number; // 秒
}

export function PaymentModal({
  isOpen,
  onClose,
  onSuccess,
  orderNo,
  payUrl,
  amountDisplay,
  payChannel,
  expiresIn,
}: PaymentModalProps) {
  const [status, setStatus] = useState<"pending" | "paid" | "expired" | "error">("pending");
  const [timeLeft, setTimeLeft] = useState(expiresIn);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 当订单号变化时重置状态（新订单打开）
  useEffect(() => {
    if (isOpen && orderNo) {
      setStatus("pending");
      setTimeLeft(expiresIn);
    }
  }, [orderNo, isOpen, expiresIn]);

  // 轮询订单状态
  const pollOrderStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/payment/query-order?order_no=${orderNo}`);
      const data = await res.json();

      if (data.success && data.order) {
        if (data.order.status === "paid") {
          setStatus("paid");
          // 停止轮询
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          // 2 秒后触发成功回调
          setTimeout(() => onSuccess(), 2000);
        } else if (data.order.status === "expired") {
          setStatus("expired");
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      }
    } catch (error) {
      console.error("[PaymentModal] Poll error:", error);
    }
  }, [orderNo, onSuccess]);

  // 启动轮询和倒计时
  useEffect(() => {
    if (!isOpen || status !== "pending") return;

    // 每 3 秒轮询一次
    pollIntervalRef.current = setInterval(pollOrderStatus, 3000);

    // 倒计时
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setStatus("expired");
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, status, pollOrderStatus]);

  if (!isOpen) return null;

  const channelName = payChannel === "wechat_native" ? "微信" : "支付宝";
  const channelColor = payChannel === "wechat_native" ? "#07C160" : "#1677FF";
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 弹窗 */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-[#1a1b1e] rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        {/* 顶部 */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ background: `linear-gradient(135deg, ${channelColor}20, transparent)` }}
        >
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" style={{ color: channelColor }} />
            <span className="font-semibold text-white">{channelName}扫码支付</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="h-5 w-5 text-white/60" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-8 flex flex-col items-center">
          {status === "pending" && (
            <>
              {/* 金额 */}
              <div className="text-3xl font-bold text-white mb-6">{amountDisplay}</div>

              {/* 二维码 */}
              <div className="bg-white rounded-xl p-3 mb-6">
                <QRCodeDisplay value={payUrl} size={220} />
              </div>

              {/* 提示 */}
              <p className="text-sm text-white/50 mb-3">
                请打开{channelName} App 扫描上方二维码完成支付
              </p>

              {/* 倒计时 */}
              <div className="flex items-center gap-2 text-sm text-white/40">
                <Clock className="h-4 w-4" />
                <span>
                  剩余 {minutes}:{String(seconds).padStart(2, "0")}
                </span>
              </div>

              {/* 轮询指示器 */}
              <div className="mt-4 flex items-center gap-2 text-xs text-white/30">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>等待支付确认中...</span>
              </div>
            </>
          )}

          {status === "paid" && (
            <div className="flex flex-col items-center py-8">
              <CheckCircle2 className="h-16 w-16 text-green-400 mb-4" />
              <p className="text-xl font-bold text-white mb-2">支付成功！</p>
              <p className="text-sm text-white/50">积分即将到账，页面将自动刷新</p>
            </div>
          )}

          {status === "expired" && (
            <div className="flex flex-col items-center py-8">
              <XCircle className="h-16 w-16 text-red-400/70 mb-4" />
              <p className="text-xl font-bold text-white mb-2">订单已过期</p>
              <p className="text-sm text-white/50 mb-4">请重新发起支付</p>
              <button
                onClick={onClose}
                className="px-6 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-sm transition-colors"
              >
                关闭
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center py-8">
              <XCircle className="h-16 w-16 text-amber-400/70 mb-4" />
              <p className="text-xl font-bold text-white mb-2">支付异常</p>
              <p className="text-sm text-white/50 mb-4">
                如已完成支付，积分将在几分钟内到账
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-sm transition-colors"
              >
                关闭
              </button>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        {status === "pending" && (
          <div className="px-6 py-3 border-t border-white/5 text-center">
            <p className="text-xs text-white/25">
              订单号: {orderNo}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
