"use client";

// Canvas history browser (right Sheet).
//
// A controlled, work-focused panel that lists owned image/video/audio history
// from the D6 endpoint using ONLY the history-client primitives. Every open and
// tab switch resets deterministically, aborting/invalidating the prior request
// generation; closing, unmount, or interactionEnabled=false aborts in-flight
// work and prevents stale state writes. Raw server values and errors are never
// displayed. Add-to-canvas is offered for image/video only (audio is
// browse-only per the approved master plan, which cuts the independent audio
// node); on a successful add the panel closes, otherwise it stays open.
//
// ASCII comments only; Chinese appears only in user-facing strings.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Inbox, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CanvasHistoryPreview } from "@/components/canvas/canvas-history-preview";
import {
  buildHistoryRequestUrl,
  createHistoryRequestGate,
  createInitialHistoryState,
  groupHistoryItemsByLocalDate,
  mergeHistoryPage,
  parseHistoryPagePayload,
} from "@/lib/canvas/history-client";
import type {
  HistoryCounts,
  HistoryItem,
  HistoryRequestGate,
  HistoryState,
  HistoryType,
} from "@/lib/canvas/history-client";

const HISTORY_TABS: readonly HistoryType[] = ["image", "video", "audio"];

const TAB_LABELS: Record<HistoryType, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

const SOURCE_LABELS: Record<HistoryItem["source"], string> = {
  generations: "生成",
  products: "商品",
  blueprints: "蓝图",
};

const ZERO_COUNTS: HistoryCounts = { all: 0, image: 0, video: 0, audio: 0 };

// idle -> first load; loading/loadingMore -> in flight; ready -> settled;
// error -> initial load failed (empty); moreError -> pagination failed (items
// preserved, retry the same cursor).
type LoadPhase =
  | "idle"
  | "loading"
  | "loadingMore"
  | "ready"
  | "error"
  | "moreError";

export interface CanvasHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interactionEnabled: boolean;
  onAddAsset: (item: HistoryItem) => boolean;
}

function formatTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

// Last path segment of a schema-validated OSS object key, or "" if none is
// safely displayable. The key carries no scheme/query/hash, but we defensively
// strip any and reject control/DEL bytes before showing it.
function objectKeyBasename(key: string): string {
  if (typeof key !== "string" || key.length === 0) return "";
  const cleaned = key.split(/[?#]/)[0];
  const segments = cleaned.split("/");
  const last = (segments[segments.length - 1] ?? "").trim();
  for (let i = 0; i < last.length; i++) {
    const code = last.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return "";
  }
  return last;
}

function itemTitle(item: HistoryItem): string {
  const trimmed = item.title ? item.title.trim() : "";
  if (trimmed.length > 0) return trimmed;
  const base = objectKeyBasename(item.objectKey);
  return base.length > 0 ? base : "未命名";
}

export function CanvasHistoryPanel({
  open,
  onOpenChange,
  interactionEnabled,
  onAddAsset,
}: CanvasHistoryPanelProps) {
  // The portal only mounts when both the parent wants it open AND interaction
  // is enabled, so the sheet never escapes the S7 identity/read-only gate.
  const sheetOpen = open && interactionEnabled;

  const [activeTab, setActiveTab] = useState<HistoryType>("image");
  const [state, setState] = useState<HistoryState>(() =>
    createInitialHistoryState("image")
  );
  const [phase, setPhase] = useState<LoadPhase>("idle");
  // API-wide counts are tab-independent; kept across tab resets so labels do
  // not flicker to zero when switching tabs.
  const [counts, setCounts] = useState<HistoryCounts>(ZERO_COUNTS);
  // Whether any accumulated merge for the current tab hit a retention bound
  // (distinct from state.truncated, which also covers diagnostics truncation).
  const [bounded, setBounded] = useState(false);

  // Per-instance request gate (no global mutable state).
  const gateRef = useRef<HistoryRequestGate | null>(null);
  if (gateRef.current === null) gateRef.current = createHistoryRequestGate();

  // Post-commit mirror of state for async reads; also a re-entrancy guard so a
  // duplicate load-more cannot start while one is pending.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const pendingRef = useRef(false);

  const runLoad = useCallback(
    async (tab: HistoryType, cursor: string | null, mode: "reset" | "more") => {
      if (!interactionEnabled) return;
      const gate = gateRef.current;
      if (!gate) return;
      pendingRef.current = true;
      const ticket = gate.begin(); // aborts any prior request, new generation
      setPhase(mode === "reset" ? "loading" : "loadingMore");
      try {
        let payload: unknown;
        try {
          const response = await fetch(
            buildHistoryRequestUrl(tab, cursor ?? undefined),
            {
              credentials: "include",
              cache: "no-store",
              headers: { Accept: "application/json" },
              signal: ticket.signal,
            }
          );
          if (!gate.isCurrent(ticket)) return;
          if (!response.ok) {
            setPhase(mode === "reset" ? "error" : "moreError");
            return;
          }
          payload = await response.json();
        } catch {
          // Abort or network failure: fail closed, never surface the raw error.
          if (!gate.isCurrent(ticket)) return;
          setPhase(mode === "reset" ? "error" : "moreError");
          return;
        }
        if (!gate.isCurrent(ticket)) return;

        const parsed = parseHistoryPagePayload(payload, tab);
        if (!parsed.ok) {
          setPhase(mode === "reset" ? "error" : "moreError");
          return;
        }

        const base =
          mode === "reset" ? createInitialHistoryState(tab) : stateRef.current;
        // The accumulated state may already belong to a different tab if the
        // user switched under us; drop this stale page.
        if (base.type !== tab) return;

        const merged = mergeHistoryPage(base, parsed.page, cursor);
        if (!gate.isCurrent(ticket)) return;

        // Refresh API-wide counts even if the merge is rejected.
        setCounts(parsed.page.counts);
        if (!merged.ok) {
          // Keep existing items; a retry re-requests the exact same cursor.
          setPhase(mode === "reset" ? "error" : "moreError");
          return;
        }
        setState(merged.state);
        stateRef.current = merged.state;
        setBounded((prev) => prev || merged.code === "retention_bounded");
        setPhase("ready");
      } finally {
        // Only the still-current load clears the pending guard; a preempted
        // stale load must not release a newer one.
        if (gate.isCurrent(ticket)) pendingRef.current = false;
      }
    },
    [interactionEnabled]
  );

  // Deterministic reset on every open and tab switch.
  useEffect(() => {
    if (!sheetOpen) return;
    const gate = gateRef.current;
    if (!gate) return;
    gate.invalidate(); // abort prior generation before resetting
    pendingRef.current = false;
    const fresh = createInitialHistoryState(activeTab);
    setState(fresh);
    stateRef.current = fresh;
    setBounded(false);
    setPhase("idle");
    void runLoad(activeTab, null, "reset");
  }, [sheetOpen, activeTab, runLoad]);

  // Closing aborts in-flight work and clears private result state. Besides
  // releasing the retained rows, this prevents a same-tab reopen (or an
  // identity/writer transition) from painting the previous session for the
  // one frame before the open reset effect runs.
  useEffect(() => {
    if (sheetOpen) return;
    const gate = gateRef.current;
    if (!gate) return;
    gate.invalidate();
    pendingRef.current = false;
    const fresh = createInitialHistoryState(activeTab);
    setState(fresh);
    stateRef.current = fresh;
    setCounts(ZERO_COUNTS);
    setBounded(false);
    setPhase("idle");
  }, [sheetOpen, activeTab]);

  // Unmount cleanup: abort and invalidate.
  useEffect(() => {
    const gate = gateRef.current;
    return () => {
      if (gate) gate.invalidate();
    };
  }, []);

  // If interaction is disabled while the parent still marks it open, close the
  // portal through the parent so the gate stays authoritative.
  useEffect(() => {
    if (!interactionEnabled && open) onOpenChange(false);
  }, [interactionEnabled, open, onOpenChange]);

  const reload = useCallback(() => {
    void runLoad(activeTab, null, "reset");
  }, [runLoad, activeTab]);

  const loadMore = useCallback(() => {
    if (!interactionEnabled) return;
    if (pendingRef.current) return; // block duplicate load-more while pending
    const current = stateRef.current;
    if (current.atEnd || current.nextCursor === null) return;
    void runLoad(current.type, current.nextCursor, "more");
  }, [interactionEnabled, runLoad]);

  const handleAdd = useCallback(
    (item: HistoryItem) => {
      if (!interactionEnabled) return;
      if (item.type !== "image" && item.type !== "video") return;
      let added = false;
      try {
        added = onAddAsset(item) === true;
      } catch {
        // Fail closed: treat a throwing handler as "not added" and stay open.
        added = false;
      }
      if (added) onOpenChange(false);
    },
    [interactionEnabled, onAddAsset, onOpenChange]
  );

  const groups = useMemo(
    () => groupHistoryItemsByLocalDate(state.items, "zh-CN"),
    [state.items]
  );

  // A controlled tab change updates activeTab before the reset effect swaps
  // `state` to the new tab. Until they agree, `state` still holds the previous
  // tab's data; render only the initial loading state so no stale groups,
  // warning, add buttons, pagination, or end message paint for one frame.
  const isCurrentTabState = state.type === activeTab;
  const hasItems = isCurrentTabState && state.items.length > 0;
  const showInitialLoading =
    !isCurrentTabState || phase === "idle" || (phase === "loading" && !hasItems);
  const showInitialError = isCurrentTabState && phase === "error" && !hasItems;
  const showEmpty = isCurrentTabState && phase === "ready" && !hasItems;

  const statusText =
    showInitialLoading || phase === "loading"
      ? "正在载入历史记录"
      : phase === "loadingMore"
        ? "正在载入更多"
        : phase === "error"
          ? "历史记录载入失败"
          : phase === "moreError"
            ? "载入更多失败"
            : "";

  const body = (
    <div className="flex h-full min-h-0 flex-col">
      {isCurrentTabState && state.truncated && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>部分历史内容可能无法显示</span>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 px-5 py-4">
          {showInitialLoading ? (
            <div
              className="flex items-center justify-center py-16"
              aria-hidden="true"
            >
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : showInitialError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle
                className="h-6 w-6 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">历史记录载入失败</p>
              <Button variant="outline" size="sm" onClick={reload}>
                重试
              </Button>
            </div>
          ) : showEmpty ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Inbox
                className="h-6 w-6 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">暂无历史记录</p>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.dateKey} className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {group.label}
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {group.items.map((item) => (
                    <HistoryTile
                      key={item.sourceId}
                      item={item}
                      onAdd={handleAdd}
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          {hasItems && !state.atEnd && state.nextCursor !== null && (
            <div className="flex flex-col items-center gap-2 pt-2">
              {phase === "moreError" && (
                <p className="text-xs text-muted-foreground">
                  载入更多失败,请重试
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={phase === "loadingMore"}
              >
                {phase === "loadingMore" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    载入中
                  </>
                ) : (
                  "载入更多"
                )}
              </Button>
            </div>
          )}

          {hasItems && state.atEnd && (
            <p className="pt-2 text-center text-xs text-muted-foreground">
              {bounded ? "已达显示上限" : "没有更多了"}
            </p>
          )}
        </div>
      </ScrollArea>
      <p aria-live="polite" className="sr-only">
        {statusText}
      </p>
    </div>
  );

  return (
    <Sheet open={sheetOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[680px] sm:max-w-none"
      >
        <TooltipProvider delayDuration={200}>
          <SheetHeader className="shrink-0 space-y-1 border-b px-5 py-4 text-left">
            <SheetTitle>历史记录</SheetTitle>
            <SheetDescription className="sr-only">
              浏览你的图片、视频与音频历史素材,并可将图片或视频添加到画布。
            </SheetDescription>
          </SheetHeader>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as HistoryType)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="shrink-0 px-5 pt-3">
              <TabsList className="grid w-full grid-cols-3">
                {HISTORY_TABS.map((tab) => (
                  <TabsTrigger key={tab} value={tab}>
                    <span>{TAB_LABELS[tab]}</span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      {counts[tab]}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {HISTORY_TABS.map((tab) => (
              <TabsContent
                key={tab}
                value={tab}
                className="mt-0 min-h-0 flex-1 focus-visible:outline-none"
              >
                {tab === activeTab ? body : null}
              </TabsContent>
            ))}
          </Tabs>
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  );
}

interface HistoryTileProps {
  item: HistoryItem;
  onAdd: (item: HistoryItem) => void;
}

function HistoryTile({ item, onAdd }: HistoryTileProps) {
  const canAdd = item.type === "image" || item.type === "video";
  const time = formatTime(item.createdAt);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <CanvasHistoryPreview item={item} />
        {canAdd && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="添加到画布"
                onClick={() => onAdd(item)}
                className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm ring-1 ring-border transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>添加到画布</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">
          {itemTitle(item)}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {SOURCE_LABELS[item.source]}
          {time ? ` · ${time}` : ""}
        </p>
      </div>
    </div>
  );
}

export default CanvasHistoryPanel;
