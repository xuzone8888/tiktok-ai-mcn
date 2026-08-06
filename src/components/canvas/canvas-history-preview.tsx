"use client";

// Canvas history tile media preview.
//
// Renders a stable-aspect thumbnail for one HistoryItem using ONLY the S6
// owner-bound media-url cache (resolveMediaUrl / peekMediaUrl / forgetMediaUrl).
// A raw OSS object key never becomes an <img> src; only a resolved https URL
// returned by the cache is used. Resolution is deferred until the tile nears
// the viewport (IntersectionObserver, with a safe fallback), and every async
// branch is cancelled on unmount, key change, or retry so it fails closed.
//
// Per media type:
//   - image: resolve posterKey ?? objectKey.
//   - video: resolve posterKey ONLY; the video objectKey is never resolved or
//     mounted (no <video> element, no autoplay).
//   - audio: never resolves media; shows a Music icon (browse-only).
//
// ASCII comments only; Chinese appears only in user-facing strings.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Film, Music, RefreshCw } from "lucide-react";

import {
  forgetMediaUrl,
  peekMediaUrl,
  resolveMediaUrl,
} from "@/components/canvas/media-url-cache";
import type { HistoryItem } from "@/lib/canvas/history-client";

// How far outside the viewport to begin resolving, so the thumbnail is ready
// by the time it scrolls into view.
const PREVIEW_ROOT_MARGIN = "200px";

type MediaStatus = "none" | "pending" | "loading" | "ready" | "error";

const FALLBACK_ALT: Record<HistoryItem["type"], string> = {
  image: "图片预览",
  video: "视频封面",
  audio: "音频",
};

export interface CanvasHistoryPreviewProps {
  item: HistoryItem;
}

export function CanvasHistoryPreview({ item }: CanvasHistoryPreviewProps) {
  // The single key this tile may resolve. Null means "no media to resolve":
  // audio always, and video without a poster (its objectKey is never touched).
  const resolveKey = useMemo<string | null>(() => {
    if (item.type === "image") return item.posterKey ?? item.objectKey;
    if (item.type === "video") return item.posterKey ?? null;
    return null;
  }, [item.type, item.posterKey, item.objectKey]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Media state is tagged with the key it belongs to, and visibility is a key
  // rather than a boolean. A render only trusts them when their key === the
  // current resolveKey, so a prop key change never paints an old URL, and a new
  // key never resolves until its own IntersectionObserver marks it visible.
  const [media, setMedia] = useState<{
    key: string | null;
    status: MediaStatus;
    url: string | null;
  }>(() => {
    if (!resolveKey) return { key: null, status: "none", url: null };
    const peeked = peekMediaUrl(resolveKey);
    return { key: resolveKey, status: peeked ? "ready" : "pending", url: peeked };
  });
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Re-scope media/visibility to the new key. The render guards below already
  // treat a mismatched key as pending/none, so no stale frame paints even
  // before this effect commits.
  useEffect(() => {
    if (!resolveKey) {
      setMedia({ key: null, status: "none", url: null });
      setVisibleKey(null);
      return;
    }
    const peeked = peekMediaUrl(resolveKey);
    setMedia({
      key: resolveKey,
      status: peeked ? "ready" : "pending",
      url: peeked,
    });
    setVisibleKey(null);
  }, [resolveKey]);

  // Defer resolution until the tile nears the viewport; the fallback marks only
  // the current key visible. Never observes audio, or video without a poster
  // (resolveKey === null), so the video objectKey is never resolved/mounted.
  useEffect(() => {
    if (!resolveKey) return;
    const el = containerRef.current;
    if (!el) return;
    const key = resolveKey;
    if (typeof IntersectionObserver === "undefined") {
      setVisibleKey(key);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleKey(key);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: PREVIEW_ROOT_MARGIN }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [resolveKey]);

  // Resolve only when the current key is marked visible. Completion/error write
  // back only if still active AND the key still matches (double guard); abort
  // on unmount, key change, or retry.
  useEffect(() => {
    if (!resolveKey || visibleKey !== resolveKey) return;
    const key = resolveKey;
    const peeked = peekMediaUrl(key);
    if (peeked) {
      setMedia({ key, status: "ready", url: peeked });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setMedia({ key, status: "loading", url: null });
    resolveMediaUrl(key, { signal: controller.signal }).then(
      (resolved) => {
        if (active) {
          setMedia((prev) =>
            prev.key === key ? { key, status: "ready", url: resolved } : prev
          );
        }
      },
      () => {
        // Never surface the raw resolver error; show a generic retry state.
        if (active) {
          setMedia((prev) =>
            prev.key === key ? { key, status: "error", url: null } : prev
          );
        }
      }
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [resolveKey, visibleKey, attempt]);

  const retry = useCallback(() => {
    if (!resolveKey) return;
    const key = resolveKey;
    forgetMediaUrl(key);
    setMedia({ key, status: "pending", url: null });
    setVisibleKey(key); // mark only the current key visible
    setAttempt((n) => n + 1);
  }, [resolveKey]);

  // Trust media state only when it belongs to the current key; otherwise render
  // pending (never an old URL). A null key renders the icon placeholder.
  const currentMedia = media.key === resolveKey ? media : null;
  const status: MediaStatus =
    resolveKey === null ? "none" : currentMedia ? currentMedia.status : "pending";
  const url = currentMedia ? currentMedia.url : null;

  const alt = (item.title && item.title.trim()) || FALLBACK_ALT[item.type];

  return (
    <div
      ref={containerRef}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted"
    >
      {status === "none" ? (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {item.type === "audio" ? (
            <Music className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Film className="h-6 w-6" aria-hidden="true" />
          )}
          <span className="sr-only">{FALLBACK_ALT[item.type]}</span>
        </div>
      ) : status === "ready" && url ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          draggable={false}
          onError={() =>
            setMedia((prev) =>
              resolveKey && prev.key === resolveKey
                ? { key: resolveKey, status: "error", url: null }
                : prev
            )
          }
        />
      ) : status === "error" ? (
        <button
          type="button"
          onClick={retry}
          aria-label="重新加载预览"
          className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
          <span className="text-xs">重试</span>
        </button>
      ) : (
        // pending / loading skeleton
        <div className="h-full w-full animate-pulse bg-muted" aria-hidden="true" />
      )}
    </div>
  );
}

export default CanvasHistoryPreview;
