"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  Activity,
  Wifi,
  WifiOff,
  AlertTriangle,
  Clock,
  Film,
  ImageIcon,
  Volume2,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  Circle,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface ApiStatus {
  id: string;
  name: string;
  category: "video" | "image" | "tts" | "text";
  provider: string;
  domain: string;
  model?: string;
  price?: string;
  status: "online" | "degraded" | "offline" | "unchecked";
  successRate: number;
  latencyMs: number;
  lastError: string | null;
  keyConfigured: boolean;
}

interface HealthData {
  summary: {
    total: number;
    online: number;
    degraded: number;
    offline: number;
    unchecked: number;
    avgLatencyMs: number;
    lastCheckTime: number | null;
    totalChecks: number;
  };
  apis: ApiStatus[];
}

// ============================================================================
// Constants
// ============================================================================

const POLL_INTERVAL = 30_000; // 30 秒

const CATEGORY_META = {
  video: { icon: Film, label: "🎬 视频 API", color: "text-purple-400" },
  image: { icon: ImageIcon, label: "🖼️ 图片 API", color: "text-mermaid-cyan" },
  tts: { icon: Volume2, label: "🔊 TTS 语音", color: "text-amber-400" },
  text: { icon: FileText, label: "📝 AI 文本", color: "text-emerald-400" },
};

// ============================================================================
// Component
// ============================================================================

export default function ApiHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoPolling, setAutoPolling] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // 获取数据
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/api-health");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastRefresh(new Date());
      }
    } catch (err) {
      console.error("[API Health] Fetch error:", err);
    }
  }, []);

  // 触发检测
  const triggerCheck = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/api-health", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastRefresh(new Date());
      }
    } catch (err) {
      console.error("[API Health] Check error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次加载 → 立即检测
  useEffect(() => {
    triggerCheck();
  }, [triggerCheck]);

  // 自动轮询
  useEffect(() => {
    if (autoPolling) {
      intervalRef.current = setInterval(triggerCheck, POLL_INTERVAL);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoPolling, triggerCheck]);

  // 状态灯颜色
  const statusColor = (s: string) => {
    switch (s) {
      case "online": return "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]";
      case "degraded": return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]";
      case "offline": return "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]";
      default: return "bg-white/20";
    }
  };

  const statusText = (s: string) => {
    switch (s) {
      case "online": return "在线";
      case "degraded": return "不稳定";
      case "offline": return "离线";
      default: return "未检测";
    }
  };

  const rateColor = (rate: number) => {
    if (rate >= 80) return "bg-emerald-400";
    if (rate >= 50) return "bg-amber-400";
    return "bg-red-400";
  };

  // 按分类分组
  const categories = data
    ? (["video", "image", "tts", "text"] as const).map(cat => ({
        ...CATEGORY_META[cat],
        key: cat,
        apis: data.apis.filter(a => a.category === cat),
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 flex items-center justify-center">
              <Activity className="h-5 w-5 text-emerald-400" />
            </div>
            API 健康检查
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            实时监控所有 API 连通性和可用性
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* 自动检测状态 */}
          <button
            onClick={() => setAutoPolling(!autoPolling)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
              autoPolling
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-white/5 border-white/10 text-white/40"
            )}
          >
            <span className={cn(
              "h-2 w-2 rounded-full",
              autoPolling ? "bg-emerald-400 animate-pulse" : "bg-white/20"
            )} />
            {autoPolling ? "自动检测中 (30s)" : "自动检测已暂停"}
          </button>
          {/* 手动刷新 */}
          <Button
            variant="outline"
            size="sm"
            onClick={triggerCheck}
            disabled={loading}
            className="gap-2 border-white/20"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            手动刷新
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard
            icon={<Wifi className="h-4 w-4 text-emerald-400" />}
            label="在线"
            value={`${data.summary.online}/${data.summary.total}`}
            color="emerald"
          />
          <SummaryCard
            icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
            label="告警"
            value={String(data.summary.degraded)}
            color="amber"
          />
          <SummaryCard
            icon={<WifiOff className="h-4 w-4 text-red-400" />}
            label="离线"
            value={String(data.summary.offline)}
            color="red"
          />
          <SummaryCard
            icon={<Clock className="h-4 w-4 text-blue-400" />}
            label="平均延迟"
            value={`${data.summary.avgLatencyMs}ms`}
            color="blue"
          />
        </div>
      )}

      {/* API Cards by Category */}
      {data ? (
        <div className="space-y-6">
          {categories.map(cat => (
            <div key={cat.key}>
              <h2 className={cn("text-lg font-bold mb-3 flex items-center gap-2", cat.color)}>
                {cat.label}
                <span className="text-xs text-white/30 font-normal ml-2">
                  ({cat.apis.filter(a => a.status === "online").length}/{cat.apis.length})
                </span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {cat.apis.map(api => (
                  <div
                    key={api.id}
                    className={cn(
                      "p-4 rounded-xl border transition-all",
                      api.status === "online"
                        ? "bg-card/50 border-border/50 hover:border-emerald-500/30"
                        : api.status === "degraded"
                        ? "bg-amber-500/5 border-amber-500/20"
                        : api.status === "offline"
                        ? "bg-red-500/5 border-red-500/20"
                        : "bg-card/30 border-border/30"
                    )}
                  >
                    {/* Top: Status + Name */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <span className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", statusColor(api.status))} />
                        <div>
                          <p className="font-semibold text-sm">{api.name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{api.domain}</p>
                        </div>
                      </div>
                      <span className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-medium",
                        api.status === "online" ? "bg-emerald-400/10 text-emerald-400" :
                        api.status === "degraded" ? "bg-amber-400/10 text-amber-400" :
                        api.status === "offline" ? "bg-red-400/10 text-red-400" :
                        "bg-white/5 text-white/30"
                      )}>
                        {statusText(api.status)}
                      </span>
                    </div>

                    {/* Model + Price */}
                    {(api.model || api.price) && (
                      <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                        {api.model && <span className="truncate">{api.model}</span>}
                        {api.price && (
                          <span className="ml-auto text-amber-400/80 font-mono flex-shrink-0">{api.price}</span>
                        )}
                      </div>
                    )}

                    {/* Success Rate Bar */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">成功率</span>
                        <span className={cn(
                          "font-bold font-mono",
                          api.successRate >= 80 ? "text-emerald-400" :
                          api.successRate >= 50 ? "text-amber-400" : "text-red-400"
                        )}>
                          {api.status === "unchecked" ? "—" : `${api.successRate}%`}
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500", rateColor(api.successRate))}
                          style={{ width: `${api.status === "unchecked" ? 0 : api.successRate}%` }}
                        />
                      </div>
                    </div>

                    {/* Bottom: Latency + Key Status */}
                    <div className="flex items-center justify-between mt-3 text-[11px]">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {api.latencyMs > 0 ? `${api.latencyMs}ms` : "—"}
                      </span>
                      <span className={cn(
                        "flex items-center gap-1",
                        api.keyConfigured ? "text-emerald-400/60" : "text-red-400/60"
                      )}>
                        {api.keyConfigured ? (
                          <><CheckCircle className="h-3 w-3" /> Key 已配置</>
                        ) : (
                          <><XCircle className="h-3 w-3" /> Key 未配置</>
                        )}
                      </span>
                    </div>

                    {/* Error */}
                    {api.lastError && api.status !== "online" && (
                      <div className="mt-2 p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                        <p className="text-[10px] text-red-400 truncate">⚠️ {api.lastError}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Loading Skeleton */
        <div className="space-y-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="space-y-3">
              <div className="h-6 w-32 bg-white/5 rounded-lg animate-pulse" />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {[1, 2, 3].map(j => (
                  <div key={j} className="h-40 bg-white/5 rounded-xl animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer: Last check info */}
      {lastRefresh && (
        <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Circle className="h-1.5 w-1.5 fill-current" />
          上次检测: {lastRefresh.toLocaleTimeString("zh-CN")}
          {data?.summary.totalChecks && (
            <span>· 累计检测 {data.summary.totalChecks} 次</span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className={cn(
      "p-4 rounded-xl border",
      `bg-${color}-500/5 border-${color}-500/20`
    )}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold font-mono">{value}</p>
    </div>
  );
}
