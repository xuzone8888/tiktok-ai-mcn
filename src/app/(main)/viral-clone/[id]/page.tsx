"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Video,
  FileText,
  Zap,
  RotateCcw,
  Download,
  Send,
  Eye,
  ChevronRight,
  Sparkles,
  Volume2,
  Film,
  Scissors,
  MonitorUp,
  Pencil,
  Link2,
} from "lucide-react";
import type {
  ViralCloneJob,
  ViralCloneSegment,
  ViralCloneAsset,
  ViralCloneEvent,
  MasterPlan,
  CloneSpecV2,
  SegmentPlan,
  JobStatus,
  SegmentStatus,
  OrchestrationMode,
} from "@/types/viral-clone";
import { JOB_STATUS_LABELS, SEGMENT_STATUS_LABELS } from "@/types/viral-clone";

// ============================================================================
// 状态到图标的映射
// ============================================================================

const STATUS_ICONS: Record<string, React.ElementType> = {
  created: Clock,
  ingesting: Loader2,
  analyzing: Sparkles,
  planning: FileText,
  awaiting_confirmation: Eye,
  generating: Zap,
  stitching: Scissors,
  upscaling: MonitorUp,
  completed: CheckCircle2,
  failed: XCircle,
  manual_review: AlertTriangle,
};

const STATUS_COLORS: Record<string, string> = {
  created: "text-white/40",
  ingesting: "text-blue-400",
  analyzing: "text-purple-400",
  planning: "text-amber-400",
  awaiting_confirmation: "text-teal-400",
  generating: "text-cyan-400",
  stitching: "text-indigo-400",
  upscaling: "text-pink-400",
  completed: "text-emerald-400",
  failed: "text-red-400",
  manual_review: "text-orange-400",
};

const SEGMENT_STATUS_COLORS: Record<string, string> = {
  queued: "bg-white/5 text-white/30 border-white/10",
  generating: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30 animate-pulse",
  ready_for_qc: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  ready: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  stitched: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
  replaced: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
};

// ============================================================================
// 进度条组件
// ============================================================================

function JobProgress({ status, segments }: { status: JobStatus; segments: ViralCloneSegment[] }) {
  const steps: { key: string; label: string }[] = [
    { key: "ingesting", label: "导入" },
    { key: "analyzing", label: "分析" },
    { key: "planning", label: "规划" },
    { key: "generating", label: "生成" },
    { key: "stitching", label: "拼接" },
    { key: "upscaling", label: "超分" },
    { key: "completed", label: "完成" },
  ];

  const ORDER: Record<string, number> = {
    created: 0, ingesting: 1, analyzing: 2, planning: 3,
    awaiting_confirmation: 3, generating: 4, stitching: 5,
    upscaling: 6, completed: 7, failed: -1, manual_review: -1,
  };

  const currentOrder = ORDER[status] ?? 0;

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, index) => {
        const stepOrder = index + 1;
        const isCompleted = currentOrder > stepOrder;
        const isCurrent = currentOrder === stepOrder ||
          (status === "awaiting_confirmation" && step.key === "planning");

        return (
          <div key={step.key} className="flex items-center gap-1">
            <div className="flex flex-col items-center gap-1">
              <div className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                isCompleted && "bg-emerald-500 text-white",
                isCurrent && "bg-[hsl(174,100%,47%)] text-black animate-pulse",
                !isCompleted && !isCurrent && "bg-white/5 text-white/20",
                status === "failed" && isCurrent && "bg-red-500 text-white",
              )}>
                {isCompleted ? "✓" : index + 1}
              </div>
              <span className={cn(
                "text-[9px] whitespace-nowrap",
                isCompleted ? "text-emerald-400/60" : isCurrent ? "text-white/60" : "text-white/15",
              )}>
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className={cn(
                "w-6 h-0.5 mb-4",
                isCompleted ? "bg-emerald-500/50" : "bg-white/5",
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Segment 卡片
// ============================================================================

function SegmentCard({
  segment,
  onRetry,
}: {
  segment: ViralCloneSegment;
  onRetry: () => void;
}) {
  const roleLabels: Record<string, string> = {
    hook: "🎯 开场",
    body: "📋 主体",
    demo: "🔍 演示",
    cta: "📢 号召",
    b_roll: "🎬 过渡",
  };

  const techPassed = (segment.tech_qc as unknown as Record<string, unknown> | null)?.passed;
  const semanticPassed = (segment.semantic_qc as unknown as Record<string, unknown> | null)?.passed;
  const continuityPassed = (segment.continuity_qc as unknown as Record<string, unknown> | null)?.passed;

  return (
    <div className={cn(
      "p-4 rounded-xl border transition-all",
      "border-white/5 bg-white/[0.02]",
      segment.status === "generating" && "border-cyan-500/20 bg-cyan-500/[0.02]",
      segment.status === "failed" && "border-red-500/20 bg-red-500/[0.02]",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          {/* 头部 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-white/50">#{segment.segment_index + 1}</span>
            <span className="text-xs">{roleLabels[segment.segment_role] || segment.segment_role}</span>
            <Badge className={cn("text-[10px] h-5", SEGMENT_STATUS_COLORS[segment.status] || "")}>
              {SEGMENT_STATUS_LABELS[segment.status] || segment.status}
            </Badge>
            {segment.retry_count > 0 && (
              <span className="text-[10px] text-orange-400">重试 {segment.retry_count}x</span>
            )}
          </div>

          {/* 口播文案 */}
          <p className="text-xs text-white/40 line-clamp-2">
            {segment.spoken_text || "(无文案)"}
          </p>

          {/* QC 状态 */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* 双时长展示：源段 vs 生成目标 */}
            {segment.source_span_duration != null && segment.generation_duration != null ? (
              <>
                <span className="text-[10px] text-white/20">源段: {segment.source_span_duration}s</span>
                <span className="text-[10px] text-white/20">生成: {segment.generation_duration}s</span>
              </>
            ) : (
              <span className="text-[10px] text-white/20">{segment.target_duration}s</span>
            )}
            {techPassed !== undefined && (
              <span className={cn("text-[10px]", techPassed ? "text-emerald-400" : "text-red-400")}>
                Tech {techPassed ? "✓" : "✗"}
              </span>
            )}
            {semanticPassed !== undefined && (
              <span className={cn("text-[10px]", semanticPassed ? "text-emerald-400" : "text-red-400")}>
                Semantic {semanticPassed ? "✓" : "✗"}
              </span>
            )}
            {continuityPassed !== undefined && (
              <span className={cn("text-[10px]", continuityPassed ? "text-emerald-400" : "text-red-400")}>
                Continuity {continuityPassed ? "✓" : "✗"}
              </span>
            )}
          </div>

          {/* Tech QC 失败时展示详细时长信息 */}
          {techPassed === false && segment.tech_qc && (
            <p className="text-[10px] text-orange-400/80">
              {(() => {
                const qc = segment.tech_qc as unknown as Record<string, unknown>;
                const actual = qc.duration_actual_ms ? `${(Number(qc.duration_actual_ms) / 1000).toFixed(1)}s` : '?';
                const expected = qc.expected_output_duration_s ? `${qc.expected_output_duration_s}s` : '?';
                const sourceSpan = qc.source_span_duration_s ? `${qc.source_span_duration_s}s` : null;
                return `实际输出 ${actual} · 期望 ${expected}${sourceSpan ? ` · 源段跨度 ${sourceSpan}` : ''}`;
              })()}
            </p>
          )}

          {/* 错误信息 */}
          {segment.error_message && (
            <p className="text-[10px] text-red-400 flex items-center gap-1">
              <XCircle className="h-3 w-3 shrink-0" />
              {segment.error_message}
            </p>
          )}
        </div>

        {/* 操作 */}
        {segment.status === "failed" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRetry}
            className="text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 h-8 text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            重试
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 事件时间线
// ============================================================================

function EventTimeline({ events }: { events: ViralCloneEvent[] }) {
  if (events.length === 0) return null;

  const eventLabels: Record<string, string> = {
    job_created: "任务已创建",
    ingest_started: "开始导入",
    ingest_completed: "导入完成",
    ingest_failed: "导入失败",
    analysis_started: "开始分析",
    analysis_completed: "分析完成",
    plan_ready: "方案就绪",
    plan_confirmed: "方案已确认",
    segment_queued: "分段排队",
    segment_generating: "分段生成中",
    segment_completed: "分段完成",
    segment_failed: "分段失败",
    segment_qc_passed: "QC 通过",
    segment_qc_failed: "QC 未通过",
    segment_rescued: "分段补救",
    stitch_started: "开始拼接",
    stitch_completed: "拼接完成",
    stitch_failed: "拼接失败",
    upscale_started: "开始超分",
    upscale_completed: "超分完成",
    upscale_failed: "超分失败",
    job_completed: "🎉 任务完成",
    job_failed: "任务失败",
    continuity_qc_started: "开始连续性检查",
    continuity_qc_completed: "连续性检查完成",
    seam_qc_started: "开始接缝检查",
    seam_qc_completed: "接缝检查完成",
    bgm_generated: "🎵 BGM 已生成",
    budget_warning: "预算预警",
    budget_exhausted: "预算耗尽",
    manual_review_needed: "需人工审核",
  };

  return (
    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-2">
      {events.map((event) => (
        <div key={event.id} className="flex items-start gap-2 text-[10px]">
          <span className="text-white/15 whitespace-nowrap shrink-0">
            {new Date(event.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span className={cn(
            "text-white/40",
            event.event_type.includes("failed") && "text-red-400",
            event.event_type.includes("completed") && "text-emerald-400",
          )}>
            {eventLabels[event.event_type] || event.event_type}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// 主页面
// ============================================================================

export default function ViralCloneDetailPage({
  params,
}: {
  params: { id: string } | Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [jobId, setJobId] = useState<string>("");
  const [job, setJob] = useState<ViralCloneJob | null>(null);
  const [segments, setSegments] = useState<ViralCloneSegment[]>([]);
  const [assets, setAssets] = useState<ViralCloneAsset[]>([]);
  const [events, setEvents] = useState<ViralCloneEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // 方案编辑状态 (P3-13)
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({});
  const [isEditingPlan, setIsEditingPlan] = useState(false);

  // 生成模式选择 (P3-14)
  const [selectedMode, setSelectedMode] = useState<OrchestrationMode>('parallel_2');

  // V2 段数覆盖
  const [selectedSegmentCount, setSelectedSegmentCount] = useState<number | null>(null);

  // 解析 params — 兼容 Next.js 14 (同步) 和 15 (异步)
  useEffect(() => {
    if (params && typeof (params as Promise<{ id: string }>).then === 'function') {
      (params as Promise<{ id: string }>).then(p => setJobId(p.id));
    } else {
      setJobId((params as { id: string }).id);
    }
  }, [params]);

  // 加载 Job 数据
  const loadJob = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/viral-clone/jobs?id=${jobId}`);
      const data = await res.json();
      if (data.success) {
        setJob(data.data.job);
        setSegments(data.data.segments || []);
        setAssets(data.data.assets || []);
        setEvents(data.data.events || []);
      }
    } catch {
      // 忽略
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  // 轮询（审计采纳 3.5: 前端先轮询）
  useEffect(() => {
    if (!job) return;

    // 只有真正的终态才停止轮询（awaiting_confirmation 不是终态，点击确认后需要继续轮询）
    const terminalStates: JobStatus[] = ["completed", "failed", "manual_review"];
    if (terminalStates.includes(job.status)) return;

    const interval = setInterval(loadJob, 4000); // 4 秒轮询
    return () => clearInterval(interval);
  }, [job?.status, loadJob]);

  // 执行 action
  const doAction = async (action: string, extra?: Record<string, unknown>) => {
    setActing(true);
    try {
      const res = await fetch(`/api/viral-clone/jobs/${jobId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      toast({ title: "操作成功" });
      await loadJob();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "操作失败",
        description: error instanceof Error ? error.message : "请重试",
      });
    } finally {
      setActing(false);
    }
  };

  // 获取最终视频 URL
  const finalVideoUrl = job?.final_asset_id
    ? assets.find(a => a.id === job.final_asset_id)?.url
    : undefined;

  const rawPlan = job?.confirmed_plan_snapshot;
  const isV2Plan = rawPlan && typeof rawPlan === 'object' && 'mode' in (rawPlan as unknown as Record<string, unknown>);
  const plan = rawPlan as (MasterPlan & { mode?: never }) | CloneSpecV2 | null;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 text-white/20 animate-spin" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-5xl mx-auto text-center py-20">
        <p className="text-white/30">任务不存在</p>
        <Button asChild variant="ghost" className="mt-4">
          <Link href="/viral-clone">返回列表</Link>
        </Button>
      </div>
    );
  }

  const StatusIcon = STATUS_ICONS[job.status] || Clock;
  const isGenerating = ["ingesting", "analyzing", "planning", "generating", "stitching", "upscaling"].includes(job.status);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="text-white/30 hover:text-white/50">
          <Link href="/viral-clone">
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Link>
        </Button>
      </div>

      {/* Job 头部 */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center",
              isGenerating
                ? "bg-[hsl(174,100%,47%)]/10"
                : job.status === "completed" ? "bg-emerald-500/10" : "bg-white/5"
            )}>
              <StatusIcon className={cn(
                "h-6 w-6",
                STATUS_COLORS[job.status],
                isGenerating && "animate-spin",
              )} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                {JOB_STATUS_LABELS[job.status]}
              </h1>
              <p className="text-xs text-white/30">
                {job.entry_type === "upload" ? "视频上传" : job.entry_type === "link" ? "链接导入" : "提示词生成"}
                · {new Date(job.created_at).toLocaleString("zh-CN")}
              </p>
            </div>
          </div>

          {/* 进度条 */}
          <JobProgress status={job.status} segments={segments} />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 shrink-0">
          {job.status === "created" && (
            <Button
              onClick={() => doAction("plan")}
              disabled={acting}
              className="bg-[hsl(174,100%,47%)] text-black hover:bg-[hsl(174,100%,42%)]"
            >
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              开始分析
            </Button>
          )}
          {job.status === "awaiting_confirmation" && (
            <>
              {/* 模式选择 (P3-14) */}
              <div className="flex items-center gap-2 mr-auto">
                <button
                  onClick={() => setSelectedMode('parallel_2')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                    selectedMode === 'parallel_2'
                      ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/40"
                      : "bg-white/[0.02] text-white/30 border-white/5 hover:text-white/50"
                  )}
                >
                  ⚡ 快速模式
                </button>
                <button
                  onClick={() => setSelectedMode('chain_extend')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                    selectedMode === 'chain_extend'
                      ? "bg-purple-500/15 text-purple-400 border-purple-500/40"
                      : "bg-white/[0.02] text-white/30 border-white/5 hover:text-white/50"
                  )}
                >
                  🎯 高质量模式
                </button>
              </div>

              {/* V2 段数选择器 */}
              {isV2Plan && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-white/20">段数:</span>
                  {[2, 3, 4].map(n => {
                    const defaultCount = (plan as CloneSpecV2)?.source_analysis?.suggested_segments || 3;
                    const isActive = selectedSegmentCount === n || (!selectedSegmentCount && n === defaultCount);
                    return (
                      <button
                        key={n}
                        onClick={() => setSelectedSegmentCount(n === defaultCount ? null : n)}
                        className={cn(
                          "w-7 h-7 rounded text-xs font-medium transition-all border",
                          isActive
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/40"
                            : "bg-white/[0.02] text-white/30 border-white/5 hover:text-white/50"
                        )}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              )}

              <Button
                onClick={() => {
                  if (isV2Plan) {
                    // V2: 发送 edited_segments
                    const editedSegments = Object.keys(editedPrompts).length > 0
                      ? Object.entries(editedPrompts).map(([idx, text]) => ({ index: Number(idx), spoken_text_exact: text }))
                      : undefined;
                    doAction("confirm", {
                      edited_segments: editedSegments,
                      segment_count_override: selectedSegmentCount || undefined,
                      orchestration_mode: selectedMode,
                    });
                  } else {
                    // V1: 发送 edited_plan
                    const editedPlan = Object.keys(editedPrompts).length > 0 ? {
                      segments: (plan as MasterPlan)?.segments?.map((seg, i) => ({
                        ...seg,
                        visual_goal: editedPrompts[i] ?? seg.visual_goal,
                      })),
                    } : undefined;
                    doAction("confirm", {
                      edited_plan: editedPlan,
                      orchestration_mode: selectedMode,
                    });
                  }
                }}
                disabled={acting}
                variant="outline"
                className="border-white/10"
              >
                确认方案
              </Button>
              <Button
                onClick={() => {
                  if (isV2Plan) {
                    const editedSegments = Object.keys(editedPrompts).length > 0
                      ? Object.entries(editedPrompts).map(([idx, text]) => ({ index: Number(idx), spoken_text_exact: text }))
                      : undefined;
                    doAction("confirm", {
                      edited_segments: editedSegments,
                      segment_count_override: selectedSegmentCount || undefined,
                      orchestration_mode: selectedMode,
                      auto_start: true,
                    });
                  } else {
                    const editedPlan = Object.keys(editedPrompts).length > 0 ? {
                      segments: (plan as MasterPlan)?.segments?.map((seg, i) => ({
                        ...seg,
                        visual_goal: editedPrompts[i] ?? seg.visual_goal,
                      })),
                    } : undefined;
                    doAction("confirm", {
                      edited_plan: editedPlan,
                      orchestration_mode: selectedMode,
                      auto_start: true,
                    });
                  }
                }}
                disabled={acting}
                className="bg-[hsl(174,100%,47%)] text-black hover:bg-[hsl(174,100%,42%)]"
              >
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
                确认并开始生成
              </Button>
            </>
          )}
          {job.status === "completed" && finalVideoUrl && (
            <>
              <Button
                onClick={() => window.open(finalVideoUrl, "_blank")}
                variant="outline"
                className="border-white/10"
              >
                <Download className="h-4 w-4 mr-1" />
                下载视频
              </Button>
              <Button
                onClick={() => doAction("publish")}
                disabled={acting}
                className="bg-[hsl(174,100%,47%)] text-black hover:bg-[hsl(174,100%,42%)]"
              >
                <Send className="h-4 w-4 mr-1" />
                发布
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 错误信息 */}
      {job.error_message && (
        <div className="flex items-start gap-2 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
          <XCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">任务出错</p>
            <p className="text-xs text-red-400/60 mt-1">{job.error_message}</p>
          </div>
        </div>
      )}

      {/* 成品预览 */}
      {job.status === "completed" && finalVideoUrl && (
        <Card className="border-emerald-500/20 bg-emerald-500/[0.02] overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video bg-black rounded-lg overflow-hidden">
              <video
                src={finalVideoUrl}
                controls
                className="w-full h-full"
                poster=""
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：方案 + 分段 */}
        <div className="lg:col-span-2 space-y-6">
          {/* MasterPlan 预览 */}
          {plan && (
            <Card className="border-white/5 bg-white/[0.02]">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-white/60 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    方案概览
                  </CardTitle>
                  {job.status === "awaiting_confirmation" && (
                    <button
                      onClick={() => setIsEditingPlan(!isEditingPlan)}
                      className={cn(
                        "text-[10px] px-2 py-1 rounded flex items-center gap-1 transition-colors",
                        isEditingPlan
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-white/5 text-white/30 hover:text-white/50"
                      )}
                    >
                      <Pencil className="h-3 w-3" />
                      {isEditingPlan ? "编辑中" : "编辑提示词"}
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* 脚本 */}
                <div>
                  <p className="text-[10px] text-white/20 mb-1">{isV2Plan ? '完整转录' : '完整脚本'}</p>
                  <p className="text-xs text-white/50 line-clamp-4">
                    {isV2Plan
                      ? (plan as CloneSpecV2).source_analysis?.transcript_full || '(无转录)'
                      : (plan as MasterPlan).full_script || '(无脚本)'
                    }
                  </p>
                </div>

                {/* 风格 */}
                <div className="flex flex-wrap gap-1.5">
                  {plan.style_bible?.color_temp && (
                    <Badge variant="outline" className="text-[10px] h-5 bg-white/5 border-white/10 text-white/30">
                      🎨 {plan.style_bible.color_temp}
                    </Badge>
                  )}
                  {plan.style_bible?.lighting && (
                    <Badge variant="outline" className="text-[10px] h-5 bg-white/5 border-white/10 text-white/30">
                      💡 {plan.style_bible.lighting}
                    </Badge>
                  )}
                  {plan.style_bible?.mood && (
                    <Badge variant="outline" className="text-[10px] h-5 bg-white/5 border-white/10 text-white/30">
                      🎭 {plan.style_bible.mood}
                    </Badge>
                  )}
                  {plan.style_bible?.pacing && (
                    <Badge variant="outline" className="text-[10px] h-5 bg-white/5 border-white/10 text-white/30">
                      ⏱ {plan.style_bible.pacing}
                    </Badge>
                  )}
                </div>

                {/* 可编辑的分段提示词 (P3-13) */}
                {isEditingPlan && plan.segments && (
                  <div className="space-y-2 border-t border-white/5 pt-3">
                    <p className="text-[10px] text-amber-400/60">↓ 编辑每段的视觉目标描述</p>
                    {plan.segments.map((seg, idx) => {
                      const roleLabels: Record<string, string> = {
                        hook: "🎯 开场", body: "📋 主体", demo: "🔍 演示",
                        proof: "✅ 证言", cta: "📢 号召", b_roll: "🎬 B-Roll",
                      };
                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-white/20 shrink-0">
                              第{idx + 1}段 {roleLabels[seg.role] || seg.role}
                            </span>
                            {isV2Plan && (seg as unknown as Record<string, unknown>).source_span_seconds != null ? (
                              <>
                                <span className="text-[10px] text-white/10">源段: {Number((seg as unknown as Record<string, unknown>).source_span_seconds)}s</span>
                                <span className="text-[10px] text-white/10">生成: {Number((seg as unknown as Record<string, unknown>).generation_duration_seconds)}s</span>
                              </>
                            ) : (
                              <span className="text-[10px] text-white/10">{seg.target_seconds}s</span>
                            )}
                          </div>
                          <Textarea
                            value={editedPrompts[idx] ?? (isV2Plan ? (seg as unknown as { spoken_text_exact?: string }).spoken_text_exact || '' : (seg as unknown as { visual_goal?: string }).visual_goal || '')}
                            onChange={(e) => setEditedPrompts(prev => ({
                              ...prev,
                              [idx]: e.target.value,
                            }))}
                            rows={2}
                            className="bg-white/5 border-white/10 text-xs text-white/60 placeholder:text-white/15 focus:border-amber-500/30 resize-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 预估 + 模式提示 */}
                <div className="flex gap-4 text-[10px] text-white/20">
                  <span>预估积分: {plan.estimated_cost}</span>
                  <span>预估耗时: {Math.round(plan.estimated_time / 60)} 分钟</span>
                  <span>分段数: {plan.segments?.length || 0}</span>
                  {selectedMode === 'chain_extend' && (
                    <span className="text-purple-400/50">🎯 Grok 链式生成</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 分段列表 */}
          {segments.length > 0 && (
            <Card className="border-white/5 bg-white/[0.02]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-white/60 flex items-center gap-2">
                  <Film className="h-4 w-4" />
                  分段详情
                  <span className="text-[10px] text-white/20 ml-auto">
                    {segments.filter(s => s.status === "ready" || s.status === "stitched").length}/{segments.length} 完成
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {segments.map((segment) => (
                  <SegmentCard
                    key={segment.id}
                    segment={segment}
                    onRetry={() => doAction("retry-segment", { segment_id: segment.id })}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右侧：信息 + 事件流 */}
        <div className="space-y-6">
          {/* Job 信息 */}
          <Card className="border-white/5 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-white/60">任务信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-white/20">ID</span>
                <span className="text-white/40 font-mono text-[10px]">{job.id.substring(0, 8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/20">入口</span>
                <span className="text-white/40">{job.entry_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/20">比例</span>
                <span className="text-white/40">{job.aspect_ratio}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/20">分辨率</span>
                <span className="text-white/40">{job.target_resolution}</span>
              </div>
              {job.source_url && (
                <div className="flex justify-between">
                  <span className="text-white/20">源链接</span>
                  <a href={job.source_url} target="_blank" rel="noopener noreferrer"
                    className="text-cyan-400/60 hover:text-cyan-400 text-[10px] truncate max-w-[120px]">
                    {job.source_url.substring(0, 30)}...
                  </a>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-white/20">已花费</span>
                <span className="text-white/40">{job.spent_minor} 积分</span>
              </div>
              {job.budget_minor > 0 && (
                <div className="flex justify-between">
                  <span className="text-white/20">预算</span>
                  <span className={cn("text-white/40", job.budget_exhausted && "text-red-400")}>
                    {job.spent_minor}/{job.budget_minor} 积分
                    {job.budget_exhausted && " (已耗尽)"}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 事件时间线 */}
          <Card className="border-white/5 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-white/60 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                事件流
              </CardTitle>
            </CardHeader>
            <CardContent>
              {events.length > 0 ? (
                <EventTimeline events={events} />
              ) : (
                <p className="text-[10px] text-white/15 text-center py-4">暂无事件</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
