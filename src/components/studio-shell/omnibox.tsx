"use client";

/**
 * Omnibox - Studio 统一提交器(S1)
 *
 * 铁律(STUDIO_REDESIGN_PLAN §三):omnibox 是"提交器",不是"聊天窗"。
 * 模式切换器是模式的唯一真值;自动意图判定永不代提交;
 * 大批量/高积分强制二次确认(红队裁决)。
 */

import { useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Minus, Plus, Send, X, Zap, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  getAvailableDurations,
  getAvailableQualities,
  type VideoAspectRatio,
  type VideoDuration,
  type VideoModelType,
  type VideoQuality,
} from "@/types/video-batch";
import {
  estimateCredits,
  validateDraft,
  VIDEO_MODEL_LABELS,
  type ImageParams,
  type StudioDraft,
  type StudioMode,
  type VideoParams,
} from "./use-studio-submit";

// ============================================================================
// 附件类型(上传由页面层负责,omnibox 只展示与移除)
// ============================================================================

export interface StudioAttachment {
  id: string;
  previewUrl: string;
  status: "uploading" | "done" | "failed";
  url?: string;
  name?: string;
}

interface OmniboxProps {
  attachments: StudioAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  credits: number | null;
  onSubmit: (draft: StudioDraft) => boolean; // 返回是否提交成功(成功则清空输入)
}

const MODES: { key: StudioMode; label: string }[] = [
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
];

const IMAGE_ASPECT_OPTIONS = ["auto", "1:1", "9:16", "16:9", "3:4", "4:3"];
const VIDEO_MODEL_OPTIONS = Object.keys(VIDEO_MODEL_LABELS) as VideoModelType[];

/** 强制二次确认阈值(红队裁决:大批量/高积分误判会摧毁信任) */
const CONFIRM_COUNT_THRESHOLD = 10;
const CONFIRM_CREDITS_THRESHOLD = 1000;

export function Omnibox({
  attachments,
  onAddFiles,
  onRemoveAttachment,
  credits,
  onSubmit,
}: OmniboxProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<StudioMode>("image");
  const [count, setCount] = useState(1);
  const [videoParams, setVideoParams] = useState<VideoParams>({
    modelType: "sora2",
    aspectRatio: "9:16",
    durationSeconds: 12,
    quality: "standard",
  });
  const [imageParams, setImageParams] = useState<ImageParams>({
    aspectRatio: "auto",
    resolution: "1k",
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploading = attachments.some((a) => a.status === "uploading");
  // 失败附件阻断发送:否则实际提交内容与用户所见不符(失败图被静默剔除)
  const hasFailedAttachment = attachments.some((a) => a.status === "failed");
  const attachmentUrls = useMemo(
    () => attachments.filter((a) => a.status === "done" && a.url).map((a) => a.url!),
    [attachments]
  );

  const draft: StudioDraft = useMemo(
    () => ({
      mode,
      text,
      attachmentUrls,
      video: videoParams,
      image: imageParams,
      count,
    }),
    [mode, text, attachmentUrls, videoParams, imageParams, count]
  );

  const estimated = useMemo(() => estimateCredits(draft), [draft]);
  const validationError = validateDraft(draft);
  const insufficientCredits = credits !== null && credits < estimated;
  const sendDisabled = uploading || hasFailedAttachment || !!validationError || insufficientCredits;

  const changeVideoModel = (modelType: VideoModelType) => {
    setVideoParams((prev) => {
      const qualities = getAvailableQualities(modelType);
      const quality: VideoQuality = qualities.includes(prev.quality) ? prev.quality : qualities[0];
      const durations = getAvailableDurations(modelType, quality);
      const durationSeconds: VideoDuration = durations.includes(prev.durationSeconds)
        ? prev.durationSeconds
        : durations[0];
      return { ...prev, modelType, quality, durationSeconds };
    });
  };

  const doSubmit = () => {
    const ok = onSubmit(draft);
    if (ok) {
      setText("");
      setCount(1);
    }
  };

  const handleSend = () => {
    if (sendDisabled) return;
    if (count > CONFIRM_COUNT_THRESHOLD || estimated > CONFIRM_CREDITS_THRESHOLD) {
      setConfirmOpen(true);
      return;
    }
    doSubmit();
  };

  const durations = getAvailableDurations(videoParams.modelType, videoParams.quality);
  const qualities = getAvailableQualities(videoParams.modelType);

  return (
    <div className="pointer-events-auto mx-auto w-full max-w-[760px] rounded-2xl border border-white/10 bg-zinc-900/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
      {/* 附件 chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-white/5 px-4 pt-3 pb-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="group relative h-14 w-14 overflow-hidden rounded-lg border border-white/10 bg-black/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.previewUrl}
                alt={att.name ?? "素材"}
                className={cn(
                  "h-full w-full object-cover",
                  att.status === "failed" && "opacity-40"
                )}
              />
              {att.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                </div>
              )}
              {att.status === "failed" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] text-red-400">
                  上传失败
                </div>
              )}
              <button
                type="button"
                onClick={() => onRemoveAttachment(att.id)}
                className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/70 p-0.5 text-zinc-300 hover:text-white group-hover:block"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 参数 chips 行 */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        {/* 模式切换器(唯一真值) */}
        <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                mode === m.key
                  ? "bg-white/15 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "video" ? (
          <>
            <Select value={videoParams.modelType} onValueChange={(v) => changeVideoModel(v as VideoModelType)}>
              <SelectTrigger className="h-7 w-auto gap-1 border-white/10 bg-black/30 px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {VIDEO_MODEL_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={videoParams.aspectRatio}
              onValueChange={(v) => setVideoParams((p) => ({ ...p, aspectRatio: v as VideoAspectRatio }))}
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-white/10 bg-black/30 px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["9:16", "16:9"] as const).map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(videoParams.durationSeconds)}
              onValueChange={(v) => setVideoParams((p) => ({ ...p, durationSeconds: Number(v) as VideoDuration }))}
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-white/10 bg-black/30 px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {durations.map((d) => (
                  <SelectItem key={d} value={String(d)} className="text-xs">{d}s</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {qualities.length > 1 && (
              <Select
                value={videoParams.quality}
                onValueChange={(v) => {
                  const quality = v as VideoQuality;
                  setVideoParams((p) => {
                    const ds = getAvailableDurations(p.modelType, quality);
                    return {
                      ...p,
                      quality,
                      durationSeconds: ds.includes(p.durationSeconds) ? p.durationSeconds : ds[0],
                    };
                  });
                }}
              >
                <SelectTrigger className="h-7 w-auto gap-1 border-white/10 bg-black/30 px-2.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {qualities.map((q) => (
                    <SelectItem key={q} value={q} className="text-xs">
                      {q === "hd" ? "高清" : "标准"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        ) : (
          <>
            <Select
              value={imageParams.aspectRatio}
              onValueChange={(v) => setImageParams((p) => ({ ...p, aspectRatio: v }))}
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-white/10 bg-black/30 px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_ASPECT_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">
                    {r === "auto" ? "自动比例" : r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={imageParams.resolution}
              onValueChange={(v) => setImageParams((p) => ({ ...p, resolution: v as ImageParams["resolution"] }))}
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-white/10 bg-black/30 px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["1k", "2k", "4k"] as const).map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">{r.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        {/* 数量 stepper */}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-1 py-0.5">
          <button
            type="button"
            onClick={() => setCount((c) => Math.max(1, c - 1))}
            className="rounded p-1 text-zinc-400 hover:text-white"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="min-w-[3ch] text-center text-xs tabular-nums text-zinc-200">
            ×{count}
          </span>
          <button
            type="button"
            onClick={() => setCount((c) => Math.min(100, c + 1))}
            className="rounded p-1 text-zinc-400 hover:text-white"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 输入区 */}
      <div className="flex items-end gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 rounded-lg border border-white/10 bg-black/30 p-2 text-zinc-400 transition-colors hover:text-white"
          title="添加素材图"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled
          className="shrink-0 cursor-not-allowed rounded-lg border border-white/10 bg-black/30 p-2 text-zinc-600"
          title="@角色(S1.4 开放)"
        >
          <AtSign className="h-4 w-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onAddFiles(files);
            e.target.value = "";
          }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // keyCode 229 守卫:Safari 在 compositionend 后才派发确认候选词的
            // Enter keydown,此时 isComposing 已为 false,仅靠它会误触发提交
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            mode === "video"
              ? "描述你要的视频,或拖入素材图(拖图+文字=图生视频)…"
              : "描述你要的图片,可拖入参考图…"
          }
          rows={2}
          className="max-h-40 min-h-[52px] flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {hasFailedAttachment ? (
            <span className="text-[11px] text-red-400">有素材上传失败,移除后可发送</span>
          ) : (
            <span
              className={cn(
                "flex items-center gap-1 text-[11px] tabular-nums",
                insufficientCredits ? "text-red-400" : "text-zinc-500"
              )}
            >
              <Zap className="h-3 w-3" />
              {count > 1 ? `${count} 条 ≈ ${estimated}` : `≈ ${estimated}`}
              {credits !== null && <span className="text-zinc-600">/ 余额 {credits}</span>}
            </span>
          )}
          <Button
            size="sm"
            variant="mermaid"
            disabled={sendDisabled}
            onClick={handleSend}
            className="h-8 gap-1.5 px-4"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            发送
          </Button>
        </div>
      </div>

      {/* 大批量/高积分二次确认 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量提交</AlertDialogTitle>
            <AlertDialogDescription>
              将提交 {count} 个{mode === "video" ? "视频" : "图片"}任务,预估消耗{" "}
              <span className="font-semibold text-amber-500 tabular-nums">{estimated}</span> 积分
              {credits !== null && <>(当前余额 {credits})</>}。积分按任务在服务端逐条扣除,失败自动退款。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                doSubmit();
              }}
            >
              确认提交
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
