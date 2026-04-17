"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Link2,
  FileText,
  Sparkles,
  Loader2,
  Plus,
  Video,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Zap,
  Image as ImageIcon,
  Smartphone,
  Monitor,
  X,
  ImagePlus,
} from "lucide-react";
import type { ViralCloneJob, AspectRatio } from "@/types/viral-clone";
import { JOB_STATUS_LABELS } from "@/types/viral-clone";

// ============================================================================
// 入口卡片组件
// ============================================================================

function EntryCard({
  icon: Icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all duration-300 text-left group",
        active
          ? "border-[hsl(174,100%,47%)] bg-[hsl(174,100%,47%)]/5 shadow-[0_0_30px_rgba(0,242,234,0.1)]"
          : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
      )}
    >
      <div
        className={cn(
          "w-14 h-14 rounded-xl flex items-center justify-center transition-all",
          active
            ? "bg-gradient-to-br from-[hsl(174,100%,47%)] to-[hsl(174,100%,35%)] text-black shadow-[0_0_20px_rgba(0,242,234,0.3)]"
            : "bg-white/5 text-white/40 group-hover:text-white/60"
        )}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="text-center">
        <p className={cn("font-semibold text-sm", active ? "text-white" : "text-white/60")}>
          {title}
        </p>
        <p className="text-xs text-white/30 mt-1">{description}</p>
      </div>
    </button>
  );
}

// ============================================================================
// Job 列表项组件
// ============================================================================

function JobCard({ job }: { job: ViralCloneJob }) {
  const router = useRouter();

  const statusColors: Record<string, string> = {
    created: "bg-white/10 text-white/50",
    ingesting: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    analyzing: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    planning: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    awaiting_confirmation: "bg-teal-500/10 text-teal-400 border-teal-500/30 animate-pulse",
    generating: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30 animate-pulse",
    stitching: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
    upscaling: "bg-pink-500/10 text-pink-400 border-pink-500/30",
    completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/10 text-red-400 border-red-500/30",
    manual_review: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  };

  const entryIcons: Record<string, React.ElementType> = {
    upload: Upload,
    link: Link2,
    prompt: FileText,
  };
  const EntryIcon = entryIcons[job.entry_type] || FileText;

  const isActive = ["ingesting", "analyzing", "planning", "generating", "stitching", "upscaling"].includes(job.status);

  return (
    <button
      onClick={() => router.push(`/viral-clone/${job.id}`)}
      className={cn(
        "w-full text-left p-4 rounded-2xl border transition-all duration-300 group",
        "border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
        isActive && "border-[hsl(174,100%,47%)]/20"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
            isActive ? "bg-[hsl(174,100%,47%)]/10" : "bg-white/5"
          )}>
            <EntryIcon className={cn("h-5 w-5", isActive ? "text-[hsl(174,100%,47%)]" : "text-white/30")} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white/80 truncate">
              {job.entry_type === 'upload' ? '视频上传' : job.entry_type === 'link' ? '链接导入' : '提示词生成'}
              <span className="text-white/20 ml-2 text-xs">
                {new Date(job.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </p>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={cn("text-[10px] h-5", statusColors[job.status] || statusColors.created)}>
                {JOB_STATUS_LABELS[job.status] || job.status}
              </Badge>
              {job.total_segments > 0 && (
                <span className="text-[10px] text-white/30">
                  {job.completed_segments}/{job.total_segments} 段
                </span>
              )}
            </div>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-white/10 group-hover:text-white/30 shrink-0 mt-1 transition-colors" />
      </div>
    </button>
  );
}

// ============================================================================
// 主页面
// ============================================================================

export default function ViralClonePage() {
  const router = useRouter();
  const { toast } = useToast();

  // 入口选择
  const [activeEntry, setActiveEntry] = useState<"upload" | "link" | "prompt">("upload");

  // 表单状态
  const [linkUrl, setLinkUrl] = useState("");
  const [promptText, setPromptText] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 参考图
  const [refImages, setRefImages] = useState<{ url: string; name: string }[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Job 列表
  const [jobs, setJobs] = useState<ViralCloneJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  // 文件上传
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 加载任务列表
  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/viral-clone/jobs');
      const data = await res.json();
      if (data.success) {
        setJobs(data.data.jobs);
      }
    } catch {
      // 忽略
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // ==================== 上传处理 ====================

  const handleUpload = async (file: File) => {
    setIsSubmitting(true);
    try {
      // 1. 获取上传凭证
      const initRes = await fetch('/api/viral-clone/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type,
          file_size: file.size,
        }),
      });
      const initData = await initRes.json();
      if (!initData.success) throw new Error(initData.error);

      // 2. 上传到 OSS
      await fetch(initData.data.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      // 3. 确认上传
      await fetch('/api/viral-clone/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: initData.data.job_id,
          asset_id: initData.data.asset_id,
        }),
      });

      toast({ title: '上传成功', description: '正在分析视频...' });
      router.push(`/viral-clone/${initData.data.job_id}`);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '上传失败',
        description: error instanceof Error ? error.message : '请重试',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==================== 链接导入 ====================

  const handleLinkSubmit = async () => {
    if (!linkUrl.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/viral-clone/ingest/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkUrl, aspect_ratio: aspectRatio }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.fallback_message);

      toast({ title: '链接已提交', description: '正在下载视频...' });
      router.push(`/viral-clone/${data.data.job_id}`);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '导入失败',
        description: error instanceof Error ? error.message : '请直接上传原视频',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==================== 参考图上传 ====================

  const handleRefImageUpload = async (file: File) => {
    if (refImages.length >= 3) {
      toast({ variant: 'destructive', title: '最多 3 张参考图' });
      return;
    }
    setUploadingImage(true);
    try {
      // 1. 获取上传凭证
      const credRes = await fetch('/api/viral-clone/upload/image-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content_type: file.type }),
      });
      const credData = await credRes.json();
      if (!credData.success) throw new Error(credData.error);

      // 2. 上传到 OSS
      await fetch(credData.data.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      setRefImages(prev => [...prev, { url: credData.data.public_url, name: file.name }]);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '图片上传失败',
        description: error instanceof Error ? error.message : '请重试',
      });
    } finally {
      setUploadingImage(false);
    }
  };

  const removeRefImage = (index: number) => {
    setRefImages(prev => prev.filter((_, i) => i !== index));
  };

  // ==================== 提示词入口 ====================

  const handlePromptSubmit = async () => {
    if (!promptText.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/viral-clone/ingest/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          aspect_ratio: aspectRatio,
          ref_image_urls: refImages.map(img => img.url),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      toast({ title: '已提交', description: '正在生成方案...' });
      router.push(`/viral-clone/${data.data.job_id}`);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '提交失败',
        description: error instanceof Error ? error.message : '请重试',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(174,100%,47%)] to-[hsl(200,100%,50%)] flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-black" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">爆款复制工作台</h1>
            <p className="text-sm text-white/40">Viral Clone V1.5 · VEO3 + Qwen + FFmpeg</p>
          </div>
        </div>
      </div>

      {/* 新建任务区 */}
      <Card className="border-white/5 bg-white/[0.02] backdrop-blur-sm shadow-2xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-white/80 flex items-center gap-2">
            <Plus className="h-5 w-5 text-[hsl(174,100%,47%)]" />
            新建复制任务
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 入口选择 */}
          <div className="grid grid-cols-3 gap-3">
            <EntryCard
              icon={Upload}
              title="上传视频"
              description="上传爆款视频，AI 自动分析复制"
              active={activeEntry === "upload"}
              onClick={() => setActiveEntry("upload")}
            />
            <EntryCard
              icon={Link2}
              title="粘贴链接"
              description="TikTok / 抖音视频链接"
              active={activeEntry === "link"}
              onClick={() => setActiveEntry("link")}
            />
            <EntryCard
              icon={FileText}
              title="直接描述"
              description="输入提示词，AI 全自动生成"
              active={activeEntry === "prompt"}
              onClick={() => setActiveEntry("prompt")}
            />
          </div>

          {/* 画面比例选择 */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/30">画面比例</span>
            <div className="flex gap-2">
              <button
                onClick={() => setAspectRatio("9:16")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all",
                  aspectRatio === "9:16"
                    ? "bg-[hsl(174,100%,47%)]/10 text-[hsl(174,100%,47%)] border border-[hsl(174,100%,47%)]/30"
                    : "bg-white/5 text-white/30 border border-white/5 hover:border-white/10"
                )}
              >
                <Smartphone className="h-3 w-3" /> 9:16 竖屏
              </button>
              <button
                onClick={() => setAspectRatio("16:9")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all",
                  aspectRatio === "16:9"
                    ? "bg-[hsl(174,100%,47%)]/10 text-[hsl(174,100%,47%)] border border-[hsl(174,100%,47%)]/30"
                    : "bg-white/5 text-white/30 border border-white/5 hover:border-white/10"
                )}
              >
                <Monitor className="h-3 w-3" /> 16:9 横屏
              </button>
            </div>
          </div>

          {/* 入口表单 */}
          {activeEntry === "upload" && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
                className={cn(
                  "w-full flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-2xl transition-all",
                  isSubmitting
                    ? "border-white/10 bg-white/[0.02] cursor-wait"
                    : "border-white/10 hover:border-[hsl(174,100%,47%)]/30 hover:bg-[hsl(174,100%,47%)]/[0.02] cursor-pointer"
                )}
              >
                {isSubmitting ? (
                  <Loader2 className="h-10 w-10 text-[hsl(174,100%,47%)] animate-spin mb-3" />
                ) : (
                  <Upload className="h-10 w-10 text-white/20 mb-3" />
                )}
                <p className="text-sm text-white/50">
                  {isSubmitting ? "上传中..." : "点击选择或拖拽视频文件"}
                </p>
                <p className="text-xs text-white/20 mt-1">支持 MP4、MOV、WebM</p>
              </button>
            </div>
          )}

          {activeEntry === "link" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="粘贴 TikTok / 抖音 视频链接..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[hsl(174,100%,47%)]/30 focus:ring-1 focus:ring-[hsl(174,100%,47%)]/20"
                />
                <Button
                  onClick={handleLinkSubmit}
                  disabled={!linkUrl.trim() || isSubmitting}
                  className="bg-[hsl(174,100%,47%)] text-black hover:bg-[hsl(174,100%,42%)] px-6"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "导入"}
                </Button>
              </div>
              <p className="text-xs text-white/20">支持 TikTok 和抖音公开视频链接 (best effort)</p>
            </div>
          )}

          {activeEntry === "prompt" && (
            <div className="space-y-3">
              <Textarea
                placeholder="描述你想要制作的视频...&#10;例如: 一个年轻女性在现代厨房中展示新款空气炸锅，对着镜头介绍产品特点和使用方法"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={4}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-[hsl(174,100%,47%)]/30 resize-none"
              />

              {/* 参考图上传区 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/30">参考图（可选, 最多 3 张）</span>
                  {refImages.length > 0 && (
                    <span className="text-[10px] text-emerald-400">{refImages.length}/3</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {refImages.map((img, idx) => (
                    <div key={idx} className="relative group">
                      <div className="w-16 h-16 rounded-lg overflow-hidden border border-white/10 bg-white/5">
                        <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                      </div>
                      <button
                        onClick={() => removeRefImage(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {refImages.length < 3 && (
                    <>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleRefImageUpload(file);
                          e.target.value = '';
                        }}
                      />
                      <button
                        onClick={() => imageInputRef.current?.click()}
                        disabled={uploadingImage}
                        className={cn(
                          "w-16 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-all",
                          uploadingImage
                            ? "border-white/10 cursor-wait"
                            : "border-white/10 hover:border-[hsl(174,100%,47%)]/30 hover:bg-[hsl(174,100%,47%)]/[0.02] cursor-pointer"
                        )}
                      >
                        {uploadingImage ? (
                          <Loader2 className="h-4 w-4 text-white/20 animate-spin" />
                        ) : (
                          <ImagePlus className="h-4 w-4 text-white/15" />
                        )}
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-white/15">产品图、人物图、场景参考 — 提升分段间视觉一致性</p>
              </div>

              <div className="flex items-center justify-between">
                {refImages.length === 0 ? (
                  <p className="text-xs text-amber-400/50 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    无参考图时连续性可能下降
                  </p>
                ) : (
                  <p className="text-xs text-emerald-400/50 flex items-center gap-1">
                    已添加 {refImages.length} 张参考图
                  </p>
                )}
                <Button
                  onClick={handlePromptSubmit}
                  disabled={!promptText.trim() || isSubmitting}
                  className="bg-[hsl(174,100%,47%)] text-black hover:bg-[hsl(174,100%,42%)] px-6"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <>
                      <Zap className="h-4 w-4 mr-1" />
                      开始生成
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 历史任务列表 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white/70 flex items-center gap-2">
            <Clock className="h-5 w-5 text-white/30" />
            历史任务
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadJobs}
            className="text-white/30 hover:text-white/50"
          >
            刷新
          </Button>
        </div>

        {loadingJobs ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 text-white/20 animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12">
            <Video className="h-12 w-12 text-white/10 mx-auto mb-3" />
            <p className="text-sm text-white/30">还没有任务，从上方开始创建</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
