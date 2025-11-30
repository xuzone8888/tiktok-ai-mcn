"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { X, Bell, Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

// ============================================================================
// 类型定义
// ============================================================================

interface AnnouncementConfig {
  enabled: boolean;
  content: string;
  type: "info" | "warning" | "error" | "success";
  link_url?: string;
  link_text?: string;
  dismissible: boolean;
}

// ============================================================================
// Announcement Bar Component
// ============================================================================

export function AnnouncementBar() {
  const [announcement, setAnnouncement] = useState<AnnouncementConfig | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  // 获取公告配置
  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        // 检查是否已被用户关闭 (存储在 localStorage)
        const dismissedAt = localStorage.getItem("announcement_dismissed_at");
        if (dismissedAt) {
          // 24小时后重新显示
          const dismissedTime = new Date(dismissedAt).getTime();
          const now = Date.now();
          if (now - dismissedTime < 24 * 60 * 60 * 1000) {
            setDismissed(true);
            setLoading(false);
            return;
          }
        }

        const res = await fetch("/api/admin/settings?scope=public");
        const data = await res.json();

        if (data.success && data.data.announcement?.enabled) {
          setAnnouncement(data.data.announcement);
        }
      } catch (error) {
        console.error("Failed to fetch announcement:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnnouncement();
  }, []);

  // 关闭公告
  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("announcement_dismissed_at", new Date().toISOString());
  };

  // 不显示条件
  if (loading || dismissed || !announcement || !announcement.enabled) {
    return null;
  }

  // 根据类型获取样式和图标
  const getTypeStyles = () => {
    switch (announcement.type) {
      case "info":
        return {
          bg: "bg-gradient-to-r from-tiktok-cyan/20 to-blue-500/20",
          border: "border-tiktok-cyan/30",
          text: "text-tiktok-cyan",
          Icon: Info,
        };
      case "success":
        return {
          bg: "bg-gradient-to-r from-green-500/20 to-emerald-500/20",
          border: "border-green-500/30",
          text: "text-green-400",
          Icon: CheckCircle2,
        };
      case "warning":
        return {
          bg: "bg-gradient-to-r from-amber-500/20 to-orange-500/20",
          border: "border-amber-500/30",
          text: "text-amber-400",
          Icon: AlertTriangle,
        };
      case "error":
        return {
          bg: "bg-gradient-to-r from-red-500/20 to-pink-500/20",
          border: "border-red-500/30",
          text: "text-red-400",
          Icon: XCircle,
        };
      default:
        return {
          bg: "bg-white/5",
          border: "border-white/10",
          text: "text-white",
          Icon: Bell,
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div
      className={cn(
        "relative w-full py-2.5 px-4 border-b backdrop-blur-sm",
        styles.bg,
        styles.border
      )}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-3">
        {/* Icon */}
        <styles.Icon className={cn("h-4 w-4 flex-shrink-0", styles.text)} />

        {/* Content */}
        <p className={cn("text-sm font-medium", styles.text)}>
          {announcement.content}
        </p>

        {/* Link */}
        {announcement.link_url && announcement.link_text && (
          <Link
            href={announcement.link_url}
            className={cn(
              "text-sm font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity flex-shrink-0",
              styles.text
            )}
          >
            {announcement.link_text} →
          </Link>
        )}

        {/* Dismiss Button */}
        {announcement.dismissible && (
          <button
            onClick={handleDismiss}
            className={cn(
              "absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-white/10 transition-colors",
              styles.text
            )}
            aria-label="Close announcement"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

