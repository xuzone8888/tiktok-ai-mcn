"use client";

/**
 * Omnibox - Studio 统一提交器(S1)
 *
 * 铁律(STUDIO_REDESIGN_PLAN §三):omnibox 是"提交器",不是"聊天窗"。
 * 模式切换器是模式的唯一真值;自动意图判定永不代提交;
 * 大批量/高积分强制二次确认(红队裁决)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Link2,
  Loader2,
  Minus,
  Package,
  Plus,
  Send,
  Video,
  X,
  Zap,
} from "lucide-react";
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
  DECONSTRUCT_ENABLED,
  estimateCredits,
  validateDraft,
  VIDEO_MODEL_LABELS,
  type ImageParams,
  type SlideshowParams,
  type StudioDraft,
  type StudioMode,
  type VideoParams,
} from "./use-studio-submit";
import type { ProductCard } from "@/lib/studio/product-vision";
import { CharacterPicker, type CharacterOption } from "@/components/character-picker";
import type { CharacterAssetSnapshot } from "@/lib/character-assets";

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
  /** 链接腿(S2.1):解析出的 OSS 商品图直接注入附件链路(status=done) */
  onAddRemoteImages?: (urls: string[]) => void;
  /** 链接腿:按 URL 批量移除附件(换链接/清卡时收走上一链接注入的图,防混料) */
  onRemoveAttachmentsByUrl?: (urls: string[]) => void;
  credits: number | null;
  onSubmit: (draft: StudioDraft) => Promise<boolean>; // 返回是否提交成功(成功则清空输入)
}

const MODES: { key: StudioMode; label: string }[] = [
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "slideshow", label: "幻灯片" },
  { key: "product", label: "商品成片" },
  // 门B(S3.3):20 条真实爆款基准达标前 flag 关闭(红队裁决)
  ...(DECONSTRUCT_ENABLED ? [{ key: "deconstruct" as StudioMode, label: "爆款拆解" }] : []),
];

/** 门B 上传限制:客户端预检(预签名 PUT 本身不校验大小) */
const DECONSTRUCT_MAX_MB = 200;

const IMAGE_ASPECT_OPTIONS = ["auto", "1:1", "9:16", "16:9", "3:4", "4:3"];
const VIDEO_MODEL_OPTIONS = Object.keys(VIDEO_MODEL_LABELS) as VideoModelType[];

const SLIDESHOW_TRANSITIONS: { value: string; label: string }[] = [
  { value: "fade", label: "淡入淡出" },
  { value: "slideleft", label: "左滑" },
  { value: "wipeleft", label: "擦除" },
  { value: "circleopen", label: "圆形展开" },
  { value: "none", label: "硬切" },
];

/** 幻灯片模式的开关 chip */
function ToggleChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-sky-400/50 bg-sky-500/15 text-sky-300"
          : "border-white/10 bg-black/30 text-zinc-500 hover:text-zinc-300"
      )}
    >
      {label}
    </button>
  );
}

/** 强制二次确认阈值(红队裁决:大批量/高积分误判会摧毁信任) */
const CONFIRM_COUNT_THRESHOLD = 10;
const CONFIRM_CREDITS_THRESHOLD = 1000;

/** 从贴入文本提取第一个 http(s) URL(服务端镜像在 reference-parser.extractFirstUrl) */
function detectPastedUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>)\]]+/i);
  return match ? match[0] : null;
}

export function Omnibox({
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onAddRemoteImages,
  onRemoveAttachmentsByUrl,
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
  const [slideshowParams, setSlideshowParams] = useState<SlideshowParams>({
    aspectRatio: "9:16",
    durationPerImage: 2,
    transition: "fade",
    kenburns: true,
    voiceEnabled: true,
    bgmEnabled: true,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ==================== @角色(S1.4:image/video 模式可用) ====================
  const [character, setCharacter] = useState<CharacterAssetSnapshot | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const characterApplicable = mode === "image" || mode === "video";

  const handleCharacterSelect = (option: CharacterOption | null) => {
    setCharacter(option?.characterAsset ?? null);
    setPickerOpen(false);
  };

  // ==================== 商品成片:渲染腿(S2.3/S3.1) ====================
  // 幻灯片(默认,分级积分)| AI 逐镜生成(video 参数计价)| 拼装口播(1分/镜)
  const [productRenderMode, setProductRenderMode] = useState<
    "slideshow" | "ai_gen" | "assembly"
  >("slideshow");

  // ==================== 爆款拆解(门B,S3.3):mp4 预签名直传 + 权利勾选 ====================
  const [deconstructVideo, setDeconstructVideo] = useState<{
    name: string;
    url?: string;
    status: "uploading" | "done" | "failed";
    progress: number;
    error?: string;
  } | null>(null);
  const [deconstructRightsAck, setDeconstructRightsAck] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // 上传代际:换文件时旧上传的迟到回调作废
  const videoUploadNonceRef = useRef(0);

  const uploadDeconstructVideo = async (file: File) => {
    if (!/\.(mp4|mov|webm)$/i.test(file.name) && !file.type.startsWith("video/")) {
      setDeconstructVideo({ name: file.name, status: "failed", progress: 0, error: "只支持 mp4/mov/webm" });
      return;
    }
    if (file.size > DECONSTRUCT_MAX_MB * 1024 * 1024) {
      setDeconstructVideo({
        name: file.name,
        status: "failed",
        progress: 0,
        error: `视频超过 ${DECONSTRUCT_MAX_MB}MB,请压缩后再传`,
      });
      return;
    }
    const nonce = ++videoUploadNonceRef.current;
    setDeconstructVideo({ name: file.name, status: "uploading", progress: 3 });
    try {
      const credRes = await fetch("/api/upload/oss-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "video/mp4" }),
      });
      const cred = await credRes.json();
      if (!credRes.ok || !cred?.success || !cred.data?.uploadUrl) {
        throw new Error(cred?.error || "获取上传凭证失败");
      }
      const publicUrl: string = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && nonce === videoUploadNonceRef.current) {
            setDeconstructVideo((v) =>
              v ? { ...v, progress: Math.round(5 + (e.loaded / e.total) * 92) } : v
            );
          }
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve(cred.data.publicUrl)
            : reject(new Error(`上传失败 (${xhr.status})`));
        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.ontimeout = () => reject(new Error("上传超时"));
        xhr.open("PUT", cred.data.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.timeout = 600_000;
        xhr.send(file);
      });
      if (nonce !== videoUploadNonceRef.current) return;
      setDeconstructVideo({ name: file.name, url: publicUrl, status: "done", progress: 100 });
    } catch (e) {
      if (nonce !== videoUploadNonceRef.current) return;
      setDeconstructVideo({
        name: file.name,
        status: "failed",
        progress: 0,
        error: e instanceof Error ? e.message : "上传失败",
      });
    }
  };

  // ==================== 商品成片:自动分析商品卡 ====================
  const [productCard, setProductCard] = useState<ProductCard | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [cardPanelOpen, setCardPanelOpen] = useState(false);
  // 已成功分析的图片集合指纹,避免重复分析(仅成功后写入)
  const analyzedKeyRef = useRef<string>("");
  // 失败重试信号:effect 依赖之一,点重试即重跑分析
  const [analyzeNonce, setAnalyzeNonce] = useState(0);
  // 商品卡来源:'images'=拖图视觉分析 / 'link'=链接解析(S2.1)。
  // link 来源的卡不被图片分析 effect 覆盖(注入附件会改变图片指纹)
  const [cardSource, setCardSource] = useState<"images" | "link" | null>(null);

  // ==================== 商品成片:贴链接解析(S2.1 链接腿) ====================
  const [linkChip, setLinkChip] = useState<{
    url: string;
    status: "parsing" | "done" | "failed";
    error?: string;
  } | null>(null);
  // 非商品模式贴入链接时的切换建议(自动意图判定永不代切换/代提交——红队裁决)
  const [linkHint, setLinkHint] = useState<string | null>(null);
  // 解析请求代际:旧响应回来时若代际不符则丢弃(用户连续贴两个链接)
  const linkNonceRef = useRef(0);
  // 当前链接注入的附件 URL(换链接/清卡时按此收走,防两商品素材混料)
  const linkInjectedUrlsRef = useRef<string[]>([]);

  const removeInjectedAttachments = () => {
    if (linkInjectedUrlsRef.current.length > 0) {
      onRemoveAttachmentsByUrl?.(linkInjectedUrlsRef.current);
      linkInjectedUrlsRef.current = [];
    }
  };

  const startLinkParse = (url: string) => {
    const nonce = ++linkNonceRef.current;
    setLinkChip({ url, status: "parsing" });
    setLinkHint(null);
    fetch("/api/studio/parse-reference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then((res) => res.json())
      .then((result) => {
        if (nonce !== linkNonceRef.current) return;
        const card: ProductCard | undefined = result?.data?.card;
        if (result?.success && card) {
          setLinkChip({ url, status: "done" });
          setCardSource("link");
          setProductCard(card);
          setCardPanelOpen(true);
          setAnalyzeError(null);
          // 先收走上一链接注入的图,再注入本链接的(防两商品混进同一批素材)
          removeInjectedAttachments();
          if (card.images.length > 0) {
            linkInjectedUrlsRef.current = card.images;
            onAddRemoteImages?.(card.images);
          }
        } else {
          setLinkChip({ url, status: "failed", error: result?.error || "链接解析失败" });
        }
      })
      .catch(() => {
        if (nonce !== linkNonceRef.current) return;
        setLinkChip({ url, status: "failed", error: "链接解析失败,请重试" });
      });
  };

  const clearLinkCard = () => {
    linkNonceRef.current++;
    setLinkChip(null);
    removeInjectedAttachments();
    if (cardSource === "link") {
      setProductCard(null);
      setCardSource(null);
      setCardPanelOpen(false);
    }
  };

  // Esc 取消进行中的链接解析(角色浮层开着时让位给浮层的 Esc 关闭)
  useEffect(() => {
    if (linkChip?.status !== "parsing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pickerOpen) clearLinkCard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkChip?.status, pickerOpen]);

  const uploading = attachments.some((a) => a.status === "uploading");
  // 失败附件阻断发送:否则实际提交内容与用户所见不符(失败图被静默剔除)
  const hasFailedAttachment = attachments.some((a) => a.status === "failed");
  const attachmentUrls = useMemo(
    () => attachments.filter((a) => a.status === "done" && a.url).map((a) => a.url!),
    [attachments]
  );

  // 商品成片:附件全部上传完成后自动触发分析(仅预填商品卡,永不代提交——红队裁决)
  useEffect(() => {
    if (mode !== "product") return;
    // 链接解析出的卡是权威(含页面标题/价格),注入附件改变指纹时不得被视觉分析覆盖
    if (cardSource === "link") return;
    if (uploading || attachmentUrls.length < 2) return;
    const key = [...attachmentUrls].sort().join("|");
    // 指纹仅在成功后写入:被取消/失败的请求下一次符合条件的渲染会自然重发
    if (key === analyzedKeyRef.current) return;

    let cancelled = false;
    setAnalyzing(true);
    setAnalyzeError(null);
    setProductCard(null);
    fetch("/api/studio/analyze-product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrls: attachmentUrls }),
    })
      .then((res) => res.json())
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data?.card) {
          analyzedKeyRef.current = key;
          setProductCard(result.data.card);
          setCardSource("images");
        } else {
          setAnalyzeError(result.error || "商品图分析失败");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAnalyzeError("商品图分析失败,请重试");
      })
      .finally(() => {
        if (!cancelled) setAnalyzing(false);
      });
    return () => {
      cancelled = true;
      // 被取消的请求到不了上面的 finally,这里兜底复位 spinner
      setAnalyzing(false);
    };
  }, [mode, uploading, attachmentUrls, analyzeNonce, cardSource]);

  const toggleSellingPoint = (id: string) => {
    setProductCard((card) =>
      card
        ? {
            ...card,
            selling_points: card.selling_points.map((p) =>
              p.id === id ? { ...p, selected: !p.selected } : p
            ),
          }
        : card
    );
  };

  const draft: StudioDraft = useMemo(
    () => ({
      mode,
      text,
      attachmentUrls,
      character: characterApplicable && character ? character : undefined,
      video: videoParams,
      image: imageParams,
      slideshow: slideshowParams,
      productCard: mode === "product" ? productCard : undefined,
      linkUrl:
        mode === "product" && cardSource === "link" && linkChip?.status === "done"
          ? linkChip.url
          : undefined,
      productRenderMode: mode === "product" ? productRenderMode : undefined,
      deconstructVideo:
        mode === "deconstruct" && deconstructVideo?.status === "done" && deconstructVideo.url
          ? { url: deconstructVideo.url, name: deconstructVideo.name }
          : undefined,
      deconstructRightsAck: mode === "deconstruct" ? deconstructRightsAck : undefined,
      count: mode === "deconstruct" ? 1 : count,
    }),
    [
      mode,
      text,
      attachmentUrls,
      characterApplicable,
      character,
      videoParams,
      imageParams,
      slideshowParams,
      productCard,
      cardSource,
      linkChip,
      productRenderMode,
      deconstructVideo,
      deconstructRightsAck,
      count,
    ]
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

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const ok = await onSubmit(draft);
      if (ok) {
        setText("");
        setCount(1);
        setProductCard(null);
        setCardPanelOpen(false);
        analyzedKeyRef.current = "";
        setCardSource(null);
        setLinkChip(null);
        setLinkHint(null);
        linkNonceRef.current++;
        linkInjectedUrlsRef.current = []; // 附件已由页面层清空,指针同步复位
        setDeconstructVideo(null);
        setDeconstructRightsAck(false);
        videoUploadNonceRef.current++;
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = () => {
    if (sendDisabled || submitting) return;
    // 阈值按 draft.count(拆解模式恒 1):裸 count 会把其他模式遗留的 stepper
    // 值带进拆解模式,弹出内容错误的批量确认(审查实锤)
    if (draft.count > CONFIRM_COUNT_THRESHOLD || estimated > CONFIRM_CREDITS_THRESHOLD) {
      setConfirmOpen(true);
      return;
    }
    void doSubmit();
  };

  const durations = getAvailableDurations(videoParams.modelType, videoParams.quality);
  const qualities = getAvailableQualities(videoParams.modelType);

  return (
    <div className="pointer-events-auto relative mx-auto w-full max-w-[980px] rounded-2xl border border-white/10 bg-zinc-900/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
      {/* @角色选择面板(悬浮于 omnibox 上方) */}
      {pickerOpen && characterApplicable && (
        <div className="absolute inset-x-0 bottom-full mb-2 rounded-2xl border border-white/10 bg-zinc-900/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">@角色 · 一致性引用</span>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="rounded p-1 text-zinc-500 hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <CharacterPicker
            variant="inline"
            dataSource="all"
            selectedId={character?.id ?? null}
            onSelect={handleCharacterSelect}
            maxHeight="280px"
            title=""
          />
        </div>
      )}

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

      {/* 非商品模式贴入链接:切换建议 chip(不代切换,不代提交) */}
      {mode !== "product" && linkHint && (
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2 text-xs text-zinc-400">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1 truncate">检测到商品链接,切到商品成片可自动解析卖点</span>
          <button
            type="button"
            onClick={() => {
              setMode("product");
              startLinkParse(linkHint);
            }}
            className="shrink-0 rounded border border-amber-400/40 px-2 py-0.5 text-amber-300 hover:bg-amber-500/10"
          >
            切换并解析
          </button>
          <button
            type="button"
            onClick={() => setLinkHint(null)}
            className="shrink-0 text-zinc-600 hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 爆款拆解:视频 chip + 权利确认(门B,强制显式勾选) */}
      {mode === "deconstruct" && (
        <div className="space-y-2 border-b border-white/5 px-4 py-2">
          {deconstructVideo ? (
            <div className="flex items-center gap-2 text-xs">
              <Video className="h-3.5 w-3.5 shrink-0 text-rose-300" />
              {deconstructVideo.status === "uploading" ? (
                <span className="flex min-w-0 flex-1 items-center gap-2 text-rose-300">
                  <span className="truncate">{deconstructVideo.name}</span>
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span className="shrink-0 tabular-nums">{deconstructVideo.progress}%</span>
                </span>
              ) : deconstructVideo.status === "failed" ? (
                <span className="min-w-0 flex-1 truncate text-red-400">
                  {deconstructVideo.name}:{deconstructVideo.error}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-zinc-300">
                  {deconstructVideo.name}
                  <span className="ml-1 text-zinc-600">已上传</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  videoUploadNonceRef.current++;
                  setDeconstructVideo(null);
                }}
                className="flex shrink-0 items-center gap-1 rounded-md border border-white/15 px-2.5 py-1 text-zinc-400 transition-colors hover:border-red-400/40 hover:text-red-300"
              >
                <X className="h-3.5 w-3.5" />
                移除
              </button>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              上传一条爆款视频(mp4,≤{DECONSTRUCT_MAX_MB}MB)→ 出结构报告:hook 类型/逐镜台词/节奏/CTA——这条为什么火
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-zinc-400">
            <input
              type="checkbox"
              checked={deconstructRightsAck}
              onChange={(e) => setDeconstructRightsAck(e.target.checked)}
              className="mt-0.5 accent-rose-400"
            />
            <span>
              我确认拥有分析该视频的权利,且仅复用其<b className="text-zinc-300">结构与创意</b>
              ——原片画面与声音不会进入任何生成内容
            </span>
          </label>
        </div>
      )}

      {/* 商品成片:链接 chip + 商品卡 chip(解析中→完成态,点开勾卖点) */}
      {mode === "product" && (analyzing || productCard || analyzeError || linkChip) && (
        <div className="space-y-2 border-b border-white/5 px-4 py-2">
          {linkChip && (
            <div className="flex items-center gap-2 text-xs">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-sky-300" />
              {linkChip.status === "parsing" ? (
                <span className="flex min-w-0 flex-1 items-center gap-2 text-sky-300">
                  <span className="truncate">{linkChip.url}</span>
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span className="shrink-0">抓取商品页并提炼卖点…</span>
                </span>
              ) : linkChip.status === "failed" ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-red-400">
                    {linkChip.error}
                  </span>
                  <button
                    type="button"
                    onClick={() => startLinkParse(linkChip.url)}
                    className="shrink-0 rounded-md border border-red-400/40 px-2.5 py-1 text-red-300 transition-colors hover:bg-red-500/10"
                  >
                    重试
                  </button>
                </>
              ) : (
                <span className="min-w-0 flex-1 truncate text-zinc-400">
                  {(() => {
                    try {
                      return new URL(linkChip.url).hostname;
                    } catch {
                      return linkChip.url;
                    }
                  })()}
                  <span className="ml-1 text-zinc-600">已解析</span>
                </span>
              )}
              <button
                type="button"
                onClick={clearLinkCard}
                className="flex shrink-0 items-center gap-1 rounded-md border border-white/15 px-2.5 py-1 text-zinc-400 transition-colors hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300"
                title={linkChip.status === "parsing" ? "取消解析(Esc)" : "移除链接与商品卡"}
              >
                <X className="h-3.5 w-3.5" />
                {linkChip.status === "parsing" ? "取消 (Esc)" : "移除"}
              </button>
            </div>
          )}
          {analyzing ? (
            <div className="flex items-center gap-2 text-xs text-sky-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在分析商品图,提炼卖点…
            </div>
          ) : analyzeError ? (
            <div className="flex items-center gap-2 text-xs text-red-400">
              <Package className="h-3.5 w-3.5" />
              {analyzeError}
              <button
                type="button"
                onClick={() => {
                  setAnalyzeError(null);
                  setAnalyzeNonce((n) => n + 1);
                }}
                className="ml-1 rounded border border-red-400/40 px-2 py-0.5 text-red-300 hover:bg-red-500/10"
              >
                重试
              </button>
            </div>
          ) : productCard ? (
            <div>
              <button
                type="button"
                onClick={() => setCardPanelOpen((v) => !v)}
                className="flex w-full items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1.5 text-left text-xs text-amber-200 transition-colors hover:bg-amber-500/15"
              >
                <Package className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{productCard.title}</span>
                <span className="shrink-0 text-amber-400/70">
                  卖点 {productCard.selling_points.filter((p) => p.selected).length}/
                  {productCard.selling_points.length}
                </span>
                {cardPanelOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
              </button>
              {cardPanelOpen && (
                <div className="mt-2 space-y-1.5 rounded-lg border border-white/10 bg-black/30 p-2.5">
                  {productCard.selling_points.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-start gap-2 text-xs text-zinc-300"
                    >
                      <input
                        type="checkbox"
                        checked={p.selected}
                        onChange={() => toggleSellingPoint(p.id)}
                        className="mt-0.5 accent-amber-400"
                      />
                      <span className="min-w-0 flex-1">
                        {p.text}
                        {p.evidence && (
                          <span className="ml-1 text-zinc-600">({p.evidence})</span>
                        )}
                      </span>
                    </label>
                  ))}
                  {productCard.audience.length > 0 && (
                    <p className="pt-1 text-[11px] text-zinc-500">
                      目标人群:{productCard.audience.join("、")}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}
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

        {/* @角色 chip */}
        {characterApplicable && character && (
          <span className="flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/15 px-2 py-1 text-xs text-violet-200">
            {character.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={character.avatar_url}
                alt=""
                className="h-4 w-4 rounded-full object-cover"
              />
            ) : (
              <AtSign className="h-3 w-3" />
            )}
            @{character.name}
            <button
              type="button"
              onClick={() => setCharacter(null)}
              className="text-violet-300/70 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}

        {/* 商品成片:渲染腿切换(幻灯片=分级积分;AI 生成=逐镜 video 计价) */}
        {mode === "product" && (
          <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
            {(
              [
                { key: "slideshow", label: "幻灯片" },
                { key: "assembly", label: "拼装口播" },
                { key: "ai_gen", label: "AI 生成" },
              ] as const
            ).map((leg) => (
              <button
                key={leg.key}
                type="button"
                onClick={() => setProductRenderMode(leg.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  productRenderMode === leg.key
                    ? "bg-amber-500/20 text-amber-300"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {leg.label}
              </button>
            ))}
          </div>
        )}

        {mode === "video" || (mode === "product" && productRenderMode === "ai_gen") ? (
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
        ) : mode === "deconstruct" ? (
          <span className="text-[11px] text-zinc-600">
            拆解免费(限 3 次/分,30 次/天);耗时约 1-5 分钟
          </span>
        ) : mode === "product" && productRenderMode === "assembly" ? (
          <>
            <Select
              value={slideshowParams.aspectRatio}
              onValueChange={(v) =>
                setSlideshowParams((p) => ({ ...p, aspectRatio: v as SlideshowParams["aspectRatio"] }))
              }
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
              value={String(slideshowParams.durationPerImage)}
              onValueChange={(v) =>
                setSlideshowParams((p) => ({ ...p, durationPerImage: Number(v) }))
              }
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-white/10 bg-black/30 px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2, 2.5, 3, 4].map((d) => (
                  <SelectItem key={d} value={String(d)} className="text-xs">
                    {d}s/镜起
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToggleChip
              active={slideshowParams.kenburns}
              label="运镜"
              onClick={() => setSlideshowParams((p) => ({ ...p, kenburns: !p.kenburns }))}
            />
            <span className="text-[11px] text-zinc-600">逐镜口播+字幕(镜长随台词自动延长)</span>
          </>
        ) : mode === "slideshow" || (mode === "product" && productRenderMode === "slideshow") ? (
          <>
            <Select
              value={slideshowParams.aspectRatio}
              onValueChange={(v) =>
                setSlideshowParams((p) => ({ ...p, aspectRatio: v as SlideshowParams["aspectRatio"] }))
              }
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
              value={String(slideshowParams.durationPerImage)}
              onValueChange={(v) =>
                setSlideshowParams((p) => ({ ...p, durationPerImage: Number(v) }))
              }
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-white/10 bg-black/30 px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2, 2.5, 3, 4].map((d) => (
                  <SelectItem key={d} value={String(d)} className="text-xs">
                    {d}s/图
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={slideshowParams.transition}
              onValueChange={(v) => setSlideshowParams((p) => ({ ...p, transition: v }))}
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-white/10 bg-black/30 px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLIDESHOW_TRANSITIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToggleChip
              active={slideshowParams.kenburns}
              label="运镜"
              onClick={() => setSlideshowParams((p) => ({ ...p, kenburns: !p.kenburns }))}
            />
            <ToggleChip
              active={slideshowParams.voiceEnabled}
              label="配音"
              onClick={() => setSlideshowParams((p) => ({ ...p, voiceEnabled: !p.voiceEnabled }))}
            />
            <ToggleChip
              active={slideshowParams.bgmEnabled}
              label="BGM"
              onClick={() => setSlideshowParams((p) => ({ ...p, bgmEnabled: !p.bgmEnabled }))}
            />
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

        {/* 数量 stepper(拆解模式恒为 1,隐藏) */}
        {mode !== "deconstruct" && (
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
        )}
      </div>

      {/* 输入区 */}
      <div className="flex items-end gap-2 px-4 py-3">
        {mode === "deconstruct" ? (
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="shrink-0 rounded-lg border border-white/10 bg-black/30 p-2 text-zinc-400 transition-colors hover:text-white"
            title="上传爆款视频(mp4)"
          >
            <Video className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 rounded-lg border border-white/10 bg-black/30 p-2 text-zinc-400 transition-colors hover:text-white"
            title="添加素材图"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
        )}
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadDeconstructVideo(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={!characterApplicable}
          onClick={() => setPickerOpen((v) => !v)}
          className={cn(
            "shrink-0 rounded-lg border border-white/10 bg-black/30 p-2 transition-colors",
            characterApplicable
              ? character
                ? "text-violet-300"
                : "text-zinc-400 hover:text-white"
              : "cursor-not-allowed text-zinc-700"
          )}
          title={characterApplicable ? "@角色(一致性引用)" : "@角色仅图片/视频模式可用"}
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
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            const url = detectPastedUrl(pasted);
            if (!url) return;
            if (mode === "product") {
              // 链接不进输入框(变链接 chip);URL 之外的文字保留为文案主题
              e.preventDefault();
              const rest = pasted.replace(url, "").trim();
              if (rest) setText((prev) => (prev ? `${prev} ${rest}` : rest));
              startLinkParse(url);
            } else {
              // 其他模式只给切换建议,不代切换(模式切换器是唯一真值)
              setLinkHint(url);
            }
          }}
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
              return;
            }
            // 输入 @ 唤起角色选择器(仅唤起,不吞字符;Esc 关闭)
            if (e.key === "@" && characterApplicable && !e.nativeEvent.isComposing) {
              setPickerOpen(true);
            }
            if (e.key === "Escape" && pickerOpen) {
              setPickerOpen(false);
            }
          }}
          placeholder={
            mode === "video"
              ? "描述你要的视频,或拖入素材图(拖图+文字=图生视频)…"
              : mode === "slideshow"
                ? "拖入 2-15 张图;这里写文案主题(可选,AI 生成口播文案与配音)…"
                : mode === "product"
                  ? "拖入 2-9 张商品图,或粘贴 Amazon/Shopify/TikTok Shop 商品链接;发送=按勾选卖点批量出成片"
                  : mode === "deconstruct"
                    ? "可选:给这条爆款做个备注(作为报告标题)…"
                    : "描述你要的图片,可拖入参考图…"
          }
          rows={3}
          className="max-h-56 min-h-[72px] flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {submitting && mode === "deconstruct" ? (
            <span className="text-[11px] text-rose-300">拆解中,约 1-5 分钟,请勿关闭页面…</span>
          ) : hasFailedAttachment ? (
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
            disabled={sendDisabled || submitting}
            onClick={handleSend}
            className="h-8 gap-1.5 px-4"
          >
            {uploading || submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
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
              将提交 {draft.count} 个
              {mode === "video"
                ? "视频"
                : mode === "product" && productRenderMode === "ai_gen"
                  ? "AI 逐镜成片(每图一镜逐镜计价)"
                  : mode === "product" && productRenderMode === "assembly"
                    ? "拼装口播成片(每图一镜,1 积分/镜)"
                    : mode === "slideshow" || mode === "product"
                      ? "轮播成片"
                      : "图片"}
              任务,预估消耗{" "}
              <span className="font-semibold text-amber-500 tabular-nums">{estimated}</span> 积分
              {credits !== null && <>(当前余额 {credits})</>}。积分按任务在服务端逐条扣除,失败自动退款。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void doSubmit();
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
