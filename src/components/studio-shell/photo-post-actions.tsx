"use client";

/**
 * 图文帖动作区(S4.2):TikTok 直发 + 导出图包降级
 *
 * 直发:选账号(/api/publish/accounts)→ 可见范围/评论/配乐 →
 * POST /api/studio/photo-post/publish → 轮询 GET(4s×30 次≈2 分钟)。
 * 完成后本地标记 published(权威在 generations.library_status,服务端已写)。
 *
 * 导出:jszip 打包 图序(01.jpg…)+文案.txt(BLUEPRINT §六 首版降级方案:
 * 直发不可用/未授权账号时人工发布不受阻)。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useStudioStore } from "@/stores/studio-store";
import { usePhotoPostStore } from "@/stores/photo-post-store";
import type { StudioJobView } from "@/lib/studio/batch-view";

interface TikTokAccountOption {
  id: string;
  display_name: string | null;
  username?: string | null;
  status?: string | null;
}

const PRIVACY_OPTIONS = [
  { value: "PUBLIC_TO_EVERYONE", label: "公开" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "好友可见" },
  { value: "FOLLOWER_OF_CREATOR", label: "粉丝可见" },
  { value: "SELF_ONLY", label: "仅自己可见" },
] as const;

interface PhotoPostActionsProps {
  batchId: string;
  view: StudioJobView;
}

export function PhotoPostActions({ batchId, view }: PhotoPostActionsProps) {
  const { toast } = useToast();
  const [panelOpen, setPanelOpen] = useState(false);
  const [accounts, setAccounts] = useState<TikTokAccountOption[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [privacy, setPrivacy] = useState<(typeof PRIVACY_OPTIONS)[number]["value"]>(
    "PUBLIC_TO_EVERYONE"
  );
  const [allowComment, setAllowComment] = useState(true);
  const [autoMusic, setAutoMusic] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // 卸载后停止轮询(抽屉切换任务/关闭)
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const published = view.libraryStatus === "published";
  const images = view.images ?? [];

  const openPanel = () => {
    setPanelOpen((open) => !open);
    if (accounts === null) {
      fetch("/api/publish/accounts")
        .then((res) => res.json())
        .then((result) => {
          const list: TikTokAccountOption[] = Array.isArray(result?.data?.accounts)
            ? result.data.accounts
            : Array.isArray(result?.accounts)
              ? result.accounts
              : [];
          const active = list.filter((a) => !a.status || a.status === "active");
          setAccounts(active);
          if (active.length > 0) setAccountId(active[0].id);
        })
        .catch(() => setAccounts([]));
    }
  };

  /**
   * 轮询直发状态(4s × 30 ≈ 2 分钟)。锚已持久化在 photo-post store:
   * 组件卸载只是本地停轮询,重开抽屉自动恢复;服务端 GET 是 published 落库
   * 的权威写入端(审查实锤:状态不再只活在一次性轮询里)。
   */
  const pollPublish = useCallback(
    async (publishId: string, pollAccountId: string): Promise<void> => {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        if (!aliveRef.current) return;
        let status: { status?: string; failReason?: string } = {};
        try {
          const poll = await fetch(
            `/api/studio/photo-post/publish?taskId=${encodeURIComponent(view.taskId)}&accountId=${encodeURIComponent(pollAccountId)}&publishId=${encodeURIComponent(publishId)}`,
            { signal: AbortSignal.timeout(30_000) }
          );
          const pollResult = await poll.json();
          if (!pollResult.success) continue; // 单次查询失败不判死
          status = pollResult.data ?? {};
        } catch {
          continue;
        }
        if (status.status === "PUBLISH_COMPLETE" || status.status === "SEND_TO_USER_INBOX") {
          useStudioStore.getState().markJobsLibrary(batchId, [view.taskId], "published");
          usePhotoPostStore.getState().updateTask(view.taskId, { publish: null });
          if (!aliveRef.current) return;
          setPublishNote(null);
          setPanelOpen(false);
          toast({
            title:
              status.status === "PUBLISH_COMPLETE"
                ? "🎉 已发布到 TikTok"
                : "已送达 TikTok 收件箱(账号内确认后可见)",
          });
          return;
        }
        if (status.status === "FAILED") {
          usePhotoPostStore.getState().updateTask(view.taskId, { publish: null });
          throw new Error(status.failReason || "TikTok 处理失败");
        }
        if (aliveRef.current) setPublishNote(`TikTok 处理中(${i + 1}/30)…`);
      }
      // 超时不清锚:重开抽屉会继续查(服务端一旦 COMPLETE 即落 published)
      throw new Error("发布仍在处理,重开本抽屉会继续查询(未扣任何费用)");
    },
    [batchId, view.taskId, toast]
  );

  const publish = async () => {
    if (!accountId) {
      toast({ title: "请先选择 TikTok 账号", variant: "destructive" });
      return;
    }
    setPublishing(true);
    setPublishNote("提交发布请求…");
    try {
      const res = await fetch("/api/studio/photo-post/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: view.taskId,
          accountId,
          privacyLevel: privacy,
          disableComment: !allowComment,
          autoAddMusic: autoMusic,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const result = await res.json();
      if (!result.success || !result.data?.publishId) {
        throw new Error(result.error || "发布请求失败");
      }
      const publishId: string = result.data.publishId;
      // 在途锚持久化:卸载/刷新后重开抽屉可恢复轮询,不诱导重复发布
      usePhotoPostStore.getState().updateTask(view.taskId, {
        publish: { accountId, publishId, startedAt: new Date().toISOString() },
      });
      setPublishNote("TikTok 处理中(拉取图片)…");
      await pollPublish(publishId, accountId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "发布失败";
      setPublishNote(null);
      toast({
        title: "直发失败",
        description: `${message}。可改用「导出图包」手动发布`,
        variant: "destructive",
      });
    } finally {
      if (aliveRef.current) setPublishing(false);
    }
  };

  // 恢复在途发布(挂载时一次):上次直发起飞后抽屉被关/任务被切走,
  // 锚还在 store——静默续轮询,完成即标 published
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const task = usePhotoPostStore.getState().tasks.find((t) => t.id === view.taskId);
    if (!task?.publish || view.libraryStatus === "published") return;
    const anchor = task.publish;
    setPublishing(true);
    setPublishNote("恢复查询上次发布状态…");
    void (async () => {
      try {
        await pollPublish(anchor.publishId, anchor.accountId);
      } catch (error) {
        if (!aliveRef.current) return;
        setPublishNote(null);
        toast({
          title: "发布状态查询",
          description: error instanceof Error ? error.message : "请稍后重开抽屉再查",
        });
      } finally {
        if (aliveRef.current) setPublishing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportZip = async () => {
    if (images.length === 0) return;
    setExporting(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (let i = 0; i < images.length; i++) {
        const url = images[i];
        const res = await fetch(`/api/download-proxy?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error(`第 ${i + 1} 张图下载失败`);
        const blob = await res.blob();
        const ext = /\.(png|webp|gif)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? "jpg";
        zip.file(`${String(i + 1).padStart(2, "0")}.${ext}`, blob);
      }
      zip.file("文案.txt", view.caption ?? "");
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      const objectUrl = URL.createObjectURL(zipBlob);
      a.href = objectUrl;
      a.download = `图文帖-${view.taskId.slice(-8)}.zip`;
      a.click();
      URL.revokeObjectURL(objectUrl);
      toast({ title: "图包已导出(含文案.txt)" });
    } catch (error) {
      toast({
        title: "导出失败",
        description: error instanceof Error ? error.message : "请重试",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1.5 text-sky-400 hover:text-sky-300"
        disabled={publishing}
        onClick={openPanel}
      >
        <Send className="h-3.5 w-3.5" />
        {published ? "已发布 · 再发一次" : "直发 TikTok 图文"}
      </Button>

      {panelOpen && (
        <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
          {accounts === null ? (
            <p className="text-[11px] text-zinc-500">加载账号…</p>
          ) : accounts.length === 0 ? (
            <p className="text-[11px] text-zinc-500">
              暂无已授权的 TikTok 账号——到「发布中心 → 账号管理」完成授权,或用下方「导出图包」手动发布
            </p>
          ) : (
            <>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="h-8 w-full border-white/10 bg-black/30 text-xs">
                  <SelectValue placeholder="选择账号" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.display_name || a.username || a.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={privacy}
                onValueChange={(v) => setPrivacy(v as typeof privacy)}
              >
                <SelectTrigger className="h-8 w-full border-white/10 bg-black/30 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIVACY_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-4 text-[11px] text-zinc-400">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={allowComment}
                    onChange={(e) => setAllowComment(e.target.checked)}
                    className="accent-sky-400"
                  />
                  允许评论
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={autoMusic}
                    onChange={(e) => setAutoMusic(e.target.checked)}
                    className="accent-sky-400"
                  />
                  自动配乐
                </label>
              </div>
              <Button
                size="sm"
                disabled={publishing || !accountId}
                className="w-full gap-1.5"
                onClick={() => void publish()}
              >
                {publishing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {publishing ? (publishNote ?? "发布中…") : `发布 ${images.length} 图`}
              </Button>
            </>
          )}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        disabled={exporting || images.length === 0}
        onClick={() => void exportZip()}
      >
        {exporting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        导出图包(含文案)
      </Button>
    </>
  );
}
