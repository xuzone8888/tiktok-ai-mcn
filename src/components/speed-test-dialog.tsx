"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Zap,
  Clock,
  Download,
  Signal,
} from "lucide-react";
import {
  type SpeedTestResult,
  getCachedSpeedTestResults,
  getRecommendedRoutes,
  fetchAvailableRoutes,
  testRouteSpeed,
  saveSpeedTestResults,
  type DownloadRoute,
} from "@/lib/download-manager";

interface SpeedTestDialogProps {
  open: boolean;
  onClose: () => void;
  onComplete?: (results: SpeedTestResult[]) => void;
}

// 线路图标组件
function RouteStatusIcon({ status }: { status: SpeedTestResult["status"] }) {
  switch (status) {
    case "pending":
      return <Signal className="h-4 w-4 text-gray-400" />;
    case "testing":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "failed":
    case "timeout":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Signal className="h-4 w-4 text-gray-400" />;
  }
}

// 速度徽章
function SpeedBadge({ speed, rank }: { speed: number; rank?: number }) {
  const getSpeedColor = () => {
    if (speed >= 3) return "bg-green-100 text-green-700 border-green-200";
    if (speed >= 1) return "bg-yellow-100 text-yellow-700 border-yellow-200";
    if (speed > 0) return "bg-orange-100 text-orange-700 border-orange-200";
    return "bg-gray-100 text-gray-500 border-gray-200";
  };

  return (
    <div className="flex items-center gap-2">
      {rank && rank <= 3 && (
        <Badge variant="outline" className="text-xs px-1 py-0">
          #{rank}
        </Badge>
      )}
      <Badge variant="outline" className={cn("font-mono", getSpeedColor())}>
        {speed > 0 ? `${speed.toFixed(2)} MB/s` : "--"}
      </Badge>
    </div>
  );
}

// 线路项组件
function RouteItem({
  route,
  result,
  rank,
  isBest,
}: {
  route: DownloadRoute;
  result?: SpeedTestResult;
  rank?: number;
  isBest?: boolean;
}) {
  const status = result?.status || "pending";

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg border transition-all",
        isBest && "border-green-500 bg-green-50/50",
        status === "testing" && "border-blue-300 bg-blue-50/30",
        status === "failed" && "border-red-200 bg-red-50/30",
        !isBest && status !== "testing" && status !== "failed" && "border-gray-200"
      )}
    >
      <div className="flex items-center gap-3">
        <RouteStatusIcon status={status} />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{route.name}</span>
            {isBest && (
              <Badge className="bg-green-500 text-white text-[10px] px-1.5 py-0">
                推荐
              </Badge>
            )}
          </div>
          <span className="text-xs text-gray-500">{route.description}</span>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        {result?.latency && result.latency > 0 && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="h-3 w-3" />
            <span>{(result.latency / 1000).toFixed(1)}s</span>
          </div>
        )}
        <SpeedBadge speed={result?.speed || 0} rank={rank} />
      </div>
    </div>
  );
}

export function SpeedTestDialog({
  open,
  onClose,
  onComplete,
}: SpeedTestDialogProps) {
  const [routes, setRoutes] = useState<DownloadRoute[]>([]);
  const [results, setResults] = useState<SpeedTestResult[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [hasTestedBefore, setHasTestedBefore] = useState(false);

  // 加载可用线路和缓存结果
  useEffect(() => {
    if (open) {
      // 加载缓存结果
      const cached = getCachedSpeedTestResults();
      if (cached.length > 0) {
        setResults(cached);
        setHasTestedBefore(true);
      }
      
      // 加载线路配置
      fetchAvailableRoutes().then(setRoutes);
    }
  }, [open]);

  // 开始测速
  const startSpeedTest = useCallback(async () => {
    if (routes.length === 0) return;
    
    setIsTesting(true);
    setProgress(0);
    setResults([]);
    
    const newResults: SpeedTestResult[] = [];
    
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      setCurrentRoute(route.name);
      setProgress(((i + 0.5) / routes.length) * 100);
      
      // 添加pending状态
      const pendingResult: SpeedTestResult = {
        routeId: route.id,
        status: "testing",
        speed: 0,
        latency: 0,
      };
      setResults([...newResults, pendingResult]);
      
      // 执行测速
      const result = await testRouteSpeed(route.id);
      newResults.push(result);
      setResults([...newResults]);
      
      setProgress(((i + 1) / routes.length) * 100);
    }
    
    // 保存结果
    saveSpeedTestResults(newResults);
    setHasTestedBefore(true);
    setIsTesting(false);
    setCurrentRoute("");
    
    onComplete?.(newResults);
  }, [routes, onComplete]);

  // 获取排序后的结果
  const sortedResults = getRecommendedRoutes(results);
  const bestRouteId = sortedResults[0]?.routeId;

  // 获取结果的排名
  const getRank = (routeId: string): number | undefined => {
    const index = sortedResults.findIndex(r => r.routeId === routeId);
    return index >= 0 ? index + 1 : undefined;
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-blue-500" />
            检测下载线路
          </DialogTitle>
          <DialogDescription>
            检测各下载线路的速度，选择最适合您网络的线路以获得最佳下载体验
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* 测速进度 */}
          {isTesting && (
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">正在测试: {currentRoute}</span>
                <span className="text-gray-500">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* 线路列表 */}
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {routes.map((route) => {
              const result = results.find(r => r.routeId === route.id);
              const rank = getRank(route.id);
              const isBest = route.id === bestRouteId && !isTesting;
              
              return (
                <RouteItem
                  key={route.id}
                  route={route}
                  result={result}
                  rank={rank}
                  isBest={isBest}
                />
              );
            })}
            
            {routes.length === 0 && !isTesting && (
              <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                <WifiOff className="h-10 w-10 mb-2 text-gray-400" />
                <p>无法获取线路信息</p>
              </div>
            )}
          </div>

          {/* 测速结果摘要 */}
          {hasTestedBefore && !isTesting && sortedResults.length > 0 && (
            <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center gap-2 text-green-700">
                <Zap className="h-4 w-4" />
                <span className="font-medium">推荐线路</span>
              </div>
              <p className="text-sm text-green-600 mt-1">
                根据测速结果，<strong>{routes.find(r => r.id === bestRouteId)?.name}</strong> 线路速度最快
                （{sortedResults[0].speed.toFixed(2)} MB/s），下载时将自动使用该线路
              </p>
            </div>
          )}

          {/* 提示信息 */}
          {!hasTestedBefore && !isTesting && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 text-blue-700">
                <Download className="h-4 w-4" />
                <span className="font-medium">提示</span>
              </div>
              <p className="text-sm text-blue-600 mt-1">
                点击下方按钮开始检测各线路速度，系统将根据您的网络环境推荐最佳下载线路
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isTesting}>
            {hasTestedBefore ? "完成" : "取消"}
          </Button>
          <Button
            onClick={startSpeedTest}
            disabled={isTesting || routes.length === 0}
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                测速中...
              </>
            ) : hasTestedBefore ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                重新测速
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                开始测速
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SpeedTestDialog;

