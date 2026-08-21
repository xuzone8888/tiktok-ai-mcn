"use client";

import {
  CheckCircle2,
  Coins,
  ImageIcon,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  UploadCloud,
  Video,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ImgHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { HireDialog } from "@/components/models";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLang } from "@/contexts/LangContext";
import { useToast } from "@/hooks/use-toast";
import { getMarketplaceModels, type PublicModel } from "@/lib/actions/models";
import { ROLE_ASSET_CATEGORIES } from "@/lib/character-assets";
import {
  localizeOfficialCharacterDescription,
  localizeOfficialCharacterName,
  localizeOfficialCharacterTag,
} from "@/lib/character-localization";
import { cn } from "@/lib/utils";
import type { AIModel } from "@/types/model";

type ModelWithContract = PublicModel & {
  hired_count?: number;
};

type GalleryItemKind = "sheet" | "cover" | "reference";

type GalleryItem = {
  url: string;
  displayUrl: string;
  previewUrl: string;
  label: string;
  kind: GalleryItemKind;
};

const CATEGORY_LABELS = ROLE_ASSET_CATEGORIES;
const PREVIEW_MIN_ZOOM = 1;
const PREVIEW_MAX_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.25;
const MARKETPLACE_PAGE_SIZE = 60;
const MARKETPLACE_ENGLISH_SEARCH_LIMIT = 1000;
const DETAIL_ASSET_LOAD_DELAY_MS = 0;
const MARKETPLACE_PRIORITY_IMAGE_COUNT = 5;
const preloadImageUrls = new Set<string>();

function createMarketplaceShuffleSeed() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clampPreviewZoom(value: number) {
  return Math.min(PREVIEW_MAX_ZOOM, Math.max(PREVIEW_MIN_ZOOM, value));
}

function getOssOptimizedImageUrl(
  imageUrl: string,
  kind: GalleryItemKind,
  variant: "thumb" | "full" = "full"
): string {
  if (variant === "full" || kind !== "cover") return imageUrl;

  try {
    const url = new URL(imageUrl);
    const isOssUrl = /oss|aliyuncs|media\.toryxai\.com/i.test(url.hostname);
    if (!isOssUrl || url.searchParams.has("x-oss-process")) return imageUrl;

    const process = kind === "cover"
      ? "image/resize,w_420/quality,q_78/format,jpg"
      : "image/resize,w_1400/quality,q_88/format,jpg";
    url.searchParams.set("x-oss-process", process);
    return url.toString();
  } catch {
    return imageUrl;
  }
}

function getCoverImageSrc(model: PublicModel): string | null {
  if (model.avatar_url) return getOssOptimizedImageUrl(model.avatar_url, "cover", "thumb");
  if (model.reference_sheet_url) return getOssOptimizedImageUrl(model.reference_sheet_url, "sheet", "thumb");
  if (model.reference_images[0]) return getOssOptimizedImageUrl(model.reference_images[0], "reference", "thumb");
  return null;
}

function getGalleryImageSrc(model: PublicModel, url: string, variant: "thumb" | "full"): string {
  if (url === model.reference_sheet_url) return getOssOptimizedImageUrl(url, "sheet", variant);
  if (url === model.avatar_url) return getOssOptimizedImageUrl(url, "cover", variant);
  return getOssOptimizedImageUrl(url, "reference", variant);
}

function preloadImage(url: string | null | undefined) {
  if (!url || typeof window === "undefined" || preloadImageUrls.has(url)) return;
  preloadImageUrls.add(url);
  const image = new window.Image();
  image.decoding = "async";
  image.src = url;
}

function preloadModelAssets(model: PublicModel) {
  const coverUrl = getCoverImageSrc(model);
  if (coverUrl) preloadImage(coverUrl);
  if (model.reference_sheet_url) {
    preloadImage(getOssOptimizedImageUrl(model.reference_sheet_url, "sheet", "thumb"));
    preloadImage(model.reference_sheet_url);
  }
  if (model.avatar_url) preloadImage(model.avatar_url);
}

function getOwnershipMessageKey(model: PublicModel) {
  if (model.ownership === "owned") return "ownership.owned" as const;
  if (model.ownership === "licensed") return "ownership.licensed" as const;
  if (model.source === "user_created") return "ownership.community" as const;
  return "ownership.official" as const;
}

function blockImageSave(event: SyntheticEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function ProtectedImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const {
    className,
    draggable,
    onContextMenu,
    onCopy,
    onDragStart,
    style,
    ...imageProps
  } = props;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...imageProps}
      alt={imageProps.alt ?? ""}
      draggable={draggable ?? false}
      onContextMenu={(event) => {
        blockImageSave(event);
        onContextMenu?.(event);
      }}
      onCopy={(event) => {
        blockImageSave(event);
        onCopy?.(event);
      }}
      onDragStart={(event) => {
        blockImageSave(event);
        onDragStart?.(event);
      }}
      className={cn("select-none", className)}
      style={{
        WebkitTouchCallout: "none",
        userSelect: "none",
        ...style,
      }}
    />
  );
}

function CharacterCoverImage({
  src,
  alt,
  loading = "lazy",
}: {
  src: string;
  alt: string;
  loading?: "eager" | "lazy";
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(loading === "eager");

  useEffect(() => {
    if (loading === "eager" || shouldLoad) return;
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "280px 0px" }
    );

    const element = containerRef.current;
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [loading, shouldLoad]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#07090D]" onContextMenu={blockImageSave}>
      {shouldLoad && (
        <ProtectedImage
          src={src}
          alt={alt}
          decoding="async"
          fetchPriority={loading === "eager" ? "high" : "low"}
          loading={loading}
          className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.03]"
        />
      )}
      {!shouldLoad && <div className="h-full w-full animate-pulse bg-white/[0.07]" />}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/18" />
    </div>
  );
}

function EmptyState({
  hasFilters,
  onClearFilters,
}: {
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  const t = useTranslations("character");
  const common = useTranslations("common");

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <PackageOpen className="mb-5 h-20 w-20 text-white/20" />
      <h3 className="text-lg font-semibold text-white">
        {hasFilters ? t("empty.filteredTitle") : t("empty.title")}
      </h3>
      <p className="mt-2 max-w-sm text-sm text-white/50">
        {hasFilters ? t("empty.filteredDescription") : t("empty.description")}
      </p>
      {hasFilters && (
        <Button
          variant="outline"
          onClick={onClearFilters}
          className="mt-6 border-white/10 bg-white/5 text-white hover:bg-white/10"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {common("actions.clearFilters")}
        </Button>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
          <div className="aspect-[2/3] animate-pulse bg-white/10" />
          <div className="space-y-3 p-3">
            <div className="h-4 w-3/4 rounded bg-white/10" />
            <div className="h-3 w-1/2 rounded bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CharacterAssetCard({
  model,
  priority,
  selected,
  onClick,
}: {
  model: ModelWithContract;
  priority?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("character");
  const common = useTranslations("common");
  const { lang: displayLang } = useLang();
  const coverSrc = getCoverImageSrc(model);
  const owned = model.ownership === "owned" || model.has_active_contract;
  const categoryLabels = t.raw("categories") as Record<string, string>;
  const displayName = localizeOfficialCharacterName(model.name, model.source, displayLang);

  return (
    <button
      type="button"
      onClick={onClick}
      onFocus={() => preloadModelAssets(model)}
      onPointerEnter={() => preloadModelAssets(model)}
      className={cn(
        "group overflow-hidden rounded-lg border bg-white/[0.03] text-left transition hover:-translate-y-0.5 hover:border-mermaid-cyan/40 hover:bg-white/[0.06]",
        selected ? "border-mermaid-cyan/50" : "border-white/10"
      )}
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-white/5">
        {coverSrc ? (
          <CharacterCoverImage src={coverSrc} alt={displayName} loading={priority ? "eager" : "lazy"} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-9 w-9 text-white/25" />
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1.5">
          <Badge className="border-0 bg-black/55 text-[10px] text-white backdrop-blur">
            {t(getOwnershipMessageKey(model))}
          </Badge>
          {owned && (
            <Badge className="border-0 bg-emerald-500/85 text-[10px] text-black">
              {t("ownership.licensed")}
            </Badge>
          )}
        </div>
        <div className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur">
          {common("units.credits", { count: model.publish_price || model.base_price || 0 })}
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-white">{displayName}</h3>
          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
            {categoryLabels[model.category] || model.category}
          </span>
        </div>
        <div className="flex min-h-5 flex-wrap gap-1">
          {model.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55">
              {localizeOfficialCharacterTag(tag, model.source, displayLang)}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

function CharacterGalleryThumbnail({
  item,
  modelName,
  onPreview,
}: {
  item: GalleryItem;
  modelName: string;
  onPreview: (item: GalleryItem) => void;
}) {
  const t = useTranslations("character");

  return (
    <button
      type="button"
      key={item.url}
      aria-label={t("gallery.preview", { modelName, label: item.label })}
      className="group/thumb relative aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-[#05070B]"
      onClick={() => onPreview(item)}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),rgba(255,255,255,0.02)_48%,rgba(0,0,0,0.15))]" />
      <ProtectedImage
        src={item.displayUrl}
        alt={`${modelName}${item.label}`}
        loading="lazy"
        className={cn(
          "relative z-10 h-full w-full object-contain p-1.5 transition group-hover/thumb:scale-[1.02]",
          item.kind === "cover" ? "object-top" : "object-center"
        )}
      />
      <span className="absolute bottom-1.5 left-1.5 z-20 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white/80 backdrop-blur">
        {item.label}
      </span>
    </button>
  );
}

function DetailAssetPlaceholder({
  coverSrc,
  label,
  className,
}: {
  coverSrc: string | null;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn(
      "relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#05070B]",
      className
    )}>
      {coverSrc && (
        <ProtectedImage
          src={coverSrc}
          alt=""
          aria-hidden="true"
          loading="eager"
          className="absolute inset-0 h-full w-full scale-110 object-cover object-top opacity-20 blur-xl"
        />
      )}
      <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />
      <div className="relative z-10 flex flex-col items-center gap-2 text-white/50">
        <ImageIcon className="h-8 w-8 text-white/25" />
        <span className="text-xs">{label}</span>
      </div>
    </div>
  );
}

function CharacterImagePreviewDialog({
  item,
  modelName,
  onClose,
}: {
  item: GalleryItem | null;
  modelName: string;
  onClose: () => void;
}) {
  const common = useTranslations("common");
  const [zoom, setZoom] = useState(PREVIEW_MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fullImageReady, setFullImageReady] = useState(false);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const resetPreview = useCallback(() => {
    setZoom(PREVIEW_MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    dragStateRef.current = null;
  }, []);

  useEffect(() => {
    resetPreview();
    setFullImageReady(false);
    if (!item) return;

    if (item.previewUrl === item.displayUrl) {
      setFullImageReady(true);
      return;
    }

    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => setFullImageReady(true);
    image.src = item.previewUrl;

    return () => {
      image.onload = null;
    };
  }, [item, resetPreview]);

  const applyZoom = useCallback((nextZoom: number, anchor?: { x: number; y: number }) => {
    const clampedZoom = clampPreviewZoom(nextZoom);
    setZoom(clampedZoom);
    if (clampedZoom === PREVIEW_MIN_ZOOM) {
      setOffset({ x: 0, y: 0 });
      return;
    }
    if (anchor && previewAreaRef.current) {
      const rect = previewAreaRef.current.getBoundingClientRect();
      const anchorX = anchor.x - rect.left - rect.width / 2;
      const anchorY = anchor.y - rect.top - rect.height / 2;
      const zoomRatio = clampedZoom / zoom;
      setOffset({
        x: anchorX - (anchorX - offset.x) * zoomRatio,
        y: anchorY - (anchorY - offset.y) * zoomRatio,
      });
    }
  }, [offset.x, offset.y, zoom]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 1.12 : 0.88;
    applyZoom(zoom * zoomFactor, { x: event.clientX, y: event.clientY });
  }, [applyZoom, zoom]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= PREVIEW_MIN_ZOOM) return;
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [offset.x, offset.y, zoom]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    setOffset({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    });
  }, []);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (zoom === PREVIEW_MIN_ZOOM) {
      applyZoom(2);
      return;
    }
    resetPreview();
  }, [applyZoom, resetPreview, zoom]);

  const zoomPercent = Math.round(zoom * 100);
  const canZoomOut = zoom > PREVIEW_MIN_ZOOM;
  const canZoomIn = zoom < PREVIEW_MAX_ZOOM;
  const canReset = zoom !== PREVIEW_MIN_ZOOM || offset.x !== 0 || offset.y !== 0;

  return (
    <Dialog open={Boolean(item)} onOpenChange={(nextOpen) => {
      if (!nextOpen) onClose();
    }}
    >
      <DialogContent className="z-[80] max-h-[94vh] max-w-[94vw] overflow-hidden border-white/10 bg-[#05070B]/95 p-0 text-white shadow-2xl">
        {item && (
          <div className="flex max-h-[94vh] flex-col">
            <DialogHeader className="border-b border-white/10 px-4 py-3 pr-12 text-left">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <DialogTitle className="min-w-0 truncate text-base font-semibold text-white">
                  {modelName} · {item.label}
                </DialogTitle>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={common("actions.zoomOut")}
                    title={common("actions.zoomOut")}
                    disabled={!canZoomOut}
                    className="h-8 w-8 text-white/65 hover:bg-white/10 hover:text-white"
                    onClick={() => applyZoom(zoom - PREVIEW_ZOOM_STEP)}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="min-w-12 rounded bg-white/10 px-2 py-1 text-center text-xs font-medium text-white/70">
                    {zoomPercent}%
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={common("actions.zoomIn")}
                    title={common("actions.zoomIn")}
                    disabled={!canZoomIn}
                    className="h-8 w-8 text-white/65 hover:bg-white/10 hover:text-white"
                    onClick={() => applyZoom(zoom + PREVIEW_ZOOM_STEP)}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={common("actions.reset")}
                    title={common("actions.reset")}
                    disabled={!canReset}
                    className="h-8 w-8 text-white/65 hover:bg-white/10 hover:text-white"
                    onClick={resetPreview}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </DialogHeader>
            <div
              ref={previewAreaRef}
              className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/45 p-3 sm:p-5"
              onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
              }}
              onWheel={handleWheel}
            >
              <div
                className={cn(
                  "touch-none select-none transition-transform duration-75",
                  zoom > PREVIEW_MIN_ZOOM ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
                )}
                onDoubleClick={handleDoubleClick}
                onPointerCancel={handlePointerEnd}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                style={{
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
                }}
              >
                <ProtectedImage
                  src={fullImageReady ? item.previewUrl : item.displayUrl}
                  alt={`${modelName}${item.label}`}
                  draggable={false}
                  loading="eager"
                  className="max-h-[calc(94vh-82px)] max-w-full rounded-lg object-contain shadow-2xl"
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CharacterDetailDialog({
  model,
  open,
  onOpenChange,
  onAuthorize,
  onPublishToggle,
  onGoImage,
  onGoVideo,
  publishing,
}: {
  model: PublicModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthorize: (model: PublicModel) => void;
  onPublishToggle: (model: PublicModel) => void;
  onGoImage: (model: PublicModel) => void;
  onGoVideo: (model: PublicModel) => void;
  publishing: boolean;
}) {
  const t = useTranslations("character");
  const common = useTranslations("common");
  const { lang: displayLang } = useLang();
  const [previewItem, setPreviewItem] = useState<GalleryItem | null>(null);
  const [detailImagesReady, setDetailImagesReady] = useState(false);

  useEffect(() => {
    setPreviewItem(null);
    setDetailImagesReady(false);
    if (!open || !model?.id) return;

    preloadModelAssets(model);

    if (DETAIL_ASSET_LOAD_DELAY_MS <= 0) {
      setDetailImagesReady(true);
      return;
    }

    const timeout = window.setTimeout(() => {
      setDetailImagesReady(true);
    }, DETAIL_ASSET_LOAD_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [model, open]);

  if (!model) return null;

  const coverSrc = getCoverImageSrc(model);
  const owned = model.ownership === "owned" || model.has_active_contract;
  const canPublish = model.ownership === "owned";
  const price = model.publish_price || model.base_price || 0;
  const displayName = localizeOfficialCharacterName(model.name, model.source, displayLang);
  const displayDescription = localizeOfficialCharacterDescription(model.description, model.source, displayLang);
  const gallery = [
    model.reference_sheet_url,
    ...model.reference_images,
    model.avatar_url,
  ].filter((url, index, urls): url is string =>
    typeof url === "string" && url.length > 0 && urls.indexOf(url) === index
  );
  const galleryItems = gallery.slice(0, 6).map((url): GalleryItem => {
    if (url === model.reference_sheet_url) {
      return {
        url,
        displayUrl: getGalleryImageSrc(model, url, "thumb"),
        previewUrl: getGalleryImageSrc(model, url, "full"),
        label: t("gallery.sheet"),
        kind: "sheet",
      };
    }
    if (url === model.avatar_url) {
      return {
        url,
        displayUrl: getGalleryImageSrc(model, url, "thumb"),
        previewUrl: getGalleryImageSrc(model, url, "full"),
        label: t("gallery.cover"),
        kind: "cover",
      };
    }
    return {
      url,
      displayUrl: getGalleryImageSrc(model, url, "thumb"),
      previewUrl: getGalleryImageSrc(model, url, "full"),
      label: t("gallery.reference"),
      kind: "reference",
    };
  });
  const assetSummary = [
    { label: t("gallery.sheet"), ready: Boolean(model.reference_sheet_url) },
    { label: t("gallery.cover"), ready: Boolean(model.avatar_url) },
    { label: t("gallery.reference"), ready: gallery.length > 0 },
    { label: t("gallery.video"), ready: Boolean(model.preview_video_url) },
  ];
  const imageActionLabel = owned ? t("detail.generateImage") : t("detail.authorizeForImage");
  const videoActionLabel = owned ? t("detail.generateVideo") : t("detail.authorizeForVideo");
  const publishActionLabel = model.is_public ? t("detail.unpublish") : t("detail.publish");
  const PublishIcon = model.is_public ? XCircle : UploadCloud;
  const referenceSheetPreviewItem: GalleryItem | null = model.reference_sheet_url
    ? {
      url: model.reference_sheet_url,
      displayUrl: getGalleryImageSrc(model, model.reference_sheet_url, "thumb"),
      previewUrl: model.reference_sheet_url,
      label: t("gallery.fullSheet"),
      kind: "sheet",
    }
    : null;
  const handleImageAction = () => {
    if (owned) {
      onGoImage(model);
      return;
    }
    onAuthorize(model);
  };
  const handleVideoAction = () => {
    if (owned) {
      onGoVideo(model);
      return;
    }
    onAuthorize(model);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden border-white/10 bg-[#080A0F] p-0 text-white">
          <DialogHeader className="border-b border-white/10 px-5 py-4 lg:px-6">
            <div className="flex flex-col gap-3 pr-9 sm:flex-row sm:items-center sm:justify-between">
              <DialogTitle className="flex min-w-0 items-center gap-3 text-xl">
                <Sparkles className="h-5 w-5 shrink-0 text-mermaid-cyan" />
                <span className="truncate">{displayName}</span>
              </DialogTitle>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-0 bg-white/10 text-white">{t(getOwnershipMessageKey(model))}</Badge>
                <Badge className="border-0 bg-white/10 text-white">
                  {(t.raw("categories") as Record<string, string>)[model.category] || model.category}
                </Badge>
                {owned && <Badge className="border-0 bg-emerald-500/85 text-black">{t("ownership.licensed")}</Badge>}
                <Badge className="border-0 bg-mermaid-cyan/15 text-mermaid-cyan">{common("units.credits", { count: price })}</Badge>
              </div>
            </div>
          </DialogHeader>
          <div className="grid max-h-[calc(92vh-76px)] overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="space-y-4 p-5 lg:p-6">
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">{t("gallery.fullSheet")}</h3>
                    <p className="mt-1 text-xs text-white/45">{t("gallery.fullSheetDescription")}</p>
                  </div>
                  {referenceSheetPreviewItem && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 shrink-0 text-white/60 hover:bg-white/10 hover:text-white"
                      onClick={() => setPreviewItem(referenceSheetPreviewItem)}
                    >
                      <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
                      {common("actions.zoomIn")}
                    </Button>
                  )}
                </div>

                {referenceSheetPreviewItem ? (
                  <button
                    type="button"
                    aria-label={t("gallery.preview", { modelName: displayName, label: t("gallery.fullSheet") })}
                    className="block w-full overflow-hidden rounded-lg border border-white/10 bg-[#05070B]"
                    onClick={() => setPreviewItem(referenceSheetPreviewItem)}
                  >
                    {detailImagesReady ? (
                      <ProtectedImage
                        src={referenceSheetPreviewItem.displayUrl}
                        alt={`${displayName} reference sheet`}
                        loading="lazy"
                        className="max-h-[520px] w-full object-contain"
                      />
                    ) : (
                      <DetailAssetPlaceholder coverSrc={coverSrc} label={t("gallery.sheetLoading")} className="min-h-[260px]" />
                    )}
                  </button>
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-lg border border-white/10 bg-white/5">
                    <ImageIcon className="h-10 w-10 text-white/25" />
                  </div>
                )}
              </div>

            {galleryItems.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white/85">{t("gallery.thumbnails")}</h3>
                  <span className="text-xs text-white/40">{t("gallery.referenceImageCount", { count: gallery.length })}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
                  {detailImagesReady
                    ? galleryItems.map((item) => (
                      <CharacterGalleryThumbnail
                        key={item.url}
                        item={item}
                        modelName={displayName}
                        onPreview={setPreviewItem}
                      />
                    ))
                    : galleryItems.slice(0, 4).map((item) => (
                      <div
                        key={item.url}
                        className="aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-[#05070B]"
                      >
                        <DetailAssetPlaceholder coverSrc={coverSrc} label={item.label} />
                      </div>
                    ))}
                </div>
              </div>
            )}

            {model.preview_video_url && (
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/85">
                  <Video className="h-4 w-4 text-mermaid-pink" />
                  {t("gallery.transformationVideo")}
                </h3>
                <video
                  src={model.preview_video_url}
                  controls
                  preload="metadata"
                  className="max-h-[420px] w-full rounded-lg border border-white/10 bg-black"
                />
              </div>
            )}
          </section>

          <aside className="border-t border-white/10 bg-[#06080D] p-5 lg:border-l lg:border-t-0">
            <div className="sticky top-5 space-y-5">
              <div className="grid grid-cols-[112px_1fr] gap-4">
                <div className="aspect-[2/3] overflow-hidden rounded-lg border border-white/10 bg-white/5">
                  {coverSrc ? (
                    <CharacterCoverImage src={coverSrc} alt={displayName} loading="eager" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-white/30" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white/40">{t("detail.summary")}</p>
                  <h3 className="mt-1 line-clamp-2 text-lg font-semibold text-white">{displayName}</h3>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {model.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="rounded bg-white/10 px-2 py-1 text-[11px] text-white/65">
                        {localizeOfficialCharacterTag(tag, model.source, displayLang)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white/80">{t("detail.assetStatus")}</h3>
                  <span className="text-xs text-white/40">{common("units.images", { count: gallery.length })}</span>
                </div>
                <div className="space-y-2">
                {assetSummary.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-white/55">{item.label}</span>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
                      item.ready ? "bg-emerald-400/12 text-emerald-200" : "bg-white/[0.08] text-white/45"
                    )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", item.ready ? "bg-emerald-400" : "bg-white/25")} />
                      {item.ready ? common("status.ready") : common("status.unavailable")}
                    </span>
                  </div>
                ))}
                </div>
              </div>

              {displayDescription && (
                <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
                  <h3 className="mb-2 text-sm font-semibold text-white/80">{t("detail.description")}</h3>
                  <p className="max-h-28 overflow-y-auto text-sm leading-6 text-white/58">{displayDescription}</p>
                </div>
              )}

              <div className="space-y-2">
                {!owned && (
                  <button
                    type="button"
                    className="flex h-11 w-full items-center justify-center rounded-lg bg-mermaid-cyan font-semibold text-black transition hover:bg-mermaid-cyan/90"
                    onClick={() => onAuthorize(model)}
                  >
                    <Coins className="mr-2 h-4 w-4" />
                    {t("detail.authorize")}
                  </button>
                )}
                {owned && (
                  <div className="flex h-10 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-sm font-medium text-emerald-200">
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {t("ownership.available")}
                  </div>
                )}
                <Button
                  className="h-11 w-full bg-white text-black hover:bg-white/90"
                  onClick={handleImageAction}
                >
                  {imageActionLabel}
                </Button>
                <Button
                  variant="outline"
                  className="h-11 w-full border-white/10 bg-white/5 text-white hover:bg-white/10"
                  onClick={handleVideoAction}
                >
                  {videoActionLabel}
                </Button>
                {canPublish && (
                  <Button
                    variant="outline"
                    disabled={publishing}
                    className="h-11 w-full border-white/10 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => onPublishToggle(model)}
                  >
                    <PublishIcon className="mr-2 h-4 w-4" />
                    {publishActionLabel}
                  </Button>
                )}
              </div>
            </div>
            </aside>
          </div>
        </DialogContent>
      </Dialog>
      <CharacterImagePreviewDialog
        item={previewItem}
        modelName={displayName}
        onClose={() => setPreviewItem(null)}
      />
    </>
  );
}

export default function ModelsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { lang } = useLang();
  const tr = useTranslations("character");
  const common = useTranslations("common");
  const displayLang = lang;
  const categoryLabels = tr.raw("categories") as Record<string, string>;

  const fetchSeqRef = useRef(0);
  const shuffleSeedRef = useRef(createMarketplaceShuffleSeed());
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [models, setModels] = useState<ModelWithContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [userCredits, setUserCredits] = useState(0);
  const [userId, setUserId] = useState<string | undefined>();
  const [routeReady, setRouteReady] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("全部");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState<PublicModel | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [hireDialogOpen, setHireDialogOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreModels, setHasMoreModels] = useState(false);
  const [totalModels, setTotalModels] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setSelectedCategory(params.get("tab") === "my" ? "我的角色" : "全部");
    }
    setRouteReady(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const href = "https://media.toryxai.com";
    const existing = document.querySelector(`link[rel="preconnect"][href="${href}"]`);
    if (existing) return;

    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);

    return () => {
      link.remove();
    };
  }, []);

  const fetchUserInfo = useCallback(async () => {
    try {
      const response = await fetch("/api/user/credits");
      if (!response.ok) return;
      const data = await response.json();
      setUserCredits(data.credits || 0);
      if (data.userId) setUserId(data.userId);
    } catch (error) {
      console.error("[Models Page] Failed to fetch user info:", error);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    if (!routeReady) return;
    const requestSeq = fetchSeqRef.current + 1;
    fetchSeqRef.current = requestSeq;
    setLoading(true);
    try {
      const normalizedSearch = debouncedSearchQuery.trim();
      const isEnglishDisplaySearch = displayLang === "en" && normalizedSearch.length >= 2;
      const result = await getMarketplaceModels({
        category: selectedCategory,
        mine: selectedCategory === "我的角色",
        search: normalizedSearch.length >= 2 && !isEnglishDisplaySearch ? normalizedSearch : undefined,
        limit: isEnglishDisplaySearch ? MARKETPLACE_ENGLISH_SEARCH_LIMIT : MARKETPLACE_PAGE_SIZE,
        offset: 0,
        shuffleSeed: shuffleSeedRef.current,
      });

      if (fetchSeqRef.current !== requestSeq) return;

      if (result.success && result.data) {
        setModels(result.data.models);
        setTotalModels(result.data.total ?? result.data.models.length);
        setHasMoreModels(
          isEnglishDisplaySearch
            ? false
            : result.data.hasMore ?? result.data.models.length === MARKETPLACE_PAGE_SIZE
        );
      } else {
        setModels([]);
        setTotalModels(0);
        setHasMoreModels(false);
        toast({
          variant: "destructive",
          title: common("errors.loadFailed"),
          description: lang === "zh" && result.error ? result.error : tr("notifications.loadAssetsFailed"),
        });
      }
    } catch (error) {
      console.error("[Models Page] Error:", error);
      setModels([]);
      setTotalModels(0);
      setHasMoreModels(false);
      toast({
        variant: "destructive",
        title: common("errors.loadFailed"),
        description: common("errors.network"),
      });
    } finally {
      if (fetchSeqRef.current === requestSeq) {
        setLoading(false);
      }
    }
  }, [common, debouncedSearchQuery, displayLang, lang, routeReady, selectedCategory, toast, tr]);

  const loadMoreModels = useCallback(async () => {
    if (!routeReady || loadingMore || !hasMoreModels) return;
    setLoadingMore(true);
    try {
      const result = await getMarketplaceModels({
        category: selectedCategory,
        mine: selectedCategory === "我的角色",
        search: debouncedSearchQuery.trim().length >= 2 ? debouncedSearchQuery.trim() : undefined,
        limit: MARKETPLACE_PAGE_SIZE,
        offset: models.length,
        shuffleSeed: shuffleSeedRef.current,
      });

      if (result.success && result.data) {
        setModels((prev) => {
          const seen = new Set(prev.map((model) => model.id));
          const nextModels = result.data?.models.filter((model) => !seen.has(model.id)) || [];
          return [...prev, ...nextModels];
        });
        setTotalModels(result.data.total ?? models.length + result.data.models.length);
        setHasMoreModels(result.data.hasMore ?? result.data.models.length === MARKETPLACE_PAGE_SIZE);
      } else {
        toast({
          variant: "destructive",
          title: common("errors.loadFailed"),
          description: lang === "zh" && result.error ? result.error : tr("notifications.loadMoreFailed"),
        });
      }
    } catch (error) {
      console.error("[Models Page] Load more error:", error);
      toast({
        variant: "destructive",
        title: common("errors.loadFailed"),
        description: common("errors.network"),
      });
    } finally {
      setLoadingMore(false);
    }
  }, [common, debouncedSearchQuery, hasMoreModels, lang, loadingMore, models.length, routeReady, selectedCategory, toast, tr]);

  useEffect(() => {
    if (!routeReady) return;
    fetchModels();
    fetchUserInfo();
  }, [fetchModels, fetchUserInfo, routeReady]);

  useEffect(() => {
    if (!routeReady || loading || loadingMore || !hasMoreModels) return;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || typeof window === "undefined" || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        void loadMoreModels();
      },
      { rootMargin: "720px 0px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreModels, loadMoreModels, loading, loadingMore, routeReady]);

  const filteredModels = useMemo(() => {
    if (debouncedSearchQuery.trim().length < 2) return models;
    const query = debouncedSearchQuery.trim().toLowerCase();
    return models.filter((model) => {
      const searchableValues = [
        model.name,
        localizeOfficialCharacterName(model.name, model.source, displayLang),
        model.category,
        categoryLabels[model.category],
        ...model.tags,
        ...model.tags.map((tag) => localizeOfficialCharacterTag(tag, model.source, displayLang)),
      ];

      return searchableValues.some((value) => value?.toLowerCase().includes(query));
    });
  }, [categoryLabels, debouncedSearchQuery, displayLang, models]);

  const hasFilters = selectedCategory !== "全部" || debouncedSearchQuery.trim().length > 0;
  const totalModelCount = debouncedSearchQuery.trim().length >= 2 && displayLang === "en"
    ? filteredModels.length
    : Math.max(totalModels, filteredModels.length);
  const selectedModelSampleImages = useMemo(() => {
    if (!selectedModel) return [];
    if (selectedModel.reference_images.length > 0) return selectedModel.reference_images;
    if (selectedModel.avatar_url) return [selectedModel.avatar_url];
    return [];
  }, [selectedModel]);

  const selectedModelAsAIModel: AIModel | null = selectedModel
    ? {
      id: selectedModel.id,
      name: localizeOfficialCharacterName(selectedModel.name, selectedModel.source, displayLang),
      description: localizeOfficialCharacterDescription(selectedModel.description, selectedModel.source, displayLang),
      avatar_url: selectedModel.avatar_url,
      sample_images: selectedModelSampleImages,
      sample_videos: selectedModel.preview_video_url ? [selectedModel.preview_video_url] : [],
      style_tags: selectedModel.tags.map((tag) => localizeOfficialCharacterTag(tag, selectedModel.source, displayLang)),
      category: selectedModel.category,
      gender: selectedModel.gender || "neutral",
      is_active: true,
      is_featured: selectedModel.is_featured,
      is_trending: selectedModel.is_trending,
      rating: selectedModel.rating,
      price_daily: selectedModel.source === "user_created" ? selectedModel.publish_price : Math.round(selectedModel.base_price / 30),
      price_weekly: selectedModel.source === "user_created" ? selectedModel.publish_price : Math.round(selectedModel.base_price / 4),
      price_monthly: selectedModel.source === "user_created" ? selectedModel.publish_price : selectedModel.base_price,
      price_yearly: selectedModel.source === "user_created" ? selectedModel.publish_price : selectedModel.base_price * 10,
      total_rentals: selectedModel.total_rentals,
      total_generations: selectedModel.total_generations,
      created_at: selectedModel.created_at,
      updated_at: selectedModel.created_at,
      source: selectedModel.source,
      publish_price: selectedModel.publish_price,
      reference_sheet_url: selectedModel.reference_sheet_url,
      reference_status: selectedModel.reference_status,
    }
    : null;

  const openDetail = (model: PublicModel) => {
    setSelectedModel(model);
    setDetailOpen(true);
  };

  const handleAuthorize = (model: PublicModel) => {
    if (model.ownership === "owned" || model.has_active_contract) return;
    setSelectedModel(model);
    setHireDialogOpen(true);
  };

  const handleHireSuccess = (modelId: string, newBalance: number) => {
    setUserCredits(newBalance);
    window.dispatchEvent(new CustomEvent("credits-updated"));
    setModels((prev) =>
      prev.map((model) =>
        model.id === modelId
          ? { ...model, has_active_contract: true, ownership: "licensed" }
          : model
      )
    );
    setSelectedModel((model) =>
      model?.id === modelId ? { ...model, has_active_contract: true, ownership: "licensed" } : model
    );
    toast({ title: tr("notifications.authorized"), description: tr("notifications.authorizedDescription") });
  };

  const handlePublishToggle = async (model: PublicModel) => {
    if (!userId || model.ownership !== "owned") return;
    setPublishing(true);
    try {
      const response = await fetch(
        model.is_public
          ? `/api/characters/publish?characterId=${encodeURIComponent(model.id)}&userId=${encodeURIComponent(userId)}`
          : "/api/characters/publish",
        {
          method: model.is_public ? "DELETE" : "POST",
          headers: model.is_public ? undefined : { "Content-Type": "application/json" },
          body: model.is_public ? undefined : JSON.stringify({
            characterId: model.id,
            userId,
            price: model.publish_price || 100,
          }),
        }
      );
      const result = await response.json();
      if (!result.success) throw new Error(lang === "zh" && result.error ? result.error : common("errors.operationFailed"));
      toast({
        title: model.is_public ? tr("notifications.unpublished") : tr("notifications.published"),
        description: model.name,
      });
      await fetchModels();
      setSelectedModel((prev) => prev ? { ...prev, is_public: !model.is_public } : prev);
    } catch (error) {
      toast({
        variant: "destructive",
        title: common("errors.operationFailed"),
        description: error instanceof Error ? error.message : common("errors.tryAgain"),
      });
    } finally {
      setPublishing(false);
    }
  };

  const goImage = (model: PublicModel) => {
    router.push(`/quick-gen?characterId=${encodeURIComponent(model.id)}`);
  };

  const goVideo = (_model: PublicModel) => {
    // S4.4:video-batch 大页已消解;Studio 里用 @ 按钮重选角色(携参预选留待
    // omnibox 支持 characterId query 时恢复)
    router.push("/studio");
  };

  let modelsContent: ReactNode;
  if (loading) {
    modelsContent = <LoadingSkeleton />;
  } else if (filteredModels.length === 0) {
    modelsContent = (
      <EmptyState
        hasFilters={hasFilters}
        onClearFilters={() => {
          setSelectedCategory("全部");
          setSearchQuery("");
        }}
      />
    );
  } else {
    modelsContent = (
      <>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {filteredModels.map((model, index) => (
            <CharacterAssetCard
              key={model.id}
              model={model}
              priority={index < MARKETPLACE_PRIORITY_IMAGE_COUNT}
              selected={selectedModel?.id === model.id && detailOpen}
              onClick={() => openDetail(model)}
            />
          ))}
        </div>
        {hasMoreModels && (
          <div ref={loadMoreSentinelRef} className="flex h-16 items-center justify-center">
            {loadingMore && (
              <div className="flex items-center gap-2 text-sm text-white/55">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {common("status.loading")}
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-white">
            <span className="h-8 w-1.5 rounded-full bg-mermaid-cyan" />
            {tr("assetCenter.title")}
          </h1>
          <p className="mt-2 text-sm text-white/55">
            {tr("assetCenter.description")}
          </p>
        </div>
        <Button
          className="bg-mermaid-cyan text-black hover:bg-mermaid-cyan/90"
          onClick={() => router.push("/character/create")}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {tr("assetCenter.create")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1 lg:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={tr("assetCenter.searchPlaceholder")}
            className="border-white/10 bg-white/5 pl-10 text-white placeholder:text-white/30"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_LABELS.map((category) => (
            <Button
              key={category}
              size="sm"
              variant="ghost"
              className={cn(
                "rounded-lg border px-3 text-xs",
                selectedCategory === category
                  ? "border-mermaid-cyan/50 bg-mermaid-cyan/15 text-mermaid-cyan"
                  : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
              )}
              onClick={() => {
                if (category === "全部") {
                  shuffleSeedRef.current = createMarketplaceShuffleSeed();
                }
                setSelectedCategory(category);
              }}
            >
              {categoryLabels[category] || category}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
        <span>{tr("assetCenter.assetCount", { count: totalModelCount })}</span>
        <span>{tr("assetCenter.ownedCount", { count: filteredModels.filter((model) => model.ownership === "owned").length })}</span>
        <span>{tr("assetCenter.licensedCount", { count: filteredModels.filter((model) => model.has_active_contract).length })}</span>
      </div>

      {modelsContent}

      <CharacterDetailDialog
        model={selectedModel}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onAuthorize={handleAuthorize}
        onPublishToggle={handlePublishToggle}
        onGoImage={goImage}
        onGoVideo={goVideo}
        publishing={publishing}
      />

      {selectedModelAsAIModel && (
        <HireDialog
          model={selectedModelAsAIModel}
          open={hireDialogOpen}
          onOpenChange={setHireDialogOpen}
          userCredits={userCredits}
          userId={userId}
          onHireSuccess={handleHireSuccess}
        />
      )}
    </div>
  );
}
