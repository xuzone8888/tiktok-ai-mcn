"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  FilePlus2,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { CANVAS_UUID_RE } from "@/lib/canvas/api-helpers";
import type {
  CanvasProjectListData,
  CanvasProjectSummary,
} from "@/lib/canvas/api-types";
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const UNTITLED_CANVAS = "未命名画布";
const TITLE_CONTROL_RE = /[\u0000-\u001f\u007f]/;

type ListStatus = "idle" | "loading" | "ready" | "error";
type BusyAction = "navigate" | "rename" | "delete" | null;

export type CanvasProjectNavigationTarget =
  | { kind: "workspace" }
  | { kind: "new" }
  | { kind: "canvas"; canvasId: string }
  | { kind: "rename"; canvasId: string | null }
  | { kind: "delete"; canvasId: string };

export interface CanvasProjectBarProps {
  canvasId?: string | null;
  /** Pass the authoritative loaded title when available; the list is the fallback. */
  currentTitle?: string | null;
  workspaceHref?: string;
  pageSize?: number;
  disabled?: boolean;
  mutationDisabled?: boolean;
  className?: string;
  /**
   * Return false to keep the current project open (for example while a save
   * fence is unresolved). Throwing also blocks navigation and surfaces an error.
   */
  beforeNavigate?: (
    target: CanvasProjectNavigationTarget
  ) => boolean | void | Promise<boolean | void>;
  onBackToWorkspace?: () => void | Promise<void>;
  onCreateNew?: () => void | Promise<void>;
  onOpenProject?: (project: CanvasProjectSummary) => void | Promise<void>;
  /** Local canvases are renameable only when the integrator persists this value. */
  onRenameLocal?: (title: string) => void | Promise<void>;
  onRenamed?: (
    project: CanvasProjectSummary
  ) => void | Promise<void>;
  onDeleted?: (canvasId: string) => void | Promise<void>;
}

interface DeleteTarget {
  id: string;
  title: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeProject(value: unknown): CanvasProjectSummary | null {
  if (!isRecord(value)) return null;
  const { id, title, rev, docBytes, createdAt, updatedAt } = value;
  if (
    typeof id !== "string" ||
    !CANVAS_UUID_RE.test(id) ||
    typeof title !== "string" ||
    typeof rev !== "number" ||
    !Number.isSafeInteger(rev) ||
    rev < 0 ||
    !(
      docBytes === null ||
      (typeof docBytes === "number" &&
        Number.isSafeInteger(docBytes) &&
        docBytes >= 0)
    ) ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: id.toLowerCase(),
    title,
    rev,
    docBytes,
    createdAt,
    updatedAt,
  };
}

function decodeProjectList(value: unknown): CanvasProjectListData | null {
  if (!isRecord(value) || !Array.isArray(value.canvases)) return null;
  const pagination = value.pagination;
  if (!isRecord(pagination)) return null;

  const canvases: CanvasProjectSummary[] = [];
  for (const item of value.canvases) {
    const project = decodeProject(item);
    if (!project) return null;
    canvases.push(project);
  }

  const { page, limit, total, totalPages, hasMore } = pagination;
  if (
    typeof page !== "number" ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE ||
    typeof total !== "number" ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    typeof totalPages !== "number" ||
    !Number.isSafeInteger(totalPages) ||
    totalPages < 0 ||
    typeof hasMore !== "boolean"
  ) {
    return null;
  }

  return {
    canvases,
    pagination: { page, limit, total, totalPages, hasMore },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiErrorMessage(
  response: Response,
  body: unknown,
  fallback: string
): string {
  if (isRecord(body) && body.success === false) {
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error.trim();
    }
    if (
      isRecord(body.error) &&
      typeof body.error.message === "string" &&
      body.error.message.trim()
    ) {
      return body.error.message.trim();
    }
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message.trim();
    }
  }
  return response.status === 401 ? "登录状态已失效，请重新登录" : fallback;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(value: number | null): string {
  if (value === null) return "大小未知";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizePageSize(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(value, MAX_PAGE_SIZE);
}

export function CanvasProjectBar({
  canvasId,
  currentTitle,
  workspaceHref = "/studio",
  pageSize,
  disabled = false,
  mutationDisabled = false,
  className,
  beforeNavigate,
  onBackToWorkspace,
  onCreateNew,
  onOpenProject,
  onRenameLocal,
  onRenamed,
  onDeleted,
}: CanvasProjectBarProps) {
  const router = useRouter();
  const normalizedCanvasId =
    typeof canvasId === "string" && CANVAS_UUID_RE.test(canvasId)
      ? canvasId.toLowerCase()
      : null;
  const safePageSize = normalizePageSize(pageSize);

  const [projects, setProjects] = useState<CanvasProjectSummary[]>([]);
  const [pagination, setPagination] =
    useState<CanvasProjectListData["pagination"] | null>(null);
  const [listStatus, setListStatus] = useState<ListStatus>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamedTitle, setRenamedTitle] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const requestSequence = useRef(0);
  const listAbortController = useRef<AbortController | null>(null);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === normalizedCanvasId) ?? null,
    [normalizedCanvasId, projects]
  );
  const propTitle =
    typeof currentTitle === "string" && currentTitle.trim()
      ? currentTitle.trim()
      : null;
  const displayTitle =
    renamedTitle ?? propTitle ?? currentProject?.title ?? UNTITLED_CANVAS;

  const loadProjects = useCallback(
    async (page = 1, append = false) => {
      const sequence = ++requestSequence.current;
      listAbortController.current?.abort();
      const controller = new AbortController();
      listAbortController.current = controller;
      setListStatus("loading");
      setListError(null);
      try {
        const response = await fetch(
          `/api/canvas?page=${page}&limit=${safePageSize}`,
          { cache: "no-store", signal: controller.signal }
        );
        const body = await readJson(response);
        if (!response.ok || !isRecord(body) || body.success !== true) {
          throw new Error(
            apiErrorMessage(response, body, "我的画布加载失败")
          );
        }
        const decoded = decodeProjectList(body.data);
        if (!decoded) throw new Error("画布列表返回了无效数据");
        if (sequence !== requestSequence.current) return;

        setProjects((previous) => {
          if (!append) return decoded.canvases;
          const merged = new Map(previous.map((project) => [project.id, project]));
          for (const project of decoded.canvases) merged.set(project.id, project);
          return Array.from(merged.values());
        });
        setPagination(decoded.pagination);
        setListStatus("ready");
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error as { name?: string })?.name === "AbortError"
        ) {
          return;
        }
        if (sequence !== requestSequence.current) return;
        setListStatus("error");
        setListError(
          error instanceof Error ? error.message : "我的画布加载失败"
        );
      }
    },
    [safePageSize]
  );

  useEffect(() => {
    void loadProjects(1, false);
    return () => {
      requestSequence.current += 1;
      listAbortController.current?.abort();
      listAbortController.current = null;
    };
  }, [loadProjects]);

  useEffect(() => {
    setRenaming(false);
    setRenamedTitle(null);
    setOperationError(null);
    setDeleteTarget(null);
  }, [normalizedCanvasId]);

  const navigationAllowed = useCallback(
    async (target: CanvasProjectNavigationTarget) => {
      if (!beforeNavigate) return true;
      try {
        return (await beforeNavigate(target)) !== false;
      } catch (error) {
        setOperationError(
          error instanceof Error ? error.message : "当前画布暂时无法离开"
        );
        return false;
      }
    },
    [beforeNavigate]
  );

  const goToWorkspace = useCallback(async () => {
    if (disabled || busyAction) return;
    setOperationError(null);
    setBusyAction("navigate");
    try {
      if (!(await navigationAllowed({ kind: "workspace" }))) return;
      if (onBackToWorkspace) await onBackToWorkspace();
      else router.push(workspaceHref);
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "返回工作台失败"
      );
    } finally {
      setBusyAction(null);
    }
  }, [
    busyAction,
    disabled,
    navigationAllowed,
    onBackToWorkspace,
    router,
    workspaceHref,
  ]);

  const createNew = useCallback(async () => {
    if (disabled || busyAction) return;
    setOperationError(null);
    setBusyAction("navigate");
    try {
      if (!(await navigationAllowed({ kind: "new" }))) return;
      if (onCreateNew) {
        await onCreateNew();
      } else if (normalizedCanvasId === null) {
        // Pushing the same /canvas URL would not reset a local singleton store.
        globalThis.location.assign("/canvas");
      } else {
        router.push("/canvas");
      }
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "新建画布失败"
      );
    } finally {
      setBusyAction(null);
    }
  }, [
    busyAction,
    disabled,
    navigationAllowed,
    normalizedCanvasId,
    onCreateNew,
    router,
  ]);

  const openProject = useCallback(
    async (project: CanvasProjectSummary) => {
      if (disabled || busyAction || project.id === normalizedCanvasId) {
        setMenuOpen(false);
        return;
      }
      setOperationError(null);
      setBusyAction("navigate");
      try {
        if (
          !(await navigationAllowed({
            kind: "canvas",
            canvasId: project.id,
          }))
        ) {
          return;
        }
        setMenuOpen(false);
        if (onOpenProject) await onOpenProject(project);
        else router.push(`/canvas?id=${project.id}`);
      } catch (error) {
        setOperationError(
          error instanceof Error ? error.message : "画布打开失败"
        );
      } finally {
        setBusyAction(null);
      }
    },
    [
      busyAction,
      disabled,
      navigationAllowed,
      normalizedCanvasId,
      onOpenProject,
      router,
    ]
  );

  const beginRename = useCallback(() => {
    if (
      disabled ||
      mutationDisabled ||
      busyAction ||
      (normalizedCanvasId === null && !onRenameLocal)
    ) {
      return;
    }
    setOperationError(null);
    setRenameDraft(displayTitle);
    setRenaming(true);
  }, [
    busyAction,
    disabled,
    displayTitle,
    mutationDisabled,
    normalizedCanvasId,
    onRenameLocal,
  ]);

  const submitRename = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (disabled || mutationDisabled || busyAction || !renaming) return;
      const title = renameDraft.trim();
      if (
        !title ||
        title.length > 200 ||
        TITLE_CONTROL_RE.test(title)
      ) {
        setOperationError("标题需为 1-200 个字符，且不能包含换行或控制字符");
        return;
      }
      if (title === displayTitle) {
        setRenaming(false);
        return;
      }

      setOperationError(null);
      setBusyAction("rename");
      try {
        if (
          !(await navigationAllowed({
            kind: "rename",
            canvasId: normalizedCanvasId,
          }))
        ) {
          return;
        }
        if (normalizedCanvasId === null) {
          if (!onRenameLocal) throw new Error("画布保存后才能重命名");
          await onRenameLocal(title);
          setRenamedTitle(title);
        } else {
          const response = await fetch(
            `/api/canvas/${normalizedCanvasId}/metadata`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            }
          );
          const body = await readJson(response);
          if (!response.ok || !isRecord(body) || body.success !== true) {
            throw new Error(apiErrorMessage(response, body, "画布重命名失败"));
          }
          const updated = decodeProject(body.data);
          if (!updated || updated.id !== normalizedCanvasId) {
            throw new Error("画布重命名返回了无效数据");
          }
          setProjects((previous) =>
            previous.map((project) =>
              project.id === updated.id ? updated : project
            )
          );
          setRenamedTitle(updated.title);
          try {
            await onRenamed?.(updated);
          } catch (callbackError) {
            console.error(
              "[CanvasProjectBar] onRenamed callback failed:",
              callbackError
            );
          }
        }
        setRenaming(false);
      } catch (error) {
        setOperationError(
          error instanceof Error ? error.message : "画布重命名失败"
        );
      } finally {
        setBusyAction(null);
      }
    },
    [
      busyAction,
      disabled,
      displayTitle,
      mutationDisabled,
      normalizedCanvasId,
      navigationAllowed,
      onRenameLocal,
      onRenamed,
      renameDraft,
      renaming,
    ]
  );

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target || disabled || mutationDisabled || busyAction) return;
    setOperationError(null);
    setBusyAction("delete");
    try {
      if (
        !(await navigationAllowed({
          kind: "delete",
          canvasId: target.id,
        }))
      ) {
        return;
      }
      const response = await fetch(`/api/canvas/${target.id}/metadata`, {
        method: "DELETE",
      });
      const body = await readJson(response);
      if (!response.ok || !isRecord(body) || body.success !== true) {
        throw new Error(apiErrorMessage(response, body, "画布删除失败"));
      }
      if (
        !isRecord(body.data) ||
        body.data.deleted !== true ||
        body.data.id !== target.id
      ) {
        throw new Error("画布删除返回了无效数据");
      }

      setProjects((previous) =>
        previous.filter((project) => project.id !== target.id)
      );
      setPagination((previous) =>
        previous
          ? {
              ...previous,
              total: Math.max(0, previous.total - 1),
              totalPages: Math.ceil(
                Math.max(0, previous.total - 1) / previous.limit
              ),
              hasMore:
                previous.page <
                Math.ceil(Math.max(0, previous.total - 1) / previous.limit),
            }
          : previous
      );
      setDeleteTarget(null);

      try {
        await onDeleted?.(target.id);
      } catch (callbackError) {
        console.error("[CanvasProjectBar] onDeleted callback failed:", callbackError);
      }

      if (target.id === normalizedCanvasId) {
        if (onCreateNew) await onCreateNew();
        else router.replace("/canvas");
      }
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "画布删除失败"
      );
    } finally {
      setBusyAction(null);
    }
  }, [
    busyAction,
    deleteTarget,
    disabled,
    mutationDisabled,
    normalizedCanvasId,
    navigationAllowed,
    onCreateNew,
    onDeleted,
    router,
  ]);

  const isBusy = busyAction !== null;
  const canRename =
    !disabled &&
    !mutationDisabled &&
    !isBusy &&
    (normalizedCanvasId !== null || Boolean(onRenameLocal));

  return (
    <div
      className={cn(
        "pointer-events-auto flex max-w-[calc(100vw-1rem)] flex-col items-start gap-1.5",
        className
      )}
      data-canvas-project-bar
    >
      <div className="flex max-w-full items-center gap-1 rounded-xl border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2"
          aria-label="返回工作台"
          disabled={disabled || isBusy}
          onClick={() => void goToWorkspace()}
        >
          {busyAction === "navigate" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ArrowLeft />
          )}
          <span className="hidden sm:inline">工作台</span>
        </Button>

        <div className="h-5 w-px bg-border" aria-hidden />

        {renaming ? (
          <form
            className="flex min-w-0 items-center gap-1"
            onSubmit={(event) => void submitRename(event)}
          >
            <Input
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              maxLength={200}
              autoFocus
              disabled={busyAction === "rename"}
              aria-label="画布标题"
              className="h-8 w-[min(42vw,18rem)] rounded-md bg-background px-2.5"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(false);
                  setOperationError(null);
                }
              }}
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="保存标题"
              disabled={busyAction === "rename"}
            >
              {busyAction === "rename" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="取消重命名"
              disabled={busyAction === "rename"}
              onClick={() => {
                setRenaming(false);
                setOperationError(null);
              }}
            >
              <X />
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 min-w-0 max-w-[min(42vw,18rem)] gap-1.5 px-2"
            title={displayTitle}
            disabled={!canRename}
            onClick={beginRename}
          >
            <span className="truncate">{displayTitle}</span>
            <Pencil className="shrink-0 opacity-60" />
          </Button>
        )}

        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (open && listStatus === "error") void loadProjects(1, false);
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2"
              disabled={disabled || isBusy}
            >
              <span className="hidden md:inline">我的画布</span>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[min(70vh,32rem)] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto"
          >
            <DropdownMenuLabel className="flex items-center justify-between gap-2">
              <span>我的画布</span>
              {pagination && (
                <span className="text-xs font-normal text-muted-foreground">
                  {pagination.total} 个
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {listStatus === "loading" && projects.length === 0 && (
              <DropdownMenuItem disabled className="justify-center py-6">
                <Loader2 className="animate-spin" />
                正在加载
              </DropdownMenuItem>
            )}

            {listStatus === "error" && projects.length === 0 && (
              <DropdownMenuItem
                className="flex-col items-start gap-2 py-3 text-destructive focus:text-destructive"
                onSelect={(event) => {
                  event.preventDefault();
                  void loadProjects(1, false);
                }}
              >
                <span className="line-clamp-2 text-xs">
                  {listError ?? "加载失败"}
                </span>
                <span className="inline-flex items-center gap-1 text-xs">
                  <RefreshCw />
                  点击重试
                </span>
              </DropdownMenuItem>
            )}

            {listStatus !== "loading" &&
              listStatus !== "error" &&
              projects.length === 0 && (
                <DropdownMenuItem disabled className="justify-center py-6">
                  还没有已保存的画布
                </DropdownMenuItem>
              )}

            {projects.map((project) => {
              const active = project.id === normalizedCanvasId;
              return (
                <DropdownMenuItem
                  key={project.id}
                  className="items-start py-2.5"
                  onSelect={() => void openProject(project)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">
                        {project.title || UNTITLED_CANVAS}
                      </span>
                      {active && (
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          当前
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex gap-2 text-[11px] text-muted-foreground">
                      <span>{formatUpdatedAt(project.updatedAt)}</span>
                      <span>{formatBytes(project.docBytes)}</span>
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            })}

            {listStatus === "error" && projects.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={(event) => {
                    event.preventDefault();
                    const retryPage = pagination?.hasMore
                      ? pagination.page + 1
                      : pagination?.page ?? 1;
                    void loadProjects(retryPage, retryPage > 1);
                  }}
                >
                  <RefreshCw />
                  {listError ?? "后续画布加载失败，点击重试"}
                </DropdownMenuItem>
              </>
            )}

            {pagination?.hasMore && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="justify-center"
                  disabled={listStatus === "loading"}
                  onSelect={(event) => {
                    event.preventDefault();
                    void loadProjects(pagination.page + 1, true);
                  }}
                >
                  {listStatus === "loading" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ChevronDown />
                  )}
                  加载更多
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2"
          disabled={disabled || isBusy}
          onClick={() => void createNew()}
        >
          <FilePlus2 />
          <span className="hidden lg:inline">新建</span>
        </Button>

        {normalizedCanvasId && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            aria-label="删除当前画布"
            title={mutationDisabled ? "当前标签页为只读" : undefined}
            disabled={disabled || mutationDisabled || isBusy}
            onClick={() => {
              setOperationError(null);
              setDeleteTarget({
                id: normalizedCanvasId,
                title: displayTitle,
              });
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>

      {operationError && (
        <div
          role="alert"
          className="max-w-[min(34rem,calc(100vw-1rem))] rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive shadow"
        >
          {operationError}
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && busyAction !== "delete") setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除画布「{deleteTarget?.title ?? UNTITLED_CANVAS}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              画布结构将被永久删除，已完成的生成记录和计费审计仍会保留。若仍有图片或视频正在生成，系统会拒绝删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {operationError && (
            <p role="alert" className="text-sm text-destructive">
              {operationError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction === "delete"}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busyAction === "delete"}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {busyAction === "delete" && (
                <Loader2 className="animate-spin" />
              )}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
